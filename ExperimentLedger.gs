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
var DEPLOYMENT_RECEIPT_SCHEMA_VERSION = 'deployment-receipt-v1';
var DEPLOYMENT_RECEIPT_TOKEN_PROP = 'DEPLOYMENT_RECEIPT_TOKEN_V1';
var LEDGER_RECORDED_MODE = 'REALTIME';
var DEPLOYMENT_RECEIPT_RECORDED_MODE = 'RECEIPT_AUTO';
var LEDGER_TIMELINE_STATUS = 'REALTIME_AUTOMATED';
var LEDGER_OBSERVATION_HORIZONS = [
  { name: 'D7', days: 7 },
  { name: 'D14', days: 14 },
  { name: 'D30', days: 30 }
];
var DEPLOYMENT_OBSERVATION_HORIZONS = [
  { name: 'D1', days: 1 },
  { name: 'D3', days: 3 },
  { name: 'D7', days: 7 },
  { name: 'D14', days: 14 }
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
  ensureLedgerHeader_(SHEET_NAMES.INTERVENTION_OBSERVATIONS, INTERVENTION_OBSERVATION_HEADERS);
  ensureSheet_(SHEET_NAMES.INTERVENTION_TIMELINE, INTERVENTION_TIMELINE_HEADERS);
  ensureLedgerHeader_(SHEET_NAMES.INTERVENTION_TIMELINE, INTERVENTION_TIMELINE_HEADERS);

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

function deploymentDistinctWindowDates_(rows, site, primaryUrl, endDate, queryPageRows) {
  var dates = {};
  var startDate = addDaysStr_(endDate, -6);
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var date = normalizeKeyDate_(row[0]);
    if (String(row[1] || '').trim() !== String(site || '').trim() ||
        !ledgerInWindow_(date, startDate, endDate)) continue;
    var matches = queryPageRows
      ? ledgerPageMatches_([row[0], row[1], row[3], row[4]], primaryUrl)
      : ledgerPageMatches_(row, primaryUrl);
    if (matches) dates[date] = true;
  }
  return dates;
}

function deploymentHasSevenDayCoverage_(rows, site, primaryUrl, endDate, queryPageRows) {
  return Object.keys(deploymentDistinctWindowDates_(rows, site, primaryUrl, endDate, queryPageRows)).length === 7;
}

