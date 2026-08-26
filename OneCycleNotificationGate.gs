/**
 * Hotword OS One-Cycle Validated Notification V1.
 *
 * Signals remain observable, but a signal can reach 今日行动 only after this
 * same-cycle gate produces one final decision. This module is deliberately
 * pure at its core so the guard can be regression-tested without Sheets.
 */

var ONE_CYCLE_ALLOWED_FINAL_ACTIONS = {
  MINIMAL_FACT_FIX: true,
  BROKEN_PAGE_FIX: true,
  CTR_ONLY: true,
  APPEND_ONLY: true,
  NEW_PAGE_CANDIDATE: true
};

var ONE_CYCLE_DECISION_PRECEDENCE = {
  FACT_OVERRIDE: 0,
  COOLDOWN: 1,
  FREEZE: 2,
  DATA_QUALITY_GUARD: 3,
  CURRENT_STATE_GUARD: 4,
  UNDERPERFORMER: 5,
  EXTERNAL_WATCH: 6,
  NO_ACTION: 7
};

var ONE_CYCLE_NON_ACTION_DECISIONS = {
  FREEZE: true,
  COOLDOWN: true,
  WATCH: true,
  QUERY_BLIND_SPOT_ONLY: true,
  WAIT_FOR_FINALIZED_GSC: true,
  WAIT_FOR_POST_CHANGE_DATA: true,
  STATE_ALREADY_SATISFIED: true,
  NO_ACTION: true
};

var ONE_CYCLE_DISCOVERY_SIGNALS = {
  QUERY_BLIND_SPOT: true,
  NEW_TOP10_QUERY: true,
  NEW_INTENT: true,
  GROWING_INTENT: true,
  QUERY_GROWTH: true,
  POSSIBLECANNIBALIZATION: true,
  POSSIBLE_CANNIBALIZATION: true,
  LOW_BASELINE_SPIKE: true,
  ADJACENT_CAPTURE_CANDIDATE: true
};

