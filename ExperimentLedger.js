/**
 * Automatic Experiment Ledger — production publish receipt writeback.
 * recordPublishedBatch 是 Execution API 公共入口；幂等写入「内容更新记录」。
 * Outcome 观察窗口以 receipt.common.deployedAt 为锚，不使用补写/重试时间。
 * 所有写入按 bound Sheet header name → column index，禁止 positional 漂移。
 */

var PUBLISH_RECEIPT_SCHEMA_V1 = 'hotword-publish-receipt-v1';
var PUBLISH_LEDGER_SOURCE_PREFIX = 'hotword-publish:';
var LEDGER_RECORDED_MODE = 'REALTIME';

/**
 * @param {Object} receipt hotword-publish-receipt-v1
 * @return {{ok:boolean,batchId:string,interventions:Array,inserted:number,updated:number,skipped:number}}
 */
function recordPublishedBatch(receipt) {
  receipt = receipt || {};
  if (String(receipt.schemaVersion || '') !== PUBLISH_RECEIPT_SCHEMA_V1) {
    throw new Error('recordPublishedBatch: schemaVersion must be ' + PUBLISH_RECEIPT_SCHEMA_V1);
  }
  if (receipt.repairSchema === true) {
    var repairBatchId = String((receipt.common || {}).batchId || '').trim();
    return repairPublishedBatchLedger_(repairBatchId, receipt);
  }
  var plan = planPublishedBatch_(receipt);
  var applied = applyPublishedBatchPlan_(plan);
  var obs = syncInterventionObservationsForBatch_(plan, applied.interventions);
  writeLog_(
    'INFO',
    plan.siteName,
    'recordPublishedBatch batch=' +
      plan.batchId +
      ' inserted=' +
      applied.inserted +
      ' updated=' +
      applied.updated +
      ' skipped=' +
      applied.skipped +
      ' observations=' +
      obs.appended +
      ' obsUpdated=' +
      obs.updated +
      ' deployedAt=' +
      plan.deployedAt
  );
  return {
    ok: true,
    batchId: plan.batchId,
    deployedAt: plan.deployedAt,
    inserted: applied.inserted,
    updated: applied.updated,
    skipped: applied.skipped,
    observations: obs,
    interventions: applied.interventions
  };
}

function planPublishedBatch_(receipt) {
  var common = receipt.common || {};
  var siteName = String(common.site || '').trim();
  var siteId = String(common.siteId || '').trim();
  var batchId = String(common.batchId || '').trim();
  var deployedAt = String(common.deployedAt || '').trim();
  if (!siteName || !siteId || !batchId || !deployedAt) {
    throw new Error('recordPublishedBatch: common.site/siteId/batchId/deployedAt are required');
  }
  var deployedLocalDate = deployedLocalDateFromIso_(deployedAt);
  if (!deployedLocalDate) {
    throw new Error('recordPublishedBatch: invalid deployedAt=' + deployedAt);
  }

  var siteObj = findEnabledSiteByNameOrId_(siteName, siteId);
  var dailyRows = loadDailyRowsForSiteName_(siteObj ? siteObj.name : siteName);
  var baseline = resolvePublishBaseline_(dailyRows, deployedLocalDate);
  var baselineDataDate = baseline.baselineDataDate;
  var baselineMode = baseline.baselineMode;
  var existingKeys = loadPublishLedgerKeySet_();
  var historyIds = loadDecisionIdSetFromHistory_();
  var devTasks = loadDevelopmentTaskMap_();
  var recordedAtDefault = nowRecordedAt_();
  var releaseDate = normalizeKeyDate_(common.releaseDate);
  var releaseOffsetDay = ledgerReleaseOffsetDay_(releaseDate, deployedLocalDate);

  var interventions = receipt.interventions || [];
  var writes = [];
  var updates = [];
  var outputs = [];
  var skipped = 0;

  for (var i = 0; i < interventions.length; i++) {
    var rawItem = interventions[i];
    var item = enrichPublishedIntervention_(rawItem, common, devTasks);
    var ledgerKey = buildPublishInterventionLedgerKey_(
      batchId,
      siteId,
      item.pagePath,
      item.action,
      item.targetQuery
    );
    var pageReceiptKey = buildPageReceiptKey_(rawItem, ledgerKey);
    var existing = existingKeys[pageReceiptKey] || existingKeys[ledgerKey];
    var interventionId = existing && existing.interventionId
      ? existing.interventionId
      : buildPublishInterventionId_(ledgerKey);
    var publishFields = buildPublishReceiptFields_(
      rawItem,
      item,
      common,
      deployedAt,
      recordedAtDefault,
      ledgerKey,
      pageReceiptKey,
      interventionId,
      baselineDataDate,
      releaseDate,
      releaseOffsetDay
    );
    existing = existingKeys[pageReceiptKey] || existingKeys[ledgerKey];
    if (existing) {
      var mergedFields = mergePublishReceiptFields_(existing.publishFields, publishFields);
      var updatePlan = planContentInterventionWrite_(
        {
          updateDate: existing.updateDate || deployedLocalDate,
          site: siteName,
          pagePath: item.pagePath,
          source: PUBLISH_LEDGER_SOURCE_PREFIX + ledgerKey,
          note: buildPublishInterventionNote_(item),
          updateType: item.action,
          decisionId: item.decisionId,
          publishFields: mergedFields
        },
        historyIds
      );
      if (updatePlan.reject) {
        throw new Error('recordPublishedBatch: ' + updatePlan.warning);
      }
      updates.push({
        rowIndex: existing.rowIndex,
        fields: mergeContentUpdateFields_(existing.fields, planRowToFields_(updatePlan.row)),
        ledgerKey: ledgerKey,
        pageReceiptKey: pageReceiptKey,
        interventionId: existing.interventionId || interventionId,
        decisionId: item.decisionId,
        baselineDataDate: existing.baselineDataDate || baselineDataDate,
        updateDate: existing.updateDate || deployedLocalDate,
        primaryUrl: item.pagePath,
        action: item.action,
        baselineMode: baselineMode,
        skipped: false,
        updated: true
      });
      outputs.push({
        interventionId: existing.interventionId || interventionId,
        ledgerKey: ledgerKey,
        pageReceiptKey: pageReceiptKey,
        baselineDataDate: existing.baselineDataDate || baselineDataDate,
        updateDate: existing.updateDate || deployedLocalDate,
        publishFields: mergedFields,
        skipped: true,
        updated: true
      });
      continue;
    }

    var plan = planContentInterventionWrite_(
      {
        updateDate: deployedLocalDate,
        site: siteName,
        pagePath: item.pagePath,
        source: PUBLISH_LEDGER_SOURCE_PREFIX + ledgerKey,
        note: buildPublishInterventionNote_(item),
        updateType: item.action,
        decisionId: item.decisionId,
        publishFields: publishFields
      },
      historyIds
    );
    if (plan.reject) {
      throw new Error('recordPublishedBatch: ' + plan.warning);
    }
    if (plan.warning) {
      writeLog_('WARN', siteName, plan.warning);
    }
    writes.push({
      fields: planRowToFields_(plan.row),
      ledgerKey: ledgerKey,
      pageReceiptKey: pageReceiptKey,
      interventionId: interventionId,
      decisionId: item.decisionId,
      baselineDataDate: baselineDataDate,
      updateDate: deployedLocalDate,
      primaryUrl: item.pagePath,
      action: item.action,
      baselineMode: baselineMode,
      publishFields: publishFields,
      skipped: false,
      updated: false
    });
    outputs.push({
      interventionId: interventionId,
      ledgerKey: ledgerKey,
      pageReceiptKey: pageReceiptKey,
      baselineDataDate: baselineDataDate,
      updateDate: deployedLocalDate,
      publishFields: publishFields,
      skipped: false,
      updated: false
    });
  }

  return {
    siteName: siteName,
    siteId: siteId,
    batchId: batchId,
    deployedAt: deployedAt,
    deployedLocalDate: deployedLocalDate,
    receiptKey: buildBatchReceiptKey_(receipt),
    writes: writes,
    updates: updates,
    outputs: outputs,
    skipped: skipped
  };
}

