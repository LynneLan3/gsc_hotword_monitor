/**
 * M3-4 本地自测：Outcome Delta View（不依赖 SpreadsheetApp）。
 * 运行：node scripts/test-outcome-delta.js
 */

var fs = require('fs');
var path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var OUTCOME_DELTA_STATUS = {
  OBSERVED: 'OBSERVED',
  PENDING: 'PENDING'
};

function isMissingMetric_(v) {
  return v === '' || v === null || v === undefined;
}

function blankIfMissing_(v) {
  return isMissingMetric_(v) ? '' : v;
}

function computeAbsoluteDelta_(baseline, outcome) {
  if (isMissingMetric_(baseline) || isMissingMetric_(outcome)) return '';
  return Number(outcome) - Number(baseline);
}

function computeDeltaPct_(baseline, outcome) {
  if (isMissingMetric_(baseline) || isMissingMetric_(outcome)) return '';
  var b = Number(baseline);
  if (!(b > 0)) return '';
  return (Number(outcome) - b) / b;
}

function computePositionImprovement_(baselinePos, outcomePos) {
  if (isMissingMetric_(baselinePos) || isMissingMetric_(outcomePos)) return '';
  return Number(baselinePos) - Number(outcomePos);
}

function buildHorizonDeltaBlock_(baseline, outcome) {
  if (!outcome) {
    return {
      status: OUTCOME_DELTA_STATUS.PENDING,
      impressions: '',
      impressionsDelta: '',
      impressionsDeltaPct: '',
      clicks: '',
      clicksDelta: '',
      clicksDeltaPct: '',
      guideQueries: '',
      guideQueriesDelta: '',
      guideQueriesDeltaPct: '',
      bestPosition: '',
      positionImprovement: ''
    };
  }
  var impressions = outcome.impressionsWindow;
  var clicks = outcome.clicksWindow;
  var guideQueries = outcome.guideQueryCount;
  var bestPosition = outcome.bestPosition;
  return {
    status: OUTCOME_DELTA_STATUS.OBSERVED,
    impressions: blankIfMissing_(impressions),
    impressionsDelta: computeAbsoluteDelta_(baseline.impressions, impressions),
    impressionsDeltaPct: computeDeltaPct_(baseline.impressions, impressions),
    clicks: blankIfMissing_(clicks),
    clicksDelta: computeAbsoluteDelta_(baseline.clicks, clicks),
    clicksDeltaPct: computeDeltaPct_(baseline.clicks, clicks),
    guideQueries: blankIfMissing_(guideQueries),
    guideQueriesDelta: computeAbsoluteDelta_(baseline.guideQueries, guideQueries),
    guideQueriesDeltaPct: computeDeltaPct_(baseline.guideQueries, guideQueries),
    bestPosition: blankIfMissing_(bestPosition),
    positionImprovement: computePositionImprovement_(
      baseline.bestPosition,
      bestPosition
    )
  };
}