function validateOneCycleActionPlan_(plan, context) {
  plan = plan || {};
  context = context || {};

  var snapshot = context.snapshot || {};
  var site = context.site || plan.siteObject || {};
  var cluster = context.cluster || {};
  var rules = context.rules || {};
  var dataCutoff = oneCycleFirstString_(
    plan.dataCutoff,
    context.dataCutoff,
    snapshot.finalizedDataDate,
    snapshot.cutoffHour,
    site.latestGSCDataDate
  );
  var pageLastChanged = oneCycleFirstString_(
    context.lastContentChangeDate,
    context.pageLastChanged,
    plan.pageLastChanged,
    site.lastContentChangeDate
  );
  var currentState = oneCycleFirstString_(
    context.currentState,
    plan.currentState,
    site.currentState,
    plan.signalState
  );
  var requestedAction = oneCycleRequestedFinalAction_(plan);
  var signals = oneCycleSignals_(plan, context, cluster);
  var logicalKey = oneCycleLogicalKey_(plan, context, cluster);
  var base = {
    logicalKey: logicalKey,
    dataCutoff: dataCutoff,
    pageLastChanged: pageLastChanged,
    currentState: currentState,
    requestedAction: requestedAction,
    finalAction: '',
    finalDecision: '',
    decisionClass: '',
    precedence: ONE_CYCLE_DECISION_PRECEDENCE.NO_ACTION,
    notify: false,
    reason: '',
    dataQualityStatus: '',
    sourceSystem: oneCycleFirstString_(plan.sourceSystem, context.sourceSystem, 'EARLY')
  };

  // A verified fact override is the only class allowed to cross the other
  // guards. The action must still be one of the explicit final actions.
  var factOverride = oneCycleFactOverrideAction_(plan, signals);
  if (factOverride) {
    return oneCycleDecision_(base, 'FACT_OVERRIDE', factOverride, true,
      'FACT_OVERRIDE: ' + factOverride);
  }

  var finalized = oneCycleHasFinalizedGsc_(plan, context, snapshot, dataCutoff);
  var changeDates = oneCycleCompleteDatesAfterChange_(context, snapshot, pageLastChanged);
  if (finalized && pageLastChanged && dataCutoff && dataCutoff <= pageLastChanged) {
    return oneCycleDecision_(base, 'COOLDOWN', 'COOLDOWN', false,
      'LatestFinalizedGSCDate <= LastContentChangeDate');
  }
  if (pageLastChanged && changeDates.length < 3 && finalized) {
    return oneCycleDecision_(base, 'COOLDOWN', 'WAIT_FOR_POST_CHANGE_DATA', false,
      'Fewer than 3 complete GSC DataDates after content change');
  }

  if (oneCycleIsProtectedWinner_(plan, context, site, requestedAction)) {
    return oneCycleDecision_(base, 'FREEZE', 'FREEZE', false,
      'Protected winner remains under the existing freeze rule');
  }

  if (!finalized || oneCycleIsRealtime_(plan, context, snapshot)) {
    base.dataQualityStatus = 'WAIT_FOR_FINALIZED_GSC';
    return oneCycleDecision_(base, 'DATA_QUALITY_GUARD', 'WATCH', false,
      'WAIT_FOR_FINALIZED_GSC: GSC data is realtime or incomplete');
  }

  if (oneCycleStateAlreadySatisfied_(plan, context, site, requestedAction)) {
    return oneCycleDecision_(base, 'CURRENT_STATE_GUARD', 'STATE_ALREADY_SATISFIED', false,
      'Current state already satisfies the requested outcome');
  }

  if (requestedAction === 'NEW_PAGE_CANDIDATE' &&
      oneCycleHasExistingPage_(plan, context, cluster)) {
    return oneCycleDecision_(base, 'CURRENT_STATE_GUARD', 'WATCH', false,
      'Existing page already provides a reasonable intent receiver');
  }

  if (oneCycleIsExternalOnly_(plan, context, signals) && !oneCycleHasMeaningfulGsc_(plan, context, snapshot)) {
    return oneCycleDecision_(base, 'EXTERNAL_WATCH', 'WATCH', false,
      'External demand has no meaningful finalized GSC/search confirmation');
  }

  if (!requestedAction) {
    var discoveryOnly = oneCycleHasDiscoverySignal_(signals);
    return oneCycleDecision_(base, 'NO_ACTION', discoveryOnly ? 'QUERY_BLIND_SPOT_ONLY' : 'NO_ACTION', false,
      discoveryOnly ? 'Discovery signal retained without an action request' : 'No executable final action');
  }

  if (!ONE_CYCLE_ALLOWED_FINAL_ACTIONS[requestedAction]) {
    return oneCycleDecision_(base, 'NO_ACTION', 'NO_ACTION', false,
      'Requested action is not an executable final notification action');
  }

  if (!oneCycleHasMeaningfulGsc_(plan, context, snapshot)) {
    return oneCycleDecision_(base, 'EXTERNAL_WATCH', 'WATCH', false,
      'Finalized GSC evidence is not meaningful enough for an action');
  }

  return oneCycleDecision_(base, 'UNDERPERFORMER', requestedAction, true,
    'Finalized GSC evidence supports one executable action');
}

