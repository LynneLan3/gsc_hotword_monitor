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
/** Receipt page role for baseline resolution; not a second BaselineMode enum. */
var DEPLOYMENT_RECEIPT_PAGE_ROLE = {
  NEW_PAGE: 'NEW_PAGE',
  EXISTING_PAGE_UPDATE: 'EXISTING_PAGE_UPDATE',
  INTERNAL_LINK_ONLY: 'INTERNAL_LINK_ONLY'
};
var LEDGER_ACTIONS = {
  CREATE_PAGE: true,
  UPDATE_PAGE: true,
  CONTENT_OPTIMIZE: true,
  CONTENT_EXPAND: true,
  CONTENT_EXPANSION: true,
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

function ledgerMergeStableValue_(name, receiptValue, taskValue, errorPrefix) {
  var a = String(receiptValue || '').trim();
  var b = String(taskValue || '').trim();
  if (a && b && a !== b) throw new Error((errorPrefix === undefined ? 'recordPublishedBatch: ' : errorPrefix) + 'Development Task ' + name + ' conflict: receipt=' + a + ' task=' + b);
  return a || b;
}

function resolveDeploymentReceiptAttribution_(receipt) {
  receipt = receipt || {};
  var taskId = String(receipt.developmentTaskId || '').trim();
  var task = taskId ? resolveLedgerDevelopmentTask_(taskId) : {};
  if (taskId && !task.taskId) throw new Error('ingestDeploymentReceipt: DevelopmentTaskID not found: ' + taskId);

  receipt.siteId = ledgerMergeStableValue_('SiteID', receipt.siteId, task.siteId, 'ingestDeploymentReceipt: ');
  receipt.opportunityId = ledgerMergeStableValue_('OpportunityID', receipt.opportunityId, task.opportunityId, 'ingestDeploymentReceipt: ');
  receipt.decisionId = ledgerMergeStableValue_('DecisionID', receipt.decisionId, task.decisionId, 'ingestDeploymentReceipt: ');
  var taskAction = String(task.actionType || '').trim().toUpperCase();
  if (!receipt.action && taskAction) receipt.action = taskAction;
  for (var i = 0; i < (receipt.affectedPages || []).length; i++) {
    if (!receipt.affectedPages[i].action && receipt.action) receipt.affectedPages[i].action = receipt.action;
  }
  if (taskAction && receipt.action && taskAction !== receipt.action) {
    throw new Error('Development Task ActionType conflict: receipt=' + receipt.action + ' task=' + taskAction);
  }
  return receipt;
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

function ledgerRawCell_(row, map, name) {
  var idx = map[name];
  return idx === undefined ? '' : row[idx];
}

function ledgerDateCell_(row, map, name) {
  return normalizeKeyDate_(ledgerRawCell_(row, map, name));
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
  if (value instanceof Date) return formatDate_(value);
  var raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.substring(0, 10);
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

/** Serialize by bound Sheet header order, never constant column offsets. */
function ledgerRowFromFields_(packed, fields, current) {
  return (packed.header || []).map(function (header, index) {
    if (Object.prototype.hasOwnProperty.call(fields || {}, header)) return fields[header];
    return current && index < current.length ? current[index] : '';
  });
}

function ledgerDeployedAtDisplay_(deployedAtIso) {
  var raw = String(deployedAtIso || '').trim();
  if (!raw) return '';
  var date = new Date(raw);
  if (isNaN(date.getTime())) return raw;
  return Utilities.formatDate(date, 'Asia/Shanghai', 'yyyy-MM-dd HH:mm:ss');
}

function writeLedgerObservationRows_(plan) {
  // Legacy receipts remain accepted and continue to populate their legacy
  // content/timeline facts, but the current canonical observation table has
  // exactly one writer: the deployment receipt pipeline.
  return { interventions: 0, observations: 0, skipped: 'DEPLOYMENT_RECEIPT_WRITER_ONLY' };
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
  var values = {};
  INTERVENTION_OBSERVATION_HEADERS.forEach(function (header) {
    values[header] = observation[header] === undefined ? '' : observation[header];
  });
  if (idCol !== undefined) {
    for (var i = 0; i < packed.rows.length; i++) {
      if (String(packed.rows[i][idCol] || '').trim() === observation.ObservationID) {
        if (ledgerCell_(packed.rows[i], packed.map, 'AttributionMode') === 'INTERVENTION_NATIVE') {
          return { action: 'skip', rowIndex: i + 2, reason: 'DEPLOYMENT_RECEIPT_OWNED' };
        }
        var existingRow = packed.header.map(function (header, index) {
          return Object.prototype.hasOwnProperty.call(values, header) ? values[header] : packed.rows[i][index];
        });
        packed.sheet.getRange(i + 2, 1, 1, packed.header.length).setValues([existingRow]);
        return { action: 'update', rowIndex: i + 2 };
      }
    }
  }
  packed.sheet.appendRow(packed.header.map(function (header) {
    return Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '';
  }));
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
    dataDate: ledgerDateCell_(row, map, 'BaselineDataDate'),
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
    deployedAt: ledgerRawCell_(row, map, 'ProductionDeployedAt'),
    deployedDate: ledgerProductionLocalDate_(ledgerRawCell_(row, map, 'ProductionDeployedAt')),
    releaseDate: ledgerDateCell_(row, map, 'ReleaseDate'),
    releaseOffsetDay: ledgerValue_(row, map, 'ReleaseOffsetDay'),
    baseline: baseline
  };
}

function ledgerValue_(row, map, name) {
  var idx = map[name];
  return idx === undefined ? '' : row[idx];
}

function refreshInterventionObservations_() {
  // Compatibility symbol only. Historical rows remain untouched and current
  // observations are owned exclusively by the Deployment Receipt writer.
  return { interventions: 0, observations: 0, skipped: 'DEPLOYMENT_RECEIPT_WRITER_ONLY' };
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
  var timelineResult = refreshExperimentTimeline_();
  return { timeline: timelineResult };
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
  resolveDeploymentReceiptAttribution_(normalized);
  validateDeploymentReceipt_(normalized);
  var early = peekDeploymentReceiptAlreadyRecorded_(normalized);
  if (early) return early;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('ingestDeploymentReceipt: write lock busy');
  try {
    early = peekDeploymentReceiptAlreadyRecorded_(normalized);
    if (early) return early;
    return ingestDeploymentReceipt_(normalized);
  } finally {
    lock.releaseLock();
  }
}

function peekDeploymentReceiptAlreadyRecorded_(receipt) {
  var interventionId = receipt.interventionId || ('receipt-' + receipt.receiptKey);
  var plan = {
    interventionId: interventionId,
    pages: (receipt.affectedPages || []).map(function (p) {
      return { path: ledgerNormalizePath_(p.path) };
    })
  };
  var existingPageKeys = countDeploymentReceiptContentByPageKey_(receipt);
  if (!deploymentReceiptPagesFullyRecorded_(receipt, existingPageKeys)) return null;
  if (!deploymentTimelineExists_(interventionId)) return null;
  var frozenObs = countDeploymentReceiptObservations_(interventionId);
  var expectedObs = plan.pages.length * DEPLOYMENT_OBSERVATION_HORIZONS.length;
  if (frozenObs.total !== expectedObs || frozenObs.duplicateObservationIds !== 0) return null;
  return buildDeploymentReceiptResult_(receipt, plan, {
    result: 'ALREADY_RECORDED',
    inserted: 0,
    updated: 0,
    unchanged: plan.pages.length,
    duplicateSkipped: plan.pages.length,
    timelineInserted: 0,
    timelineUnchanged: 1,
    observationsInserted: 0,
    observationsUnchanged: expectedObs
  });
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
      reason: String(page.reason || '').trim(),
      pageRole: String(page.pageRole || page.page_role || '').trim().toUpperCase()
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
    developmentTaskId: String(
      receipt.developmentTaskId || receipt.development_task_id || receipt.DevelopmentTaskID || ''
    ).trim(),
    opportunityId: String(
      receipt.opportunityId || receipt.opportunity_id || receipt.OpportunityID || ''
    ).trim(),
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
    'receiptKey', 'siteName', 'batchId', 'commitSHA',
    'deploymentURL', 'productionURL', 'productionDeployedAt', 'action'
  ];
  for (var i = 0; i < required.length; i++) {
    if (!String(receipt[required[i]] || '').trim()) {
      throw new Error('ingestDeploymentReceipt: missing ' + required[i]);
    }
  }
  if (!receipt.siteId && !receipt.developmentTaskId) {
    throw new Error('ingestDeploymentReceipt: siteId or developmentTaskId is required');
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
    receiptResult.result === 'ACCEPTED' || receiptResult.result === 'DUPLICATE_ACCEPTED' ||
    receiptResult.result === 'ALREADY_RECORDED'
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

  var interventionId = receipt.interventionId ||
    ('receipt-' + receipt.receiptKey);
  var plan = buildDeploymentReceiptPlan_(receipt, interventionId);
  var existingPageKeys = countDeploymentReceiptContentByPageKey_(receipt);
  if (deploymentReceiptPagesFullyRecorded_(receipt, existingPageKeys) &&
      deploymentTimelineExists_(interventionId)) {
    var frozenObs = countDeploymentReceiptObservations_(interventionId);
    var expectedObs = plan.pages.length * DEPLOYMENT_OBSERVATION_HORIZONS.length;
    if (frozenObs.total === expectedObs && frozenObs.duplicateObservationIds === 0) {
      return buildDeploymentReceiptResult_(receipt, plan, {
        result: 'ALREADY_RECORDED',
        inserted: 0,
        updated: 0,
        unchanged: plan.pages.length,
        duplicateSkipped: plan.pages.length,
        timelineInserted: 0,
        timelineUnchanged: 1,
        observationsInserted: 0,
        observationsUnchanged: expectedObs
      });
    }
  }

  var contentStats = { inserted: 0, updated: 0, unchanged: 0, duplicateSkipped: 0 };
  for (var i = 0; i < plan.pages.length; i++) {
    var pageResult = upsertDeploymentContentPage_(plan, plan.pages[i]);
    if (pageResult.action === 'insert') contentStats.inserted++;
    else if (pageResult.action === 'update') {
      contentStats.updated++;
      contentStats.duplicateSkipped++;
    } else {
      contentStats.unchanged++;
      contentStats.duplicateSkipped++;
    }
  }
  var timelineInserted = upsertDeploymentTimelineIfMissing_(plan);
  var observationRows = upsertDeploymentObservations_(plan);
  var allUnchanged = contentStats.inserted === 0 && contentStats.updated === 0 &&
    !timelineInserted && observationRows.inserted === 0;
  var resultLabel = allUnchanged ? 'ALREADY_RECORDED' : 'ACCEPTED';
  return buildDeploymentReceiptResult_(receipt, plan, {
    result: resultLabel,
    inserted: contentStats.inserted,
    updated: contentStats.updated,
    unchanged: contentStats.unchanged,
    duplicateSkipped: contentStats.duplicateSkipped,
    timelineInserted: timelineInserted ? 1 : 0,
    timelineUnchanged: timelineInserted ? 0 : 1,
    observationsInserted: observationRows.inserted,
    observationsUnchanged: observationRows.count - observationRows.inserted
  });
}

function buildDeploymentReceiptResult_(receipt, plan, stats) {
  writeLog_('INFO', receipt.siteName, 'receipt=' + receipt.receiptKey + ' siteId=' + receipt.siteId +
    ' result=' + stats.result + ' inserted=' + stats.inserted + ' updated=' + stats.updated +
    ' unchanged=' + stats.unchanged + ' duplicateSkipped=' + stats.duplicateSkipped);
  return {
    ok: true,
    result: stats.result,
    receiptKey: receipt.receiptKey,
    interventionId: plan.interventionId,
    contentUpdates: stats.inserted + stats.updated + stats.unchanged,
    inserted: stats.inserted,
    updated: stats.updated,
    unchanged: stats.unchanged,
    duplicateSkipped: stats.duplicateSkipped,
    timelineInserted: stats.timelineInserted,
    timelineUnchanged: stats.timelineUnchanged,
    observations: stats.observationsInserted + stats.observationsUnchanged,
    observationsInserted: stats.observationsInserted,
    observationsUnchanged: stats.observationsUnchanged,
    baselineDataDate: plan.pages.length && plan.pages[0].baseline
      ? (plan.pages[0].baseline.dataDate || '')
      : ''
  };
}

function deploymentReceiptPagesFullyRecorded_(receipt, existingPageKeys) {
  existingPageKeys = existingPageKeys || countDeploymentReceiptContentByPageKey_(receipt);
  if (!receipt.affectedPages || !receipt.affectedPages.length) return false;
  for (var i = 0; i < receipt.affectedPages.length; i++) {
    var path = ledgerNormalizePath_(receipt.affectedPages[i].path);
    var expectedKey = receipt.receiptKey + '|' + path;
    if (!existingPageKeys.paths[expectedKey]) return false;
  }
  return existingPageKeys.count >= receipt.affectedPages.length;
}

function countDeploymentReceiptContentByPageKey_(receipt) {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.CONTENT_UPDATES);
  var pageKeyCol = packed.map.PageReceiptKey;
  var prefix = String(receipt.receiptKey || '').trim() + '|';
  var count = 0;
  var paths = {};
  if (pageKeyCol === undefined) return { count: 0, paths: paths };
  for (var i = 0; i < packed.rows.length; i++) {
    var key = String(packed.rows[i][pageKeyCol] || '').trim();
    if (key.indexOf(prefix) !== 0) continue;
    count++;
    paths[key] = true;
  }
  return { count: count, paths: paths };
}

function deploymentTimelineExists_(interventionId) {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_TIMELINE);
  var idCol = packed.map.InterventionID;
  if (idCol === undefined) return false;
  for (var i = 0; i < packed.rows.length; i++) {
    if (String(packed.rows[i][idCol] || '').trim() === interventionId) return true;
  }
  return false;
}

