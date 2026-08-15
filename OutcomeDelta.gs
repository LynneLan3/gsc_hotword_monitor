/**
 * M3-4 Outcome Delta View V1
 * 派生视图：Decision Baseline 7D 与真实 D7/D14/D30 Outcome 的指标变化。
 * 不做成功/失败评价；不写上游事实表；不重算 Baseline / Outcome。
 */

/**
 * 菜单入口：重建效果变化。
 */
function rebuildOutcomeDelta() {
  ensureSheet_(SHEET_NAMES.DECISION_HISTORY, DECISION_HISTORY_HEADERS);
  ensureSheet_(SHEET_NAMES.DECISION_OUTCOMES, DECISION_OUTCOME_HEADERS);
  ensureSheet_(SHEET_NAMES.CONTENT_UPDATES, CONTENT_UPDATE_HEADERS);
  ensureContentUpdateHeader_();
  ensureSheet_(SHEET_NAMES.OUTCOME_DELTA, OUTCOME_DELTA_HEADERS);

  var history = loadOutcomeDeltaHistoryRecords_();
  var interventions = loadFeedbackInterventionRecords_();
  var outcomes = loadFeedbackOutcomeRecords_();
  var plan = planOutcomeDeltaRows_({
    history: history,
    interventions: interventions,
    outcomes: outcomes,
    updatedAt: nowRecordedAt_()
  });

  replaceSheetDataRows_(
    SHEET_NAMES.OUTCOME_DELTA,
    OUTCOME_DELTA_HEADERS,
    plan.rows
  );

  writeLog_(
    'INFO',
    '',
    'rebuildOutcomeDelta 结束 rows=' +
      plan.rows.length +
      ' ignoredOrphanOutcomes=' +
      plan.ignoredOrphanOutcomes
  );
  return {
    rows: plan.rows.length,
    ignoredOrphanOutcomes: plan.ignoredOrphanOutcomes
  };
}

/**
 * 纯函数：按 DecisionID 生成效果变化行。
 * @param {{history:Array, interventions:Array, outcomes:Array, updatedAt:string}} ctx
 * @return {{rows:Array<Array>, ignoredOrphanOutcomes:number}}
 */
function planOutcomeDeltaRows_(ctx) {
  ctx = ctx || {};
  var history = ctx.history || [];
  var interventions = ctx.interventions || [];
  var outcomes = ctx.outcomes || [];
  var updatedAt = ctx.updatedAt || '';
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

  return {
    rows: rows,
    ignoredOrphanOutcomes: ignoredOrphanOutcomes
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

/**
 * 单 Horizon 变化块。无真实 Outcome → PENDING，Outcome/Delta 全空。
 */
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

function isMissingMetric_(v) {
  return v === '' || v === null || v === undefined;
}

function blankIfMissing_(v) {
  return isMissingMetric_(v) ? '' : v;
}

/** Outcome − Baseline；任一缺失则空。Baseline=0 时仍可算绝对差。 */
function computeAbsoluteDelta_(baseline, outcome) {
  if (isMissingMetric_(baseline) || isMissingMetric_(outcome)) return '';
  return Number(outcome) - Number(baseline);
}

/**
 * (Outcome − Baseline) / Baseline；仅 Baseline > 0 时计算。
 * Baseline=0 时留空（不写 Infinity / 伪增长率）。
 */
function computeDeltaPct_(baseline, outcome) {
  if (isMissingMetric_(baseline) || isMissingMetric_(outcome)) return '';
  var b = Number(baseline);
  if (!(b > 0)) return '';
  return (Number(outcome) - b) / b;
}

/**
 * PositionImprovement = BaselineBestPosition − OutcomeBestPosition。
 * 正数表示排名提升（数字变小）。
 */
function computePositionImprovement_(baselinePos, outcomePos) {
  if (isMissingMetric_(baselinePos) || isMissingMetric_(outcomePos)) return '';
  return Number(baselinePos) - Number(outcomePos);
}

/**
 * 决策历史 + Baseline（权威 Snapshot）。
 */
function loadOutcomeDeltaHistoryRecords_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DECISION_HISTORY);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, DECISION_HISTORY_HEADERS.length)
    .getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var id = String(row[0] || '').trim();
    if (!id) continue;
    out.push({
      decisionId: id,
      decisionDataDate: normalizeKeyDate_(row[2]),
      site: String(row[3] || '').trim(),
      ruleVersion: String(row[4] || '').trim(),
      humanDecision: String(row[30] || '').trim(),
      baselineImpressions: row[35],
      baselineClicks: row[36],
      baselineGuideQueryCount: row[38],
      baselineBestPosition: row[41]
    });
  }
  return out;
}
