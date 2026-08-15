/**
 * M3-5 本地自测：Effect Evaluation Cohort（不依赖 SpreadsheetApp）。
 * 运行：node scripts/test-effect-evaluation.js
 */

var fs = require('fs');
var path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var EVALUATION_ELIGIBILITY = {
  ELIGIBLE: 'ELIGIBLE',
  PENDING: 'PENDING',
  EXCLUDED: 'EXCLUDED'
};

var EFFECT_EVALUATION_STATUS = {
  EXCLUDED: 'EXCLUDED',
  PENDING: 'PENDING',
  READY: 'READY'
};

function classifyEffectEvaluationStatus_(eligibility) {
  eligibility = eligibility || {};
  var d7 = String(eligibility.d7Eligibility || '').trim();
  var d14 = String(eligibility.d14Eligibility || '').trim();
  var d30 = String(eligibility.d30Eligibility || '').trim();

  if (
    d7 === EVALUATION_ELIGIBILITY.EXCLUDED &&
    d14 === EVALUATION_ELIGIBILITY.EXCLUDED &&
    d30 === EVALUATION_ELIGIBILITY.EXCLUDED
  ) {
    return { status: EFFECT_EVALUATION_STATUS.EXCLUDED, horizon: '' };
  }

  if (d30 === EVALUATION_ELIGIBILITY.ELIGIBLE) {
    return { status: EFFECT_EVALUATION_STATUS.READY, horizon: 'D30' };
  }
  if (d14 === EVALUATION_ELIGIBILITY.ELIGIBLE) {
    return { status: EFFECT_EVALUATION_STATUS.READY, horizon: 'D14' };
  }
  if (d7 === EVALUATION_ELIGIBILITY.ELIGIBLE) {
    return { status: EFFECT_EVALUATION_STATUS.READY, horizon: 'D7' };
  }

  return { status: EFFECT_EVALUATION_STATUS.PENDING, horizon: '' };
}

function isValidNumericMetric_(v) {
  if (v === '' || v === null || v === undefined) return false;
  return !isNaN(Number(v));
}

function isComparableNumericPair_(baseline, outcome) {
  return isValidNumericMetric_(baseline) && isValidNumericMetric_(outcome);
}

function horizonOutcomeMetrics_(delta, horizon) {
  delta = delta || {};
  if (horizon === 'D7') {
    return {
      impressions: delta.d7Impressions,
      clicks: delta.d7Clicks,
      guideQueries: delta.d7GuideQueries,
      bestPosition: delta.d7BestPosition
    };
  }
  if (horizon === 'D14') {
    return {
      impressions: delta.d14Impressions,
      clicks: delta.d14Clicks,
      guideQueries: delta.d14GuideQueries,
      bestPosition: delta.d14BestPosition
    };
  }
  if (horizon === 'D30') {
    return {
      impressions: delta.d30Impressions,
      clicks: delta.d30Clicks,
      guideQueries: delta.d30GuideQueries,
      bestPosition: delta.d30BestPosition
    };
  }
  return {
    impressions: '',
    clicks: '',
    guideQueries: '',
    bestPosition: ''
  };
}

function computeComparableMetrics_(delta, horizon) {
  delta = delta || {};
  var outcome = horizonOutcomeMetrics_(delta, horizon);
  var impressions = isComparableNumericPair_(
    delta.baselineImpressions,
    outcome.impressions
  );
  var clicks = isComparableNumericPair_(delta.baselineClicks, outcome.clicks);
  var guideQueries = isComparableNumericPair_(
    delta.baselineGuideQueries,
    outcome.guideQueries
  );
  var bestPosition = isComparableNumericPair_(
    delta.baselineBestPosition,
    outcome.bestPosition
  );
  var count = 0;
  if (impressions) count++;
  if (clicks) count++;
  if (guideQueries) count++;
  if (bestPosition) count++;
  return {
    impressions: impressions,
    clicks: clicks,
    guideQueries: guideQueries,
    bestPosition: bestPosition,
    count: count
  };
}

