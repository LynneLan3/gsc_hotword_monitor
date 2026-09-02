/**
 * 实时 24h Query 爆量监控（hourly_all 旁路）。
 *
 * 只读 hourly_all，形成 rolling 24h 站点 / Query / Page 快照。
 * 不写 GSC日数据 / Query明细 / Query页面明细 / 每日快照 / 今日行动，
 * 只按 header 更新站点状态的 realtime / early-signal 自有字段。
 */

var FRESH_QUERY_HOUR_MS = 60 * 60 * 1000;
var FRESH_QUERY_DAY_MS = 24 * FRESH_QUERY_HOUR_MS;

/**
 * 菜单 / clasp 入口。独立于 runDaily。
 */
function runFreshQueryMonitor() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    writeLog_('WARN', '', 'runFreshQueryMonitor 跳过：已有实例在运行（LockService）');
    Logger.log('runFreshQueryMonitor skipped: lock busy');
    return 'runFreshQueryMonitor skipped: lock busy';
  }
  try {
    return runFreshQueryMonitorUnlocked_();
  } finally {
    lock.releaseLock();
  }
}

function runFreshQueryMonitorUnlocked_() {
  ensureSheet_(SHEET_NAMES.FRESH_SITE_MONITOR, FRESH_SITE_MONITOR_HEADERS);
  ensureSheet_(SHEET_NAMES.FRESH_QUERY_MONITOR, FRESH_QUERY_MONITOR_HEADERS);
  ensureSheet_(SHEET_NAMES.FRESH_PAGE_MONITOR, FRESH_PAGE_MONITOR_HEADERS);
  var sites = getEnabledSites();
  var generatedAt = new Date();
  var range = getFreshQueryHourlyDateRange_();
  var siteRows = [];
  var queryRows = [];
  var pageRows = [];
  var statusRecords = [];
  var completedSites = [];
  var errors = 0;

  writeLog_(
    'INFO',
    '',
    'runFreshQueryMonitor 开始 | sites=' +
      sites.length +
      ' | range=' +
      range.startDate +
      '~' +
      range.endDate +
      ' | dataState=hourly_all'
  );

  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    try {
      var result = collectFreshQueryMonitorSite_(site, generatedAt, range);
      siteRows.push(result.siteRow);
      queryRows = queryRows.concat(result.queryRows);
      pageRows = pageRows.concat(result.pageRows);
      statusRecords.push(result.statusRecord);
      completedSites.push(site.name);
    } catch (e) {
      errors++;
      writeLog_('ERROR', site && site.name, 'Fresh Query 监控失败: ' + e.message);
    }
  }

  siteRows.sort(compareFreshSiteMonitorRows_);
  queryRows.sort(compareFreshQueryMonitorRows_);
  pageRows.sort(compareFreshPageMonitorRows_);
  writeFreshRealtimeSnapshotRows_(SHEET_NAMES.FRESH_SITE_MONITOR, FRESH_SITE_MONITOR_HEADERS, siteRows, completedSites);
  writeFreshRealtimeSnapshotRows_(SHEET_NAMES.FRESH_QUERY_MONITOR, FRESH_QUERY_MONITOR_HEADERS, queryRows, completedSites);
  writeFreshRealtimeSnapshotRows_(SHEET_NAMES.FRESH_PAGE_MONITOR, FRESH_PAGE_MONITOR_HEADERS, pageRows, completedSites);
  updateRealtimeSiteStatusRows_(statusRecords, generatedAt);

  var summary =
    'runFreshQueryMonitor 完成 | sites=' +
    completedSites.length +
    ' | queries=' + queryRows.length +
    ' | pages=' + pageRows.length +
    ' | errors=' +
    errors;
  writeLog_('INFO', '', summary);
  Logger.log(summary);
  alertUi_(summary);
  return summary;
}

/**
 * 拉取最近 FRESH_HOURLY_LOOKBACK_DAYS 个 GSC 自然日（含今天）。
 * 窗口切分在 hour timestamp 上完成，不按自然日比较。
 */
function getFreshQueryHourlyDateRange_() {
  var endDate = gscTodayStr_();
  var startDate = addDaysToDateStr_(endDate, -(FRESH_HOURLY_LOOKBACK_DAYS - 1));
  return { startDate: startDate, endDate: endDate, gscToday: endDate };
}