function buildOutcomeDeltaRow_(input) {
  input = input || {};
  var h = input.history || {};
  var baseline = {
    impressions: h.baselineImpressions,
    clicks: h.baselineClicks,
    guideQueries: h.baselineGuideQueryCount,
    bestPosition: h.baselineBestPosition
  };
  var d7 = buildHorizonDeltaBlock_(baseline, input.d7);
  var d14 = buildHorizonDeltaBlock_(baseline, input.d14);
  var d30 = buildHorizonDeltaBlock_(baseline, input.d30);
  return [
    String(h.decisionId || '').trim(),
    String(h.ruleVersion || '').trim(),
    String(h.decisionDataDate || '').trim(),
    String(h.site || '').trim(),
    String(h.humanDecision || '').trim(),
    Number(input.interventionCount || 0),
    blankIfMissing_(baseline.impressions),
    blankIfMissing_(baseline.clicks),
    blankIfMissing_(baseline.guideQueries),
    blankIfMissing_(baseline.bestPosition),
    d7.status,
    d7.impressions,
    d7.impressionsDelta,
    d7.impressionsDeltaPct,
    d7.clicks,
    d7.clicksDelta,
    d7.clicksDeltaPct,
    d7.guideQueries,
    d7.guideQueriesDelta,
    d7.guideQueriesDeltaPct,
    d7.bestPosition,
    d7.positionImprovement,
    d14.status,
    d14.impressions,
    d14.impressionsDelta,
    d14.impressionsDeltaPct,
    d14.clicks,
    d14.clicksDelta,
    d14.clicksDeltaPct,
    d14.guideQueries,
    d14.guideQueriesDelta,
    d14.guideQueriesDeltaPct,
    d14.bestPosition,
    d14.positionImprovement,
    d30.status,
    d30.impressions,
    d30.impressionsDelta,
    d30.impressionsDeltaPct,
    d30.clicks,
    d30.clicksDelta,
    d30.clicksDeltaPct,
    d30.guideQueries,
    d30.guideQueriesDelta,
    d30.guideQueriesDeltaPct,
    d30.bestPosition,
    d30.positionImprovement,
    String(input.updatedAt || '')
  ];
}

function planOutcomeDeltaRows_(ctx) {
  ctx = ctx || {};
  var history = ctx.history || [];
  var interventions = ctx.interventions || [];
  var outcomes = ctx.outcomes || [];
  var updatedAt = ctx.updatedAt || '';
  var upstream = JSON.stringify({
    history: history,
    interventions: interventions,
    outcomes: outcomes
  });
  var historyIds = {};
  var i;
  for (i = 0; i < history.length; i++) {
    var hid = String(history[i].decisionId || '').trim();
    if (hid) historyIds[hid] = true;
  }
  var interventionCountById = {};
  for (i = 0; i < interventions.length; i++) {
    var iid = String(interventions[i].decisionId || '').trim();
    if (!iid || !historyIds[iid]) continue;
    interventionCountById[iid] = (interventionCountById[iid] || 0) + 1;
  }
  var outcomesById = {};
  var ignoredOrphanOutcomes = 0;
  var outcomeSeen = {};
  for (i = 0; i < outcomes.length; i++) {
    var oc = outcomes[i];
    var oid = String(oc.decisionId || '').trim();
    var hz = String(oc.horizon || '').trim();
    if (!oid || !hz) continue;
    if (!historyIds[oid]) {
      ignoredOrphanOutcomes++;
      continue;
    }
    var key = oid + '||' + hz;
    if (outcomeSeen[key]) continue;
    outcomeSeen[key] = true;
    if (!outcomesById[oid]) outcomesById[oid] = {};
    outcomesById[oid][hz] = oc;
  }
  var rows = [];
  for (i = 0; i < history.length; i++) {
    var h = history[i];
    var id = String(h.decisionId || '').trim();
    if (!id) continue;
    rows.push(
      buildOutcomeDeltaRow_({
        history: h,
        interventionCount: Number(interventionCountById[id] || 0),
        d7: outcomesById[id] && outcomesById[id].D7,
        d14: outcomesById[id] && outcomesById[id].D14,
        d30: outcomesById[id] && outcomesById[id].D30,
        updatedAt: updatedAt
      })
    );
  }
  assert(
    JSON.stringify({
      history: history,
      interventions: interventions,
      outcomes: outcomes
    }) === upstream,
    'must not mutate upstream fixtures'
  );
  return { rows: rows, ignoredOrphanOutcomes: ignoredOrphanOutcomes };
}

function hist(id, over) {
  over = over || {};
  return {
    decisionId: id,
    ruleVersion: over.ruleVersion || 'gsc-decision-v1.0',
    decisionDataDate: over.date || '2026-08-01',
    site: over.site || 'SiteA',
    humanDecision: over.human === undefined ? 'DONE' : over.human,
    baselineImpressions: over.bImp === undefined ? 40 : over.bImp,
    baselineClicks: over.bClk === undefined ? 10 : over.bClk,
    baselineGuideQueryCount: over.bGuide === undefined ? 4 : over.bGuide,
    baselineBestPosition: over.bPos === undefined ? 20 : over.bPos
  };
}

