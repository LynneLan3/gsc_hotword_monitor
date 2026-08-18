/**
 * Portfolio / Investment Layer（B1）
 * 在 Decision Engine 的 SEO 判断之外，给出经营投入判断。
 * Winner Page 读 Page明细；WinnerIntent 读 Query页面明细。
 * 不改 DomainScore；不写「今日行动」。
 */

function ensurePortfolioHeader_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.PORTFOLIO);
  if (!sheet) return;
  ensureSheetGrid_(sheet, 1, PORTFOLIO_HEADERS.length);
  var lastCol = Math.max(sheet.getLastColumn(), PORTFOLIO_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var actual = [];
  for (var i = 0; i < PORTFOLIO_HEADERS.length; i++) {
    actual.push(String(header[i] || '').trim());
  }
  if (actual.join('|') === PORTFOLIO_HEADERS.join('|')) return;
  sheet.getRange(1, 1, 1, PORTFOLIO_HEADERS.length).setValues([PORTFOLIO_HEADERS]);
  sheet.getRange(1, 1, 1, PORTFOLIO_HEADERS.length).setFontWeight('bold');
}

function runPortfolioEngine() {
  ensureSheet_(SHEET_NAMES.PORTFOLIO, PORTFOLIO_HEADERS);
  ensurePortfolioHeader_();

  var runDate = todayStr_();
  writeLog_('INFO', '', 'runPortfolioEngine 开始 runDate=' + runDate);

  var rules = getDecisionRules_();
  var sites = getEnabledSites();
  if (!sites.length) {
    replaceSheetDataRows_(SHEET_NAMES.PORTFOLIO, PORTFOLIO_HEADERS, []);
    writeLog_('INFO', '', 'runPortfolioEngine 结束：无启用站点');
    return;
  }

  var dailyBySite = loadDailyRowsBySite_();
  var queryBySite = loadQueryRowsBySite_();
  var pageBySite = loadPageRowsBySite_();
  var queryPageBySite = loadQueryPageRowsBySite_();
  var snapshotBySite = loadLatestSnapshotBySite_();
  var contentUpdateRows = loadContentUpdateRows_();
  var manualBySite = loadPortfolioManualBySite_();

  var rows = [];
  var summaries = [];
  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    var metrics = buildSiteMetrics_(
      site,
      runDate,
      rules,
      dailyBySite[site.name] || [],
      queryBySite[site.name] || [],
      queryPageBySite[site.name] || [],
      snapshotBySite[site.name] || null
    );
    var scores = computeDomainScores_(metrics, rules);
    var windowStart = metrics.decisionDataDate
      ? addDaysStr_(metrics.decisionDataDate, -6)
      : '';
    var winner = findWinnerPage_(
      pageBySite[site.name] || [],
      windowStart,
      metrics.decisionDataDate
    );
    var winnerQueries = collectWinnerQueries_(
      queryPageBySite[site.name] || [],
      winner,
      windowStart,
      metrics.decisionDataDate
    );
    var status = buildPortfolioStatus_({
      runDate: runDate,
      siteName: site.name,
      site: site,
      metrics: metrics,
      scores: scores,
      winner: winner,
      winnerQueries: winnerQueries,
      lastIntervention: findLatestSiteInterventionDate_(contentUpdateRows, site.name),
      manualDecision: (manualBySite[site.name] || {}).manualDecision || '',
      manualReason: (manualBySite[site.name] || {}).manualReason || '',
      nextReviewDate: addDaysStr_(runDate, PORTFOLIO_V1.REVIEW_EVERY_DAYS)
    });
    rows.push(portfolioStatusRow_(status));
    summaries.push(
      site.name + '→' + status.investmentTier + '/' + status.portfolioAction
    );
  }

  replaceSheetDataRows_(SHEET_NAMES.PORTFOLIO, PORTFOLIO_HEADERS, rows);
  writeLog_('INFO', '', 'runPortfolioEngine 结束 ' + summaries.join(' | '));
}

function loadPortfolioManualBySite_() {
  var map = {};
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.PORTFOLIO);
  var range = getSheetDataRange_(sheet, PORTFOLIO_HEADERS.length);
  if (!range) return map;
  var values = range.getValues();
  var siteCol = 1;
  var decisionCol = 15;
  var reasonCol = 16;
  for (var i = 0; i < values.length; i++) {
    var site = String(values[i][siteCol] || '').trim();
    if (!site) continue;
    map[site] = {
      manualDecision: String(values[i][decisionCol] || '').trim(),
      manualReason: String(values[i][reasonCol] || '').trim()
    };
  }
  return map;
}