function collectFreshQueryMonitorSite_(site, generatedAt, range) {
  var propertyUrls = getFreshRealtimePropertyUrls_(site);
  var totalRows = [];
  var queryRows = [];
  var pageRows = [];
  var incomplete = false;
  var apiRows = 0;
  for (var i = 0; i < propertyUrls.length; i++) {
    var propertyUrl = propertyUrls[i];
    var totals = fetchHourlySiteTotalsResult_(propertyUrl, range.startDate, range.endDate, FRESH_HOURLY_ROW_LIMIT);
    var queries = fetchHourlyQueryPagesResult_(propertyUrl, range.startDate, range.endDate, FRESH_HOURLY_ROW_LIMIT);
    var pages = fetchHourlyPagesResult_(propertyUrl, range.startDate, range.endDate, FRESH_HOURLY_ROW_LIMIT);
    totalRows = totalRows.concat(tagFreshPropertyRows_(totals.rows, propertyUrl));
    queryRows = queryRows.concat(tagFreshPropertyRows_(queries.rows, propertyUrl));
    pageRows = pageRows.concat(tagFreshPropertyRows_(pages.rows, propertyUrl));
    apiRows += (totals.rows || []).length + (queries.rows || []).length + (pages.rows || []).length;
    incomplete = incomplete || isFreshHourlyIncomplete_(totals.metadata) ||
      isFreshHourlyIncomplete_(queries.metadata) || isFreshHourlyIncomplete_(pages.metadata);
  }
  var cutoff = findFreshHourlyCutoff_(totalRows.length ? totalRows : queryRows.concat(pageRows));
  var built = buildFreshQueryMonitorRows_(queryRows, {
    site: site,
    generatedAt: generatedAt,
    metadata: incomplete ? { firstIncompleteHour: cutoff.hour || 'unknown' } : null,
    cutoffHour: cutoff.hour,
    cutoffHourMs: cutoff.hourMs,
    propertySources: propertyUrls
  });
  var totalWindows = splitFreshQueryWindows_(totalRows, cutoff.hourMs, cutoff.hour);
  var siteMetrics = aggregateFreshHourlyTotals_(totalWindows.recent, totalWindows.previous);
  var siteRow = buildFreshSiteMonitorSheetRow_({
    generatedAt: generatedAt,
    siteName: site.name,
    metrics: siteMetrics,
    cutoffHour: cutoff.hour,
    incomplete: incomplete,
    propertySource: propertyUrls.join('|')
  });
  var pageBuilt = buildFreshPageMonitorRows_(pageRows, {
    site: site,
    generatedAt: generatedAt,
    cutoffHour: cutoff.hour,
    cutoffHourMs: cutoff.hourMs,
    incomplete: incomplete
  });

  if (site.name === 'Mortal Shell II') {
    logMs2SkipPrologueFresh_(built.all);
  }

  writeLog_(
    'INFO',
    site.name,
    'Fresh hourly | apiRows=' +
      apiRows +
      ' | properties=' + propertyUrls.length +
      ' | queries=' + built.saved.length +
      ' | triggered=' +
      built.triggered.length +
      ' | cutoff=' +
      (built.cutoffHour || '') +
      ' | incomplete=' +
      (built.incomplete ? '是' : '否')
  );

  return {
    siteRow: siteRow,
    queryRows: built.saved,
    pageRows: pageBuilt.rows,
    statusRecord: buildFreshRealtimeStatusRecord_(site, siteMetrics, built.all, cutoff.hour, incomplete)
  };
}

/**
 * 纯函数：按 hour 切近 24h / 前 24h，计算爆量与承接，生成 Sheet 行。
 * @param {Array} hourlyRows normalizeHourlyQueryPageRows_ 输出
 * @param {Object} opts
 * @return {{all:Array, triggered:Array, cutoffHour:string, incomplete:boolean}}
 */
function buildFreshQueryMonitorRows_(hourlyRows, opts) {
  opts = opts || {};
  var site = opts.site || {};
  var generatedAt = opts.generatedAt || new Date();
  var metadata = opts.metadata || null;
  var incomplete = isFreshHourlyIncomplete_(metadata);
  var windows = splitFreshQueryWindows_(hourlyRows, opts.cutoffHourMs, opts.cutoffHour);
  var queries = aggregateFreshQueryWindows_(windows.recent, windows.previous);
  var cutoffHour = windows.cutoffHour || '';
  var all = [];
  var triggered = [];

  for (var i = 0; i < queries.length; i++) {
    var q = queries[i];
    var burst = evaluateFreshQueryBurst_(q);
    var landing = classifyFreshQueryLanding_(q.query, q.pages, site);
    var sheetRow = buildFreshQueryMonitorSheetRow_({
      generatedAt: generatedAt,
      siteName: site.name || '',
      query: q.query,
      pageUrl: landing.pageUrl || (q.primaryPage && q.primaryPage.page) || '',
      clicks24h: q.clicks24h,
      impressions24h: q.impressions24h,
      ctr24h: q.ctr24h,
      avgPosition: q.avgPosition,
      clicksPrev24h: q.clicksPrev24h,
      impressionsPrev24h: q.impressionsPrev24h,
      clickGrowthRatio: q.clicksPrev24h > 0 ? (q.clicks24h - q.clicksPrev24h) / q.clicksPrev24h : null,
      growthRatio: burst.growthRatio,
      isNew: burst.isNew,
      triggered: burst.triggered,
      reasonText: burst.reasonText,
      landingStatus: landing.status,
      suggestedAction: landing.action,
      incomplete: incomplete,
      cutoffHour: cutoffHour,
      propertySource: (q.propertySources || opts.propertySources || []).join('|')
    });
    all.push(sheetRow);
    if (burst.triggered) triggered.push(sheetRow);
  }

  var saved = selectFreshQueryMonitorRows_(all, triggered);
  return {
    all: all,
    saved: saved,
    triggered: triggered,
    cutoffHour: cutoffHour,
    incomplete: incomplete
  };
}

function isFreshHourlyIncomplete_(metadata) {
  if (!metadata) return false;
  return !!(metadata.firstIncompleteHour || metadata.firstIncompleteDate);
}

/**
 * 用返回数据里最晚的 hour 作为截止点，切近 24h / 前 24h。
 * recent: (max-24h, max]；previous: (max-48h, max-24h]。
 */
function splitFreshQueryWindows_(hourlyRows, forcedMaxHourMs, forcedCutoffHour) {
  var empty = { recent: [], previous: [], cutoffHour: '', maxHourMs: 0 };
  if (!hourlyRows || !hourlyRows.length) return empty;

  var maxHourMs = Number(forcedMaxHourMs || 0) || 0;
  var cutoffHour = forcedCutoffHour || '';
  for (var i = 0; i < hourlyRows.length; i++) {
    var row = hourlyRows[i];
    if (!row || row.hourMs == null) continue;
    if (!forcedMaxHourMs && row.hourMs > maxHourMs) {
      maxHourMs = row.hourMs;
      cutoffHour = row.hour || '';
    }
  }
  if (!maxHourMs) return empty;

  var recentStart = maxHourMs - FRESH_QUERY_DAY_MS;
  var prevStart = maxHourMs - 2 * FRESH_QUERY_DAY_MS;
  var recent = [];
  var previous = [];
  for (var j = 0; j < hourlyRows.length; j++) {
    var r = hourlyRows[j];
    if (!r || r.hourMs == null) continue;
    if (r.hourMs > recentStart && r.hourMs <= maxHourMs) {
      recent.push(r);
    } else if (r.hourMs > prevStart && r.hourMs <= recentStart) {
      previous.push(r);
    }
  }
  return {
    recent: recent,
    previous: previous,
    cutoffHour: cutoffHour,
    maxHourMs: maxHourMs
  };
}

