/**
 * Query Blind Spot Detector（R0）
 *
 * Page明细（page-only Performance）vs Query页面明细（可见 Query×Page）。
 * 只产出 QUERY_BLIND_SPOT 事实信号，不创建内容机会 / Research / 今日行动，
 * 不改 Decision Engine / Portfolio / DomainScore / GSC 原始口径。
 */

/**
 * 纯计算入口：按站点聚合 Page vs 可见 Query×Page，返回 Blind Spot 结果。
 * 默认只返回 isBlindSpot=true 的页面；opts.includeNonMatches=true 时返回窗口内有流量的全部页面。
 *
 * @param {Object} opts
 * @param {string=} opts.site
 * @param {Array<Array>=} opts.pageRows Page明细行：DataDate, Site, PageURL, PagePath, Clicks, Impressions, ...
 * @param {Array<Array>=} opts.queryPageRows Query页面明细行：DataDate, Site, Query, PageURL, PagePath, Clicks, Impressions, ...
 * @param {Array<Array>=} opts.dailyRows GSC日数据（用于复用 DecisionDataDate）
 * @param {Array<Array>=} opts.queryRows Query明细（用于复用 DecisionDataDate；不用于页面归属）
 * @param {string=} opts.decisionDataDate
 * @param {string=} opts.dataEndDate 窗口终点；优先于自动推断
 * @param {boolean=} opts.queryPageCollectionOk 明确为 false 时跳过，避免把采集失败当成 privacy
 * @param {string=} opts.snapshotStatus
 * @param {string=} opts.snapshotError
 * @param {boolean=} opts.includeNonMatches
 * @return {Array<Object>}
 */
function detectQueryBlindSpots_(opts) {
  opts = opts || {};
  if (shouldSkipBlindSpotSite_(opts)) return [];

  var pageRows = opts.pageRows || [];
  var queryPageRows = opts.queryPageRows || [];
  var site = String(opts.site || '').trim();
  var dataEndDate = resolveBlindSpotDataEndDate_(opts);
  if (!dataEndDate) return [];

  var startDate = blindSpotWindowStart_(dataEndDate);
  if (!startDate) return [];

  var aggregated = aggregateBlindSpotPages_(
    pageRows,
    queryPageRows,
    site,
    startDate,
    dataEndDate
  );
  var out = [];
  var keys = Object.keys(aggregated);
  for (var i = 0; i < keys.length; i++) {
    var page = aggregated[keys[i]];
    var result = evaluateQueryBlindSpot_({
      site: site || page.site || '',
      pageUrl: page.pageUrl,
      pagePath: page.pagePath,
      dataEndDate: dataEndDate,
      pageClicks7D: page.pageClicks7D,
      pageImpressions7D: page.pageImpressions7D,
      visibleQueryClicks7D: page.visibleQueryClicks7D,
      visibleQueryImpressions7D: page.visibleQueryImpressions7D
    });
    if (result.isBlindSpot || opts.includeNonMatches) out.push(result);
  }
  return out;
}

/**
 * 单页判定（已聚合指标）。供测试与 Detector 共用。
 * @param {Object} input
 * @return {Object}
 */
function evaluateQueryBlindSpot_(input) {
  input = input || {};
  var cfg = QUERY_BLIND_SPOT_V1;
  var pageClicks = blindSpotNum_(input.pageClicks7D);
  var pageImpr = blindSpotNum_(input.pageImpressions7D);
  var visClicks = blindSpotNum_(input.visibleQueryClicks7D);
  var visImpr = blindSpotNum_(input.visibleQueryImpressions7D);
  var clickCoverage = blindSpotCoverage_(visClicks, pageClicks);
  var impressionCoverage = blindSpotCoverage_(visImpr, pageImpr);

  var clickPath =
    pageClicks >= cfg.MIN_PAGE_CLICKS_7D && clickCoverage < cfg.MAX_QUERY_COVERAGE;
  var impressionPath =
    pageClicks < cfg.MIN_PAGE_CLICKS_7D &&
    pageImpr >= cfg.MIN_PAGE_IMPRESSIONS_7D &&
    impressionCoverage < cfg.MAX_QUERY_COVERAGE;
  var isBlindSpot = !!(clickPath || impressionPath);

  return {
    site: String(input.site || '').trim(),
    pageUrl: String(input.pageUrl || '').trim(),
    pagePath: String(input.pagePath || '').trim(),
    dataEndDate: String(input.dataEndDate || '').trim(),
    pageClicks7D: pageClicks,
    pageImpressions7D: pageImpr,
    visibleQueryClicks7D: visClicks,
    visibleQueryImpressions7D: visImpr,
    queryClickCoverage: clickCoverage,
    queryImpressionCoverage: impressionCoverage,
    triggerType: isBlindSpot ? QUERY_BLIND_SPOT_TRIGGER : '',
    triggerReason: isBlindSpot
      ? buildBlindSpotReason_({
          pageClicks7D: pageClicks,
          pageImpressions7D: pageImpr,
          visibleQueryClicks7D: visClicks,
          visibleQueryImpressions7D: visImpr,
          queryClickCoverage: clickCoverage,
          queryImpressionCoverage: impressionCoverage
        }, clickPath, impressionPath)
      : '',
    isBlindSpot: isBlindSpot
  };
}