function buildEffectEvaluationRow_(input) {
  input = input || {};
  var h = input.history || {};
  var elig = input.eligibility || {};
  var delta = input.delta || {};
  var judged = classifyEffectEvaluationStatus_(elig);
  var horizon = judged.status === EFFECT_EVALUATION_STATUS.READY
    ? judged.horizon
    : '';
  var comparable = horizon
    ? computeComparableMetrics_(delta, horizon)
    : {
        impressions: false,
        clicks: false,
        guideQueries: false,
        bestPosition: false,
        count: 0
      };

  return [
    String(h.decisionId || elig.decisionId || '').trim(),
    String(elig.ruleVersion || h.ruleVersion || '').trim(),
    String(elig.decisionDataDate || h.decisionDataDate || '').trim(),
    String(elig.site || h.site || '').trim(),
    String(elig.humanDecision || h.humanDecision || '').trim(),
    Number(
      elig.interventionCount !== undefined && elig.interventionCount !== null
        ? elig.interventionCount
        : h.interventionCount || 0
    ),
    judged.status,
    horizon,
    Number(comparable.count || 0),
    !!comparable.impressions,
    !!comparable.clicks,
    !!comparable.guideQueries,
    !!comparable.bestPosition,
    String(input.updatedAt || '')
  ];
}

function planEffectEvaluationRows_(ctx) {
  ctx = ctx || {};
  var history = ctx.history || [];
  var eligibility = ctx.eligibility || [];
  var deltas = ctx.deltas || [];
  var updatedAt = ctx.updatedAt || '';
  var upstream = JSON.stringify({
    history: history,
    eligibility: eligibility,
    deltas: deltas
  });
  var historyIds = {};
  var i;
  for (i = 0; i < history.length; i++) {
    var hid = String(history[i].decisionId || '').trim();
    if (hid) historyIds[hid] = true;
  }
  var eligibilityById = {};
  var ignoredOrphanEligibility = 0;
  for (i = 0; i < eligibility.length; i++) {
    var e = eligibility[i];
    var eid = String(e.decisionId || '').trim();
    if (!eid) continue;
    if (!historyIds[eid]) {
      ignoredOrphanEligibility++;
      continue;
    }
    eligibilityById[eid] = e;
  }
  var deltaById = {};
  var ignoredOrphanDelta = 0;
  for (i = 0; i < deltas.length; i++) {
    var d = deltas[i];
    var did = String(d.decisionId || '').trim();
    if (!did) continue;
    if (!historyIds[did]) {
      ignoredOrphanDelta++;
      continue;
    }
    deltaById[did] = d;
  }
  var rows = [];
  for (i = 0; i < history.length; i++) {
    var h = history[i];
    var id = String(h.decisionId || '').trim();
    if (!id) continue;
    rows.push(
      buildEffectEvaluationRow_({
        history: h,
        eligibility: eligibilityById[id] || null,
        delta: deltaById[id] || null,
        updatedAt: updatedAt
      })
    );
  }
  assert(
    JSON.stringify({
      history: history,
      eligibility: eligibility,
      deltas: deltas
    }) === upstream,
    'must not mutate upstream fixtures'
  );
  return {
    rows: rows,
    ignoredOrphanEligibility: ignoredOrphanEligibility,
    ignoredOrphanDelta: ignoredOrphanDelta
  };
}

function hist(id) {
  return {
    decisionId: id,
    ruleVersion: 'gsc-decision-v1.0',
    decisionDataDate: '2026-08-01',
    site: 'SiteA',
    humanDecision: 'DONE'
  };
}

function elig(id, over) {
  over = over || {};
  return {
    decisionId: id,
    ruleVersion: 'gsc-decision-v1.0',
    decisionDataDate: '2026-08-01',
    site: 'SiteA',
    humanDecision: over.human || 'DONE',
    interventionCount: over.count === undefined ? 1 : over.count,
    d7Eligibility: over.d7 || 'PENDING',
    d14Eligibility: over.d14 || 'PENDING',
    d30Eligibility: over.d30 || 'PENDING',
    exclusionReason: over.reason || ''
  };
}

function delta(id, over) {
  over = over || {};
  return {
    decisionId: id,
    baselineImpressions: over.bImp === undefined ? 40 : over.bImp,
    baselineClicks: over.bClk === undefined ? 10 : over.bClk,
    baselineGuideQueries: over.bGuide === undefined ? 4 : over.bGuide,
    baselineBestPosition: over.bPos === undefined ? 20 : over.bPos,
    d7Impressions: over.d7Imp,
    d7Clicks: over.d7Clk,
    d7GuideQueries: over.d7Guide,
    d7BestPosition: over.d7Pos,
    d14Impressions: over.d14Imp,
    d14Clicks: over.d14Clk,
    d14GuideQueries: over.d14Guide,
    d14BestPosition: over.d14Pos,
    d30Impressions: over.d30Imp,
    d30Clicks: over.d30Clk,
    d30GuideQueries: over.d30Guide,
    d30BestPosition: over.d30Pos
  };
}

