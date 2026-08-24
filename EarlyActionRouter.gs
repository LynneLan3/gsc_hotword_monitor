/**
 * Goal 3: route confirmed Early Winner / Follow-up signals into the existing
 * Opportunity, 今日行动, and Research Job surfaces.
 *
 * This module does not re-evaluate signals, modify websites, call APIMart, or
 * change the formal Decision Engine. It only consumes Goal 1 / Goal 2 output.
 */

var EARLY_ACTION_ROUTER_STATE_PROPERTY = 'EARLY_ACTION_ROUTER_STATE_V1';
var EARLY_ACTION_ROUTER_SOURCE = 'EARLY';

function runEarlyActionRouter(opts) {
  opts = opts || {};
  ensureEarlyActionRouterProductionSchema_();
  var now = opts.now || new Date();
  var rules = opts.rules || getDecisionRules_();
  var routerState = opts.routerState || loadEarlyActionRouterState_();
  var snapshots = opts.snapshots || [];
  var clusterContexts = earlyActionClusterContexts_(snapshots);
  var plans = buildEarlyActionPlans_({
    earlyRecords: opts.earlyRecords || [],
    followupRecords: opts.followupRecords || [],
    clusterContexts: clusterContexts,
    siteObjects: earlyActionSiteObjects_(snapshots),
    routerState: routerState,
    rules: rules,
    now: now
  });
  var existingJobs = loadEarlyResearchJobs_();
  var result = {
    plans: plans,
    opportunities: 0,
    todayActions: 0,
    researchJobs: 0,
    skippedResearchJobs: 0,
    resolvedMismatches: 0
  };

  for (var i = 0; i < plans.length; i++) {
    var plan = plans[i];
    upsertEarlyOpportunity_(plan);
    updateEarlyIntentOpportunityRouting_(plan);
    result.opportunities++;

    if (plan.createTodayAction) {
      upsertEarlyTodayAction_(plan);
      result.todayActions++;
    }

    if (plan.createResearchJob) {
      if (shouldCreateEarlyResearchJob_(plan, existingJobs, routerState)) {
        var job = createEarlyResearchJob_(plan, existingJobs, now);
        if (job) {
          result.researchJobs++;
          existingJobs.push(job);
          plan.researchJobId = job.jobId;
        }
      } else {
        result.skippedResearchJobs++;
      }
    }

    if (plan.signals.indexOf(EARLY_ACTION_ROUTER_SIGNALS.TARGET_PAGE_TAKES_OVER) >= 0) {
      if (resolveEarlyMismatchForTakeover_(plan)) result.resolvedMismatches++;
    }

    routerState[plan.actionKey] = {
      routed: true,
      site: plan.site,
      clusterKey: plan.clusterKey || '',
      targetAction: plan.targetAction,
      signalSignature: plan.signals.join('|'),
      opportunityId: plan.opportunityId,
      researchJobId: plan.researchJobId || '',
      signalState: plan.signalState,
      lastObservedAt: now
    };
  }

  persistEarlyActionRouterState_(routerState);
  writeLog_('INFO', '', 'runEarlyActionRouter 完成 | plans=' + plans.length +
    ' | opportunities=' + result.opportunities +
    ' | todayActions=' + result.todayActions +
    ' | researchJobs=' + result.researchJobs +
    ' | skippedResearchJobs=' + result.skippedResearchJobs +
    ' | resolvedMismatches=' + result.resolvedMismatches);
  return result;
}

/** Pure planner used by routing fixtures and production. */
function buildEarlyActionPlans_(opts) {
  opts = opts || {};
  var rules = opts.rules || {};
  var state = opts.routerState || {};
  var contexts = opts.clusterContexts || {};
  var siteObjects = opts.siteObjects || {};
  var plansByKey = {};
  var earlyRecords = opts.earlyRecords || [];
  var followupRecords = opts.followupRecords || [];

  for (var i = 0; i < earlyRecords.length; i++) {
    var early = earlyRecords[i] || {};
    if (String(early.status || '').trim() !== 'EARLY_WINNER') continue;
    if (earlyActionDay_(early, rules) > earlyActionMaxDay_(rules)) continue;
    var earlyWithSite = earlyActionWithSiteObject_(early, siteObjects[early.site]);
    var siteKey = earlySiteWinActionKey_(earlyWithSite);
    if (state[siteKey] && state[siteKey].routed) continue;
    plansByKey[siteKey] = buildEarlySiteWinPlan_(earlyWithSite, siteKey, opts.now);
  }

  for (var f = 0; f < followupRecords.length; f++) {
    var record = followupRecords[f] || {};
    if (!record.site || !record.clusterKey) continue;
    var contextKey = String(record.site) + '||' + String(record.clusterKey);
    var planContext = contexts[contextKey] || {};
    var recordWithSite = earlyActionWithSiteObject_(record, planContext.siteObject);
    var adjacent = record.adjacentCaptureCandidates || [];
    if (adjacent.length) {
      for (var a = 0; a < adjacent.length; a++) {
        var candidate = adjacent[a] || {};
        var adjacentPlan = buildAdjacentCapturePlan_(recordWithSite, candidate, opts.now);
        if (adjacentPlan && !plansByKey[adjacentPlan.actionKey]) {
          plansByKey[adjacentPlan.actionKey] = adjacentPlan;
        }
      }
    }
    if (!record.signals || !record.signals.length) continue;
    var plan = buildEarlyFollowupPlan_(recordWithSite, planContext, rules, opts.now);
    if (!plan) continue;
    var key = plan.actionKey;
    if (!plansByKey[key]) {
      plansByKey[key] = plan;
    } else {
      plansByKey[key] = mergeEarlyActionPlans_(plansByKey[key], plan);
    }
  }

  return Object.keys(plansByKey).map(function (key) { return plansByKey[key]; });
}