function findLatestSiteInterventionDate_(rows, siteName) {
  var latest = '';
  var name = String(siteName || '').trim();
  if (!name) return '';
  for (var i = 0; i < (rows || []).length; i++) {
    if (String(rows[i][1] || '').trim() !== name) continue;
    var d = normalizeKeyDate_(rows[i][0]);
    if (d && d > latest) latest = d;
  }
  return latest;
}

function hasSearchTraction_(metrics) {
  metrics = metrics || {};
  if ((metrics.clicks7d || 0) >= 1) return true;
  if ((metrics.top20QueryCount || 0) >= 1) return true;
  if ((metrics.impressions7d || 0) >= PORTFOLIO_V1.TRACTION_MIN_IMPRESSIONS_7D) return true;
  if ((metrics.guideQueryCount7d || 0) >= 1) return true;
  return false;
}

function classifyInvestmentTier_(metrics, winner) {
  metrics = metrics || {};
  var hasWinner = !!(winner && (winner.pagePath || winner.pageUrl));
  var traction = hasSearchTraction_(metrics);
  var dayNum =
    metrics.day === '' || metrics.day === null || metrics.day === undefined
      ? null
      : Number(metrics.day);
  if (dayNum !== null && isNaN(dayNum)) dayNum = null;

  if (!traction && !hasWinner) {
    if (dayNum !== null && dayNum >= PORTFOLIO_V1.FREEZE_MIN_DAY) {
      return INVESTMENT_TIER.FROZEN;
    }
    return INVESTMENT_TIER.T0_TEST;
  }
  if (hasWinner) return INVESTMENT_TIER.T2_WINNER;
  return INVESTMENT_TIER.T1_TRACTION;
}

function recommendPortfolioAction_(tier, metrics) {
  metrics = metrics || {};
  if (tier === INVESTMENT_TIER.FROZEN) return PORTFOLIO_ACTION.FREEZE;
  if (
    tier === INVESTMENT_TIER.T2_WINNER &&
    (metrics.intentCategoryCount || 0) >= PORTFOLIO_V1.INTENT_BREADTH_MIN
  ) {
    return PORTFOLIO_ACTION.INVEST;
  }
  return PORTFOLIO_ACTION.HOLD;
}

/**
 * 近 7 天按 Page明细聚合。赢家必须有真实点击，且点击领先，
 * 同时在曝光或排名上明显领先。无点击页不能当 Winner。
 * 行格式：DataDate, Site, PageURL, PagePath, Clicks, Impressions, CTR, Position
 */
function findWinnerPage_(pageRows, startDate, endDate) {
  if (!startDate || !endDate || !pageRows || !pageRows.length) return null;

  var byPage = {};
  for (var i = 0; i < pageRows.length; i++) {
    var row = pageRows[i];
    var dataDate = normalizeKeyDate_(row[0]);
    if (!dataDate || dataDate < startDate || dataDate > endDate) continue;
    var pageUrl = String(row[2] || '').trim();
    var pagePath = String(row[3] || '').trim();
    var key = pagePath || pageUrl;
    if (!key) continue;
    var clicks = Number(row[4] || 0);
    var impressions = Number(row[5] || 0);
    var position = Number(row[7] || 0);
    if (isNaN(clicks)) clicks = 0;
    if (isNaN(impressions)) impressions = 0;
    if (isNaN(position)) position = 0;
    if (!byPage[key]) {
      byPage[key] = {
        pagePath: pagePath || key,
        pageUrl: pageUrl,
        clicks: 0,
        impressions: 0,
        bestPosition: 0
      };
    }
    var page = byPage[key];
    page.clicks += clicks;
    page.impressions += impressions;
    if (position > 0 && (page.bestPosition === 0 || position < page.bestPosition)) {
      page.bestPosition = position;
    }
  }

  var pages = [];
  var keys = Object.keys(byPage);
  for (var k = 0; k < keys.length; k++) pages.push(byPage[keys[k]]);
  if (!pages.length) return null;

  pages.sort(function (a, b) {
    if (b.clicks !== a.clicks) return b.clicks - a.clicks;
    if (b.impressions !== a.impressions) return b.impressions - a.impressions;
    var ap = a.bestPosition || 9999;
    var bp = b.bestPosition || 9999;
    return ap - bp;
  });

  var lead = pages[0];
  if (!lead || lead.clicks < 1) return null;

  var second = null;
  for (var s = 1; s < pages.length; s++) {
    if (pages[s].clicks > 0 || pages[s].impressions > 0) {
      second = pages[s];
      break;
    }
  }

  var obvious = true;
  if (second && second.clicks > 0) {
    obvious =
      lead.clicks > second.clicks ||
      (lead.clicks === second.clicks &&
        lead.impressions >= second.impressions * PORTFOLIO_V1.WINNER_LEAD_RATIO);
  }
  if (!obvious) return null;

  var maxImpressions = lead.impressions;
  var bestClickedRank = lead.bestPosition > 0 ? lead.bestPosition : 0;
  for (var j = 0; j < pages.length; j++) {
    if (pages[j].impressions > maxImpressions) maxImpressions = pages[j].impressions;
    if (
      pages[j].clicks >= 1 &&
      pages[j].bestPosition > 0 &&
      (bestClickedRank === 0 || pages[j].bestPosition < bestClickedRank)
    ) {
      bestClickedRank = pages[j].bestPosition;
    }
  }
  var leadsImpressions = lead.impressions > 0 && lead.impressions === maxImpressions;
  var leadsRank =
    lead.bestPosition > 0 && lead.bestPosition === bestClickedRank;
  if (!leadsImpressions && !leadsRank) return null;
  return lead;
}

