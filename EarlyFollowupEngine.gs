/**
 * Goal 2: Early Winner follow-up signals.
 *
 * This module observes the existing IntentOpportunityEngine clusters after
 * Goal 1 has classified a site as EARLY_WINNER. It only records signals and
 * never writes 今日行动, Research Jobs, content tasks, or website changes.
 */

var EARLY_FOLLOWUP_SIGNALS = {
  BASELINE: 'BASELINE',
  ABSOLUTE_PROBE: 'ABSOLUTE_PROBE',
  ABSOLUTE_CAPTURE: 'ABSOLUTE_CAPTURE',
  GROWING_INTENT: 'GROWING_INTENT',
  NEW_INTENT: 'NEW_INTENT',
  TARGET_PAGE_TAKES_OVER: 'TARGET_PAGE_TAKES_OVER',
  PAGE_INTENT_MISMATCH: 'PAGE_INTENT_MISMATCH'
};

function runEarlyFollowupEngine(opts) {
  opts = opts || {};
  ensureEarlyFollowupProductionSchema_();

  var snapshots = (opts.snapshots || []).slice();
  if (!snapshots.length && typeof loadEarlySignalSnapshotsFromSheets_ === 'function') {
    snapshots = loadEarlySignalSnapshotsFromSheets_();
  }
  var rules = opts.rules || getDecisionRules_();
  var now = opts.now || new Date();
  var previousStates = opts.previousStates || loadEarlyFollowupStates_();
  var eligibleBySite = earlyFollowupEligibleSites_(opts.earlyRecords, previousStates);
  var siteHasBaseline = earlyFollowupBaselineSites_(previousStates);
  var nextStates = cloneEarlyFollowupStates_(previousStates);
  var records = [];
  var events = [];

  for (var i = 0; i < snapshots.length; i++) {
    var snapshot = snapshots[i] || {};
    var site = snapshot.site || {};
    var siteName = String(site.name || '').trim();
    if (!siteName || !eligibleBySite[siteName]) continue;

    var early = eligibleBySite[siteName];
    var day = earlyFollowupDay_(site, early, now);

    var clusters = (snapshot.clusters || []).slice();
    for (var c = 0; c < clusters.length; c++) {
      var current = normalizeEarlyFollowupCluster_(clusters[c]);
      if (!current.key) continue;
      var stateKey = earlyFollowupStateKey_(siteName, current.key);
      var previous = previousStates[stateKey] || null;
      var record = evaluateEarlyFollowupObservation_(
        site,
        current,
        previous,
        !!siteHasBaseline[siteName],
        rules,
        now,
        opts
      );
      record.day = Number(day);
      record.site = siteName;
      record.stateKey = stateKey;
      nextStates[stateKey] = record.state;
      records.push(record);
      if (record.event) events.push(record);
    }
    siteHasBaseline[siteName] = true;
  }

  persistEarlyFollowupStates_(nextStates);
  writeEarlyFollowupIntentRows_(records);
  for (var e = 0; e < events.length; e++) {
    writeLog_('INFO', events[e].site, 'Early Follow-up 信号：' + events[e].signals.join('|'));
  }
  writeLog_('INFO', '', 'runEarlyFollowupEngine 完成 | sites=' +
    Object.keys(eligibleBySite).length + ' | observations=' + records.length +
    ' | signals=' + events.length);
  return { records: records, events: events };
}

