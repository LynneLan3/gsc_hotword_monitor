/**
 * Query Cluster → Page Hotspot → Action（M0）。
 *
 * 输入是现有 hourly_all 的 Query×Page 行，以及独立的 hourly Page 行；输出为
 * 纯聚合结果，随后由 runFreshQueryMonitor 写入「Intent机会」。不调用 LLM，
 * 不改变 Query 明细。
 */

function buildIntentOpportunitySnapshot_(recentRows, opts) {
  opts = opts || {};
  var site = opts.site || {};
  var clustersByKey = {};
  var pagesByPath = {};
  var previousByKey = {};
  var rows = recentRows || [];
  var pageRows = opts.pageRows !== undefined ? opts.pageRows : null;
  var useQueryRowsForPageHotspots = pageRows === null;

  for (var i = 0; i < rows.length; i++) {
    addIntentAggregateRow_(
      rows[i],
      site,
      clustersByKey,
      pagesByPath,
      useQueryRowsForPageHotspots
    );
  }
  if (pageRows !== null) {
    for (var pr = 0; pr < pageRows.length; pr++) {
      addIntentPageAggregateRow_(pageRows[pr], pagesByPath);
    }
  }
  for (var p = 0; p < (opts.previousRows || []).length; p++) {
    var previous = opts.previousRows[p] || {};
    var previousKey = intentClusterKeyForQuery_(previous.query, site);
    if (!previousKey) continue;
    previousByKey[previousKey] = (previousByKey[previousKey] || 0) +
      intentMetricNumber_(previous.impressions);
  }

  var pageHotspots = [];
  var pageKeys = Object.keys(pagesByPath);
  for (var j = 0; j < pageKeys.length; j++) {
    var page = pagesByPath[pageKeys[j]];
    page.clusterKeys = Object.keys(page.clusterSet);
    page.clusterCount = page.clusterKeys.length;
    var pageClusterImpressions = [];
    for (var pc = 0; pc < page.clusterKeys.length; pc++) {
      var pageClusterKey = page.clusterKeys[pc];
      pageClusterImpressions.push({
        key: pageClusterKey,
        impressions: page.clusterImpressions[pageClusterKey] || 0
      });
    }
    pageClusterImpressions.sort(compareIntentImpressionsDesc_);
    page.topCluster = pageClusterImpressions.length ? pageClusterImpressions[0].key : '';
    page.topClusterShare = page.impressions > 0 && pageClusterImpressions.length
      ? pageClusterImpressions[0].impressions / page.impressions
      : 0;
    page.isHub = intentIsHubPage_(page.page, site);
    page.hotspotLevel = intentHotspotLevel_(page.impressions, page.clicks);
    page.signalConfidence = page.hotspotLevel;
    page.ctr = page.impressions > 0 ? page.clicks / page.impressions : 0;
    page.position = page.impressions > 0 ? page.positionWeight / page.impressions : 0;
    page.pageAction = classifyIntentPageAction_(page);
    page.pageActionReason = buildIntentPageActionReason_(page);
    delete page.clusterSet;
    delete page.clusterImpressions;
    pageHotspots.push(page);
  }
  pageHotspots.sort(compareIntentImpressionsDesc_);

  var clusters = [];
  var clusterKeys = Object.keys(clustersByKey);
  var pageByPath = {};
  for (var h = 0; h < pageHotspots.length; h++) pageByPath[pageHotspots[h].page] = pageHotspots[h];
  for (var k = 0; k < clusterKeys.length; k++) {
    var cluster = clustersByKey[clusterKeys[k]];
    finalizeIntentCluster_(cluster, site, previousByKey[cluster.key] || 0);
    cluster.pageHotspot = pageByPath[cluster.topPage] || null;
    cluster.clusterAction = cluster.action;
    cluster.clusterActionReason = cluster.actionReason;
    clusters.push(cluster);
  }
  clusters.sort(compareIntentImpressionsDesc_);

  // PageAction research needs the complete set of clusters visible for that
  // page, while keeping Query Cluster aggregation independent from Page rows.
  for (var ph = 0; ph < pageHotspots.length; ph++) {
    var hotspot = pageHotspots[ph];
    hotspot.clusterDetails = [];
    for (var cd = 0; cd < clusters.length; cd++) {
      var clusterForPage = clusters[cd];
      for (var cp = 0; cp < clusterForPage.pages.length; cp++) {
        if (clusterForPage.pages[cp].page !== hotspot.page) continue;
        hotspot.clusterDetails.push({
          key: clusterForPage.key,
          label: clusterForPage.label,
          queries: clusterForPage.queries,
          clicks: clusterForPage.clicks,
          impressions: clusterForPage.impressions,
          ctr: clusterForPage.ctr,
          position: clusterForPage.position,
          pageImpressions: clusterForPage.pages[cp].impressions,
          pageShare: clusterForPage.impressions > 0
            ? clusterForPage.pages[cp].impressions / clusterForPage.impressions
            : 0
        });
        break;
      }
    }
    hotspot.clusterDetails.sort(compareIntentImpressionsDesc_);
  }
  for (var co = 0; co < clusters.length; co++) {
    clusters[co].pageActionOwner = !!(
      clusters[co].pageHotspot &&
      clusters[co].pageHotspot.topCluster === clusters[co].key
    );
  }

  return {
    site: site,
    clusters: clusters,
    pageHotspots: pageHotspots,
    cutoffHour: String(opts.cutoffHour || ''),
    incomplete: !!opts.incomplete
  };
}