function deploymentSiteHasSevenDayCoverage_(rows, site, endDate) {
  var dates = {};
  var startDate = addDaysStr_(endDate, -6);
  for (var i = 0; i < rows.length; i++) {
    var date = normalizeKeyDate_(rows[i][0]);
    if (String(rows[i][1] || '').trim() === String(site || '').trim() &&
        ledgerInWindow_(date, startDate, endDate)) dates[date] = true;
  }
  return Object.keys(dates).length === 7;
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
  var today = typeof todayStr_ === 'function' ? todayStr_() : target;
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
  var status = today < target ? 'WAITING_HORIZON' : (mature ? 'OBSERVED' : 'WAITING_DATA');
  var outcome = mature ? classifyDeploymentOutcome_(horizon.name, baseline, observed) : '';
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
    PositionImprovement: mature ? ledgerPositionImprovement_(baseline.position, observed.position) : '',
    QueryCountDelta: mature ? ledgerDelta_(baseline.queryCount, observed.queryCount) : '',
    BaselineSiteImpressions7D: baseline.siteImpressions === undefined ? '' : baseline.siteImpressions,
    ObservedSiteImpressions7D: mature ? observed.siteImpressions : '',
    BaselineMode: baseline.mode || '',
    AttributionMode: plan.decisionId ? 'FORMAL_DECISION_LINKED' : 'OBSERVATIONAL_ONLY',
    Outcome: outcome,
    OutcomeConfidence: mature ? deploymentOutcomeConfidence_(outcome, baseline, observed) : '',
    Confounders: mature ? deploymentConfounders_(plan, baseline, observed, mature) : '',
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
  var receiptResult = reconcileInterventionPipeline();
  var receiptTimeline = refreshDeploymentTimelines_();
  return { observations: observationResult, timeline: timelineResult,
    receipt: receiptResult, receiptTimeline: receiptTimeline };
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

// ---------------------------------------------------------------------------
// Deployment Receipt V1
// ---------------------------------------------------------------------------

/** Public, transport-independent receipt entry point. */
function ingestDeploymentReceipt(receipt) {
  var normalized = normalizeDeploymentReceipt_(receipt);
  validateDeploymentReceipt_(normalized);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('ingestDeploymentReceipt: write lock busy');
  try {
    return ingestDeploymentReceipt_(normalized);
  } finally {
    lock.releaseLock();
  }
}

function normalizeDeploymentReceipt_(input) {
  var receipt = input;
  if (typeof receipt === 'string') {
    try { receipt = JSON.parse(receipt); } catch (e) {
      throw new Error('ingestDeploymentReceipt: payload is not valid JSON');
    }
  }
  receipt = receipt || {};
  var pages = receipt.affectedPages || receipt.affected_pages || [];
  if (!Array.isArray(pages)) pages = [pages];
  var normalizedPages = [];
  for (var i = 0; i < pages.length; i++) {
    var page = pages[i] || {};
    normalizedPages.push({
      path: ledgerNormalizePath_(page.path || page.pagePath || page.primaryURL || page.primaryUrl),
      action: String(page.action || receipt.action || '').trim().toUpperCase(),
      primaryURL: String(page.primaryURL || page.primaryUrl || page.url || '').trim(),
      triggerType: String(page.triggerType || '').trim(),
      triggerQueries: ledgerStringArray_(page.triggerQueries || page.trigger_queries),
      triggerSummary: String(page.triggerSummary || '').trim(),
      sourceRefs: ledgerStringArray_(page.sourceRefs || page.source_refs),
      reason: String(page.reason || '').trim()
    });
  }
  var deployedAt = String(
    receipt.productionDeployedAt || receipt.deployedAt || receipt.production_deployed_at || ''
  ).trim();
  var releaseDate = normalizeKeyDate_(receipt.releaseDate || receipt.release_date);
  var deployDate = ledgerProductionLocalDate_(deployedAt);
  var offset = receipt.releaseOffsetDay;
  if ((offset === undefined || offset === null || offset === '') && releaseDate && deployDate) {
    offset = ledgerReleaseOffset_(releaseDate, deployDate);
  }
  return {
    schemaVersion: String(receipt.schemaVersion || '').trim(),
    receiptKey: String(receipt.receiptKey || receipt.receipt_key || '').trim(),
    interventionId: String(receipt.interventionId || receipt.intervention_id || '').trim(),
    goalId: String(receipt.goalId || receipt.goal_id || '').trim(),
    siteId: String(receipt.siteId || receipt.site_id || '').trim(),
    siteName: String(receipt.siteName || receipt.site || '').trim(),
    batchId: String(receipt.batchId || receipt.batch_id || '').trim(),
    decisionId: String(receipt.decisionId || receipt.decision_id || '').trim(),
    productionDeployedAt: deployedAt,
    commitSHA: String(receipt.commitSHA || receipt.commitSha || receipt.commit_sha || '').trim(),
    deploymentURL: String(receipt.deploymentURL || receipt.deploymentUrl || '').trim(),
    productionURL: String(receipt.productionURL || receipt.productionUrl || '').trim(),
    releaseDate: releaseDate,
    releaseOffsetDay: offset === '' || offset === undefined ? '' : Number(offset),
    lifecyclePhase: String(receipt.lifecyclePhase || receipt.lifecycle_phase || '').trim(),
    action: String(receipt.action || '').trim().toUpperCase(),
    affectedPages: normalizedPages,
    contentProvider: String(receipt.contentProvider || receipt.content_provider || '').trim(),
    contentModel: String(receipt.contentModel || receipt.content_model || '').trim(),
    generationCalls: receipt.generationCalls == null ? '' : receipt.generationCalls,
    generationCost: receipt.generationCost == null ? '' : receipt.generationCost
  };
}

function validateDeploymentReceipt_(receipt) {
  if (receipt.schemaVersion !== DEPLOYMENT_RECEIPT_SCHEMA_VERSION) {
    throw new Error('ingestDeploymentReceipt: schemaVersion mismatch');
  }
  var required = [
    'receiptKey', 'siteId', 'siteName', 'batchId', 'commitSHA',
    'deploymentURL', 'productionURL', 'productionDeployedAt', 'action'
  ];
  for (var i = 0; i < required.length; i++) {
    if (!String(receipt[required[i]] || '').trim()) {
      throw new Error('ingestDeploymentReceipt: missing ' + required[i]);
    }
  }
  if (!ledgerProductionLocalDate_(receipt.productionDeployedAt)) {
    throw new Error('ingestDeploymentReceipt: invalid productionDeployedAt');
  }
  if (!Array.isArray(receipt.affectedPages) || !receipt.affectedPages.length) {
    throw new Error('ingestDeploymentReceipt: affectedPages must be non-empty');
  }
  for (var p = 0; p < receipt.affectedPages.length; p++) {
    var page = receipt.affectedPages[p];
    if (!page.path || !page.primaryURL || !page.action) {
      throw new Error('ingestDeploymentReceipt: affectedPages[' + p + '] is incomplete');
    }
  }
  return true;
}

function isDeploymentReceipt_(body) {
  return !!(body && (
    String(body.schemaVersion || '').trim() === DEPLOYMENT_RECEIPT_SCHEMA_VERSION ||
    String(body.receiptKey || '').trim() ||
    body.affectedPages || body.affected_pages
  ));
}

function productionReceiptCompletionStatus_(productionPassed, receiptResult) {
  if (!productionPassed) return 'NOT_PRODUCTION_PASS';
  return receiptResult && (
    receiptResult.result === 'ACCEPTED' || receiptResult.result === 'DUPLICATE_ACCEPTED'
  ) ? 'PASS' : 'PRODUCTION_PASS_RECEIPT_PENDING';
}

function checkDeploymentReceiptToken_(e, body) {
  var expected = PropertiesService.getScriptProperties().getProperty(DEPLOYMENT_RECEIPT_TOKEN_PROP);
  if (!expected) return false;
  var provided = body && (body.token || body.authToken || body.auth_token);
  if (!provided && e && e.parameter) provided = e.parameter.token;
  return String(provided || '').trim() !== '' && String(provided).trim() === expected;
}

/** Rotate only through an authenticated Apps Script execution path. */
function rotateDeploymentReceiptToken(token) {
  token = String(token || '').trim();
  if (!token) return { ok: false, error: 'empty_token' };
  PropertiesService.getScriptProperties().setProperty(DEPLOYMENT_RECEIPT_TOKEN_PROP, token);
  return { ok: true, key: DEPLOYMENT_RECEIPT_TOKEN_PROP };
}

function ingestDeploymentReceipt_(receipt) {
  ensureSheet_(SHEET_NAMES.CONTENT_UPDATES, CONTENT_UPDATE_HEADERS);
  ensureContentUpdateHeader_();
  ensureSheet_(SHEET_NAMES.INTERVENTION_OBSERVATIONS, INTERVENTION_OBSERVATION_HEADERS);
  ensureLedgerHeader_(SHEET_NAMES.INTERVENTION_OBSERVATIONS, INTERVENTION_OBSERVATION_HEADERS);
  ensureSheet_(SHEET_NAMES.INTERVENTION_TIMELINE, INTERVENTION_TIMELINE_HEADERS);
  ensureLedgerHeader_(SHEET_NAMES.INTERVENTION_TIMELINE, INTERVENTION_TIMELINE_HEADERS);
  validateDeploymentReceiptSite_(receipt);
  var historyIds = loadDecisionIdSetFromHistory_();
  if (receipt.decisionId && !historyIds[receipt.decisionId]) {
    throw new Error('ingestDeploymentReceipt: DecisionID does not exist in 决策历史');
  }

  var existing = findDeploymentReceiptIdentity_(receipt);
  var interventionId = receipt.interventionId ||
    (existing && existing.interventionId) || ('receipt-' + receipt.receiptKey);
  var plan = buildDeploymentReceiptPlan_(receipt, interventionId);
  var contentRows = 0;
  var duplicatePages = 0;
  for (var i = 0; i < plan.pages.length; i++) {
    var result = upsertDeploymentContentPage_(plan, plan.pages[i]);
    if (result.duplicate) duplicatePages++;
    contentRows++;
  }
  var timelineInserted = upsertDeploymentTimelineIfMissing_(plan);
  var observationRows = upsertDeploymentObservations_(plan);
  var duplicate = !!existing && duplicatePages === plan.pages.length && !timelineInserted && !observationRows.inserted;
  writeLog_('INFO', receipt.siteName, 'receipt=' + receipt.receiptKey + ' siteId=' + receipt.siteId + ' result=' +
    (duplicate ? 'DUPLICATE_ACCEPTED' : 'ACCEPTED'));
  return {
    ok: true,
    result: duplicate ? 'DUPLICATE_ACCEPTED' : 'ACCEPTED',
    receiptKey: receipt.receiptKey,
    interventionId: interventionId,
    contentUpdates: contentRows,
    observations: observationRows.count,
    baselineDataDate: plan.pages.length && plan.pages[0].baseline
      ? (plan.pages[0].baseline.dataDate || '')
      : ''
  };
}

function validateDeploymentReceiptSite_(receipt) {
  if (typeof getSpreadsheet_ !== 'function') return true;
  var ss = getSpreadsheet_();
  var sheet = ss && sheetByName_(ss, SHEET_NAMES.SITES);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('ingestDeploymentReceipt: unknown SiteID');
  var width = Math.max(sheet.getLastColumn(), SITE_HEADERS.length);
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  var idCol = headers.indexOf('site_id');
  var nameCol = headers.indexOf('站点名称');
  if (idCol < 0 || nameCol < 0) throw new Error('ingestDeploymentReceipt: site identity columns missing');
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][idCol] || '').trim() !== receipt.siteId) continue;
    if (String(rows[i][nameCol] || '').trim() !== receipt.siteName) {
      throw new Error('ingestDeploymentReceipt: SiteID/siteName mismatch');
    }
    return true;
  }
  throw new Error('ingestDeploymentReceipt: unknown SiteID');
}