function aggregateFreshQueryWindows_(recentRows, previousRows) {
  var byQuery = {};

  function ensure_(query) {
    if (!byQuery[query]) {
      byQuery[query] = {
        query: query,
        clicks24h: 0,
        impressions24h: 0,
        positionWeight24h: 0,
        clicksPrev24h: 0,
        impressionsPrev24h: 0,
        propertySources: {},
        pages: {}
      };
    }
    return byQuery[query];
  }

  for (var i = 0; i < (recentRows || []).length; i++) {
    var rec = recentRows[i];
    var q = ensure_(rec.query);
    q.clicks24h += rec.clicks || 0;
    q.impressions24h += rec.impressions || 0;
    q.positionWeight24h += (rec.position || 0) * (rec.impressions || 0);
    if (rec.propertyUrl) q.propertySources[rec.propertyUrl] = true;
    var pageKey = rec.page;
    if (!q.pages[pageKey]) {
      q.pages[pageKey] = {
        page: rec.page,
        clicks: 0,
        impressions: 0,
        propertySources: {}
      };
    }
    q.pages[pageKey].clicks += rec.clicks || 0;
    q.pages[pageKey].impressions += rec.impressions || 0;
    if (rec.propertyUrl) q.pages[pageKey].propertySources[rec.propertyUrl] = true;
  }

  for (var j = 0; j < (previousRows || []).length; j++) {
    var prev = previousRows[j];
    var pq = ensure_(prev.query);
    if (prev.propertyUrl) pq.propertySources[prev.propertyUrl] = true;
    pq.clicksPrev24h += prev.clicks || 0;
    pq.impressionsPrev24h += prev.impressions || 0;
  }

  var out = [];
  var keys = Object.keys(byQuery);
  for (var k = 0; k < keys.length; k++) {
    var item = byQuery[keys[k]];
    item.ctr24h = item.impressions24h > 0 ? item.clicks24h / item.impressions24h : 0;
    item.avgPosition =
      item.impressions24h > 0 ? item.positionWeight24h / item.impressions24h : 0;
    item.pageList = [];
    var pageKeys = Object.keys(item.pages);
    for (var p = 0; p < pageKeys.length; p++) {
      var page = item.pages[pageKeys[p]];
      page.propertySources = Object.keys(page.propertySources || {});
      item.pageList.push(page);
    }
    item.pageList.sort(function (a, b) {
      return (b.impressions || 0) - (a.impressions || 0);
    });
    item.primaryPage = item.pageList[0] || null;
    item.propertySources = Object.keys(item.propertySources || {});
    item.pages = item.pageList;
    out.push(item);
  }

  out.sort(function (a, b) {
    return (b.impressions24h || 0) - (a.impressions24h || 0);
  });
  return out;
}

function selectFreshQueryMonitorRows_(allRows, triggeredRows) {
  var selected = [];
  var seen = {};
  var top = (allRows || []).slice(0, 50);
  var combined = top.concat(triggeredRows || []);
  for (var i = 0; i < combined.length; i++) {
    var row = combined[i];
    var key = String(row[1] || '') + '||' + String(row[2] || '').toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    selected.push(row);
  }
  return selected;
}

function evaluateFreshQueryBurst_(metrics) {
  var cfg = FRESH_QUERY_MONITOR_V1;
  var impressions = metrics.impressions24h || 0;
  var clicks = metrics.clicks24h || 0;
  var prevImpr = metrics.impressionsPrev24h || 0;
  var position = metrics.avgPosition || 0;
  var growthRatio = prevImpr > 0 ? (impressions - prevImpr) / prevImpr : null;
  var isNew = prevImpr <= 0 && impressions > 0;
  var reasons = [];

  if (impressions >= cfg.IMPRESSIONS_BURST) reasons.push('展现≥30');
  if (clicks >= cfg.CLICKS_BURST) reasons.push('点击≥3');
  if (
    prevImpr > 0 &&
    impressions >= cfg.GROWTH_MIN_IMPRESSIONS &&
    growthRatio !== null &&
    growthRatio >= cfg.GROWTH_RATIO
  ) {
    reasons.push('展现增长≥100%');
  }
  if (
    isNew &&
    position <= cfg.NEW_QUERY_MAX_POSITION &&
    impressions >= cfg.NEW_QUERY_MIN_IMPRESSIONS
  ) {
    reasons.push('新Query进入Top10');
  }

  return {
    isNew: isNew,
    growthRatio: growthRatio,
    triggered: reasons.length > 0,
    reasons: reasons,
    reasonText: reasons.join('；')
  };
}

/**
 * Query × Page 承接判断。不自动改站。
 * Mortal Shell II skip prologue 只按 URL path 兼容，不写死曝光/点击。
 */
