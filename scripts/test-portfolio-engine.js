/**
 * B1 本地自测：Portfolio / Investment Layer（不依赖 SpreadsheetApp）。
 * 运行：node scripts/test-portfolio-engine.js
 *
 * 四个样本用通用 metrics / Query×Page 行构造，不在引擎里写站点名。
 */

var fs = require('fs');
var path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var INVESTMENT_TIER = {
  T0_TEST: 'T0_TEST',
  T1_TRACTION: 'T1_TRACTION',
  T2_WINNER: 'T2_WINNER',
  FROZEN: 'FROZEN'
};

var PORTFOLIO_ACTION = {
  INVEST: 'INVEST',
  HOLD: 'HOLD',
  FREEZE: 'FREEZE'
};

var PORTFOLIO_V1 = {
  TRACTION_MIN_IMPRESSIONS_7D: 30,
  INTENT_BREADTH_MIN: 3,
  FREEZE_MIN_DAY: 21,
  WINNER_LEAD_RATIO: 1.5,
  REVIEW_EVERY_DAYS: 7
};

function normalizeKeyDate_(v) {
  if (!v) return '';
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return '';
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
  var leadsRank = lead.bestPosition > 0 && lead.bestPosition === bestClickedRank;
  if (!leadsImpressions && !leadsRank) return null;
  return lead;
}

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

