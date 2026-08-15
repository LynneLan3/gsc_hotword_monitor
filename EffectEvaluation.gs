/**
 * M3-5 Effect Evaluation Cohort V1
 * 派生视图：消费「评价资格」+「效果变化」，标记 Intervention Effect Evaluation cohort。
 * 不做成功/失败/效果好坏判断；不写上游；不重算 Eligibility / Delta / Baseline / Outcome。
 */

/**
 * 菜单入口：重建效果评价。
 */
function rebuildEffectEvaluation() {
  ensureSheet_(SHEET_NAMES.DECISION_HISTORY, DECISION_HISTORY_HEADERS);
  ensureSheet_(SHEET_NAMES.EVALUATION_ELIGIBILITY, EVALUATION_ELIGIBILITY_HEADERS);
  ensureSheet_(SHEET_NAMES.OUTCOME_DELTA, OUTCOME_DELTA_HEADERS);
  ensureSheet_(SHEET_NAMES.EFFECT_EVALUATION, EFFECT_EVALUATION_HEADERS);

  var history = loadEffectEvaluationHistoryIds_();
  var eligibility = loadEffectEvaluationEligibilityRecords_();
  var deltas = loadEffectEvaluationDeltaRecords_();
  var plan = planEffectEvaluationRows_({
    history: history,
    eligibility: eligibility,
    deltas: deltas,
    updatedAt: nowRecordedAt_()
  });

  replaceSheetDataRows_(
    SHEET_NAMES.EFFECT_EVALUATION,
    EFFECT_EVALUATION_HEADERS,
    plan.rows
  );

  writeLog_(
    'INFO',
    '',
    'rebuildEffectEvaluation 结束 rows=' +
      plan.rows.length +
      ' ignoredOrphanEligibility=' +
      plan.ignoredOrphanEligibility +
      ' ignoredOrphanDelta=' +
      plan.ignoredOrphanDelta
  );
  return {
    rows: plan.rows.length,
    ignoredOrphanEligibility: plan.ignoredOrphanEligibility,
    ignoredOrphanDelta: plan.ignoredOrphanDelta
  };
}

/**
 * 纯函数：按 History DecisionID 生成效果评价行。
 * @param {{history:Array, eligibility:Array, deltas:Array, updatedAt:string}} ctx
 */
function planEffectEvaluationRows_(ctx) {
  ctx = ctx || {};
  var history = ctx.history || [];
  var eligibility = ctx.eligibility || [];
  var deltas = ctx.deltas || [];
  var updatedAt = ctx.updatedAt || '';
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

  return {
    rows: rows,
    ignoredOrphanEligibility: ignoredOrphanEligibility,
    ignoredOrphanDelta: ignoredOrphanDelta
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

/**
 * 消费既有 Eligibility：不重算 WAITING_HUMAN / SKIP / NO_INTERVENTION。
 * D30 > D14 > D7 选择最长 ELIGIBLE Horizon。
 */
function classifyEffectEvaluationStatus_(eligibility) {
  eligibility = eligibility || {};
  var d7 = String(eligibility.d7Eligibility || '').trim();
  var d14 = String(eligibility.d14Eligibility || '').trim();
  var d30 = String(eligibility.d30Eligibility || '').trim();

  // 消费既有资格层：三 Horizon 均为 EXCLUDED 时明确不入 cohort
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

/**
 * 对选中 Horizon，检查四项是否可与 Baseline 比较（有效数值，含 0）。
 * 不因 DeltaPct 为空而判不可比较。
 */
function computeComparableMetrics_(delta, horizon) {
  delta = delta || {};
  var hz = String(horizon || '').trim();
  var baseline = {
    impressions: delta.baselineImpressions,
    clicks: delta.baselineClicks,
    guideQueries: delta.baselineGuideQueries,
    bestPosition: delta.baselineBestPosition
  };
  var outcome = horizonOutcomeMetrics_(delta, hz);
  var impressions = isComparableNumericPair_(
    baseline.impressions,
    outcome.impressions
  );
  var clicks = isComparableNumericPair_(baseline.clicks, outcome.clicks);
  var guideQueries = isComparableNumericPair_(
    baseline.guideQueries,
    outcome.guideQueries
  );
  var bestPosition = isComparableNumericPair_(
    baseline.bestPosition,
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

function isValidNumericMetric_(v) {
  if (v === '' || v === null || v === undefined) return false;
  return !isNaN(Number(v));
}

function isComparableNumericPair_(baseline, outcome) {
  return isValidNumericMetric_(baseline) && isValidNumericMetric_(outcome);
}

function loadEffectEvaluationHistoryIds_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DECISION_HISTORY);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, DECISION_HISTORY_HEADERS.length)
    .getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var id = String(values[i][0] || '').trim();
    if (!id) continue;
    out.push({
      decisionId: id,
      decisionDataDate: normalizeKeyDate_(values[i][2]),
      site: String(values[i][3] || '').trim(),
      ruleVersion: String(values[i][4] || '').trim(),
      humanDecision: String(values[i][30] || '').trim()
    });
  }
  return out;
}

function loadEffectEvaluationEligibilityRecords_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.EVALUATION_ELIGIBILITY);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, EVALUATION_ELIGIBILITY_HEADERS.length)
    .getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var id = String(row[0] || '').trim();
    if (!id) continue;
    out.push({
      decisionId: id,
      ruleVersion: String(row[1] || '').trim(),
      decisionDataDate: normalizeKeyDate_(row[2]),
      site: String(row[3] || '').trim(),
      humanDecision: String(row[4] || '').trim(),
      interventionCount: row[5],
      d7Eligibility: String(row[9] || '').trim(),
      d14Eligibility: String(row[10] || '').trim(),
      d30Eligibility: String(row[11] || '').trim(),
      exclusionReason: String(row[12] || '').trim()
    });
  }
  return out;
}

function loadEffectEvaluationDeltaRecords_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.OUTCOME_DELTA);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, OUTCOME_DELTA_HEADERS.length)
    .getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var id = String(row[0] || '').trim();
    if (!id) continue;
    out.push({
      decisionId: id,
      baselineImpressions: row[6],
      baselineClicks: row[7],
      baselineGuideQueries: row[8],
      baselineBestPosition: row[9],
      d7Impressions: row[11],
      d7Clicks: row[14],
      d7GuideQueries: row[17],
      d7BestPosition: row[20],
      d14Impressions: row[23],
      d14Clicks: row[26],
      d14GuideQueries: row[29],
      d14BestPosition: row[32],
      d30Impressions: row[35],
      d30Clicks: row[38],
      d30GuideQueries: row[41],
      d30BestPosition: row[44]
    });
  }
  return out;
}