/**
 * 窗口终点：优先 dataEndDate / DecisionDataDate；
 * 否则复用 resolveDecisionDataDate_(Daily, Query)；
 * 再与 Page明细 latest 取较早者，避免混入尚未落表的截面。
 * 不使用 RunDate / 当前自然日 / GSC 24H preliminary。
 */
function resolveBlindSpotDataEndDate_(opts) {
  opts = opts || {};
  var endDate = blindSpotDataDate_(opts.dataEndDate || '');
  if (!endDate) endDate = blindSpotDataDate_(opts.decisionDataDate || '');
  if (
    !endDate &&
    typeof resolveDecisionDataDate_ === 'function' &&
    opts.dailyRows &&
    opts.queryRows
  ) {
    endDate = resolveDecisionDataDate_(opts.dailyRows, opts.queryRows) || '';
  }
  var latestPage = latestBlindSpotDate_(opts.pageRows || []);
  if (!endDate) endDate = latestPage;
  if (latestPage && endDate && latestPage < endDate) endDate = latestPage;
  return endDate || '';
}

function shouldSkipBlindSpotSite_(opts) {
  opts = opts || {};
  if (opts.queryPageCollectionOk === false) return true;
  var error = String(opts.snapshotError || '');
  if (
    /QUERY_PAGE_FAILED|QUERY_PAGE_PERMISSION|PAGE_FAILED|PAGE_PERMISSION/.test(error)
  ) {
    return true;
  }
  var status = String(opts.snapshotStatus || '');
  if (status.indexOf('需要检查') >= 0 && !(opts.queryPageRows && opts.queryPageRows.length)) {
    return true;
  }
  return false;
}

function aggregateBlindSpotPages_(pageRows, queryPageRows, site, startDate, endDate) {
  var byPage = {};
  var i;
  for (i = 0; i < (pageRows || []).length; i++) {
    var prow = pageRows[i];
    var parsedPage = parseBlindSpotPageRow_(prow, site, startDate, endDate);
    if (!parsedPage) continue;
    var page = byPage[parsedPage.key];
    if (!page) {
      page = {
        key: parsedPage.key,
        site: parsedPage.site,
        pageUrl: parsedPage.pageUrl,
        pagePath: parsedPage.pagePath,
        pageClicks7D: 0,
        pageImpressions7D: 0,
        visibleQueryClicks7D: 0,
        visibleQueryImpressions7D: 0
      };
      byPage[parsedPage.key] = page;
    }
    page.pageClicks7D += parsedPage.clicks;
    page.pageImpressions7D += parsedPage.impressions;
    if (!page.pageUrl && parsedPage.pageUrl) page.pageUrl = parsedPage.pageUrl;
    if (!page.pagePath && parsedPage.pagePath) page.pagePath = parsedPage.pagePath;
  }

  for (i = 0; i < (queryPageRows || []).length; i++) {
    var qrow = queryPageRows[i];
    var parsedQuery = parseBlindSpotQueryPageRow_(qrow, site, startDate, endDate);
    if (!parsedQuery) continue;
    var target = byPage[parsedQuery.key];
    if (!target) continue;
    target.visibleQueryClicks7D += parsedQuery.clicks;
    target.visibleQueryImpressions7D += parsedQuery.impressions;
  }

  return byPage;
}