/**
 * 从 Query页面明细收集赢家页对应 query，供 WinnerIntent。
 * Query×Page 缺失时返回空数组，不取消 Winner。
 * 行格式：DataDate, Site, Query, PageURL, PagePath, Clicks, Impressions, CTR, AveragePosition
 */
function collectWinnerQueries_(queryPageRows, winner, startDate, endDate) {
  if (!winner || !startDate || !endDate || !queryPageRows || !queryPageRows.length) {
    return [];
  }
  var winnerPath = String(winner.pagePath || '').trim();
  var winnerUrl = String(winner.pageUrl || '').trim();
  if (!winnerPath && !winnerUrl) return [];

  var queries = [];
  for (var i = 0; i < queryPageRows.length; i++) {
    var row = queryPageRows[i];
    var dataDate = normalizeKeyDate_(row[0]);
    if (!dataDate || dataDate < startDate || dataDate > endDate) continue;
    var query = String(row[2] || '').trim();
    if (!query) continue;
    var pageUrl = String(row[3] || '').trim();
    var pagePath = String(row[4] || '').trim();
    var pathMatch = winnerPath && pagePath && pagePath === winnerPath;
    var urlMatch = winnerUrl && pageUrl && pageUrl === winnerUrl;
    if (!pathMatch && !urlMatch) continue;
    queries.push(query);
  }
  return queries;
}

function pickWinnerIntent_(queries, site) {
  var counts = {};
  var best = '';
  var bestN = 0;
  for (var i = 0; i < (queries || []).length; i++) {
    var keys = matchGuideIntentCategories_(queries[i], site);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      counts[key] = (counts[key] || 0) + 1;
      if (counts[key] > bestN) {
        bestN = counts[key];
        best = key;
      }
    }
  }
  return best;
}

function buildPortfolioStatus_(opts) {
  opts = opts || {};
  var metrics = opts.metrics || {};
  var scores = opts.scores || {};
  var winner = opts.winner || null;
  var tier = classifyInvestmentTier_(metrics, winner);
  var action = recommendPortfolioAction_(tier, metrics);
  return {
    runDate: opts.runDate || '',
    siteName: opts.siteName || '',
    investmentTier: tier,
    portfolioAction: action,
    winnerPage: winner ? winner.pagePath || winner.pageUrl || '' : '',
    winnerIntent: winner ? pickWinnerIntent_(opts.winnerQueries || [], opts.site) : '',
    winnerPageClicks7d: winner ? winner.clicks : 0,
    winnerPageImpressions7d: winner ? winner.impressions : 0,
    guideQueryCount7d: metrics.guideQueryCount7d || 0,
    intentCategoryCount: metrics.intentCategoryCount || 0,
    clicks7d: metrics.clicks7d || 0,
    impressions7d: metrics.impressions7d || 0,
    top20QueryCount: metrics.top20QueryCount || 0,
    domainScore: scores.domainScore || 0,
    lastIntervention: opts.lastIntervention || '',
    manualDecision: opts.manualDecision || '',
    manualReason: opts.manualReason || '',
    nextReviewDate: opts.nextReviewDate || ''
  };
}

function portfolioStatusRow_(status) {
  status = status || {};
  return [
    status.runDate || '',
    status.siteName || '',
    status.investmentTier || '',
    status.portfolioAction || '',
    status.winnerPage || '',
    status.winnerIntent || '',
    status.winnerPageClicks7d || 0,
    status.winnerPageImpressions7d || 0,
    status.guideQueryCount7d || 0,
    status.intentCategoryCount || 0,
    status.clicks7d || 0,
    status.impressions7d || 0,
    status.top20QueryCount || 0,
    status.domainScore || 0,
    status.lastIntervention || '',
    status.manualDecision || '',
    status.manualReason || '',
    status.nextReviewDate || ''
  ];
}
