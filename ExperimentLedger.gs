/**
 * Automatic Experiment Ledger V1.
 *
 * Runtime ownership remains:
 *   Decision       -> 决策历史
 *   Intervention   -> 内容更新记录
 *   Formal Outcome -> 决策结果
 *
 * This module adds a GSC-owned intervention observation table and a
 * materialized timeline. It never creates Decisions or formal Outcomes.
 */

var PUBLISH_RECEIPT_SCHEMA_VERSION = 'hotword-publish-receipt-v1';
var LEDGER_RECORDED_MODE = 'REALTIME';
var LEDGER_TIMELINE_STATUS = 'REALTIME_AUTOMATED';
var LEDGER_OBSERVATION_HORIZONS = [
  { name: 'D7', days: 7 },
  { name: 'D14', days: 14 },
  { name: 'D30', days: 30 }
];
var LEDGER_ACTIONS = {
  CREATE_PAGE: true,
  UPDATE_PAGE: true,
  CONTENT_OPTIMIZE: true,
  CONTENT_EXPAND: true,
  INTERNAL_LINK: true,
  ADD_INTERNAL_LINK: true,
  PROMOTE_HOMEPAGE: true,
  DEMOTE_HOMEPAGE: true,
  REORDER_HOMEPAGE: true,
  CHANGE_TITLE: true,
  INDEX_FIX: true,
  OTHER: true
};

/** Public Execution API entry point. */
function recordPublishedBatch(payload) {
  var receipt = normalizePublishedReceipt_(payload);
  validatePublishedReceipt_(receipt);
  if (receipt.dryRun) return planPublishedBatch_(receipt, true);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('recordPublishedBatch: ledger write lock busy');
  try {
    return planPublishedBatch_(receipt, false);
  } finally {
    lock.releaseLock();
  }
}

function normalizePublishedReceipt_(payload) {
  var receipt = payload;
  if (typeof receipt === 'string') {
    try {
      receipt = JSON.parse(receipt);
    } catch (e) {
      throw new Error('recordPublishedBatch: payload is not valid JSON');
    }
  }
  receipt = receipt || {};
  receipt.common = receipt.common || {};
  receipt.interventions = receipt.interventions || [];
  receipt.dryRun = receipt.dryRun === true;
  return receipt;
}

function validatePublishedReceipt_(receipt) {
  if (receipt.schemaVersion !== PUBLISH_RECEIPT_SCHEMA_VERSION) {
    throw new Error(
      'recordPublishedBatch: schemaVersion must be ' + PUBLISH_RECEIPT_SCHEMA_VERSION
    );
  }
  if (!receipt.common || typeof receipt.common !== 'object') {
    throw new Error('recordPublishedBatch: common is required');
  }
  var required = ['site', 'siteId', 'batchId', 'commitSha', 'deploymentUrl', 'productionUrl', 'deployedAt'];
  for (var i = 0; i < required.length; i++) {
    if (!String(receipt.common[required[i]] || '').trim()) {
      throw new Error('recordPublishedBatch: common.' + required[i] + ' is required');
    }
  }
  if (!Array.isArray(receipt.interventions) || !receipt.interventions.length) {
    throw new Error('recordPublishedBatch: interventions must be a non-empty array');
  }
  for (var n = 0; n < receipt.interventions.length; n++) {
    var iv = receipt.interventions[n] || {};
    var action = String(iv.action || '').trim().toUpperCase();
    if (!action && !String(receipt.common.developmentTaskId || iv.developmentTaskId || '').trim()) {
      throw new Error('recordPublishedBatch: action is required unless developmentTaskId is provided');
    }
    if (action && !LEDGER_ACTIONS[action]) throw new Error('recordPublishedBatch: unsupported action=' + action);
    if (!String(iv.primaryUrl || '').trim()) {
      throw new Error('recordPublishedBatch: interventions[' + n + '].primaryUrl is required');
    }
  }
}