/** Pure observation evaluator used by production and focused fixtures. */
function evaluateEarlyFollowupObservation_(site, current, previous, baselineEstablished, rules, now, opts) {
  opts = opts || {};
  rules = rules || {};
  current = normalizeEarlyFollowupCluster_(current);
  var hasPrevious = !!previous;
  var previousImpressions = hasPrevious ? earlyFollowupNumber_(previous.currentImpressions) : '';
  var previousClicks = hasPrevious ? earlyFollowupNumber_(previous.currentClicks) : '';
  var previousPosition = hasPrevious ? earlyFollowupNumber_(previous.currentPosition) : '';
  var previousTopPage = hasPrevious ? String(previous.currentTopPage || '') : '';
  var previousTopPageShare = hasPrevious ? earlyFollowupNumber_(previous.currentTopPageShare) : '';
  var previousStage = hasPrevious ? String(previous.opportunityStage || '') : '';
  var intentType = current.intentType || '';
  var intentFamily = current.intentFamily || '';
  var externalDemandConfirmed = earlyFollowupExternalDemandConfirmed_(site, current, opts);
  var adjacentCaptureCandidates = buildAdjacentCaptureCandidates_(
    current,
    opts.externalAdjacentIntentsByKey && opts.externalAdjacentIntentsByKey[
      earlyFollowupStateKey_(site && site.name, current.key)
    ] || current.externalAdjacentIntents
  );
  var expectedPage = String(
    (hasPrevious && previous.expectedPage) ||
    resolveEarlyFollowupExpectedPage_(site, current, opts) || ''
  ).trim();
  var evidence = expectedPage ? resolveEarlyFollowupPageEvidence_(site, expectedPage, opts) : null;
  var observationCount = (hasPrevious ? Number(previous.observationCount || 0) : 0) + 1;
  var growthEligible = hasPrevious && observationCount >= 2;
  var mismatchCondition = !!(
    expectedPage && evidence && evidence.valid && hasPrevious &&
    current.impressions >= Number(rules.EARLY_PAGE_MISMATCH_MIN_IMPRESSIONS) &&
    current.topPage !== expectedPage &&
    current.topPageShare >= Number(rules.EARLY_PAGE_MISMATCH_DOMINANT_SHARE)
  );
  var mismatchConfirmRuns = mismatchCondition
    ? (Number(previous && previous.mismatchConfirmRuns || 0) + 1)
    : 0;
  var signals = [];

  var absolute = evaluateEarlyAbsoluteSignal_(current, intentType, externalDemandConfirmed, rules);
  if (!hasPrevious && intentType) signals.push(EARLY_FOLLOWUP_SIGNALS.BASELINE);
  if (absolute.signal) signals.push(absolute.signal);

  if (
    growthEligible &&
    Number(previousImpressions) >= Number(rules.EARLY_QUERY_GROWTH_MIN_PREVIOUS_IMPRESSIONS) &&
    current.impressions >= Number(previousImpressions) * (1 + Number(rules.EARLY_QUERY_GROWTH_RATE)) &&
    current.impressions - Number(previousImpressions) >= Number(rules.EARLY_QUERY_GROWTH_MIN_ABSOLUTE_DELTA)
  ) {
    signals.push(EARLY_FOLLOWUP_SIGNALS.GROWING_INTENT);
  }

  if (
    !hasPrevious && baselineEstablished &&
    (
      current.impressions >= Number(rules.EARLY_NEW_INTENT_MIN_IMPRESSIONS) ||
      current.clicks >= 1 ||
      (current.position > 0 && current.position <= Number(rules.EARLY_NEW_INTENT_MAX_POSITION))
    )
  ) {
    signals.push(EARLY_FOLLOWUP_SIGNALS.NEW_INTENT);
  }

  if (
    hasPrevious && expectedPage && current.topPage === expectedPage &&
    previousTopPage !== expectedPage &&
    current.topPageShare >= Number(rules.EARLY_PAGE_TAKEOVER_MIN_SHARE) &&
    current.impressions >= Number(rules.EARLY_PAGE_SIGNAL_MIN_IMPRESSIONS)
  ) {
    signals.push(EARLY_FOLLOWUP_SIGNALS.TARGET_PAGE_TAKES_OVER);
  }

  if (mismatchCondition && mismatchConfirmRuns >= Number(rules.EARLY_PAGE_MISMATCH_CONFIRM_RUNS)) {
    signals.push(EARLY_FOLLOWUP_SIGNALS.PAGE_INTENT_MISMATCH);
  }

  var growing = signals.indexOf(EARLY_FOLLOWUP_SIGNALS.GROWING_INTENT) >= 0;
  var opportunityStage = determineEarlyOpportunityStage_(
    absolute.stage, previousStage, growing, current.impressions, rules
  );
  if (adjacentCaptureCandidates.length && opportunityStage !== 'SCALE') {
    opportunityStage = 'CAPTURE';
  }

  var confidence = classifyEarlyFollowupConfidence_(current, signals, observationCount, expectedPage, evidence);
  var reason = buildEarlyFollowupReason_(
    current, previous, signals, expectedPage, observationCount, mismatchConfirmRuns, absolute
  );
  var signalText = signals.join('|');
  var eventSignals = signals.filter(function (signal) {
    return signal !== EARLY_FOLLOWUP_SIGNALS.BASELINE;
  });
  var event = earlyFollowupShouldEmitEvent_(
    previous, eventSignals.join('|'), eventSignals, now, rules
  );
  var firstSeenAt = previous && previous.firstSeenAt ? previous.firstSeenAt : now;
  var state = {
    site: String((site && site.name) || ''),
    clusterKey: current.key,
    clusterLabel: current.label,
    previousImpressions: previousImpressions,
    currentImpressions: current.impressions,
    previousClicks: previousClicks,
    currentClicks: current.clicks,
    previousPosition: previousPosition,
    currentPosition: current.position,
    previousTopPage: previousTopPage,
    currentTopPage: current.topPage,
    previousTopPageShare: previousTopPageShare,
    currentTopPageShare: current.topPageShare,
    firstSeenAt: firstSeenAt,
    lastObservedAt: now,
    expectedPage: expectedPage,
    followupSignals: signalText,
    followupConfidence: confidence,
    followupReason: reason,
    observationCount: observationCount,
    mismatchConfirmRuns: mismatchConfirmRuns,
    signalEventAt: event ? now : (previous && previous.signalEventAt) || '',
    intentType: intentType,
    intentFamily: intentFamily,
    opportunityStage: opportunityStage,
    absoluteSignal: absolute.signal,
    absoluteSignalReason: absolute.reason,
    adjacentCaptureCandidates: adjacentCaptureCandidates,
    adjacentCaptureReason: adjacentCaptureCandidates.length
      ? 'fresh external evidence identified the next natural intent(s)'
      : ''
  };

  return {
    site: String((site && site.name) || ''),
    clusterKey: current.key,
    clusterLabel: current.label,
    previousImpressions: previousImpressions,
    currentImpressions: current.impressions,
    growthRate: hasPrevious && Number(previousImpressions) > 0
      ? (current.impressions - Number(previousImpressions)) / Number(previousImpressions)
      : '',
    previousClicks: previousClicks,
    currentClicks: current.clicks,
    previousPosition: previousPosition,
    currentPosition: current.position,
    previousTopPage: previousTopPage,
    expectedPage: expectedPage,
    currentTopPage: current.topPage,
    previousTopPageShare: previousTopPageShare,
    currentTopPageShare: current.topPageShare,
    signals: signals,
    intentType: intentType,
    intentFamily: intentFamily,
    opportunityStage: opportunityStage,
    absoluteSignal: absolute.signal,
    absoluteSignalReason: absolute.reason,
    routingDecision: earlyFollowupRoutingDecision_(opportunityStage, current.hasExistingPage),
    adjacentCaptureCandidates: adjacentCaptureCandidates,
    adjacentCaptureReason: adjacentCaptureCandidates.length
      ? 'ADJACENT_CAPTURE_CANDIDATE'
      : '',
    confidence: confidence,
    reason: reason,
    firstSeenAt: firstSeenAt,
    lastObservedAt: now,
    observationCount: observationCount,
    mismatchConfirmRuns: mismatchConfirmRuns,
    event: event,
    state: state
  };
}