function sheetByName_(ss, name) {
  return ss && typeof ss.getSheetByName === 'function' ? ss.getSheetByName(name) : null;
}

function ensureLedgerHeader_(sheetName, headers) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) return;
  var width = Math.max(sheet.getLastColumn() || 1, headers.length);
  ensureSheetGrid_(sheet, 1, width);
  var existing = sheet.getRange(1, 1, 1, width).getValues()[0];
  var known = headerIndexMap_(existing);
  var missing = [];
  for (var i = 0; i < headers.length; i++) {
    if (known[headers[i]] === undefined) missing.push(headers[i]);
  }
  if (!missing.length) return;
  var start = width + 1;
  while (start > 1 && !String(existing[start - 2] || '').trim()) start--;
  ensureSheetGrid_(sheet, 1, start + missing.length - 1);
  sheet.getRange(1, start, 1, missing.length).setValues([missing]);
}

function findDeploymentReceiptIdentity_(receipt) {
  var content = loadLedgerSheetRows_(SHEET_NAMES.CONTENT_UPDATES);
  var timeline = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_TIMELINE);
  var receiptCol = content.map.ReceiptKey;
  var interventionCol = content.map.InterventionID;
  for (var i = 0; i < content.rows.length; i++) {
    var rowReceipt = receiptCol === undefined ? '' : String(content.rows[i][receiptCol] || '').trim();
    var rowIntervention = interventionCol === undefined ? '' : String(content.rows[i][interventionCol] || '').trim();
    if ((rowReceipt && rowReceipt === receipt.receiptKey) ||
        (receipt.interventionId && rowIntervention === receipt.interventionId)) {
      return { interventionId: rowIntervention, rowIndex: i + 2 };
    }
  }
  var timelineIdCol = timeline.map.InterventionID;
  if (timelineIdCol !== undefined) {
    for (var t = 0; t < timeline.rows.length; t++) {
      var id = String(timeline.rows[t][timelineIdCol] || '').trim();
      if (id && receipt.interventionId && id === receipt.interventionId) return { interventionId: id };
    }
  }
  return null;
}

function buildDeploymentReceiptPlan_(receipt, interventionId) {
  var deployedDate = ledgerProductionLocalDate_(receipt.productionDeployedAt);
  var pages = [];
  for (var i = 0; i < receipt.affectedPages.length; i++) {
    var page = receipt.affectedPages[i];
    var baseline = captureDeploymentBaseline_(
      receipt.siteName, page.path, receipt.productionURL, deployedDate, '', page.action || receipt.action
    );
    pages.push({
      path: page.path,
      action: page.action || receipt.action,
      primaryURL: page.primaryURL,
      triggerType: page.triggerType,
      triggerQueries: page.triggerQueries,
      triggerSummary: page.triggerSummary,
      sourceRefs: page.sourceRefs,
      reason: page.reason,
      baseline: baseline,
      pageReceiptKey: receipt.receiptKey + '|' + page.path
    });
  }
  return {
    receiptKey: receipt.receiptKey,
    interventionId: interventionId,
    goalId: receipt.goalId,
    siteId: receipt.siteId,
    site: receipt.siteName,
    siteName: receipt.siteName,
    batchId: receipt.batchId,
    decisionId: receipt.decisionId,
    deployedAt: receipt.productionDeployedAt,
    deployedDate: deployedDate,
    commitSha: receipt.commitSHA,
    deploymentUrl: receipt.deploymentURL,
    productionUrl: receipt.productionURL,
    releaseDate: receipt.releaseDate,
    releaseOffsetDay: receipt.releaseOffsetDay,
    lifecyclePhase: receipt.lifecyclePhase,
    action: receipt.action,
    contentProvider: receipt.contentProvider,
    contentModel: receipt.contentModel,
    generationCalls: receipt.generationCalls,
    generationCost: receipt.generationCost,
    pages: pages,
    affectedUrls: pages.map(function (p) { return p.primaryURL; })
  };
}