function planPublishedBatch_(receipt, dryRun) {
  var common = receipt.common || {};
  var task = resolveLedgerDevelopmentTask_(common.developmentTaskId);
  var historyIds = loadDecisionIdSetFromHistory_();
  var contentRows = loadLedgerSheetRows_(SHEET_NAMES.CONTENT_UPDATES);
  var timelineRows = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_TIMELINE);
  var allIds = ledgerInterventionIds_(contentRows, timelineRows);
  var results = [];
  var plans = [];

  for (var i = 0; i < receipt.interventions.length; i++) {
    var entryTaskId = String(receipt.interventions[i].developmentTaskId || common.developmentTaskId || '').trim();
    var entryTask = entryTaskId === String(common.developmentTaskId || '').trim()
      ? task
      : resolveLedgerDevelopmentTask_(entryTaskId);
    var plan = resolvePublishedIntervention_(receipt, receipt.interventions[i], entryTask, historyIds);
    plan.baseline = captureLedgerBaseline_(plan.site, plan.primaryUrl, plan.productionUrl, plan.deployedDate);
    plan.receiptKey = [plan.siteId, plan.commitSha, plan.action, plan.primaryUrl].join('|');
    var existing = findLedgerReceiptByKey_(contentRows, plan.receiptKey);
    plan.interventionId = existing && existing.interventionId
      ? existing.interventionId
      : nextLedgerInterventionId_(plan.deployedDate, plan.siteId, plan.action, allIds);
    allIds[plan.interventionId] = true;
    plans.push(plan);
  }

  if (dryRun) {
    for (var p = 0; p < plans.length; p++) results.push(compactLedgerResult_(plans[p], 'PREVIEW'));
    return {
      ok: true,
      dryRun: true,
      batchId: String(common.batchId || '').trim(),
      interventions: results
    };
  }

  ensureSheet_(SHEET_NAMES.CONTENT_UPDATES, CONTENT_UPDATE_HEADERS);
  ensureContentUpdateHeader_();
  ensureSheet_(SHEET_NAMES.INTERVENTION_OBSERVATIONS, INTERVENTION_OBSERVATION_HEADERS);
  ensureSheet_(SHEET_NAMES.INTERVENTION_TIMELINE, INTERVENTION_TIMELINE_HEADERS);

  for (var w = 0; w < plans.length; w++) writeLedgerContentReceipt_(plans[w]);
  for (var o = 0; o < plans.length; o++) writeLedgerObservationRows_(plans[o]);
  for (var t = 0; t < plans.length; t++) {
    writeLedgerTimelineRow_(plans[t]);
    results.push(compactLedgerResult_(plans[t], 'RECORDED'));
  }
  writeLog_('INFO', String(common.site || ''), 'recordPublishedBatch recorded batch=' + common.batchId + ' interventions=' + plans.length);
  return {
    ok: true,
    dryRun: false,
    batchId: String(common.batchId || '').trim(),
    interventions: results
  };
}

function resolvePublishedIntervention_(receipt, entry, task, historyIds) {
  entry = entry || {};
  var common = receipt.common || {};
  var action = String(entry.action || task.actionType || '').trim().toUpperCase();
  if (!action || !LEDGER_ACTIONS[action]) throw new Error('recordPublishedBatch: unsupported action=' + action);
  var taskSiteId = task.siteId || '';
  var taskDecisionId = task.decisionId || '';
  var taskOpportunityId = task.opportunityId || '';
  var siteId = ledgerMergeStableValue_('SiteID', ledgerMergeStableValue_('SiteID', common.siteId, entry.siteId), taskSiteId);
  var decisionId = ledgerMergeStableValue_('DecisionID', ledgerMergeStableValue_('DecisionID', common.decisionId, entry.decisionId), taskDecisionId);
  var opportunityId = ledgerMergeStableValue_('OpportunityID', ledgerMergeStableValue_('OpportunityID', common.opportunityId, entry.opportunityId), taskOpportunityId);
  var taskAction = String(task.actionType || '').trim().toUpperCase();
  if (taskAction && action && taskAction !== action) {
    throw new Error('recordPublishedBatch: Development Task ActionType conflict: receipt=' + action + ' task=' + taskAction);
  }
  if (!siteId) throw new Error('recordPublishedBatch: siteId is required after Development Task resolution');
  if (decisionId && !historyIds[decisionId]) {
    throw new Error('recordPublishedBatch: DecisionID does not exist in 决策历史: ' + decisionId);
  }
  var deployedAt = String(entry.deployedAt || common.deployedAt || '').trim();
  var deployDate = ledgerProductionLocalDate_(deployedAt);
  if (!deployDate) throw new Error('recordPublishedBatch: deployedAt is not a valid date');
  var sourceRefs = ledgerStringArray_(entry.sourceRefs);
  if (!sourceRefs.length && task.sourceReference) sourceRefs = [task.sourceReference];
  return {
    site: String(entry.site || common.site || '').trim(),
    siteId: siteId,
    game: String(entry.game || common.game || common.site || '').trim(),
    releaseDate: normalizeKeyDate_(entry.releaseDate || common.releaseDate),
    lifecyclePhase: String(entry.lifecyclePhase || common.lifecyclePhase || '').trim(),
    batchId: String(entry.batchId || common.batchId || '').trim(),
    commitSha: String(entry.commitSha || common.commitSha || '').trim(),
    deploymentUrl: String(entry.deploymentUrl || common.deploymentUrl || '').trim(),
    productionUrl: String(entry.productionUrl || common.productionUrl || '').trim(),
    deployedAt: deployedAt,
    deployedDate: deployDate,
    developmentTaskId: String(entry.developmentTaskId || common.developmentTaskId || '').trim(),
    opportunityId: opportunityId,
    decisionId: decisionId,
    action: action,
    primaryUrl: String(entry.primaryUrl || '').trim(),
    affectedUrls: ledgerStringArray_(entry.affectedUrls),
    triggerType: String(entry.triggerType || '').trim(),
    triggerQueries: ledgerStringArray_(entry.triggerQueries),
    triggerSummary: String(entry.triggerSummary || '').trim(),
    sourceRefs: sourceRefs,
    changeSummary: String(entry.changeSummary || '').trim(),
    reason: String(entry.reason || task.taskReason || '').trim(),
    releaseOffsetDay: ledgerReleaseOffset_(entry.releaseDate || common.releaseDate, deployDate)
  };
}

