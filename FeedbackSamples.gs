/**
 * M2-4 Feedback Sample View
 * 将 Decision / HumanDecision / Content Intervention / Outcome
 * 聚合为「反馈样本」派生视图（可 rebuild，非事实源）。
 * 不重算 Outcome，不写上游表，不产出价值评价标签。
 */

/**
 * 菜单入口：重建反馈样本。
 */
function rebuildFeedbackSamples() {
  ensureSheet_(SHEET_NAMES.DECISION_HISTORY, DECISION_HISTORY_HEADERS);
  ensureSheet_(SHEET_NAMES.DECISION_OUTCOMES, DECISION_OUTCOME_HEADERS);
  ensureSheet_(SHEET_NAMES.CONTENT_UPDATES, CONTENT_UPDATE_HEADERS);
  ensureContentUpdateHeader_();
  ensureSheet_(SHEET_NAMES.FEEDBACK_SAMPLES, FEEDBACK_SAMPLE_HEADERS);

  var history = loadFeedbackHistoryRecords_();
  var interventions = loadFeedbackInterventionRecords_();
  var outcomes = loadFeedbackOutcomeRecords_();
  var plan = planFeedbackSampleRows_({
    history: history,
    interventions: interventions,
    outcomes: outcomes,
    updatedAt: nowRecordedAt_()
  });

  for (var w = 0; w < plan.warnings.length; w++) {
    writeLog_('WARN', '', plan.warnings[w]);
  }

  replaceSheetDataRows_(
    SHEET_NAMES.FEEDBACK_SAMPLES,
    FEEDBACK_SAMPLE_HEADERS,
    plan.rows
  );

  writeLog_(
    'INFO',
    '',
    'rebuildFeedbackSamples 结束 rows=' +
      plan.rows.length +
      ' warnings=' +
      plan.warnings.length +
      ' ignoredOrphanInterventions=' +
      plan.ignoredOrphanInterventions +
      ' ignoredOrphanOutcomes=' +
      plan.ignoredOrphanOutcomes
  );
  return {
    rows: plan.rows.length,
    warnings: plan.warnings.length,
    ignoredOrphanInterventions: plan.ignoredOrphanInterventions,
    ignoredOrphanOutcomes: plan.ignoredOrphanOutcomes
  };
}

/**
 * 纯函数：按 DecisionID join 四层事实，生成反馈样本行。
 * @param {{history:Array, interventions:Array, outcomes:Array, updatedAt:string}} ctx
 * @return {{rows:Array<Array>, warnings:Array<string>, ignoredOrphanInterventions:number, ignoredOrphanOutcomes:number}}
 */
