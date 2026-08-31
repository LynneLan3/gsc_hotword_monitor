/**
 * M3-2 Evaluation Contract V1 — Intervention Evaluation Eligibility
 * 派生视图：判断 Decision 在各 Horizon 是否有资格进入后续 Intervention Outcome Evaluation。
 * 不做效果好坏判定；不调规则；不写上游事实表；不重算 Outcome。
 */

/**
 * 菜单入口：重建评价资格。
 */
function rebuildEvaluationEligibility() {
  ensureSheet_(SHEET_NAMES.DECISION_HISTORY, DECISION_HISTORY_HEADERS);
  ensureSheet_(SHEET_NAMES.DECISION_OUTCOMES, DECISION_OUTCOME_HEADERS);
  ensureSheet_(SHEET_NAMES.CONTENT_UPDATES, CONTENT_UPDATE_HEADERS);
  ensureContentUpdateHeader_();
  ensureSheet_(SHEET_NAMES.EVALUATION_ELIGIBILITY, EVALUATION_ELIGIBILITY_HEADERS);

  var history = loadFeedbackHistoryRecords_();
  var interventions = loadFeedbackInterventionRecords_();
  var outcomes = loadFeedbackOutcomeRecords_();
  var plan = planEvaluationEligibilityRows_({
    history: history,
    interventions: interventions,
    outcomes: outcomes,
    updatedAt: nowRecordedAt_()
  });

  replaceSheetDataRows_(
    SHEET_NAMES.EVALUATION_ELIGIBILITY,
    EVALUATION_ELIGIBILITY_HEADERS,
    plan.rows
  );

  writeLog_(
    'INFO',
    '',
    'rebuildEvaluationEligibility 结束 rows=' +
      plan.rows.length +
      ' ignoredOrphanInterventions=' +
      plan.ignoredOrphanInterventions +
      ' ignoredOrphanOutcomes=' +
      plan.ignoredOrphanOutcomes
  );
  return {
    rows: plan.rows.length,
    ignoredOrphanInterventions: plan.ignoredOrphanInterventions,
    ignoredOrphanOutcomes: plan.ignoredOrphanOutcomes
  };
}

/**
 * 纯函数：按 DecisionID 生成评价资格行（一 Decision 一行）。
 * @param {{history:Array, interventions:Array, outcomes:Array, updatedAt:string}} ctx
 * @return {{rows:Array<Array>, ignoredOrphanInterventions:number, ignoredOrphanOutcomes:number}}
 */
function planEvaluationEligibilityRows_(ctx) {
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
  var ignoredOrphanInterventions = 0;
  for (i = 0; i < interventions.length; i++) {
    var iv = interventions[i];
    var iid = String(iv.decisionId || '').trim();
    if (!iid) continue;
    if (!historyIds[iid]) {
      ignoredOrphanInterventions++;
      continue;
    }
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
    outcomesById[oid][hz] = true;
  }

  var rows = [];
  for (i = 0; i < history.length; i++) {
    var h = history[i];
    var id = String(h.decisionId || '').trim();
    if (!id) continue;
    var count = Number(interventionCountById[id] || 0);
    var hasD7 = !!(outcomesById[id] && outcomesById[id].D7);
    var hasD14 = !!(outcomesById[id] && outcomesById[id].D14);
    var hasD30 = !!(outcomesById[id] && outcomesById[id].D30);
    var judged = classifyEvaluationEligibility_({
      humanDecision: h.humanDecision,
      interventionCount: count,
      hasD7: hasD7,
      hasD14: hasD14,
      hasD30: hasD30
    });
    rows.push(
      buildEvaluationEligibilityRow_({
        history: h,
        interventionCount: count,
        d7Observed: hasD7,
        d14Observed: hasD14,
        d30Observed: hasD30,
        d7Eligibility: judged.d7,
        d14Eligibility: judged.d14,
        d30Eligibility: judged.d30,
        exclusionReason: judged.exclusionReason,
        updatedAt: updatedAt
      })
    );
  }

  return {
    rows: rows,
    ignoredOrphanInterventions: ignoredOrphanInterventions,
    ignoredOrphanOutcomes: ignoredOrphanOutcomes
  };
}

/**
 * 按 Horizon 独立判定 ELIGIBLE / PENDING / EXCLUDED。
 * 优先级：WAITING_HUMAN → SKIPPED → NO_INTERVENTION → Outcome 是否真实存在。
 */
function classifyEvaluationEligibility_(input) {
  input = input || {};
  var human = String(input.humanDecision || '').trim().toUpperCase();
  var count = Number(input.interventionCount || 0);

  if (!human) {
    return excludedEligibility_(EVALUATION_EXCLUSION_REASON.WAITING_HUMAN);
  }
  if (human === 'SKIP') {
    return excludedEligibility_(EVALUATION_EXCLUSION_REASON.SKIPPED);
  }
  // DONE（或其它非 SKIP 终态）且无 Content Intervention → 不具备效果评价资格
  if (count <= 0) {
    return excludedEligibility_(EVALUATION_EXCLUSION_REASON.NO_INTERVENTION);
  }

  return {
    d7: input.hasD7
      ? EVALUATION_ELIGIBILITY.ELIGIBLE
      : EVALUATION_ELIGIBILITY.PENDING,
    d14: input.hasD14
      ? EVALUATION_ELIGIBILITY.ELIGIBLE
      : EVALUATION_ELIGIBILITY.PENDING,
    d30: input.hasD30
      ? EVALUATION_ELIGIBILITY.ELIGIBLE
      : EVALUATION_ELIGIBILITY.PENDING,
    exclusionReason: ''
  };
}

function excludedEligibility_(reason) {
  return {
    d7: EVALUATION_ELIGIBILITY.EXCLUDED,
    d14: EVALUATION_ELIGIBILITY.EXCLUDED,
    d30: EVALUATION_ELIGIBILITY.EXCLUDED,
    exclusionReason: reason
  };
}

function buildEvaluationEligibilityRow_(input) {
  input = input || {};
  var h = input.history || {};
  return [
    String(h.decisionId || '').trim(),
    String(h.ruleVersion || '').trim(),
    String(h.decisionDataDate || '').trim(),
    String(h.site || '').trim(),
    String(h.humanDecision || '').trim(),
    Number(input.interventionCount || 0),
    input.d7Observed ? true : false,
    input.d14Observed ? true : false,
    input.d30Observed ? true : false,
    String(input.d7Eligibility || ''),
    String(input.d14Eligibility || ''),
    String(input.d30Eligibility || ''),
    String(input.exclusionReason || ''),
    String(input.updatedAt || '')
  ];
}