function addIntentAggregateRow_(row, site, clustersByKey, pagesByPath, includePageMetrics) {
  row = row || {};
  var query = String(row.query || '').trim();
  var pagePath = intentPagePath_(row.page || row.pageUrl || '');
  var impressions = intentMetricNumber_(row.impressions);
  var clicks = intentMetricNumber_(row.clicks);
  var position = intentMetricNumber_(row.position);
  if (!query || !pagePath) return;

  var classification = classifyIntentCluster_(query, site);
  var key = classification.key;
  var cluster = clustersByKey[key];
  if (!cluster) {
    cluster = clustersByKey[key] = {
      key: key,
      label: classification.label,
      intentType: classification.intentType || '',
      intentFamily: classification.intentFamily || '',
      queriesByKey: {},
      pagesByPath: {},
      clicks: 0,
      impressions: 0,
      positionWeight: 0,
      knownEntity: classification.entityKey || '',
      knownEntityLabel: classification.entityLabel || '',
      hasAlias: false,
      hasMultilingualAlias: false
    };
  }
  cluster.clicks += clicks;
  cluster.impressions += impressions;
  cluster.positionWeight += position * impressions;
  if (classification.isAlias) cluster.hasAlias = true;
  if (classification.isMultilingualAlias) cluster.hasMultilingualAlias = true;

  var queryKey = intentClusterNormalizeText_(query);
  var queryItem = cluster.queriesByKey[queryKey];
  if (!queryItem) {
    queryItem = cluster.queriesByKey[queryKey] = {
      query: query,
      clicks: 0,
      impressions: 0,
      positionWeight: 0
    };
  }
  queryItem.clicks += clicks;
  queryItem.impressions += impressions;
  queryItem.positionWeight += position * impressions;

  var clusterPage = cluster.pagesByPath[pagePath];
  if (!clusterPage) {
    clusterPage = cluster.pagesByPath[pagePath] = {
      page: pagePath,
      clicks: 0,
      impressions: 0,
      positionWeight: 0
    };
  }
  clusterPage.clicks += clicks;
  clusterPage.impressions += impressions;
  clusterPage.positionWeight += position * impressions;

  var page = ensureIntentPageAggregate_(pagesByPath, pagePath);
  if (includePageMetrics) {
    page.clicks += clicks;
    page.impressions += impressions;
    page.positionWeight += position * impressions;
  }
  page.clusterSet[key] = true;
  page.clusterImpressions[key] = (page.clusterImpressions[key] || 0) + impressions;
}

function addIntentPageAggregateRow_(row, pagesByPath) {
  row = row || {};
  var pagePath = intentPagePath_(row.page || row.pageUrl || '');
  if (!pagePath) return;
  var page = ensureIntentPageAggregate_(pagesByPath, pagePath);
  var clicks = intentMetricNumber_(row.clicks);
  var impressions = intentMetricNumber_(row.impressions);
  var position = intentMetricNumber_(row.position);
  page.clicks += clicks;
  page.impressions += impressions;
  page.positionWeight += position * impressions;
}

function ensureIntentPageAggregate_(pagesByPath, pagePath) {
  if (!pagesByPath[pagePath]) {
    pagesByPath[pagePath] = {
      page: pagePath,
      clicks: 0,
      impressions: 0,
      positionWeight: 0,
      clusterSet: {},
      clusterImpressions: {}
    };
  }
  return pagesByPath[pagePath];
}

