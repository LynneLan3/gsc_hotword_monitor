/**
 * D0-D3 realtime Site signal layer.
 *
 * Input: the realtime IntentOpportunityEngine snapshot produced by
 * runFreshQueryMonitor. Output: one additive early signal state per Site,
 * persisted in the existing 站点状态 sheet. This layer does not write 今日行动,
 * create research jobs, or alter the formal Decision Engine action.
 */

var EARLY_SIGNAL_STATUSES = {
  EARLY_WINNER: 'EARLY_WINNER',
  WATCH: 'WATCH',
  NO_SIGNAL: 'NO_SIGNAL'
};

var EARLY_SIGNAL_RANKS = {
  EARLY_WINNER: 0,
  WATCH: 1,
  NO_SIGNAL: 2
};

var EARLY_SIGNAL_CONFIDENCES = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
};

/** Run after FreshQueryMonitor has written Intent机会. */
function runEarlySiteSignalEngine(opts) {
  opts = opts || {};
  ensureEarlySiteSignalProductionSchema_();
  var snapshots = (opts.snapshots || []).slice();
  if (opts.fromLiveSheet !== false) {
    snapshots = mergeEarlySignalSnapshots_(snapshots, loadEarlySignalSnapshotsFromSheets_());
  }
  if (!snapshots.length) {
    return { records: [], skipped: 'no realtime Intent snapshots' };
  }

  var rules = opts.rules || getDecisionRules_();
  var now = opts.now || new Date();
  var previousBySite = loadExistingEarlySignalStates_();
  var records = [];

  for (var i = 0; i < snapshots.length; i++) {
    var snapshot = snapshots[i] || {};
    var site = snapshot.site || {};
    var siteName = String(site.name || '').trim();
    if (!siteName) continue;

    var previous = previousBySite[siteName] || null;
    var aggregate = buildEarlySiteSignalAggregate_(snapshot, site);
    aggregate.day = resolveEarlySignalDay_(site, previous, now);
    if (aggregate.day === '' || aggregate.day === null || aggregate.day === undefined) {
      writeLog_('WARN', siteName, 'Early Site Signal 跳过：Day0/Day 不可确定');
      continue;
    }
    if (Number(aggregate.day) > Number(rules.EARLY_SIGNAL_MAX_DAY)) {
      continue;
    }

    var candidate = classifyEarlySiteSignal_(aggregate, rules);
    var confidence = classifyEarlySignalConfidence_(aggregate, candidate.status);
    var resolved = resolveEarlySignalState_(
      previous && previous.status,
      candidate.status,
      previous && previous.downgradeRuns,
      rules.EARLY_DOWNGRADE_CONFIRM_RUNS
    );
    var updatedAt = new Date(now.getTime ? now.getTime() : Date.now());
    var reason = buildEarlySignalReason_(aggregate, candidate, resolved, confidence);

    records.push({
      site: siteName,
      day: aggregate.day,
      status: resolved.status,
      confidence: confidence,
      metrics: aggregate,
      updatedAt: updatedAt,
      reason: reason,
      downgradeRuns: resolved.downgradeRuns,
      previous: previous || null,
      transition: !!(previous && previous.status && previous.status !== resolved.status),
      upgrade: !!(
        previous &&
        previous.status &&
        earlySignalRank_(resolved.status) < earlySignalRank_(previous.status)
      ),
      cooldownHours: Number(rules.EARLY_SIGNAL_COOLDOWN_HOURS) || 0
    });
  }

  updateEarlySiteSignalStatusRows_(records);
  return { records: records };
}

/**
 * The production trigger may have old live rows while the current GSC pull is
 * incomplete. Read the existing realtime snapshot so Goal 1 can still run.
 * Intent机会 is the authoritative aggregate fallback; realtime rows override
 * the per-query values when that row is available.
 */