function applyPublishedBatchPlan_(plan) {
  repairContentUpdateDuplicateHeaders_();
  ensureSheet_(SHEET_NAMES.CONTENT_UPDATES, CONTENT_UPDATE_HEADERS);
  ensureContentUpdateHeader_();
  ensureLedgerHeader_(SHEET_NAMES.INTERVENTION_OBSERVATIONS, INTERVENTION_OBSERVATION_HEADERS);
  var packed = loadLedgerSheetRows_(SHEET_NAMES.CONTENT_UPDATES);
  var inserted = 0;
  var updated = 0;
  var interventions = [];
  var writes = plan.writes || [];
  var updates = plan.updates || [];

  for (var i = 0; i < writes.length; i++) {
    var w = writes[i];
    var row = ledgerRowFromFields_(packed, w.fields);
    packed.sheet.appendRow(row);
    inserted++;
    interventions.push({
      interventionId: w.interventionId,
      ledgerKey: w.ledgerKey,
      pageReceiptKey: w.pageReceiptKey,
      decisionId: w.decisionId,
      baselineDataDate: w.baselineDataDate,
      baselineMode: w.baselineMode,
      updateDate: w.updateDate,
      primaryUrl: normalizePublishPathOnly_(w.primaryUrl),
      action: w.action,
      publishFields: w.publishFields,
      skipped: false,
      updated: false
    });
  }

  for (var u = 0; u < updates.length; u++) {
    var upd = updates[u];
    var current = packed.rows[upd.rowIndex - 2] || [];
    var nextRow = ledgerRowFromFields_(packed, upd.fields, current);
    packed.sheet.getRange(upd.rowIndex, 1, 1, packed.header.length).setValues([nextRow]);
    updated++;
    interventions.push({
      interventionId: upd.interventionId,
      ledgerKey: upd.ledgerKey,
      pageReceiptKey: upd.pageReceiptKey,
      decisionId: upd.decisionId,
      baselineDataDate: upd.baselineDataDate,
      baselineMode: upd.baselineMode,
      updateDate: upd.updateDate,
      primaryUrl: normalizePublishPathOnly_(upd.primaryUrl),
      action: upd.action,
      publishFields: publishFieldsFromContentUpdateFields_(upd.fields),
      skipped: true,
      updated: true
    });
  }

  return {
    inserted: inserted,
    updated: updated,
    skipped: plan.skipped || 0,
    interventions: interventions
  };
}

function mergeContentUpdateFields_(existing, incoming) {
  existing = existing || {};
  incoming = incoming || {};
  var out = {};
  var keys = Object.keys(existing).concat(Object.keys(incoming));
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (out[key] !== undefined) continue;
    var next = incoming[key];
    var prev = existing[key];
    if (key === 'RecordedAt') out[key] = prev || next;
    else out[key] = ledgerBlank_(next) ? prev : next;
  }
  return out;
}

function enrichPublishedIntervention_(item, common, devTasks) {
  item = item || {};
  common = common || {};
  var productionUrl = String(common.productionUrl || '').trim();
  var pagePath = normalizePublishPagePath_(item.primaryUrl, productionUrl);
  var action = String(item.action || '').trim().toUpperCase();
  var targetQuery = primaryPublishTargetQuery_(item);
  var decisionId = String(item.decisionId || common.decisionId || '').trim();
  var devTaskId = String(item.developmentTaskId || common.developmentTaskId || '').trim();
  if (devTaskId && devTasks[devTaskId]) {
    var task = devTasks[devTaskId];
    if (!decisionId && task.decisionId) decisionId = task.decisionId;
    if (!action && task.actionType) action = String(task.actionType || '').trim().toUpperCase();
    if (!pagePath && task.pagePath) pagePath = normalizePublishPagePath_(task.pagePath, productionUrl);
  }
  if (!action) action = 'OTHER';
  return {
    pagePath: pagePath,
    primaryUrl: pagePath,
    action: action,
    targetQuery: targetQuery,
    decisionId: decisionId,
    developmentTaskId: devTaskId,
    opportunityId: String(item.opportunityId || common.opportunityId || '').trim(),
    reason: String(item.reason || '').trim(),
    changeSummary: String(item.changeSummary || '').trim(),
    triggerSummary: String(item.triggerSummary || '').trim(),
    triggerType: String(item.triggerType || '').trim(),
    triggerQueries: Array.isArray(item.triggerQueries) ? item.triggerQueries : [],
    affectedUrls: Array.isArray(item.affectedUrls) ? item.affectedUrls : [],
    sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs : [],
    goalId: String(item.goalId || common.goalId || '').trim()
  };
}

function buildBatchReceiptKey_(receipt) {
  receipt = receipt || {};
  var common = receipt.common || {};
  return String(receipt.launchReceiptKey || common.launchReceiptKey || common.batchId || '').trim();
}