function normalizeEarlyFollowupCluster_(cluster) {
  cluster = cluster || {};
  var pages = cluster.pages || [];
  var page = pages.length ? pages[0] : null;
  var impressions = earlyFollowupNumber_(cluster.impressions);
  var topPage = String(cluster.topPage || (page && page.page) || '').trim();
  var topPageShare = cluster.topPageShare;
  if (topPageShare === undefined || topPageShare === null || topPageShare === '') {
    topPageShare = impressions > 0 && page ? earlyFollowupNumber_(page.impressions) / impressions : 0;
  }
  return {
    key: String(cluster.key || '').trim(),
    label: String(cluster.label || '').trim(),
    impressions: impressions,
    clicks: earlyFollowupNumber_(cluster.clicks),
    position: earlyFollowupNumber_(cluster.position),
    topPage: earlyFollowupNormalizePath_(topPage),
    topPageShare: earlyFollowupNumber_(topPageShare),
    hasDominantPage: cluster.hasDominantPage === true || String(cluster.hasDominantPage || '').toUpperCase() === 'TRUE',
    hasExistingPage: cluster.hasExistingPage === true || String(cluster.hasExistingPage || '').toUpperCase() === 'TRUE',
    intentType: String(cluster.intentType || cluster.IntentType || '').trim().toUpperCase(),
    intentFamily: String(cluster.intentFamily || cluster.IntentFamily || '').trim().toUpperCase(),
    externalDemandConfirmed: cluster.externalDemandConfirmed === true ||
      String(cluster.externalDemandConfirmed || cluster.ExternalDemandConfirmed || '').toUpperCase() === 'TRUE',
    topQuery: String(cluster.topQuery || '').trim(),
    queries: cluster.queries || [],
    externalAdjacentIntents: cluster.externalAdjacentIntents ||
      cluster.adjacentIntents || cluster.adjacentCaptureCandidates || []
  };
}

/**
 * External research is an input to the Goal queue, not an article generator.
 * Keep this pure and deterministic so a fresh research callback can feed the
 * same path without making Apps Script responsible for writing prose.
 */
function buildAdjacentCaptureCandidates_(seedCluster, externalIntents) {
  seedCluster = seedCluster || {};
  var list = externalIntents;
  if (!Array.isArray(list)) list = list ? [list] : [];
  var out = [];
  var seen = {};
  var seedText = String(seedCluster.label || seedCluster.topQuery || '').trim();
  var seedNormalized = typeof intentClusterNormalizeText_ === 'function'
    ? intentClusterNormalizeText_(seedText)
    : seedText.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (var i = 0; i < list.length; i++) {
    var item = list[i] || {};
    var intent = String(item.intent || item.query || item.label || item.name || '').trim();
    if (!intent) continue;
    var normalized = typeof intentClusterNormalizeText_ === 'function'
      ? intentClusterNormalizeText_(intent)
      : intent.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!normalized || normalized === seedNormalized || seen[normalized]) continue;
    seen[normalized] = true;
    out.push({
      intent: intent,
      normalizedIntent: normalized,
      status: 'ADJACENT_CAPTURE_CANDIDATE',
      sourceRefs: item.sourceRefs || item.source_refs || item.sources || [],
      reason: String(item.reason || 'natural next-step intent from fresh external evidence').trim()
    });
  }
  return out;
}