function loadEarlySignalSnapshotsFromSheets_() {
  if (
    typeof getSpreadsheet_ !== 'function' ||
    typeof getEnabledSites !== 'function' ||
    typeof getSheetDataRange_ !== 'function'
  ) {
    return [];
  }
  var sites = getEnabledSites();
  var siteByName = {};
  for (var s = 0; s < sites.length; s++) siteByName[sites[s].name] = sites[s];

  var freshRows = loadEarlySignalSheetRows_(
    SHEET_NAMES.FRESH_QUERY_MONITOR,
    FRESH_QUERY_MONITOR_HEADERS.length
  );
  var rawBySiteQuery = {};
  for (var f = 0; f < freshRows.length; f++) {
    var fresh = freshRows[f];
    var freshSite = String(fresh[1] || '').trim();
    var freshQuery = String(fresh[2] || '').trim();
    if (!freshSite || !freshQuery) continue;
    if (!rawBySiteQuery[freshSite]) rawBySiteQuery[freshSite] = {};
    rawBySiteQuery[freshSite][freshQuery.toLowerCase()] = {
      query: freshQuery,
      page: String(fresh[3] || '').trim(),
      clicks: earlyMetricNumber_(fresh[4]),
      impressions: earlyMetricNumber_(fresh[5]),
      position: earlyMetricNumber_(fresh[7]),
      incomplete: earlySignalBoolean_(fresh[15]),
      cutoff: String(fresh[16] || '')
    };
  }

  var intentRows = loadEarlySignalSheetRows_(
    SHEET_NAMES.INTENT_OPPORTUNITIES,
    INTENT_OPPORTUNITY_HEADERS.length
  );
  var grouped = {};
  for (var i = 0; i < intentRows.length; i++) {
    var row = intentRows[i];
    var siteName = String(row[0] || '').trim();
    if (!siteName || !siteByName[siteName]) continue;
    if (!grouped[siteName]) grouped[siteName] = [];
    grouped[siteName].push(row);
  }

  var snapshots = [];
  var groupedSites = Object.keys(grouped);
  for (var g = 0; g < groupedSites.length; g++) {
    var groupedSiteName = groupedSites[g];
    var intentSiteRows = grouped[groupedSiteName];
    var clusters = [];
    var dataCutoff = '';
    var dataIncomplete = false;
    var rawQueries = rawBySiteQuery[groupedSiteName] || {};

    for (var r = 0; r < intentSiteRows.length; r++) {
      var intentRow = intentSiteRows[r];
      var clusterImpressions = earlyMetricNumber_(intentRow[6]);
      var clusterClicks = earlyMetricNumber_(intentRow[5]);
      var clusterPosition = earlyMetricNumber_(intentRow[8]);
      var queryTexts = String(intentRow[3] || '').split(/\s*\|\s*/).filter(function (q) {
        return !!String(q || '').trim();
      });
      var queryItems = [];
      for (var q = 0; q < queryTexts.length; q++) {
        var queryText = String(queryTexts[q] || '').trim();
        var raw = rawQueries[queryText.toLowerCase()];
        if (raw) {
          queryItems.push({
            query: raw.query,
            clicks: raw.clicks,
            impressions: raw.impressions,
            position: raw.position
          });
          if (raw.cutoff) dataCutoff = raw.cutoff;
          dataIncomplete = dataIncomplete || raw.incomplete;
        } else if (queryTexts.length === 1) {
          // A one-query Intent row already contains the exact aggregate facts.
          queryItems.push({
            query: queryText,
            clicks: clusterClicks,
            impressions: clusterImpressions,
            position: clusterPosition
          });
        } else {
          // Keep the query identity for counting, but do not invent per-query
          // clicks or impressions when only a multi-query aggregate exists.
          queryItems.push({ query: queryText, clicks: 0, impressions: 0, position: 0 });
        }
      }
      clusters.push({
        key: String(intentRow[1] || ''),
        label: String(intentRow[2] || ''),
        queryCount: Number(intentRow[4] || queryItems.length),
        queries: queryItems,
        clicks: clusterClicks,
        impressions: clusterImpressions,
        position: clusterPosition
      });
      if (intentRow[31]) dataCutoff = String(intentRow[31]);
      dataIncomplete = dataIncomplete || earlySignalBoolean_(intentRow[32]);
    }
    snapshots.push({
      site: siteByName[groupedSiteName],
      clusters: clusters,
      cutoffHour: dataCutoff,
      incomplete: dataIncomplete
    });
  }
  return snapshots;
}