function buildPageReceiptKey_(item, ledgerKey) {
  item = item || {};
  return String(item.interventionId || item.pageReceiptKey || ledgerKey || '').trim();
}

function joinPublishListField_(values) {
  if (!values || !values.length) return '';
  return values
    .map(function (v) {
      return String(v || '').trim();
    })
    .filter(Boolean)
    .join('|');
}

function buildPublishReceiptFields_(
  rawItem,
  item,
  common,
  deployedAt,
  recordedAt,
  ledgerKey,
  pageReceiptKey,
  interventionId,
  baselineDataDate,
  releaseDate,
  releaseOffsetDay
) {
  common = common || {};
  item = item || {};
  rawItem = rawItem || {};
  return {
    InterventionID: String(interventionId || '').trim(),
    SiteID: String(common.siteId || '').trim(),
    BatchID: String(common.batchId || '').trim(),
    Action: String(item.action || '').trim(),
    PrimaryURL: String(item.pagePath || '').trim(),
    AffectedURLs: joinPublishListField_(item.affectedUrls),
    TriggerType: String(item.triggerType || '').trim(),
    TriggerQueries: joinPublishListField_(item.triggerQueries),
    TriggerSummary: String(item.triggerSummary || '').trim(),
    SourceRefs: joinPublishListField_(item.sourceRefs),
    Reason: String(item.reason || '').trim(),
    LifecyclePhase: String(common.lifecyclePhase || rawItem.lifecyclePhase || '').trim(),
    ReleaseDate: String(releaseDate || '').trim(),
    ReleaseOffsetDay: releaseOffsetDay === '' || releaseOffsetDay === null || releaseOffsetDay === undefined
      ? ''
      : String(releaseOffsetDay),
    CommitSHA: String(common.commitSha || rawItem.commitSha || '').trim(),
    DeploymentURL: String(common.deploymentUrl || rawItem.deploymentUrl || '').trim(),
    ProductionURL: String(common.productionUrl || rawItem.productionUrl || '').trim(),
    ProductionDeployedAt: String(deployedAt || common.deployedAt || rawItem.deployedAt || '').trim(),
    DevelopmentTaskID: String(item.developmentTaskId || common.developmentTaskId || '').trim(),
    OpportunityID: String(item.opportunityId || common.opportunityId || '').trim(),
    RecordedMode: LEDGER_RECORDED_MODE,
    BaselineDataDate: String(baselineDataDate || '').trim(),
    ReceiptKey: buildBatchReceiptKey_({ common: common }),
    RecordedAt: String(recordedAt || '').trim(),
    PageReceiptKey: String(pageReceiptKey || '').trim(),
    GoalID: String(item.goalId || '').trim()
  };
}

function mergePublishReceiptFields_(existing, incoming) {
  existing = existing || {};
  incoming = incoming || {};
  var out = {};
  for (var i = 0; i < CONTENT_UPDATE_PUBLISH_FIELD_HEADERS.length; i++) {
    var key = CONTENT_UPDATE_PUBLISH_FIELD_HEADERS[i];
    var next = incoming[key];
    var prev = existing[key];
    if (key === 'RecordedAt' || key === 'InterventionID') out[key] = prev || next;
    else out[key] = ledgerBlank_(next) ? prev : next;
  }
  return out;
}

function publishFieldsFromContentUpdateFields_(fields) {
  fields = fields || {};
  var out = {};
  for (var i = 0; i < CONTENT_UPDATE_PUBLISH_FIELD_HEADERS.length; i++) {
    var key = CONTENT_UPDATE_PUBLISH_FIELD_HEADERS[i];
    out[key] = fields[key] !== undefined ? String(fields[key] || '').trim() : '';
  }
  return out;
}

function publishFieldsFromContentUpdateRow_(row, headerMap) {
  row = row || [];
  headerMap = headerMap || headerIndexMap_(CONTENT_UPDATE_HEADERS);
  var out = {};
  for (var i = 0; i < CONTENT_UPDATE_PUBLISH_FIELD_HEADERS.length; i++) {
    var key = CONTENT_UPDATE_PUBLISH_FIELD_HEADERS[i];
    var idx = headerMap[key];
    out[key] = idx === undefined ? '' : String(row[idx] || '').trim();
  }
  return out;
}

function buildPublishInterventionLedgerKey_(batchId, siteId, pagePath, changeType, targetQuery) {
  return [
    String(batchId || '').trim(),
    String(siteId || '').trim(),
    normalizePublishPagePath_(pagePath, ''),
    String(changeType || '').trim().toUpperCase(),
    String(targetQuery || '').trim().toLowerCase()
  ].join('|');
}

function buildPublishInterventionId_(ledgerKey) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(ledgerKey || '')
  );
  var hex = digest
    .map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    })
    .join('');
  return 'iv-' + hex.substring(0, 16);
}

function ledgerKeyFromPublishSource_(source) {
  source = String(source || '').trim();
  if (source.indexOf(PUBLISH_LEDGER_SOURCE_PREFIX) !== 0) return '';
  return source.substring(PUBLISH_LEDGER_SOURCE_PREFIX.length);
}

function buildPublishInterventionNote_(item) {
  item = item || {};
  var parts = [];
  if (item.reason) parts.push(item.reason);
  if (item.changeSummary && item.changeSummary !== item.reason) parts.push(item.changeSummary);
  if (item.triggerSummary) parts.push('trigger=' + item.triggerSummary);
  return parts.join(' | ');
}

function primaryPublishTargetQuery_(item) {
  var queries = item && item.triggerQueries;
  if (!queries || !queries.length) return '';
  return String(queries[0] || '').trim().toLowerCase();
}