function classifyFreshQueryLanding_(query, pages, site) {
  pages = pages || [];
  site = site || {};
  var empty = {
    status: '',
    action: '继续观察',
    pageUrl: '',
    primaryPath: ''
  };
  if (!pages.length) return empty;

  var viewed = [];
  for (var i = 0; i < pages.length; i++) {
    var page = pages[i];
    var pageUrl = page.page || page.pageUrl || '';
    var path = normalizeFreshQueryPath_(pageUrl);
    viewed.push({
      pageUrl: pageUrl,
      path: path,
      impressions: page.impressions || 0,
      clicks: page.clicks || 0,
      isHub: freshQueryIsHubPath_(path, site)
    });
  }
  viewed.sort(function (a, b) {
    return b.impressions - a.impressions;
  });
  var primary = viewed[0];

  // Skip-prologue 新旧页观察必须先于通用“单一内容页=正常承接”。
  var ms2 = classifyMs2SkipPrologueLanding_(query, viewed, site);
  if (ms2) return ms2;

  var contentPages = [];
  for (var c = 0; c < viewed.length; c++) {
    if (!viewed[c].isHub) contentPages.push(viewed[c]);
  }
  var competing = listCompetingFreshContentPages_(contentPages, sumFreshPageImpressions_(viewed));

  if (competing.length >= 2) {
    return {
      status: '可能页面竞争',
      action: '检查页面意图与内链',
      pageUrl: primary.pageUrl,
      primaryPath: primary.path
    };
  }

  var specificIntent = freshQueryHasSpecificIntent_(query, site);
  if (primary.isHub && specificIntent) {
    return {
      status: '可能需要新页',
      action: '研究补新页',
      pageUrl: primary.pageUrl,
      primaryPath: primary.path
    };
  }

  var related = freshQueryIsRelatedGuide_(query, primary.path, site);
  return {
    status: '正常承接',
    action: related ? '继续观察' : '研究扩现有页',
    pageUrl: primary.pageUrl,
    primaryPath: primary.path
  };
}

function classifyMs2SkipPrologueLanding_(query, pages, site) {
  if (!isMs2SkipPrologueQuery_(query)) return null;

  var spec = FRESH_QUERY_MS2_SKIP_PROLOGUE;
  var oldPage = null;
  var newPage = null;
  for (var i = 0; i < (pages || []).length; i++) {
    var path = pages[i].path || pages[i].page || pages[i].pageUrl || '';
    if (freshQueryIsConfiguredPath_(path, spec.oldPath)) oldPage = pages[i];
    if (freshQueryIsConfiguredPath_(path, spec.newPath)) newPage = pages[i];
  }

  var queryImpr = sumFreshPageImpressions_(pages);
  var oldSignificant = oldPage && isFreshPageSignificant_(oldPage, queryImpr);
  var newSignificant = newPage && isFreshPageSignificant_(newPage, queryImpr);
  if (oldSignificant && newSignificant) {
    return {
      status: '可能页面竞争',
      action: '检查页面意图与内链',
      pageUrl: (pages[0] && pages[0].pageUrl) || '',
      primaryPath: (pages[0] && pages[0].path) || ''
    };
  }
  if (newPage && (!oldPage || newPage.impressions >= (oldPage.impressions || 0))) {
    return {
      status: '新页已承接',
      action: '继续观察',
      pageUrl: newPage.pageUrl,
      primaryPath: newPage.path
    };
  }
  if (oldPage) {
    // 专门新页存在于配置规则中，不要求它已出现在当前 hourly 行。
    return {
      status: '旧页承接，观察新页切换',
      action: '继续观察',
      pageUrl: oldPage.pageUrl,
      primaryPath: oldPage.path
    };
  }
  return null;
}

function isMs2SkipPrologueQuery_(query) {
  var spec = FRESH_QUERY_MS2_SKIP_PROLOGUE;
  var normalized = normalizeFreshQueryText_(query);
  if (!normalized) return false;
  if (normalized === spec.query) return true;
  var tokens = tokenizeFreshQuery_(normalized);
  var required = spec.intentTokens || ['skip', 'prologue'];
  var found = {};
  for (var i = 0; i < tokens.length; i++) found[tokens[i]] = true;
  for (var r = 0; r < required.length; r++) {
    if (!found[required[r]]) return false;
  }
  return true;
}

function freshQueryIsConfiguredPath_(path, specPath) {
  var a = normalizeFreshQueryPath_(path).toLowerCase();
  var b = normalizeFreshQueryPath_(specPath).toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  var specSegs = b.split('/').filter(function (s) {
    return !!s;
  });
  var slug = specSegs.length ? specSegs[specSegs.length - 1] : '';
  if (!slug) return false;
  var segs = a.split('/').filter(function (s) {
    return !!s;
  });
  return segs.indexOf(slug) >= 0;
}

function listCompetingFreshContentPages_(contentPages, queryImpressions) {
  var out = [];
  for (var i = 0; i < (contentPages || []).length; i++) {
    if (isFreshPageSignificant_(contentPages[i], queryImpressions)) {
      out.push(contentPages[i]);
    }
  }
  return out;
}

function isFreshPageSignificant_(page, queryImpressions) {
  var cfg = FRESH_QUERY_MONITOR_V1;
  var impr = (page && page.impressions) || 0;
  if (impr >= cfg.COMPETING_PAGE_MIN_IMPRESSIONS) return true;
  var share = queryImpressions > 0 ? impr / queryImpressions : 0;
  return impr >= 5 && share >= cfg.COMPETING_PAGE_MIN_SHARE;
}

function sumFreshPageImpressions_(pages) {
  var sum = 0;
  for (var i = 0; i < (pages || []).length; i++) {
    sum += pages[i].impressions || 0;
  }
  return sum;
}

function freshQueryIsHubPath_(pagePath, site) {
  if (typeof isOpportunityHubPath_ === 'function') {
    return isOpportunityHubPath_(pagePath, site);
  }
  var path = normalizeFreshQueryPath_(pagePath);
  if (!path || path === '/') return true;
  var segments = path.split('/').filter(function (s) {
    return !!s;
  });
  if (segments.length !== 1) return false;
  var slug = segments[0].toLowerCase();
  if (typeof OPPORTUNITY_HUB_SLUGS !== 'undefined' && OPPORTUNITY_HUB_SLUGS[slug]) {
    return true;
  }
  if (site && site.propertyUrl) {
    try {
      var host = new URL(site.propertyUrl).hostname || '';
      if (slug === String(host.split('.')[0] || '').toLowerCase()) return true;
    } catch (e) {
      // ignore
    }
  }
  return false;
}