function oc(id, hz, over) {
  over = over || {};
  return {
    decisionId: id,
    horizon: hz,
    impressionsWindow: over.imp,
    clicksWindow: over.clk,
    guideQueryCount: over.guide,
    bestPosition: over.pos
  };
}

// 1. History 空
var empty = planOutcomeDeltaRows_({
  history: [],
  interventions: [],
  outcomes: [oc('ghost', 'D7', { imp: 1 })],
  updatedAt: 't0'
});
assert(empty.rows.length === 0, 'empty history');
assert(empty.ignoredOrphanOutcomes === 1, 'orphan ignored');

// 2. 有 Baseline、无 Outcome → 三 PENDING
var pending = planOutcomeDeltaRows_({
  history: [hist('d1')],
  interventions: [],
  outcomes: [],
  updatedAt: 't1'
});
assert(pending.rows.length === 1, 'one row without intervention');
assert(pending.rows[0][5] === 0, 'intervention count 0 still has row');
assert(pending.rows[0][10] === 'PENDING', 'D7 pending');
assert(pending.rows[0][22] === 'PENDING', 'D14 pending');
assert(pending.rows[0][34] === 'PENDING', 'D30 pending');
assert(pending.rows[0][11] === '' && pending.rows[0][12] === '', 'pending fields empty not 0');

// 3. 只有 D7
var onlyD7 = planOutcomeDeltaRows_({
  history: [hist('d2')],
  interventions: [{ decisionId: 'd2' }],
  outcomes: [oc('d2', 'D7', { imp: 55, clk: 5, guide: 6, pos: 12 })],
  updatedAt: 't2'
});
var r = onlyD7.rows[0];
assert(r[5] === 1, 'intervention counted');
assert(r[10] === 'OBSERVED' && r[22] === 'PENDING' && r[34] === 'PENDING', 'only D7 observed');

// 4. Impressions 40→55
assert(r[11] === 55 && r[12] === 15 && r[13] === 0.375, 'impressions delta');

// 5. Clicks 10→5
assert(r[14] === 5 && r[15] === -5 && r[16] === -0.5, 'clicks delta');

// 6. Baseline=0 Outcome>0
assert(computeAbsoluteDelta_(0, 12) === 12, 'zero baseline abs');
assert(computeDeltaPct_(0, 12) === '', 'zero baseline pct empty');

// 7. both 0
assert(computeAbsoluteDelta_(0, 0) === 0, 'both zero abs');
assert(computeDeltaPct_(0, 0) === '', 'both zero pct empty');

// 8/9 PositionImprovement
assert(computePositionImprovement_(20, 12) === 8, 'pos improve');
assert(computePositionImprovement_(10, 18) === -8, 'pos decline');
assert(r[21] === 8, 'row position improvement');

// 10. missing position
assert(computePositionImprovement_('', 12) === '', 'missing baseline pos');
assert(computePositionImprovement_(20, '') === '', 'missing outcome pos');
assert(computePositionImprovement_(null, 12) === '', 'null baseline pos');

// 11/12 D7+D30 without D14 — no invent D14
var sparse = planOutcomeDeltaRows_({
  history: [hist('d3')],
  interventions: [],
  outcomes: [
    oc('d3', 'D7', { imp: 50, clk: 10, guide: 4, pos: 15 }),
    oc('d3', 'D30', { imp: 60, clk: 12, guide: 5, pos: 14 })
  ],
  updatedAt: 't3'
});
var s = sparse.rows[0];
assert(s[10] === 'OBSERVED' && s[22] === 'PENDING' && s[34] === 'OBSERVED', 'no invent D14');
assert(s[23] === '' && s[24] === '', 'D14 empty');