function captureDeploymentBaseline_(site, primaryUrl, productionUrl, deployedDate, baselineDataDate, action) {
  var requestedEnd = normalizeKeyDate_(baselineDataDate);
  var baseline = captureLedgerBaseline_(site, primaryUrl, productionUrl, deployedDate);
  var end = requestedEnd && requestedEnd < deployedDate
    ? requestedEnd
    : baseline.dataDate;
  if (end && end !== baseline.dataDate) {
    var daily = loadLedgerSheetRows_(SHEET_NAMES.DAILY).rows;
    var pagesForMetrics = loadLedgerSheetRows_(SHEET_NAMES.PAGES).rows;
    var queryPagesForMetrics = loadLedgerSheetRows_(SHEET_NAMES.QUERY_PAGES).rows;
    var metrics = computeLedgerWindowMetrics_({
      dailyRows: daily,
      pageRows: pagesForMetrics,
      queryPageRows: queryPagesForMetrics,
      site: site,
      primaryUrl: primaryUrl,
      productionUrl: productionUrl,
      endDate: end
    });
    baseline.dataDate = end;
    baseline.clicks = metrics.clicks;
    baseline.impressions = metrics.impressions;
    baseline.ctr = metrics.ctr;
    baseline.position = metrics.position;
    baseline.queryCount = metrics.queryCount;
    baseline.siteClicks = metrics.siteClicks;
    baseline.siteImpressions = metrics.siteImpressions;
  }
  var dailyRows = loadLedgerSheetRows_(SHEET_NAMES.DAILY).rows;
  var pages = loadLedgerSheetRows_(SHEET_NAMES.PAGES).rows;
  var queryPages = loadLedgerSheetRows_(SHEET_NAMES.QUERY_PAGES).rows;
  var hasPageTraffic = false;
  var hasAnyPageEvidence = false;
  var target = ledgerNormalizePath_(primaryUrl);
  for (var i = 0; i < pages.length; i++) {
    var pageDate = normalizeKeyDate_(pages[i][0]);
    if (String(pages[i][1] || '').trim() === site && pageDate && pageDate < deployedDate &&
        ledgerPageMatches_(pages[i], target)) {
      hasPageTraffic = true;
      hasAnyPageEvidence = true;
      break;
    }
  }
  if (!hasAnyPageEvidence) {
    for (var q = 0; q < queryPages.length; q++) {
      var queryDate = normalizeKeyDate_(queryPages[q][0]);
      if (String(queryPages[q][1] || '').trim() === site && queryDate && queryDate < deployedDate &&
          ledgerPageMatches_([queryPages[q][0], queryPages[q][1], queryPages[q][3], queryPages[q][4]], target)) {
        hasAnyPageEvidence = true;
        break;
      }
    }
  }
  if (!hasAnyPageEvidence && String(action || '').trim().toUpperCase() === 'CREATE_PAGE') {
    baseline.clicks = 0;
    baseline.impressions = 0;
    baseline.ctr = '';
    baseline.position = '';
    baseline.queryCount = 0;
    baseline.mode = 'NEW_URL_BASELINE';
  } else if (!hasAnyPageEvidence) {
    baseline.clicks = 0;
    baseline.impressions = 0;
    baseline.ctr = '';
    baseline.position = '';
    baseline.queryCount = 0;
    baseline.mode = 'EXISTING_URL_NO_GSC_TRAFFIC';
  } else if (hasPageTraffic && deploymentHasSevenDayCoverage_(pages, site, target, end, false)) {
    baseline.mode = 'EXISTING_URL_BASELINE';
  } else {
    baseline.clicks = '';
    baseline.impressions = '';
    baseline.ctr = '';
    baseline.position = '';
    baseline.queryCount = '';
    baseline.mode = 'BASELINE_UNKNOWN';
  }
  if (end && !deploymentSiteHasSevenDayCoverage_(dailyRows, site, end)) {
    baseline.siteClicks = '';
    baseline.siteImpressions = '';
  }
  return baseline;
}

function deploymentBaselineComplete_(baseline) {
  baseline = baseline || {};
  if (!String(baseline.dataDate || '').trim()) return false;
  var mode = String(baseline.mode || '').trim();
  if (mode === 'BASELINE_UNKNOWN') return false;
  if (mode === 'NEW_URL_BASELINE' || mode === 'EXISTING_URL_NO_GSC_TRAFFIC') {
    return !ledgerBlank_(baseline.clicks) && !ledgerBlank_(baseline.impressions) &&
      !ledgerBlank_(baseline.queryCount);
  }
  if (ledgerBlank_(baseline.clicks) || ledgerBlank_(baseline.impressions) ||
      ledgerBlank_(baseline.queryCount) || ledgerBlank_(baseline.siteClicks) ||
      ledgerBlank_(baseline.siteImpressions)) return false;
  if (Number(baseline.impressions || 0) > 0 &&
      (ledgerBlank_(baseline.ctr) || ledgerBlank_(baseline.position))) return false;
  return true;
}

function mergeDeploymentBaselineMissingFields_(existing, recovered) {
  var merged = existing || {};
  recovered = recovered || {};
  ['dataDate', 'clicks', 'impressions', 'ctr', 'position', 'queryCount',
    'siteClicks', 'siteImpressions', 'mode'].forEach(function (field) {
      if (ledgerBlank_(merged[field]) && !ledgerBlank_(recovered[field])) merged[field] = recovered[field];
    });
  return merged;
}

function inheritDeploymentFrozenSiteBaseline_(plan) {
  if (!plan || !plan.pages) return;
  var source = null;
  for (var i = 0; i < plan.pages.length; i++) {
    var baseline = plan.pages[i].baseline || {};
    if (!ledgerBlank_(baseline.siteClicks) && !ledgerBlank_(baseline.siteImpressions)) {
      source = baseline;
      break;
    }
  }
  if (!source) return;
  for (var p = 0; p < plan.pages.length; p++) {
    var target = plan.pages[p].baseline || (plan.pages[p].baseline = {});
    if (ledgerBlank_(target.siteClicks)) target.siteClicks = source.siteClicks;
    if (ledgerBlank_(target.siteImpressions)) target.siteImpressions = source.siteImpressions;
  }
}