function countDeploymentReceiptObservations_(interventionId) {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_OBSERVATIONS);
  var idCol = packed.map.InterventionID;
  var obsIdCol = packed.map.ObservationID;
  var total = 0;
  var seen = {};
  var duplicateObservationIds = 0;
  if (idCol === undefined) return { total: 0, duplicateObservationIds: 0 };
  for (var i = 0; i < packed.rows.length; i++) {
    if (String(packed.rows[i][idCol] || '').trim() !== interventionId) continue;
    total++;
    if (obsIdCol !== undefined) {
      var obsId = String(packed.rows[i][obsIdCol] || '').trim();
      if (!obsId) continue;
      if (seen[obsId]) duplicateObservationIds++;
      else seen[obsId] = true;
    }
  }
  return { total: total, duplicateObservationIds: duplicateObservationIds };
}

function countDeploymentReceiptLedger_(receipt) {
  receipt = receipt || {};
  var interventionId = receipt.interventionId || ('receipt-' + receipt.receiptKey);
  var contentByKey = countDeploymentReceiptContentByPageKey_(receipt);
  var timeline = deploymentTimelineExists_(interventionId) ? 1 : 0;
  var observations = countDeploymentReceiptObservations_(interventionId);
  return {
    receiptKey: receipt.receiptKey,
    interventionId: interventionId,
    contentUpdates: contentByKey.count,
    contentUpdatesByPageReceiptKey: contentByKey.count,
    timeline: timeline,
    observations: observations.total,
    duplicateObservationIds: observations.duplicateObservationIds
  };
}