function finalizeIntentCluster_(cluster, site, previousImpressions) {
  cluster.ctr = cluster.impressions > 0 ? cluster.clicks / cluster.impressions : 0;
  cluster.position = cluster.impressions > 0
    ? cluster.positionWeight / cluster.impressions
    : 0;
  cluster.previousImpressions = previousImpressions || 0;
  cluster.growthRate = previousImpressions > 0
    ? (cluster.impressions - previousImpressions) / previousImpressions
    : null;

  cluster.queries = objectValues_(cluster.queriesByKey);
  cluster.queries.sort(compareIntentImpressionsDesc_);
  cluster.queryCount = cluster.queries.length;
  cluster.topQuery = cluster.queries.length ? cluster.queries[0].query : '';
  delete cluster.queriesByKey;

  cluster.pages = objectValues_(cluster.pagesByPath);
  for (var i = 0; i < cluster.pages.length; i++) {
    var page = cluster.pages[i];
    page.ctr = page.impressions > 0 ? page.clicks / page.impressions : 0;
    page.position = page.impressions > 0 ? page.positionWeight / page.impressions : 0;
    page.isHub = intentIsHubPage_(page.page, site);
  }
  cluster.pages.sort(compareIntentImpressionsDesc_);
  delete cluster.pagesByPath;

  var topPage = cluster.pages.length ? cluster.pages[0] : null;
  var secondPage = cluster.pages.length > 1 ? cluster.pages[1] : null;
  cluster.topPage = topPage ? topPage.page : '';
  cluster.topPageImpressions = topPage ? topPage.impressions : 0;
  cluster.topPageShare = cluster.impressions > 0
    ? cluster.topPageImpressions / cluster.impressions
    : 0;
  cluster.hasDominantPage = cluster.topPageShare >= INTENT_CLUSTER_THRESHOLDS.DOMINANT_PAGE_SHARE;
  cluster.possibleCannibalization = !!(
    secondPage &&
    cluster.impressions >= INTENT_CLUSTER_THRESHOLDS.CANNIBAL_CLUSTER_MIN_IMPRESSIONS &&
    topPage.impressions >= INTENT_CLUSTER_THRESHOLDS.CANNIBAL_PAGE_MIN_IMPRESSIONS &&
    secondPage.impressions >= INTENT_CLUSTER_THRESHOLDS.CANNIBAL_PAGE_MIN_IMPRESSIONS &&
    cluster.topPageShare >= INTENT_CLUSTER_THRESHOLDS.CANNIBAL_PAGE1_SHARE &&
    secondPage.impressions / cluster.impressions >= INTENT_CLUSTER_THRESHOLDS.CANNIBAL_PAGE2_SHARE
  );
  cluster.hasExistingPage = false;
  for (var p = 0; p < cluster.pages.length; p++) {
    if (!cluster.pages[p].isHub && cluster.pages[p].impressions > 0) {
      cluster.hasExistingPage = true;
      break;
    }
  }
  cluster.hotspotLevel = intentHotspotLevel_(cluster.impressions, cluster.clicks);
  cluster.signalConfidence = cluster.hotspotLevel;
  cluster.clusterAction = classifyIntentAction_(cluster);
  cluster.clusterActionReason = buildIntentActionReason_(cluster);
  // Keep the old in-memory/sheet field as a ClusterAction compatibility alias.
  cluster.action = cluster.clusterAction;
  cluster.actionReason = cluster.clusterActionReason;
  return cluster;
}

function classifyIntentAction_(cluster) {
  var t = INTENT_CLUSTER_THRESHOLDS;
  if (cluster.hasMultilingualAlias && cluster.hasExistingPage) {
    return INTENT_CLUSTER_ACTIONS.MULTILINGUAL_ALIAS;
  }
  if (cluster.possibleCannibalization) {
    return INTENT_CLUSTER_ACTIONS.CANNIBALIZATION;
  }
  // Gloombound Flame is an existing entity/task cluster. An unmapped alias
  // must not become a new page research opportunity just because the current
  // query rows did not expose its canonical page.
  if (cluster.knownEntity === 'GLOOMBOUND_FLAME' && !cluster.hasExistingPage) {
    return INTENT_CLUSTER_ACTIONS.OBSERVE;
  }
  if (cluster.impressions >= t.NEW_INTENT_IMPRESSIONS && !cluster.hasExistingPage) {
    return INTENT_CLUSTER_ACTIONS.RESEARCH_NEW_INTENT;
  }
  if (cluster.impressions > 0 || cluster.clicks > 0) {
    return INTENT_CLUSTER_ACTIONS.OBSERVE;
  }
  return INTENT_CLUSTER_ACTIONS.NO_ACTION;
}

function classifyIntentPageAction_(page) {
  var t = INTENT_CLUSTER_THRESHOLDS;
  if (!page || page.isHub || page.impressions <= 0) {
    return INTENT_PAGE_ACTIONS.NO_ACTION;
  }
  if (
    page.impressions >= t.HIGH_IMPRESSIONS &&
    page.position <= t.OPTIMIZE_POSITION_MAX &&
    page.ctr < t.OPTIMIZE_CTR_MAX
  ) {
    return INTENT_PAGE_ACTIONS.OPTIMIZE_EXISTING;
  }
  if (page.hotspotLevel === 'HIGH') return INTENT_PAGE_ACTIONS.EXISTING_GROWTH;
  return INTENT_PAGE_ACTIONS.OBSERVE;
}

function buildIntentPageActionReason_(page) {
  if (!page) return '没有页面信号，不采取动作。';
  var text = 'Page ' + page.page + '：' + page.impressions + ' impressions / ' +
    page.clicks + ' clicks / CTR ' + Math.round(page.ctr * 10000) / 100 +
    '% / position ' + Math.round(page.position * 100) / 100;
  if (page.pageAction === INTENT_PAGE_ACTIONS.OPTIMIZE_EXISTING) {
    return text + '；已有页 impressions≥100、平均排名≤10 且 CTR<2%，建议优化。';
  }
  if (page.pageAction === INTENT_PAGE_ACTIONS.EXISTING_GROWTH) {
    return text + '；已有页达到 HIGH Page Hotspot，继续现有内容增长。';
  }
  if (page.pageAction === INTENT_PAGE_ACTIONS.OBSERVE) {
    return text + '；当前页面信号未达到动作阈值，继续观察。';
  }
  return text + '；没有足够页面信号，不采取动作。';
}