function ledgerMergeStableValue_(name, receiptValue, taskValue) {
  var a = String(receiptValue || '').trim();
  var b = String(taskValue || '').trim();
  if (a && b && a !== b) throw new Error('recordPublishedBatch: Development Task ' + name + ' conflict: receipt=' + a + ' task=' + b);
  return a || b;
}

function resolveLedgerDevelopmentTask_(taskId) {
  taskId = String(taskId || '').trim();
  if (!taskId) return {};
  var packed = loadLedgerSheetRows_(SHEET_NAMES.DEVELOPMENT_TASKS);
  var map = packed.map;
  var idCol = map['开发任务ID'];
  if (idCol === undefined) throw new Error('recordPublishedBatch: 开发任务 missing header 开发任务ID');
  for (var i = 0; i < packed.rows.length; i++) {
    var row = packed.rows[i];
    if (String(row[idCol] || '').trim() !== taskId) continue;
    return {
      taskId: taskId,
      opportunityId: ledgerCell_(row, map, 'OpportunityID'),
      decisionId: ledgerCell_(row, map, 'DecisionID'),
      siteId: ledgerCell_(row, map, 'SiteID'),
      actionType: ledgerCell_(row, map, 'ActionType'),
      taskReason: ledgerCell_(row, map, 'TaskReason'),
      sourceReference: ledgerCell_(row, map, 'SourceReference')
    };
  }
  throw new Error('recordPublishedBatch: Development Task not found: ' + taskId);
}

function loadLedgerSheetRows_(sheetName) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) return { sheet: null, header: [], map: {}, rows: [] };
  var width = Math.max(1, sheet.getLastColumn());
  var header = sheet.getRange(1, 1, 1, width).getValues()[0];
  var rows = [];
  if (sheet.getLastRow() >= 2) rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  return { sheet: sheet, header: header, map: headerIndexMap_(header), rows: rows };
}

function ledgerCell_(row, map, name) {
  var idx = map[name];
  return idx === undefined ? '' : String(row[idx] || '').trim();
}

function ledgerStringArray_(value) {
  if (Array.isArray(value)) return value.map(function (v) { return String(v || '').trim(); }).filter(Boolean);
  var raw = String(value || '').trim();
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return ledgerStringArray_(parsed);
  } catch (e) {}
  return [raw];
}

function ledgerProductionLocalDate_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  var date = new Date(raw);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function ledgerReleaseOffset_(releaseDate, deployedDate) {
  var release = normalizeKeyDate_(releaseDate);
  var deployed = normalizeKeyDate_(deployedDate);
  if (!release || !deployed) return '';
  return daysBetweenStr_(release, deployed);
}

function ledgerInterventionIds_(contentRows, timelineRows) {
  var ids = {};
  [contentRows, timelineRows].forEach(function (packed) {
    var idx = packed.map.InterventionID;
    if (idx === undefined) return;
    for (var i = 0; i < packed.rows.length; i++) {
      var id = String(packed.rows[i][idx] || '').trim();
      if (id) ids[id] = true;
    }
  });
  return ids;
}

function findLedgerReceiptByKey_(packed, receiptKey) {
  var keyCol = packed.map.ReceiptKey;
  var idCol = packed.map.InterventionID;
  if (keyCol === undefined || idCol === undefined) return null;
  for (var i = 0; i < packed.rows.length; i++) {
    if (String(packed.rows[i][keyCol] || '').trim() === receiptKey) {
      return { rowIndex: i + 2, interventionId: String(packed.rows[i][idCol] || '').trim() };
    }
  }
  return null;
}