function evaluateEarlyAbsoluteSignal_(current, intentType, externalDemandConfirmed, rules) {
  var impressions = Number(current.impressions || 0);
  var clicks = Number(current.clicks || 0);
  var position = Number(current.position || 0);
  var hasPosition = position > 0;
  var type = String(intentType || '').toUpperCase();
  var specific = type === 'SPECIFIC_INTENT';
  var generic = type === 'GENERIC_INTENT';
  var brand = type === 'BRAND_INTENT' || type === 'BRAND_ONLY';
  var probe = false;
  var capture = false;
  var reason = '';

  if (specific) {
    capture = (
      impressions >= Number(rules.EARLY_ABSOLUTE_CAPTURE_MIN_IMPRESSIONS) &&
      hasPosition && position <= Number(rules.EARLY_ABSOLUTE_CAPTURE_MAX_POSITION)
    ) || clicks >= Number(rules.EARLY_ABSOLUTE_CAPTURE_MIN_CLICKS) || (
      impressions >= Number(rules.EARLY_ABSOLUTE_CAPTURE_STRONG_MIN_IMPRESSIONS) &&
      hasPosition && position <= Number(rules.EARLY_ABSOLUTE_CAPTURE_STRONG_POSITION) &&
      clicks >= Number(rules.EARLY_ABSOLUTE_CAPTURE_STRONG_MIN_CLICKS)
    ) || (
      externalDemandConfirmed &&
      impressions >= Number(rules.EARLY_EXTERNAL_CAPTURE_MIN_IMPRESSIONS) &&
      hasPosition && position <= Number(rules.EARLY_EXTERNAL_CAPTURE_MAX_POSITION)
    );
    probe = (
      impressions >= Number(rules.EARLY_ABSOLUTE_PROBE_MIN_IMPRESSIONS) &&
      hasPosition && position <= Number(rules.EARLY_ABSOLUTE_PROBE_MAX_POSITION)
    ) || (
      clicks >= Number(rules.EARLY_ABSOLUTE_PROBE_MIN_CLICKS) &&
      hasPosition && position <= 30
    );
    if (capture) reason = 'specific absolute signal';
    else if (probe) reason = 'specific absolute signal';
  } else if (generic) {
    capture = impressions >= Number(rules.EARLY_GENERIC_CAPTURE_MIN_IMPRESSIONS) &&
      clicks >= Number(rules.EARLY_GENERIC_CAPTURE_MIN_CLICKS);
    probe = (
      impressions >= Number(rules.EARLY_ABSOLUTE_PROBE_MIN_IMPRESSIONS) &&
      hasPosition && position <= Number(rules.EARLY_ABSOLUTE_PROBE_MAX_POSITION)
    ) || (
      clicks >= Number(rules.EARLY_ABSOLUTE_PROBE_MIN_CLICKS) &&
      hasPosition && position <= 30
    );
    if (capture) reason = 'generic absolute signal';
    else if (probe) reason = 'generic absolute signal';
  } else if (brand) {
    return { stage: 'WAIT', signal: '', reason: 'brand absolute signal ignored' };
  }

  if (capture) {
    return {
      stage: 'CAPTURE',
      signal: EARLY_FOLLOWUP_SIGNALS.ABSOLUTE_CAPTURE,
      reason: 'ABSOLUTE_CAPTURE；impressions=' + impressions + '；clicks=' + clicks +
        '；position=' + position + '；' + reason
    };
  }
  if (probe) {
    return {
      stage: 'PROBE',
      signal: EARLY_FOLLOWUP_SIGNALS.ABSOLUTE_PROBE,
      reason: 'ABSOLUTE_PROBE；impressions=' + impressions + '；clicks=' + clicks +
        '；position=' + position + '；' + reason
    };
  }
  return { stage: 'WAIT', signal: '', reason: '' };
}

function determineEarlyOpportunityStage_(absoluteStage, previousStage, growing, impressions, rules) {
  if (previousStage === 'CAPTURE' && growing &&
      Number(impressions || 0) >= Number(rules.EARLY_SCALE_MIN_IMPRESSIONS)) {
    return 'SCALE';
  }
  if (absoluteStage === 'CAPTURE') return 'CAPTURE';
  if (growing) return 'CAPTURE';
  if (absoluteStage === 'PROBE') return 'PROBE';
  return 'WAIT';
}

function earlyFollowupExternalDemandConfirmed_(site, current, opts) {
  if (current.externalDemandConfirmed) return true;
  opts = opts || {};
  var key = earlyFollowupStateKey_(site && site.name, current.key);
  if (opts.externalDemandByKey && opts.externalDemandByKey[key] === true) return true;
  if (typeof getSpreadsheet_ !== 'function' || typeof SHEET_NAMES === 'undefined') return false;
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.OPPORTUNITIES);
  if (!sheet || sheet.getLastRow() < 2) return false;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = {};
  for (var h = 0; h < header.length; h++) col[String(header[h] || '').trim()] = h;
  if (col.ExternalEvidence === undefined) return false;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][col.Game] || rows[i][col.Site] || '').trim() !== String(site.name || '').trim()) continue;
    var evidence = safeJsonParse_(rows[i][col.ExternalEvidence], {});
    if (String(evidence.clusterKey || '').trim() !== String(current.key || '').trim()) continue;
    if (evidence.ExternalDemandConfirmed === true || evidence.externalDemandConfirmed === true) return true;
  }
  return false;
}