function buildAdjacentCapturePlan_(record, candidate, now) {
  candidate = candidate || {};
  var intent = String(candidate.intent || candidate.normalizedIntent || '').trim();
  if (!intent) return null;
  var actionKey = earlyActionKey_(record.siteObject || record.site, intent, 'ADJACENT_CAPTURE');
  return {
    actionKey: actionKey,
    opportunityId: actionKey,
    site: String(record.site || '').trim(),
    siteIdentity: earlySiteIdentity_(record.siteObject || { name: record.site }),
    clusterKey: String(record.clusterKey || '').trim(),
    clusterLabel: intent,
    signals: ['ADJACENT_CAPTURE_CANDIDATE'],
    confidence: 'MEDIUM',
    reason: String(candidate.reason || record.adjacentCaptureReason || '').trim(),
    currentImpressions: 0,
    currentClicks: 0,
    currentPosition: 0,
    currentTopPage: '',
    expectedPage: '',
    currentTopPageShare: 0,
    observationCount: 0,
    targetAction: 'ADJACENT_CAPTURE_CANDIDATE',
    opportunityType: 'ADJACENT_CAPTURE_CANDIDATE',
    recommendedAction: 'RESEARCH_PROBE',
    priority: 'P2',
    signalState: 'OPEN',
    autoHandled: false,
    createTodayAction: true,
    createResearchJob: true,
    researchType: RESEARCH_TYPE.NEW_INTENT_RESEARCH,
    pagePath: '',
    opportunityStage: 'CAPTURE',
    routingDecision: 'ADJACENT_CAPTURE_CANDIDATE',
    sourceRefs: candidate.sourceRefs || [],
    now: now || new Date()
  };
}

function buildEarlySiteWinPlan_(early, actionKey, now) {
  var metrics = early.metrics || {};
  var reason = String(early.reason || 'Early Winner').trim();
  return {
    actionKey: actionKey,
    opportunityId: actionKey,
    site: String(early.site || '').trim(),
    siteIdentity: earlySiteIdentity_(early.siteObject || { name: early.site }),
    clusterKey: '',
    clusterLabel: '',
    signals: [EARLY_ACTION_ROUTER_SIGNALS.EARLY_SITE_WIN],
    confidence: String(early.confidence || 'LOW'),
    reason: reason,
    currentImpressions: Number(metrics.impressions24h || 0),
    currentClicks: Number(metrics.clicks24h || 0),
    currentTopPage: '',
    expectedPage: '',
    currentTopPageShare: '',
    observationCount: '',
    targetAction: 'AUTO_FOLLOWUP',
    opportunityType: EXTERNAL_OPPORTUNITY_TYPES.EARLY_SITE_WIN,
    recommendedAction: 'AUTO_FOLLOWUP',
    priority: 'P3',
    signalState: 'AUTO_HANDLED',
    autoHandled: true,
    createTodayAction: true,
    createResearchJob: false,
    now: now || new Date()
  };
}