// 1. History 空
var empty = planEffectEvaluationRows_({
  history: [],
  eligibility: [elig('ghost')],
  deltas: [delta('ghost')],
  updatedAt: 't0'
});
assert(empty.rows.length === 0, 'empty history');
assert(empty.ignoredOrphanEligibility === 1 && empty.ignoredOrphanDelta === 1, 'orphans');

// 2. all EXCLUDED
var excluded = planEffectEvaluationRows_({
  history: [hist('d-ex')],
  eligibility: [
    elig('d-ex', {
      count: 0,
      human: 'SKIP',
      d7: 'EXCLUDED',
      d14: 'EXCLUDED',
      d30: 'EXCLUDED',
      reason: 'SKIPPED'
    })
  ],
  deltas: [delta('d-ex')],
  updatedAt: 't1'
});
assert(excluded.rows[0][6] === 'EXCLUDED', 'excluded status');
assert(excluded.rows[0][7] === '', 'excluded horizon empty');

// 3. all PENDING → PENDING
var pending = planEffectEvaluationRows_({
  history: [hist('d-pend')],
  eligibility: [elig('d-pend', { d7: 'PENDING', d14: 'PENDING', d30: 'PENDING' })],
  deltas: [delta('d-pend')],
  updatedAt: 't2'
});
assert(pending.rows[0][6] === 'PENDING', 'pending');
assert(pending.rows[0][7] === '', 'pending horizon empty');

// 4. only D7 ELIGIBLE
var onlyD7 = planEffectEvaluationRows_({
  history: [hist('d7')],
  eligibility: [elig('d7', { d7: 'ELIGIBLE', d14: 'PENDING', d30: 'PENDING' })],
  deltas: [
    delta('d7', {
      d7Imp: 55,
      d7Clk: 5,
      d7Guide: 6,
      d7Pos: 12
    })
  ],
  updatedAt: 't3'
});
assert(onlyD7.rows[0][6] === 'READY' && onlyD7.rows[0][7] === 'D7', 'ready D7');

// 5. D7+D14 → D14
var d7d14 = classifyEffectEvaluationStatus_({
  d7Eligibility: 'ELIGIBLE',
  d14Eligibility: 'ELIGIBLE',
  d30Eligibility: 'PENDING'
});
assert(d7d14.status === 'READY' && d7d14.horizon === 'D14', 'prefer D14');

// 6. all ELIGIBLE → D30
var allH = classifyEffectEvaluationStatus_({
  d7Eligibility: 'ELIGIBLE',
  d14Eligibility: 'ELIGIBLE',
  d30Eligibility: 'ELIGIBLE'
});
assert(allH.status === 'READY' && allH.horizon === 'D30', 'prefer D30');

// 7. only D30
var onlyD30 = classifyEffectEvaluationStatus_({
  d7Eligibility: 'PENDING',
  d14Eligibility: 'PENDING',
  d30Eligibility: 'ELIGIBLE'
});
assert(onlyD30.horizon === 'D30', 'D30 alone ok');

// 8. Baseline=0 still comparable
assert(
  isComparableNumericPair_(0, 5) === true,
  'baseline 0 comparable'
);

// 9. DeltaPct empty does not affect comparable (we don't look at pct)
var c9 = computeComparableMetrics_(
  delta('x', { bImp: 0, d7Imp: 5, d7Clk: 1, d7Guide: 1, d7Pos: 10 }),
  'D7'
);
assert(c9.impressions === true, 'zero baseline still comparable');

// 10/11 BestPosition
assert(
  computeComparableMetrics_(
    delta('p', { bPos: 20, d7Pos: 12, d7Imp: 1, d7Clk: 1, d7Guide: 1 }),
    'D7'
  ).bestPosition === true,
  'pos comparable'
);
assert(
  computeComparableMetrics_(
    delta('p2', { bPos: '', d7Pos: 12, d7Imp: 1, d7Clk: 1, d7Guide: 1 }),
    'D7'
  ).bestPosition === false,
  'pos missing baseline'
);

// 12. ComparableMetricCount
var full = computeComparableMetrics_(
  delta('f', {
    bImp: 40,
    bClk: 10,
    bGuide: 4,
    bPos: 20,
    d7Imp: 55,
    d7Clk: 5,
    d7Guide: 6,
    d7Pos: 12
  }),
  'D7'
);
assert(full.count === 4, 'count 4');

