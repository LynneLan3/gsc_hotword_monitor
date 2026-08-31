/**
 * M3-5/M3-6 本地自测：Effect Evaluation Cohort + Evidence Contract（不依赖 SpreadsheetApp）。
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

var EFFECT_EVIDENCE_STATUS = {
  NOT_READY: 'NOT_READY',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  COMPARABLE: 'COMPARABLE'
};

var EFFECT_EVIDENCE_REASON = {
  TOO_FEW_COMPARABLE_METRICS: 'TOO_FEW_COMPARABLE_METRICS',
  LOW_SEARCH_VOLUME: 'LOW_SEARCH_VOLUME'
};

var EFFECT_EVIDENCE_V1 = {
  MIN_COMPARABLE_METRICS: 2,
  MIN_IMPRESSIONS_VOLUME: 10,
  MIN_GUIDE_QUERIES_VOLUME: 3
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

function passesEffectEvidenceSearchVolumeGate_(delta, horizon) {
  delta = delta || {};
  var outcome = horizonOutcomeMetrics_(delta, horizon);
  var minImp = EFFECT_EVIDENCE_V1.MIN_IMPRESSIONS_VOLUME;
  var minGuide = EFFECT_EVIDENCE_V1.MIN_GUIDE_QUERIES_VOLUME;

  var impressionsOk =
    isValidNumericMetric_(delta.baselineImpressions) &&
    isValidNumericMetric_(outcome.impressions) &&
    Math.max(
      Number(delta.baselineImpressions),
      Number(outcome.impressions)
    ) >= minImp;

  var guideOk =
    isValidNumericMetric_(delta.baselineGuideQueries) &&
    isValidNumericMetric_(outcome.guideQueries) &&
    Math.max(
      Number(delta.baselineGuideQueries),
      Number(outcome.guideQueries)
    ) >= minGuide;

  return !!(impressionsOk || guideOk);
}

function classifyEffectEvidence_(input) {
  input = input || {};
  var evaluationStatus = String(input.evaluationStatus || '').trim();
  if (evaluationStatus !== EFFECT_EVALUATION_STATUS.READY) {
    return { status: EFFECT_EVIDENCE_STATUS.NOT_READY, reason: '' };
  }

  var comparableCount = Number(input.comparableCount || 0);
  if (comparableCount < EFFECT_EVIDENCE_V1.MIN_COMPARABLE_METRICS) {
    return {
      status: EFFECT_EVIDENCE_STATUS.INSUFFICIENT_EVIDENCE,
      reason: EFFECT_EVIDENCE_REASON.TOO_FEW_COMPARABLE_METRICS
    };
  }

  if (!passesEffectEvidenceSearchVolumeGate_(input.delta, input.horizon)) {
    return {
      status: EFFECT_EVIDENCE_STATUS.INSUFFICIENT_EVIDENCE,
      reason: EFFECT_EVIDENCE_REASON.LOW_SEARCH_VOLUME
    };
  }

  return { status: EFFECT_EVIDENCE_STATUS.COMPARABLE, reason: '' };
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
  var evidence = classifyEffectEvidence_({
    evaluationStatus: judged.status,
    comparableCount: Number(comparable.count || 0),
    delta: delta,
    horizon: horizon
  });

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
    evidence.status,
    evidence.reason,
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

// 2. all EXCLUDED → NOT_READY
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
assert(excluded.rows[0][13] === 'NOT_READY', 'excluded evidence NOT_READY');
assert(excluded.rows[0][14] === '', 'excluded evidence reason empty');

// 3. all PENDING → PENDING / NOT_READY
var pending = planEffectEvaluationRows_({
  history: [hist('d-pend')],
  eligibility: [elig('d-pend', { d7: 'PENDING', d14: 'PENDING', d30: 'PENDING' })],
  deltas: [delta('d-pend')],
  updatedAt: 't2'
});
assert(pending.rows[0][6] === 'PENDING', 'pending');
assert(pending.rows[0][7] === '', 'pending horizon empty');
assert(pending.rows[0][13] === 'NOT_READY', 'pending evidence NOT_READY');
assert(pending.rows[0][14] === '', 'pending evidence reason empty');

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
assert(onlyD7.rows[0][13] === 'COMPARABLE', 'ready D7 comparable evidence');

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

// 13. READY + count 0 still READY, Evidence TOO_FEW
var readyZero = planEffectEvaluationRows_({
  history: [hist('rz')],
  eligibility: [elig('rz', { d7: 'ELIGIBLE' })],
  deltas: [delta('rz', { bImp: '', bClk: '', bGuide: '', bPos: '' })],
  updatedAt: 't4'
});
assert(readyZero.rows[0][6] === 'READY', 'ready with 0 comparable');
assert(readyZero.rows[0][7] === 'D7', 'horizon D7');
assert(readyZero.rows[0][8] === 0, 'count 0');
assert(readyZero.rows[0][13] === 'INSUFFICIENT_EVIDENCE', 'ready0 insufficient');
assert(readyZero.rows[0][14] === 'TOO_FEW_COMPARABLE_METRICS', 'ready0 too few');

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
assert(once.rows[0][13] === 'COMPARABLE', 'idem comparable');

// --- M3-6 Evidence Contract ---

// READY + Count=1 → TOO_FEW
var count1 = planEffectEvaluationRows_({
  history: [hist('c1')],
  eligibility: [elig('c1', { d7: 'ELIGIBLE' })],
  deltas: [
    delta('c1', {
      bImp: 100,
      bClk: '',
      bGuide: '',
      bPos: '',
      d7Imp: 120,
      d7Clk: '',
      d7Guide: '',
      d7Pos: ''
    })
  ],
  updatedAt: 'e1'
});
assert(count1.rows[0][8] === 1, 'count1');
assert(count1.rows[0][13] === 'INSUFFICIENT_EVIDENCE', 'count1 status');
assert(count1.rows[0][14] === 'TOO_FEW_COMPARABLE_METRICS', 'count1 reason');

// READY + Count>=2 but Imp<10 and Guide<3 → LOW_SEARCH_VOLUME
var lowVol = planEffectEvaluationRows_({
  history: [hist('lv')],
  eligibility: [elig('lv', { d7: 'ELIGIBLE' })],
  deltas: [
    delta('lv', {
      bImp: 2,
      bClk: 1,
      bGuide: 1,
      bPos: 20,
      d7Imp: 3,
      d7Clk: 1,
      d7Guide: 1,
      d7Pos: 18
    })
  ],
  updatedAt: 'e2'
});
assert(lowVol.rows[0][8] >= 2, 'lowVol count');
assert(lowVol.rows[0][13] === 'INSUFFICIENT_EVIDENCE', 'lowVol status');
assert(lowVol.rows[0][14] === 'LOW_SEARCH_VOLUME', 'lowVol reason');

// BaselineImp=1 → OutcomeImp=2 (+100%) → still LOW_SEARCH_VOLUME
var pct100 = planEffectEvaluationRows_({
  history: [hist('pct')],
  eligibility: [elig('pct', { d7: 'ELIGIBLE' })],
  deltas: [
    delta('pct', {
      bImp: 1,
      bClk: 0,
      bGuide: 1,
      bPos: 8,
      d7Imp: 2,
      d7Clk: 1,
      d7Guide: 1,
      d7Pos: 5
    })
  ],
  updatedAt: 'e3'
});
assert(pct100.rows[0][13] === 'INSUFFICIENT_EVIDENCE', 'pct100 status');
assert(pct100.rows[0][14] === 'LOW_SEARCH_VOLUME', 'pct100 not fooled by +100%');

// BaselineImp=0 → OutcomeImp=15 → volume gate pass
var zeroTo15 = planEffectEvaluationRows_({
  history: [hist('z15')],
  eligibility: [elig('z15', { d7: 'ELIGIBLE' })],
  deltas: [
    delta('z15', {
      bImp: 0,
      bClk: 0,
      bGuide: 1,
      bPos: 20,
      d7Imp: 15,
      d7Clk: 1,
      d7Guide: 1,
      d7Pos: 18
    })
  ],
  updatedAt: 'e4'
});
assert(zeroTo15.rows[0][8] >= 2, 'z15 count');
assert(zeroTo15.rows[0][13] === 'COMPARABLE', 'z15 comparable via imp volume');
assert(zeroTo15.rows[0][14] === '', 'z15 reason empty');

// GuideQueries>=3 + Count>=2 → COMPARABLE (even if Imp low)
var guideVol = planEffectEvaluationRows_({
  history: [hist('gv')],
  eligibility: [elig('gv', { d7: 'ELIGIBLE' })],
  deltas: [
    delta('gv', {
      bImp: 1,
      bClk: 0,
      bGuide: 3,
      bPos: 20,
      d7Imp: 2,
      d7Clk: 0,
      d7Guide: 4,
      d7Pos: 18
    })
  ],
  updatedAt: 'e5'
});
assert(guideVol.rows[0][13] === 'COMPARABLE', 'guide volume ok');

// Clicks high but Imp/Guide low → cannot pass volume alone
var clicksOnly = planEffectEvaluationRows_({
  history: [hist('clk')],
  eligibility: [elig('clk', { d7: 'ELIGIBLE' })],
  deltas: [
    delta('clk', {
      bImp: 1,
      bClk: 100,
      bGuide: 1,
      bPos: 20,
      d7Imp: 2,
      d7Clk: 200,
      d7Guide: 1,
      d7Pos: 18
    })
  ],
  updatedAt: 'e6'
});
assert(clicksOnly.rows[0][8] >= 2, 'clicks count ok');
assert(clicksOnly.rows[0][13] === 'INSUFFICIENT_EVIDENCE', 'clicks not volume');
assert(clicksOnly.rows[0][14] === 'LOW_SEARCH_VOLUME', 'clicks LOW_SEARCH_VOLUME');

// BestPosition good but Imp/Guide low
var posOnly = planEffectEvaluationRows_({
  history: [hist('pos')],
  eligibility: [elig('pos', { d7: 'ELIGIBLE' })],
  deltas: [
    delta('pos', {
      bImp: 1,
      bClk: 0,
      bGuide: 1,
      bPos: 8,
      d7Imp: 1,
      d7Clk: 0,
      d7Guide: 1,
      d7Pos: 5
    })
  ],
  updatedAt: 'e7'
});
assert(posOnly.rows[0][13] === 'INSUFFICIENT_EVIDENCE', 'pos not volume');
assert(posOnly.rows[0][14] === 'LOW_SEARCH_VOLUME', 'pos LOW_SEARCH_VOLUME');

// Only BestPosition comparable → TOO_FEW
var onlyPos = planEffectEvaluationRows_({
  history: [hist('op')],
  eligibility: [elig('op', { d7: 'ELIGIBLE' })],
  deltas: [
    delta('op', {
      bImp: '',
      bClk: '',
      bGuide: '',
      bPos: 8,
      d7Imp: '',
      d7Clk: '',
      d7Guide: '',
      d7Pos: 5
    })
  ],
  updatedAt: 'e8'
});
assert(onlyPos.rows[0][8] === 1, 'onlyPos count 1');
assert(onlyPos.rows[0][14] === 'TOO_FEW_COMPARABLE_METRICS', 'onlyPos too few');

// Declining metrics but evidence ok → still COMPARABLE
var declined = planEffectEvaluationRows_({
  history: [hist('dec')],
  eligibility: [elig('dec', { d14: 'ELIGIBLE' })],
  deltas: [
    delta('dec', {
      bImp: 100,
      bClk: 5,
      bGuide: 4,
      bPos: 10,
      d14Imp: 90,
      d14Clk: 4,
      d14Guide: 3,
      d14Pos: 12
    })
  ],
  updatedAt: 'e9'
});
assert(declined.rows[0][7] === 'D14', 'declined uses D14');
assert(declined.rows[0][13] === 'COMPARABLE', 'declined still COMPARABLE');
assert(declined.rows[0][14] === '', 'declined reason empty');

// Horizon strict: D30 preferred when ELIGIBLE; volume uses D30 not D7
var hzStrict = planEffectEvaluationRows_({
  history: [hist('hz')],
  eligibility: [
    elig('hz', { d7: 'ELIGIBLE', d14: 'ELIGIBLE', d30: 'ELIGIBLE' })
  ],
  deltas: [
    delta('hz', {
      bImp: 100,
      bClk: 10,
      bGuide: 5,
      bPos: 20,
      d7Imp: 2,
      d7Clk: 1,
      d7Guide: 1,
      d7Pos: 18,
      d14Imp: 3,
      d14Clk: 1,
      d14Guide: 1,
      d14Pos: 17,
      d30Imp: 50,
      d30Clk: 8,
      d30Guide: 6,
      d30Pos: 15
    })
  ],
  updatedAt: 'e10'
});
assert(hzStrict.rows[0][7] === 'D30', 'horizon D30');
assert(hzStrict.rows[0][13] === 'COMPARABLE', 'D30 volume used');

// D7 ELIGIBLE only → must use D7 (even if D30 numbers look bigger but not eligible)
var hzD7Only = planEffectEvaluationRows_({
  history: [hist('hz7')],
  eligibility: [elig('hz7', { d7: 'ELIGIBLE', d14: 'PENDING', d30: 'PENDING' })],
  deltas: [
    delta('hz7', {
      bImp: 2,
      bClk: 1,
      bGuide: 1,
      bPos: 20,
      d7Imp: 3,
      d7Clk: 1,
      d7Guide: 1,
      d7Pos: 18,
      d30Imp: 100,
      d30Clk: 20,
      d30Guide: 10,
      d30Pos: 5
    })
  ],
  updatedAt: 'e11'
});
assert(hzD7Only.rows[0][7] === 'D7', 'must use D7 horizon');
assert(hzD7Only.rows[0][14] === 'LOW_SEARCH_VOLUME', 'must not peek D30 volume');

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
  'DECLINED',
  'MIXED',
  'UNCHANGED',
  'WIN',
  'LOSS',
  'FALSE_NEGATIVE'
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
assert(!/\.addItem\('重建效果评价'/.test(codeSrc), 'retired menu hidden');
assert(
  !/function runDaily\([\s\S]*?rebuildEffectEvaluation/.test(codeSrc),
  'not in runDaily'
);
assert(/效果评价：基于「评价资格」/.test(sheetSrc), 'usage');
assert(/EvidenceStatus/.test(sheetSrc), 'usage mentions Evidence');
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
assert(!/ExclusionReason\s*=\s*WAITING_HUMAN/.test(eeSrc), 'no re-implement reasons');
assert(/classifyEffectEvidence_/.test(eeSrc), 'evidence classifier');
assert(/ensureEffectEvaluationHeader_/.test(eeSrc), 'header ensure');
assert(/EFFECT_EVIDENCE_V1/.test(configSrc), 'v1 thresholds');
assert(/项目 V1 实验阈值/.test(configSrc), 'v1 disclaimer in metrics');

var headersMatch = configSrc.match(
  /var EFFECT_EVALUATION_HEADERS\s*=\s*(\[[\s\S]*?\]);/
);
assert(headersMatch, 'headers');
var headers = eval(headersMatch[1]);
assert(headers.length === 16, '16 cols');
assert(headers[6] === 'EvaluationStatus' && headers[7] === 'EvaluationHorizon', 'status fields');
assert(headers[13] === 'EvidenceStatus' && headers[14] === 'EvidenceReason', 'evidence fields');
assert(headers.indexOf('EvidenceMetricCount') < 0, 'no redundant EvidenceMetricCount');

console.log('PASS scripts/test-effect-evaluation.js');