function freshQueryIsRelatedGuide_(query, pagePath, site) {
  if (typeof isOpportunityRelatedGuidePage_ === 'function') {
    return isOpportunityRelatedGuidePage_(query, pagePath, site);
  }
  if (freshQueryIsHubPath_(pagePath, site)) return false;
  var path = normalizeFreshQueryPath_(pagePath);
  var pathTokens = tokenizeFreshQuery_(path.replace(/[\/\-_]+/g, ' '));
  var residual = freshQueryResidualTokens_(query, site);
  if (!pathTokens.length || !residual.length) return false;
  for (var i = 0; i < residual.length; i++) {
    for (var j = 0; j < pathTokens.length; j++) {
      if (residual[i] === pathTokens[j]) return true;
    }
  }
  return false;
}

function freshQueryHasSpecificIntent_(query, site) {
  return freshQueryResidualTokens_(query, site).length > 0;
}

function freshQueryResidualTokens_(query, site) {
  var qTokens = tokenizeFreshQuery_(query);
  var brand = {};
  if (typeof getBrandTokenSet_ === 'function') {
    brand = getBrandTokenSet_(site) || {};
  } else {
    brand = freshQueryBrandTokenSet_(site);
  }
  var residual = [];
  for (var i = 0; i < qTokens.length; i++) {
    if (!brand[qTokens[i]]) residual.push(qTokens[i]);
  }
  return residual;
}

function freshQueryBrandTokenSet_(site) {
  var set = {};
  var chunks = [];
  if (site && site.name) chunks.push(site.name);
  if (site && site.propertyUrl) {
    try {
      var host = new URL(site.propertyUrl).hostname || '';
      chunks.push(host.split('.')[0] || '');
    } catch (e) {
      // ignore
    }
  }
  for (var i = 0; i < chunks.length; i++) {
    var toks = tokenizeFreshQuery_(chunks[i]);
    for (var t = 0; t < toks.length; t++) set[toks[t]] = true;
  }
  return set;
}

function tokenizeFreshQuery_(text) {
  if (typeof tokenizeBrand_ === 'function') return tokenizeBrand_(text);
  var raw = String(text || '').toLowerCase().split(/[^a-z0-9]+/);
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var tok = raw[i];
    if (!tok || tok.length < 2) continue;
    if (/^\d+$/.test(tok)) continue;
    out.push(tok);
  }
  return out;
}

function normalizeFreshQueryText_(q) {
  return String(q || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFreshQueryPath_(pagePath) {
  if (typeof normalizeOpportunityPath_ === 'function') {
    return normalizeOpportunityPath_(pagePath);
  }
  var p = String(pagePath || '').trim();
  if (!p) return '';
  if (typeof pagePathFromUrl_ === 'function' && p.indexOf('://') >= 0) {
    p = pagePathFromUrl_(p);
  } else if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname || '/';
    } catch (e) {
      // keep raw
    }
  }
  if (p.charAt(0) !== '/') p = '/' + p;
  if (p.length > 1 && p.charAt(p.length - 1) === '/') {
    p = p.substring(0, p.length - 1);
  }
  return p || '/';
}

function buildFreshQueryMonitorSheetRow_(item) {
  return [
    item.generatedAt || '',
    item.siteName || '',
    item.query || '',
    item.pageUrl || '',
    item.clicks24h || 0,
    item.impressions24h || 0,
    item.ctr24h || 0,
    item.avgPosition || 0,
    item.clicksPrev24h || 0,
    item.impressionsPrev24h || 0,
    item.clickGrowthRatio === null || item.clickGrowthRatio === undefined ? '' : item.clickGrowthRatio,
    item.growthRatio === null || item.growthRatio === undefined ? '' : item.growthRatio,
    item.isNew ? '是' : '否',
    item.triggered ? '是' : '否',
    item.reasonText || '',
    item.landingStatus || '',
    item.suggestedAction || '',
    item.incomplete ? '是' : '否',
    item.cutoffHour || '',
    item.propertySource || ''
  ];
}

function compareFreshQueryMonitorRows_(a, b) {
  var ia = Number(a[5] || 0);
  var ib = Number(b[5] || 0);
  if (ib !== ia) return ib - ia;
  var sa = String(a[1] || '');
  var sb = String(b[1] || '');
  if (sa !== sb) return sa < sb ? -1 : 1;
  var qa = String(a[2] || '');
  var qb = String(b[2] || '');
  if (qa === qb) return 0;
  return qa < qb ? -1 : 1;
}

function compareFreshSiteMonitorRows_(a, b) {
  return String(a[1] || '') < String(b[1] || '') ? -1 : 1;
}

function compareFreshPageMonitorRows_(a, b) {
  var ai = Number(a[5] || 0);
  var bi = Number(b[5] || 0);
  if (bi !== ai) return bi - ai;
  return String(a[2] || '') < String(b[2] || '') ? -1 : 1;
}

/**
 * 每次运行覆盖当前监控结果，不无限追加同一 Query。
 */
function writeFreshQueryMonitorRows_(rows) {
  writeFreshRealtimeSnapshotRows_(
    SHEET_NAMES.FRESH_QUERY_MONITOR,
    FRESH_QUERY_MONITOR_HEADERS,
    rows || [],
    uniqueFreshSitesFromRows_(rows || [])
  );
}