function nextLedgerInterventionId_(date, siteId, action, existingIds) {
  var shortAction = String(action || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  var prefix = String(date || todayStr_()) + '-' + String(siteId || '').trim() + '-' + shortAction + '-';
  var max = 0;
  Object.keys(existingIds || {}).forEach(function (id) {
    if (id.indexOf(prefix) !== 0) return;
    var n = Number(id.substring(prefix.length));
    if (!isNaN(n) && n > max) max = n;
  });
  return prefix + ('000' + (max + 1)).slice(-3);
}

function ledgerNormalizePath_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '/';
  raw = raw.replace(/[?#].*$/, '');
  if (/^https?:\/\//i.test(raw)) {
    var match = raw.match(/^https?:\/\/[^/]+(\/.*)?$/i);
    raw = match && match[1] ? match[1] : '/';
  }
  if (raw.charAt(0) !== '/') raw = '/' + raw;
  if (raw.length > 1 && raw.charAt(raw.length - 1) !== '/') raw += '/';
  return raw;
}

function ledgerPageMatches_(row, primaryUrl) {
  var target = ledgerNormalizePath_(primaryUrl);
  return ledgerNormalizePath_(row[2]) === target || ledgerNormalizePath_(row[3]) === target;
}

function computeLedgerWindowMetrics_(ctx) {
  ctx = ctx || {};
  var end = normalizeKeyDate_(ctx.endDate);
  var start = end ? addDaysStr_(end, -6) : '';
  var pageClicks = 0, pageImpressions = 0, pagePositionWeight = 0;
  var siteClicks = 0, siteImpressions = 0;
  var querySet = {};
  var dailyRows = ctx.dailyRows || [];
  var pageRows = ctx.pageRows || [];
  var queryPageRows = ctx.queryPageRows || [];
  for (var i = 0; i < dailyRows.length; i++) {
    var dd = normalizeKeyDate_(dailyRows[i][0]);
    if (String(dailyRows[i][1] || '').trim() !== String(ctx.site || '').trim() || !ledgerInWindow_(dd, start, end)) continue;
    siteClicks += ledgerNumber_(dailyRows[i][2]);
    siteImpressions += ledgerNumber_(dailyRows[i][3]);
  }
  for (var p = 0; p < pageRows.length; p++) {
    var pd = normalizeKeyDate_(pageRows[p][0]);
    if (String(pageRows[p][1] || '').trim() !== String(ctx.site || '').trim() || !ledgerInWindow_(pd, start, end)) continue;
    if (!ledgerPageMatches_(pageRows[p], ctx.primaryUrl)) continue;
    var pi = ledgerNumber_(pageRows[p][5]);
    pageClicks += ledgerNumber_(pageRows[p][4]);
    pageImpressions += pi;
    var pp = ledgerNumber_(pageRows[p][7]);
    if (pi > 0 && pp > 0) pagePositionWeight += pp * pi;
  }
  for (var q = 0; q < queryPageRows.length; q++) {
    var qd = normalizeKeyDate_(queryPageRows[q][0]);
    if (String(queryPageRows[q][1] || '').trim() !== String(ctx.site || '').trim() || !ledgerInWindow_(qd, start, end)) continue;
    if (ledgerPageMatches_([queryPageRows[q][0], queryPageRows[q][1], queryPageRows[q][3], queryPageRows[q][4]], ctx.primaryUrl)) {
      var query = String(queryPageRows[q][2] || '').trim();
      if (query) querySet[query] = true;
    }
  }
  return {
    clicks: pageClicks,
    impressions: pageImpressions,
    ctr: pageImpressions > 0 ? pageClicks / pageImpressions : '',
    position: pagePositionWeight > 0 && pageImpressions > 0 ? pagePositionWeight / pageImpressions : '',
    queryCount: Object.keys(querySet).length,
    siteClicks: siteClicks,
    siteImpressions: siteImpressions,
    start: start,
    end: end
  };
}

function ledgerInWindow_(date, start, end) {
  return !!date && !!start && !!end && date >= start && date <= end;
}

function ledgerNumber_(value) {
  var number = Number(value || 0);
  return isNaN(number) ? 0 : number;
}

function captureLedgerBaseline_(site, primaryUrl, productionUrl, deployedDate) {
  var daily = loadLedgerSheetRows_(SHEET_NAMES.DAILY).rows;
  var pages = loadLedgerSheetRows_(SHEET_NAMES.PAGES).rows;
  var queryPages = loadLedgerSheetRows_(SHEET_NAMES.QUERY_PAGES).rows;
  var end = '';
  for (var i = 0; i < daily.length; i++) {
    if (String(daily[i][1] || '').trim() !== site) continue;
    var d = normalizeKeyDate_(daily[i][0]);
    if (d && d < deployedDate && d > end) end = d;
  }
  if (!end) {
    var fallback = daily.concat(pages).concat(queryPages);
    for (var f = 0; f < fallback.length; f++) {
      if (String(fallback[f][1] || '').trim() !== site) continue;
      var fd = normalizeKeyDate_(fallback[f][0]);
      if (fd && fd < deployedDate && fd > end) end = fd;
    }
  }
  var metrics = computeLedgerWindowMetrics_({
    dailyRows: daily,
    pageRows: pages,
    queryPageRows: queryPages,
    site: site,
    primaryUrl: primaryUrl,
    productionUrl: productionUrl,
    endDate: end
  });
  return {
    dataDate: end,
    clicks: metrics.clicks,
    impressions: metrics.impressions,
    ctr: metrics.ctr,
    position: metrics.position,
    queryCount: metrics.queryCount,
    siteClicks: metrics.siteClicks,
    siteImpressions: metrics.siteImpressions
  };
}

function buildLedgerContentRow_(plan) {
  var fields = {
    '更新时间': plan.deployedDate,
    '站点': plan.site,
    '页面路径': ledgerNormalizePath_(plan.primaryUrl),
    '来源': 'Production Publish Receipt',
    '更新说明': plan.changeSummary,
    '更新类型': plan.action,
    'DecisionID': plan.decisionId,
    'InterventionID': plan.interventionId,
    'SiteID': plan.siteId,
    'BatchID': plan.batchId,
    'Action': plan.action,
    'PrimaryURL': plan.primaryUrl,
    'AffectedURLs': JSON.stringify(plan.affectedUrls),
    'TriggerType': plan.triggerType,
    'TriggerQueries': JSON.stringify(plan.triggerQueries),
    'TriggerSummary': plan.triggerSummary,
    'SourceRefs': JSON.stringify(plan.sourceRefs),
    'Reason': plan.reason,
    'LifecyclePhase': plan.lifecyclePhase,
    'ReleaseDate': plan.releaseDate,
    'ReleaseOffsetDay': plan.releaseOffsetDay,
    'CommitSHA': plan.commitSha,
    'DeploymentURL': plan.deploymentUrl,
    'ProductionURL': plan.productionUrl,
    'ProductionDeployedAt': plan.deployedAt,
    'DevelopmentTaskID': plan.developmentTaskId,
    'OpportunityID': plan.opportunityId,
    'RecordedMode': LEDGER_RECORDED_MODE,
    'BaselineDataDate': plan.baseline.dataDate,
    'BaselinePageClicks7D': plan.baseline.clicks,
    'BaselinePageImpressions7D': plan.baseline.impressions,
    'BaselinePageCTR': plan.baseline.ctr,
    'BaselinePagePosition': plan.baseline.position,
    'BaselinePageQueryCount7D': plan.baseline.queryCount,
    'BaselineSiteClicks7D': plan.baseline.siteClicks,
    'BaselineSiteImpressions7D': plan.baseline.siteImpressions,
    'ReceiptKey': plan.receiptKey,
    'RecordedAt': nowRecordedAt_()
  };
  return fields;
}

function writeLedgerContentReceipt_(plan) {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.CONTENT_UPDATES);
  var fields = buildLedgerContentRow_(plan);
  var row = [];
  for (var h = 0; h < CONTENT_UPDATE_HEADERS.length; h++) row.push(fields[CONTENT_UPDATE_HEADERS[h]] === undefined ? '' : fields[CONTENT_UPDATE_HEADERS[h]]);
  var existing = findLedgerReceiptByKey_(packed, plan.receiptKey);
  if (existing) {
    var current = packed.rows[existing.rowIndex - 2].slice(0, CONTENT_UPDATE_HEADERS.length);
    for (var i = 0; i < CONTENT_UPDATE_HEADERS.length; i++) {
      if (ledgerBlank_(current[i]) && !ledgerBlank_(row[i])) current[i] = row[i];
    }
    packed.sheet.getRange(existing.rowIndex, 1, 1, CONTENT_UPDATE_HEADERS.length).setValues([current]);
    return { action: 'update', rowIndex: existing.rowIndex };
  }
  packed.sheet.appendRow(row);
  return { action: 'insert', rowIndex: packed.sheet.getLastRow() };
}

function ledgerBlank_(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function writeLedgerObservationRows_(plan) {
  var data = ledgerObservationDataContext_();
  for (var i = 0; i < LEDGER_OBSERVATION_HORIZONS.length; i++) {
    var observation = buildLedgerObservation_(plan, LEDGER_OBSERVATION_HORIZONS[i], data);
    upsertLedgerObservation_(observation);
  }
}

function ledgerObservationDataContext_() {
  var daily = loadLedgerSheetRows_(SHEET_NAMES.DAILY).rows;
  var latestBySite = {};
  for (var i = 0; i < daily.length; i++) {
    var site = String(daily[i][1] || '').trim();
    var date = normalizeKeyDate_(daily[i][0]);
    if (site && date && (!latestBySite[site] || date > latestBySite[site])) latestBySite[site] = date;
  }
  return {
    dailyRows: daily,
    pageRows: loadLedgerSheetRows_(SHEET_NAMES.PAGES).rows,
    queryPageRows: loadLedgerSheetRows_(SHEET_NAMES.QUERY_PAGES).rows,
    latestBySite: latestBySite
  };
}

function buildLedgerObservation_(plan, horizon, data) {
  var target = addDaysStr_(plan.deployedDate, horizon.days);
  var latest = data.latestBySite[plan.site] || '';
  var mature = latest && latest >= target;
  var metrics = mature ? computeLedgerWindowMetrics_({
    dailyRows: data.dailyRows,
    pageRows: data.pageRows,
    queryPageRows: data.queryPageRows,
    site: plan.site,
    primaryUrl: plan.primaryUrl,
    productionUrl: plan.productionUrl,
    endDate: target
  }) : null;
  var baseline = plan.baseline || {};
  var observed = metrics || {};
  var status = mature ? 'OBSERVED' : 'PENDING_DATA';
  return {
    ObservationID: plan.interventionId + '|' + horizon.name,
    InterventionID: plan.interventionId,
    DecisionID: plan.decisionId,
    SiteID: plan.siteId,
    Site: plan.site,
    PrimaryURL: plan.primaryUrl,
    Horizon: horizon.name,
    TargetDate: target,
    ObservedDataDate: mature ? target : '',
    Status: status,
    BaselineDataDate: baseline.dataDate || '',
    BaselineClicks7D: baseline.clicks === undefined ? '' : baseline.clicks,
    BaselineImpressions7D: baseline.impressions === undefined ? '' : baseline.impressions,
    BaselineCTR: baseline.ctr === undefined ? '' : baseline.ctr,
    BaselinePosition: baseline.position === undefined ? '' : baseline.position,
    BaselineQueryCount7D: baseline.queryCount === undefined ? '' : baseline.queryCount,
    ObservedClicks7D: mature ? observed.clicks : '',
    ObservedImpressions7D: mature ? observed.impressions : '',
    ObservedCTR: mature ? observed.ctr : '',
    ObservedPosition: mature ? observed.position : '',
    ObservedQueryCount7D: mature ? observed.queryCount : '',
    ClicksDelta: mature ? ledgerDelta_(baseline.clicks, observed.clicks) : '',
    ImpressionsDelta: mature ? ledgerDelta_(baseline.impressions, observed.impressions) : '',
    CTRDelta: mature ? ledgerDelta_(baseline.ctr, observed.ctr) : '',
    PositionImprovement: mature ? ledgerDelta_(baseline.position, observed.position) : '',
    QueryCountDelta: mature ? ledgerDelta_(baseline.queryCount, observed.queryCount) : '',
    BaselineSiteImpressions7D: baseline.siteImpressions === undefined ? '' : baseline.siteImpressions,
    ObservedSiteImpressions7D: mature ? observed.siteImpressions : '',
    AttributionMode: plan.decisionId ? 'FORMAL_DECISION_LINKED' : 'OBSERVATIONAL_ONLY',
    UpdatedAt: nowRecordedAt_()
  };
}

function ledgerDelta_(baseline, observed) {
  if (ledgerBlank_(baseline) || ledgerBlank_(observed)) return '';
  return Number(observed) - Number(baseline);
}

function upsertLedgerObservation_(observation) {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_OBSERVATIONS);
  var idCol = packed.map.ObservationID;
  var row = INTERVENTION_OBSERVATION_HEADERS.map(function (header) {
    return observation[header] === undefined ? '' : observation[header];
  });
  if (idCol !== undefined) {
    for (var i = 0; i < packed.rows.length; i++) {
      if (String(packed.rows[i][idCol] || '').trim() === observation.ObservationID) {
        packed.sheet.getRange(i + 2, 1, 1, INTERVENTION_OBSERVATION_HEADERS.length).setValues([row]);
        return { action: 'update', rowIndex: i + 2 };
      }
    }
  }
  packed.sheet.appendRow(row);
  return { action: 'insert', rowIndex: packed.sheet.getLastRow() };
}

function loadRealtimeLedgerInterventions_() {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.CONTENT_UPDATES);
  var out = [];
  var idCol = packed.map.InterventionID;
  if (idCol === undefined) return out;
  for (var i = 0; i < packed.rows.length; i++) {
    var row = packed.rows[i];
    var id = String(row[idCol] || '').trim();
    if (!id) continue;
    var mode = ledgerCell_(row, packed.map, 'RecordedMode');
    if (mode && mode !== LEDGER_RECORDED_MODE) continue;
    out.push(ledgerPlanFromContentRow_(row, packed.map));
  }
  return out;
}