function loadEarlySignalSheetRows_(sheetName, columnCount) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var range = getSheetDataRange_(sheet, columnCount);
  return range ? range.getValues() : [];
}

function mergeEarlySignalSnapshots_(freshSnapshots, sheetSnapshots) {
  var bySite = {};
  var i;
  for (i = 0; i < (sheetSnapshots || []).length; i++) {
    var sheetSnapshot = sheetSnapshots[i];
    var sheetName = sheetSnapshot.site && sheetSnapshot.site.name;
    if (sheetName) bySite[sheetName] = sheetSnapshot;
  }
  for (i = 0; i < (freshSnapshots || []).length; i++) {
    var freshSnapshot = freshSnapshots[i];
    var freshName = freshSnapshot.site && freshSnapshot.site.name;
    if (freshName) bySite[freshName] = freshSnapshot;
  }
  var out = [];
  var names = Object.keys(bySite);
  for (var n = 0; n < names.length; n++) out.push(bySite[names[n]]);
  return out;
}

function ensureEarlySiteSignalProductionSchema_() {
  if (typeof ensureSheet_ !== 'function') return;
  ensureSheet_(SHEET_NAMES.RULES, RULE_HEADERS);
  if (typeof seedMissingDecisionRules_ === 'function') seedMissingDecisionRules_();
  if (typeof ensureSiteStatusHeader_ === 'function') {
    ensureSheet_(SHEET_NAMES.SITE_STATUS, SITE_STATUS_HEADERS);
    ensureSiteStatusHeader_();
  }
}

function earlySignalBoolean_(value) {
  var text = String(value || '').trim().toLowerCase();
  return value === true || text === 'true' || text === '是' || text === 'yes';
}

/** Aggregate the already-classified Intent snapshot; no query.includes classifier. */
function buildEarlySiteSignalAggregate_(snapshot, site) {
  var clusters = (snapshot && snapshot.clusters) || [];
  var queriesByKey = {};
  var impressions = 0;
  var clicks = 0;
  var positionWeight = 0;
  var intentClusters = 0;

  for (var i = 0; i < clusters.length; i++) {
    var cluster = clusters[i] || {};
    var clusterImpressions = earlyMetricNumber_(cluster.impressions);
    var clusterClicks = earlyMetricNumber_(cluster.clicks);
    impressions += clusterImpressions;
    clicks += clusterClicks;
    positionWeight += earlyMetricNumber_(cluster.position) * clusterImpressions;
    if (
      (cluster.queryCount || (cluster.queries && cluster.queries.length)) &&
      (clusterImpressions > 0 || clusterClicks > 0)
    ) {
      intentClusters++;
    }

    var queries = cluster.queries || [];
    for (var q = 0; q < queries.length; q++) {
      var item = queries[q] || {};
      var query = String(item.query || '').trim();
      if (!query) continue;
      var key = query.toLowerCase();
      if (!queriesByKey[key]) {
        queriesByKey[key] = {
          query: query,
          clicks: 0,
          impressions: 0,
          positionWeight: 0
        };
      }
      var target = queriesByKey[key];
      var itemImpressions = earlyMetricNumber_(item.impressions);
      var itemClicks = earlyMetricNumber_(item.clicks);
      var itemPosition = earlyMetricNumber_(item.position);
      if (itemPosition <= 0 && itemImpressions > 0) {
        itemPosition = earlyMetricNumber_(item.positionWeight) / itemImpressions;
      }
      target.clicks += itemClicks;
      target.impressions += itemImpressions;
      target.positionWeight += itemPosition * itemImpressions;
    }
  }

  var queryKeys = Object.keys(queriesByKey);
  var guideQueries = 0;
  var clickedQueries = 0;
  var top10Queries = 0;
  var top20Queries = 0;
  for (var n = 0; n < queryKeys.length; n++) {
    var queryItem = queriesByKey[queryKeys[n]];
    var position = queryItem.impressions > 0
      ? queryItem.positionWeight / queryItem.impressions
      : 0;
    if (earlySignalIsGuideQuery_(queryItem.query, site)) guideQueries++;
    if (queryItem.clicks > 0) clickedQueries++;
    if (position > 0 && position <= 10) top10Queries++;
    if (position > 0 && position <= 20) top20Queries++;
  }

  return {
    site: String((site && site.name) || ''),
    day: '',
    clicks24h: clicks,
    impressions24h: impressions,
    ctr24h: impressions > 0 ? clicks / impressions : 0,
    averagePosition24h: impressions > 0 ? positionWeight / impressions : 0,
    queryCount24h: queryKeys.length,
    guideQueryCount24h: guideQueries,
    clickedQueryCount: clickedQueries,
    top10QueryCount: top10Queries,
    top20QueryCount: top20Queries,
    intentClusterCount: intentClusters,
    dataCutoff: String((snapshot && snapshot.cutoffHour) || ''),
    dataIncomplete: !!(snapshot && snapshot.incomplete)
  };
}

