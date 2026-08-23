/**
 * 实时 24h Query 爆量监控（hourly_all 旁路）。
 *
 * 只用于热词发现 / 爆量提醒 / 页面承接观察。
 * 不写 GSC日数据 / Query明细 / Query页面明细 / 每日快照 / 站点状态 / 今日行动。
 * 不跑 Decision / Research / Intervention / Effect Evaluation / D7。
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
  ensureSheet_(SHEET_NAMES.FRESH_QUERY_MONITOR, FRESH_QUERY_MONITOR_HEADERS);
  var sites = getEnabledSites();
  var generatedAt = new Date();
  var range = getFreshQueryHourlyDateRange_();
  var allRows = [];
  var intentSnapshots = [];
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
      var siteResult = collectFreshQueryMonitorSite_(site, generatedAt, range);
      for (var r = 0; r < siteResult.triggered.length; r++) allRows.push(siteResult.triggered[r]);
      if (siteResult.intentSnapshot) intentSnapshots.push(siteResult.intentSnapshot);
    } catch (e) {
      errors++;
      writeLog_('ERROR', site && site.name, 'Fresh Query 监控失败: ' + e.message);
    }
  }

  allRows.sort(compareFreshQueryMonitorRows_);
  writeFreshQueryMonitorRows_(allRows);
  var intentRecords = [];
  for (var s = 0; s < intentSnapshots.length; s++) {
    var snapshotClusters = intentSnapshots[s].clusters || [];
    for (var c = 0; c < snapshotClusters.length; c++) {
      snapshotClusters[c].site = intentSnapshots[s].site && intentSnapshots[s].site.name || '';
      intentRecords.push(snapshotClusters[c]);
    }
  }
  enqueueIntentResearchJobs_(intentRecords);
  writeIntentOpportunityRows_(buildIntentOpportunityRowsFromSnapshots_(intentSnapshots));

  var summary =
    'runFreshQueryMonitor 完成 | triggered=' +
    allRows.length +
    ' | errors=' +
    errors;
  writeLog_('INFO', '', summary);
  Logger.log(summary);
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
  var packed = fetchHourlyQueryPagesResult_(
    site.propertyUrl,
    range.startDate,
    range.endDate,
    FRESH_HOURLY_ROW_LIMIT
  );
  var pagePacked = fetchHourlyPagesResult_(
    site.propertyUrl,
    range.startDate,
    range.endDate,
    FRESH_HOURLY_ROW_LIMIT
  );
  var built = buildFreshQueryMonitorRows_(packed.rows, {
    site: site,
    generatedAt: generatedAt,
    metadata: packed.metadata,
    pageHourlyRows: pagePacked.rows
  });

  if (site.name === 'Mortal Shell II') {
    logMs2SkipPrologueFresh_(built.all);
  }

  writeLog_(
    'INFO',
    site.name,
    'Fresh hourly | apiRows=' +
      ((packed.rows && packed.rows.length) || 0) +
      ' | pageApiRows=' +
      ((pagePacked.rows && pagePacked.rows.length) || 0) +
      ' | queries=' +
      built.all.length +
      ' | triggered=' +
      built.triggered.length +
      ' | cutoff=' +
      (built.cutoffHour || '') +
      ' | incomplete=' +
      (built.incomplete ? '是' : '否')
  );

  return {
    triggered: built.triggered,
    intentSnapshot: built.intentSnapshot
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
  var windows = splitFreshQueryWindows_(hourlyRows);
  var pageHourlyRows = opts.pageHourlyRows !== undefined ? opts.pageHourlyRows : null;
  var pageWindows = pageHourlyRows === null
    ? windows
    : splitFreshQueryWindows_(pageHourlyRows, windows.maxHourMs);
  var queries = aggregateFreshQueryWindows_(windows.recent, windows.previous);
  var cutoffHour = windows.cutoffHour || '';
  var intentSnapshot = null;
  if (typeof buildIntentOpportunitySnapshot_ === 'function') {
    intentSnapshot = buildIntentOpportunitySnapshot_(windows.recent, {
      site: opts.site || {},
      previousRows: windows.previous,
      pageRows: pageWindows.recent,
      cutoffHour: cutoffHour,
      incomplete: incomplete
    });
  }
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
      impressionsPrev24h: q.impressionsPrev24h,
      growthRatio: burst.growthRatio,
      isNew: burst.isNew,
      triggered: burst.triggered,
      reasonText: burst.reasonText,
      landingStatus: landing.status,
      suggestedAction: landing.action,
      incomplete: incomplete,
      cutoffHour: cutoffHour
    });
    all.push(sheetRow);
    if (burst.triggered) triggered.push(sheetRow);
  }

  return {
    all: all,
    triggered: triggered,
    cutoffHour: cutoffHour,
    incomplete: incomplete,
    intentSnapshot: intentSnapshot
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
function splitFreshQueryWindows_(hourlyRows, forcedMaxHourMs) {
  var empty = { recent: [], previous: [], cutoffHour: '', maxHourMs: 0 };
  if (!hourlyRows || !hourlyRows.length) return empty;

  var forcedMax = Number(forcedMaxHourMs) || 0;
  var maxHourMs = forcedMax;
  var cutoffHour = '';
  for (var i = 0; i < hourlyRows.length; i++) {
    var row = hourlyRows[i];
    if (!row || row.hourMs == null) continue;
    if (!forcedMax && row.hourMs > maxHourMs) {
      maxHourMs = row.hourMs;
      cutoffHour = row.hour || '';
    } else if (forcedMax && row.hourMs === maxHourMs && !cutoffHour) {
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
        impressionsPrev24h: 0,
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
    var pageKey = rec.page;
    if (!q.pages[pageKey]) {
      q.pages[pageKey] = {
        page: rec.page,
        clicks: 0,
        impressions: 0
      };
    }
    q.pages[pageKey].clicks += rec.clicks || 0;
    q.pages[pageKey].impressions += rec.impressions || 0;
  }

  for (var j = 0; j < (previousRows || []).length; j++) {
    var prev = previousRows[j];
    var pq = ensure_(prev.query);
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
      item.pageList.push(item.pages[pageKeys[p]]);
    }
    item.pageList.sort(function (a, b) {
      return (b.impressions || 0) - (a.impressions || 0);
    });
    item.primaryPage = item.pageList[0] || null;
    item.pages = item.pageList;
    out.push(item);
  }

  out.sort(function (a, b) {
    return (b.impressions24h || 0) - (a.impressions24h || 0);
  });
  return out;
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
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname || '/';
    } catch (e) {
      // keep raw
    }
  } else if (typeof pagePathFromUrl_ === 'function' && p.indexOf('://') >= 0) {
    p = pagePathFromUrl_(p);
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
    item.impressionsPrev24h || 0,
    item.growthRatio === null || item.growthRatio === undefined ? '' : item.growthRatio,
    item.isNew ? '是' : '否',
    item.triggered ? '是' : '否',
    item.reasonText || '',
    item.landingStatus || '',
    item.suggestedAction || '',
    item.incomplete ? '是' : '否',
    item.cutoffHour || ''
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

/**
 * 每次运行覆盖当前监控结果，不无限追加同一 Query。
 */
function writeFreshQueryMonitorRows_(rows) {
  var headers = FRESH_QUERY_MONITOR_HEADERS;
  var sheet = ensureSheet_(SHEET_NAMES.FRESH_QUERY_MONITOR, headers);
  var last = sheet.getLastRow();
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, headers.length).clearContent();
  }
  if (!rows || !rows.length) return;
  ensureSheetGrid_(sheet, rows.length + 1, headers.length);
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
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
        row[13] +
        ' | action=' +
        row[14]
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