function pickWinnerIntent_(queries) {
  var counts = {};
  var best = '';
  var bestN = 0;
  for (var i = 0; i < (queries || []).length; i++) {
    var q = String(queries[i] || '').toLowerCase();
    var key = '';
    if (
      q.indexOf('carry over') >= 0 ||
      q.indexOf('progress') >= 0 ||
      q.indexOf('save file') >= 0
    ) {
      key = 'save_progress';
    }
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
    if (counts[key] > bestN) {
      bestN = counts[key];
      best = key;
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
    investmentTier: tier,
    portfolioAction: action,
    winnerPage: winner ? winner.pagePath || winner.pageUrl || '' : '',
    winnerIntent: winner ? pickWinnerIntent_(opts.winnerQueries || []) : '',
    winnerPageClicks7d: winner ? winner.clicks : 0,
    domainScore: scores.domainScore || 0,
    recommendedAction: opts.recommendedAction || ''
  };
}

function pg(date, url, pagePath, clicks, impressions, position) {
  return [date, 'Site', url, pagePath, clicks, impressions, 0, position];
}

function qp(date, query, url, pagePath, clicks, impressions, position) {
  return [date, 'Site', query, url, pagePath, clicks, impressions, 0, position];
}

// --- 1. Mortal Shell II 形态：强 traction + winner，但意图集中 ---
var ms2Metrics = {
  day: 12,
  impressions7d: 420,
  clicks7d: 4,
  guideQueryCount7d: 17,
  intentCategoryCount: 2,
  top20QueryCount: 6
};
var ms2Winner = findWinnerPage_(
  [
    pg(
      '2026-08-16',
      'https://example.test/mortal-shell-ii/beta-progress-carry-over/',
      '/mortal-shell-ii/beta-progress-carry-over/',
      3,
      180,
      8
    ),
    pg(
      '2026-08-16',
      'https://example.test/mortal-shell-ii/',
      '/mortal-shell-ii/',
      1,
      40,
      22
    )
  ],
  '2026-08-10',
  '2026-08-16'
);
var ms2 = buildPortfolioStatus_({
  metrics: ms2Metrics,
  scores: { domainScore: 80 },
  winner: ms2Winner,
  recommendedAction: 'DOMAIN_UPGRADE'
});
assert(ms2.investmentTier === 'T2_WINNER', 'MS2-like tier, got ' + ms2.investmentTier);
assert(ms2.portfolioAction === 'HOLD', 'MS2-like HOLD, got ' + ms2.portfolioAction);
assert(ms2.recommendedAction === 'DOMAIN_UPGRADE', 'SEO action unchanged');
assert(
  ms2.winnerPage === '/mortal-shell-ii/beta-progress-carry-over/',
  'MS2-like winner page'
);
assert(ms2.portfolioAction !== ms2.recommendedAction, 'Portfolio independent of SEO action');

// --- 2. Agefield High 形态：高点击赢家页 + 意图广度足够 ---
var ageMetrics = {
  day: 40,
  impressions7d: 3200,
  clicks7d: 90,
  guideQueryCount7d: 24,
  intentCategoryCount: 6,
  top20QueryCount: 18
};
var ageWinner = findWinnerPage_(
  [
    pg(
      '2026-08-16',
      'https://example.test/classes/',
      '/classes/',
      48,
      900,
      4
    ),
    pg(
      '2026-08-16',
      'https://example.test/guides/',
      '/guides/',
      6,
      120,
      12
    )
  ],
  '2026-08-10',
  '2026-08-16'
);
var age = buildPortfolioStatus_({
  metrics: ageMetrics,
  scores: { domainScore: 88 },
  winner: ageWinner,
  recommendedAction: 'WAIT'
});
assert(age.investmentTier === 'T2_WINNER', 'Agefield-like tier');
assert(age.portfolioAction === 'INVEST', 'Agefield-like INVEST, got ' + age.portfolioAction);
assert(age.winnerPage === '/classes/', 'Agefield-like winner /classes/');
assert(age.recommendedAction === 'WAIT', 'SEO WAIT can coexist with INVEST');

// --- 3. Approximately Up 形态：已有 traction，无真实点击赢家 ---
var approxMetrics = {
  day: 9,
  impressions7d: 85,
  clicks7d: 0,
  guideQueryCount7d: 1,
  intentCategoryCount: 1,
  top20QueryCount: 2
};
var approxWinner = findWinnerPage_(
  [
    pg(
      '2026-08-16',
      'https://example.test/approximately-up/',
      '/approximately-up/',
      0,
      70,
      18
    ),
    pg(
      '2026-08-16',
      'https://example.test/approximately-up/release-date/',
      '/approximately-up/release-date/',
      0,
      20,
      28
    )
  ],
  '2026-08-10',
  '2026-08-16'
);
assert(approxWinner === null, 'impression-only pages are not winners');
var approx = buildPortfolioStatus_({
  metrics: approxMetrics,
  scores: { domainScore: 20 },
  winner: approxWinner,
  recommendedAction: 'CONTENT_OPTIMIZE'
});
assert(approx.investmentTier === 'T1_TRACTION', 'Approx-like tier, got ' + approx.investmentTier);
assert(approx.portfolioAction === 'HOLD', 'Approx-like HOLD');
assert(approx.winnerPage === '', 'Approx-like no winner page');

// --- 4. Agent 64 形态：无数据 ---
var agentMetrics = {
  day: '',
  impressions7d: 0,
  clicks7d: 0,
  guideQueryCount7d: 0,
  intentCategoryCount: 0,
  top20QueryCount: 0
};
var agentWinner = findWinnerPage_([], '2026-08-10', '2026-08-16');
assert(agentWinner === null, 'empty query pages → no winner');
var agent = buildPortfolioStatus_({
  metrics: agentMetrics,
  scores: { domainScore: 0 },
  winner: agentWinner,
  recommendedAction: 'WAIT'
});
assert(agent.investmentTier === 'T0_TEST', 'no-data tier, got ' + agent.investmentTier);
assert(agent.portfolioAction === 'HOLD', 'no-data HOLD not FREEZE');
assert(agent.winnerPage === '', 'no-data must not be winner');

// 无数据但 Day 已过冻结线 → FROZEN / FREEZE
var frozen = buildPortfolioStatus_({
  metrics: {
    day: 30,
    impressions7d: 0,
    clicks7d: 0,
    guideQueryCount7d: 0,
    intentCategoryCount: 0,
    top20QueryCount: 0
  },
  winner: null
});
assert(frozen.investmentTier === 'FROZEN', 'long no-data freezes');
assert(frozen.portfolioAction === 'FREEZE', 'FROZEN → FREEZE');

// 点击并列且曝光不够领先 → 不判赢家
var split = findWinnerPage_(
  [
    pg('2026-08-16', 'https://example.test/a/', '/a/', 2, 50, 10),
    pg('2026-08-16', 'https://example.test/b/', '/b/', 2, 48, 11)
  ],
  '2026-08-10',
  '2026-08-16'
);
assert(split === null, 'tied clicks without 1.5x impression lead is not a winner');

// --- Scene A: site clicks exist, Query×Page empty, Page明细 has winner ---
var sceneAWinner = findWinnerPage_(
  [
    pg('2026-08-16', 'https://example.test/guide-page/', '/guide-page/', 12, 200, 6),
    pg('2026-08-16', 'https://example.test/', '/', 0, 40, 18)
  ],
  '2026-08-10',
  '2026-08-16'
);
assert(sceneAWinner && sceneAWinner.pagePath === '/guide-page/', 'scene A winner page');
var sceneAQueries = collectWinnerQueries_([], sceneAWinner, '2026-08-10', '2026-08-16');
assert(sceneAQueries.length === 0, 'scene A intent queries empty');
var sceneA = buildPortfolioStatus_({
  metrics: {
    day: 40,
    impressions7d: 280,
    clicks7d: 26,
    guideQueryCount7d: 0,
    intentCategoryCount: 0,
    top20QueryCount: 3
  },
  scores: { domainScore: 70 },
  winner: sceneAWinner,
  winnerQueries: sceneAQueries,
  recommendedAction: 'WAIT'
});
assert(sceneA.investmentTier === 'T2_WINNER', 'scene A T2_WINNER, got ' + sceneA.investmentTier);
assert(sceneA.winnerPage === '/guide-page/', 'scene A winner path');
assert(sceneA.winnerIntent === '', 'scene A WinnerIntent may be empty');
assert(sceneA.portfolioAction === 'HOLD', 'scene A HOLD without intent breadth');
assert(sceneA.recommendedAction === 'WAIT', 'scene A SEO action independent');

// --- Scene B: Page明细 no clicks, Query×Page has impressions ---
var sceneBWinner = findWinnerPage_(
  [pg('2026-08-16', 'https://example.test/x/', '/x/', 0, 90, 11)],
  '2026-08-10',
  '2026-08-16'
);
assert(sceneBWinner === null, 'scene B page-only without clicks is not a winner');
var sceneB = buildPortfolioStatus_({
  metrics: {
    day: 10,
    impressions7d: 90,
    clicks7d: 0,
    guideQueryCount7d: 1,
    intentCategoryCount: 1,
    top20QueryCount: 1
  },
  winner: sceneBWinner,
  winnerQueries: collectWinnerQueries_(
    [
      qp(
        '2026-08-16',
        'example wiki',
        'https://example.test/x/',
        '/x/',
        0,
        90,
        11
      )
    ],
    sceneBWinner,
    '2026-08-10',
    '2026-08-16'
  )
});
assert(sceneB.investmentTier !== 'T2_WINNER', 'scene B must not be winner');
assert(sceneB.winnerPage === '', 'scene B no winner page');

// --- Scene C: Page明细 winner A, Query×Page has save_progress on A ---
var sceneCWinner = findWinnerPage_(
  [
    pg(
      '2026-08-16',
      'https://example.test/beta-progress-carry-over/',
      '/beta-progress-carry-over/',
      1,
      226,
      9
    )
  ],
  '2026-08-10',
  '2026-08-16'
);
var sceneCQueries = collectWinnerQueries_(
  [
    qp(
      '2026-08-16',
      'game beta progress carry over',
      'https://example.test/beta-progress-carry-over/',
      '/beta-progress-carry-over/',
      0,
      80,
      9
    )
  ],
  sceneCWinner,
  '2026-08-10',
  '2026-08-16'
);
assert(sceneCQueries.length === 1, 'scene C collected winner queries');
var sceneC = buildPortfolioStatus_({
  metrics: {
    day: 12,
    impressions7d: 226,
    clicks7d: 1,
    guideQueryCount7d: 1,
    intentCategoryCount: 1,
    top20QueryCount: 1
  },
  winner: sceneCWinner,
  winnerQueries: sceneCQueries,
  recommendedAction: 'DOMAIN_UPGRADE'
});
assert(sceneC.investmentTier === 'T2_WINNER', 'scene C T2');
assert(sceneC.winnerPage === '/beta-progress-carry-over/', 'scene C winner page');
assert(sceneC.winnerIntent === 'save_progress', 'scene C WinnerIntent');
assert(sceneC.recommendedAction === 'DOMAIN_UPGRADE', 'scene C SEO independent');
assert(sceneC.portfolioAction === 'HOLD', 'scene C HOLD when intent breadth < 3');

// --- Scene D: Page明细 winner A, Query×Page only has page B ---
var sceneDWinner = findWinnerPage_(
  [pg('2026-08-16', 'https://example.test/a/', '/a/', 5, 100, 7)],
  '2026-08-10',
  '2026-08-16'
);
var sceneDQueries = collectWinnerQueries_(
  [
    qp(
      '2026-08-16',
      'game beta progress carry over',
      'https://example.test/b/',
      '/b/',
      1,
      50,
      8
    )
  ],
  sceneDWinner,
  '2026-08-10',
  '2026-08-16'
);
assert(sceneDQueries.length === 0, 'scene D Query×Page for other page ignored');
var sceneD = buildPortfolioStatus_({
  metrics: {
    day: 20,
    impressions7d: 100,
    clicks7d: 5,
    guideQueryCount7d: 2,
    intentCategoryCount: 2,
    top20QueryCount: 2
  },
  winner: sceneDWinner,
  winnerQueries: sceneDQueries
});
assert(sceneD.winnerPage === '/a/', 'scene D keeps page A winner');
assert(sceneD.winnerIntent === '', 'scene D intent empty');
assert(sceneD.investmentTier === 'T2_WINNER', 'scene D still T2_WINNER');

// Source wiring
var root = path.join(__dirname, '..');
var engineSrc = fs.readFileSync(path.join(root, 'PortfolioEngine.gs'), 'utf8');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');

assert(/function classifyInvestmentTier_/.test(engineSrc), 'classifyInvestmentTier_');
assert(/function recommendPortfolioAction_/.test(engineSrc), 'recommendPortfolioAction_');
assert(/function findWinnerPage_/.test(engineSrc), 'findWinnerPage_');
assert(/function collectWinnerQueries_/.test(engineSrc), 'collectWinnerQueries_');
assert(/loadPageRowsBySite_/.test(engineSrc), 'portfolio loads Page明细');
assert(/findWinnerPage_\(\s*pageBySite/.test(engineSrc), 'winner uses page rows');
assert(/pickWinnerIntent_\(opts\.winnerQueries/.test(engineSrc), 'intent from Query×Page after winner');
assert(/SHEET_NAMES\.PAGES/.test(configSrc), 'SHEET_NAMES.PAGES');
assert(
  /SHEET_NAMES\.PAGES/.test(configSrc.match(/var SHEET_UI_ORDER = \[[\s\S]*?\];/)[0]),
  'Page明细 in UI order'
);
assert(/ensureSheet_\(SHEET_NAMES\.PAGES/.test(sheetSrc), 'setup creates Page明细');
assert(/补采14天Page明细/.test(codeSrc), 'page backfill menu');
assert(/function buildPortfolioStatus_/.test(engineSrc), 'buildPortfolioStatus_');
assert(/SHEET_NAMES\.PORTFOLIO/.test(configSrc), 'SHEET_NAMES.PORTFOLIO');
assert(/T3_BUSINESS|T4_SCALE/.test(engineSrc) === false, 'no T3/T4');
assert(/recommendedAction/.test(engineSrc) === false, 'engine must not read RecommendedAction');
assert(!/refreshTodayActions_/.test(engineSrc), 'must not write 今日行动');
assert(!/function decideRecommendedAction_/.test(engineSrc), 'must not reimplement SEO decision');
assert(/ensureSheet_\(SHEET_NAMES\.PORTFOLIO/.test(sheetSrc), 'setup creates 站点经营');
assert(/SHEET_NAMES\.PORTFOLIO/.test(configSrc.match(/var SHEET_UI_ORDER = \[[\s\S]*?\];/)[0]), 'ui order');
assert(/try \{\s*runPortfolioEngine\(\);/.test(decisionSrc), 'decision run hooks portfolio');
assert(/重建站点经营/.test(codeSrc), 'menu item');
assert(/人工经营决定/.test(configSrc.match(/var PORTFOLIO_HEADERS = \[[\s\S]*?\];/)[0]), 'manual col');

console.log('PASS scripts/test-portfolio-engine.js');
console.log(
  JSON.stringify(
    {
      ms2: ms2,
      agefield: age,
      approx: approx,
      agent64: agent,
      frozenLongNoData: frozen
    },
    null,
    2
  )
);
