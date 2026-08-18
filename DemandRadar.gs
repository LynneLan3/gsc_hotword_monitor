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
  if (typeof normalizeOpportunityPath_ === 'function') {
    if (fromUrl) {
      var urlKey = normalizeOpportunityPath_(fromUrl);
      if (urlKey) return urlKey;
    }
    if (fromPath) return normalizeOpportunityPath_(fromPath);
    return '';
  }
  return normalizeBlindSpotPathFallback_(fromUrl || fromPath);
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