function earlySignalIsGuideQuery_(query, site) {
  if (typeof matchGuideIntentCategories_ !== 'function') return false;
  return matchGuideIntentCategories_(query, site).length > 0;
}

function classifyEarlySiteSignal_(metrics, rules) {
  var winnerRules = [];
  if (
    metrics.impressions24h >= Number(rules.EARLY_WINNER_MIN_24H_IMPRESSIONS) &&
    metrics.clicks24h >= Number(rules.EARLY_WINNER_MIN_CLICKS) &&
    metrics.guideQueryCount24h >= Number(rules.EARLY_WINNER_MIN_GUIDE_QUERIES)
  ) {
    winnerRules.push('A');
  }
  if (
    metrics.clicks24h >= Math.max(2, Number(rules.EARLY_WINNER_MIN_CLICKS) + 1) &&
    metrics.top20QueryCount >= Number(rules.EARLY_TOP20_MIN_QUERIES) &&
    metrics.guideQueryCount24h >= Number(rules.EARLY_WINNER_MIN_GUIDE_QUERIES)
  ) {
    winnerRules.push('B');
  }
  if (
    metrics.top10QueryCount >= Number(rules.EARLY_TOP10_MIN_QUERIES) &&
    metrics.intentClusterCount >= Number(rules.EARLY_MIN_INTENT_CLUSTERS)
  ) {
    winnerRules.push('C');
  }
  if (winnerRules.length) {
    return {
      status: EARLY_SIGNAL_STATUSES.EARLY_WINNER,
      rule: 'Rule ' + winnerRules.join('+')
    };
  }

  var watchRules = [];
  if (metrics.impressions24h >= Number(rules.EARLY_WATCH_MIN_IMPRESSIONS)) {
    watchRules.push('impressions');
  }
  if (metrics.guideQueryCount24h >= 1) watchRules.push('guide queries');
  if (metrics.top20QueryCount >= 1) watchRules.push('Top20');
  if (metrics.clicks24h >= 1) watchRules.push('clicks');
  if (watchRules.length) {
    return {
      status: EARLY_SIGNAL_STATUSES.WATCH,
      rule: 'WATCH: ' + watchRules.join(', ')
    };
  }
  return { status: EARLY_SIGNAL_STATUSES.NO_SIGNAL, rule: 'No early threshold matched' };
}