function earlyFollowupRoutingDecision_(stage, hasExistingPage) {
  if (stage === 'PROBE') return 'RESEARCH_PROBE';
  if (stage === 'SCALE') return 'RESEARCH_EXPANSION';
  if (stage === 'CAPTURE') return hasExistingPage ? 'RESEARCH_EXISTING_PAGE' : 'RESEARCH_NEW_PAGE';
  return 'WAIT';
}

function classifyEarlyFollowupConfidence_(current, signals, observations, expectedPage, evidence) {
  if (!signals.length) return observations > 1 ? 'LOW' : 'LOW';
  if (
    observations >= 2 && current.impressions >= 10 &&
    (current.clicks >= 1 || (expectedPage && evidence && evidence.valid))
  ) return 'HIGH';
  if (current.impressions >= 5 || current.clicks >= 1) return 'MEDIUM';
  return 'LOW';
}

function buildEarlyFollowupReason_(current, previous, signals, expectedPage, observations, mismatchRuns, absolute) {
  var reason = signals.length ? signals.join('|') : 'BASELINE';
  reason += '；observations=' + observations;
  if (absolute && absolute.reason) reason += '；' + absolute.reason;
  if (previous) {
    reason += '；impressions=' + previous.currentImpressions + '→' + current.impressions;
    reason += '；clicks=' + previous.currentClicks + '→' + current.clicks;
    reason += '；position=' + previous.currentPosition + '→' + current.position;
    reason += '；page=' + (previous.currentTopPage || '/') + '→' + (current.topPage || '/');
  } else {
    reason += '；growth baseline established';
  }
  if (expectedPage) reason += '；ExpectedPage=' + expectedPage;
  if (mismatchRuns) reason += '；mismatchConfirmRuns=' + mismatchRuns;
  return reason;
}

function earlyFollowupShouldEmitEvent_(previous, signalText, signals, now, rules) {
  if (!signalText) return false;
  var previousSignalText = String((previous && previous.followupSignals) || '');
  var previousEventMs = earlyFollowupDateMs_(previous && previous.signalEventAt);
  var nowMs = earlyFollowupDateMs_(now);
  var cooldownMs = Number(rules.EARLY_FOLLOWUP_SIGNAL_COOLDOWN_HOURS || 0) * 60 * 60 * 1000;
  if (!previousSignalText) {
    return !previousEventMs || !nowMs || nowMs - previousEventMs >= cooldownMs;
  }
  if (signalText === previousSignalText) return false;
  var previousSignals = {};
  previousSignalText.split('|').forEach(function (signal) { previousSignals[signal] = true; });
  var addedSignal = false;
  for (var i = 0; i < signals.length; i++) {
    if (!previousSignals[signals[i]]) {
      addedSignal = true;
      break;
    }
  }
  if (addedSignal) return true;
  return !previousEventMs || !nowMs || nowMs - previousEventMs >= cooldownMs;
}

function earlyFollowupDateMs_(value) {
  if (!value) return 0;
  var date = value instanceof Date ? value : new Date(value);
  var ms = date.getTime();
  return isNaN(ms) ? 0 : ms;
}

function earlyFollowupEligibleSites_(earlyRecords, states) {
  var out = {};
  if (earlyRecords && earlyRecords.length) {
    for (var i = 0; i < earlyRecords.length; i++) {
      var record = earlyRecords[i] || {};
      if (String(record.status || '').trim() === 'EARLY_WINNER' && record.site) out[record.site] = record;
    }
    return out;
  }
  var keys = Object.keys(states || {});
  for (var k = 0; k < keys.length; k++) {
    var state = states[keys[k]];
    if (state && state.site && state.earlySignalStatus === 'EARLY_WINNER') out[state.site] = state;
  }
  if (typeof loadExistingEarlySignalStates_ === 'function') {
    var earlyStates = loadExistingEarlySignalStates_();
    var sites = Object.keys(earlyStates || {});
    for (var s = 0; s < sites.length; s++) {
      if (earlyStates[sites[s]].status === 'EARLY_WINNER') out[sites[s]] = earlyStates[sites[s]];
    }
  }
  return out;
}

function earlyFollowupBaselineSites_(states) {
  var out = {};
  var keys = Object.keys(states || {});
  for (var i = 0; i < keys.length; i++) {
    var site = states[keys[i]].site;
    if (site) out[site] = true;
  }
  return out;
}

function earlyFollowupDay_(site, early, now) {
  if (early && early.day !== undefined && early.day !== '') return Number(early.day);
  if (site && site.day !== undefined && site.day !== '') return Number(site.day);
  if (typeof calcDayNumber_ === 'function' && site && site.day0) {
    return Number(calcDayNumber_(site.day0, typeof toDateStr_ === 'function' ? toDateStr_(now) : now));
  }
  return '';
}