function buildIntentActionReason_(cluster) {
  var page = cluster.pageHotspot || (cluster.pages.length ? cluster.pages[0] : null);
  var text = 'Cluster ' + cluster.label + '：' + cluster.impressions + ' impressions / ' +
    cluster.clicks + ' clicks';
  if (cluster.previousImpressions > 0 && cluster.growthRate !== null) {
    text += '；按 Cluster aggregate 对比前24h ' + cluster.previousImpressions +
      ' impressions（增长率 ' + Math.round(cluster.growthRate * 1000) / 10 + '%）';
  }
  if (page) text += '；主承接页 ' + page.page + ' 占比 ' + Math.round(cluster.topPageShare * 1000) / 10 + '%';
  if (cluster.action === INTENT_CLUSTER_ACTIONS.MULTILINGUAL_ALIAS) {
    return text + '；已知实体的多语言/alias，复用现有页面，不新建页面。';
  }
  if (cluster.action === INTENT_CLUSTER_ACTIONS.CANNIBALIZATION) {
    return text + '；两个页面均达到明显曝光占比，标记可能 cannibalization。';
  }
  if (cluster.action === INTENT_CLUSTER_ACTIONS.RESEARCH_NEW_INTENT) {
    return text + '；Cluster impressions≥20 且没有明确内容页承接，进入研究队列。';
  }
  if (cluster.action === INTENT_CLUSTER_ACTIONS.OPTIMIZE_EXISTING) {
    return text + '；已有页 impressions≥100、平均排名≤10 且 CTR<2%，建议优化。';
  }
  if (cluster.action === INTENT_CLUSTER_ACTIONS.EXISTING_GROWTH) {
    return text + '；已有页承接且达到 HIGH 信号，按现有内容增长观察。';
  }
  if (cluster.action === INTENT_CLUSTER_ACTIONS.OBSERVE) {
    return text + '；当前信号未达到动作阈值，继续观察。';
  }
  return text + '；没有足够信号，不采取动作。';
}

function buildIntentOpportunitySheetRows_(snapshot) {
  var rows = [];
  var clusters = (snapshot && snapshot.clusters) || [];
  for (var i = 0; i < clusters.length; i++) {
    var c = clusters[i];
    var page = c.pageHotspot || (c.pages.length ? c.pages[0] : null);
    var pageActionOwner = c.pageActionOwner === true || !!(page && page.topCluster === c.key);
    rows.push([
      snapshot.site && snapshot.site.name || '',
      c.key,
      c.label,
      c.queries.map(function (q) { return q.query; }).join(' | '),
      c.queryCount,
      c.clicks,
      c.impressions,
      c.ctr,
      c.position,
      c.previousImpressions,
      c.growthRate === null ? '' : c.growthRate,
      c.topQuery,
      c.topPage,
      c.topPageImpressions,
      c.topPageShare,
      page ? page.clicks : 0,
      page ? page.impressions : 0,
      page ? page.ctr : 0,
      page ? page.position : 0,
      page ? page.clusterCount : 0,
      page ? page.topCluster : '',
      page ? page.topClusterShare : 0,
      c.hotspotLevel,
      c.signalConfidence,
      c.hasDominantPage ? 'TRUE' : 'FALSE',
      c.possibleCannibalization ? 'TRUE' : 'FALSE',
      c.hasExistingPage ? 'TRUE' : 'FALSE',
      c.action,
      c.actionReason,
      c.researchJobId || '',
      c.researchJobStatus || '',
      snapshot.cutoffHour || '',
      snapshot.incomplete ? 'TRUE' : 'FALSE',
      c.clusterAction || c.action,
      c.clusterActionReason || c.actionReason,
      pageActionOwner ? page.pageAction : '',
      pageActionOwner ? page.pageActionReason : '',
      pageActionOwner ? 'TRUE' : 'FALSE',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      c.intentType || '', c.intentFamily || '', '', '', '', '',
      JSON.stringify(c.adjacentCaptureCandidates || c.externalAdjacentIntents || []),
      c.adjacentCaptureReason || ''
    ]);
  }
  return rows;
}

function buildIntentOpportunityRowsFromSnapshots_(snapshots) {
  var rows = [];
  for (var i = 0; i < (snapshots || []).length; i++) {
    var snapshot = snapshots[i];
    var clusters = (snapshot && snapshot.clusters) || [];
    for (var c = 0; c < clusters.length; c++) {
      clusters[c].site = snapshot.site && snapshot.site.name || '';
      clusters[c].dataCutoff = snapshot.cutoffHour || '';
      clusters[c].dataIncomplete = !!snapshot.incomplete;
    }
    rows = rows.concat(buildIntentOpportunitySheetRows_(snapshot));
  }
  return rows;
}

function writeIntentOpportunityRows_(rows) {
  ensureIntentOpportunityHeader_();
  replaceSheetDataRows_(SHEET_NAMES.INTENT_OPPORTUNITIES, INTENT_OPPORTUNITY_HEADERS, rows || []);
}

/** Append the M0.1 fields to an existing Intent机会 sheet without rewriting old columns. */
function ensureIntentOpportunityHeader_() {
  var sheet = ensureSheet_(SHEET_NAMES.INTENT_OPPORTUNITIES, INTENT_OPPORTUNITY_HEADERS);
  ensureSheetGrid_(sheet, 1, INTENT_OPPORTUNITY_HEADERS.length);
  var existing = sheet.getRange(1, 1, 1, INTENT_OPPORTUNITY_HEADERS.length).getValues()[0];
  var merged = existing.slice();
  var changed = false;
  for (var i = 0; i < INTENT_OPPORTUNITY_HEADERS.length; i++) {
    if (!String(merged[i] || '').trim()) {
      merged[i] = INTENT_OPPORTUNITY_HEADERS[i];
      changed = true;
    }
  }
  if (changed) sheet.getRange(1, 1, 1, INTENT_OPPORTUNITY_HEADERS.length).setValues([merged]);
}