/** Replace only successful Sites; a failed property call never erases its last snapshot. */
function writeFreshRealtimeSnapshotRows_(sheetName, headers, canonicalRows, completedSites) {
  var sheet = ensureSheet_(sheetName, headers);
  var actualHeader = ensureSheetHeaders_(sheet, headers);
  var col = sheetHeaderIndexMap_(actualHeader);
  var existing = sheet.getLastRow() >= 2
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, actualHeader.length).getValues()
    : [];
  var replace = {};
  for (var i = 0; i < (completedSites || []).length; i++) replace[String(completedSites[i] || '')] = true;
  var kept = [];
  for (var r = 0; r < existing.length; r++) {
    var existingSite = String(existing[r][col['站点']] || '').trim();
    if (!replace[existingSite]) kept.push(existing[r]);
  }
  for (var n = 0; n < (canonicalRows || []).length; n++) {
    var source = canonicalRows[n] || [];
    var out = [];
    for (var b = 0; b < actualHeader.length; b++) out.push('');
    for (var h = 0; h < headers.length; h++) {
      if (col[headers[h]] !== undefined) out[col[headers[h]]] = source[h];
    }
    kept.push(out);
  }
  ensureSheetGrid_(sheet, Math.max(1, kept.length + 1), actualHeader.length);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, actualHeader.length).clearContent();
  }
  if (kept.length) sheet.getRange(2, 1, kept.length, actualHeader.length).setValues(kept);
}

function uniqueFreshSitesFromRows_(rows) {
  var out = [];
  var seen = {};
  for (var i = 0; i < (rows || []).length; i++) {
    var site = String(rows[i][1] || '').trim();
    if (site && !seen[site]) { seen[site] = true; out.push(site); }
  }
  return out;
}

function getFreshRealtimePropertyUrls_(site) {
  var raw = String((site && site.realtimePropertyUrls) || '').trim();
  var parts = raw ? raw.split('|') : [site && site.propertyUrl];
  var seen = {};
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var url = String(parts[i] || '').trim();
    if (!url) continue;
    url = normalizePropertyUrlForGsc_(url);
    if (!seen[url]) { seen[url] = true; out.push(url); }
  }
  return out;
}

function tagFreshPropertyRows_(rows, propertyUrl) {
  var out = [];
  for (var i = 0; i < (rows || []).length; i++) {
    var copy = {};
    var keys = Object.keys(rows[i] || {});
    for (var k = 0; k < keys.length; k++) copy[keys[k]] = rows[i][keys[k]];
    copy.propertyUrl = propertyUrl;
    out.push(copy);
  }
  return out;
}

function findFreshHourlyCutoff_(rows) {
  var cutoff = { hour: '', hourMs: 0 };
  for (var i = 0; i < (rows || []).length; i++) {
    var row = rows[i] || {};
    if (Number(row.hourMs || 0) > cutoff.hourMs) {
      cutoff.hourMs = Number(row.hourMs);
      cutoff.hour = String(row.hour || '');
    }
  }
  return cutoff;
}

function aggregateFreshHourlyTotals_(recentRows, previousRows) {
  var current = freshHourlyMetrics_(recentRows);
  var previous = freshHourlyMetrics_(previousRows);
  return {
    clicks24h: current.clicks,
    impressions24h: current.impressions,
    ctr24h: current.impressions > 0 ? current.clicks / current.impressions : 0,
    avgPosition: current.impressions > 0 ? current.positionWeight / current.impressions : 0,
    clicksPrev24h: previous.clicks,
    impressionsPrev24h: previous.impressions,
    clickGrowthRatio: previous.clicks > 0 ? (current.clicks - previous.clicks) / previous.clicks : null,
    impressionGrowthRatio: previous.impressions > 0 ? (current.impressions - previous.impressions) / previous.impressions : null
  };
}

function freshHourlyMetrics_(rows) {
  var out = { clicks: 0, impressions: 0, positionWeight: 0 };
  for (var i = 0; i < (rows || []).length; i++) {
    var row = rows[i] || {};
    var clicks = Number(row.clicks || 0) || 0;
    var impressions = Number(row.impressions || 0) || 0;
    out.clicks += clicks;
    out.impressions += impressions;
    out.positionWeight += (Number(row.position || 0) || 0) * impressions;
  }
  return out;
}

function buildFreshSiteMonitorSheetRow_(item) {
  var m = item.metrics || {};
  return [
    item.generatedAt || '', item.siteName || '',
    m.clicks24h || 0, m.impressions24h || 0, m.ctr24h || 0, m.avgPosition || 0,
    m.clicksPrev24h || 0, m.impressionsPrev24h || 0,
    m.clickGrowthRatio === null || m.clickGrowthRatio === undefined ? '' : m.clickGrowthRatio,
    m.impressionGrowthRatio === null || m.impressionGrowthRatio === undefined ? '' : m.impressionGrowthRatio,
    item.cutoffHour || '', item.incomplete ? '是' : '否', item.propertySource || ''
  ];
}

function buildFreshPageMonitorRows_(hourlyRows, opts) {
  opts = opts || {};
  var windows = splitFreshQueryWindows_(hourlyRows, opts.cutoffHourMs, opts.cutoffHour);
  var byPage = {};
  function add(row, key) {
    var pageKey = String(row.page || '') + '||' + String(row.propertyUrl || '');
    if (!row.page) return;
    if (!byPage[pageKey]) byPage[pageKey] = { page: row.page, propertyUrl: row.propertyUrl || '', current: [], previous: [] };
    byPage[pageKey][key].push(row);
  }
  for (var i = 0; i < windows.recent.length; i++) add(windows.recent[i], 'current');
  for (var j = 0; j < windows.previous.length; j++) add(windows.previous[j], 'previous');
  var rows = [];
  var keys = Object.keys(byPage);
  for (var k = 0; k < keys.length; k++) {
    var page = byPage[keys[k]];
    var current = freshHourlyMetrics_(page.current);
    var previous = freshHourlyMetrics_(page.previous);
    rows.push([
      opts.generatedAt || '', (opts.site && opts.site.name) || '', page.page,
      normalizeFreshQueryPath_(page.page), current.clicks, current.impressions,
      current.impressions > 0 ? current.clicks / current.impressions : 0,
      current.impressions > 0 ? current.positionWeight / current.impressions : 0,
      previous.clicks, previous.impressions,
      previous.impressions > 0 ? (current.impressions - previous.impressions) / previous.impressions : '',
      opts.cutoffHour || '', opts.incomplete ? '是' : '否', page.propertyUrl
    ]);
  }
  rows.sort(compareFreshPageMonitorRows_);
  return { rows: rows.slice(0, 30), all: rows };
}