function resolveEarlyFollowupExpectedPage_(site, cluster, opts) {
  opts = opts || {};
  var siteName = String((site && site.name) || '');
  var key = earlyFollowupStateKey_(siteName, cluster.key);
  if (opts.expectedPages && opts.expectedPages[key]) return earlyFollowupNormalizePath_(opts.expectedPages[key]);
  if (typeof opts.expectedPageResolver === 'function') {
    var resolved = opts.expectedPageResolver(site, cluster);
    if (resolved && typeof resolved === 'object') resolved = resolved.path || resolved.page || '';
    return earlyFollowupNormalizePath_(resolved);
  }
  return earlyFollowupExplicitPageIndex_()[key] || '';
}

/** Only explicit existing mapping rows are accepted; query text never invents a URL. */
function earlyFollowupExplicitPageIndex_() {
  var out = {};
  if (typeof getSpreadsheet_ !== 'function' || typeof SHEET_NAMES === 'undefined') return out;
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.PAGE_OPPORTUNITIES);
  if (!sheet || sheet.getLastRow() < 2) return out;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var siteIdx = earlyFollowupFindHeader_(header, ['Site', '站点', 'Game']);
  var keyIdx = earlyFollowupFindHeader_(header, ['ClusterKey', 'cluster_key', '意图Key']);
  var pageIdx = earlyFollowupFindHeader_(header, ['ExpectedPage', 'TargetPage', 'PageURL', '页面URL', 'PagePath', '页面路径']);
  if (siteIdx < 0 || pageIdx < 0) return out;
  for (var i = 0; i < rows.length; i++) {
    var site = String(rows[i][siteIdx] || '').trim();
    var page = earlyFollowupNormalizePath_(rows[i][pageIdx]);
    if (!site || !page || page === '/') continue;
    if (keyIdx >= 0 && String(rows[i][keyIdx] || '').trim()) {
      out[earlyFollowupStateKey_(site, rows[i][keyIdx])] = page;
    }
  }
  return out;
}

function resolveEarlyFollowupPageEvidence_(site, expectedPage, opts) {
  opts = opts || {};
  if (typeof opts.pageEvidenceResolver === 'function') {
    return opts.pageEvidenceResolver(site, expectedPage) || { valid: false };
  }
  if (opts.pageEvidenceByKey) {
    return opts.pageEvidenceByKey[earlyFollowupStateKey_(site.name, expectedPage)] || { valid: false };
  }
  if (typeof getSpreadsheet_ !== 'function') return { valid: false };
  var siteName = String((site && site.name) || '');
  var path = earlyFollowupNormalizePath_(expectedPage);
  var evidence = { exists: false, valid: false };
  var indexSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.URL_INDEX);
  if (indexSheet && indexSheet.getLastRow() >= 2) {
    var indexRows = indexSheet.getRange(2, 1, indexSheet.getLastRow() - 1, URL_INDEX_HEADERS.length).getValues();
    for (var i = 0; i < indexRows.length; i++) {
      if (String(indexRows[i][1] || '').trim() !== siteName) continue;
      if (earlyFollowupNormalizePath_(indexRows[i][2]) !== path) continue;
      evidence.exists = true;
      if (String(indexRows[i][3] || '').trim() === 'PASS') evidence.valid = true;
    }
  }
  var pageSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.PAGES);
  if (pageSheet && pageSheet.getLastRow() >= 2) {
    var pageRows = pageSheet.getRange(2, 1, pageSheet.getLastRow() - 1, PAGE_HEADERS.length).getValues();
    for (var p = 0; p < pageRows.length; p++) {
      if (String(pageRows[p][1] || '').trim() !== siteName) continue;
      if (earlyFollowupNormalizePath_(pageRows[p][3] || pageRows[p][2]) !== path) continue;
      evidence.exists = true;
      if (Number(pageRows[p][4] || 0) > 0 || Number(pageRows[p][5] || 0) > 0) evidence.valid = true;
    }
  }
  return evidence;
}

function ensureEarlyFollowupProductionSchema_() {
  if (typeof ensureSheet_ !== 'function') return;
  ensureSheet_(SHEET_NAMES.INTENT_OPPORTUNITIES, INTENT_OPPORTUNITY_HEADERS);
  ensureIntentOpportunityHeader_();
  ensureSheet_(SHEET_NAMES.EARLY_FOLLOWUP_STATE, EARLY_FOLLOWUP_STATE_HEADERS);
  var stateSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.EARLY_FOLLOWUP_STATE);
  if (stateSheet && !stateSheet.isSheetHidden()) stateSheet.hideSheet();
  if (typeof seedMissingDecisionRules_ === 'function') seedMissingDecisionRules_();
}