function publishPathnameFromAbsoluteUrl_(raw) {
  var value = String(raw || '').trim();
  if (!/^https?:\/\//i.test(value)) return '';
  try {
    return normalizePublishPathOnly_(new URL(value).pathname || '/');
  } catch (e) {
    var match = /^https?:\/\/[^\/?#]+(\/[^?#]*)?/i.exec(value);
    return normalizePublishPathOnly_(match ? match[1] || '/' : '/');
  }
}

function normalizePublishPagePath_(pagePath, productionUrl) {
  var raw = String(pagePath || '').trim();
  if (!raw) return '/';
  if (/^\/+https?:\/\//i.test(raw)) {
    raw = raw.replace(/^\/+/, '');
  }
  if (/^https?:\/\//i.test(raw)) {
    return publishPathnameFromAbsoluteUrl_(raw);
  }
  return normalizePublishPathOnly_(raw);
}

function normalizePublishPathOnly_(raw) {
  var value = String(raw || '').trim();
  if (/^\/+https?:\/\//i.test(value)) {
    value = value.replace(/^\/+/, '');
    if (/^https?:\/\//i.test(value)) {
      return publishPathnameFromAbsoluteUrl_(value);
    }
  }
  if (!value || value === '/') return '/';
  return '/' + value.replace(/^\/+|\/+$/g, '') + '/';
}

function normalizePublishLedgerKey_(ledgerKey) {
  var parts = String(ledgerKey || '').trim().split('|');
  if (parts.length < 3) return String(ledgerKey || '').trim();
  parts[2] = normalizePublishPagePath_(parts[2], '');
  return parts.join('|');
}

function resolvePublishBaseline_(dailyRows, deployedLocalDate) {
  var baselineDataDate = latestAlignedGscDateBefore_(dailyRows, deployedLocalDate);
  return {
    baselineDataDate: baselineDataDate,
    baselineMode: baselineDataDate ? BASELINE_MODE.GSC_ALIGNED : BASELINE_MODE.NO_PREDEPLOY_DATA
  };
}

function deployedLocalDateFromIso_(deployedAtIso) {
  var text = String(deployedAtIso || '').trim();
  if (!text) return '';
  var d = new Date(text);
  if (isNaN(d.getTime())) return normalizeKeyDate_(text);
  return Utilities.formatDate(d, GSC_TIMEZONE, 'yyyy-MM-dd');
}

function ledgerReleaseOffsetDay_(releaseDate, deployedDate) {
  var release = normalizeKeyDate_(releaseDate);
  var deployed = normalizeKeyDate_(deployedDate);
  if (!release || !deployed) return '';
  return daysBetweenStr_(release, deployed);
}

function latestAlignedGscDateBefore_(dailyRows, beforeDate) {
  var before = normalizeKeyDate_(beforeDate);
  if (!before) return '';
  var latest = '';
  var rows = dailyRows || [];
  for (var i = 0; i < rows.length; i++) {
    var dataDate = normalizeKeyDate_(rows[i][0]);
    if (!dataDate || dataDate >= before) continue;
    if (!latest || dataDate > latest) latest = dataDate;
  }
  return latest;
}

function loadPublishLedgerKeySet_() {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.CONTENT_UPDATES);
  var map = {};
  if (!packed.rows.length) return map;
  for (var i = 0; i < packed.rows.length; i++) {
    var row = packed.rows[i];
    var pageReceiptKey = ledgerCell_(row, packed.map, 'PageReceiptKey');
    var source = ledgerCell_(row, packed.map, '来源');
    var ledgerKey = '';
    if (source.indexOf(PUBLISH_LEDGER_SOURCE_PREFIX) === 0) {
      ledgerKey = source.substring(PUBLISH_LEDGER_SOURCE_PREFIX.length);
    }
    if (!pageReceiptKey && !ledgerKey) continue;
    var rawPageReceiptKey = pageReceiptKey;
    var rawLedgerKey = ledgerKey;
    if (ledgerKey) ledgerKey = normalizePublishLedgerKey_(ledgerKey);
    if (pageReceiptKey) pageReceiptKey = normalizePublishLedgerKey_(pageReceiptKey);
    var fields = contentUpdateFieldsFromRow_(row, packed.map);
    var entry = {
      rowIndex: i + 2,
      interventionId: ledgerCell_(row, packed.map, 'InterventionID') ||
        buildPublishInterventionId_(ledgerKey || pageReceiptKey),
      updateDate: ledgerDateCell_(row, packed.map, '更新时间') ||
        String(row[0] || '').trim(),
      baselineDataDate: ledgerCell_(row, packed.map, 'BaselineDataDate'),
      fields: fields,
      publishFields: publishFieldsFromContentUpdateFields_(fields)
    };
    if (pageReceiptKey) map[pageReceiptKey] = entry;
    if (ledgerKey) map[ledgerKey] = entry;
    if (rawPageReceiptKey && rawPageReceiptKey !== pageReceiptKey) map[rawPageReceiptKey] = entry;
    if (rawLedgerKey && rawLedgerKey !== ledgerKey) map[rawLedgerKey] = entry;
  }
  return map;
}

function contentUpdateFieldsFromRow_(row, map) {
  var fields = {};
  for (var i = 0; i < CONTENT_UPDATE_HEADERS.length; i++) {
    var header = CONTENT_UPDATE_HEADERS[i];
    var idx = map[header];
    fields[header] = idx === undefined ? '' : row[idx];
  }
  return fields;
}

function loadDailyRowsForSiteName_(siteName) {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DAILY);
  var range = getSheetDataRange_(sheet, 9);
  if (!range) return [];
  var values = range.getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').trim() !== siteName) continue;
    out.push(values[i]);
  }
  return out;
}

function findEnabledSiteByNameOrId_(siteName, siteId) {
  var sites = getEnabledSites();
  for (var i = 0; i < sites.length; i++) {
    if (sites[i].name === siteName) return sites[i];
  }
  for (var j = 0; j < sites.length; j++) {
    if (String(sites[j].id || sites[j].siteId || '').trim() === siteId) return sites[j];
  }
  return null;
}

function loadDevelopmentTaskMap_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DEVELOPMENT_TASKS);
  if (!sheet || sheet.getLastRow() < 2) return {};
  var lastCol = Math.max(sheet.getLastColumn(), DEVELOPMENT_TASK_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var map = {};
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var id = String(cell_(row, col, '开发任务ID') || '').trim();
    if (!id) continue;
    map[id] = {
      decisionId: String(cell_(row, col, 'DecisionID') || cell_(row, col, 'OpportunityID') || '').trim(),
      actionType: String(cell_(row, col, 'ActionType') || '').trim(),
      pagePath: String(cell_(row, col, '页面路径') || '').trim()
    };
  }
  return map;
}

function interventionObservationHorizonDefs_() {
  return INTERVENTION_OBSERVATION_HORIZONS.slice();
}

function buildInterventionObservationId_(interventionId, primaryUrl, horizon) {
  return [
    String(interventionId || '').trim(),
    normalizePublishPathOnly_(primaryUrl),
    String(horizon || '').trim()
  ].join('|');
}