/** Public repair entry: rebuild canonical content rows for one deployment receipt. */
function repairDeploymentReceiptContentRows(receipt) {
  var normalized = normalizeDeploymentReceipt_(receipt);
  resolveDeploymentReceiptAttribution_(normalized);
  validateDeploymentReceipt_(normalized);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('repairDeploymentReceiptContentRows: write lock busy');
  try {
    return repairDeploymentReceiptContentRows_(normalized);
  } finally {
    lock.releaseLock();
  }
}

/** Repair BaselineMode on existing deployment-receipt observations without changing row identity. */
function repairDeploymentReceiptObservationBaselineModes(receipt) {
  var normalized = normalizeDeploymentReceipt_(receipt);
  resolveDeploymentReceiptAttribution_(normalized);
  validateDeploymentReceipt_(normalized);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('repairDeploymentReceiptObservationBaselineModes: write lock busy');
  try {
    return repairDeploymentReceiptObservationBaselineModes_(normalized);
  } finally {
    lock.releaseLock();
  }
}

function inspectDeploymentReceiptLedger(receiptKey) {
  receiptKey = String(receiptKey || '').trim();
  if (!receiptKey) throw new Error('inspectDeploymentReceiptLedger: receiptKey required');
  var receipt = { receiptKey: receiptKey, interventionId: 'receipt-' + receiptKey };
  var counts = countDeploymentReceiptLedger_(receipt);
  var packed = loadLedgerSheetRows_(SHEET_NAMES.CONTENT_UPDATES);
  var receiptKeyCol = packed.map.ReceiptKey;
  var pageKeyCol = packed.map.PageReceiptKey;
  var sample = { receiptKey: '', pageReceiptKey: '' };
  var prefix = receiptKey + '|';
  if (pageKeyCol !== undefined) {
    for (var i = 0; i < packed.rows.length; i++) {
      var pageKey = String(packed.rows[i][pageKeyCol] || '').trim();
      if (pageKey.indexOf(prefix) !== 0) continue;
      sample.pageReceiptKey = pageKey;
      if (receiptKeyCol !== undefined) sample.receiptKey = String(packed.rows[i][receiptKeyCol] || '').trim();
      break;
    }
  }
  return {
    receiptKey: receiptKey,
    interventionId: receipt.interventionId,
    contentUpdates: counts.contentUpdates,
    contentUpdatesByPageReceiptKey: counts.contentUpdatesByPageReceiptKey,
    timeline: counts.timeline,
    observations: counts.observations,
    duplicateObservationIds: counts.duplicateObservationIds,
    columns: {
      ReceiptKey: receiptKeyCol === undefined ? null : receiptKeyCol + 1,
      PageReceiptKey: pageKeyCol === undefined ? null : pageKeyCol + 1
    },
    sample: sample
  };
}