function loadEarlyFollowupStates_() {
  var out = {};
  if (typeof getSpreadsheet_ !== 'function') return out;
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.EARLY_FOLLOWUP_STATE);
  if (!sheet || sheet.getLastRow() < 2) return out;
  var lastCol = Math.max(sheet.getLastColumn(), EARLY_FOLLOWUP_STATE_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = earlyFollowupHeaderMap_(header);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  for (var i = 0; i < rows.length; i++) {
    var site = String(rows[i][col.Site] || '').trim();
    var key = String(rows[i][col.ClusterKey] || '').trim();
    if (!site || !key) continue;
    var state = {
      site: site,
      clusterKey: key,
      clusterLabel: String(rows[i][col.ClusterLabel] || ''),
      previousImpressions: rows[i][col.PreviousImpressions],
      currentImpressions: rows[i][col.CurrentImpressions],
      previousClicks: rows[i][col.PreviousClicks],
      currentClicks: rows[i][col.CurrentClicks],
      previousPosition: rows[i][col.PreviousPosition],
      currentPosition: rows[i][col.CurrentPosition],
      previousTopPage: rows[i][col.PreviousTopPage],
      currentTopPage: rows[i][col.CurrentTopPage],
      previousTopPageShare: rows[i][col.PreviousTopPageShare],
      currentTopPageShare: rows[i][col.CurrentTopPageShare],
      firstSeenAt: rows[i][col.FirstSeenAt],
      lastObservedAt: rows[i][col.LastObservedAt],
      expectedPage: rows[i][col.ExpectedPage],
      followupSignals: String(rows[i][col.FollowupSignals] || ''),
      followupConfidence: String(rows[i][col.FollowupConfidence] || ''),
      followupReason: String(rows[i][col.FollowupReason] || ''),
      observationCount: Number(rows[i][col.ObservationCount] || 0),
      mismatchConfirmRuns: Number(rows[i][col.MismatchConfirmRuns] || 0),
      signalEventAt: rows[i][col.SignalEventAt],
      intentType: String(rows[i][col.IntentType] || ''),
      intentFamily: String(rows[i][col.IntentFamily] || ''),
      opportunityStage: String(rows[i][col.OpportunityStage] || ''),
      absoluteSignal: String(rows[i][col.AbsoluteSignal] || ''),
      absoluteSignalReason: String(rows[i][col.AbsoluteSignalReason] || '')
    };
    out[earlyFollowupStateKey_(site, key)] = state;
  }
  return out;
}

function persistEarlyFollowupStates_(states) {
  if (typeof getSpreadsheet_ !== 'function') return;
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.EARLY_FOLLOWUP_STATE);
  if (!sheet) return;
  var keys = Object.keys(states || {});
  var rows = [];
  for (var i = 0; i < keys.length; i++) {
    var s = states[keys[i]];
    rows.push([
      s.site, s.clusterKey, s.clusterLabel,
      s.previousImpressions, s.currentImpressions,
      s.previousClicks, s.currentClicks,
      s.previousPosition, s.currentPosition,
      s.previousTopPage, s.currentTopPage,
      s.previousTopPageShare, s.currentTopPageShare,
      s.firstSeenAt, s.lastObservedAt, s.expectedPage,
      s.followupSignals, s.followupConfidence, s.followupReason,
      s.observationCount, s.mismatchConfirmRuns, s.signalEventAt,
      s.intentType, s.intentFamily, s.opportunityStage, s.absoluteSignal,
      s.absoluteSignalReason
    ]);
  }
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, EARLY_FOLLOWUP_STATE_HEADERS.length).clearContent();
  if (!rows.length) return;
  ensureSheetGrid_(sheet, rows.length + 1, EARLY_FOLLOWUP_STATE_HEADERS.length);
  sheet.getRange(2, 1, rows.length, EARLY_FOLLOWUP_STATE_HEADERS.length).setValues(rows);
}

function writeEarlyFollowupIntentRows_(records) {
  if (typeof getSpreadsheet_ !== 'function' || !records || !records.length) return;
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.INTENT_OPPORTUNITIES);
  if (!sheet || sheet.getLastRow() < 2) return;
  var lastCol = Math.max(sheet.getLastColumn(), INTENT_OPPORTUNITY_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = earlyFollowupHeaderMap_(header);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var byKey = {};
  for (var r = 0; r < rows.length; r++) {
    byKey[earlyFollowupStateKey_(rows[r][col.Site], rows[r][col.ClusterKey])] = r;
  }
  for (var i = 0; i < records.length; i++) {
    var record = records[i];
    var rowIndex = byKey[earlyFollowupStateKey_(record.site, record.clusterKey)];
    if (rowIndex === undefined) continue;
    var row = rows[rowIndex];
    row[col.PreviousClusterImpressions] = record.previousImpressions;
    row[col.CurrentClusterImpressions] = record.currentImpressions;
    row[col.FollowupGrowthRate] = record.growthRate;
    row[col.PreviousClusterClicks] = record.previousClicks;
    row[col.CurrentClusterClicks] = record.currentClicks;
    row[col.PreviousClusterPosition] = record.previousPosition;
    row[col.CurrentClusterPosition] = record.currentPosition;
    row[col.PreviousTopPage] = record.previousTopPage;
    row[col.ExpectedPage] = record.expectedPage;
    row[col.CurrentTopPage] = record.currentTopPage;
    row[col.PreviousTopPageShare] = record.previousTopPageShare;
    row[col.CurrentTopPageShare] = record.currentTopPageShare;
    row[col.FollowupSignals] = record.signals.join('|');
    row[col.FollowupConfidence] = record.confidence;
    row[col.FollowupReason] = record.reason;
    row[col.FollowupFirstSeenAt] = record.firstSeenAt;
    row[col.FollowupLastObservedAt] = record.lastObservedAt;
    row[col.IntentType] = record.intentType;
    row[col.IntentFamily] = record.intentFamily;
    row[col.OpportunityStage] = record.opportunityStage;
    row[col.AbsoluteSignal] = record.absoluteSignal;
    row[col.AbsoluteSignalReason] = record.absoluteSignalReason;
    row[col.RoutingDecision] = record.routingDecision;
    if (col.AdjacentCaptureCandidates !== undefined) {
      row[col.AdjacentCaptureCandidates] = JSON.stringify(record.adjacentCaptureCandidates || []);
    }
    if (col.AdjacentCaptureReason !== undefined) {
      row[col.AdjacentCaptureReason] = record.adjacentCaptureReason || '';
    }
  }
  ensureSheetGrid_(sheet, rows.length + 1, lastCol);
  sheet.getRange(2, 1, rows.length, lastCol).setValues(rows);
}