function buildEarlyFollowupPlan_(record, context, rules, now) {
  var signals = earlyActionUniqueSignals_(record.signals);
  if (!signals.length) return null;
  var site = String(record.site || '').trim();
  var clusterKey = String(record.clusterKey || '').trim();
  var expectedPage = normalizeEarlyRouterPath_(record.expectedPage || '');
  var currentTopPage = normalizeEarlyRouterPath_(record.currentTopPage || '');
  var hasExistingPage = context.hasExistingPage === true ||
    String(context.hasExistingPage || '').toUpperCase() === 'TRUE';

  if (signals.indexOf(EARLY_ACTION_ROUTER_SIGNALS.PAGE_INTENT_MISMATCH) >= 0) {
    return earlyFollowupPlanBase_(record, {
      targetAction: 'OPTIMIZE_EXISTING_PAGE',
      opportunityType: EXTERNAL_OPPORTUNITY_TYPES.OPTIMIZE_EXISTING_PAGE,
      recommendedAction: 'CONTENT_OPTIMIZE',
      priority: 'P1',
      signalState: 'OPEN',
      createTodayAction: true,
      createResearchJob: true,
      researchType: RESEARCH_TYPE.PAGE_OPTIMIZATION_RESEARCH,
      pagePath: expectedPage || currentTopPage,
      opportunityStage: String(record.opportunityStage || 'CAPTURE'),
      routingDecision: 'OPTIMIZE_EXISTING_PAGE',
      reason: earlyMismatchReason_(record, site, clusterKey, currentTopPage, expectedPage)
    }, signals, now);
  }

  if (signals.indexOf(EARLY_ACTION_ROUTER_SIGNALS.TARGET_PAGE_TAKES_OVER) >= 0) {
    return earlyFollowupPlanBase_(record, {
      targetAction: 'TARGET_PAGE_TAKES_OVER',
      opportunityType: EXTERNAL_OPPORTUNITY_TYPES.TARGET_PAGE_TAKES_OVER,
      recommendedAction: 'AUTO_HANDLED',
      priority: 'P3',
      signalState: 'AUTO_HANDLED',
      createTodayAction: false,
      createResearchJob: false,
      pagePath: expectedPage || currentTopPage
    }, signals, now);
  }

  var opportunityStage = String(record.opportunityStage || '').trim().toUpperCase();
  if (!opportunityStage) {
    if (signals.indexOf(EARLY_ACTION_ROUTER_SIGNALS.SCALE) >= 0) opportunityStage = 'SCALE';
    else if (signals.indexOf(EARLY_ACTION_ROUTER_SIGNALS.CAPTURE) >= 0 ||
      signals.indexOf('ABSOLUTE_CAPTURE') >= 0) opportunityStage = 'CAPTURE';
    else if (signals.indexOf(EARLY_ACTION_ROUTER_SIGNALS.PROBE) >= 0 ||
      signals.indexOf('ABSOLUTE_PROBE') >= 0) opportunityStage = 'PROBE';
  }

  if (opportunityStage === 'PROBE') {
    return earlyFollowupPlanBase_(record, {
      targetAction: 'RESEARCH_PROBE',
      opportunityType: EXTERNAL_OPPORTUNITY_TYPES.RESEARCH_PROBE,
      recommendedAction: 'RESEARCH_PROBE',
      priority: 'P3',
      signalState: 'OPEN',
      createTodayAction: true,
      createResearchJob: true,
      researchType: RESEARCH_TYPE.NEW_INTENT_RESEARCH,
      pagePath: existingPage ? (currentTopPage || expectedPage) : '',
      opportunityStage: opportunityStage,
      routingDecision: 'RESEARCH_PROBE'
    }, signals, now);
  }

  if (opportunityStage === 'CAPTURE' || opportunityStage === 'SCALE') {
    var captureExisting = existingPage;
    var captureAction = captureExisting ? 'EXPAND_EXISTING_PAGE' : 'NEW_PAGE_CANDIDATE';
    var captureType = opportunityStage === 'SCALE'
      ? 'SCALE_WINNER_INTENT'
      : (captureExisting
        ? EXTERNAL_OPPORTUNITY_TYPES.EXPAND_EXISTING_PAGE
        : EXTERNAL_OPPORTUNITY_TYPES.NEW_PAGE_CANDIDATE);
    return earlyFollowupPlanBase_(record, {
      targetAction: opportunityStage === 'SCALE' ? 'SCALE_WINNER_INTENT' : captureAction,
      opportunityType: captureType,
      recommendedAction: opportunityStage === 'SCALE'
        ? 'RESEARCH_EXPANSION'
        : (captureExisting ? 'RESEARCH_EXISTING_PAGE' : 'RESEARCH_NEW_PAGE'),
      priority: opportunityStage === 'SCALE' || captureExisting ? 'P1' : 'P2',
      signalState: 'OPEN',
      createTodayAction: true,
      createResearchJob: true,
      researchType: RESEARCH_TYPE.NEW_INTENT_RESEARCH,
      pagePath: captureExisting ? (currentTopPage || expectedPage) : '',
      opportunityStage: opportunityStage,
      routingDecision: opportunityStage === 'SCALE'
        ? 'RESEARCH_EXPANSION'
        : (captureExisting ? 'RESEARCH_EXISTING_PAGE' : 'RESEARCH_NEW_PAGE')
    }, signals, now);
  }

  var isGrowing = signals.indexOf(EARLY_ACTION_ROUTER_SIGNALS.GROWING_INTENT) >= 0;
  var isNew = signals.indexOf(EARLY_ACTION_ROUTER_SIGNALS.NEW_INTENT) >= 0;
  if (!isGrowing && !isNew) return null;

  var existingPage = hasExistingPage && !!(
    (currentTopPage && currentTopPage !== '/') ||
    (expectedPage && expectedPage !== '/')
  );
  var targetAction = existingPage ? 'EXPAND_EXISTING_PAGE' : 'NEW_PAGE_CANDIDATE';
  var gate = earlyResearchGate_(record, signals, rules);
  return earlyFollowupPlanBase_(record, {
    targetAction: targetAction,
    opportunityType: existingPage
      ? EXTERNAL_OPPORTUNITY_TYPES.EXPAND_EXISTING_PAGE
      : EXTERNAL_OPPORTUNITY_TYPES.NEW_PAGE_CANDIDATE,
    recommendedAction: existingPage ? 'RESEARCH_EXISTING_PAGE' : 'RESEARCH_NEW_PAGE',
    priority: 'P2',
    signalState: gate ? 'OPEN' : 'OBSERVE',
    createTodayAction: gate,
    createResearchJob: gate,
    researchType: RESEARCH_TYPE.NEW_INTENT_RESEARCH,
    pagePath: existingPage ? (currentTopPage && currentTopPage !== '/' ? currentTopPage : expectedPage) : '',
    opportunityStage: isGrowing ? 'CAPTURE' : 'PROBE',
    routingDecision: existingPage ? 'RESEARCH_EXISTING_PAGE' : 'RESEARCH_NEW_PAGE'
  }, signals, now);
}