function buildInterventionObservation_(opts) {
  opts = opts || {};
  var primaryUrl = normalizePublishPathOnly_(opts.primaryUrl || '/');
  var horizon = String(opts.horizon || '').trim();
  var interventionId = String(opts.interventionId || '').trim();
  return {
    ObservationID: buildInterventionObservationId_(interventionId, primaryUrl, horizon),
    InterventionID: interventionId,
    DecisionID: String(opts.decisionId || '').trim(),
    SiteID: String(opts.siteId || '').trim(),
    Site: String(opts.site || '').trim(),
    PrimaryURL: primaryUrl,
    Horizon: horizon,
    TargetDate: normalizeKeyDate_(opts.targetDate) || String(opts.targetDate || '').trim(),
    ObservedDataDate: normalizeKeyDate_(opts.observedDataDate) || String(opts.observedDataDate || '').trim(),
    Status: String(opts.status || OBSERVATION_STATUS.PENDING).trim() || OBSERVATION_STATUS.PENDING,
    BaselineDataDate: normalizeKeyDate_(opts.baselineDataDate) || String(opts.baselineDataDate || '').trim(),
    BaselineClicks7D: opts.baselineClicks7D === undefined ? '' : opts.baselineClicks7D,
    BaselineImpressions7D: opts.baselineImpressions7D === undefined ? '' : opts.baselineImpressions7D,
    BaselineCTR: opts.baselineCTR === undefined ? '' : opts.baselineCTR,
    BaselinePosition: opts.baselinePosition === undefined ? '' : opts.baselinePosition,
    BaselineQueryCount7D: opts.baselineQueryCount7D === undefined ? '' : opts.baselineQueryCount7D,
    ObservedClicks7D: opts.observedClicks7D === undefined ? '' : opts.observedClicks7D,
    ObservedImpressions7D: opts.observedImpressions7D === undefined ? '' : opts.observedImpressions7D,
    ObservedCTR: opts.observedCTR === undefined ? '' : opts.observedCTR,
    ObservedPosition: opts.observedPosition === undefined ? '' : opts.observedPosition,
    ObservedQueryCount7D: opts.observedQueryCount7D === undefined ? '' : opts.observedQueryCount7D,
    ClicksDelta: opts.clicksDelta === undefined ? '' : opts.clicksDelta,
    ImpressionsDelta: opts.impressionsDelta === undefined ? '' : opts.impressionsDelta,
    CTRDelta: opts.ctrDelta === undefined ? '' : opts.ctrDelta,
    PositionImprovement: opts.positionImprovement === undefined ? '' : opts.positionImprovement,
    QueryCountDelta: opts.queryCountDelta === undefined ? '' : opts.queryCountDelta,
    BaselineSiteImpressions7D: opts.baselineSiteImpressions7D === undefined ? '' : opts.baselineSiteImpressions7D,
    ObservedSiteImpressions7D: opts.observedSiteImpressions7D === undefined ? '' : opts.observedSiteImpressions7D,
    AttributionMode: String(opts.attributionMode || '').trim(),
    UpdatedAt: String(opts.updatedAt || '').trim(),
    BaselineSiteClicks7D: opts.baselineSiteClicks7D === undefined ? '' : opts.baselineSiteClicks7D,
    ObservedSiteClicks7D: opts.observedSiteClicks7D === undefined ? '' : opts.observedSiteClicks7D,
    BaselineMode: String(opts.baselineMode || '').trim(),
    Outcome: String(opts.outcome || '').trim(),
    OutcomeConfidence: String(opts.outcomeConfidence || '').trim(),
    Confounders: String(opts.confounders || '').trim()
  };
}

function observationRowFromObject_(observation, packed, current) {
  observation = observation || {};
  return packed.header.map(function (header, index) {
    if (Object.prototype.hasOwnProperty.call(observation, header)) return observation[header];
    return current && index < current.length ? current[index] : '';
  });
}

function loadInterventionObservationIndex_() {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_OBSERVATIONS);
  var map = {};
  if (!packed.rows.length) return map;
  for (var i = 0; i < packed.rows.length; i++) {
    var row = packed.rows[i];
    var observationId = ledgerCell_(row, packed.map, 'ObservationID');
    var interventionId = ledgerCell_(row, packed.map, 'InterventionID');
    var primaryUrl = normalizePublishPathOnly_(ledgerCell_(row, packed.map, 'PrimaryURL'));
    var horizon = ledgerCell_(row, packed.map, 'Horizon');
    if (!horizon) continue;
    var entry = { rowIndex: i + 2, row: row, map: packed.map };
    var canonicalId = buildInterventionObservationId_(interventionId, primaryUrl, horizon);
    if (observationId) map[observationId] = entry;
    if (canonicalId) map[canonicalId] = entry;
    if (interventionId) map[interventionId + '||' + horizon] = entry;
  }
  return map;
}

function findInterventionObservationHit_(existing, observationId, interventionId, primaryUrl, horizon) {
  return existing[observationId] ||
    existing[buildInterventionObservationId_(interventionId, primaryUrl, horizon)] ||
    existing[interventionId + '||' + horizon] ||
    null;
}

function dedupeInterventionObservationsForBatch_(plan, interventions) {
  var packed = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_OBSERVATIONS);
  if (!packed.rows.length) return { removed: 0 };
  var keepRows = {};
  (interventions || []).forEach(function (iv) {
    var primaryUrl = normalizePublishPathOnly_(iv.primaryUrl || '');
    INTERVENTION_OBSERVATION_HORIZONS.forEach(function (hz) {
      keepRows[buildInterventionObservationId_(iv.interventionId, primaryUrl, hz.name)] = true;
    });
  });
  var buckets = {};
  for (var i = 0; i < packed.rows.length; i++) {
    var row = packed.rows[i];
    var interventionId = ledgerCell_(row, packed.map, 'InterventionID');
    var isBatchIntervention = (interventions || []).some(function (iv) {
      return iv.interventionId === interventionId;
    });
    if (!isBatchIntervention) continue;
    var primaryUrl = normalizePublishPathOnly_(ledgerCell_(row, packed.map, 'PrimaryURL'));
    var horizon = ledgerCell_(row, packed.map, 'Horizon');
    var observationId = ledgerCell_(row, packed.map, 'ObservationID');
    var canonicalId = observationId ||
      buildInterventionObservationId_(interventionId, primaryUrl, horizon);
    if (!buckets[canonicalId]) buckets[canonicalId] = [];
    buckets[canonicalId].push({ rowIndex: i + 2, row: row, canonicalId: canonicalId });
  }
  var removed = 0;
  Object.keys(buckets).forEach(function (key) {
    var entries = buckets[key];
    if (entries.length <= 1) return;
    entries.sort(function (a, b) {
      var aGood = keepRows[a.canonicalId] ? 1 : 0;
      var bGood = keepRows[b.canonicalId] ? 1 : 0;
      if (aGood !== bGood) return bGood - aGood;
      return b.rowIndex - a.rowIndex;
    });
    for (var d = 1; d < entries.length; d++) {
      packed.sheet.deleteRow(entries[d].rowIndex);
      removed++;
    }
  });
  return { removed: removed };
}