function repairDeploymentContentBaselineRows_(packed, rows, plan) {
  if (!packed || !packed.sheet || !rows || !plan || !plan.pages) return 0;
  var repaired = 0;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var path = ledgerNormalizePath_(ledgerCell_(row, packed.map, '页面路径') ||
      ledgerCell_(row, packed.map, 'PrimaryURL'));
    var page = null;
    for (var p = 0; p < plan.pages.length; p++) {
      if (plan.pages[p].path === path) { page = plan.pages[p]; break; }
    }
    if (!page || !page.baseline) continue;
    var rowIndex = -1;
    for (var r = 0; r < packed.rows.length; r++) {
      if (packed.rows[r] === row) { rowIndex = r + 2; break; }
    }
    if (rowIndex < 0) continue;
    var fields = {
      BaselineDataDate: page.baseline.dataDate,
      BaselinePageClicks7D: page.baseline.clicks,
      BaselinePageImpressions7D: page.baseline.impressions,
      BaselinePageCTR: page.baseline.ctr,
      BaselinePagePosition: page.baseline.position,
      BaselinePageQueryCount7D: page.baseline.queryCount,
      BaselineSiteClicks7D: page.baseline.siteClicks,
      BaselineSiteImpressions7D: page.baseline.siteImpressions,
      BaselineMode: page.baseline.mode
    };
    var changed = false;
    Object.keys(fields).forEach(function (header) {
      var col = packed.map[header];
      if (col === undefined || !ledgerBlank_(row[col]) || ledgerBlank_(fields[header])) return;
      row[col] = fields[header];
      changed = true;
    });
    if (changed) {
      packed.sheet.getRange(rowIndex, 1, 1, CONTENT_UPDATE_HEADERS.length).setValues([
        row.slice(0, CONTENT_UPDATE_HEADERS.length)
      ]);
      repaired++;
    }
  }
  return repaired;
}

function buildDeploymentContentFields_(plan, page) {
  return {
    '更新时间': plan.deployedDate,
    '站点': plan.site,
    '页面路径': page.path,
    '来源': 'Deployment Receipt',
    '更新说明': page.reason || plan.action,
    '更新类型': page.action,
    'DecisionID': plan.decisionId,
    'InterventionID': plan.interventionId,
    'SiteID': plan.siteId,
    'BatchID': plan.batchId,
    'Action': page.action,
    'PrimaryURL': page.primaryURL,
    'AffectedURLs': JSON.stringify(plan.affectedUrls),
    'TriggerType': page.triggerType,
    'TriggerQueries': JSON.stringify(page.triggerQueries || []),
    'TriggerSummary': page.triggerSummary,
    'SourceRefs': JSON.stringify(page.sourceRefs || []),
    'Reason': page.reason,
    'LifecyclePhase': plan.lifecyclePhase,
    'ReleaseDate': plan.releaseDate,
    'ReleaseOffsetDay': plan.releaseOffsetDay,
    'CommitSHA': plan.commitSha,
    'DeploymentURL': plan.deploymentUrl,
    'ProductionURL': plan.productionUrl,
    'ProductionDeployedAt': plan.deployedAt,
    'OpportunityID': plan.goalId,
    'RecordedMode': DEPLOYMENT_RECEIPT_RECORDED_MODE,
    'BaselineDataDate': page.baseline.dataDate,
    'BaselinePageClicks7D': page.baseline.clicks,
    'BaselinePageImpressions7D': page.baseline.impressions,
    'BaselinePageCTR': page.baseline.ctr,
    'BaselinePagePosition': page.baseline.position,
    'BaselinePageQueryCount7D': page.baseline.queryCount,
    'BaselineSiteClicks7D': page.baseline.siteClicks,
    'BaselineSiteImpressions7D': page.baseline.siteImpressions,
    'ReceiptKey': plan.receiptKey,
    'PageReceiptKey': page.pageReceiptKey,
    'GoalID': plan.goalId,
    'RecordedAt': nowRecordedAt_()
  };
}

function upsertDeploymentContentPage_(plan, page) {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.CONTENT_UPDATES);
  var fields = buildDeploymentContentFields_(plan, page);
  var row = CONTENT_UPDATE_HEADERS.map(function (header) {
    return fields[header] === undefined ? '' : fields[header];
  });
  var match = findDeploymentContentPage_(packed, plan, page);
  if (match) {
    var current = packed.rows[match.rowIndex - 2].slice(0, CONTENT_UPDATE_HEADERS.length);
    for (var i = 0; i < CONTENT_UPDATE_HEADERS.length; i++) {
      if (ledgerBlank_(current[i]) && !ledgerBlank_(row[i])) current[i] = row[i];
    }
    packed.sheet.getRange(match.rowIndex, 1, 1, CONTENT_UPDATE_HEADERS.length).setValues([current]);
    return { duplicate: true, rowIndex: match.rowIndex };
  }
  packed.sheet.appendRow(row);
  return { duplicate: false, rowIndex: packed.sheet.getLastRow() };
}

function findDeploymentContentPage_(packed, plan, page) {
  var pageKeyCol = packed.map.PageReceiptKey;
  var receiptCol = packed.map.ReceiptKey;
  var interventionCol = packed.map.InterventionID;
  var pathCol = packed.map['页面路径'];
  var primaryCol = packed.map.PrimaryURL;
  for (var i = 0; i < packed.rows.length; i++) {
    var row = packed.rows[i];
    if (pageKeyCol !== undefined && String(row[pageKeyCol] || '').trim() === page.pageReceiptKey) {
      return { rowIndex: i + 2 };
    }
    var sameReceipt = receiptCol !== undefined && String(row[receiptCol] || '').trim() === plan.receiptKey;
    var sameIntervention = interventionCol !== undefined && String(row[interventionCol] || '').trim() === plan.interventionId;
    var samePath = (pathCol !== undefined && ledgerNormalizePath_(row[pathCol]) === page.path) ||
      (primaryCol !== undefined && ledgerNormalizePath_(row[primaryCol]) === page.path);
    if ((sameReceipt || sameIntervention) && samePath) return { rowIndex: i + 2 };
  }
  return null;
}

function upsertDeploymentTimelineIfMissing_(plan) {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_TIMELINE);
  var idCol = packed.map.InterventionID;
  if (idCol !== undefined) {
    for (var i = 0; i < packed.rows.length; i++) {
      if (String(packed.rows[i][idCol] || '').trim() === plan.interventionId) return false;
    }
  }
  var row = buildDeploymentTimelineRow_(plan);
  packed.sheet.appendRow(row);
  return true;
}