/**
 * Action → 既有「研究任务」Sheet。
 * 只消费三类需要研究的 Action；PageAction 仅接受 owner 行。
 */
function enqueueIntentResearchJobs_(intentRecords) {
  var candidates = [];
  var seen = {};
  for (var i = 0; i < (intentRecords || []).length; i++) {
    var sourceRecord = intentRecords[i];
    var candidate = buildIntentResearchCandidate_(sourceRecord);
    if (!candidate) continue;
    candidate.sourceRecord = sourceRecord;
    var key = intentResearchDedupeKey_(
      candidate.site,
      candidate.dedupeIdentity,
      candidate.researchType
    );
    if (seen[key]) continue;
    seen[key] = true;
    candidates.push(candidate);
  }
  if (!candidates.length) return { created: 0, skipped: 0, jobs: {} };

  ensureResearchJobSheets_();
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet) return { created: 0, skipped: candidates.length, jobs: {} };
  var lastCol = Math.max(sheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var rows = sheet.getLastRow() >= 2
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues()
    : [];
  var existing = {};
  for (var r = 0; r < rows.length; r++) {
    var status = String(cell_(rows[r], col, '任务状态') || '').trim();
    if (!isIntentResearchJobOpen_(status)) continue;
    var site = String(cell_(rows[r], col, '站点') || '').trim();
    var source = String(cell_(rows[r], col, 'source_query') || '').trim();
    var topic = String(cell_(rows[r], col, '搜索词 / topic') || '').trim();
    var researchType = String(cell_(rows[r], col, '研究类型') || '').trim() || RESEARCH_TYPE.CONTENT_RESEARCH;
    var context = safeJsonParse_(cell_(rows[r], col, 'ActionContext'), {});
    var identity = researchType === RESEARCH_TYPE.PAGE_OPTIMIZATION_RESEARCH
      ? intentPageResearchIdentity_(context.pagePath || cell_(rows[r], col, '页面路径'))
      : context.clusterKey || intentClusterKeyForQuery_(source || topic, { name: site });
    var existingKey = intentResearchDedupeKey_(site, identity, researchType);
    if (site && existingKey) {
      existing[existingKey] = {
        jobId: String(cell_(rows[r], col, '任务ID') || '').trim(),
        status: status
      };
    }
  }

  var now = new Date();
  var createdRows = [];
  var jobs = {};
  var skipped = 0;
  for (var c = 0; c < candidates.length; c++) {
    var candidate = candidates[c];
    var dedupeKey = intentResearchDedupeKey_(
      candidate.site,
      candidate.dedupeIdentity,
      candidate.researchType
    );
    if (existing[dedupeKey]) {
      candidate.researchJobId = existing[dedupeKey].jobId;
      candidate.researchJobStatus = existing[dedupeKey].status;
      candidate.sourceRecord.researchJobId = candidate.researchJobId;
      candidate.sourceRecord.researchJobStatus = candidate.researchJobStatus;
      skipped++;
      continue;
    }
    var job = {
      job_id: makeResearchJobId_(
        candidate.site,
        candidate.pagePath || '',
        candidate.clusterLabel,
        candidate.topQuery,
        now
      ),
      game: candidate.site,
      topic: candidate.clusterLabel,
      existing_page: candidate.pagePath || '',
      opportunity_level: candidate.hotspotLevel === 'HIGH' ? OPPORTUNITY_LEVELS.HIGH : OPPORTUNITY_LEVELS.MEDIUM,
      recommended_action: candidate.researchType === RESEARCH_TYPE.PAGE_OPTIMIZATION_RESEARCH
        ? OPPORTUNITY_ACTIONS.RESEARCH_EXPAND_EXISTING
        : OPPORTUNITY_ACTIONS.RESEARCH_NEW_CONTENT,
      source_query: candidate.topQuery,
      related_queries: (candidate.relatedQueries || candidate.queries || []).map(function (q) {
        return typeof q === 'string' ? q : q.query;
      }).join(' | '),
      research_type: candidate.researchType,
      source_action: candidate.sourceAction,
      action_context: candidate.actionContext
    };
    if (existingJobsById_(createdRows, job.job_id)) {
      job.job_id = uniquifyResearchJobId_(job.job_id, candidate.clusterKey);
    }
    var row = researchJobSheetRow_(job, candidate.site, now);
    createdRows.push(row);
    existing[dedupeKey] = {
      jobId: job.job_id,
      status: RESEARCH_JOB_STATUS_LABELS.PENDING || '待处理'
    };
    candidate.researchJobId = job.job_id;
    candidate.researchJobStatus = RESEARCH_JOB_STATUS_LABELS.PENDING || '待处理';
    candidate.sourceRecord.researchJobId = candidate.researchJobId;
    candidate.sourceRecord.researchJobStatus = candidate.researchJobStatus;
    jobs[dedupeKey] = job.job_id;
  }
  if (createdRows.length) {
    var start = sheet.getLastRow() + 1;
    if (start < 2) start = 2;
    sheet.getRange(start, 1, createdRows.length, RESEARCH_JOB_HEADERS.length).setValues(createdRows);
  }
  writeLog_('INFO', '', 'enqueueIntentResearchJobs created=' + createdRows.length + ' skipped=' + skipped);
  return { created: createdRows.length, skipped: skipped, jobs: jobs };
}