function planInterventionObservationRows_(ctx) {
  ctx = ctx || {};
  var interventions = ctx.interventions || [];
  var plan = ctx.plan || {};
  var existing = ctx.existing || {};
  var updatedAt = ctx.updatedAt || nowRecordedAt_();
  var toAppend = [];
  var toUpdate = [];
  var horizons = interventionObservationHorizonDefs_();

  for (var i = 0; i < interventions.length; i++) {
    var iv = interventions[i] || {};
    var interventionId = String(iv.interventionId || '').trim();
    var primaryUrl = normalizePublishPathOnly_(iv.primaryUrl || iv.pagePath || '');
    if (!interventionId || !primaryUrl) continue;
    var deployedAt = String(
      (iv.publishFields && iv.publishFields.ProductionDeployedAt) || plan.deployedAt || ''
    ).trim();
    if (!deployedAt) continue;

    for (var h = 0; h < horizons.length; h++) {
      var hz = horizons[h];
      var observationId = buildInterventionObservationId_(interventionId, primaryUrl, hz.name);
      var targetDate = computeInterventionOutcomeTargetDate_(deployedAt, hz.days);
      if (!targetDate) continue;
      var observation = buildInterventionObservation_({
        interventionId: interventionId,
        decisionId: iv.decisionId || '',
        siteId: plan.siteId || '',
        site: plan.siteName || '',
        primaryUrl: primaryUrl,
        horizon: hz.name,
        targetDate: targetDate,
        observedDataDate: '',
        status: OBSERVATION_STATUS.PENDING,
        baselineDataDate: iv.baselineDataDate || '',
        baselineMode: iv.baselineMode || (iv.baselineDataDate ? '' : BASELINE_MODE.NO_PREDEPLOY_DATA),
        attributionMode: iv.decisionId ? 'FORMAL_DECISION_LINKED' : 'OBSERVATIONAL_ONLY',
        updatedAt: updatedAt
      });
      var hit = findInterventionObservationHit_(existing, observationId, interventionId, primaryUrl, hz.name);
      if (hit) {
        var prev = hit.row || [];
        var prevMap = hit.map || {};
        observation.ObservedDataDate = ledgerCell_(prev, prevMap, 'ObservedDataDate');
        observation.Status = ledgerCell_(prev, prevMap, 'Status') || OBSERVATION_STATUS.PENDING;
        observation.BaselineDataDate = ledgerCell_(prev, prevMap, 'BaselineDataDate') || observation.BaselineDataDate;
        [
          'BaselineClicks7D', 'BaselineImpressions7D', 'BaselineCTR', 'BaselinePosition',
          'BaselineQueryCount7D', 'ObservedClicks7D', 'ObservedImpressions7D', 'ObservedCTR',
          'ObservedPosition', 'ObservedQueryCount7D', 'ClicksDelta', 'ImpressionsDelta',
          'CTRDelta', 'PositionImprovement', 'QueryCountDelta', 'BaselineSiteImpressions7D',
          'ObservedSiteImpressions7D', 'BaselineSiteClicks7D', 'ObservedSiteClicks7D',
          'BaselineMode', 'Outcome', 'OutcomeConfidence', 'Confounders'
        ].forEach(function (header) {
          var value = ledgerRawCell_(prev, prevMap, header);
          if (!ledgerBlank_(value)) observation[header] = value;
        });
        observation.UpdatedAt = ledgerCell_(prev, prevMap, 'UpdatedAt') || updatedAt;
        toUpdate.push({ rowIndex: hit.rowIndex, observation: observation, current: prev });
      } else {
        toAppend.push(observation);
        existing[observationId] = { rowIndex: -1, row: [], map: {} };
      }
    }
  }

  return { toAppend: toAppend, toUpdate: toUpdate };
}

function applyInterventionObservationPlan_(obsPlan) {
  ensureLedgerHeader_(SHEET_NAMES.INTERVENTION_OBSERVATIONS, INTERVENTION_OBSERVATION_HEADERS);
  var packed = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_OBSERVATIONS);
  var appended = 0;
  var updated = 0;
  var toAppend = obsPlan.toAppend || [];
  var toUpdate = obsPlan.toUpdate || [];

  for (var i = 0; i < toAppend.length; i++) {
    packed.sheet.appendRow(observationRowFromObject_(toAppend[i], packed, null));
    appended++;
  }
  for (var u = 0; u < toUpdate.length; u++) {
    var upd = toUpdate[u];
    var nextRow = observationRowFromObject_(upd.observation, packed, upd.current);
    packed.sheet.getRange(upd.rowIndex, 1, 1, packed.header.length).setValues([nextRow]);
    updated++;
  }
  return { appended: appended, updated: updated };
}

function syncInterventionObservationsForBatch_(plan, interventions) {
  repairContentUpdateDuplicateHeaders_();
  dedupeInterventionObservationsForBatch_(plan, interventions || []);
  var existing = loadInterventionObservationIndex_();
  var obsPlan = planInterventionObservationRows_({
    plan: plan,
    interventions: interventions || [],
    existing: existing,
    updatedAt: nowRecordedAt_()
  });
  return applyInterventionObservationPlan_(obsPlan);
}

/**
 * 纯函数：Outcome 观察锚点日期来自 deployedAt，而非 Ledger 写入时间。
 */
function computeInterventionOutcomeTargetDate_(deployedAtIso, daysAfter) {
  var base = deployedLocalDateFromIso_(deployedAtIso);
  if (!base) return '';
  return addDaysStr_(base, Number(daysAfter || 0));
}

function loadLedgerSheetRows_(sheetName) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) return { sheet: null, header: [], map: {}, rows: [] };
  var width = Math.max(1, sheet.getLastColumn());
  var header = sheet.getRange(1, 1, 1, width).getValues()[0];
  var rows = [];
  if (sheet.getLastRow() >= 2) {
    rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  }
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

/**
 * 去重「内容更新记录」header：保留每个语义字段第一次出现，迁移重复列值后删除重复列。
 */