function buildFreshRealtimeStatusRecord_(site, siteMetrics, queryRows, cutoffHour, incomplete) {
  var guide = 0;
  var top10 = 0;
  var top20 = 0;
  var clusters = {};
  for (var i = 0; i < (queryRows || []).length; i++) {
    var row = queryRows[i];
    var query = String(row[2] || '');
    var position = Number(row[7] || 0) || 0;
    var intent = typeof matchGuideIntentCategories_ === 'function' ? matchGuideIntentCategories_(query, site) : [];
    if (intent.length) {
      guide++;
      for (var t = 0; t < intent.length; t++) clusters[intent[t]] = true;
    }
    if (position > 0 && position <= 10) top10++;
    if (position > 0 && position <= 20) top20++;
  }
  return {
    site: site,
    metrics: siteMetrics,
    guideQueries: guide,
    top10: top10,
    top20: top20,
    intentClusters: Object.keys(clusters).length,
    cutoffHour: cutoffHour || '',
    incomplete: !!incomplete
  };
}

/** Header-addressed update: realtime owns only the additive early-signal fields. */
function updateRealtimeSiteStatusRows_(records, now) {
  if (!records || !records.length) return;
  var sheet = ensureSheet_(SHEET_NAMES.SITE_STATUS, SITE_STATUS_HEADERS);
  var header = ensureSheetHeaders_(sheet, SITE_STATUS_HEADERS);
  var col = sheetHeaderIndexMap_(header);
  var rows = sheet.getLastRow() >= 2
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues()
    : [];
  var bySite = {};
  for (var i = 0; i < rows.length; i++) {
    var siteName = String(rows[i][col.Site] || '').trim();
    if (siteName) bySite[siteName] = i;
  }
  var rules = getDecisionRules_();
  var nowMs = now && now.getTime ? now.getTime() : Date.now();
  for (var r = 0; r < records.length; r++) {
    var record = records[r] || {};
    var name = String(record.site && record.site.name || '').trim();
    if (!name) continue;
    var index = bySite[name];
    if (index === undefined) {
      index = rows.length;
      var blank = [];
      for (var b = 0; b < header.length; b++) blank.push('');
      blank[col.Site] = name;
      rows.push(blank);
      bySite[name] = index;
    }
    var row = rows[index];
    var day = row[col.Day];
    if (day === '' || day === null || day === undefined) day = calcDayNumber_(record.site.day0, toDateStr_(now));
    if (day !== '' && day !== null && day !== undefined) row[col.Day] = day;
    var previousStatus = String(row[col.EarlySignalStatus] || '').trim();
    var previousRank = freshEarlySignalRank_(previousStatus);
    var shouldEvaluate = day !== '' && day !== null && day !== undefined && Number(day) <= Number(rules.EARLY_SIGNAL_MAX_DAY);
    var candidate = shouldEvaluate
      ? classifyFreshEarlySignal_(record, rules)
      : { status: previousStatus || 'NO_SIGNAL', rule: 'outside Early Signal Day window' };
    var resolved = shouldEvaluate
      ? resolveFreshEarlySignalState_(previousStatus, candidate.status, row[col.EarlySignalDowngradeRuns], rules.EARLY_DOWNGRADE_CONFIRM_RUNS)
      : { status: previousStatus || candidate.status, downgradeRuns: Number(row[col.EarlySignalDowngradeRuns] || 0), pendingDowngrade: false };
    var confidence = shouldEvaluate ? classifyFreshEarlySignalConfidence_(record, resolved.status) : String(row[col.EarlySignalConfidence] || '');
    var transition = previousStatus && previousStatus !== resolved.status;
    var upgrade = previousRank !== null && freshEarlySignalRank_(resolved.status) !== null && freshEarlySignalRank_(resolved.status) < previousRank;
    var eventAt = row[col.EarlySignalEventAt];
    if (!previousStatus || transition) {
      var previousEventMs = freshDateMs_(eventAt);
      var cooldownMs = Math.max(0, Number(rules.EARLY_SIGNAL_COOLDOWN_HOURS) || 0) * FRESH_QUERY_HOUR_MS;
      if (!previousEventMs || upgrade || nowMs - previousEventMs >= cooldownMs) eventAt = now;
    }
    var m = record.metrics || {};
    row[col.RealtimeImpressions24H] = m.impressions24h || 0;
    row[col.RealtimeClicks24H] = m.clicks24h || 0;
    row[col.RealtimeGuideQueries] = record.guideQueries || 0;
    row[col.RealtimeTop10Queries] = record.top10 || 0;
    row[col.RealtimeTop20Queries] = record.top20 || 0;
    row[col.RealtimeIntentClusters] = record.intentClusters || 0;
    if (shouldEvaluate) {
      row[col.EarlySignalStatus] = resolved.status;
      row[col.EarlySignalConfidence] = confidence;
      row[col.EarlySignalUpdatedAt] = now;
      row[col.EarlySignalReason] = buildFreshEarlySignalReason_(record, candidate, resolved, confidence);
      row[col.EarlySignalDowngradeRuns] = resolved.downgradeRuns;
      row[col.EarlySignalEventAt] = eventAt || '';
    }
  }
  ensureSheetGrid_(sheet, rows.length + 1, header.length);
  if (rows.length) sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
}