function oneCycleValidationContextForPlan_(plan, opts, snapshots, rules) {
  opts = opts || {};
  plan = plan || {};
  snapshots = snapshots || [];
  var siteName = String(plan.site || '').trim();
  var snapshot = null;
  var site = plan.siteObject || {};
  var cluster = {};
  for (var i = 0; i < snapshots.length; i++) {
    var candidate = snapshots[i] || {};
    var candidateSite = candidate.site || {};
    if (String(candidateSite.name || '').trim() !== siteName) continue;
    snapshot = candidate;
    site = candidateSite;
    var clusters = candidate.clusters || [];
    for (var c = 0; c < clusters.length; c++) {
      if (String(clusters[c].key || '').trim() === String(plan.clusterKey || '').trim()) {
        cluster = clusters[c] || {};
        break;
      }
    }
    break;
  }
  snapshot = snapshot || {};

  var context = {};
  var supplied = opts.validationContextByKey &&
    (opts.validationContextByKey[plan.actionKey] || opts.validationContextByKey[siteName]);
  if (!supplied && opts.validationContext) supplied = opts.validationContext;
  var keys = Object.keys(supplied || {});
  for (var k = 0; k < keys.length; k++) context[keys[k]] = supplied[keys[k]];
  context.site = context.site || site;
  context.snapshot = context.snapshot || snapshot;
  context.cluster = context.cluster || cluster;
  context.rules = context.rules || rules || {};
  context.siteName = context.siteName || siteName;

  if (!context.lastContentChangeDate && typeof loadContentUpdateRows_ === 'function' &&
      typeof getLatestContentUpdate_ === 'function') {
    var latest = getLatestContentUpdate_(siteName, plan.pagePath || plan.currentTopPage || '', loadContentUpdateRows_());
    if (latest) context.lastContentChangeDate = latest.updateDate;
  }
  if ((!context.portfolioAction && !context.investmentTier && !context.winnerPage) &&
      typeof getSpreadsheet_ === 'function' && typeof SHEET_NAMES !== 'undefined' &&
      SHEET_NAMES.PORTFOLIO && typeof headerIndexMap_ === 'function' && typeof cell_ === 'function') {
    var portfolioSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.PORTFOLIO);
    if (portfolioSheet && portfolioSheet.getLastRow() >= 2) {
      var lastCol = Math.max(portfolioSheet.getLastColumn(), 18);
      var header = portfolioSheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var col = headerIndexMap_(header);
      var rows = portfolioSheet.getRange(2, 1, portfolioSheet.getLastRow() - 1, lastCol).getValues();
      for (var r = 0; r < rows.length; r++) {
        if (String(cell_(rows[r], col, '站点') || '').trim() !== siteName) continue;
        context.portfolioAction = context.portfolioAction || String(cell_(rows[r], col, '经营动作') || '').trim();
        context.investmentTier = context.investmentTier || String(cell_(rows[r], col, '投入档位') || '').trim();
        context.winnerPage = context.winnerPage || String(cell_(rows[r], col, '赢家页面') || '').trim();
        context.winnerClicks7d = context.winnerClicks7d || Number(cell_(rows[r], col, '赢家页点击7日') || 0);
        break;
      }
    }
  }
  return context;
}

function applyOneCycleActionGate_(plan, context) {
  var validation = validateOneCycleActionPlan_(plan, context);
  plan.oneCycleValidation = validation;
  plan.finalDecision = validation.finalDecision;
  plan.finalAction = validation.finalAction || '';
  plan.dataCutoff = validation.dataCutoff || '';
  plan.pageLastChanged = validation.pageLastChanged || '';
  plan.currentState = validation.currentState || '';
  plan.originalRecommendedAction = plan.recommendedAction || '';
  plan.recommendedAction = validation.notify ? validation.finalAction : validation.finalDecision;
  plan.signalState = validation.notify ? 'OPEN' : validation.finalDecision;
  plan.createTodayAction = validation.notify;
  plan.createResearchJob = !!(validation.notify && plan.createResearchJob);
  plan.reason = String(plan.reason || '') +
    ' | Data cutoff: ' + (validation.dataCutoff || 'n/a') +
    ' | Page last changed: ' + (validation.pageLastChanged || 'n/a') +
    ' | Current state: ' + (validation.currentState || 'n/a') +
    ' | Recommended action: ' + (validation.finalAction || validation.finalDecision || 'NO_ACTION') +
    ' | Final Decision: ' + validation.finalDecision;
  return plan;
}

/** Select one final plan per Site + logical page/query opportunity + cycle. */
function selectOneCycleFinalPlans_(plans) {
  var byKey = {};
  for (var i = 0; i < (plans || []).length; i++) {
    var plan = plans[i] || {};
    var validation = plan.oneCycleValidation || {};
    var key = validation.logicalKey || oneCycleLogicalKey_(plan, {}, {});
    if (!byKey[key]) {
      byKey[key] = plan;
      continue;
    }
    var current = byKey[key];
    var currentValidation = current.oneCycleValidation || {};
    if (oneCyclePlanRank_(validation) < oneCyclePlanRank_(currentValidation)) {
      byKey[key] = plan;
    }
  }
  return Object.keys(byKey).map(function (key) { return byKey[key]; });
}

