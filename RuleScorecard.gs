/**
 * M3-1 Rule Scorecard V1
 * 按 RuleVersion 聚合 Decision / Human / Intervention / Outcome 样本量。
 * 只做计数，不做成功/失败评价；可 rebuild，不写上游事实表。
 */

/**
 * 菜单入口：重建规则评分卡。
 */
function rebuildRuleScorecard() {
  ensureSheet_(SHEET_NAMES.DECISION_HISTORY, DECISION_HISTORY_HEADERS);
  ensureSheet_(SHEET_NAMES.DECISION_OUTCOMES, DECISION_OUTCOME_HEADERS);
  ensureSheet_(SHEET_NAMES.CONTENT_UPDATES, CONTENT_UPDATE_HEADERS);
  ensureContentUpdateHeader_();
  ensureSheet_(SHEET_NAMES.FEEDBACK_SAMPLES, FEEDBACK_SAMPLE_HEADERS);
  ensureSheet_(SHEET_NAMES.RULE_SCORECARD, RULE_SCORECARD_HEADERS);

  var history = loadFeedbackHistoryRecords_();
  var interventions = loadFeedbackInterventionRecords_();
  var outcomes = loadFeedbackOutcomeRecords_();
  var plan = planRuleScorecardRows_({
    history: history,
    interventions: interventions,
    outcomes: outcomes,
    updatedAt: nowRecordedAt_()
  });

  replaceSheetDataRows_(
    SHEET_NAMES.RULE_SCORECARD,
    RULE_SCORECARD_HEADERS,
    plan.rows
  );

  writeLog_(
    'INFO',
    '',
    'rebuildRuleScorecard 结束 rows=' +
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
 * 纯函数：按 RuleVersion 聚合样本量。
 * @param {{history:Array, interventions:Array, outcomes:Array, updatedAt:string}} ctx
 * @return {{rows:Array<Array>, ignoredOrphanInterventions:number, ignoredOrphanOutcomes:number}}
 */
function planRuleScorecardRows_(ctx) {
  ctx = ctx || {};
  var history = ctx.history || [];
  var interventions = ctx.interventions || [];
  var outcomes = ctx.outcomes || [];
  var updatedAt = ctx.updatedAt || '';

  var decisionToVersion = {};
  var buckets = {};
  var i;

  for (i = 0; i < history.length; i++) {
    var h = history[i];
    var id = String(h.decisionId || '').trim();
    if (!id) continue;
    var version = String(h.ruleVersion || '').trim();
    if (!version) version = '(unknown)';
    decisionToVersion[id] = version;
    if (!buckets[version]) {
      buckets[version] = newRuleScorecardBucket_(version);
    }
    var b = buckets[version];
    if (!b.decisionIds[id]) {
      b.decisionIds[id] = true;
      b.DecisionCount++;
      var human = String(h.humanDecision || '').trim().toUpperCase();
      if (!human) b.WaitingHumanCount++;
      else if (human === 'DONE') b.DoneCount++;
      else if (human === 'SKIP') b.SkipCount++;
      var ddate = String(h.decisionDataDate || '').trim().substring(0, 10);
      if (ddate) {
        if (!b.LatestDecisionDataDate || ddate > b.LatestDecisionDataDate) {
          b.LatestDecisionDataDate = ddate;
        }
      }
    }
  }

  var ignoredOrphanInterventions = 0;
  var interventionDecisionSeen = {};
  for (i = 0; i < interventions.length; i++) {
    var iv = interventions[i];
    var iid = String(iv.decisionId || '').trim();
    if (!iid) continue;
    var ivVersion = decisionToVersion[iid];
    if (!ivVersion) {
      ignoredOrphanInterventions++;
      continue;
    }
    var ib = buckets[ivVersion];
    if (!ib) continue;
    ib.InterventionRecordCount++;
    if (!interventionDecisionSeen[iid]) {
      interventionDecisionSeen[iid] = true;
      ib.InterventionDecisionCount++;
    }
  }

  var ignoredOrphanOutcomes = 0;
  var outcomeSeen = {};
  for (i = 0; i < outcomes.length; i++) {
    var oc = outcomes[i];
    var oid = String(oc.decisionId || '').trim();
    var hz = String(oc.horizon || '').trim();
    if (!oid || !hz) continue;
    var ov = decisionToVersion[oid];
    if (!ov) {
      ignoredOrphanOutcomes++;
      continue;
    }
    var key = oid + '||' + hz;
    if (outcomeSeen[key]) continue;
    outcomeSeen[key] = true;
    var ob = buckets[ov];
    if (!ob) continue;
    if (hz === 'D7') ob.D7ObservedCount++;
    else if (hz === 'D14') ob.D14ObservedCount++;
    else if (hz === 'D30') ob.D30ObservedCount++;
  }

  var versions = Object.keys(buckets).sort();
  var rows = [];
  for (i = 0; i < versions.length; i++) {
    rows.push(buildRuleScorecardRow_(buckets[versions[i]], updatedAt));
  }

  return {
    rows: rows,
    ignoredOrphanInterventions: ignoredOrphanInterventions,
    ignoredOrphanOutcomes: ignoredOrphanOutcomes
  };
}

function newRuleScorecardBucket_(ruleVersion) {
  return {
    RuleVersion: ruleVersion,
    decisionIds: {},
    DecisionCount: 0,
    WaitingHumanCount: 0,
    DoneCount: 0,
    SkipCount: 0,
    InterventionDecisionCount: 0,
    InterventionRecordCount: 0,
    D7ObservedCount: 0,
    D14ObservedCount: 0,
    D30ObservedCount: 0,
    LatestDecisionDataDate: ''
  };
}

function buildRuleScorecardRow_(bucket, updatedAt) {
  bucket = bucket || {};
  return [
    String(bucket.RuleVersion || ''),
    Number(bucket.DecisionCount || 0),
    Number(bucket.WaitingHumanCount || 0),
    Number(bucket.DoneCount || 0),
    Number(bucket.SkipCount || 0),
    Number(bucket.InterventionDecisionCount || 0),
    Number(bucket.InterventionRecordCount || 0),
    Number(bucket.D7ObservedCount || 0),
    Number(bucket.D14ObservedCount || 0),
    Number(bucket.D30ObservedCount || 0),
    String(bucket.LatestDecisionDataDate || ''),
    String(updatedAt || '')
  ];
}