function repairContentUpdateDuplicateHeaders_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.CONTENT_UPDATES);
  if (!sheet) return { changed: false, removed: 0 };
  var width = Math.max(1, sheet.getLastColumn());
  var header = sheet.getRange(1, 1, 1, width).getValues()[0];
  var canonicalIndex = {};
  var duplicateCols = [];
  var i;
  for (i = 0; i < header.length; i++) {
    var name = String(header[i] || '').trim();
    if (!name) continue;
    if (canonicalIndex[name] === undefined) {
      canonicalIndex[name] = i;
      continue;
    }
    duplicateCols.push(i);
  }
  if (!duplicateCols.length) return { changed: false, removed: 0 };

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
    for (var r = 0; r < values.length; r++) {
      duplicateCols.forEach(function (dupCol) {
        var name = String(header[dupCol] || '').trim();
        if (!name) return;
        var canonCol = canonicalIndex[name];
        if (ledgerBlank_(values[r][canonCol]) && !ledgerBlank_(values[r][dupCol])) {
          values[r][canonCol] = values[r][dupCol];
        }
      });
    }
    sheet.getRange(2, 1, lastRow - 1, width).setValues(values);
  }

  for (i = duplicateCols.length - 1; i >= 0; i--) {
    sheet.deleteColumn(duplicateCols[i] + 1);
  }

  var nextHeader = [];
  for (i = 0; i < header.length; i++) {
    if (duplicateCols.indexOf(i) >= 0) continue;
    nextHeader.push(header[i]);
  }
  ensureContentUpdateHeader_();
  return { changed: true, removed: duplicateCols.length, header: nextHeader };
}

/**
 * 将 batch 既有观察行按 canonicalId 或 primary+horizon 桶匹配到期望槽位。
 */
function buildRepairObservationSlotMap_(candidateObsRows, expectedObservations, obsMap) {
  var slots = {};
  var used = {};
  candidateObsRows = (candidateObsRows || []).slice().sort(function (a, b) {
    return a.rowIndex - b.rowIndex;
  });
  expectedObservations = expectedObservations || [];
  obsMap = obsMap || {};

  candidateObsRows.forEach(function (item) {
    var obsRow = item.row;
    var horizon = ledgerCell_(obsRow, obsMap, 'Horizon');
    var primary = normalizePublishPathOnly_(ledgerCell_(obsRow, obsMap, 'PrimaryURL'));
    var obsInterventionId = ledgerCell_(obsRow, obsMap, 'InterventionID');
    if (!horizon || used[item.rowIndex]) return;
    var key = buildInterventionObservationId_(obsInterventionId, primary, horizon);
    expectedObservations.forEach(function (spec) {
      if (spec.canonicalId !== key || slots[spec.canonicalId]) return;
      slots[spec.canonicalId] = item;
      used[item.rowIndex] = true;
    });
  });

  var buckets = {};
  candidateObsRows.forEach(function (item) {
    if (used[item.rowIndex]) return;
    var obsRow = item.row;
    var horizon = ledgerCell_(obsRow, obsMap, 'Horizon');
    var primary = normalizePublishPathOnly_(ledgerCell_(obsRow, obsMap, 'PrimaryURL'));
    if (!horizon) return;
    var bucketKey = primary + '||' + horizon;
    if (!buckets[bucketKey]) buckets[bucketKey] = [];
    buckets[bucketKey].push(item);
  });

  expectedObservations.forEach(function (spec) {
    if (slots[spec.canonicalId]) return;
    var bucketKey = spec.ivRef.primaryUrl + '||' + spec.hzRef.name;
    var bucket = buckets[bucketKey] || [];
    if (!bucket.length) return;
    var next = bucket.shift();
    slots[spec.canonicalId] = next;
    used[next.rowIndex] = true;
  });

  return slots;
}

/**
 * 原地修复指定 batch 的内容更新记录 + 干预观察（不新增 duplicate 行）。
 */
