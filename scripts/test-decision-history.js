/**
 * M2-1 / M3-3 本地自测：Decision History / RuleVersion / Baseline 7D（不依赖 SpreadsheetApp）。
 * 运行：node scripts/test-decision-history.js
 */

var TODAY_ACTION_EXCLUDED = {
  NO_ACTION: true,
  WAIT: true
};

var DECISION_RULE_VERSION = 'gsc-decision-v1.0';

function shouldWriteTodayAction_(action, cooldown) {
  if (!action || TODAY_ACTION_EXCLUDED[action]) return false;
  if (cooldown) return false;
  return true;
}

function buildDecisionId_(runDate, siteName, recommendedAction, ruleVersion) {
  return [
    String(runDate || '').trim(),
    String(siteName || '').trim(),
    String(recommendedAction || '').trim(),
    String(ruleVersion || '').trim()
  ].join('|');
}

function addDaysStr_(yyyyMmDd, days) {
  var parts = String(yyyyMmDd || '').split('-');
  if (parts.length !== 3) return '';
  var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function normalizeKeyDate_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    var y = v.getFullYear();
    var m = String(v.getMonth() + 1).padStart(2, '0');
    var d = String(v.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return '';
}

/** 与 DecisionOutcomes.gs 同口径 */
function computeOutcomeWindow_(targetDate) {
  var end = normalizeKeyDate_(targetDate);
  if (!end) return { start: '', end: '' };
  return { start: addDaysStr_(end, -6), end: end };
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
  var top50 = 0;
  var top20 = 0;
  var best = '';
  for (var n = 0; n < names.length; n++) {
    var pos = byQuery[names[n]].bestPosition;
    if (pos > 0 && pos <= 50) top50++;
    if (pos > 0 && pos <= 20) top20++;
    if (pos > 0 && (best === '' || pos < best)) best = pos;
  }
  return {
    queryCount: names.length,
    guideQueryCount: 0,
    top50: top50,
    top20: top20,
    bestPosition: best
  };
}

function computeOutcomeWindowMetrics_(opts) {
  opts = opts || {};
  var targetDate = normalizeKeyDate_(opts.targetDate);
  var win = computeOutcomeWindow_(targetDate);
  var dailyRows = opts.dailyRows || [];
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
  var qStats = computeOutcomeQueryStats_(
    opts.queryRows || [],
    win.start,
    win.end,
    opts.site
  );
  return {
    impressionsWindow: impressions,
    clicksWindow: clicks,
    queryCount: qStats.queryCount,
    guideQueryCount: qStats.guideQueryCount,
    top50QueryCount: qStats.top50,
    top20QueryCount: qStats.top20,
    bestPosition: qStats.bestPosition
  };
}

function buildDecisionBaseline7D_(opts) {
  opts = opts || {};
  var end = normalizeKeyDate_(opts.decisionDataDate);
  var empty = {
    start: '',
    end: '',
    impressions: 0,
    clicks: 0,
    queryCount: 0,
    guideQueryCount: 0,
    top50QueryCount: 0,
    top20QueryCount: 0,
    bestPosition: ''
  };
  if (!end) return empty;
  var win = computeOutcomeWindow_(end);
  var metrics = computeOutcomeWindowMetrics_({
    dailyRows: opts.dailyRows || [],
    queryRows: opts.queryRows || [],
    site: opts.site || { name: opts.siteName || '' },
    targetDate: end
  });
  return {
    start: win.start,
    end: win.end,
    impressions: metrics.impressionsWindow,
    clicks: metrics.clicksWindow,
    queryCount: metrics.queryCount,
    guideQueryCount: metrics.guideQueryCount,
    top50QueryCount: metrics.top50QueryCount,
    top20QueryCount: metrics.top20QueryCount,
    bestPosition: metrics.bestPosition
  };
}

function buildDecisionHistoryRow_(
  runDate,
  siteName,
  metrics,
  scores,
  decision,
  reason,
  ruleVersion,
  recordedAt,
  decisionId,
  baseline
) {
  ruleVersion = ruleVersion || DECISION_RULE_VERSION;
  var action = decision && decision.action ? decision.action : '';
  var id = String(decisionId || '').trim();
  if (!id) id = buildDecisionId_(runDate, siteName, action, ruleVersion);
  baseline = baseline || {};
  return [
    id,
    runDate,
    metrics.decisionDataDate || '',
    siteName,
    ruleVersion,
    metrics.day === '' || metrics.day === null || metrics.day === undefined ? '' : metrics.day,
    metrics.indexedCount === '' || metrics.indexedCount === null || metrics.indexedCount === undefined
      ? ''
      : metrics.indexedCount,
    metrics.indexRate === '' || metrics.indexRate === null || metrics.indexRate === undefined
      ? ''
      : metrics.indexRate,
    metrics.impressions24h,
    metrics.impressions7d,
    metrics.previous3d,
    metrics.latest3d,
    metrics.hasGrowth ? metrics.growth3d : '',
    metrics.queryCount7d,
    metrics.guideQueryCount7d,
    metrics.top50QueryCount,
    metrics.top30QueryCount,
    metrics.top20QueryCount,
    metrics.clicks7d,
    metrics.intentCategoryCount === undefined || metrics.intentCategoryCount === null
      ? 0
      : metrics.intentCategoryCount,
    scores.tractionScore,
    scores.queryScore,
    scores.momentumScore,
    scores.expansionScore,
    scores.riskScore,
    scores.domainScore,
    decision.stage,
    decision.action,
    decision.priority,
    reason,
    '',
    '',
    recordedAt || '',
    String(baseline.start || ''),
    String(baseline.end || ''),
    baseline.impressions === undefined || baseline.impressions === null ? 0 : baseline.impressions,
    baseline.clicks === undefined || baseline.clicks === null ? 0 : baseline.clicks,
    baseline.queryCount === undefined || baseline.queryCount === null ? 0 : baseline.queryCount,
    baseline.guideQueryCount === undefined || baseline.guideQueryCount === null
      ? 0
      : baseline.guideQueryCount,
    baseline.top50QueryCount === undefined || baseline.top50QueryCount === null
      ? 0
      : baseline.top50QueryCount,
    baseline.top20QueryCount === undefined || baseline.top20QueryCount === null
      ? 0
      : baseline.top20QueryCount,
    baseline.bestPosition === '' ||
    baseline.bestPosition === null ||
    baseline.bestPosition === undefined
      ? ''
      : baseline.bestPosition
  ];
}

function selectDecisionHistoryAppends_(existingIdSet, candidateRows) {
  var out = [];
  var seen = {};
  var keys = existingIdSet || {};
  var rows = candidateRows || [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row || !row.length) continue;
    var id = String(row[0] || '').trim();
    if (!id) continue;
    if (keys[id] || seen[id]) continue;
    seen[id] = true;
    out.push(row);
  }
  return out;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function sampleMetrics_(over) {
  var m = {
    decisionDataDate: '2026-08-10',
    day: 12,
    indexedCount: 4,
    indexRate: 0.8,
    impressions24h: 20,
    impressions7d: 80,
    previous3d: 30,
    latest3d: 40,
    hasGrowth: true,
    growth3d: 1.333,
    queryCount7d: 10,
    guideQueryCount7d: 3,
    top50QueryCount: 2,
    top30QueryCount: 1,
    top20QueryCount: 0,
    clicks7d: 2,
    intentCategoryCount: 3
  };
  if (over) {
    var keys = Object.keys(over);
    for (var i = 0; i < keys.length; i++) m[keys[i]] = over[keys[i]];
  }
  return m;
}

function sampleScores_() {
  return {
    tractionScore: 5,
    queryScore: 10,
    momentumScore: 6,
    expansionScore: 5,
    riskScore: 4,
    domainScore: 30
  };
}

function sampleBaseline_(over) {
  var b = {
    start: '2026-08-04',
    end: '2026-08-10',
    impressions: 70,
    clicks: 3,
    queryCount: 5,
    guideQueryCount: 2,
    top50QueryCount: 1,
    top20QueryCount: 0,
    bestPosition: 12
  };
  if (over) {
    var keys = Object.keys(over);
    for (var i = 0; i < keys.length; i++) b[keys[i]] = over[keys[i]];
  }
  return b;
}

// --- Case 1: CONTENT_OPTIMIZE → 1 snapshot ---
var metrics = sampleMetrics_();
var scores = sampleScores_();
var baseline = sampleBaseline_();
var decision = { action: 'CONTENT_OPTIMIZE', stage: 'CONTENT', priority: 'P1', fastTrack: false };
var reason = 'test reason；Data through 2026-08-10';
assert(shouldWriteTodayAction_(decision.action, null) === true, 'Case1 should write today action');
var row1 = buildDecisionHistoryRow_(
  '2026-08-15',
  'Approximately Up',
  metrics,
  scores,
  decision,
  reason,
  DECISION_RULE_VERSION,
  '2026-08-15 10:00:00',
  '',
  baseline
);
assert(row1[0] === '2026-08-15|Approximately Up|CONTENT_OPTIMIZE|gsc-decision-v1.0', 'Case1 DecisionID');
assert(row1[4] === 'gsc-decision-v1.0', 'Case1 RuleVersion');
assert(row1[27] === 'CONTENT_OPTIMIZE', 'Case1 action');
assert(row1[29] === reason, 'Case1 reason frozen');
assert(row1[25] === 30, 'Case1 DomainScore frozen');
assert(row1[12] === 1.333, 'Case1 Growth3D frozen');
assert(row1[19] === 3, 'Case1 IntentCategoryCount');
assert(row1[30] === '' && row1[31] === '', 'Case1 Human fields empty');
assert(row1[33] === '2026-08-04', 'Case1 BaselineStartDate');
assert(row1[34] === '2026-08-10', 'Case1 BaselineEndDate');
assert(row1[35] === 70 && row1[36] === 3, 'Case1 baseline impressions/clicks');
assert(row1[41] === 12, 'Case1 BaselineBestPosition');
var append1 = selectDecisionHistoryAppends_({}, [row1]);
assert(append1.length === 1, 'Case1 append 1');

// --- Case 2: same day/site/action/version → no duplicate / baseline not overwritten ---
var row2 = buildDecisionHistoryRow_(
  '2026-08-15',
  'Approximately Up',
  metrics,
  scores,
  decision,
  reason,
  DECISION_RULE_VERSION,
  '2026-08-15 18:00:00',
  '',
  sampleBaseline_({ impressions: 999, bestPosition: 1 })
);
var existing = {};
existing[row1[0]] = true;
var append2 = selectDecisionHistoryAppends_(existing, [row2]);
assert(append2.length === 0, 'Case2 no duplicate — baseline frozen');

// --- Case 3: same day, action changes → new snapshot ---
var decisionUpgrade = {
  action: 'DOMAIN_UPGRADE',
  stage: 'DOMAIN_READY',
  priority: 'P0',
  fastTrack: false
};
var row3 = buildDecisionHistoryRow_(
  '2026-08-15',
  'Approximately Up',
  metrics,
  scores,
  decisionUpgrade,
  'upgrade reason',
  DECISION_RULE_VERSION,
  '2026-08-15 19:00:00',
  '',
  baseline
);
assert(row3[0] !== row1[0], 'Case3 different DecisionID');
var append3 = selectDecisionHistoryAppends_(existing, [row3]);
assert(append3.length === 1, 'Case3 new snapshot allowed');

// --- Case 4: WAIT → no today action / no snapshot path ---
assert(shouldWriteTodayAction_('WAIT', null) === false, 'Case4 WAIT excluded');
assert(shouldWriteTodayAction_('NO_ACTION', null) === false, 'Case4 NO_ACTION excluded');

// --- Case 5: cooldown suppresses snapshot (same gate as today action) ---
assert(
  shouldWriteTodayAction_('CONTENT_OPTIMIZE', { untilDate: '2026-08-17' }) === false,
  'Case5 cooldown suppresses'
);

// --- Case 6: snapshot mirrors same metrics/scores/decision object values ---
var m6 = sampleMetrics_({ impressions7d: 326, guideQueryCount7d: 7 });
var s6 = sampleScores_();
s6.domainScore = 99;
var d6 = { action: 'CHECK_INDEX', stage: 'INDEX_CHECK', priority: 'P0', fastTrack: false };
var r6 = 'index check；Data through 2026-08-10';
var row6 = buildDecisionHistoryRow_(
  '2026-08-15',
  'Grain Rot',
  m6,
  s6,
  d6,
  r6,
  DECISION_RULE_VERSION,
  '2026-08-15 11:00:00',
  '',
  baseline
);
assert(row6[9] === 326, 'Case6 impressions7d');
assert(row6[14] === 7, 'Case6 guide');
assert(row6[25] === 99, 'Case6 domainScore');
assert(row6[27] === 'CHECK_INDEX', 'Case6 action');
assert(row6[29] === r6, 'Case6 reason');

// --- M3-3 Baseline window + same口径 as Outcome ---
var win = computeOutcomeWindow_('2026-08-10');
assert(win.start === '2026-08-04' && win.end === '2026-08-10', 'Baseline window = DecisionDataDate-6..DecisionDataDate');

var daily = [
  ['2026-08-03', 'SiteA', 9, 90], // outside
  ['2026-08-04', 'SiteA', 1, 10],
  ['2026-08-10', 'SiteA', 2, 20],
  ['2026-08-11', 'SiteA', 3, 30] // outside
];
var queries = [
  ['2026-08-04', 'SiteA', 'guide one', 0, 0, 0, 15],
  ['2026-08-10', 'SiteA', 'guide two', 0, 0, 0, 8],
  ['2026-08-11', 'SiteA', 'late', 0, 0, 0, 3]
];
var bl = buildDecisionBaseline7D_({
  decisionDataDate: '2026-08-10',
  dailyRows: daily,
  queryRows: queries,
  site: { name: 'SiteA' }
});
assert(bl.start === '2026-08-04' && bl.end === '2026-08-10', 'computed baseline dates');
assert(bl.impressions === 30 && bl.clicks === 3, 'baseline daily sum excludes outside days');
assert(bl.queryCount === 2, 'baseline query count excludes late day');
assert(bl.top50QueryCount === 2 && bl.top20QueryCount === 2, 'topN from window');
assert(bl.bestPosition === 8, 'best position in window');

var outcomeSame = computeOutcomeWindowMetrics_({
  dailyRows: daily,
  queryRows: queries,
  site: { name: 'SiteA' },
  targetDate: '2026-08-10'
});
assert(bl.impressions === outcomeSame.impressionsWindow, 'same口径 impressions');
assert(bl.clicks === outcomeSame.clicksWindow, 'same口径 clicks');
assert(bl.queryCount === outcomeSame.queryCount, 'same口径 queryCount');
assert(bl.top50QueryCount === outcomeSame.top50QueryCount, 'same口径 top50');
assert(bl.top20QueryCount === outcomeSame.top20QueryCount, 'same口径 top20');
assert(bl.bestPosition === outcomeSame.bestPosition, 'same口径 bestPosition');

// Config markers
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');
var outcomeSrc = fs.readFileSync(path.join(root, 'DecisionOutcomes.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');

assert(/DECISION_RULE_VERSION\s*=\s*'gsc-decision-v1\.0'/.test(configSrc), 'version const');
assert(/DECISION_HISTORY:\s*'决策历史'/.test(configSrc), 'sheet name');
assert(/BaselineStartDate/.test(configSrc) && /BaselineBestPosition/.test(configSrc), 'baseline headers');
assert(
  /SITE_STATUS[\s\S]*DECISION_HISTORY[\s\S]*DECISION_OUTCOMES[\s\S]*RULES/.test(
    configSrc.match(/var SHEET_UI_ORDER = \[[\s\S]*?\];/)[0]
  ),
  'UI order: 决策历史/决策结果 between 站点状态 and 规则配置'
);
assert(/appendDecisionHistoryRows_\(historyRows\)/.test(decisionSrc), 'wired in runDecisionEngine');
assert(
  /if \(shouldWriteTodayAction_\(decision\.action, cooldown\)\) \{[\s\S]*?historyRows\.push/.test(
    decisionSrc
  ),
  'snapshot only when today action written'
);
assert(/buildDecisionBaseline7D_/.test(decisionSrc), 'engine calls baseline builder');
assert(/function buildDecisionBaseline7D_/.test(outcomeSrc), 'baseline uses Outcome module');
assert(
  /buildDecisionBaseline7D_[\s\S]*computeOutcomeWindowMetrics_/.test(outcomeSrc),
  'baseline reuses outcome metrics helper'
);
assert(/ensureDecisionHistoryHeader_/.test(decisionSrc), 'header ensure');
assert(/决策历史：保存系统当时的规则版本/.test(sheetSrc), 'usage guide mention');
assert(/Baseline 不是 intervention/.test(sheetSrc), 'baseline semantics in usage');
assert(/ensureSheet_\(SHEET_NAMES\.DECISION_HISTORY/.test(sheetSrc), 'setup ensures sheet');
assert(!/D7Delta|SUCCESS_RATE|WIN_RATE|FALSE_POSITIVE/.test(decisionSrc + outcomeSrc), 'no eval labels');

assert(/function decideRecommendedAction_/.test(decisionSrc), 'decide present');
assert(/function computeDomainScores_/.test(decisionSrc), 'scores present');
assert(/function scoreRisk_/.test(decisionSrc), 'scoreRisk present');

var headersMatch = configSrc.match(/var DECISION_HISTORY_HEADERS\s*=\s*(\[[\s\S]*?\]);/);
assert(headersMatch, 'parse history headers');
var headers = eval(headersMatch[1]);
assert(headers.indexOf('HumanDecision') === 30, 'HumanDecision index stable');
assert(headers.indexOf('RecordedAt') === 32, 'RecordedAt index stable');
assert(headers.indexOf('BaselineStartDate') === 33, 'Baseline appended after RecordedAt');
assert(headers[headers.length - 1] === 'BaselineBestPosition', 'baseline ends headers');
assert(headers.length === 42, 'history header count');

console.log('PASS scripts/test-decision-history.js');