function planFeedbackSampleRows_(ctx) {
  ctx = ctx || {};
  var history = ctx.history || [];
  var interventions = ctx.interventions || [];
  var outcomes = ctx.outcomes || [];
  var updatedAt = ctx.updatedAt || '';
  var warnings = [];
  var historyIds = {};
  var i;

  for (i = 0; i < history.length; i++) {
    var hid = String(history[i].decisionId || '').trim();
    if (hid) historyIds[hid] = true;
  }

  var interventionsById = {};
  var ignoredOrphanInterventions = 0;
  for (i = 0; i < interventions.length; i++) {
    var iv = interventions[i];
    var iid = String(iv.decisionId || '').trim();
    if (!iid) continue;
    if (!historyIds[iid]) {
      ignoredOrphanInterventions++;
      continue;
    }
    if (!interventionsById[iid]) interventionsById[iid] = [];
    interventionsById[iid].push(iv);
  }

  var outcomesById = {};
  var ignoredOrphanOutcomes = 0;
  for (i = 0; i < outcomes.length; i++) {
    var oc = outcomes[i];
    var oid = String(oc.decisionId || '').trim();
    if (!oid) continue;
    if (!historyIds[oid]) {
      ignoredOrphanOutcomes++;
      warnings.push(
        'Feedback sample ignored orphan Outcome DecisionID=' + oid
      );
      continue;
    }
    if (!outcomesById[oid]) outcomesById[oid] = {};
    var hz = String(oc.horizon || '').trim();
    if (!hz) continue;
    var prev = outcomesById[oid][hz];
    if (prev) {
      warnings.push(
        'Feedback sample duplicate Outcome DecisionID=' +
          oid +
          ' Horizon=' +
          hz +
          '; keeping latest ObservedAt'
      );
      if (String(oc.observedAt || '') >= String(prev.observedAt || '')) {
        outcomesById[oid][hz] = oc;
      }
    } else {
      outcomesById[oid][hz] = oc;
    }
  }

  var rows = [];
  for (i = 0; i < history.length; i++) {
    var h = history[i];
    var id = String(h.decisionId || '').trim();
    if (!id) continue;
    var agg = aggregateInterventionsForFeedback_(interventionsById[id] || []);
    var d7 = pickHorizonOutcome_(outcomesById[id], 'D7');
    var d14 = pickHorizonOutcome_(outcomesById[id], 'D14');
    var d30 = pickHorizonOutcome_(outcomesById[id], 'D30');
    var human = String(h.humanDecision || '').trim().toUpperCase();
    if (
      !human &&
      agg.count > 0
    ) {
      warnings.push(
        'Feedback sample data inconsistency: intervention without HumanDecision DecisionID=' +
          id
      );
    }
    var sampleStatus = classifyFeedbackSampleStatus_({
      humanDecision: human,
      interventionCount: agg.count,
      hasD7: !!d7,
      hasD14: !!d14,
      hasD30: !!d30
    });
    rows.push(
      buildFeedbackSampleRow_({
        history: h,
        intervention: agg,
        d7: d7,
        d14: d14,
        d30: d30,
        sampleStatus: sampleStatus,
        updatedAt: updatedAt
      })
    );
  }

  return {
    rows: rows,
    warnings: warnings,
    ignoredOrphanInterventions: ignoredOrphanInterventions,
    ignoredOrphanOutcomes: ignoredOrphanOutcomes
  };
}

/**
 * SampleStatus 事实阶段判定（优先级固定）。
 */
function classifyFeedbackSampleStatus_(input) {
  input = input || {};
  var human = String(input.humanDecision || '').trim().toUpperCase();
  var count = Number(input.interventionCount || 0);
  if (!human) return FEEDBACK_SAMPLE_STATUS.WAITING_HUMAN;
  if (human === 'SKIP') return FEEDBACK_SAMPLE_STATUS.SKIPPED;
  if (human === 'DONE' && count <= 0) {
    return FEEDBACK_SAMPLE_STATUS.HANDLED_NO_INTERVENTION;
  }
  if (count > 0 && !input.hasD7) {
    return FEEDBACK_SAMPLE_STATUS.INTERVENTION_PENDING_OUTCOME;
  }
  if (input.hasD7 && !input.hasD14) return FEEDBACK_SAMPLE_STATUS.D7_OBSERVED;
  if (input.hasD14 && !input.hasD30) return FEEDBACK_SAMPLE_STATUS.D14_OBSERVED;
  if (input.hasD30) return FEEDBACK_SAMPLE_STATUS.D30_OBSERVED;
  if (count > 0) return FEEDBACK_SAMPLE_STATUS.INTERVENTION_PENDING_OUTCOME;
  return FEEDBACK_SAMPLE_STATUS.WAITING_HUMAN;
}