function earlyFollowupHeaderMap_(header) {
  var map = {};
  for (var i = 0; i < header.length; i++) {
    var name = String(header[i] || '').trim();
    if (name) map[name] = i;
  }
  return {
    Site: map.Site,
    ClusterKey: map.ClusterKey,
    ClusterLabel: map.ClusterLabel,
    PreviousImpressions: map.PreviousImpressions,
    CurrentImpressions: map.CurrentImpressions,
    PreviousClicks: map.PreviousClicks,
    CurrentClicks: map.CurrentClicks,
    PreviousPosition: map.PreviousPosition,
    CurrentPosition: map.CurrentPosition,
    PreviousTopPage: map.PreviousTopPage,
    CurrentTopPage: map.CurrentTopPage,
    PreviousTopPageShare: map.PreviousTopPageShare,
    CurrentTopPageShare: map.CurrentTopPageShare,
    FirstSeenAt: map.FirstSeenAt,
    LastObservedAt: map.LastObservedAt,
    ExpectedPage: map.ExpectedPage,
    FollowupSignals: map.FollowupSignals,
    FollowupConfidence: map.FollowupConfidence,
    FollowupReason: map.FollowupReason,
    ObservationCount: map.ObservationCount,
    MismatchConfirmRuns: map.MismatchConfirmRuns,
    SignalEventAt: map.SignalEventAt,
    IntentType: map.IntentType,
    IntentFamily: map.IntentFamily,
    OpportunityStage: map.OpportunityStage,
    AbsoluteSignal: map.AbsoluteSignal,
    AbsoluteSignalReason: map.AbsoluteSignalReason,
    PreviousClusterImpressions: map.PreviousClusterImpressions,
    CurrentClusterImpressions: map.CurrentClusterImpressions,
    FollowupGrowthRate: map.FollowupGrowthRate,
    PreviousClusterClicks: map.PreviousClusterClicks,
    CurrentClusterClicks: map.CurrentClusterClicks,
    PreviousClusterPosition: map.PreviousClusterPosition,
    CurrentClusterPosition: map.CurrentClusterPosition,
    FollowupFirstSeenAt: map.FollowupFirstSeenAt,
    FollowupLastObservedAt: map.FollowupLastObservedAt,
    RoutingDecision: map.RoutingDecision,
    AdjacentCaptureCandidates: map.AdjacentCaptureCandidates,
    AdjacentCaptureReason: map.AdjacentCaptureReason
  };
}

function earlyFollowupFindHeader_(header, names) {
  for (var i = 0; i < names.length; i++) {
    var idx = header.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

function earlyFollowupStateKey_(site, clusterKey) {
  return String(site || '').trim() + '||' + String(clusterKey || '').trim();
}

function cloneEarlyFollowupStates_(states) {
  var out = {};
  var keys = Object.keys(states || {});
  for (var i = 0; i < keys.length; i++) {
    var source = states[keys[i]] || {};
    var copy = {};
    var fields = Object.keys(source);
    for (var f = 0; f < fields.length; f++) copy[fields[f]] = source[fields[f]];
    out[keys[i]] = copy;
  }
  return out;
}

function earlyFollowupNumber_(value) {
  var n = Number(value || 0);
  return isNaN(n) ? 0 : n;
}

function earlyFollowupNormalizePath_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) raw = raw.replace(/^https?:\/\/[^/]+/i, '') || '/';
  raw = raw.split('?')[0].split('#')[0];
  if (raw.charAt(0) !== '/') raw = '/' + raw;
  if (raw.length > 1 && raw.charAt(raw.length - 1) === '/') raw = raw.substring(0, raw.length - 1);
  return raw || '/';
}