function buildDeploymentTimelineRow_(plan) {
  var scope = plan.pages.map(function (p) { return p.path; });
  var trigger = plan.pages.map(function (p) {
    return { type: p.triggerType, queries: p.triggerQueries, summary: p.triggerSummary };
  });
  var evidence = plan.pages.map(function (p) {
    return { path: p.path, baselineDataDate: p.baseline.dataDate, mode: p.baseline.mode,
      clicks7D: p.baseline.clicks, impressions7D: p.baseline.impressions };
  });
  var observationWindow = plan.pages.length + ' pages × D1/D3/D7/D14';
  return [
    plan.interventionId, plan.deployedAt,
    plan.releaseOffsetDay === '' ? '' : 'D' + (Number(plan.releaseOffsetDay) >= 0 ? '+' : '') + Number(plan.releaseOffsetDay),
    plan.lifecyclePhase, plan.batchId, plan.action, JSON.stringify(scope), JSON.stringify(trigger),
    JSON.stringify(evidence), plan.commitSha, 'Deployment Receipt', observationWindow,
    'PENDING', 'PENDING', 'PENDING', plan.decisionId, 'RECEIPT_AUTO', '',
    addDaysStr_(plan.deployedDate, 1), plan.goalId || ''
  ];
}

function deploymentObservationDataContext_() {
  return ledgerObservationDataContext_();
}

function buildDeploymentObservation_(plan, page, horizon, data, targetDateOverride) {
  var target = normalizeKeyDate_(targetDateOverride) ||
    (normalizeKeyDate_(plan.deployedDate) ? addDaysStr_(plan.deployedDate, horizon.days) : '');
  var today = typeof todayStr_ === 'function' ? todayStr_() : target;
  var latest = data.latestBySite[plan.site] || '';
  var mature = !!(target && latest && latest >= target);
  var horizonReached = !!(target && today >= target);
  var metrics = mature ? computeLedgerWindowMetrics_({
    dailyRows: data.dailyRows, pageRows: data.pageRows, queryPageRows: data.queryPageRows,
    site: plan.site, primaryUrl: page.path, productionUrl: plan.productionUrl, endDate: target
  }) : null;
  var baseline = page.baseline || {};
  var observed = metrics || {};
  var status = !target || !horizonReached ? 'WAITING_HORIZON' : (mature ? 'OBSERVED' : 'WAITING_DATA');
  var outcome = mature ? classifyDeploymentOutcome_(horizon.name, baseline, observed) : '';
  var outcomeConfidence = mature ? deploymentOutcomeConfidence_(outcome, baseline, observed) : '';
  return {
    ObservationID: plan.interventionId + '|' + ledgerNormalizePath_(page.path) + '|' + horizon.name,
    InterventionID: plan.interventionId,
    DecisionID: plan.decisionId,
    SiteID: plan.siteId,
    Site: plan.site,
    PrimaryURL: page.primaryURL,
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
    PositionImprovement: mature ? ledgerPositionImprovement_(baseline.position, observed.position) : '',
    QueryCountDelta: mature ? ledgerDelta_(baseline.queryCount, observed.queryCount) : '',
    BaselineSiteClicks7D: baseline.siteClicks === undefined ? '' : baseline.siteClicks,
    BaselineSiteImpressions7D: baseline.siteImpressions === undefined ? '' : baseline.siteImpressions,
    ObservedSiteClicks7D: mature ? observed.siteClicks : '',
    ObservedSiteImpressions7D: mature ? observed.siteImpressions : '',
    BaselineMode: baseline.mode || '',
    AttributionMode: plan.decisionId ? 'FORMAL_DECISION_LINKED' : 'INTERVENTION_NATIVE',
    Outcome: outcome,
    OutcomeConfidence: outcomeConfidence,
    Confounders: deploymentConfounders_(plan, baseline, observed, mature),
    UpdatedAt: nowRecordedAt_()
  };
}

function ledgerPositionImprovement_(baseline, observed) {
  if (ledgerBlank_(baseline) || ledgerBlank_(observed)) return '';
  return Number(baseline) - Number(observed);
}

function classifyDeploymentOutcome_(horizon, baseline, observed) {
  if (horizon === 'D1' || horizon === 'D3') return 'EARLY_SIGNAL';
  var baseVolume = Math.max(Number(baseline.impressions || 0), Number(observed.impressions || 0));
  if (baseVolume < 10) return 'INSUFFICIENT_DATA';
  var comparable = 0, positive = 0, negative = 0;
  var deltas = [ledgerDelta_(baseline.clicks, observed.clicks), ledgerDelta_(baseline.impressions, observed.impressions),
    ledgerDelta_(baseline.ctr, observed.ctr), ledgerPositionImprovement_(baseline.position, observed.position),
    ledgerDelta_(baseline.queryCount, observed.queryCount)];
  for (var i = 0; i < deltas.length; i++) {
    if (ledgerBlank_(deltas[i])) continue;
    comparable++;
    if (Number(deltas[i]) > 0) positive++;
    if (Number(deltas[i]) < 0) negative++;
  }
  if (comparable < 2) return 'INSUFFICIENT_DATA';
  if (positive >= 3 && positive > negative) return 'POSITIVE_SIGNAL';
  if (negative >= 3 && negative > positive) return 'NEGATIVE_SIGNAL';
  if (positive || negative) return 'MIXED';
  return 'NO_CLEAR_SIGNAL';
}

function deploymentOutcomeConfidence_(outcome, baseline, observed) {
  if (outcome === 'INSUFFICIENT_DATA') return 'LOW';
  var volume = Math.max(Number(baseline.impressions || 0), Number(observed.impressions || 0));
  return volume >= 50 ? 'MEDIUM' : 'LOW';
}

function deploymentConfounders_(plan, baseline, observed, mature) {
  if (!mature) return '';
  var base = Number(baseline.siteImpressions || 0);
  var current = Number(observed.siteImpressions || 0);
  if (base > 0 && Math.abs(current - base) / base >= 0.5) return 'SITE_DEMAND_MOVEMENT';
  return '';
}