function parseBlindSpotPageRow_(row, site, startDate, endDate) {
  if (!row) return null;
  var dataDate = blindSpotDataDate_(row[0]);
  if (!dataDate || dataDate < startDate || dataDate > endDate) return null;
  var rowSite = String(row[1] || '').trim();
  if (site && rowSite && rowSite !== site) return null;
  var pageUrl = String(row[2] || '').trim();
  var pagePath = String(row[3] || '').trim();
  var key = blindSpotPageKey_(pageUrl, pagePath);
  if (!key) return null;
  var clicks = blindSpotNum_(row[4]);
  var impressions = blindSpotNum_(row[5]);
  if (clicks === 0 && impressions === 0) return null;
  return {
    key: key,
    site: rowSite || site,
    pageUrl: pageUrl,
    pagePath: pagePath || key,
    clicks: clicks,
    impressions: impressions
  };
}

function parseBlindSpotQueryPageRow_(row, site, startDate, endDate) {
  if (!row) return null;
  var dataDate = blindSpotDataDate_(row[0]);
  if (!dataDate || dataDate < startDate || dataDate > endDate) return null;
  var rowSite = String(row[1] || '').trim();
  if (site && rowSite && rowSite !== site) return null;
  var pageUrl = String(row[3] || '').trim();
  var pagePath = String(row[4] || '').trim();
  var key = blindSpotPageKey_(pageUrl, pagePath);
  if (!key) return null;
  return {
    key: key,
    clicks: blindSpotNum_(row[5]),
    impressions: blindSpotNum_(row[6])
  };
}

/**
 * 与 Content Opportunity 同一套 path 归一：去 query/hash、兼容尾斜杠。
 * 不另写冲突 matcher。
 */
function blindSpotPageKey_(pageUrl, pagePath) {
  var fromUrl = String(pageUrl || '').trim();
  var fromPath = String(pagePath || '').trim();
  var key = canonicalRadarPathname_(fromUrl || fromPath);
  if (key) return key;
  return '';
}

function normalizeBlindSpotPathFallback_(value) {
  var p = String(value || '').trim();
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) {
    if (typeof pagePathFromUrl_ === 'function') p = pagePathFromUrl_(p);
    else {
      var m = /^https?:\/\/[^\/?#]+(\/[^?#]*)?/i.exec(p);
      p = m ? m[1] || '/' : p;
    }
  }
  if (p.charAt(0) !== '/') p = '/' + p;
  var cut = p.length;
  var q = p.indexOf('?');
  var h = p.indexOf('#');
  if (q >= 0 && q < cut) cut = q;
  if (h >= 0 && h < cut) cut = h;
  p = p.substring(0, cut);
  if (p.length > 1 && p.charAt(p.length - 1) === '/') {
    p = p.substring(0, p.length - 1);
  }
  return p || '/';
}

/**
 * Demand Radar 统一 pathname 归一：
 * - absolute http/https URL 只取 pathname
 * - 去 query/hash
 * - 保证 leading slash
 * - canonical trailing slash（root 保持 `/`）
 */
function canonicalRadarPathname_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';

  // 修复历史坏值：`/https://example.com/foo` 先去掉多余前导 `/`
  if (/^\/+https?:\/\//i.test(raw)) {
    raw = raw.replace(/^\/+/, '');
  }

  var path = '';
  var abs = /^https?:\/\//i.test(raw);
  if (abs) {
    if (typeof pagePathFromUrl_ === 'function') {
      path = String(pagePathFromUrl_(raw) || '').trim();
    }
    if (!path || /^https?:\/\//i.test(path)) {
      var m = /^https?:\/\/[^\/?#]+(\/[^?#]*)?/i.exec(raw);
      path = m ? m[1] || '/' : '';
    }
  } else {
    path = raw;
  }

  if (!path) path = '/';
  if (path.charAt(0) !== '/') path = '/' + path;

  var cut = path.length;
  var q = path.indexOf('?');
  var h = path.indexOf('#');
  if (q >= 0 && q < cut) cut = q;
  if (h >= 0 && h < cut) cut = h;
  path = path.substring(0, cut) || '/';

  // 清理双斜杠（保留 root）
  path = path.replace(/\/{2,}/g, '/');

  if (path !== '/' && path.charAt(path.length - 1) !== '/') path += '/';
  return path || '/';
}

