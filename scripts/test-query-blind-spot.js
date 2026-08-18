/**
 * R0 本地自测：Query Blind Spot Detector（不依赖 SpreadsheetApp / GSC API）。
 * 运行：node scripts/test-query-blind-spot.js
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var radarSrc = fs.readFileSync(path.join(root, 'DemandRadar.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var opportunitySrc = fs.readFileSync(path.join(root, 'OpportunityEngine.gs'), 'utf8');
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');

assert(/var QUERY_BLIND_SPOT_V1/.test(configSrc), 'QUERY_BLIND_SPOT_V1 in Config');
assert(/QUERY_BLIND_SPOT_TRIGGER\s*=\s*'QUERY_BLIND_SPOT'/.test(configSrc), 'trigger constant');
assert(/function detectQueryBlindSpots_/.test(radarSrc), 'detectQueryBlindSpots_');
assert(/function evaluateQueryBlindSpot_/.test(radarSrc), 'evaluateQueryBlindSpot_');
assert(/normalizeOpportunityPath_/.test(radarSrc), 'reuses Opportunity path matcher');
assert(/SHEET_NAMES\.PAGES|Page明细/.test(radarSrc), 'reads Page明细 conceptually');
assert(!/loadQueryRowsBySite_/.test(radarSrc.split('function debugDetectQueryBlindSpots')[0]),
  'detector compute path must not guess page from Query明细');

assert(
  !/detectQueryBlindSpots_/.test(codeSrc),
  'not wired into Code.gs / runDaily this round'
);
assert(!/runDecisionEngine|runContentOpportunityEngine|runPortfolioEngine/.test(radarSrc),
  'must not call engines');
assert(!/createResearchJob|appendTodayAction|upsertQueryRow_|upsertPageRow_/.test(radarSrc),
  'must not write jobs / GSC raw / 今日行动');

var v1Match = configSrc.match(/var QUERY_BLIND_SPOT_V1\s*=\s*(\{[\s\S]*?\});/);
assert(v1Match, 'cannot parse QUERY_BLIND_SPOT_V1');
var QUERY_BLIND_SPOT_V1 = eval('(' + v1Match[1] + ')');
assert(QUERY_BLIND_SPOT_V1.MIN_PAGE_CLICKS_7D === 3, 'min clicks 3');
assert(QUERY_BLIND_SPOT_V1.MIN_PAGE_IMPRESSIONS_7D === 100, 'min impressions 100');
assert(QUERY_BLIND_SPOT_V1.MAX_QUERY_COVERAGE === 0.5, 'max coverage 0.50');
assert(QUERY_BLIND_SPOT_V1.WINDOW_DAYS === 7, 'window 7');

function pagePathFromUrl_(pageUrl) {
  var raw = String(pageUrl || '').trim();
  if (!raw) return '';
  try {
    var u = new URL(raw);
    return u.pathname || '/';
  } catch (e) {
    return raw;
  }
}

function normalizeOpportunityPath_(pagePath) {
  var p = String(pagePath || '').trim();
  if (!p) return '';
  try {
    if (/^https?:\/\//i.test(p)) p = pagePathFromUrl_(p);
  } catch (e) {}
  if (p.charAt(0) !== '/') p = '/' + p;
  if (p.length > 1 && p.charAt(p.length - 1) === '/') {
    p = p.substring(0, p.length - 1);
  }
  return p || '/';
}

function normalizeKeyDate_(v) {
  if (!v) return '';
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return '';
}

function addDaysStr_(dateStr, delta) {
  var s = normalizeKeyDate_(dateStr);
  if (!s) return '';
  var parts = s.split('-');
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  d.setDate(d.getDate() + Number(delta || 0));
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

function latestDateInRows_(rows, dateCol) {
  var latest = '';
  for (var i = 0; i < (rows || []).length; i++) {
    var d = normalizeKeyDate_(rows[i][dateCol]);
    if (d && d > latest) latest = d;
  }
  return latest;
}

function resolveDecisionDataDate_(dailyRows, queryRows) {
  var latestDaily = latestDateInRows_(dailyRows, 0);
  var latestQuery = latestDateInRows_(queryRows, 0);
  if (!latestDaily || !latestQuery) return '';
  return latestDaily < latestQuery ? latestDaily : latestQuery;
}

var sandbox = {
  QUERY_BLIND_SPOT_V1: QUERY_BLIND_SPOT_V1,
  QUERY_BLIND_SPOT_TRIGGER: 'QUERY_BLIND_SPOT',
  normalizeOpportunityPath_: normalizeOpportunityPath_,
  pagePathFromUrl_: pagePathFromUrl_,
  normalizeKeyDate_: normalizeKeyDate_,
  addDaysStr_: addDaysStr_,
  latestDateInRows_: latestDateInRows_,
  resolveDecisionDataDate_: resolveDecisionDataDate_
};
vm.createContext(sandbox);
vm.runInContext(radarSrc, sandbox);

var AGEFIELD = 'Agefield High: Rock the School';
var CLASSES_URL =
  'https://agefield-high-rock-the-school.vercel.app/agefield-high-rock-the-school/classes/';
var CLASSES_PATH = '/agefield-high-rock-the-school/classes/';

function pageRow_(opts) {
  opts = opts || {};
  return [
    opts.date || '2026-08-10',
    opts.site || AGEFIELD,
    opts.pageUrl || CLASSES_URL,
    opts.pagePath || CLASSES_PATH,
    opts.clicks == null ? 0 : opts.clicks,
    opts.impressions == null ? 0 : opts.impressions,
    0,
    0
  ];
}

function queryPageRow_(opts) {
  opts = opts || {};
  return [
    opts.date || '2026-08-10',
    opts.site || AGEFIELD,
    opts.query || 'agefield high classes',
    opts.pageUrl || CLASSES_URL,
    opts.pagePath || CLASSES_PATH,
    opts.clicks == null ? 0 : opts.clicks,
    opts.impressions == null ? 0 : opts.impressions,
    0,
    0
  ];
}

// --- Case 1: Agefield-shaped real example ---
var case1 = sandbox.evaluateQueryBlindSpot_({
  site: AGEFIELD,
  pageUrl: CLASSES_URL,
  pagePath: CLASSES_PATH,
  dataEndDate: '2026-08-10',
  pageClicks7D: 11,
  pageImpressions7D: 53,
  visibleQueryClicks7D: 0,
  visibleQueryImpressions7D: 0
});
assert(case1.isBlindSpot === true, 'Case1 QUERY_BLIND_SPOT = true');
assert(case1.triggerType === 'QUERY_BLIND_SPOT', 'Case1 trigger type');
assert(case1.queryClickCoverage === 0, 'Case1 click coverage 0');
assert(/11 clicks/.test(case1.triggerReason), 'Case1 reason has 11 clicks');
assert(/0 clicks/.test(case1.triggerReason), 'Case1 reason has 0 visible clicks');

var case1Detect = sandbox.detectQueryBlindSpots_({
  site: AGEFIELD,
  dataEndDate: '2026-08-10',
  pageRows: [pageRow_({ clicks: 11, impressions: 53 })],
  queryPageRows: []
});
assert(case1Detect.length === 1, 'Case1 detect one blind spot');
assert(case1Detect[0].isBlindSpot === true, 'Case1 detect true');
assert(case1Detect[0].visibleQueryClicks7D === 0, 'missing Query×Page rows count as 0');

// --- Case 2: enough Query coverage ---
var case2 = sandbox.evaluateQueryBlindSpot_({
  pageClicks7D: 10,
  pageImpressions7D: 80,
  visibleQueryClicks7D: 8,
  visibleQueryImpressions7D: 60
});
assert(case2.isBlindSpot === false, 'Case2 coverage 80% is not blind');
assert(case2.queryClickCoverage === 0.8, 'Case2 coverage 0.8');
assert(case2.triggerType === '', 'Case2 no trigger type');

var case2Detect = sandbox.detectQueryBlindSpots_({
  site: AGEFIELD,
  dataEndDate: '2026-08-10',
  pageRows: [pageRow_({ clicks: 10, impressions: 80 })],
  queryPageRows: [queryPageRow_({ clicks: 8, impressions: 60 })]
});
assert(case2Detect.length === 0, 'Case2 detect returns no blind spots');

// --- Case 3: impression-only blind spot ---
var case3 = sandbox.evaluateQueryBlindSpot_({
  pageClicks7D: 0,
  pageImpressions7D: 150,
  visibleQueryClicks7D: 0,
  visibleQueryImpressions7D: 20
});
assert(case3.isBlindSpot === true, 'Case3 impression path true');
assert(Math.abs(case3.queryImpressionCoverage - 20 / 150) < 1e-12, 'Case3 impression coverage');
assert(/150 impressions/.test(case3.triggerReason), 'Case3 reason mentions impressions');

// --- Case 4: weak page ---
var case4 = sandbox.evaluateQueryBlindSpot_({
  pageClicks7D: 0,
  pageImpressions7D: 20,
  visibleQueryClicks7D: 0,
  visibleQueryImpressions7D: 0
});
assert(case4.isBlindSpot === false, 'Case4 weak page false');

var case4b = sandbox.evaluateQueryBlindSpot_({
  pageClicks7D: 0,
  pageImpressions7D: 5,
  visibleQueryClicks7D: 0,
  visibleQueryImpressions7D: 0
});
assert(case4b.isBlindSpot === false, 'Case4b 0 clicks / 5 impressions false');

// --- Case 5: exact boundary ---
var case5a = sandbox.evaluateQueryBlindSpot_({
  pageClicks7D: 3,
  pageImpressions7D: 40,
  visibleQueryClicks7D: 1.47,
  visibleQueryImpressions7D: 20
});
assert(Math.abs(case5a.queryClickCoverage - 0.49) < 1e-12, 'Case5a coverage 0.49');
assert(case5a.isBlindSpot === true, 'Case5a coverage 0.49 triggers');

var case5b = sandbox.evaluateQueryBlindSpot_({
  pageClicks7D: 3,
  pageImpressions7D: 40,
  visibleQueryClicks7D: 1.5,
  visibleQueryImpressions7D: 20
});
assert(case5b.queryClickCoverage === 0.5, 'Case5b coverage 0.50');
assert(case5b.isBlindSpot === false, 'Case5b coverage 0.50 does not trigger');

assert(isFinite(sandbox.evaluateQueryBlindSpot_({
  pageClicks7D: 0,
  pageImpressions7D: 0,
  visibleQueryClicks7D: 0,
  visibleQueryImpressions7D: 0
}).queryClickCoverage), 'zero denom is finite');
assert(!isNaN(sandbox.evaluateQueryBlindSpot_({
  pageClicks7D: 0,
  pageImpressions7D: 0,
  visibleQueryClicks7D: 1,
  visibleQueryImpressions7D: 1
}).queryImpressionCoverage), 'zero denom is not NaN');

// --- Case 6: trailing slash URL match ---
var slashPage =
  'https://agefield-high-rock-the-school.vercel.app/agefield-high-rock-the-school/classes';
var slashQuery =
  'https://agefield-high-rock-the-school.vercel.app/agefield-high-rock-the-school/classes/';
var case6 = sandbox.detectQueryBlindSpots_({
  site: AGEFIELD,
  dataEndDate: '2026-08-10',
  includeNonMatches: true,
  pageRows: [
    pageRow_({
      pageUrl: slashPage,
      pagePath: '/agefield-high-rock-the-school/classes',
      clicks: 10,
      impressions: 80
    })
  ],
  queryPageRows: [
    queryPageRow_({
      pageUrl: slashQuery,
      pagePath: '/agefield-high-rock-the-school/classes/',
      clicks: 8,
      impressions: 60
    })
  ]
});
assert(case6.length === 1, 'Case6 aggregates to one page');
assert(case6[0].pageClicks7D === 10, 'Case6 page clicks');
assert(case6[0].visibleQueryClicks7D === 8, 'Case6 trailing slash still matches');
assert(case6[0].queryClickCoverage === 0.8, 'Case6 coverage 80%');
assert(case6[0].isBlindSpot === false, 'Case6 enough coverage after slash normalize');

// Collection failure must not look like privacy blind spot
var failed = sandbox.detectQueryBlindSpots_({
  site: AGEFIELD,
  dataEndDate: '2026-08-10',
  queryPageCollectionOk: false,
  pageRows: [pageRow_({ clicks: 11, impressions: 53 })],
  queryPageRows: []
});
assert(failed.length === 0, 'collection failure skipped');

// Window uses DecisionDataDate, not a later preliminary page date
var aligned = sandbox.detectQueryBlindSpots_({
  site: AGEFIELD,
  dailyRows: [['2026-08-10', AGEFIELD, 11, 53]],
  queryRows: [['2026-08-10', AGEFIELD, 'q', 1, 10]],
  pageRows: [
    pageRow_({ date: '2026-08-10', clicks: 11, impressions: 53 }),
    pageRow_({ date: '2026-08-16', clicks: 99, impressions: 500 })
  ],
  queryPageRows: []
});
assert(aligned.length === 1, 'aligned window still sees 2026-08-10 page');
assert(aligned[0].dataEndDate === '2026-08-10', 'end date is DecisionDataDate not later page day');
assert(aligned[0].pageClicks7D === 11, 'preliminary later day excluded');

assert(/function runDailyUnlocked_/.test(codeSrc), 'runDaily still present');
assert(!/detectQueryBlindSpots_/.test(decisionSrc), 'Decision Engine untouched');
assert(!/QUERY_BLIND_SPOT/.test(opportunitySrc), 'Opportunity Engine untouched');

console.log(
  JSON.stringify(
    {
      case1: { isBlindSpot: case1.isBlindSpot, reason: case1.triggerReason },
      case2: case2.isBlindSpot,
      case3: case3.isBlindSpot,
      case4: case4.isBlindSpot,
      case5a: case5a.isBlindSpot,
      case5b: case5b.isBlindSpot,
      case6: case6[0].isBlindSpot
    },
    null,
    2
  )
);
console.log('PASS scripts/test-query-blind-spot.js');