function ledgerPlanFromContentRow_(row, map) {
  var baseline = {
    dataDate: ledgerCell_(row, map, 'BaselineDataDate'),
    clicks: ledgerValue_(row, map, 'BaselinePageClicks7D'),
    impressions: ledgerValue_(row, map, 'BaselinePageImpressions7D'),
    ctr: ledgerValue_(row, map, 'BaselinePageCTR'),
    position: ledgerValue_(row, map, 'BaselinePagePosition'),
    queryCount: ledgerValue_(row, map, 'BaselinePageQueryCount7D'),
    siteClicks: ledgerValue_(row, map, 'BaselineSiteClicks7D'),
    siteImpressions: ledgerValue_(row, map, 'BaselineSiteImpressions7D')
  };
  return {
    interventionId: ledgerCell_(row, map, 'InterventionID'),
    site: ledgerCell_(row, map, '站点'),
    siteId: ledgerCell_(row, map, 'SiteID'),
    batchId: ledgerCell_(row, map, 'BatchID'),
    decisionId: ledgerCell_(row, map, 'DecisionID'),
    action: ledgerCell_(row, map, 'Action') || ledgerCell_(row, map, '更新类型'),
    primaryUrl: ledgerCell_(row, map, 'PrimaryURL') || ledgerCell_(row, map, '页面路径'),
    affectedUrls: ledgerStringArray_(ledgerCell_(row, map, 'AffectedURLs')),
    triggerSummary: ledgerCell_(row, map, 'TriggerSummary'),
    triggerType: ledgerCell_(row, map, 'TriggerType'),
    triggerQueries: ledgerStringArray_(ledgerCell_(row, map, 'TriggerQueries')),
    sourceRefs: ledgerStringArray_(ledgerCell_(row, map, 'SourceRefs')),
    reason: ledgerCell_(row, map, 'Reason'),
    changeSummary: ledgerCell_(row, map, '更新说明'),
    lifecyclePhase: ledgerCell_(row, map, 'LifecyclePhase'),
    developmentTaskId: ledgerCell_(row, map, 'DevelopmentTaskID'),
    opportunityId: ledgerCell_(row, map, 'OpportunityID'),
    commitSha: ledgerCell_(row, map, 'CommitSHA'),
    deploymentUrl: ledgerCell_(row, map, 'DeploymentURL'),
    productionUrl: ledgerCell_(row, map, 'ProductionURL'),
    deployedAt: ledgerCell_(row, map, 'ProductionDeployedAt'),
    deployedDate: ledgerProductionLocalDate_(ledgerCell_(row, map, 'ProductionDeployedAt')),
    releaseDate: ledgerCell_(row, map, 'ReleaseDate'),
    releaseOffsetDay: ledgerValue_(row, map, 'ReleaseOffsetDay'),
    baseline: baseline
  };
}