function buildBlindSpotReason_(m, clickPath, impressionPath) {
  var clickPct = Math.round((m.queryClickCoverage || 0) * 100);
  var imprPct = Math.round((m.queryImpressionCoverage || 0) * 100);
  if (clickPath) {
    return (
      'Page 7D has ' +
      m.pageClicks7D +
      ' clicks, but visible Query×Page rows explain ' +
      m.visibleQueryClicks7D +
      ' clicks (' +
      clickPct +
      '% coverage).'
    );
  }
  if (impressionPath) {
    return (
      'Page 7D has ' +
      m.pageClicks7D +
      ' clicks / ' +
      m.pageImpressions7D +
      ' impressions, but visible Query×Page rows explain ' +
      m.visibleQueryImpressions7D +
      ' impressions (' +
      imprPct +
      '% coverage).'
    );
  }
  return '';
}

function blindSpotWindowStart_(endDate) {
  var days = (QUERY_BLIND_SPOT_V1 && QUERY_BLIND_SPOT_V1.WINDOW_DAYS) || 7;
  if (typeof addDaysStr_ === 'function') return addDaysStr_(endDate, -(days - 1));
  var s = blindSpotDataDate_(endDate);
  if (!s) return '';
  var p = s.split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + -(days - 1));
  return blindSpotFormatDate_(d);
}

function latestBlindSpotDate_(rows) {
  if (typeof latestDateInRows_ === 'function') return latestDateInRows_(rows || [], 0);
  var latest = '';
  for (var i = 0; i < (rows || []).length; i++) {
    var d = blindSpotDataDate_(rows[i][0]);
    if (d && d > latest) latest = d;
  }
  return latest;
}

function blindSpotDataDate_(v) {
  if (typeof normalizeKeyDate_ === 'function') return normalizeKeyDate_(v);
  if (v && Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return blindSpotFormatDate_(v);
  }
  var s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return '';
}

function blindSpotFormatDate_(d) {
  if (!d || isNaN(d.getTime())) return '';
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return (
    y +
    '-' +
    (m < 10 ? '0' : '') +
    m +
    '-' +
    (day < 10 ? '0' : '') +
    day
  );
}

function blindSpotNum_(v) {
  var n = Number(v || 0);
  return isNaN(n) ? 0 : n;
}

function blindSpotCoverage_(visible, page) {
  var denom = blindSpotNum_(page);
  if (denom <= 0) return 0;
  return blindSpotNum_(visible) / denom;
}

/**
 * 只读调试：从现有 Sheet 计算 Blind Spot，写 Logger，不写任何业务表。
 * 不接 runDaily。可用 clasp run / 编辑器直接运行。
 */
function debugDetectQueryBlindSpots() {
  var sites = getEnabledSites();
  var pageBySite = loadPageRowsBySite_();
  var queryPageBySite = loadQueryPageRowsBySite_();
  var dailyBySite = loadDailyRowsBySite_();
  var queryBySite = loadQueryRowsBySite_();
  var snapshotBySite = loadLatestSnapshotBySite_();
  var all = [];
  var agefieldHits = [];

  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    var snap = snapshotBySite[site.name] || [];
    var spots = detectQueryBlindSpots_({
      site: site.name,
      pageRows: pageBySite[site.name] || [],
      queryPageRows: queryPageBySite[site.name] || [],
      dailyRows: dailyBySite[site.name] || [],
      queryRows: queryBySite[site.name] || [],
      snapshotStatus: snap[17] || '',
      snapshotError: snap[18] || '',
      includeNonMatches: true
    });
    for (var j = 0; j < spots.length; j++) {
      all.push(spots[j]);
      var path = String(spots[j].pagePath || spots[j].pageUrl || '');
      if (
        site.name.indexOf('Agefield') >= 0 &&
        /\/agefield-high-rock-the-school\/classes\/?$/.test(
          normalizeBlindSpotPathFallback_(path)
        )
      ) {
        agefieldHits.push(spots[j]);
      }
    }
  }

  var blindOnly = [];
  for (var b = 0; b < all.length; b++) {
    if (all[b].isBlindSpot) blindOnly.push(all[b]);
  }

  var summary = {
    siteCount: sites.length,
    evaluatedPages: all.length,
    blindSpotCount: blindOnly.length,
    agefieldClasses: agefieldHits,
    blindSpots: blindOnly
  };
  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}

/**
 * 把原始 provider / 别名归一成独立 Source Family 列表。
 * 稳定顺序：GSC → SEARCH → COMMUNITY → VIDEO → SERP → TREND。
 * Reddit + Steam → 只保留一个 COMMUNITY。
 * @param {string|Array=} input
 * @return {string[]}
 */
