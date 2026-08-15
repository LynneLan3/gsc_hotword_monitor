/**
 * M2-1 本地自测：Decision History / RuleVersion（不依赖 SpreadsheetApp）。
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

function buildDecisionHistoryRow_(
  runDate,
  siteName,
  metrics,
  scores,
  decision,
  reason,
  ruleVersion,
  recordedAt
) {
  ruleVersion = ruleVersion || DECISION_RULE_VERSION;
  var action = decision && decision.action ? decision.action : '';
  return [
    buildDecisionId_(runDate, siteName, action, ruleVersion),
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
    recordedAt || ''
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

// --- Case 1: CONTENT_OPTIMIZE → 1 snapshot ---
var metrics = sampleMetrics_();
var scores = sampleScores_();
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
  '2026-08-15 10:00:00'
);
assert(row1[0] === '2026-08-15|Approximately Up|CONTENT_OPTIMIZE|gsc-decision-v1.0', 'Case1 DecisionID');
assert(row1[4] === 'gsc-decision-v1.0', 'Case1 RuleVersion');
assert(row1[27] === 'CONTENT_OPTIMIZE', 'Case1 action');
assert(row1[29] === reason, 'Case1 reason frozen');
assert(row1[25] === 30, 'Case1 DomainScore frozen');
assert(row1[12] === 1.333, 'Case1 Growth3D frozen');
assert(row1[19] === 3, 'Case1 IntentCategoryCount');
assert(row1[30] === '' && row1[31] === '', 'Case1 Human fields empty');
var append1 = selectDecisionHistoryAppends_({}, [row1]);
assert(append1.length === 1, 'Case1 append 1');

// --- Case 2: same day/site/action/version → no duplicate ---
var row2 = buildDecisionHistoryRow_(
  '2026-08-15',
  'Approximately Up',
  metrics,
  scores,
  decision,
  reason,
  DECISION_RULE_VERSION,
  '2026-08-15 18:00:00'
);
var existing = {};
existing[row1[0]] = true;
var append2 = selectDecisionHistoryAppends_(existing, [row2]);
assert(append2.length === 0, 'Case2 no duplicate');

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
  '2026-08-15 19:00:00'
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
  '2026-08-15 11:00:00'
);
assert(row6[9] === 326, 'Case6 impressions7d');
assert(row6[14] === 7, 'Case6 guide');
assert(row6[25] === 99, 'Case6 domainScore');
assert(row6[27] === 'CHECK_INDEX', 'Case6 action');
assert(row6[29] === r6, 'Case6 reason');

// Config markers
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');

assert(/DECISION_RULE_VERSION\s*=\s*'gsc-decision-v1\.0'/.test(configSrc), 'version const');
assert(/DECISION_HISTORY:\s*'决策历史'/.test(configSrc), 'sheet name');
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
assert(/决策历史：保存系统当时的规则版本/.test(sheetSrc), 'usage guide mention');
assert(/ensureSheet_\(SHEET_NAMES\.DECISION_HISTORY/.test(sheetSrc), 'setup ensures sheet');

// Decision result functions must still exist unchanged (presence smoke)
assert(/function decideRecommendedAction_/.test(decisionSrc), 'decide present');
assert(/function computeDomainScores_/.test(decisionSrc), 'scores present');
assert(/function scoreRisk_/.test(decisionSrc), 'scoreRisk present');

console.log('PASS scripts/test-decision-history.js');
