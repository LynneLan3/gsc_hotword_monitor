/**
 * M2-2 本地自测：Decision Outcome Observation（不依赖 SpreadsheetApp）。
 * 运行：node scripts/test-decision-outcomes.js
 */

function normalizeKeyDate_(v) {
  if (v instanceof Date) {
    var y = v.getFullYear();
    var m = v.getMonth() + 1;
    var d = v.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }
  return String(v || '').trim().substring(0, 10);
}

function parseDateOnly_(str) {
  var m = String(str || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function addDaysStr_(dateStr, delta) {
  var d = parseDateOnly_(dateStr);
  if (!d) return '';
  d.setDate(d.getDate() + Number(delta || 0));
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

var DECISION_OUTCOME_HORIZONS = [
  { name: 'D7', days: 7 },
  { name: 'D14', days: 14 },
  { name: 'D30', days: 30 }
];

var OBSERVATION_STATUS = {
  PENDING: 'PENDING',
  OBSERVED: 'OBSERVED',
  DATA_MISSING: 'DATA_MISSING'
};

function outcomeHorizonDefs_() {
  return DECISION_OUTCOME_HORIZONS.slice();
}

function computeOutcomeTargetDate_(decisionDataDate, days) {
  var base = normalizeKeyDate_(decisionDataDate);
  if (!base) return '';
  return addDaysStr_(base, Number(days || 0));
}

function computeOutcomeWindow_(targetDate) {
  var end = normalizeKeyDate_(targetDate);
  if (!end) return { start: '', end: '' };
  return { start: addDaysStr_(end, -6), end: end };
}

function isOutcomeDataMature_(latestGscDataDate, targetDate) {
  var latest = normalizeKeyDate_(latestGscDataDate);
  var target = normalizeKeyDate_(targetDate);
  if (!latest || !target) return false;
  return latest >= target;
}

function buildOutcomeKey_(decisionId, horizon) {
  return String(decisionId || '').trim() + '||' + String(horizon || '').trim();
}

function matchGuideIntentCategories_(query, site) {
  var q = String(query || '').toLowerCase();
  if (q.indexOf('wiki') >= 0 || q.indexOf('walkthrough') >= 0) return ['guide'];
  return [];
}

function computeOutcomeQueryStats_(queryRows, startDate, endDate, site) {
  var empty = {
    queryCount: 0,
    guideQueryCount: 0,
    top50: 0,
    top20: 0,
    bestPosition: ''
  };
  if (!startDate || !endDate) return empty;
  var byQuery = {};
  for (var i = 0; i < (queryRows || []).length; i++) {
    var dataDate = normalizeKeyDate_(queryRows[i][0]);
    if (!dataDate || dataDate < startDate || dataDate > endDate) continue;
    var q = String(queryRows[i][2] || '').trim();
    if (!q) continue;
    var position = Number(queryRows[i][6] || 0);
    if (isNaN(position)) position = 0;
    if (!byQuery[q]) {
      byQuery[q] = { bestPosition: position > 0 ? position : 0 };
    } else if (position > 0 && (byQuery[q].bestPosition === 0 || position < byQuery[q].bestPosition)) {
      byQuery[q].bestPosition = position;
    }
  }
  var names = Object.keys(byQuery);
  var guideCount = 0;
  var top50 = 0;
  var top20 = 0;
  var best = '';
  for (var n = 0; n < names.length; n++) {
    var query = names[n];
    var pos = byQuery[query].bestPosition;
    if (pos > 0 && pos <= 50) top50++;
    if (pos > 0 && pos <= 20) top20++;
    if (pos > 0 && (best === '' || pos < best)) best = pos;
    if (matchGuideIntentCategories_(query, site).length) guideCount++;
  }
  return {
    queryCount: names.length,
    guideQueryCount: guideCount,
    top50: top50,
    top20: top20,
    bestPosition: best
  };
}

function getIndexedUrlCountAsOf_(urlIndexRows, siteName, asOfDate) {
  var asOf = normalizeKeyDate_(asOfDate);
  if (!asOf || !siteName) return null;
  var byUrl = {};
  var found = false;
  for (var i = 0; i < (urlIndexRows || []).length; i++) {
    if (String(urlIndexRows[i][1] || '') !== siteName) continue;
    var url = String(urlIndexRows[i][2] || '').trim();
    if (!url) continue;
    var d = normalizeKeyDate_(urlIndexRows[i][0]);
    if (!d || d > asOf) continue;
    found = true;
    var prev = byUrl[url];
    if (!prev || d > prev.date || (d === prev.date && i > prev.rowIndex)) {
      byUrl[url] = { date: d, verdict: String(urlIndexRows[i][3] || ''), rowIndex: i };
    }
  }
  if (!found) return null;
  var urls = Object.keys(byUrl);
  if (!urls.length) return null;
  var indexed = 0;
  for (var k = 0; k < urls.length; k++) {
    if (byUrl[urls[k]].verdict === 'PASS') indexed++;
  }
  return indexed;
}

function computeOutcomeWindowMetrics_(opts) {
  opts = opts || {};
  var targetDate = normalizeKeyDate_(opts.targetDate);
  var win = computeOutcomeWindow_(targetDate);
  var dailyRows = opts.dailyRows || [];
  var queryRows = opts.queryRows || [];
  var site = opts.site || { name: opts.siteName || '' };
  var impressions = 0;
  var clicks = 0;
  if (win.start && win.end) {
    for (var i = 0; i < dailyRows.length; i++) {
      var dataDate = normalizeKeyDate_(dailyRows[i][0]);
      if (!dataDate || dataDate < win.start || dataDate > win.end) continue;
      var c = Number(dailyRows[i][2] || 0);
      var imp = Number(dailyRows[i][3] || 0);
      if (!isNaN(c)) clicks += c;
      if (!isNaN(imp)) impressions += imp;
    }
  }
  var qStats = computeOutcomeQueryStats_(queryRows, win.start, win.end, site);
  var indexed = getIndexedUrlCountAsOf_(
    opts.urlIndexRows || [],
    opts.siteName || site.name,
    targetDate
  );
  return {
    impressionsWindow: impressions,
    clicksWindow: clicks,
    queryCount: qStats.queryCount,
    guideQueryCount: qStats.guideQueryCount,
    top50QueryCount: qStats.top50,
    top20QueryCount: qStats.top20,
    bestPosition: qStats.bestPosition,
    indexedURLCount: indexed === null ? '' : indexed,
    indexRate: ''
  };
}

function buildDecisionOutcomeRow_(opts) {
  opts = opts || {};
  var m = opts.metrics || {};
  return [
    opts.decisionId || '',
    opts.site || '',
    opts.ruleVersion || '',
    opts.recommendedAction || '',
    opts.decisionDataDate || '',
    opts.horizon || '',
    opts.targetDate || '',
    opts.observedDataDate || '',
    opts.status || OBSERVATION_STATUS.OBSERVED,
    m.impressionsWindow === undefined || m.impressionsWindow === null ? 0 : m.impressionsWindow,
    m.clicksWindow === undefined || m.clicksWindow === null ? 0 : m.clicksWindow,
    m.queryCount === undefined || m.queryCount === null ? 0 : m.queryCount,
    m.guideQueryCount === undefined || m.guideQueryCount === null ? 0 : m.guideQueryCount,
    m.top50QueryCount === undefined || m.top50QueryCount === null ? 0 : m.top50QueryCount,
    m.top20QueryCount === undefined || m.top20QueryCount === null ? 0 : m.top20QueryCount,
    m.bestPosition === '' || m.bestPosition === null || m.bestPosition === undefined
      ? ''
      : m.bestPosition,
    m.indexedURLCount === '' || m.indexedURLCount === null || m.indexedURLCount === undefined
      ? ''
      : m.indexedURLCount,
    m.indexRate === '' || m.indexRate === null || m.indexRate === undefined ? '' : m.indexRate,
    opts.observedAt || ''
  ];
}

function planDecisionOutcomeRows_(ctx) {
  ctx = ctx || {};
  var decisions = ctx.decisions || [];
  var existingKeys = ctx.existingKeys || {};
  var latestBySite = ctx.latestBySite || {};
  var dailyBySite = ctx.dailyBySite || {};
  var queryBySite = ctx.queryBySite || {};
  var siteObjs = ctx.siteObjs || {};
  var urlIndexRows = ctx.urlIndexRows || [];
  var observedAt = ctx.observedAt || '';
  var toAppend = [];
  var pending = 0;
  var skippedExisting = 0;
  var seen = {};
  var horizons = outcomeHorizonDefs_();

  for (var i = 0; i < decisions.length; i++) {
    var d = decisions[i];
    if (!d || !d.decisionId) continue;
    var siteName = d.site;
    var decisionDataDate = normalizeKeyDate_(d.decisionDataDate);
    if (!decisionDataDate) continue;
    var latest = latestBySite[siteName] || '';
    var site = siteObjs[siteName] || { name: siteName };

    for (var h = 0; h < horizons.length; h++) {
      var hz = horizons[h];
      var key = buildOutcomeKey_(d.decisionId, hz.name);
      if (existingKeys[key] || seen[key]) {
        skippedExisting++;
        continue;
      }
      var targetDate = computeOutcomeTargetDate_(decisionDataDate, hz.days);
      if (!targetDate) continue;
      if (!isOutcomeDataMature_(latest, targetDate)) {
        pending++;
        continue;
      }
      var metrics = computeOutcomeWindowMetrics_({
        dailyRows: dailyBySite[siteName] || [],
        queryRows: queryBySite[siteName] || [],
        site: site,
        targetDate: targetDate,
        urlIndexRows: urlIndexRows,
        siteName: siteName
      });
      toAppend.push(
        buildDecisionOutcomeRow_({
          decisionId: d.decisionId,
          site: siteName,
          ruleVersion: d.ruleVersion || '',
          recommendedAction: d.recommendedAction || '',
          decisionDataDate: decisionDataDate,
          horizon: hz.name,
          targetDate: targetDate,
          observedDataDate: targetDate,
          status: OBSERVATION_STATUS.OBSERVED,
          metrics: metrics,
          observedAt: observedAt
        })
      );
      seen[key] = true;
    }
  }
  return { toAppend: toAppend, pending: pending, skippedExisting: skippedExisting };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function makeDaily(date, site, clicks, impressions) {
  return [date, site, clicks, impressions, 0, 10, 0, '', ''];
}

function makeQuery(date, site, query, clicks, impressions, position) {
  return [date, site, query, clicks, impressions, 0, position];
}

var decision = {
  decisionId: '2026-08-01|Grain Rot|CONTENT_OPTIMIZE|gsc-decision-v1.0',
  decisionDataDate: '2026-08-01',
  site: 'Grain Rot',
  ruleVersion: 'gsc-decision-v1.0',
  recommendedAction: 'CONTENT_OPTIMIZE'
};

// Case 7: TargetDate from DecisionDataDate not RunDate
assert(
  computeOutcomeTargetDate_('2026-08-01', 7) === '2026-08-08',
  'Case7 D7 target'
);
assert(
  computeOutcomeTargetDate_('2026-08-01', 14) === '2026-08-15',
  'Case7 D14 target'
);
assert(
  computeOutcomeTargetDate_('2026-08-01', 30) === '2026-08-31',
  'Case7 D30 target'
);

// Case 6: window
var win14 = computeOutcomeWindow_('2026-08-15');
assert(win14.start === '2026-08-09' && win14.end === '2026-08-15', 'Case6 window');

// Build daily covering Aug 1 .. Aug 31
var daily = [];
for (var day = 1; day <= 31; day++) {
  var ds = '2026-08-' + (day < 10 ? '0' : '') + day;
  daily.push(makeDaily(ds, 'Grain Rot', 1, day));
}
var queries = [
  makeQuery('2026-08-10', 'Grain Rot', 'grain rot wiki', 0, 5, 12),
  makeQuery('2026-08-12', 'Grain Rot', 'grain rot walkthrough', 1, 8, 8),
  makeQuery('2026-08-20', 'Grain Rot', 'grain rot', 0, 3, 40)
];

// Case 1: not yet D7
var plan1 = planDecisionOutcomeRows_({
  decisions: [decision],
  existingKeys: {},
  latestBySite: { 'Grain Rot': '2026-08-05' },
  dailyBySite: { 'Grain Rot': daily },
  queryBySite: { 'Grain Rot': queries },
  siteObjs: { 'Grain Rot': { name: 'Grain Rot' } },
  urlIndexRows: [],
  observedAt: '2026-08-05 10:00:00'
});
assert(plan1.toAppend.length === 0, 'Case1 no append');
assert(plan1.pending === 3, 'Case1 all 3 horizons pending');

// Case 8: RunDate conceptually past D7 but LatestGSCDataDate not mature
var plan8 = planDecisionOutcomeRows_({
  decisions: [decision],
  existingKeys: {},
  latestBySite: { 'Grain Rot': '2026-08-07' }, // D7 target is 08-08
  dailyBySite: { 'Grain Rot': daily },
  queryBySite: { 'Grain Rot': queries },
  siteObjs: { 'Grain Rot': { name: 'Grain Rot' } },
  urlIndexRows: [],
  observedAt: '2026-08-10 10:00:00'
});
assert(plan8.toAppend.length === 0, 'Case8 delay no write');
assert(plan8.pending >= 1, 'Case8 pending');

// Case 2: D7 mature
var plan2 = planDecisionOutcomeRows_({
  decisions: [decision],
  existingKeys: {},
  latestBySite: { 'Grain Rot': '2026-08-08' },
  dailyBySite: { 'Grain Rot': daily },
  queryBySite: { 'Grain Rot': queries },
  siteObjs: { 'Grain Rot': { name: 'Grain Rot' } },
  urlIndexRows: [],
  observedAt: '2026-08-09 10:00:00'
});
assert(plan2.toAppend.length === 1, 'Case2 one D7');
assert(plan2.toAppend[0][5] === 'D7', 'Case2 horizon D7');
assert(plan2.toAppend[0][6] === '2026-08-08', 'Case2 target');
assert(plan2.toAppend[0][7] === '2026-08-08', 'Case2 observedDataDate=TargetDate');
assert(plan2.toAppend[0][8] === 'OBSERVED', 'Case2 status');
// D7 window Aug 2-8 impressions = 2+3+4+5+6+7+8 = 35
assert(plan2.toAppend[0][9] === 35, 'Case2 impressions window ' + plan2.toAppend[0][9]);
assert(plan2.toAppend[0][10] === 7, 'Case2 clicks window');

// Case 10: no DomainScore columns
var headerForbidden = ['DomainScore', 'TractionScore', 'QueryScore', 'MomentumScore', 'ExpansionScore', 'RiskScore'];
var row2 = plan2.toAppend[0];
headerForbidden.forEach(function (name) {
  assert(row2.indexOf(name) < 0, 'Case10 no ' + name + ' value as label');
});
assert(row2.length === 19, 'Case10 outcome width 19');

// Case 3: D7 exists → no duplicate
var existing = {};
existing[buildOutcomeKey_(decision.decisionId, 'D7')] = true;
var plan3 = planDecisionOutcomeRows_({
  decisions: [decision],
  existingKeys: existing,
  latestBySite: { 'Grain Rot': '2026-08-08' },
  dailyBySite: { 'Grain Rot': daily },
  queryBySite: { 'Grain Rot': queries },
  siteObjs: { 'Grain Rot': { name: 'Grain Rot' } },
  urlIndexRows: [],
  observedAt: '2026-08-09 11:00:00'
});
assert(plan3.toAppend.length === 0, 'Case3 no dup');
assert(plan3.skippedExisting >= 1, 'Case3 skipped');

// Case 4: D14 mature, D7 exists → only D14
var plan4 = planDecisionOutcomeRows_({
  decisions: [decision],
  existingKeys: existing,
  latestBySite: { 'Grain Rot': '2026-08-15' },
  dailyBySite: { 'Grain Rot': daily },
  queryBySite: { 'Grain Rot': queries },
  siteObjs: { 'Grain Rot': { name: 'Grain Rot' } },
  urlIndexRows: [],
  observedAt: '2026-08-16 10:00:00'
});
assert(plan4.toAppend.length === 1, 'Case4 only D14');
assert(plan4.toAppend[0][5] === 'D14', 'Case4 horizon');
assert(plan4.toAppend[0][6] === '2026-08-15', 'Case4 target');
// D14 window Aug 9-15: 9+10+11+12+13+14+15 = 84
assert(plan4.toAppend[0][9] === 84, 'Case4 impressions ' + plan4.toAppend[0][9]);
assert(plan4.toAppend[0][11] === 2, 'Case4 queryCount in window');
assert(plan4.toAppend[0][12] === 2, 'Case4 guide');
assert(plan4.toAppend[0][15] === 8, 'Case4 bestPosition');

// Case 5: all mature → max 3
var plan5 = planDecisionOutcomeRows_({
  decisions: [decision],
  existingKeys: {},
  latestBySite: { 'Grain Rot': '2026-08-31' },
  dailyBySite: { 'Grain Rot': daily },
  queryBySite: { 'Grain Rot': queries },
  siteObjs: { 'Grain Rot': { name: 'Grain Rot' } },
  urlIndexRows: [],
  observedAt: '2026-09-01 10:00:00'
});
assert(plan5.toAppend.length === 3, 'Case5 three horizons');
var hz = plan5.toAppend.map(function (r) {
  return r[5];
}).sort();
assert(hz.join(',') === 'D14,D30,D7', 'Case5 all three');

// Case 9: no query
var plan9 = planDecisionOutcomeRows_({
  decisions: [decision],
  existingKeys: {},
  latestBySite: { 'Grain Rot': '2026-08-08' },
  dailyBySite: { 'Grain Rot': daily },
  queryBySite: { 'Grain Rot': [] },
  siteObjs: { 'Grain Rot': { name: 'Grain Rot' } },
  urlIndexRows: [],
  observedAt: '2026-08-09 10:00:00'
});
assert(plan9.toAppend.length === 1, 'Case9 still writes');
assert(plan9.toAppend[0][9] === 35, 'Case9 impressions ok');
assert(plan9.toAppend[0][11] === 0, 'Case9 queryCount 0');
assert(plan9.toAppend[0][15] === '', 'Case9 bestPosition empty');

// Config / wiring markers
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var outcomeSrc = fs.readFileSync(path.join(root, 'DecisionOutcomes.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');

assert(/DECISION_OUTCOMES:\s*'决策结果'/.test(configSrc), 'sheet name');
assert(/DECISION_OUTCOME_HEADERS/.test(configSrc), 'headers');
assert(!/DomainScore/.test(configSrc.match(/var DECISION_OUTCOME_HEADERS = \[[\s\S]*?\];/)[0]), 'no DomainScore header');
assert(/function runDecisionOutcomeObservation\(/.test(outcomeSrc), 'runner');
assert(!/\.addItem\('观察决策结果'/.test(codeSrc), 'retired menu hidden');
assert(/决策结果：在 Decision 后的 D7/.test(sheetSrc), 'usage');
assert(/ensureSheet_\(SHEET_NAMES\.DECISION_OUTCOMES/.test(sheetSrc), 'setup');
// Decision Engine scoring untouched by outcome file
assert(!/function scoreTraction_/.test(outcomeSrc), 'outcome file does not redefine scores');
assert(/function decideRecommendedAction_/.test(decisionSrc), 'decision still present');
assert(!/runDecisionOutcomeObservation/.test(decisionSrc), 'not wired into DecisionEngine file');

console.log('PASS scripts/test-decision-outcomes.js');