function earlyMismatchReason_(record, site, clusterKey, currentTopPage, expectedPage) {
  var base = String(record.reason || 'PAGE_INTENT_MISMATCH').trim();
  return base + ' | site=' + site +
    ' | cluster=' + clusterKey +
    ' | currentTopPage=' + (currentTopPage || '/') +
    ' | expectedPage=' + (expectedPage || '/') +
    ' | impressions=' + Number(record.currentImpressions || 0) +
    ' | topPageShare=' + Number(record.currentTopPageShare || 0) +
    ' | observationCount=' + Number(record.observationCount || 0);
}

function earlyFollowupPlanBase_(record, route, signals, now) {
  var actionKey = earlyActionKey_(record.siteObject || record.site, record.clusterKey, route.targetAction);
  return {
    actionKey: actionKey,
    opportunityId: actionKey,
    site: String(record.site || '').trim(),
    siteIdentity: earlySiteIdentity_(record.siteObject || { name: record.site }),
    clusterKey: String(record.clusterKey || '').trim(),
    clusterLabel: String(record.clusterLabel || record.clusterKey || '').trim(),
    signals: signals.slice(),
    confidence: String(record.confidence || 'LOW'),
    reason: String(route.reason || record.reason || signals.join('|')).trim(),
    currentImpressions: Number(record.currentImpressions || 0),
    currentClicks: Number(record.currentClicks || 0),
    currentPosition: Number(record.currentPosition || 0),
    currentTopPage: normalizeEarlyRouterPath_(record.currentTopPage || ''),
    expectedPage: normalizeEarlyRouterPath_(record.expectedPage || ''),
    currentTopPageShare: Number(record.currentTopPageShare || 0),
    observationCount: Number(record.observationCount || 0),
    targetAction: route.targetAction,
    opportunityType: route.opportunityType,
    recommendedAction: route.recommendedAction,
    priority: route.priority,
    signalState: route.signalState,
    autoHandled: route.signalState === 'AUTO_HANDLED',
    createTodayAction: route.createTodayAction,
    createResearchJob: route.createResearchJob,
    researchType: route.researchType || '',
    pagePath: route.pagePath || '',
    opportunityStage: route.opportunityStage || String(record.opportunityStage || '').trim(),
    routingDecision: route.routingDecision || route.recommendedAction || '',
    now: now || new Date()
  };
}

function mergeEarlyActionPlans_(left, right) {
  var signals = earlyActionUniqueSignals_((left.signals || []).concat(right.signals || []));
  left.signals = signals;
  left.reason = String(left.reason || '') + '；' + String(right.reason || '');
  left.currentImpressions = Math.max(Number(left.currentImpressions || 0), Number(right.currentImpressions || 0));
  left.currentClicks = Math.max(Number(left.currentClicks || 0), Number(right.currentClicks || 0));
  left.currentTopPageShare = Math.max(Number(left.currentTopPageShare || 0), Number(right.currentTopPageShare || 0));
  left.createTodayAction = left.createTodayAction || right.createTodayAction;
  left.createResearchJob = left.createResearchJob || right.createResearchJob;
  if (right.opportunityStage === 'SCALE' || !left.opportunityStage) {
    left.opportunityStage = right.opportunityStage || left.opportunityStage;
  }
  if (right.routingDecision) left.routingDecision = right.routingDecision;
  if (right.signalState === 'OPEN') left.signalState = 'OPEN';
  return left;
}