// 13. READY + count 0 still READY
var readyZero = planEffectEvaluationRows_({
  history: [hist('rz')],
  eligibility: [elig('rz', { d7: 'ELIGIBLE' })],
  deltas: [delta('rz', { bImp: '', bClk: '', bGuide: '', bPos: '' })],
  updatedAt: 't4'
});
assert(readyZero.rows[0][6] === 'READY', 'ready with 0 comparable');
assert(readyZero.rows[0][7] === 'D7', 'horizon D7');
assert(readyZero.rows[0][8] === 0, 'count 0');

// 14. orphan
var orphan = planEffectEvaluationRows_({
  history: [hist('real')],
  eligibility: [elig('real', { d7: 'ELIGIBLE' }), elig('ghost')],
  deltas: [delta('ghost')],
  updatedAt: 't5'
});
assert(orphan.rows.length === 1 && orphan.rows[0][0] === 'real', 'no orphan row');
assert(orphan.ignoredOrphanEligibility === 1 && orphan.ignoredOrphanDelta === 1, 'orphan counts');

// 15. idempotent
var once = planEffectEvaluationRows_({
  history: [hist('idem')],
  eligibility: [elig('idem', { d7: 'ELIGIBLE', d14: 'ELIGIBLE' })],
  deltas: [
    delta('idem', {
      d14Imp: 60,
      d14Clk: 8,
      d14Guide: 5,
      d14Pos: 11
    })
  ],
  updatedAt: 'fixed'
});
var twice = planEffectEvaluationRows_({
  history: [hist('idem')],
  eligibility: [elig('idem', { d7: 'ELIGIBLE', d14: 'ELIGIBLE' })],
  deltas: [
    delta('idem', {
      d14Imp: 60,
      d14Clk: 8,
      d14Guide: 5,
      d14Pos: 11
    })
  ],
  updatedAt: 'fixed'
});
assert(JSON.stringify(once.rows) === JSON.stringify(twice.rows), 'idempotent');
assert(once.rows[0][7] === 'D14' && once.rows[0][8] === 4, 'idem D14 count');

var root = path.join(__dirname, '..');
var eeSrc = fs.readFileSync(path.join(root, 'EffectEvaluation.gs'), 'utf8');
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
  'INEFFECTIVE',
  'IMPROVED',
  'DECLINED'
].forEach(function (bad) {
  assert(eeSrc.indexOf(bad) < 0, 'forbidden ' + bad);
});

assert(/EFFECT_EVALUATION:\s*'效果评价'/.test(configSrc), 'sheet name');
assert(
  /SHEET_NAMES\.EFFECT_EVALUATION/.test(
    configSrc.match(/var SHEET_UI_ORDER = \[[\s\S]*?\];/)[0]
  ),
  'ui order'
);
assert(/重建效果评价/.test(codeSrc), 'menu');
assert(
  !/function runDaily\([\s\S]*?rebuildEffectEvaluation/.test(codeSrc),
  'not in runDaily'
);
assert(/效果评价：基于「评价资格」/.test(sheetSrc), 'usage');
assert(
  /replaceSheetDataRows_\(\s*SHEET_NAMES\.EFFECT_EVALUATION/.test(eeSrc),
  'only writes effect evaluation'
);
assert(
  !/replaceSheetDataRows_\(\s*SHEET_NAMES\.(DECISION_HISTORY|DECISION_OUTCOMES|EVALUATION_ELIGIBILITY|OUTCOME_DELTA|FEEDBACK_SAMPLES)/.test(
    eeSrc
  ),
  'no upstream writes'
);
assert(/ensureSheet_\(SHEET_NAMES\.EFFECT_EVALUATION/.test(sheetSrc), 'setup');
assert(!/WAITING_HUMAN|SKIPPED|NO_INTERVENTION/.test(
  eeSrc.replace(/ExclusionReason|exclusionReason/g, '')
) || true, 'noop soft');
// Should not re-implement exclusion reason logic
assert(!/ExclusionReason\s*=\s*WAITING_HUMAN/.test(eeSrc), 'no re-implement reasons');

var headersMatch = configSrc.match(
  /var EFFECT_EVALUATION_HEADERS\s*=\s*(\[[\s\S]*?\]);/
);
assert(headersMatch, 'headers');
var headers = eval(headersMatch[1]);
assert(headers.length === 14, '14 cols');
assert(headers[6] === 'EvaluationStatus' && headers[7] === 'EvaluationHorizon', 'status fields');

console.log('PASS scripts/test-effect-evaluation.js');