function rowBelongsToDeploymentReceipt_(row, map, receipt) {
  var interventionId = String(receipt.interventionId || ('receipt-' + receipt.receiptKey)).trim();
  var receiptKey = String(receipt.receiptKey || '').trim();
  var batchId = String(receipt.batchId || '').trim();
  var siteId = String(receipt.siteId || '').trim();
  var pageKeyPrefix = receiptKey + '|';
  if (ledgerCell_(row, map, 'InterventionID') === interventionId) return true;
  if (ledgerCell_(row, map, 'ReceiptKey') === receiptKey) return true;
  if (ledgerCell_(row, map, 'PageReceiptKey').indexOf(pageKeyPrefix) === 0) return true;
  if (ledgerCell_(row, map, 'BatchID') === batchId &&
      (ledgerCell_(row, map, 'SiteID') === siteId || ledgerCell_(row, map, 'SiteID') === interventionId)) {
    return true;
  }
  if (ledgerCell_(row, map, 'SiteID') === interventionId) return true;
  if (ledgerCell_(row, map, 'Action') === batchId) return true;
  if (ledgerCell_(row, map, 'PrimaryURL') === String(receipt.action || '').trim()) return true;
  return false;
}

function repairDeploymentReceiptContentRows_(receipt) {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.CONTENT_UPDATES);
  var deleteRows = [];
  for (var i = 0; i < packed.rows.length; i++) {
    if (rowBelongsToDeploymentReceipt_(packed.rows[i], packed.map, receipt)) deleteRows.push(i + 2);
  }
  deleteRows.sort(function (a, b) { return b - a; });
  for (var d = 0; d < deleteRows.length; d++) packed.sheet.deleteRow(deleteRows[d]);

  var interventionId = receipt.interventionId || ('receipt-' + receipt.receiptKey);
  var plan = buildDeploymentReceiptPlan_(receipt, interventionId);
  var inserted = 0;
  for (var p = 0; p < plan.pages.length; p++) {
    if (upsertDeploymentContentPage_(plan, plan.pages[p]).action === 'insert') inserted++;
  }
  var timelineFixed = repairDeploymentTimelineTime_(plan);
  var counts = countDeploymentReceiptLedger_(receipt);
  return {
    ok: true,
    deleted: deleteRows.length,
    inserted: inserted,
    timelineFixed: timelineFixed,
    counts: counts
  };
}