function classifyFreshEarlySignal_(record, rules) {
  var m = record.metrics || {};
  var winner = [];
  if (m.impressions24h >= Number(rules.EARLY_WINNER_MIN_24H_IMPRESSIONS) &&
      m.clicks24h >= Number(rules.EARLY_WINNER_MIN_CLICKS) &&
      record.guideQueries >= Number(rules.EARLY_WINNER_MIN_GUIDE_QUERIES)) winner.push('A');
  if (m.clicks24h >= Math.max(2, Number(rules.EARLY_WINNER_MIN_CLICKS) + 1) &&
      record.top20 >= Number(rules.EARLY_TOP20_MIN_QUERIES) &&
      record.guideQueries >= Number(rules.EARLY_WINNER_MIN_GUIDE_QUERIES)) winner.push('B');
  if (record.top10 >= Number(rules.EARLY_TOP10_MIN_QUERIES) &&
      record.intentClusters >= Number(rules.EARLY_MIN_INTENT_CLUSTERS)) winner.push('C');
  if (winner.length) return { status: 'EARLY_WINNER', rule: 'Rule ' + winner.join('+') };
  var watch = m.impressions24h >= Number(rules.EARLY_WATCH_MIN_IMPRESSIONS) ||
    record.guideQueries >= 1 || record.top20 >= 1 || m.clicks24h >= 1;
  return watch ? { status: 'WATCH', rule: 'WATCH threshold matched' } : { status: 'NO_SIGNAL', rule: 'No early threshold matched' };
}

function classifyFreshEarlySignalConfidence_(record, status) {
  var m = record.metrics || {};
  var broad = record.guideQueries >= 2 && record.intentClusters >= 2;
  var strong = m.impressions24h >= 100 || m.clicks24h >= 2 || record.top10 >= 2;
  if (broad && m.clicks24h >= 1 && (!record.incomplete || strong)) return 'HIGH';
  if (record.incomplete && (broad || m.clicks24h >= 1 || strong)) return 'MEDIUM';
  if (status === 'EARLY_WINNER' && broad && m.clicks24h >= 1) return 'HIGH';
  return 'LOW';
}

function resolveFreshEarlySignalState_(previous, candidate, previousRuns, confirmRuns) {
  var previousRank = freshEarlySignalRank_(previous);
  var candidateRank = freshEarlySignalRank_(candidate);
  if (previousRank === null) return { status: candidate, downgradeRuns: 0, pendingDowngrade: false };
  if (candidateRank <= previousRank) return { status: candidate, downgradeRuns: 0, pendingDowngrade: false };
  var runs = Number(previousRuns || 0) + 1;
  if (runs >= Math.max(1, Number(confirmRuns) || 1)) return { status: candidate, downgradeRuns: 0, pendingDowngrade: false };
  return { status: previous, downgradeRuns: runs, pendingDowngrade: true };
}

function freshEarlySignalRank_(status) {
  var ranks = { EARLY_WINNER: 0, WATCH: 1, NO_SIGNAL: 2 };
  var key = String(status || '').trim();
  return Object.prototype.hasOwnProperty.call(ranks, key) ? ranks[key] : null;
}

function buildFreshEarlySignalReason_(record, candidate, resolved, confidence) {
  var m = record.metrics || {};
  return candidate.rule + '；actual status=' + resolved.status + '；confidence=' + confidence +
    '；24h impressions=' + (m.impressions24h || 0) + ', clicks=' + (m.clicks24h || 0) +
    ', guideQueries=' + (record.guideQueries || 0) + ', top10=' + (record.top10 || 0) +
    ', top20=' + (record.top20 || 0) + ', intentClusters=' + (record.intentClusters || 0) +
    '；DataCutoff=' + (record.cutoffHour || 'n/a') +
    '；DataIncomplete=' + (record.incomplete ? 'TRUE' : 'FALSE') +
    (resolved.pendingDowngrade ? '；downgrade pending ' + resolved.downgradeRuns : '');
}

function freshDateMs_(value) {
  var date = value instanceof Date ? value : new Date(value || 0);
  var ms = date.getTime();
  return isNaN(ms) ? 0 : ms;
}

function logMs2SkipPrologueFresh_(allRows) {
  var target = FRESH_QUERY_MS2_SKIP_PROLOGUE.query;
  for (var i = 0; i < (allRows || []).length; i++) {
    var row = allRows[i];
    if (normalizeFreshQueryText_(row[2]) !== target) continue;
    writeLog_(
      'INFO',
      'Mortal Shell II',
      'skip prologue | page=' +
        row[3] +
        ' | clicks24h=' +
        row[4] +
        ' | impressions24h=' +
        row[5] +
        ' | landing=' +
        row[15] +
        ' | action=' +
        row[16]
    );
    return;
  }
  writeLog_('INFO', 'Mortal Shell II', 'skip prologue 本轮 hourly 未出现');
}

/**
 * 幂等创建每 6 小时 trigger。不要从 createDailyTrigger 自动调用。
 */
function createFreshQueryMonitorTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var existing = [];
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === FRESH_QUERY_MONITOR_HANDLER) {
      existing.push(triggers[i]);
    }
  }
  if (existing.length === 0) {
    ScriptApp.newTrigger(FRESH_QUERY_MONITOR_HANDLER)
      .timeBased()
      .everyHours(FRESH_QUERY_MONITOR_EVERY_HOURS)
      .inTimezone('Asia/Shanghai')
      .create();
    alertUi_('已创建 runFreshQueryMonitor（每 6 小时，时区 Asia/Shanghai）');
    return 'created';
  }
  for (var d = 1; d < existing.length; d++) {
    ScriptApp.deleteTrigger(existing[d]);
  }
  alertUi_('runFreshQueryMonitor trigger 已存在，未重复创建');
  return 'exists';
}

function removeFreshQueryMonitorTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === FRESH_QUERY_MONITOR_HANDLER) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  alertUi_(removed ? '已删除 runFreshQueryMonitor×' + removed : '没有找到实时Query监控自动任务。');
  return removed;
}