function earlyResearchGate_(record, signals, rules) {
  if (signals.indexOf(EARLY_ACTION_ROUTER_SIGNALS.GROWING_INTENT) >= 0) return true;
  if (signals.indexOf(EARLY_ACTION_ROUTER_SIGNALS.PAGE_INTENT_MISMATCH) >= 0) return true;
  if (signals.indexOf(EARLY_ACTION_ROUTER_SIGNALS.NEW_INTENT) >= 0) {
    return Number(record.currentImpressions || 0) >= Number(rules.EARLY_RESEARCH_MIN_IMPRESSIONS || 0) ||
      Number(record.currentClicks || 0) >= 1 ||
      String(record.confidence || '').toUpperCase() === 'HIGH';
  }
  return false;
}

function earlyActionDay_(record, rules) {
  var day = Number(record && record.day);
  if (!isNaN(day) && day > 0) return day;
  var maxDay = Number(rules && rules.EARLY_FOLLOWUP_MAX_DAY);
  if (isNaN(maxDay) || maxDay <= 0) maxDay = 6;
  return maxDay + 1;
}

function earlyActionMaxDay_(rules) {
  var maxDay = Number(rules && rules.EARLY_FOLLOWUP_MAX_DAY);
  return isNaN(maxDay) || maxDay <= 0 ? 6 : maxDay;
}

function earlySiteWinActionKey_(early) {
  var site = early && early.siteObject ? early.siteObject : early || {};
  var identity = earlySiteIdentity_(site);
  var day0 = String((site && site.day0) || '').trim();
  return 'EARLY_SITE_WIN:' + identity + (day0 ? ':' + day0 : '');
}

function earlySiteIdentity_(site) {
  site = site || {};
  return String(site.siteId || site.site_id || site.propertyUrl || site.name || site.site || '').trim();
}

function earlyActionKey_(site, clusterKey, targetAction) {
  return 'EARLY:' + earlySiteIdentity_(typeof site === 'string' ? { name: site } : site) + ':' +
    String(clusterKey || '').trim() + ':' + String(targetAction || '').trim();
}

function earlyActionResearchDedupeKey_(plan) {
  return String(plan.siteIdentity || plan.site || '').trim() + '||' + String(plan.clusterKey || '').trim() +
    '||' + String(plan.targetAction || '').trim();
}

function shouldCreateEarlyResearchJob_(plan, existingJobs, routerState) {
  if (!plan || !plan.createResearchJob) return false;
  var dedupeKey = earlyActionResearchDedupeKey_(plan);
  var prior = routerState && routerState[plan.actionKey];
  if (prior && prior.signalSignature === plan.signals.join('|') && prior.researchJobId) return false;
  for (var i = 0; i < (existingJobs || []).length; i++) {
    var job = existingJobs[i] || {};
    if (!isEarlyResearchJobActive_(job.status)) continue;
    if (job.dedupeKey === dedupeKey || (
      String(job.site || '').trim() === String(plan.site || '').trim() &&
      String(job.clusterKey || '').trim() === String(plan.clusterKey || '').trim()
    )) return false;
  }
  return true;
}

function isEarlyResearchJobActive_(status) {
  var value = String(status || '').trim().toUpperCase();
  return !value || value === 'PENDING' || value === 'RUNNING' || value === 'REVIEW' ||
    value === 'READY' || value === 'READY_FOR_DISCOVERY_RUNNER' || value === 'READY_FOR_SEARCH_RUNNER' ||
    value === 'APPROVED' || value === '待处理' || value === '运行中' || value === '待审核' || value === '已批准';
}

function earlyActionClusterContexts_(snapshots) {
  var out = {};
  for (var i = 0; i < (snapshots || []).length; i++) {
    var snapshot = snapshots[i] || {};
    var site = snapshot.site || {};
    var siteName = String(site.name || '').trim();
    var clusters = snapshot.clusters || [];
    for (var c = 0; c < clusters.length; c++) {
      var cluster = clusters[c] || {};
      var key = String(cluster.key || '').trim();
      if (!siteName || !key) continue;
      out[siteName + '||' + key] = {
        siteObject: site,
        hasExistingPage: cluster.hasExistingPage === true || String(cluster.hasExistingPage || '').toUpperCase() === 'TRUE',
        topPage: cluster.topPage || '',
        expectedPage: cluster.expectedPage || '',
        queries: cluster.queries || []
      };
    }
  }
  return out;
}