function oneCyclePlanRank_(validation) {
  validation = validation || {};
  return Number(validation.precedence === undefined ? 99 : validation.precedence);
}

function oneCycleDecision_(base, decisionClass, finalDecision, notify, reason) {
  base.decisionClass = decisionClass;
  base.finalDecision = finalDecision;
  base.finalAction = notify ? finalDecision : '';
  base.notify = !!notify;
  base.reason = reason;
  base.precedence = ONE_CYCLE_DECISION_PRECEDENCE[decisionClass];
  return base;
}

function oneCycleRequestedFinalAction_(plan) {
  var explicit = String(plan.finalAction || '').trim().toUpperCase();
  if (ONE_CYCLE_ALLOWED_FINAL_ACTIONS[explicit]) return explicit;
  var target = String(plan.targetAction || '').trim().toUpperCase();
  if (target === 'NEW_PAGE_CANDIDATE') return 'NEW_PAGE_CANDIDATE';
  var recommended = String(plan.recommendedAction || '').trim().toUpperCase();
  if (ONE_CYCLE_ALLOWED_FINAL_ACTIONS[recommended]) return recommended;
  return '';
}

function oneCycleFactOverrideAction_(plan, signals) {
  var explicit = String(plan.finalAction || '').trim().toUpperCase();
  if (explicit === 'MINIMAL_FACT_FIX' || explicit === 'BROKEN_PAGE_FIX') return explicit;
  if (signals.indexOf('BROKEN_PAGE') >= 0 || signals.indexOf('BROKEN_PAGE_FIX') >= 0) {
    return 'BROKEN_PAGE_FIX';
  }
  if (signals.indexOf('FACT_CONFLICT') >= 0 || signals.indexOf('OFFICIAL_PATCH') >= 0 ||
      signals.indexOf('FACT_OVERRIDE') >= 0) {
    return 'MINIMAL_FACT_FIX';
  }
  return '';
}

function oneCycleSignals_(plan, context, cluster) {
  var values = [];
  var sources = [plan.signals, plan.signal, context.signals, cluster.signals];
  for (var i = 0; i < sources.length; i++) {
    var source = sources[i];
    if (!source) continue;
    if (!(source instanceof Array)) source = [source];
    for (var j = 0; j < source.length; j++) {
      var value = String(source[j] || '').trim().toUpperCase();
      if (value && values.indexOf(value) < 0) values.push(value);
    }
  }
  return values;
}

function oneCycleHasFinalizedGsc_(plan, context, snapshot, dataCutoff) {
  if (context.finalizedGsc === true || context.finalized === true || snapshot.finalized === true) return true;
  if (context.dataState && String(context.dataState).toUpperCase() === 'FINALIZED') return true;
  if (snapshot.dataState && String(snapshot.dataState).toUpperCase() === 'FINALIZED') return true;
  if (context.finalizedDataDate || snapshot.finalizedDataDate || plan.finalizedDataDate) {
    return !!oneCycleFirstString_(context.finalizedDataDate, snapshot.finalizedDataDate, plan.finalizedDataDate);
  }
  return false;
}

function oneCycleIsRealtime_(plan, context, snapshot) {
  var states = [plan.dataState, context.dataState, snapshot.dataState, context.sourceState];
  for (var i = 0; i < states.length; i++) {
    if (/REALTIME|HOURLY|INCOMPLETE|PRELIMINARY/i.test(String(states[i] || ''))) return true;
  }
  return !!(plan.dataIncomplete || context.dataIncomplete || snapshot.incomplete || snapshot.dataIncomplete);
}