function repairDeploymentReceiptObservationBaselineModes_(receipt) {
  var interventionId = receipt.interventionId || ('receipt-' + receipt.receiptKey);
  var plan = buildDeploymentReceiptPlan_(receipt, interventionId);
  var packed = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_OBSERVATIONS);
  var modeCol = packed.map.BaselineMode;
  var interventionCol = packed.map.InterventionID;
  var primaryCol = packed.map.PrimaryURL;
  if (modeCol === undefined || interventionCol === undefined) {
    throw new Error('repairDeploymentReceiptObservationBaselineModes: observation columns missing');
  }
  var pagesByPath = {};
  for (var p = 0; p < plan.pages.length; p++) pagesByPath[plan.pages[p].path] = plan.pages[p];
  var touched = 0;
  var repaired = 0;
  var modeCounts = {};
  for (var i = 0; i < packed.rows.length; i++) {
    if (String(packed.rows[i][interventionCol] || '').trim() !== interventionId) continue;
    touched++;
    var path = ledgerNormalizePath_(primaryCol === undefined ? '' : packed.rows[i][primaryCol]);
    var page = pagesByPath[path];
    if (!page || !page.baseline) continue;
    var expected = String(page.baseline.mode || '').trim();
    if (!expected) continue;
    modeCounts[expected] = (modeCounts[expected] || 0) + 1;
    if (String(packed.rows[i][modeCol] || '').trim() === expected) continue;
    packed.sheet.getRange(i + 2, modeCol + 1).setValue(expected);
    packed.rows[i][modeCol] = expected;
    repaired++;
  }
  var expectedObs = plan.pages.length * DEPLOYMENT_OBSERVATION_HORIZONS.length;
  if (touched !== expectedObs) {
    throw new Error(
      'repairDeploymentReceiptObservationBaselineModes: expected ' + expectedObs +
      ' observations, found ' + touched
    );
  }
  return {
    ok: true,
    interventionId: interventionId,
    observations: touched,
    repaired: repaired,
    baselineModes: modeCounts,
    counts: countDeploymentReceiptLedger_(receipt)
  };
}