function earlyActionSiteObjects_(snapshots) {
  var out = {};
  for (var i = 0; i < (snapshots || []).length; i++) {
    var site = (snapshots[i] && snapshots[i].site) || {};
    var name = String(site.name || '').trim();
    if (name) out[name] = site;
  }
  return out;
}

function earlyActionWithSiteObject_(record, siteObject) {
  if (!siteObject) return record;
  var out = {};
  var keys = Object.keys(record || {});
  for (var i = 0; i < keys.length; i++) out[keys[i]] = record[keys[i]];
  out.siteObject = siteObject;
  return out;
}

function upsertEarlyOpportunity_(plan) {
  if (typeof writeExternalOpportunityCandidatesM0_ !== 'function') return;
  var evidence = {
    source: 'EarlyActionRouter',
    signals: plan.signals,
    site: plan.site,
    clusterKey: plan.clusterKey,
    clusterLabel: plan.clusterLabel,
    impressions: plan.currentImpressions,
    clicks: plan.currentClicks,
    position: plan.currentPosition,
    topPage: plan.currentTopPage,
    expectedPage: plan.expectedPage,
    topPageShare: plan.currentTopPageShare,
    observationCount: plan.observationCount,
    opportunityStage: plan.opportunityStage,
    routingDecision: plan.routingDecision,
    reason: plan.reason,
    state: plan.signalState
  };
  writeExternalOpportunityCandidatesM0_([{
    OpportunityID: plan.opportunityId,
    Game: plan.site,
    OpportunityType: plan.opportunityType,
    ExternalEvidence: { topic: plan.clusterLabel || plan.site, early: evidence },
    GSCEvidence: plan.currentTopPage ? [{ pagePath: plan.currentTopPage, impressions: plan.currentImpressions, clicks: plan.currentClicks }] : [],
    ExistingAsset: plan.expectedPage ? { pagePath: plan.expectedPage } : null,
    Confidence: plan.confidence,
    RecommendedAction: plan.recommendedAction,
    SourceReference: 'Intent机会 / EarlyFollowup / ' + plan.actionKey,
    SignalState: plan.signalState,
    ActionKey: plan.actionKey,
    LastObservedAt: plan.now
  }]);
}

function updateEarlyIntentOpportunityRouting_(plan) {
  if (!plan || !plan.site || !plan.clusterKey || typeof getSpreadsheet_ !== 'function') return;
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.INTENT_OPPORTUNITIES);
  if (!sheet || sheet.getLastRow() < 2) return;
  var lastCol = Math.max(sheet.getLastColumn(), INTENT_OPPORTUNITY_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  if (col.RoutingDecision === undefined) return;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][col.Site] || '').trim() !== plan.site) continue;
    if (String(rows[i][col.ClusterKey] || '').trim() !== plan.clusterKey) continue;
    rows[i][col.RoutingDecision] = plan.routingDecision || plan.recommendedAction || '';
    if (col.OpportunityStage !== undefined) rows[i][col.OpportunityStage] = plan.opportunityStage || '';
    sheet.getRange(i + 2, 1, 1, lastCol).setValues([rows[i]]);
    return;
  }
}

function upsertEarlyTodayAction_(plan) {
  if (typeof getSpreadsheet_ !== 'function') return;
  var sheet = ensureSheet_(SHEET_NAMES.TODAY_ACTIONS, TODAY_ACTION_HEADERS);
  ensureTodayActionHeader_();
  var lastCol = Math.max(sheet.getLastColumn(), TODAY_ACTION_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var rows = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues() : [];
  var target = -1;
  for (var i = 0; i < rows.length; i++) {
    if (String(cell_(rows[i], col, 'OpportunityID') || '').trim() === plan.actionKey) {
      target = i;
      break;
    }
  }
  var row = target >= 0 ? rows[target].slice() : new Array(lastCol).fill('');
  row[col['Date']] = typeof todayStr_ === 'function' ? todayStr_() : plan.now;
  row[col['Priority']] = plan.priority;
  row[col['Site']] = plan.site;
  row[col['LifecycleStage']] = 'EARLY';
  row[col['RecommendedAction']] = plan.recommendedAction;
  row[col['DomainScore']] = '';
  row[col['Reason']] = plan.reason;
  if (target < 0 || !String(row[col['Status']] || '').trim()) row[col['Status']] = 'TODO';
  if (col['SourceSystem'] !== undefined) row[col['SourceSystem']] = EARLY_ACTION_ROUTER_SOURCE;
  if (col['OpportunityID'] !== undefined) row[col['OpportunityID']] = plan.opportunityId;
  if (col['Game'] !== undefined) row[col['Game']] = plan.site;
  if (col['OpportunityType'] !== undefined) row[col['OpportunityType']] = plan.opportunityType;
  if (col['CurrentState'] !== undefined) row[col['CurrentState']] = plan.signalState === 'AUTO_HANDLED'
    ? 'AUTO_HANDLED / AUTO_MONITORING' : plan.signalState;
  if (col['SourceReference'] !== undefined) row[col['SourceReference']] = 'EarlyActionRouter / ' + plan.actionKey;
  if (target >= 0) {
    sheet.getRange(target + 2, 1, 1, lastCol).setValues([row]);
  } else {
    ensureSheetGrid_(sheet, sheet.getLastRow() + 1, lastCol);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, lastCol).setValues([row]);
  }
}