function normalizeSourceFamilies_(input) {
  var tokens = flattenRadarSourceInput_(input);
  var seen = {};
  for (var i = 0; i < tokens.length; i++) {
    var family = normalizeSourceFamilyToken_(tokens[i]);
    if (!family) continue;
    seen[family] = true;
  }
  var out = [];
  var order = SOURCE_FAMILY_ORDER || [];
  for (var o = 0; o < order.length; o++) {
    if (seen[order[o]]) out.push(order[o]);
  }
  return out;
}

function countIndependentSourceFamilies_(input) {
  return normalizeSourceFamilies_(input).length;
}

function isCrossValidated_(input) {
  return countIndependentSourceFamilies_(input) >= 2;
}

function flattenRadarSourceInput_(input) {
  if (input === null || input === undefined || input === '') return [];
  if (Object.prototype.toString.call(input) === '[object Array]') {
    var out = [];
    for (var i = 0; i < input.length; i++) {
      var nested = flattenRadarSourceInput_(input[i]);
      for (var j = 0; j < nested.length; j++) out.push(nested[j]);
    }
    return out;
  }
  return String(input)
    .split(/[|,]/)
    .map(function (s) {
      return String(s || '').trim();
    })
    .filter(function (s) {
      return !!s;
    });
}

function normalizeSourceFamilyToken_(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  if (SOURCE_FAMILY && SOURCE_FAMILY[s]) return SOURCE_FAMILY[s];
  var aliases = SOURCE_FAMILY_ALIASES || {};
  var lower = s.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (aliases[lower]) return aliases[lower];
  var compact = lower.replace(/[\s×x-]+/g, '');
  if (aliases[compact]) return aliases[compact];
  if (compact === 'querypage' || compact === 'queryxpage') return SOURCE_FAMILY.GSC;
  return '';
}

function radarSiteSlug_(siteName) {
  var name = String(siteName || '').trim();
  if (!name) return '';
  if (typeof RESEARCH_GAME_SLUGS === 'object' && RESEARCH_GAME_SLUGS[name]) {
    return RESEARCH_GAME_SLUGS[name];
  }
  if (typeof slugifyResearch_ === 'function') return slugifyResearch_(name);
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function radarCanonicalPagePath_(pageUrl, pagePath) {
  var p = canonicalRadarPathname_(pageUrl);
  if (!p) p = canonicalRadarPathname_(pagePath);
  return p || '';
}

/**
 * 稳定 RadarID：siteSlug|normalizedPath/|TriggerType
 * /path 与 /path/ 不得生成两条。
 */
function buildRadarId_(siteName, pageUrl, pagePath, triggerType) {
  var slug = radarSiteSlug_(siteName);
  var path = radarCanonicalPagePath_(pageUrl, pagePath);
  var trigger = String(triggerType || QUERY_BLIND_SPOT_TRIGGER || '').trim();
  if (!slug || !path || !trigger) return '';
  return slug + '|' + path + '|' + trigger;
}

function formatRadarSourceFamilies_(families) {
  return normalizeSourceFamilies_(families).join(',');
}

function radarBool_(value) {
  if (value === true || value === 1) return true;
  var s = String(value || '').trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === '1';
}

/**
 * 纯计算：把当日 Blind Spot 检测结果与已有 Radar 行对账。
 * collection failure 时原样返回 existing，不把 ACTIVE 改成 RESOLVED。
 *
 * @param {Array<Array>} existingRows
 * @param {Array<Object>} detections detectQueryBlindSpots_ 结果（仅 isBlindSpot 也会被过滤）
 * @param {Object} opts
 * @return {{rows:Array<Array>, skipped:boolean}}
 */
function reconcileDemandRadarRows_(existingRows, detections, opts) {
  opts = opts || {};
  var existing = [];
  var e;
  for (e = 0; e < (existingRows || []).length; e++) {
    existing.push((existingRows[e] || []).slice());
  }

  if (radarCollectionFailed_(opts)) {
    return { rows: existing, skipped: true };
  }

  var site = String(opts.site || '').trim();
  var runDate = String(opts.runDate || '').trim();
  var nowTs = opts.nowTs || runDate;
  var trigger = QUERY_BLIND_SPOT_TRIGGER;
  var byId = {};
  var order = [];

  for (e = 0; e < existing.length; e++) {
    var row = existing[e];
    var id = String(row[0] || '').trim();
    if (!id) continue;
    if (!byId[id]) order.push(id);
    byId[id] = row;
  }

  var activeIds = {};
  for (var d = 0; d < (detections || []).length; d++) {
    var det = detections[d];
    if (!det || !det.isBlindSpot) continue;
    var detSite = String(det.site || site).trim();
    if (site && detSite && detSite !== site) continue;
    var radarId = buildRadarId_(detSite, det.pageUrl, det.pagePath, trigger);
    if (!radarId) continue;
    activeIds[radarId] = det;
    if (!byId[radarId]) {
      var legacyId = findLegacyRadarIdMatch_(byId, radarId, detSite, trigger);
      if (legacyId) {
        byId = migrateRadarRowKey_(byId, order, legacyId, radarId);
      }
    }
    if (byId[radarId]) {
      byId[radarId] = mergeRadarActiveRow_(byId[radarId], det, {
        site: detSite,
        runDate: runDate,
        nowTs: nowTs,
        dataEndDate: det.dataEndDate || opts.dataEndDate || ''
      });
    } else {
      byId[radarId] = buildRadarRowFromDetection_(det, {
        site: detSite,
        runDate: runDate,
        nowTs: nowTs,
        dataEndDate: det.dataEndDate || opts.dataEndDate || '',
        game: opts.game || detSite
      });
      order.push(radarId);
    }
  }

  for (var i = 0; i < order.length; i++) {
    var keepId = order[i];
    var keep = byId[keepId];
    if (!keep) continue;
    if (site && String(keep[5] || '').trim() !== site) continue;
    if (String(keep[8] || '').trim() !== trigger) continue;
    if (activeIds[keepId]) continue;
    byId[keepId] = markRadarResolvedRow_(keep, runDate, nowTs);
  }

  var out = [];
  for (var k = 0; k < order.length; k++) {
    if (byId[order[k]]) out.push(byId[order[k]]);
  }
  return { rows: out, skipped: false };
}

function findLegacyRadarIdMatch_(byId, canonicalRadarId, site, trigger) {
  var ids = Object.keys(byId || {});
  var targetSite = String(site || '').trim();
  var targetTrigger = String(trigger || '').trim();
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var row = byId[id];
    if (!row) continue;
    var rowSite = String(row[5] || '').trim();
    var rowTrigger = String(row[8] || '').trim();
    if (targetSite && rowSite && rowSite !== targetSite) continue;
    if (targetTrigger && rowTrigger && rowTrigger !== targetTrigger) continue;
    var rowCanonicalId = buildRadarId_(rowSite || targetSite, '', row[7], rowTrigger || targetTrigger);
    if (rowCanonicalId && rowCanonicalId === canonicalRadarId) return id;
  }
  return '';
}