function buildIntentResearchCandidate_(record) {
  if (!record) return null;
  var clusterAction = record.clusterAction || record.action || '';
  var pageAction = record.pageAction || (record.pageHotspot && record.pageHotspot.pageAction) || '';
  var researchType = '';
  if (clusterAction === INTENT_CLUSTER_ACTIONS.RESEARCH_NEW_INTENT) {
    researchType = RESEARCH_TYPE.NEW_INTENT_RESEARCH;
  } else if (clusterAction === INTENT_CLUSTER_ACTIONS.CANNIBALIZATION) {
    researchType = RESEARCH_TYPE.CANNIBALIZATION_RESEARCH;
  } else if (
    pageAction === INTENT_PAGE_ACTIONS.OPTIMIZE_EXISTING &&
    record.pageActionOwner === true
  ) {
    researchType = RESEARCH_TYPE.PAGE_OPTIMIZATION_RESEARCH;
  }
  // Legacy direct callers that only provide Action remain NEW_INTENT compatible.
  if (!researchType && clusterAction === INTENT_CLUSTER_ACTIONS.RESEARCH_NEW_INTENT) {
    researchType = RESEARCH_TYPE.NEW_INTENT_RESEARCH;
  }
  if (!researchType) return null;

  var page = record.pageHotspot || {};
  var pagePath = record.pagePath || page.page || record.topPage || '';
  var clusterKey = record.clusterKey || record.key || '';
  var identity = researchType === RESEARCH_TYPE.PAGE_OPTIMIZATION_RESEARCH
    ? intentPageResearchIdentity_(pagePath)
    : clusterKey;
  if (!record.site || !identity) return null;

  var context = buildIntentResearchContext_(record, researchType, pagePath);
  var relatedQueries = record.queries || [];
  if (researchType === RESEARCH_TYPE.PAGE_OPTIMIZATION_RESEARCH && page.clusterDetails) {
    relatedQueries = [];
    for (var i = 0; i < page.clusterDetails.length; i++) {
      relatedQueries = relatedQueries.concat(page.clusterDetails[i].queries || []);
    }
  }
  return {
    site: record.site,
    clusterKey: clusterKey,
    clusterLabel: record.label || record.clusterLabel || page.topCluster || clusterKey,
    topQuery: record.topQuery || '',
    queries: record.queries || [],
    relatedQueries: relatedQueries,
    hotspotLevel: record.hotspotLevel || page.hotspotLevel || 'LOW',
    pagePath: pagePath,
    researchType: researchType,
    sourceAction: researchType === RESEARCH_TYPE.PAGE_OPTIMIZATION_RESEARCH
      ? pageAction
      : clusterAction,
    dedupeIdentity: identity,
    actionContext: context
  };
}

function buildIntentResearchContext_(record, researchType, pagePath) {
  var page = record.pageHotspot || {};
  var context = {
    site: record.site || '',
    researchType: researchType,
    sourceAction: researchType === RESEARCH_TYPE.PAGE_OPTIMIZATION_RESEARCH
      ? (page.pageAction || record.pageAction || '')
      : (record.clusterAction || record.action || ''),
    clusterKey: record.clusterKey || record.key || '',
    clusterLabel: record.label || record.clusterLabel || '',
    clusterQueries: record.queries || [],
    clusterImpressions: Number(record.impressions || 0),
    clusterClicks: Number(record.clicks || 0),
    clusterCTR: Number(record.ctr || 0),
    clusterPosition: Number(record.position || 0),
    topQuery: record.topQuery || '',
    topPage: record.topPage || pagePath || '',
    topPageShare: Number(record.topPageShare || 0),
    actionReason: record.clusterActionReason || record.actionReason || '',
    dataCutoff: record.dataCutoff || ''
  };
  if (researchType === RESEARCH_TYPE.PAGE_OPTIMIZATION_RESEARCH) {
    context.pagePath = pagePath || page.page || '';
    context.pageClicks = Number(page.clicks || 0);
    context.pageImpressions = Number(page.impressions || 0);
    context.pageCTR = Number(page.ctr || 0);
    context.pagePosition = Number(page.position || 0);
    context.hotspotLevel = page.hotspotLevel || record.hotspotLevel || '';
    context.pageTopCluster = page.topCluster || '';
    context.pageClusterCount = Number(page.clusterCount || 0);
    context.pageActionReason = page.pageActionReason || '';
    context.clusters = page.clusterDetails || [];
  }
  if (researchType === RESEARCH_TYPE.CANNIBALIZATION_RESEARCH) {
    context.competingPages = record.pages || [];
    context.primaryCandidate = record.topPage || '';
  }
  return context;
}

function existingJobsById_(rows, jobId) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === String(jobId || '').trim()) return true;
  }
  return false;
}