function loadEarlyResearchJobs_() {
  var out = [];
  if (typeof getSpreadsheet_ !== 'function') return out;
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet || sheet.getLastRow() < 2) return out;
  var lastCol = Math.max(sheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  for (var i = 0; i < rows.length; i++) {
    var context = safeJsonParse_(cell_(rows[i], col, 'ActionContext'), {});
    var site = String(context.site || cell_(rows[i], col, '站点') || '').trim();
    var clusterKey = String(context.clusterKey || '').trim();
    if (context.sourceSystem !== EARLY_ACTION_ROUTER_SOURCE && !context.earlyActionKey && !clusterKey) continue;
    out.push({
      jobId: String(cell_(rows[i], col, '任务ID') || '').trim(),
      status: String(cell_(rows[i], col, '任务状态') || '').trim(),
      site: site,
      clusterKey: clusterKey,
      dedupeKey: String(context.dedupeKey || '').trim() ||
        (site + '||' + clusterKey + '||' + String(context.targetAction || '').trim())
    });
  }
  return out;
}

function createEarlyResearchJob_(plan, existingJobs, now) {
  if (typeof getSpreadsheet_ !== 'function' || typeof researchJobSheetRow_ !== 'function') return null;
  ensureResearchJobSheets_();
  var dedupeKey = earlyActionResearchDedupeKey_(plan);
  for (var i = 0; i < (existingJobs || []).length; i++) {
    if (isEarlyResearchJobActive_(existingJobs[i].status) && (
      existingJobs[i].dedupeKey === dedupeKey || (
        String(existingJobs[i].site || '').trim() === String(plan.site || '').trim() &&
        String(existingJobs[i].clusterKey || '').trim() === String(plan.clusterKey || '').trim()
      )
    )) {
      return null;
    }
  }
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  var createdAt = now || new Date();
  var topic = plan.clusterLabel || plan.site;
  var sourceQuery = topic;
  var jobId = makeResearchJobId_(plan.site, plan.pagePath || plan.expectedPage || '', topic, sourceQuery, createdAt);
  var existingIds = {};
  if (sheet && sheet.getLastRow() >= 2) {
    var idCol = headerIndexMap_(sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), RESEARCH_JOB_HEADERS.length)).getValues()[0])['任务ID'];
    var idRows = sheet.getRange(2, idCol + 1, sheet.getLastRow() - 1, 1).getValues();
    for (var r = 0; r < idRows.length; r++) existingIds[String(idRows[r][0] || '').trim()] = true;
  }
  if (existingIds[jobId]) jobId = uniquifyResearchJobId_(jobId, plan.clusterKey || topic);
  var job = {
    job_id: jobId,
    game: plan.site,
    topic: topic,
    existing_page: plan.pagePath || plan.expectedPage || '',
    opportunity_level: plan.priority === 'P1' ? OPPORTUNITY_LEVELS.HIGH : OPPORTUNITY_LEVELS.MEDIUM,
    recommended_action: plan.opportunityType === EXTERNAL_OPPORTUNITY_TYPES.OPTIMIZE_EXISTING_PAGE
      ? OPPORTUNITY_ACTIONS.RESEARCH_EXPAND_EXISTING
      : (plan.opportunityType === EXTERNAL_OPPORTUNITY_TYPES.EXPAND_EXISTING_PAGE
        ? OPPORTUNITY_ACTIONS.RESEARCH_EXPAND_EXISTING
        : OPPORTUNITY_ACTIONS.RESEARCH_NEW_CONTENT),
    source_query: sourceQuery,
    related_queries: sourceQuery,
    research_type: plan.researchType,
    source_action: plan.recommendedAction,
    action_context: {
      sourceSystem: EARLY_ACTION_ROUTER_SOURCE,
      earlyActionKey: plan.actionKey,
      dedupeKey: dedupeKey,
      site: plan.site,
      clusterKey: plan.clusterKey,
      targetAction: plan.targetAction,
      signals: plan.signals,
      reason: plan.reason,
      currentImpressions: plan.currentImpressions,
      currentClicks: plan.currentClicks,
      currentTopPage: plan.currentTopPage,
      expectedPage: plan.expectedPage,
      observationCount: plan.observationCount
    }
  };
  var row = researchJobSheetRow_(job, plan.site, createdAt);
  var start = sheet.getLastRow() + 1;
  if (start < 2) start = 2;
  sheet.getRange(start, 1, 1, RESEARCH_JOB_HEADERS.length).setValues([row]);
  return { jobId: jobId, status: RESEARCH_JOB_STATUS_LABELS.PENDING || '待处理', dedupeKey: dedupeKey };
}