function repairPublishedBatchLedger_(batchId, receipt) {
  batchId = String(batchId || '').trim();
  if (!batchId) throw new Error('repairPublishedBatchLedger_: batchId required');
  receipt = receipt || {};
  var preserveInterventionIds = Array.isArray(receipt.repairInterventionIds)
    ? receipt.repairInterventionIds
    : (Array.isArray((receipt.common || {}).interventionIds) ? receipt.common.interventionIds : []);

  var headerRepair = repairContentUpdateDuplicateHeaders_();
  ensureContentUpdateHeader_();
  ensureLedgerHeader_(SHEET_NAMES.INTERVENTION_OBSERVATIONS, INTERVENTION_OBSERVATION_HEADERS);

  var content = loadLedgerSheetRows_(SHEET_NAMES.CONTENT_UPDATES);
  var contentFixed = 0;
  var contentRows = [];
  for (var i = 0; i < content.rows.length; i++) {
    var row = content.rows[i];
    if (ledgerCell_(row, content.map, 'BatchID') !== batchId) continue;
    contentRows.push({ rowIndex: i + 2, row: row });
  }

  var interventions = [];
  for (var c = 0; c < contentRows.length; c++) {
    var current = contentRows[c].row.slice();
    var fields = contentUpdateFieldsFromRow_(current, content.map);
    var interventionId = ledgerCell_(current, content.map, 'InterventionID');
    var productionUrl = ledgerCell_(current, content.map, 'ProductionURL');
    var siteIdFromRow = ledgerCell_(current, content.map, 'SiteID');
    var batchIdFromRow = ledgerCell_(current, content.map, 'BatchID');
    var action = ledgerCell_(current, content.map, 'Action') || ledgerCell_(current, content.map, '更新类型');
    var triggerQueries = ledgerCell_(current, content.map, 'TriggerQueries');
    var targetQuery = String((triggerQueries || '').split('|')[0] || '').trim().toLowerCase();
    var primaryUrl = normalizePublishPagePath_(
      ledgerCell_(current, content.map, 'PrimaryURL') ||
      ledgerCell_(current, content.map, '页面路径'),
      productionUrl
    );
    var ledgerKey = normalizePublishLedgerKey_(
      buildPublishInterventionLedgerKey_(batchIdFromRow, siteIdFromRow, primaryUrl, action, targetQuery)
    );
    var pageReceiptKey = ledgerKey;
    if (preserveInterventionIds[c]) interventionId = String(preserveInterventionIds[c] || '').trim();
    if (!interventionId && ledgerKey) interventionId = buildPublishInterventionId_(ledgerKey);
    var deployedAt = ledgerCell_(current, content.map, 'ProductionDeployedAt');
    var deployedLocalDate = deployedLocalDateFromIso_(deployedAt);
    var siteName = ledgerCell_(current, content.map, '站点');
    var baseline = resolvePublishBaseline_(
      loadDailyRowsForSiteName_(siteName),
      deployedLocalDate
    );
    var nextFields = {};
    CONTENT_UPDATE_HEADERS.forEach(function (header) {
      nextFields[header] = fields[header];
    });
    nextFields.InterventionID = interventionId;
    nextFields.PageReceiptKey = pageReceiptKey;
    nextFields.PrimaryURL = primaryUrl;
    nextFields['页面路径'] = primaryUrl;
    nextFields['来源'] = PUBLISH_LEDGER_SOURCE_PREFIX + ledgerKey;
    nextFields.BaselineDataDate = baseline.baselineDataDate || '';
    var nextRow = ledgerRowFromFields_(content, nextFields, current);
    content.sheet.getRange(contentRows[c].rowIndex, 1, 1, content.header.length).setValues([nextRow]);
    contentFixed++;
    interventions.push({
      interventionId: interventionId,
      decisionId: ledgerCell_(nextRow, content.map, 'DecisionID'),
      primaryUrl: primaryUrl,
      baselineDataDate: baseline.baselineDataDate || '',
      baselineMode: baseline.baselineMode,
      publishFields: publishFieldsFromContentUpdateRow_(nextRow, content.map)
    });
  }

  var batchSiteId = interventions.length
    ? String((interventions[0].publishFields && interventions[0].publishFields.SiteID) || planSiteIdFromContent_(contentRows, content.map) || '').trim()
    : '';
  var batchSiteName = planSiteNameFromContent_(contentRows, content.map);
  var deployedAtPlan = interventions.length && interventions[0].publishFields
    ? interventions[0].publishFields.ProductionDeployedAt
    : '';

  var keepInterventionIds = {};
  interventions.forEach(function (iv) {
    if (iv.interventionId) keepInterventionIds[iv.interventionId] = true;
  });
  var obsPacked = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_OBSERVATIONS);
  var obsRemoved = 0;
  for (var o = obsPacked.rows.length - 1; o >= 0; o--) {
    var obsRow = obsPacked.rows[o];
    var obsInterventionId = ledgerCell_(obsRow, obsPacked.map, 'InterventionID');
    if (keepInterventionIds[obsInterventionId]) continue;
    if (batchSiteId && ledgerCell_(obsRow, obsPacked.map, 'SiteID') !== batchSiteId) continue;
    var obsPrimary = normalizePublishPagePath_(
      ledgerCell_(obsRow, obsPacked.map, 'PrimaryURL'),
      interventions[0] && interventions[0].publishFields ? interventions[0].publishFields.ProductionURL : ''
    );
    var primaryMatch = interventions.some(function (iv) {
      return iv.primaryUrl === obsPrimary;
    });
    if (!primaryMatch) continue;
    obsPacked.sheet.deleteRow(o + 2);
    obsRemoved++;
  }

  var obs = syncInterventionObservationsForBatch_({
    siteId: batchSiteId,
    siteName: batchSiteName,
    batchId: batchId,
    deployedAt: deployedAtPlan
  }, interventions);

  return Object.assign({
    ok: true,
    batchId: batchId,
    headerRepair: headerRepair,
    contentRows: contentRows.length,
    contentFixed: contentFixed,
    observationFixed: obs.updated,
    observationAppended: obs.appended,
    observationDuplicatesRemoved: obsRemoved
  }, inspectPublishedBatchLedger_(batchId));
}

function planSiteIdFromContent_(contentRows, map) {
  for (var i = 0; i < contentRows.length; i++) {
    var siteId = ledgerCell_(contentRows[i].row, map, 'SiteID');
    if (siteId) return siteId;
  }
  return '';
}

function planSiteNameFromContent_(contentRows, map) {
  for (var i = 0; i < contentRows.length; i++) {
    var site = ledgerCell_(contentRows[i].row, map, '站点');
    if (site) return site;
  }
  return '';
}

/**
 * 读取线上 canonical header + batch 抽样（Execution API 调试用）。
 */
function inspectPublishedBatchLedger_(batchId) {
  batchId = String(batchId || '').trim();
  var content = loadLedgerSheetRows_(SHEET_NAMES.CONTENT_UPDATES);
  var obs = loadLedgerSheetRows_(SHEET_NAMES.INTERVENTION_OBSERVATIONS);
  var headerCounts = {};
  content.header.forEach(function (name) {
    var key = String(name || '').trim();
    if (!key) return;
    headerCounts[key] = (headerCounts[key] || 0) + 1;
  });
  var duplicateHeaders = Object.keys(headerCounts).filter(function (name) {
    return headerCounts[name] > 1;
  });

  var rows = [];
  for (var i = 0; i < content.rows.length; i++) {
    var row = content.rows[i];
    if (ledgerCell_(row, content.map, 'BatchID') !== batchId) continue;
    var item = {};
    CONTENT_UPDATE_HEADERS.forEach(function (header) {
      var raw = ledgerRawCell_(row, content.map, header);
      if (header === 'BaselineDataDate' || header === '更新时间' || header === 'ReleaseDate' ||
          header === 'ProductionDeployedAt' || header === 'RecordedAt') {
        item[header] = ledgerDateCell_(row, content.map, header) || String(raw || '').trim();
      } else {
        item[header] = raw;
      }
    });
    rows.push(item);
  }

  var observations = [];
  var interventionIds = {};
  rows.forEach(function (item) {
    if (item.InterventionID) interventionIds[item.InterventionID] = true;
  });
  for (var j = 0; j < obs.rows.length; j++) {
    var obsRow = obs.rows[j];
    var interventionId = ledgerCell_(obsRow, obs.map, 'InterventionID');
    if (!interventionIds[interventionId]) continue;
    var observation = {};
    INTERVENTION_OBSERVATION_HEADERS.forEach(function (header) {
      var raw = ledgerRawCell_(obsRow, obs.map, header);
      if (header === 'TargetDate' || header === 'BaselineDataDate' || header === 'ObservedDataDate') {
        observation[header] = ledgerDateCell_(obsRow, obs.map, header) || String(raw || '').trim();
      } else {
        observation[header] = raw;
      }
    });
    observations.push(observation);
  }

  return {
    ok: true,
    batchId: batchId,
    contentHeader: content.header,
    duplicateHeaders: duplicateHeaders,
    contentUpdateCount: rows.length,
    observationCount: observations.length,
    rows: rows,
    observations: observations
  };
}

/** @deprecated alias */
function verifyPublishedBatchLedger_(batchId) {
  return inspectPublishedBatchLedger_(batchId);
}