function ledgerValue_(row, map, name) {
  var idx = map[name];
  return idx === undefined ? '' : row[idx];
}

function refreshInterventionObservations_() {
  ensureSheet_(SHEET_NAMES.INTERVENTION_OBSERVATIONS, INTERVENTION_OBSERVATION_HEADERS);
  var plans = loadRealtimeLedgerInterventions_();
  var data = ledgerObservationDataContext_();
  var updated = 0;
  for (var i = 0; i < plans.length; i++) {
    if (!plans[i].deployedDate) continue;
    for (var h = 0; h < LEDGER_OBSERVATION_HORIZONS.length; h++) {
      upsertLedgerObservation_(buildLedgerObservation_(plans[i], LEDGER_OBSERVATION_HORIZONS[h], data));
      updated++;
    }
  }
  return { interventions: plans.length, observations: updated };
}

function ledgerConfounders_(plan, allPlans) {
  var flags = [];
  var offset = Number(plan.releaseOffsetDay);
  if (!isNaN(offset) && Math.abs(offset) <= 3) flags.push('RELEASE_WINDOW');
  var count = 0;
  for (var i = 0; i < allPlans.length; i++) {
    if (allPlans[i].site === plan.site && allPlans[i].deployedDate === plan.deployedDate) count++;
  }
  if (count > 1) flags.push('SAME_DAY_MULTIPLE_INTERVENTIONS');
  if (plan.action === 'CREATE_PAGE' && Number(plan.baseline.impressions || 0) === 0) flags.push('NEW_PAGE_NO_PRE_BASELINE');
  return flags.join(', ');
}