function migrateRadarRowKey_(byId, order, fromId, toId) {
  if (!byId || !fromId || !toId || fromId === toId) return byId;
  if (!byId[fromId]) return byId;
  var row = byId[fromId];
  row[0] = toId;
  row[7] = radarCanonicalPagePath_('', row[7]) || row[7];
  delete byId[fromId];
  byId[toId] = row;
  for (var i = 0; i < (order || []).length; i++) {
    if (order[i] === fromId) {
      order[i] = toId;
      break;
    }
  }
  return byId;
}

function radarCollectionFailed_(opts) {
  opts = opts || {};
  if (opts.collectionFailed === true) return true;
  if (opts.queryPageCollectionOk === false) return true;
  var error = String(opts.snapshotError || opts.logMessage || '');
  if (/QUERY_PAGE_FAILED|QUERY_PAGE_PERMISSION|PAGE_FAILED|PAGE_PERMISSION/.test(error)) {
    return true;
  }
  return shouldSkipBlindSpotSite_(opts);
}

function buildRadarRowFromDetection_(detection, opts) {
  opts = opts || {};
  detection = detection || {};
  var site = String(detection.site || opts.site || '').trim();
  var families = normalizeSourceFamilies_([SOURCE_FAMILY.GSC]);
  var path = radarCanonicalPagePath_(detection.pageUrl, detection.pagePath);
  var row = [
    buildRadarId_(site, detection.pageUrl, detection.pagePath, QUERY_BLIND_SPOT_TRIGGER),
    opts.runDate || '',
    opts.runDate || '',
    opts.runDate || '',
    detection.dataEndDate || opts.dataEndDate || '',
    site,
    opts.game || site,
    path,
    QUERY_BLIND_SPOT_TRIGGER,
    detection.triggerReason || '',
    blindSpotNum_(detection.pageClicks7D),
    blindSpotNum_(detection.pageImpressions7D),
    blindSpotNum_(detection.visibleQueryClicks7D),
    blindSpotNum_(detection.visibleQueryImpressions7D),
    blindSpotCoverage_(detection.visibleQueryClicks7D, detection.pageClicks7D),
    blindSpotCoverage_(detection.visibleQueryImpressions7D, detection.pageImpressions7D),
    formatRadarSourceFamilies_(families),
    families.length,
    false,
    SEARCH_DEMAND_STATUS.UNKNOWN,
    SERP_GAP_STATUS.UNKNOWN,
    OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY,
    RADAR_SIGNAL_STATUS.ACTIVE,
    RADAR_STATUS.DISCOVERED,
    '',
    opts.nowTs || opts.runDate || ''
  ];
  while (row.length < DEMAND_RADAR_HEADERS.length) row.push('');
  return row;
}