function isIntentResearchJobOpen_(status) {
  var s = String(status || '').trim();
  return !s || s === RESEARCH_JOB_STATUS_LABELS.PENDING || s === RESEARCH_JOB_STATUS_LABELS.REVIEW ||
    s === RESEARCH_JOB_STATUS_LABELS.APPROVED || s === RESEARCH_JOB_STATUS_LABELS.WATCH ||
    s === RESEARCH_JOB_STATUS_LABELS.READY_FOR_DISCOVERY_RUNNER ||
    s === RESEARCH_JOB_STATUS.RUNNING || s === '运行中' || s === 'ACTIVE' || s === 'active';
}

function intentResearchDedupeKey_(site, identity, researchType) {
  var s = String(site || '').trim();
  var c = String(identity || '').trim();
  var t = String(researchType || '').trim();
  return s && c ? s + '||' + c + (t ? '||' + t : '') : '';
}

function intentPageResearchIdentity_(pagePath) {
  var p = intentPagePath_(pagePath);
  return p && p !== '/' ? p : '';
}

function classifyIntentCluster_(query, site) {
  var residual = intentClusterResidualTokens_(query, site);
  var aliases = typeof INTENT_CLUSTER_ENTITY_ALIASES !== 'undefined'
    ? INTENT_CLUSTER_ENTITY_ALIASES
    : [];
  var siteId = intentClusterSiteId_(site);
  for (var i = 0; i < aliases.length; i++) {
    var entity = aliases[i];
    if (entity.siteId && entity.siteId !== siteId) continue;
    for (var a = 0; a < (entity.aliases || []).length; a++) {
      var aliasTokens = intentClusterTokensWithoutBrand_(entity.aliases[a]);
      if (!sameIntentTokenSet_(residual, aliasTokens)) continue;
      var aliasText = intentClusterNormalizeText_(entity.aliases[a]);
      var canonicalText = intentClusterNormalizeText_(entity.aliases[0]);
      var isAlias = aliasText !== canonicalText || /[^\x00-\x7F]/.test(String(query || ''));
      return {
        key: entity.key,
        label: entity.label,
        intentType: classifyIntentOpportunityType_(query, site),
        intentFamily: intentClusterFamilyForQuery_(query),
        entityKey: entity.key,
        entityLabel: entity.label,
        isAlias: isAlias,
        isMultilingualAlias: !!(entity.multilingual && isAlias)
      };
    }
  }
  var normalized = residual.length ? residual.slice().sort().join('_') : 'brand';
  return {
    key: 'QUERY_' + normalized.toUpperCase(),
    label: residual.length ? residual.join(' ') : 'Brand',
    intentType: classifyIntentOpportunityType_(query, site),
    intentFamily: intentClusterFamilyForQuery_(query),
    entityKey: '',
    entityLabel: '',
    isAlias: false,
    isMultilingualAlias: false
  };
}

function intentClusterKeyForQuery_(query, site) {
  return classifyIntentCluster_(query, site).key;
}

function intentClusterSiteId_(site) {
  var id = String((site && (site.siteId || site.site_id)) || '').trim().toLowerCase();
  if (id) return id;
  var name = intentClusterNormalizeText_(site && site.name || '');
  if (name === 'mortal shell 2') return 'mortal-shell-ii';
  return name.replace(/\s+/g, '-');
}

function intentClusterResidualTokens_(query, site) {
  var tokens = intentClusterTokensWithoutBrand_(query);
  var brand = intentClusterBrandTokens_(site);
  var out = [];
  for (var i = 0; i < tokens.length; i++) {
    if (!brand[tokens[i]] && !intentClusterNoiseTokens_[tokens[i]]) out.push(tokens[i]);
  }
  return out;
}

function intentClusterTokensWithoutBrand_(text) {
  return intentClusterTokenize_(text).filter(function (token) {
    return !intentClusterNoiseTokens_[token];
  });
}

var intentClusterNoiseTokens_ = {
  how: true, to: true, should: true, i: true, do: true, does: true, did: true,
  can: true, could: true, would: true, the: true, a: true, an: true,
  is: true, are: true, for: true, me: true, please: true, way: true
};

function intentClusterBrandTokens_(site) {
  var set = {};
  var chunks = [];
  if (site && site.name) chunks.push(site.name);
  if (site && site.propertyUrl) chunks.push(String(site.propertyUrl).split('://').pop().split('/')[0].split('.')[0]);
  if (site && (site.siteId || site.site_id)) chunks.push(site.siteId || site.site_id);
  for (var i = 0; i < chunks.length; i++) {
    var tokens = intentClusterTokenize_(chunks[i]);
    for (var j = 0; j < tokens.length; j++) set[tokens[j]] = true;
  }
  return set;
}