function classifyEarlySignalConfidence_(metrics, status) {
  var broad = metrics.queryCount24h >= 2 && metrics.intentClusterCount >= 2;
  var strong = metrics.impressions24h >= 100 || metrics.clicks24h >= 2 || metrics.top10QueryCount >= 2;
  if (broad && metrics.clicks24h >= 1 && (!metrics.dataIncomplete || strong)) {
    return EARLY_SIGNAL_CONFIDENCES.HIGH;
  }
  if (metrics.dataIncomplete && (broad || metrics.clickedQueryCount >= 1 || strong)) {
    return EARLY_SIGNAL_CONFIDENCES.MEDIUM;
  }
  if (status === EARLY_SIGNAL_STATUSES.EARLY_WINNER && broad && metrics.clicks24h >= 1) {
    return EARLY_SIGNAL_CONFIDENCES.HIGH;
  }
  return EARLY_SIGNAL_CONFIDENCES.LOW;
}

/** Apply immediate upgrades and require consecutive runs for every downgrade. */
function resolveEarlySignalState_(previousStatus, candidateStatus, previousRuns, confirmRuns) {
  var previous = String(previousStatus || '').trim();
  var candidate = String(candidateStatus || '').trim();
  var previousRank = earlySignalRank_(previous);
  var candidateRank = earlySignalRank_(candidate);
  var runs = Number(previousRuns || 0);
  if (!previous || previousRank === null) {
    return { status: candidate, downgradeRuns: 0, pendingDowngrade: false };
  }
  if (candidateRank <= previousRank) {
    return { status: candidate, downgradeRuns: 0, pendingDowngrade: false };
  }

  runs++;
  var needed = Math.max(1, Number(confirmRuns) || 1);
  if (runs >= needed) {
    return { status: candidate, downgradeRuns: 0, pendingDowngrade: false };
  }
  return {
    status: previous,
    downgradeRuns: runs,
    pendingDowngrade: true
  };
}

function earlySignalRank_(status) {
  var key = String(status || '').trim();
  return Object.prototype.hasOwnProperty.call(EARLY_SIGNAL_RANKS, key)
    ? EARLY_SIGNAL_RANKS[key]
    : null;
}

function resolveEarlySignalDay_(site, previous, now) {
  var day = calcDayNumber_(site && site.day0, toDateStr_(now));
  if (day !== '' && day !== null && day !== undefined) return day;
  if (previous && previous.day !== '' && previous.day !== null && previous.day !== undefined) {
    return Number(previous.day);
  }
  return '';
}

function buildEarlySignalReason_(metrics, candidate, resolved, confidence) {
  var reason = candidate.rule +
    '；actual status=' + resolved.status +
    '；confidence=' + confidence +
    '；24h impressions=' + metrics.impressions24h +
    ', clicks=' + metrics.clicks24h +
    ', guideQueries=' + metrics.guideQueryCount24h +
    ', top10=' + metrics.top10QueryCount +
    ', top20=' + metrics.top20QueryCount +
    ', intentClusters=' + metrics.intentClusterCount +
    '；DataCutoff=' + (metrics.dataCutoff || 'n/a') +
    '；DataIncomplete=' + (metrics.dataIncomplete ? 'TRUE' : 'FALSE');
  if (resolved.pendingDowngrade) {
    reason += '；downgrade pending ' + resolved.downgradeRuns +
      '/' + 'EARLY_DOWNGRADE_CONFIRM_RUNS';
  }
  return reason;
}