function resolveEarlyMismatchForTakeover_(plan) {
  if (!plan || !plan.clusterKey || typeof getSpreadsheet_ !== 'function') return false;
  var mismatchKey = earlyActionKey_({ name: plan.siteIdentity }, plan.clusterKey, 'OPTIMIZE_EXISTING_PAGE');
  var changed = updateEarlyOpportunityState_(mismatchKey, 'RESOLVED', 'RECOVERED');
  updateEarlyTodayActionResolution_(mismatchKey);
  return changed;
}

function updateEarlyOpportunityState_(actionKey, state, resolution) {
  if (typeof getSpreadsheet_ !== 'function') return false;
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.OPPORTUNITIES);
  if (!sheet || sheet.getLastRow() < 2) return false;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  if (col['ActionKey'] === undefined || col['SignalState'] === undefined) return false;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][col['ActionKey']] || '').trim() !== actionKey) continue;
    rows[i][col['SignalState']] = state;
    var evidence = safeJsonParse_(rows[i][col['ExternalEvidence']], {});
    evidence.resolution = resolution;
    evidence.resolvedAt = new Date();
    rows[i][col['ExternalEvidence']] = JSON.stringify(evidence);
    sheet.getRange(i + 2, 1, 1, lastCol).setValues([rows[i]]);
    return true;
  }
  return false;
}

function updateEarlyTodayActionResolution_(actionKey) {
  if (typeof getSpreadsheet_ !== 'function') return;
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.TODAY_ACTIONS);
  if (!sheet || sheet.getLastRow() < 2) return;
  var lastCol = Math.max(sheet.getLastColumn(), TODAY_ACTION_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(cell_(rows[i], col, 'OpportunityID') || '').trim() !== actionKey) continue;
    if (col['RecommendedAction'] !== undefined) rows[i][col['RecommendedAction']] = 'WAIT';
    if (col['CurrentState'] !== undefined) rows[i][col['CurrentState']] = 'RESOLVED / RECOVERED';
    if (col['Reason'] !== undefined) rows[i][col['Reason']] = 'PAGE_INTENT_MISMATCH 已由 TARGET_PAGE_TAKES_OVER 恢复。';
    sheet.getRange(i + 2, 1, 1, lastCol).setValues([rows[i]]);
  }
}

function ensureEarlyActionRouterProductionSchema_() {
  if (typeof ensureSheet_ !== 'function') return;
  ensureSheet_(SHEET_NAMES.OPPORTUNITIES, OPPORTUNITY_HEADERS);
  if (typeof ensureExternalOpportunityHeaders_ === 'function') ensureExternalOpportunityHeaders_();
  ensureSheet_(SHEET_NAMES.TODAY_ACTIONS, TODAY_ACTION_HEADERS);
  if (typeof ensureTodayActionHeader_ === 'function') ensureTodayActionHeader_();
  if (typeof seedMissingDecisionRules_ === 'function') seedMissingDecisionRules_();
}

function loadEarlyActionRouterState_() {
  if (typeof PropertiesService === 'undefined') return {};
  var raw = PropertiesService.getScriptProperties().getProperty(EARLY_ACTION_ROUTER_STATE_PROPERTY);
  return safeJsonParse_(raw, {});
}

function persistEarlyActionRouterState_(state) {
  if (typeof PropertiesService === 'undefined') return;
  PropertiesService.getScriptProperties().setProperty(
    EARLY_ACTION_ROUTER_STATE_PROPERTY,
    JSON.stringify(state || {})
  );
}

function earlyActionUniqueSignals_(signals) {
  var out = [];
  var seen = {};
  for (var i = 0; i < (signals || []).length; i++) {
    var signal = String(signals[i] || '').trim();
    if (!signal || seen[signal]) continue;
    seen[signal] = true;
    out.push(signal);
  }
  return out;
}

function normalizeEarlyRouterPath_(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  if (typeof normalizeOpportunityPath_ === 'function') return normalizeOpportunityPath_(text);
  if (text.charAt(0) !== '/') text = '/' + text;
  return text.length > 1 ? text.replace(/\/+$/, '') + '/' : '/';
}