function intentClusterTokenize_(text) {
  var value = String(text || '').toLowerCase();
  try {
    if (value.normalize) value = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (e) {
    value = value.replace(/[üÜ]/g, 'u').replace(/[äÄ]/g, 'a').replace(/[öÖ]/g, 'o');
  }
  value = value.replace(/[\u2018\u2019']s\b/g, '');
  value = value.replace(/ii/g, '2');
  value = value.replace(/(\d+)\s+(kg|g|lb|lbs|oz|mm|cm|m|km)\b/g, '$1$2');
  value = value.replace(/[^a-z0-9]+/g, ' ').trim();
  if (!value) return [];
  return value.split(/\s+/).filter(function (token) { return !!token; }).map(function (token) {
    var canonical = {
      crashed: 'crash',
      crashes: 'crash',
      crashing: 'crash',
      loading: 'load',
      keeps: 'keep',
      martyrs: 'martyr',
      fuses: 'fuse',
      boxes: 'box',
      endings: 'ending',
      secrets: 'secret',
      plates: 'plate',
      achievements: 'achievement',
      walkthroughs: 'walkthrough',
      guides: 'guide',
      locations: 'location'
    };
    return canonical[token] || token;
  });
}

function intentClusterNormalizeText_(text) {
  return intentClusterTokenize_(text).join(' ');
}

/** Reuse the existing OpportunityEngine classification when it is loaded. */
function classifyIntentOpportunityType_(query, site) {
  if (typeof classifyOpportunityIntent_ === 'function' &&
      typeof classifyOpportunitySpecificity_ === 'function') {
    var intent = classifyOpportunityIntent_(query, site);
    if (typeof OPPORTUNITY_INTENT !== 'undefined' && intent === OPPORTUNITY_INTENT.BRAND) {
      return 'BRAND_INTENT';
    }
    if (typeof OPPORTUNITY_INTENT !== 'undefined' && intent === OPPORTUNITY_INTENT.GUIDE) {
      return 'GENERIC_INTENT';
    }
    if (classifyOpportunitySpecificity_(intent) === OPPORTUNITY_SPECIFICITY.BRAND_ONLY) {
      return 'BRAND_INTENT';
    }
    return 'SPECIFIC_INTENT';
  }
  var tokens = intentClusterTokensWithoutBrand_(query);
  var residual = intentClusterResidualTokens_(query, site);
  if (!residual.length) return 'BRAND_INTENT';
  var generic = { guide: true, walkthrough: true, wiki: true, tips: true, tutorial: true };
  for (var i = 0; i < tokens.length; i++) {
    if (generic[tokens[i]]) return 'GENERIC_INTENT';
  }
  return 'SPECIFIC_INTENT';
}

function intentClusterFamilyForQuery_(query) {
  var aliases = typeof INTENT_FAMILY_ALIASES !== 'undefined' ? INTENT_FAMILY_ALIASES : [];
  var normalized = intentClusterNormalizeText_(query);
  for (var i = 0; i < aliases.length; i++) {
    var family = aliases[i] || {};
    for (var a = 0; a < (family.aliases || []).length; a++) {
      var alias = intentClusterNormalizeText_(family.aliases[a]);
      if (normalized === alias || normalized.indexOf(alias + ' ') === 0 ||
          normalized.indexOf(' ' + alias) >= 0 || normalized.indexOf(' ' + alias + ' ') >= 0) {
        return family.family;
      }
    }
  }
  return '';
}

function sameIntentTokenSet_(left, right) {
  if (left.length !== right.length) return false;
  var a = left.slice().sort();
  var b = right.slice().sort();
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function intentPagePath_(value) {
  var p = String(value || '').trim();
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) {
    p = p.replace(/^https?:\/\/[^/]+/i, '');
  }
  p = p.split('?')[0].split('#')[0];
  if (p.charAt(0) !== '/') p = '/' + p;
  if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.substring(0, p.length - 1);
  return p || '/';
}

function intentIsHubPage_(page, site) {
  var path = intentPagePath_(page);
  if (!path || path === '/') return true;
  var segments = path.split('/').filter(function (s) { return !!s; });
  if (segments.length !== 1) return false;
  var slug = segments[0].toLowerCase();
  if (typeof OPPORTUNITY_HUB_SLUGS !== 'undefined' && OPPORTUNITY_HUB_SLUGS[slug]) return true;
  var siteSlug = String((site && (site.siteId || site.site_id)) || '').trim().toLowerCase();
  if (siteSlug && slug === siteSlug) return true;
  if (site && site.propertyUrl) {
    var hostSlug = String(site.propertyUrl).split('://').pop().split('/')[0].split('.')[0].toLowerCase();
    if (hostSlug && slug === hostSlug) return true;
  }
  var brand = intentClusterBrandTokens_(site);
  return !!brand[slug];
}

function intentHotspotLevel_(impressions, clicks) {
  var t = INTENT_CLUSTER_THRESHOLDS;
  if (impressions >= t.HIGH_IMPRESSIONS || clicks >= t.HIGH_CLICKS) return 'HIGH';
  if (impressions >= t.MEDIUM_IMPRESSIONS) return 'MEDIUM';
  return 'LOW';
}

function intentMetricNumber_(value) {
  var n = Number(value || 0);
  return isNaN(n) ? 0 : n;
}

function objectValues_(object) {
  var out = [];
  var keys = Object.keys(object || {});
  for (var i = 0; i < keys.length; i++) out.push(object[keys[i]]);
  return out;
}

function compareIntentImpressionsDesc_(a, b) {
  var diff = intentMetricNumber_(b.impressions) - intentMetricNumber_(a.impressions);
  if (diff) return diff;
  return String(a.page || a.query || a.key || '').localeCompare(String(b.page || b.query || b.key || ''));
}