function updateEarlySiteSignalStatusRows_(records) {
  if (!records || !records.length) return;
  ensureSiteStatusHeader_();
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.SITE_STATUS);
  var range = getSheetDataRange_(sheet, SITE_STATUS_HEADERS.length);
  var rows = range ? range.getValues() : [];
  var rowBySite = {};
  for (var i = 0; i < rows.length; i++) {
    var existingSite = String(rows[i][1] || '').trim();
    if (existingSite) rowBySite[existingSite] = i;
  }

  var nowMs = Date.now();
  for (var r = 0; r < records.length; r++) {
    var record = records[r];
    var index = rowBySite[record.site];
    if (index === undefined) {
      index = rows.length;
      var freshRow = [];
      for (var blank = 0; blank < SITE_STATUS_HEADERS.length; blank++) freshRow.push('');
      freshRow[0] = record.updatedAt;
      freshRow[1] = record.site;
      freshRow[3] = record.day;
      rows.push(freshRow);
      rowBySite[record.site] = index;
    }

    var row = rows[index];
    var columns = earlySiteStatusColumns_();
    var previousEventAt = row[columns.eventAt];
    var previousEventMs = earlySignalDateMs_(previousEventAt);
    var eventEligible = !record.previous || !record.previous.status || record.transition;
    if (eventEligible) {
      var cooldownMs = Math.max(0, record.cooldownHours) * 60 * 60 * 1000;
      var cooldownActive = previousEventMs && nowMs - previousEventMs < cooldownMs;
      if (!cooldownActive || record.upgrade || !previousEventMs) {
        row[columns.eventAt] = record.updatedAt;
        writeLog_(
          'INFO',
          record.site,
          'Early Signal 状态事件：' +
            (record.previous && record.previous.status || 'NEW') + ' -> ' + record.status
        );
      }
    }
    row[columns.status] = record.status;
    row[columns.confidence] = record.confidence;
    row[columns.impressions] = record.metrics.impressions24h;
    row[columns.clicks] = record.metrics.clicks24h;
    row[columns.guideQueries] = record.metrics.guideQueryCount24h;
    row[columns.top10] = record.metrics.top10QueryCount;
    row[columns.top20] = record.metrics.top20QueryCount;
    row[columns.intentClusters] = record.metrics.intentClusterCount;
    row[columns.updatedAt] = record.updatedAt;
    row[columns.reason] = record.reason;
    row[columns.downgradeRuns] = record.downgradeRuns;
  }

  ensureSheetGrid_(sheet, rows.length + 1, SITE_STATUS_HEADERS.length);
  if (rows.length) sheet.getRange(2, 1, rows.length, SITE_STATUS_HEADERS.length).setValues(rows);
}

function earlySiteStatusColumns_() {
  return {
    status: SITE_STATUS_HEADERS.indexOf('EarlySignalStatus'),
    confidence: SITE_STATUS_HEADERS.indexOf('EarlySignalConfidence'),
    impressions: SITE_STATUS_HEADERS.indexOf('RealtimeImpressions24H'),
    clicks: SITE_STATUS_HEADERS.indexOf('RealtimeClicks24H'),
    guideQueries: SITE_STATUS_HEADERS.indexOf('RealtimeGuideQueries'),
    top10: SITE_STATUS_HEADERS.indexOf('RealtimeTop10Queries'),
    top20: SITE_STATUS_HEADERS.indexOf('RealtimeTop20Queries'),
    intentClusters: SITE_STATUS_HEADERS.indexOf('RealtimeIntentClusters'),
    updatedAt: SITE_STATUS_HEADERS.indexOf('EarlySignalUpdatedAt'),
    reason: SITE_STATUS_HEADERS.indexOf('EarlySignalReason'),
    downgradeRuns: SITE_STATUS_HEADERS.indexOf('EarlySignalDowngradeRuns'),
    eventAt: SITE_STATUS_HEADERS.indexOf('EarlySignalEventAt')
  };
}

function earlySignalDateMs_(value) {
  if (!value) return 0;
  var date = value instanceof Date ? value : new Date(value);
  var ms = date.getTime();
  return isNaN(ms) ? 0 : ms;
}

function earlyMetricNumber_(value) {
  var n = Number(value || 0);
  return isNaN(n) ? 0 : n;
}