function buildLedgerTimelineRow_(plan, observations, allPlans) {
  var mature = null;
  var pending = null;
  for (var i = 0; i < observations.length; i++) {
    if (observations[i].Status === 'OBSERVED') mature = observations[i];
    else if (!pending) pending = observations[i];
  }
  var shown = mature || pending;
  var next = '';
  for (var n = 0; n < observations.length; n++) {
    if (observations[n].Status !== 'OBSERVED') { next = observations[n].TargetDate; break; }
  }
  var evidence = 'BaselineDataDate=' + (plan.baseline.dataDate || '') +
    '; PageClicks7D=' + (plan.baseline.clicks === undefined ? '' : plan.baseline.clicks) +
    '; PageImpressions7D=' + (plan.baseline.impressions === undefined ? '' : plan.baseline.impressions) +
    '; PageCTR=' + (plan.baseline.ctr === undefined ? '' : plan.baseline.ctr) +
    '; PagePosition=' + (plan.baseline.position === undefined ? '' : plan.baseline.position) +
    '; QueryCount7D=' + (plan.baseline.queryCount === undefined ? '' : plan.baseline.queryCount);
  var change = shown && shown.Status === 'OBSERVED'
    ? shown.Horizon + ': clicks=' + shown.ObservedClicks7D +
      ', impressions=' + shown.ObservedImpressions7D +
      ', ctr=' + shown.ObservedCTR +
      ', position=' + shown.ObservedPosition +
      ', queryCount=' + shown.ObservedQueryCount7D
    : 'PENDING';
  var target = [plan.primaryUrl].concat(plan.affectedUrls || []).filter(function (v, idx, arr) { return v && arr.indexOf(v) === idx; });
  var timelineDecision = plan.decisionId ? 'FORMAL_DECISION_LINKED' : 'OBSERVATIONAL_ONLY';
  return [
    plan.interventionId,
    plan.deployedAt,
    plan.releaseOffsetDay === '' ? '' : 'D' + (Number(plan.releaseOffsetDay) >= 0 ? '+' : '') + Number(plan.releaseOffsetDay),
    plan.lifecyclePhase || '',
    plan.batchId || '',
    plan.action || '',
    JSON.stringify(target),
    JSON.stringify({ type: plan.triggerType || '', queries: plan.triggerQueries || [], summary: plan.triggerSummary || '' }),
    evidence,
    plan.commitSha || '',
    JSON.stringify(plan.sourceRefs || []),
    shown ? shown.Horizon : 'PENDING',
    change,
    timelineDecision,
    shown && shown.Status === 'OBSERVED' ? 'OBSERVED' : 'PENDING',
    plan.decisionId || '',
    LEDGER_TIMELINE_STATUS,
    ledgerConfounders_(plan, allPlans),
    next,
    (plan.changeSummary || '') + (plan.reason ? ' | ' + plan.reason : '')
  ];
}