// 13. orphan outcome
var orphan = planOutcomeDeltaRows_({
  history: [hist('real')],
  interventions: [],
  outcomes: [oc('ghost', 'D7', { imp: 99 })],
  updatedAt: 't4'
});
assert(orphan.rows.length === 1 && orphan.rows[0][0] === 'real', 'no orphan row');
assert(orphan.ignoredOrphanOutcomes === 1, 'orphan count');

// 14. idempotent
var once = planOutcomeDeltaRows_({
  history: [hist('idem')],
  interventions: [{ decisionId: 'idem' }, { decisionId: 'idem' }],
  outcomes: [oc('idem', 'D7', { imp: 55, clk: 5, guide: 6, pos: 12 })],
  updatedAt: 'fixed'
});
var twice = planOutcomeDeltaRows_({
  history: [hist('idem')],
  interventions: [{ decisionId: 'idem' }, { decisionId: 'idem' }],
  outcomes: [oc('idem', 'D7', { imp: 55, clk: 5, guide: 6, pos: 12 })],
  updatedAt: 'fixed'
});
assert(JSON.stringify(once.rows) === JSON.stringify(twice.rows), 'idempotent');
assert(once.rows[0][5] === 2, 'multi intervention count');

// missing baseline → delta empty
assert(computeAbsoluteDelta_('', 10) === '', 'missing baseline abs');
assert(computeDeltaPct_('', 10) === '', 'missing baseline pct');

// guide queries delta
assert(r[17] === 6 && r[18] === 2 && r[19] === 0.5, 'guide delta');

var root = path.join(__dirname, '..');
var odSrc = fs.readFileSync(path.join(root, 'OutcomeDelta.gs'), 'utf8');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');

[
  'SUCCESS',
  'FAILURE',
  'WIN_RATE',
  'SUCCESS_RATE',
  'FALSE_POSITIVE',
  'EFFECTIVE',
  'INEFFECTIVE'
].forEach(function (bad) {
  assert(odSrc.indexOf(bad) < 0, 'forbidden ' + bad);
});

assert(/OUTCOME_DELTA:\s*'效果变化'/.test(configSrc), 'sheet name');
assert(
  /SHEET_NAMES\.OUTCOME_DELTA/.test(
    configSrc.match(/var SHEET_UI_ORDER = \[[\s\S]*?\];/)[0]
  ),
  'ui order'
);
assert(/重建效果变化/.test(codeSrc), 'menu');
assert(
  !/function runDaily\([\s\S]*?rebuildOutcomeDelta/.test(codeSrc),
  'not in runDaily'
);
assert(/效果变化：把 Decision Baseline/.test(sheetSrc), 'usage');
assert(
  /replaceSheetDataRows_\(\s*SHEET_NAMES\.OUTCOME_DELTA/.test(odSrc),
  'only writes delta sheet'
);
assert(
  !/replaceSheetDataRows_\(\s*SHEET_NAMES\.(DECISION_HISTORY|DECISION_OUTCOMES|CONTENT_UPDATES|FEEDBACK_SAMPLES|RULE_SCORECARD|EVALUATION_ELIGIBILITY)/.test(
    odSrc
  ),
  'no upstream writes'
);
assert(/ensureSheet_\(SHEET_NAMES\.OUTCOME_DELTA/.test(sheetSrc), 'setup');
assert(/PositionImprovement = BaselineBestPosition/.test(odSrc) || /baselinePos\) - Number\(outcomePos/.test(odSrc), 'pos formula');

var headersMatch = configSrc.match(/var OUTCOME_DELTA_HEADERS\s*=\s*(\[[\s\S]*?\]);/);
assert(headersMatch, 'headers');
var headers = eval(headersMatch[1]);
assert(headers[0] === 'DecisionID' && headers[headers.length - 1] === 'UpdatedAt', 'header ends');
assert(headers.indexOf('D7ImpressionsDeltaPct') > 0, 'd7 pct');
assert(headers.indexOf('D30PositionImprovement') > 0, 'd30 pos');
assert(headers.length === 47, '47 columns, got ' + headers.length);

console.log('PASS scripts/test-outcome-delta.js');