function mergeRadarActiveRow_(existingRow, detection, opts) {
  var row = (existingRow || []).slice();
  while (row.length < DEMAND_RADAR_HEADERS.length) row.push('');
  detection = detection || {};
  opts = opts || {};
  var families = normalizeSourceFamilies_(row[16] || [SOURCE_FAMILY.GSC]);
  if (!families.length) families = [SOURCE_FAMILY.GSC];
  row[2] = opts.runDate || row[2];
  row[3] = opts.runDate || row[3];
  row[4] = detection.dataEndDate || opts.dataEndDate || row[4];
  if (detection.pagePath || detection.pageUrl) {
    row[7] = radarCanonicalPagePath_(detection.pageUrl, detection.pagePath) || row[7];
  }
  row[8] = QUERY_BLIND_SPOT_TRIGGER;
  if (detection.triggerReason) row[9] = detection.triggerReason;
  row[10] = blindSpotNum_(detection.pageClicks7D);
  row[11] = blindSpotNum_(detection.pageImpressions7D);
  row[12] = blindSpotNum_(detection.visibleQueryClicks7D);
  row[13] = blindSpotNum_(detection.visibleQueryImpressions7D);
  row[14] = blindSpotCoverage_(detection.visibleQueryClicks7D, detection.pageClicks7D);
  row[15] = blindSpotCoverage_(detection.visibleQueryImpressions7D, detection.pageImpressions7D);
  row[16] = formatRadarSourceFamilies_(families);
  row[17] = families.length;
  row[18] = isCrossValidated_(families);
  if (!String(row[19] || '').trim()) row[19] = SEARCH_DEMAND_STATUS.UNKNOWN;
  if (!String(row[20] || '').trim()) row[20] = SERP_GAP_STATUS.UNKNOWN;
  if (!String(row[21] || '').trim()) row[21] = OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY;
  row[22] = RADAR_SIGNAL_STATUS.ACTIVE;
  if (!String(row[23] || '').trim()) row[23] = RADAR_STATUS.DISCOVERED;
  row[25] = opts.nowTs || opts.runDate || row[25];
  return row;
}

function markRadarResolvedRow_(existingRow, runDate, nowTs) {
  var row = (existingRow || []).slice();
  while (row.length < DEMAND_RADAR_HEADERS.length) row.push('');
  row[3] = runDate || row[3];
  row[22] = RADAR_SIGNAL_STATUS.RESOLVED;
  row[25] = nowTs || runDate || row[25];
  return row;
}

function ensureDemandRadarHeader_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DEMAND_RADAR);
  if (!sheet) return;
  ensureSheetGrid_(sheet, 1, DEMAND_RADAR_HEADERS.length);
  var lastCol = Math.max(sheet.getLastColumn(), DEMAND_RADAR_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var actual = [];
  for (var i = 0; i < DEMAND_RADAR_HEADERS.length; i++) {
    actual.push(String(header[i] || '').trim());
  }
  if (actual.join('|') === DEMAND_RADAR_HEADERS.join('|')) return;
  sheet.getRange(1, 1, 1, DEMAND_RADAR_HEADERS.length).setValues([DEMAND_RADAR_HEADERS]);
  sheet.getRange(1, 1, 1, DEMAND_RADAR_HEADERS.length).setFontWeight('bold');
}

function loadDemandRadarRows_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DEMAND_RADAR);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var range = getSheetDataRange_(sheet, DEMAND_RADAR_HEADERS.length);
  if (!range) return [];
  return range.getValues();
}

/**
 * 菜单 / clasp：只刷新需求雷达，不跑 Decision / Opportunity / Research。
 */