function aggregateInterventionsForFeedback_(list) {
  var rows = list || [];
  var count = rows.length;
  var pages = [];
  var pageSeen = {};
  var types = [];
  var typeSeen = {};
  var first = '';
  var last = '';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var date = String(r.updateDate || '').trim().substring(0, 10);
    if (date) {
      if (!first || date < first) first = date;
      if (!last || date > last) last = date;
    }
    var path = String(r.pagePath || '').trim();
    var pageLabel = path ? path : '（整站）';
    if (!pageSeen[pageLabel]) {
      pageSeen[pageLabel] = true;
      pages.push(pageLabel);
    }
    var t = String(r.updateType || '').trim();
    if (t && !typeSeen[t]) {
      typeSeen[t] = true;
      types.push(t);
    }
  }
  return {
    count: count,
    pages: pages.join(' | '),
    firstDate: first,
    lastDate: last,
    types: types.join(' | ')
  };
}

function pickHorizonOutcome_(byHorizon, horizon) {
  if (!byHorizon) return null;
  return byHorizon[horizon] || null;
}

function horizonStatusAndMetrics_(outcome) {
  if (!outcome) {
    return {
      status: OBSERVATION_STATUS.PENDING,
      impressions: '',
      clicks: '',
      guideQueries: '',
      bestPosition: ''
    };
  }
  return {
    status: OBSERVATION_STATUS.OBSERVED,
    impressions: outcome.impressionsWindow,
    clicks: outcome.clicksWindow,
    guideQueries: outcome.guideQueryCount,
    bestPosition: outcome.bestPosition
  };
}

function buildFeedbackSampleRow_(input) {
  input = input || {};
  var h = input.history || {};
  var iv = input.intervention || {};
  var d7 = horizonStatusAndMetrics_(input.d7);
  var d14 = horizonStatusAndMetrics_(input.d14);
  var d30 = horizonStatusAndMetrics_(input.d30);
  return [
    String(h.decisionId || '').trim(),
    String(h.decisionDataDate || '').trim(),
    String(h.site || '').trim(),
    String(h.ruleVersion || '').trim(),
    String(h.recommendedAction || '').trim(),
    String(h.priority || '').trim(),
    h.domainScore === null || h.domainScore === undefined ? '' : h.domainScore,
    String(h.humanDecision || '').trim(),
    String(h.humanNote || '').trim(),
    Number(iv.count || 0),
    String(iv.pages || ''),
    String(iv.firstDate || ''),
    String(iv.lastDate || ''),
    String(iv.types || ''),
    d7.status,
    d7.impressions,
    d7.clicks,
    d7.guideQueries,
    d7.bestPosition,
    d14.status,
    d14.impressions,
    d14.clicks,
    d14.guideQueries,
    d14.bestPosition,
    d30.status,
    d30.impressions,
    d30.clicks,
    d30.guideQueries,
    d30.bestPosition,
    String(input.sampleStatus || ''),
    String(input.updatedAt || '')
  ];
}

function loadFeedbackHistoryRecords_() {
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
      domainScore: row[25],
      recommendedAction: String(row[27] || '').trim(),
      priority: String(row[28] || '').trim(),
      humanDecision: String(row[30] || '').trim(),
      humanNote: String(row[31] || '').trim()
    });
  }
  return out;
}

function loadFeedbackInterventionRecords_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.CONTENT_UPDATES);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, CONTENT_UPDATE_HEADERS.length)
    .getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var decisionId = String(row[6] || '').trim();
    if (!decisionId) continue;
    out.push({
      decisionId: decisionId,
      updateDate: normalizeKeyDate_(row[0]) || String(row[0] || '').trim().substring(0, 10),
      pagePath: String(row[2] || '').trim(),
      updateType: String(row[5] || '').trim()
    });
  }
  return out;
}

function loadFeedbackOutcomeRecords_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DECISION_OUTCOMES);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, DECISION_OUTCOME_HEADERS.length)
    .getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var id = String(row[0] || '').trim();
    if (!id) continue;
    out.push({
      decisionId: id,
      horizon: String(row[5] || '').trim(),
      observationStatus: String(row[8] || '').trim(),
      impressionsWindow: row[9],
      clicksWindow: row[10],
      guideQueryCount: row[12],
      bestPosition: row[15],
      observedAt: String(row[18] || '').trim()
    });
  }
  return out;
}