function findDeploymentObservationRow_(packed, observation) {
  var idCol = packed.map.ObservationID;
  if (idCol !== undefined) {
    for (var i = 0; i < packed.rows.length; i++) {
      if (String(packed.rows[i][idCol] || '').trim() === observation.ObservationID) {
        return { rowIndex: i + 2, row: packed.rows[i] };
      }
    }
  }
  var interventionCol = packed.map.InterventionID;
  var primaryCol = packed.map.PrimaryURL;
  var horizonCol = packed.map.Horizon;
  if (interventionCol !== undefined && primaryCol !== undefined && horizonCol !== undefined) {
    for (var r = 0; r < packed.rows.length; r++) {
      if (String(packed.rows[r][interventionCol] || '').trim() === observation.InterventionID &&
          ledgerNormalizePath_(packed.rows[r][primaryCol]) === ledgerNormalizePath_(observation.PrimaryURL) &&
          String(packed.rows[r][horizonCol] || '').trim() === observation.Horizon) {
        return { rowIndex: r + 2, row: packed.rows[r] };
      }
    }
  }
  return null;
}

function preserveDeploymentObservationFields_(current, values, names, map) {
  for (var i = 0; i < names.length; i++) {
    var col = map[names[i]];
    if (col !== undefined && !ledgerBlank_(current[col])) values[names[i]] = current[col];
  }
}

function preserveDeploymentObservationBaselineFields_(current, values, map) {
  var names = [
    'BaselineDataDate', 'BaselineClicks7D', 'BaselineImpressions7D', 'BaselineCTR',
    'BaselinePosition', 'BaselineQueryCount7D', 'BaselineSiteClicks7D',
    'BaselineSiteImpressions7D', 'BaselineMode'
  ];
  for (var i = 0; i < names.length; i++) {
    var col = map[names[i]];
    if (col !== undefined && ledgerBlank_(values[names[i]]) && !ledgerBlank_(current[col])) {
      values[names[i]] = current[col];
    }
  }
}

function preserveDeploymentObservationNonBlankFields_(current, values, map) {
  for (var i = 0; i < INTERVENTION_OBSERVATION_HEADERS.length; i++) {
    var header = INTERVENTION_OBSERVATION_HEADERS[i];
    var col = map[header];
    if (col !== undefined && ledgerBlank_(values[header]) && !ledgerBlank_(current[col])) {
      values[header] = current[col];
    }
  }
}

function deploymentObservationRowArray_(values, packed, current) {
  return packed.header.map(function (header, index) {
    if (Object.prototype.hasOwnProperty.call(values, header)) return values[header];
    return current && index < current.length ? current[index] : '';
  });
}

function upsertDeploymentObservation_(observation, packed, existing) {
  packed = packed || loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_OBSERVATIONS);
  var values = {};
  INTERVENTION_OBSERVATION_HEADERS.forEach(function (header) {
    values[header] = observation[header] === undefined ? '' : observation[header];
  });
  if (existing) {
    preserveDeploymentObservationFields_(existing.row, values, [
      'ObservationID', 'InterventionID', 'Horizon', 'TargetDate', 'PrimaryURL'
    ], packed.map);
    preserveDeploymentObservationBaselineFields_(existing.row, values, packed.map);
    preserveDeploymentObservationNonBlankFields_(existing.row, values, packed.map);
    var existingRow = deploymentObservationRowArray_(values, packed, existing.row);
    packed.sheet.getRange(existing.rowIndex, 1, 1, packed.header.length).setValues([existingRow]);
    return { inserted: false };
  }
  var row = deploymentObservationRowArray_(values, packed, null);
  packed.sheet.appendRow(row);
  return { inserted: true };
}

function upsertDeploymentObservations_(plan) {
  var data = deploymentObservationDataContext_();
  var packed = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_OBSERVATIONS);
  var inserted = 0;
  for (var p = 0; p < plan.pages.length; p++) {
    for (var h = 0; h < DEPLOYMENT_OBSERVATION_HORIZONS.length; h++) {
      var horizon = DEPLOYMENT_OBSERVATION_HORIZONS[h];
      var identity = buildDeploymentObservation_(plan, plan.pages[p], horizon, data);
      var existing = findDeploymentObservationRow_(packed, identity);
      var targetDate = existing ? ledgerCell_(existing.row, packed.map, 'TargetDate') : '';
      var observation = buildDeploymentObservation_(plan, plan.pages[p], horizon, data, targetDate);
      if (upsertDeploymentObservation_(observation, packed, existing).inserted) inserted++;
      if (existing) existing.row = packed.rows[existing.rowIndex - 2];
    }
  }
  return { count: plan.pages.length * DEPLOYMENT_OBSERVATION_HORIZONS.length, inserted: inserted > 0 };
}

function planFromDeploymentContentGroup_(rows, map) {
  var first = rows[0];
  var base = ledgerPlanFromContentRow_(first, map);
  base.deployedDate = base.deployedDate || normalizeKeyDate_(ledgerCell_(first, map, '更新时间'));
  base.deployedAt = base.deployedAt || base.deployedDate;
  base.productionUrl = base.productionUrl || ledgerCell_(first, map, 'PrimaryURL');
  base.recordedMode = ledgerCell_(first, map, 'RecordedMode');
  base.goalId = ledgerCell_(first, map, 'GoalID') || ledgerCell_(first, map, 'OpportunityID');
  base.receiptKey = ledgerCell_(first, map, 'ReceiptKey');
  base.pages = rows.map(function (row) {
    var path = ledgerNormalizePath_(ledgerCell_(row, map, '页面路径') || ledgerCell_(row, map, 'PrimaryURL'));
    return {
      path: path,
      primaryURL: ledgerCell_(row, map, 'PrimaryURL') || ledgerCell_(row, map, '页面路径'),
      action: ledgerCell_(row, map, 'Action') || ledgerCell_(row, map, '更新类型'),
      triggerType: ledgerCell_(row, map, 'TriggerType'),
      triggerQueries: ledgerStringArray_(ledgerCell_(row, map, 'TriggerQueries')),
      triggerSummary: ledgerCell_(row, map, 'TriggerSummary'),
      sourceRefs: ledgerStringArray_(ledgerCell_(row, map, 'SourceRefs')),
      reason: ledgerCell_(row, map, 'Reason'),
      baseline: {
        dataDate: ledgerCell_(row, map, 'BaselineDataDate'),
        clicks: ledgerValue_(row, map, 'BaselinePageClicks7D'),
        impressions: ledgerValue_(row, map, 'BaselinePageImpressions7D'),
        ctr: ledgerValue_(row, map, 'BaselinePageCTR'),
        position: ledgerValue_(row, map, 'BaselinePagePosition'),
        queryCount: ledgerValue_(row, map, 'BaselinePageQueryCount7D'),
        siteClicks: ledgerValue_(row, map, 'BaselineSiteClicks7D'),
        siteImpressions: ledgerValue_(row, map, 'BaselineSiteImpressions7D'),
        mode: ledgerCell_(row, map, 'BaselineMode')
      }
    };
  });
  return base;
}