function repairDeploymentTimelineTime_(plan) {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_TIMELINE);
  var idCol = packed.map.InterventionID;
  var timeCol = packed.map['时间（UTC+8）'];
  if (idCol === undefined || timeCol === undefined) return false;
  var display = ledgerDeployedAtDisplay_(plan.deployedAt);
  for (var i = 0; i < packed.rows.length; i++) {
    if (String(packed.rows[i][idCol] || '').trim() !== plan.interventionId) continue;
    if (String(packed.rows[i][timeCol] || '').trim() === display) return false;
    packed.sheet.getRange(i + 2, timeCol + 1).setValue(display);
    return true;
  }
  return false;
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
      receipt.siteName, page.path, receipt.productionURL, deployedDate, '', page.action || receipt.action,
      page.pageRole
    );
    pages.push({
      path: page.path,
      action: page.action || receipt.action,
      pageRole: baseline.pageRole,
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
    developmentTaskId: receipt.developmentTaskId,
    opportunityId: receipt.opportunityId,
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

function resolveDeploymentReceiptPageRole_(action, hasAnyPageEvidence, explicitRole) {
  var role = String(explicitRole || '').trim().toUpperCase();
  if (role && DEPLOYMENT_RECEIPT_PAGE_ROLE[role]) return role;
  action = String(action || '').trim().toUpperCase();
  if (action === 'ADD_INTERNAL_LINK' || action === 'INTERNAL_LINK') {
    return DEPLOYMENT_RECEIPT_PAGE_ROLE.INTERNAL_LINK_ONLY;
  }
  if (hasAnyPageEvidence) return DEPLOYMENT_RECEIPT_PAGE_ROLE.EXISTING_PAGE_UPDATE;
  if (action === 'CREATE_PAGE' || action === 'CONTENT_EXPANSION' || action === 'CONTENT_EXPAND') {
    return DEPLOYMENT_RECEIPT_PAGE_ROLE.NEW_PAGE;
  }
  return DEPLOYMENT_RECEIPT_PAGE_ROLE.EXISTING_PAGE_UPDATE;
}

/** BaselineMode follows receipt pageRole plus strict pre-deploy GSC evidence only. */
function captureDeploymentBaseline_(site, primaryUrl, productionUrl, deployedDate, baselineDataDate, action, explicitPageRole) {
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
  var pageRole = resolveDeploymentReceiptPageRole_(action, hasAnyPageEvidence, explicitPageRole);
  baseline.pageRole = pageRole;
  var reliableExistingBaseline = hasAnyPageEvidence && hasPageTraffic &&
    deploymentHasSevenDayCoverage_(pages, site, target, end, false);
  if (pageRole === DEPLOYMENT_RECEIPT_PAGE_ROLE.NEW_PAGE) {
    if (!hasAnyPageEvidence || !reliableExistingBaseline) {
      baseline.clicks = 0;
      baseline.impressions = 0;
      baseline.ctr = '';
      baseline.position = '';
      baseline.queryCount = 0;
      baseline.mode = 'NEW_URL_BASELINE';
    } else {
      baseline.mode = 'EXISTING_URL_BASELINE';
    }
  } else if (reliableExistingBaseline) {
    baseline.mode = 'EXISTING_URL_BASELINE';
  } else {
    baseline.clicks = 0;
    baseline.impressions = 0;
    baseline.ctr = '';
    baseline.position = '';
    baseline.queryCount = 0;
    baseline.mode = 'EXISTING_URL_NO_GSC_TRAFFIC';
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
      var repairedRow = ledgerRowFromFields_(packed, fields, row);
      packed.sheet.getRange(rowIndex, 1, 1, packed.header.length).setValues([repairedRow]);
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
    'DevelopmentTaskID': plan.developmentTaskId,
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
    'OpportunityID': plan.opportunityId,
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
  var match = findDeploymentContentPage_(packed, plan, page);
  if (match) {
    var current = packed.rows[match.rowIndex - 2];
    var nextRow = ledgerRowFromFields_(packed, fields, current);
    var changed = false;
    for (var hi = 0; hi < packed.header.length; hi++) {
      var header = String(packed.header[hi] || '').trim();
      if (!header || !Object.prototype.hasOwnProperty.call(fields, header)) continue;
      if (!ledgerBlank_(nextRow[hi]) && String(current[hi] || '') !== String(nextRow[hi] || '')) {
        changed = true;
        break;
      }
    }
    if (changed) {
      packed.sheet.getRange(match.rowIndex, 1, 1, packed.header.length).setValues([nextRow]);
      return { action: 'update', duplicate: true, rowIndex: match.rowIndex, unchanged: false };
    }
    return { action: 'unchanged', duplicate: true, rowIndex: match.rowIndex, unchanged: true };
  }
  var row = ledgerRowFromFields_(packed, fields, null);
  packed.sheet.appendRow(row);
  return { action: 'insert', duplicate: false, rowIndex: packed.sheet.getLastRow(), unchanged: false };
}

function findDeploymentContentPage_(packed, plan, page) {
  var pageKeyCol = packed.map.PageReceiptKey;
  if (pageKeyCol === undefined) return null;
  for (var i = 0; i < packed.rows.length; i++) {
    if (String(packed.rows[i][pageKeyCol] || '').trim() === page.pageReceiptKey) {
      return { rowIndex: i + 2 };
    }
  }
  return null;
}

function upsertDeploymentTimelineIfMissing_(plan) {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_TIMELINE);
  var fields = buildDeploymentTimelineFields_(plan);
  var idCol = packed.map.InterventionID;
  if (idCol !== undefined) {
    for (var i = 0; i < packed.rows.length; i++) {
      if (String(packed.rows[i][idCol] || '').trim() !== plan.interventionId) continue;
      var timeCol = packed.map['时间（UTC+8）'];
      if (timeCol !== undefined && String(packed.rows[i][timeCol] || '').trim() !== fields['时间（UTC+8）']) {
        packed.sheet.getRange(i + 2, timeCol + 1).setValue(fields['时间（UTC+8）']);
      }
      return false;
    }
  }
  packed.sheet.appendRow(ledgerRowFromFields_(packed, fields, null));
  return true;
}

function buildDeploymentTimelineFields_(plan) {
  var scope = plan.pages.map(function (p) { return p.path; });
  var trigger = plan.pages.map(function (p) {
    return { type: p.triggerType, queries: p.triggerQueries, summary: p.triggerSummary };
  });
  var evidence = plan.pages.map(function (p) {
    return { path: p.path, baselineDataDate: p.baseline.dataDate, mode: p.baseline.mode,
      clicks7D: p.baseline.clicks, impressions7D: p.baseline.impressions };
  });
  var observationWindow = plan.pages.length + ' pages × D1/D3/D7/D14';
  return {
    'InterventionID': plan.interventionId,
    '时间（UTC+8）': ledgerDeployedAtDisplay_(plan.deployedAt),
    '相对发售日': plan.releaseOffsetDay === '' ? '' :
      'D' + (Number(plan.releaseOffsetDay) >= 0 ? '+' : '') + Number(plan.releaseOffsetDay),
    '生命周期': plan.lifecyclePhase,
    '批次/阶段': plan.batchId,
    '动作类型': plan.action,
    '目标页面/范围': JSON.stringify(scope),
    '触发信号': JSON.stringify(trigger),
    '动作前证据': JSON.stringify(evidence),
    'Git Commit': plan.commitSha,
    '证据来源': 'Deployment Receipt',
    '观察窗口': observationWindow,
    '观察到的数据变化': 'PENDING',
    '归因判断': 'PENDING',
    '置信度': 'PENDING',
    'DecisionID': plan.decisionId,
    '回溯状态': 'RECEIPT_AUTO',
    '混杂因素': '',
    '下次评估': addDaysStr_(plan.deployedDate, 1),
    '备注': plan.goalId || ''
  };
}

function buildDeploymentTimelineRow_(plan) {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_TIMELINE);
  return ledgerRowFromFields_(packed, buildDeploymentTimelineFields_(plan), null);
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
      var targetDate = existing ? ledgerDateCell_(existing.row, packed.map, 'TargetDate') : '';
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
  base.deployedDate = base.deployedDate || ledgerDateCell_(first, map, '更新时间');
  base.deployedAt = base.deployedAt || ledgerRawCell_(first, map, '更新时间') || base.deployedDate;
  base.productionUrl = base.productionUrl || ledgerCell_(first, map, 'PrimaryURL');
  base.recordedMode = ledgerCell_(first, map, 'RecordedMode');
  base.goalId = ledgerCell_(first, map, 'GoalID');
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
        dataDate: ledgerDateCell_(row, map, 'BaselineDataDate'),
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
          plan.pages[p].action,
          plan.pages[p].pageRole
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

/**
 * One-time, idempotent repair for the already-created P.I.T.T. receipt rows.
 * This is intentionally not a general migration: it neither deletes rows nor
 * creates rows, and it refuses to run unless the known 5x4 set is present.
 */
function repairPittInterventionObservations() {
  var interventionId = 'PITT-LONGTAIL-CAPTURE-20260824';
  var pages = ['/', '/up-achievement-fuses/', '/200kg-plate/', '/percentage-pipe/', '/secret-ending/'];
  var schedule = { D1: '2026-08-25', D3: '2026-08-27', D7: '2026-08-31', D14: '2026-09-07' };
  var horizons = ['D1', 'D3', 'D7', 'D14'];
  var clearFields = [
    'ObservedDataDate', 'ObservedClicks7D', 'ObservedImpressions7D', 'ObservedCTR',
    'ObservedPosition', 'ObservedQueryCount7D', 'ObservedSiteClicks7D',
    'ObservedSiteImpressions7D', 'ClicksDelta', 'ImpressionsDelta', 'CTRDelta',
    'PositionImprovement', 'QueryCountDelta', 'Outcome', 'OutcomeConfidence'
  ];
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.INTERVENTION_OBSERVATIONS);
  if (!sheet) throw new Error('repairPittInterventionObservations: missing 干预观察 sheet');
  var packed = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_OBSERVATIONS);
  var matched = {};
  var duplicate = {};
  for (var i = 0; i < packed.rows.length; i++) {
    var row = packed.rows[i];
    if (String(ledgerRawCell_(row, packed.map, 'InterventionID') || '').trim() !== interventionId) continue;
    var observationId = String(ledgerRawCell_(row, packed.map, 'ObservationID') || '').trim();
    var rawPrimaryUrl = ledgerRawCell_(row, packed.map, 'PrimaryURL');
    var path = rawPrimaryUrl ? ledgerNormalizePath_(rawPrimaryUrl) : '';
    var horizon = String(ledgerRawCell_(row, packed.map, 'Horizon') || '').trim();
    if ((!path || !schedule[horizon]) && observationId) {
      var parts = observationId.split('|');
      if (parts.length >= 3) {
        path = ledgerNormalizePath_(parts[parts.length - 2]);
        horizon = parts[parts.length - 1];
      }
    }
    var key = path + '|' + horizon;
    if (pages.indexOf(path) < 0 || !schedule[horizon]) continue;
    if (matched[key]) duplicate[key] = true;
    else matched[key] = { row: row, rowIndex: i + 2, path: path, horizon: horizon };
  }
  var expected = pages.length * horizons.length;
  if (Object.keys(duplicate).length || Object.keys(matched).length !== expected) {
    throw new Error(
      'repairPittInterventionObservations: expected exactly ' + expected +
      ' unique rows, found ' + Object.keys(matched).length
    );
  }
  var repaired = 0;
  Object.keys(matched).forEach(function (key) {
    var item = matched[key];
    var isHome = item.path === '/';
    var values = {
      TargetDate: schedule[item.horizon],
      Status: 'WAITING_HORIZON',
      BaselineClicks7D: isHome ? 7 : 0,
      BaselineImpressions7D: isHome ? 139 : 0,
      BaselineCTR: isHome ? 0.05035971223 : '',
      BaselinePosition: isHome ? 7.057553957 : '',
      BaselineQueryCount7D: isHome ? ledgerRawCell_(item.row, packed.map, 'BaselineQueryCount7D') || 0 : 0,
      BaselineSiteClicks7D: 7,
      BaselineSiteImpressions7D: 139,
      BaselineMode: isHome ? 'FROZEN_BASELINE' :
        (item.path === '/up-achievement-fuses/' || item.path === '/200kg-plate/'
          ? 'EXISTING_URL_NO_GSC_TRAFFIC' : 'NEW_URL_BASELINE'),
      AttributionMode: 'INTERVENTION_NATIVE',
      Confounders: '',
      UpdatedAt: nowRecordedAt_()
    };
    for (var c = 0; c < clearFields.length; c++) values[clearFields[c]] = '';
    var next = packed.header.map(function (header, index) {
      return Object.prototype.hasOwnProperty.call(values, header) ? values[header] : item.row[index];
    });
    var changed = false;
    for (var n = 0; n < next.length; n++) {
      if (next[n] !== item.row[n]) { changed = true; break; }
    }
    if (changed) {
      packed.sheet.getRange(item.rowIndex, 1, 1, packed.header.length).setValues([next]);
      repaired++;
    }
  });
  return { ok: true, interventionId: interventionId, observations: expected, repaired: repaired };
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

var STEAM_PROJECT_POOL_SHEET_ID = '1WVg2p_Vero3MB2JN4yxmtHkLQRgkWO2mz95X4ms9nLE';

/** Read-only helper: latest GSC snapshot sitemap inventory for one SiteID. */
function inspectGscSitemapUrlCount(siteId) {
  siteId = String(siteId || '').trim();
  if (!siteId) throw new Error('inspectGscSitemapUrlCount: siteId required');
  var detail = readLatestGscSnapshotForSite_(siteId);
  return {
    siteId: siteId,
    sitemapUrlCount: detail.sitemapUrlCount,
    runDate: detail.runDate,
    site: detail.site,
    propertyURL: detail.propertyURL
  };
}

function readLatestGscSnapshotForSite_(siteId) {
  var siteName = '';
  var sitesPacked = loadLedgerSheetRows_(SHEET_NAMES.SITES);
  var siteIdCol = sitesPacked.map.site_id;
  var siteNameCol = sitesPacked.map['站点名称'];
  if (siteIdCol !== undefined) {
    for (var s = 0; s < sitesPacked.rows.length; s++) {
      if (String(sitesPacked.rows[s][siteIdCol] || '').trim() !== siteId) continue;
      if (siteNameCol !== undefined) siteName = String(sitesPacked.rows[s][siteNameCol] || '').trim();
      break;
    }
  }
  var packed = loadLedgerSheetRows_(SHEET_NAMES.SNAPSHOT);
  var snapshotSiteIdCol = packed.map.site_id;
  var siteCol = packed.map.Site;
  var countCol = packed.map.SitemapURLCount;
  var runCol = packed.map.RunDate;
  var propertyCol = packed.map.PropertyURL;
  var best = { date: '', count: 0, site: siteName, propertyURL: '' };
  for (var i = 0; i < packed.rows.length; i++) {
    var rowSiteId = snapshotSiteIdCol === undefined ? '' : String(packed.rows[i][snapshotSiteIdCol] || '').trim();
    var rowSiteName = siteCol === undefined ? '' : String(packed.rows[i][siteCol] || '').trim();
    var matches = rowSiteId === siteId || (siteName && rowSiteName === siteName);
    if (!matches) continue;
    var runDate = runCol === undefined ? '' : String(packed.rows[i][runCol] || '').trim();
    var count = countCol === undefined ? 0 : (Number(packed.rows[i][countCol] || 0) || 0);
    if (!best.date || runDate >= best.date) {
      best.date = runDate;
      best.count = count;
      best.site = rowSiteName || siteName;
      best.propertyURL = propertyCol === undefined ? '' : String(packed.rows[i][propertyCol] || '').trim();
    }
  }
  return {
    sitemapUrlCount: best.count,
    runDate: best.date,
    site: best.site,
    propertyURL: best.propertyURL
  };
}

function readGscSitemapUrlCountForSite_(siteId) {
  return readLatestGscSnapshotForSite_(siteId).sitemapUrlCount;
}

/** Remote ops bridge: refresh one Steam site-pool LaunchPageCount from GSC snapshot inventory. */
function syncSteamSitePoolLaunchPageCount(siteId) {
  siteId = String(siteId || '').trim();
  if (!siteId) throw new Error('syncSteamSitePoolLaunchPageCount: siteId required');
  var sitemapUrlCount = readGscSitemapUrlCountForSite_(siteId);
  var ss = SpreadsheetApp.openById(STEAM_PROJECT_POOL_SHEET_ID);
  var poolSheet = ss.getSheetByName('站点项目池');
  if (!poolSheet || poolSheet.getLastRow() < 2) {
    throw new Error('syncSteamSitePoolLaunchPageCount: 站点项目池 missing');
  }
  var headers = poolSheet.getRange(1, 1, 1, poolSheet.getLastColumn()).getDisplayValues()[0];
  var siteCol = headers.indexOf('Site ID');
  var launchCol = headers.indexOf('LaunchPageCount');
  if (siteCol < 0 || launchCol < 0) {
    throw new Error('syncSteamSitePoolLaunchPageCount: required columns missing');
  }
  var rows = poolSheet.getRange(2, 1, poolSheet.getLastRow() - 1, headers.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][siteCol] || '').trim() !== siteId) continue;
    var previous = Number(rows[i][launchCol] || 0) || 0;
    var updated = false;
    if (sitemapUrlCount > 0 && sitemapUrlCount !== previous) {
      poolSheet.getRange(i + 2, launchCol + 1).setValue(sitemapUrlCount);
      updated = true;
    }
    return {
      ok: true,
      siteId: siteId,
      previousLaunchPageCount: previous,
      launchPageCount: updated ? sitemapUrlCount : previous,
      sitemapUrlCount: sitemapUrlCount,
      updated: updated
    };
  }
  throw new Error('syncSteamSitePoolLaunchPageCount: site not found: ' + siteId);
}