function oneCycleCompleteDatesAfterChange_(context, snapshot, pageLastChanged) {
  var dates = context.postChangeFinalizedDataDates || snapshot.postChangeFinalizedDataDates ||
    context.gscDataDates || snapshot.gscDataDates || [];
  var out = [];
  for (var i = 0; i < dates.length; i++) {
    var date = oneCycleDateOnly_(dates[i]);
    if (date && (!pageLastChanged || date > pageLastChanged) && out.indexOf(date) < 0) out.push(date);
  }
  return out;
}

function oneCycleIsProtectedWinner_(plan, context, site, requestedAction) {
  if (context.protectedWinner === true || context.winnerProtected === true || site.protectedWinner === true) return true;
  if (String(context.portfolioAction || site.portfolioAction || '').toUpperCase() === 'FREEZE') return true;
  if (String(context.investmentTier || site.investmentTier || '').toUpperCase() === 'FROZEN') return true;
  if (requestedAction === 'CTR_ONLY' && (
    context.stableWinner === true || site.stableWinner === true ||
    Number(context.winnerClicks7d || site.winnerClicks7d || 0) > 0
  )) return true;
  return false;
}

function oneCycleStateAlreadySatisfied_(plan, context, site, requestedAction) {
  if (plan.stateAlreadySatisfied === true || context.stateAlreadySatisfied === true || site.stateAlreadySatisfied === true) return true;
  if (context.currentStateSatisfied === true || site.currentStateSatisfied === true) return true;
  var current = String(context.currentState || site.currentState || '').trim().toUpperCase();
  var target = String(context.targetState || site.targetState || '').trim().toUpperCase();
  return !!(current && target && current === target && requestedAction);
}

function oneCycleHasExistingPage_(plan, context, cluster) {
  if (context.hasExistingPage === true || cluster.hasExistingPage === true) return true;
  if (String(context.hasExistingPage || cluster.hasExistingPage || '').toUpperCase() === 'TRUE') return true;
  return !!(plan.currentTopPage && String(plan.currentTopPage) !== '/' ||
    plan.expectedPage && String(plan.expectedPage) !== '/');
}

function oneCycleIsExternalOnly_(plan, context, signals) {
  if (context.externalOnly === true || plan.externalOnly === true) return true;
  if (String(context.sourceSystem || plan.sourceSystem || '').toUpperCase() === 'EXTERNAL') return true;
  if (signals.length && signals.every(function (signal) {
    return /REDDIT|STEAM|YOUTUBE|EXTERNAL|COMMUNITY/.test(signal);
  })) return true;
  return false;
}

function oneCycleHasMeaningfulGsc_(plan, context, snapshot) {
  if (context.meaningfulFinalizedGsc === true || context.meaningfulGsc === true) return true;
  if (Number(plan.currentImpressions || 0) > 0 || Number(plan.currentClicks || 0) > 0) return true;
  if (Number(context.impressions || 0) > 0 || Number(context.clicks || 0) > 0) return true;
  var clusters = snapshot.clusters || [];
  for (var i = 0; i < clusters.length; i++) {
    if (Number(clusters[i].impressions || 0) > 0 || Number(clusters[i].clicks || 0) > 0) return true;
  }
  return false;
}

function oneCycleHasDiscoverySignal_(signals) {
  for (var i = 0; i < signals.length; i++) {
    if (ONE_CYCLE_DISCOVERY_SIGNALS[signals[i]]) return true;
  }
  return false;
}

function oneCycleLogicalKey_(plan, context, cluster) {
  var site = oneCycleFirstString_(plan.siteIdentity, plan.site, context.siteName, context.site && context.site.name, '');
  var page = oneCycleFirstString_(plan.pagePath, plan.currentTopPage, plan.expectedPage, context.pagePath, cluster.topPage, '');
  var opportunity = oneCycleFirstString_(plan.clusterKey, context.query, cluster.key, plan.actionKey, 'site');
  return site + '||' + opportunity + '||' + page;
}

function oneCycleFirstString_() {
  for (var i = 0; i < arguments.length; i++) {
    var value = arguments[i];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function oneCycleDateOnly_(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  var match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}