/**
 * Safe additive reconciliation. It only considers intervention records with
 * stable identity and production/content evidence; retrospective notes stay
 * untouched and no DecisionID is invented.
 */
function reconcileInterventionPipeline() {
  ensureSheet_(SHEET_NAMES.CONTENT_UPDATES, CONTENT_UPDATE_HEADERS);
  ensureContentUpdateHeader_();
  ensureSheet_(SHEET_NAMES.INTERVENTION_OBSERVATIONS, INTERVENTION_OBSERVATION_HEADERS);
  ensureLedgerHeader_(SHEET_NAMES.INTERVENTION_OBSERVATIONS, INTERVENTION_OBSERVATION_HEADERS);
  var packed = loadLedgerSheetRows_(SHEET_NAMES.CONTENT_UPDATES);
  var groups = {};
  var idCol = packed.map.InterventionID;
  var siteIdCol = packed.map.SiteID;
  if (idCol === undefined || siteIdCol === undefined) return { interventions: 0, observations: 0 };
  for (var i = 0; i < packed.rows.length; i++) {
    var row = packed.rows[i];
    var id = String(row[idCol] || '').trim();
    var siteId = String(row[siteIdCol] || '').trim();
    var mode = ledgerCell_(row, packed.map, 'RecordedMode');
    if (mode && mode !== DEPLOYMENT_RECEIPT_RECORDED_MODE) continue;
    var evidence = ledgerCell_(row, packed.map, 'ProductionURL') ||
      ledgerCell_(row, packed.map, 'CommitSHA') || ledgerCell_(row, packed.map, 'ReceiptKey') ||
      ledgerCell_(row, packed.map, '更新时间');
    if (!id || !siteId || !evidence) continue;
    if (!groups[id]) groups[id] = [];
    groups[id].push(row);
  }
  var interventionCount = 0, observationCount = 0;
  var ids = Object.keys(groups);
  for (var g = 0; g < ids.length; g++) {
    var plan = planFromDeploymentContentGroup_(groups[ids[g]], packed.map);
    if (!plan.deployedDate || !plan.siteId || !plan.pages.length) continue;
    // Establish intervention-level site authority before any page recovery can
    // introduce a calculated (and possibly incomplete) site window.
    inheritDeploymentFrozenSiteBaseline_(plan);
    for (var p = 0; p < plan.pages.length; p++) {
      var baseline = plan.pages[p].baseline || {};
      if (!deploymentBaselineComplete_(baseline) || ledgerBlank_(baseline.siteClicks) ||
          ledgerBlank_(baseline.siteImpressions)) {
        var recovered = captureDeploymentBaseline_(
          plan.site,
          plan.pages[p].path,
          plan.productionUrl,
          plan.deployedDate,
          baseline.dataDate,
          plan.pages[p].action
        );
        plan.pages[p].baseline = mergeDeploymentBaselineMissingFields_(baseline, recovered);
      }
    }
    inheritDeploymentFrozenSiteBaseline_(plan);
    repairDeploymentContentBaselineRows_(packed, groups[ids[g]], plan);
    var result = upsertDeploymentObservations_(plan);
    observationCount += result.count;
    interventionCount++;
  }
  return { interventions: interventionCount, observations: observationCount };
}

/** Daily runner entry point; no new trigger is created. */
function runInterventionObservations() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('runInterventionObservations: lock busy');
  try {
    return runInterventionObservationsUnlocked_();
  } finally {
    lock.releaseLock();
  }
}

function runInterventionObservationsUnlocked_() {
  var reconciliation = reconcileInterventionPipeline();
  var timeline = refreshDeploymentTimelines_();
  return { reconciliation: reconciliation, observations: reconciliation, timeline: timeline };
}

function refreshDeploymentTimelines_() {
  ensureSheet_(SHEET_NAMES.INTERVENTION_TIMELINE, INTERVENTION_TIMELINE_HEADERS);
  ensureLedgerHeader_(SHEET_NAMES.INTERVENTION_TIMELINE, INTERVENTION_TIMELINE_HEADERS);
  var packed = loadLedgerSheetRows_(SHEET_NAMES.CONTENT_UPDATES);
  var groups = {};
  var idCol = packed.map.InterventionID;
  if (idCol === undefined) return { interventions: 0, timelineRows: 0 };
  for (var i = 0; i < packed.rows.length; i++) {
    var id = String(packed.rows[i][idCol] || '').trim();
    var mode = ledgerCell_(packed.rows[i], packed.map, 'RecordedMode');
    if (!id || (mode && mode !== DEPLOYMENT_RECEIPT_RECORDED_MODE) ||
        !ledgerCell_(packed.rows[i], packed.map, 'ProductionURL')) continue;
    if (!groups[id]) groups[id] = [];
    groups[id].push(packed.rows[i]);
  }
  var count = 0;
  Object.keys(groups).forEach(function (id) {
    var plan = planFromDeploymentContentGroup_(groups[id], packed.map);
    if (!plan.deployedDate) return;
    var obsPacked = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_OBSERVATIONS);
    var obsMap = obsPacked.map;
    var observed = [];
    for (var o = 0; o < obsPacked.rows.length; o++) {
      if (String(obsPacked.rows[o][obsMap.InterventionID] || '').trim() !== id) continue;
      observed.push(ledgerObservationObject_(obsPacked.rows[o], obsMap));
    }
    var row = buildDeploymentTimelineRow_(plan);
    var outcome = [];
    for (var j = 0; j < observed.length; j++) {
      if (observed[j].Outcome) outcome.push(observed[j].Horizon + '=' + observed[j].Outcome);
    }
    if (outcome.length) row[12] = outcome.join('; ');
    upsertLedgerTimelineRow_(row);
    count++;
  });
  return { interventions: count, timelineRows: count };
}