function writeLedgerTimelineRow_(plan) {
  var observations = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_OBSERVATIONS).rows;
  var map = headerIndexMap_(INTERVENTION_OBSERVATION_HEADERS);
  var selected = [];
  for (var i = 0; i < observations.length; i++) {
    if (String(observations[i][map.InterventionID] || '').trim() === plan.interventionId) {
      selected.push(ledgerObservationObject_(observations[i], map));
    }
  }
  var row = buildLedgerTimelineRow_(plan, selected, loadRealtimeLedgerInterventions_());
  upsertLedgerTimelineRow_(row);
}

function ledgerObservationObject_(row, map) {
  var out = {};
  INTERVENTION_OBSERVATION_HEADERS.forEach(function (header) { out[header] = row[map[header]]; });
  return out;
}

function upsertLedgerTimelineRow_(row) {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_TIMELINE);
  var idCol = packed.map.InterventionID;
  if (idCol !== undefined) {
    for (var i = 0; i < packed.rows.length; i++) {
      var existingId = String(packed.rows[i][idCol] || '').trim();
      if (existingId === String(row[0] || '').trim() && existingId.indexOf('retro-') !== 0) {
        packed.sheet.getRange(i + 2, 1, 1, INTERVENTION_TIMELINE_HEADERS.length).setValues([row]);
        return { action: 'update', rowIndex: i + 2 };
      }
    }
  }
  packed.sheet.appendRow(row);
  return { action: 'insert', rowIndex: packed.sheet.getLastRow() };
}

function refreshExperimentTimeline_() {
  ensureSheet_(SHEET_NAMES.INTERVENTION_TIMELINE, INTERVENTION_TIMELINE_HEADERS);
  var plans = loadRealtimeLedgerInterventions_();
  var packed = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_OBSERVATIONS);
  var map = packed.map;
  var updated = 0;
  for (var i = 0; i < plans.length; i++) {
    var observations = [];
    for (var j = 0; j < packed.rows.length; j++) {
      if (String(packed.rows[j][map.InterventionID] || '').trim() === plans[i].interventionId) {
        observations.push(ledgerObservationObject_(packed.rows[j], map));
      }
    }
    upsertLedgerTimelineRow_(buildLedgerTimelineRow_(plans[i], observations, plans));
    updated++;
  }
  return { interventions: plans.length, timelineRows: updated };
}

function maintainExperimentLedger_() {
  var observationResult = refreshInterventionObservations_();
  var timelineResult = refreshExperimentTimeline_();
  return { observations: observationResult, timeline: timelineResult };
}

/** Independent manual/debug entry point. */
function runExperimentLedgerMaintenance() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('runExperimentLedgerMaintenance: lock busy');
  try {
    setupSheets();
    var result = maintainExperimentLedger_();
    writeLog_('INFO', '', 'runExperimentLedgerMaintenance completed ' + JSON.stringify(result));
    return result;
  } catch (e) {
    writeLog_('WARN', '', 'runExperimentLedgerMaintenance failed: ' + (e.message || e));
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function compactLedgerResult_(plan, status) {
  return {
    interventionId: plan.interventionId,
    receiptKey: plan.receiptKey,
    baselineDataDate: plan.baseline.dataDate || '',
    timelineStatus: status === 'PREVIEW' ? 'PREVIEW' : 'RECORDED'
  };
}