function refreshDemandRadar() {
  setupSheets();
  var sites = getEnabledSites();
  var runDate = todayStr_();
  return refreshDemandRadar_(sites, runDate);
}

/**
 * 在当日 GSC Page / Query / Query×Page 已落表后更新「需求雷达」。
 * 只处理 getEnabledSites()；collection failure 跳过该站并保留上一状态。
 */
function refreshDemandRadar_(sites, runDate) {
  ensureSheet_(SHEET_NAMES.DEMAND_RADAR, DEMAND_RADAR_HEADERS);
  ensureDemandRadarHeader_();

  sites = sites || [];
  runDate = runDate || todayStr_();
  var existing = loadDemandRadarRows_();
  var pageBySite = loadPageRowsBySite_();
  var queryPageBySite = loadQueryPageRowsBySite_();
  var dailyBySite = loadDailyRowsBySite_();
  var queryBySite = loadQueryRowsBySite_();
  var snapshotBySite = loadLatestSnapshotBySite_();
  var failBySite = loadRadarCollectionFailuresBySite_(runDate);

  var rows = existing;
  var skipped = 0;
  var activeCount = 0;
  var nowTs = radarNowTs_();

  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    if (!site || !site.name) continue;
    var snap = snapshotBySite[site.name] || [];
    var snapshotStatus = String(snap[17] || '');
    var snapshotError = String(snap[18] || '');
    var logFail = failBySite[site.name] || '';
    var collectionFailed = !!(
      logFail ||
      /QUERY_PAGE_FAILED|QUERY_PAGE_PERMISSION|PAGE_FAILED|PAGE_PERMISSION/.test(snapshotError)
    );

    var detectOpts = {
      site: site.name,
      pageRows: pageBySite[site.name] || [],
      queryPageRows: queryPageBySite[site.name] || [],
      dailyRows: dailyBySite[site.name] || [],
      queryRows: queryBySite[site.name] || [],
      snapshotStatus: snapshotStatus,
      snapshotError: snapshotError || logFail,
      queryPageCollectionOk: collectionFailed ? false : true,
      collectionFailed: collectionFailed
    };

    var detections = [];
    if (!radarCollectionFailed_(detectOpts)) {
      detections = detectQueryBlindSpots_(detectOpts);
    }

    var result = reconcileDemandRadarRows_(rows, detections, {
      site: site.name,
      game: site.name,
      runDate: runDate,
      nowTs: nowTs,
      snapshotStatus: snapshotStatus,
      snapshotError: snapshotError || logFail,
      queryPageCollectionOk: collectionFailed ? false : true,
      collectionFailed: collectionFailed
    });
    rows = result.rows;
    if (result.skipped) {
      skipped += 1;
      writeLog_(
        'WARN',
        site.name,
        'DEMAND_RADAR_SKIP collection incomplete, keep previous radar state' +
          (logFail ? ' | ' + logFail : '')
      );
    }
  }

  for (var r = 0; r < rows.length; r++) {
    if (String(rows[r][22] || '').trim() === RADAR_SIGNAL_STATUS.ACTIVE) activeCount += 1;
  }

  replaceSheetDataRows_(SHEET_NAMES.DEMAND_RADAR, DEMAND_RADAR_HEADERS, rows);
  var summary =
    'refreshDemandRadar 结束 sites=' +
    sites.length +
    ' rows=' +
    rows.length +
    ' active=' +
    activeCount +
    ' skipped=' +
    skipped;
  writeLog_('INFO', '', summary);
  Logger.log(summary);
  return summary;
}

function radarNowTs_() {
  try {
    return Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    );
  } catch (e) {
    return todayStr_();
  }
}

function loadRadarCollectionFailuresBySite_(runDate) {
  var map = {};
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.LOG);
  if (!sheet || sheet.getLastRow() < 2) return map;
  var range = getSheetDataRange_(sheet, LOG_HEADERS.length);
  if (!range) return map;
  var values = range.getValues();
  var start = Math.max(0, values.length - 300);
  for (var i = start; i < values.length; i++) {
    var site = String(values[i][2] || '').trim();
    if (!site) continue;
    var ts = blindSpotDataDate_(values[i][0]);
    if (runDate && ts && ts !== runDate) continue;
    var msg = String(values[i][3] || '');
    if (/QUERY_PAGE_FAILED|QUERY_PAGE_PERMISSION|PAGE_FAILED|PAGE_PERMISSION/.test(msg)) {
      map[site] = msg;
    }
  }
  return map;
}
