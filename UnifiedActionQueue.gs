/**
 * Unified Action Queue V1
 *
 * 「今日行动」仍是 derived operational view：
 * - GSC action rows come from the existing Decision / 今日行动 flow.
 * - Steam action rows are read-only from the external 候选决策 Sheet.
 * - every refresh rebuilds the current actionable view; no ActionID ledger.
 */

var UNIFIED_ACTION_QUEUE = {
  STEAM_SOURCE_SPREADSHEET_ID: '1WVg2p_Vero3MB2JN4yxmtHkLQRgkWO2mz95X4ms9nLE',
  STEAM_SOURCE_SHEET_NAME: '候选决策',
  STEAM_SOURCE_URL: 'https://docs.google.com/spreadsheets/d/1WVg2p_Vero3MB2JN4yxmtHkLQRgkWO2mz95X4ms9nLE',
  SOURCE_SYSTEMS: { STEAM: 'STEAM', GSC: 'GSC', EARLY: 'EARLY' },
  OPPORTUNITY_TYPES: {
    STEAM_CANDIDATE: 'STEAM_CANDIDATE',
    GSC_DECISION: 'GSC_DECISION',
    GSC_RESEARCH: 'GSC_RESEARCH',
    GSC_DEVELOPMENT: 'GSC_DEVELOPMENT'
  },
  PASSIVE_ACTIONS: {
    '': true,
    NONE: true,
    '无': true,
    WATCH: true,
    '继续观察': true,
    MONITORING: true,
    '自动 MONITORING': true,
    '自动监控': true,
    '纯被动等待': true,
    '等待': true,
    '待自动执行': true,
    '待需求发现执行': true,
    '待搜索需求执行': true,
    '研究发现完成': true,
    '需求发现完成': true,
    '搜索需求已确认': true,
    '继续等待': true
  }
};

/** Menu / clasp entry for a manual derived-view refresh. No new scheduler. */
function refreshUnifiedActionQueue() {
  setupSheets();
  return refreshUnifiedActionQueue_(todayStr_());
}

/**
 * Rebuild the current queue. The existing 今日行动 rows are used only as the
 * current GSC action input and for human notes/status; they are never a source
 * of permanent queue history.
 */
function refreshUnifiedActionQueue_(runDate) {
  runDate = runDate || todayStr_();

  // Preserve the existing manual DONE/SKIP -> Decision History binding before
  // the resolved rows leave this derived view.
  try {
    if (typeof syncHumanDecisions === 'function') syncHumanDecisions();
  } catch (e) {
    writeLog_('WARN', '', 'Unified Action Queue 跳过 syncHumanDecisions: ' + e.message);
  }

  var gscRows = loadCurrentGscActionRows_();
  var steamRows = loadSteamActionRows_();
  var context = loadGscOpportunityContext_();
  var queue = buildUnifiedActionQueue_(runDate, gscRows, steamRows, context);

  replaceSheetDataRows_(SHEET_NAMES.TODAY_ACTIONS, TODAY_ACTION_HEADERS, queue);
  applyTodayActionValidation_();

  var summary =
    'refreshUnifiedActionQueue 结束 rows=' + queue.length +
    ' gsc=' + countQueueSource_(queue, UNIFIED_ACTION_QUEUE.SOURCE_SYSTEMS.GSC) +
    ' steam=' + countQueueSource_(queue, UNIFIED_ACTION_QUEUE.SOURCE_SYSTEMS.STEAM);
  writeLog_('INFO', '', summary);
  Logger.log(summary);
  return summary;
}

function countQueueSource_(rows, sourceSystem) {
  var count = 0;
  for (var i = 0; i < (rows || []).length; i++) {
    if (rows[i][10] === sourceSystem) count++;
  }
  return count;
}

/** Read only current GSC rows. Legacy rows without SourceSystem are GSC. */
function loadCurrentGscActionRows_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.TODAY_ACTIONS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var lastCol = Math.max(sheet.getLastColumn(), TODAY_ACTION_HEADERS.length);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(headers);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var source = String(cell_(row, col, 'SourceSystem') || '').trim().toUpperCase();
    if (source && source !== UNIFIED_ACTION_QUEUE.SOURCE_SYSTEMS.GSC &&
        source !== UNIFIED_ACTION_QUEUE.SOURCE_SYSTEMS.EARLY) continue;
    out.push({
      date: cell_(row, col, 'Date'),
      priority: String(cell_(row, col, 'Priority') || '').trim(),
      site: String(cell_(row, col, 'Site') || '').trim(),
      lifecycleStage: String(cell_(row, col, 'LifecycleStage') || '').trim(),
      recommendedAction: String(cell_(row, col, 'RecommendedAction') || '').trim(),
      domainScore: cell_(row, col, 'DomainScore'),
      reason: String(cell_(row, col, 'Reason') || '').trim(),
      status: normalizeTodayStatus_(cell_(row, col, 'Status')),
      note: String(cell_(row, col, '人工备注') || ''),
      decisionId: String(cell_(row, col, 'DecisionID') || '').trim(),
      opportunityId: String(cell_(row, col, 'OpportunityID') || '').trim(),
      game: String(cell_(row, col, 'Game') || '').trim(),
      opportunityType: String(cell_(row, col, 'OpportunityType') || '').trim(),
      currentState: String(cell_(row, col, 'CurrentState') || '').trim(),
      sourceReference: String(cell_(row, col, 'SourceReference') || '').trim(),
      sourceSystem: source || UNIFIED_ACTION_QUEUE.SOURCE_SYSTEMS.GSC
    });
  }
  return out;
}

/**
 * Read Steam 候选决策 through Spreadsheet ID only. No mutation, no sync back.
 * Missing source / headers degrades this refresh to the GSC queue and logs the
 * reason, so the existing GSC daily flow is not lost.
 */
function loadSteamActionRows_() {
  var ss;
  try {
    ss = SpreadsheetApp.openById(UNIFIED_ACTION_QUEUE.STEAM_SOURCE_SPREADSHEET_ID);
  } catch (e) {
    writeLog_('WARN', '', 'Steam Action Source 读取失败: ' + e.message);
    return [];
  }
  var sheet = ss && ss.getSheetByName(UNIFIED_ACTION_QUEUE.STEAM_SOURCE_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(headers);
  var required = ['Steam App ID', '游戏名称', 'Decision', 'Next Action', '研究状态', '当前Steam阶段', 'OpportunityID'];
  var missing = [];
  for (var r = 0; r < required.length; r++) {
    if (col[required[r]] === undefined) missing.push(required[r]);
  }
  if (missing.length) {
    writeLog_('WARN', '', 'Steam Action Source 缺少列: ' + missing.join(', '));
    return [];
  }

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    out.push({
      appId: String(cell_(row, col, 'Steam App ID') || '').trim(),
      game: String(cell_(row, col, '游戏名称') || '').trim(),
      decision: String(cell_(row, col, 'Decision') || '').trim().toUpperCase(),
      nextAction: String(cell_(row, col, 'Next Action') || '').trim(),
      researchStatus: String(cell_(row, col, '研究状态') || '').trim(),
      currentStage: String(cell_(row, col, '当前Steam阶段') || '').trim(),
      opportunityId: String(cell_(row, col, 'OpportunityID') || '').trim(),
      sourceReference: UNIFIED_ACTION_QUEUE.STEAM_SOURCE_URL + '/edit#gid=0&range=A' + (i + 2)
    });
  }
  return out;
}

/** Load the existing GSC facts used only to resolve context and current manual work. */
function loadGscOpportunityContext_() {
  return {
    radar: loadInternalSheetRecords_(SHEET_NAMES.DEMAND_RADAR),
    research: loadInternalSheetRecords_(SHEET_NAMES.RESEARCH_JOBS),
    decisions: loadInternalSheetRecords_(SHEET_NAMES.DECISION_HISTORY),
    development: loadInternalSheetRecords_(SHEET_NAMES.DEVELOPMENT_TASKS)
  };
}

function loadInternalSheetRecords_(sheetName) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(headers);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) rows.push({ row: values[i], col: col, rowNumber: i + 2 });
  return rows;
}

function buildUnifiedActionQueue_(runDate, gscRows, steamRows, context) {
  var rows = [];
  var seen = {};
  var gsc = buildGscQueueRows_(runDate, gscRows, context || {});
  var steam = buildSteamQueueRows_(runDate, steamRows);

  for (var i = 0; i < gsc.length; i++) addUniqueQueueRow_(rows, seen, gsc[i]);
  for (var s = 0; s < steam.length; s++) addUniqueQueueRow_(rows, seen, steam[s]);

  rows.sort(compareUnifiedQueueRows_);
  return rows;
}

function addUniqueQueueRow_(rows, seen, item) {
  var key = item[10] + '||' + (item[11] || item[2] || '') + '||' + item[4];
  if (seen[key]) return;
  seen[key] = true;
  rows.push(item);
}

function buildSteamQueueRows_(runDate, steamRows) {
  var out = [];
  for (var i = 0; i < (steamRows || []).length; i++) {
    var item = steamRows[i] || {};
    if (!isActionableSteamCandidate_(item)) continue;
    var nextAction = String(item.nextAction || '').trim();
    var priority = steamActionPriority_(item.decision, nextAction);
    var currentState = item.decision || item.currentStage || '';
    if (item.decision && item.currentStage) currentState += ' / ' + item.currentStage;
    var reason = 'Steam 候选需要人工处理：Next Action=' + nextAction;
    if (item.researchStatus) reason += '；研究状态=' + item.researchStatus;
    if (item.currentStage) reason += '；当前Steam阶段=' + item.currentStage;

    out.push(queueRow_(
      runDate,
      priority,
      '',
      item.currentStage,
      nextAction,
      '',
      reason,
      '',
      '',
      UNIFIED_ACTION_QUEUE.SOURCE_SYSTEMS.STEAM,
      item.opportunityId,
      item.game,
      UNIFIED_ACTION_QUEUE.OPPORTUNITY_TYPES.STEAM_CANDIDATE,
      currentState,
      item.sourceReference
    ));
  }
  return out;
}

function isActionableSteamCandidate_(item) {
  if (!item || !String(item.opportunityId || '').trim()) return false;
  if (String(item.decision || '').trim().toUpperCase() === 'REJECT') return false;
  return !isPassiveQueueAction_(item.nextAction);
}

function steamActionPriority_(decision, nextAction) {
  if (String(decision || '').toUpperCase() === 'BUILD' || nextAction === 'Site Build') return 'P0';
  if (/Research Review|Validation|Decision|开发|人工/.test(String(nextAction || ''))) return 'P1';
  return 'P2';
}

function buildGscQueueRows_(runDate, gscRows, context) {
  var out = [];
  for (var i = 0; i < (gscRows || []).length; i++) {
    var item = gscRows[i] || {};
    if (!isActionableGscRow_(item)) continue;
    var resolved = resolveGscOpportunityContext_(item, context);
    if (resolved && resolved.watchOnly) continue;
    var oppId = resolved && resolved.opportunityId || item.opportunityId || '';
    var game = item.game || item.site || (resolved && resolved.game) || '';
    var type = item.opportunityType || UNIFIED_ACTION_QUEUE.OPPORTUNITY_TYPES.GSC_DECISION;
    var currentState = item.currentState || item.recommendedAction || item.lifecycleStage || '';
    var sourceReference = item.sourceReference ||
      'https://docs.google.com/spreadsheets/d/15GJGvPnJlXTSbO4aM_Yxvf0GxCgXrmZr0M5b9uZGIJU/edit#gid=0';
    var gscQueueRow = queueRow_(
      runDate,
      item.priority,
      item.site,
      item.lifecycleStage,
      item.recommendedAction,
      item.domainScore,
      item.reason,
      item.status,
      item.note,
      item.sourceSystem || UNIFIED_ACTION_QUEUE.SOURCE_SYSTEMS.GSC,
      oppId,
      game,
      type,
      currentState,
      sourceReference
    );
    gscQueueRow[9] = item.decisionId || '';
    out.push(gscQueueRow);
  }

  var aux = buildGscAuxiliaryQueueRows_(runDate, context);
  for (var a = 0; a < aux.length; a++) out.push(aux[a]);
  return out;
}

function isActionableGscRow_(item) {
  var status = normalizeTodayStatus_(item && item.status);
  if (status === 'DONE' || status === 'SKIP') return false;
  return !isPassiveQueueAction_(item && item.recommendedAction);
}

function isPassiveQueueAction_(action) {
  var normalized = String(action || '').trim();
  if (!normalized) return true;
  var upper = normalized.toUpperCase();
  return !!UNIFIED_ACTION_QUEUE.PASSIVE_ACTIONS[normalized] ||
    !!UNIFIED_ACTION_QUEUE.PASSIVE_ACTIONS[upper];
}

function resolveGscOpportunityContext_(item, context) {
  var decision = findDecisionContext_(item, context.decisions || []);
  var opportunityId = item.opportunityId || (decision && decision.opportunityId) || '';
  var radar = findRadarContext_(opportunityId, item.site, context.radar || []);
  if (radar && isWatchOnlyRadar_(radar)) {
    return { opportunityId: opportunityId || radar.opportunityId, watchOnly: true, game: radar.game };
  }
  if (radar) return { opportunityId: radar.opportunityId, game: radar.game, source: '需求雷达' };

  var research = findResearchContext_(opportunityId, item.site, context.research || []);
  if (research) return {
    opportunityId: research.opportunityId || opportunityId,
    game: cell_(research.row, research.col, '游戏') || item.site,
    source: '研究任务'
  };
  if (decision) return {
    opportunityId: decision.opportunityId || opportunityId,
    game: cell_(decision.row, decision.col, 'Site') || item.site,
    source: 'Decision History'
  };
  return opportunityId ? { opportunityId: opportunityId, game: item.game || item.site } : null;
}

function findDecisionContext_(item, rows) {
  var decisionId = String(item && item.decisionId || '').trim();
  var site = String(item && item.site || '').trim();
  var fallbacks = [];
  for (var i = 0; i < rows.length; i++) {
    var id = String(cell_(rows[i].row, rows[i].col, 'DecisionID') || '').trim();
    var rowSite = String(cell_(rows[i].row, rows[i].col, 'Site') || '').trim();
    if (decisionId && id === decisionId) return {
      row: rows[i].row,
      col: rows[i].col,
      opportunityId: String(cell_(rows[i].row, rows[i].col, 'OpportunityID') || '').trim()
    };
    if (site && rowSite === site) fallbacks.push(rows[i]);
  }
  if (fallbacks.length !== 1) return null;
  var fallback = fallbacks[0];
  return {
    row: fallback.row,
    col: fallback.col,
    opportunityId: String(cell_(fallback.row, fallback.col, 'OpportunityID') || '').trim()
  };
}

function findRadarContext_(opportunityId, site, rows) {
  var fallbacks = [];
  for (var i = 0; i < rows.length; i++) {
    var id = String(cell_(rows[i].row, rows[i].col, 'OpportunityID') || '').trim();
    var rowSite = String(cell_(rows[i].row, rows[i].col, '站点') || '').trim();
    if (opportunityId && id === opportunityId) return radarContext_(rows[i]);
    if (site && rowSite === site && id) fallbacks.push(rows[i]);
  }
  if (opportunityId) return null;
  return fallbacks.length === 1 ? radarContext_(fallbacks[0]) : null;
}

function radarContext_(record) {
  return {
    row: record.row,
    col: record.col,
    opportunityId: String(cell_(record.row, record.col, 'OpportunityID') || '').trim(),
    game: String(cell_(record.row, record.col, '游戏') || cell_(record.row, record.col, '站点') || '').trim(),
    signalStatus: String(cell_(record.row, record.col, '信号状态') || '').trim().toUpperCase(),
    radarStatus: String(cell_(record.row, record.col, '雷达状态') || '').trim().toUpperCase(),
    researchJobId: String(cell_(record.row, record.col, '研究任务ID') || '').trim()
  };
}

function isWatchOnlyRadar_(radar) {
  return radar.signalStatus === RADAR_SIGNAL_STATUS.RESOLVED ||
    radar.radarStatus === RADAR_STATUS.WATCH ||
    radar.radarStatus === RADAR_STATUS.ARCHIVED;
}

function findResearchContext_(opportunityId, site, rows) {
  var fallbacks = [];
  for (var i = 0; i < rows.length; i++) {
    var id = String(cell_(rows[i].row, rows[i].col, 'OpportunityID') || '').trim();
    var rowSite = String(cell_(rows[i].row, rows[i].col, '站点') || '').trim();
    if (opportunityId && id === opportunityId) return researchContext_(rows[i]);
    if (site && rowSite === site && id) fallbacks.push(rows[i]);
  }
  if (opportunityId) return null;
  return fallbacks.length === 1 ? researchContext_(fallbacks[0]) : null;
}

function researchContext_(record) {
  var status = String(cell_(record.row, record.col, '任务状态') || '').trim();
  return {
    row: record.row,
    col: record.col,
    opportunityId: String(cell_(record.row, record.col, 'OpportunityID') || '').trim(),
    status: status,
    jobId: String(cell_(record.row, record.col, '任务ID') || '').trim(),
    actionable: isActionableResearchStatus_(status)
  };
}

function isActionableResearchStatus_(status) {
  var s = String(status || '').trim();
  return s === RESEARCH_JOB_STATUS.PENDING ||
    s === RESEARCH_JOB_STATUS_LABELS.PENDING ||
    s === RESEARCH_JOB_STATUS.REVIEW ||
    s === RESEARCH_JOB_STATUS_LABELS.REVIEW ||
    s === RESEARCH_JOB_STATUS.FAILED ||
    s === RESEARCH_JOB_STATUS_LABELS.FAILED ||
    s === RESEARCH_JOB_STATUS.APPROVED ||
    s === RESEARCH_JOB_STATUS_LABELS.APPROVED;
}

function buildGscAuxiliaryQueueRows_(runDate, context) {
  var out = [];
  var seen = {};
  var research = context.research || [];
  for (var i = 0; i < research.length; i++) {
    var parsed = researchContext_(research[i]);
    if (!parsed.opportunityId || !parsed.actionable) continue;
    var action = researchAction_(parsed.status);
    if (isPassiveQueueAction_(action)) continue;
    var game = String(cell_(parsed.row, parsed.col, '游戏') || cell_(parsed.row, parsed.col, '站点') || '').trim();
    var key = parsed.opportunityId + '||' + action;
    if (seen[key]) continue;
    seen[key] = true;
    out.push(queueRow_(
      runDate,
      researchActionPriority_(action),
      String(cell_(parsed.row, parsed.col, '站点') || '').trim(),
      'RESEARCH',
      action,
      '',
      'GSC 研究任务需要人工处理：任务状态=' + parsed.status,
      '',
      '',
      UNIFIED_ACTION_QUEUE.SOURCE_SYSTEMS.GSC,
      parsed.opportunityId,
      game,
      UNIFIED_ACTION_QUEUE.OPPORTUNITY_TYPES.GSC_RESEARCH,
      parsed.status,
      '热词站_GSC每日监控 / 研究任务 / ' + parsed.jobId
    ));
  }

  var radar = context.radar || [];
  for (var r = 0; r < radar.length; r++) {
    var radarItem = radarContext_(radar[r]);
    if (!radarItem.opportunityId || isWatchOnlyRadar_(radarItem)) continue;
    if (radarItem.researchJobId) continue;
    var radarAction = radarAction_(radarItem.radarStatus);
    if (!radarAction) continue;
    var radarKey = radarItem.opportunityId + '||' + radarAction;
    if (seen[radarKey]) continue;
    seen[radarKey] = true;
    out.push(queueRow_(
      runDate,
      radarAction === 'Decision' ? 'P1' : 'P2',
      String(cell_(radarItem.row, radarItem.col, '站点') || '').trim(),
      'RADAR',
      radarAction,
      '',
      'GSC 需求雷达需要人工处理：雷达状态=' + radarItem.radarStatus,
      '',
      '',
      UNIFIED_ACTION_QUEUE.SOURCE_SYSTEMS.GSC,
      radarItem.opportunityId,
      radarItem.game,
      UNIFIED_ACTION_QUEUE.OPPORTUNITY_TYPES.GSC_RESEARCH,
      radarItem.radarStatus,
      '热词站_GSC每日监控 / 需求雷达 / row=' + (radar[r].rowNumber || '')
    ));
  }

  var development = context.development || [];
  for (var d = 0; d < development.length; d++) {
    var taskStatus = String(cell_(development[d].row, development[d].col, '任务状态') || '').trim();
    if (taskStatus !== DEVELOPMENT_TASK_STATUS_LABELS.TODO && taskStatus !== DEVELOPMENT_TASK_STATUS.TODO) continue;
    var sourceTaskId = String(cell_(development[d].row, development[d].col, '来源任务ID') || '').trim();
    var researchMatch = findResearchByJobId_(sourceTaskId, research);
    var developmentOpp = researchMatch ? researchContext_(researchMatch).opportunityId : '';
    if (!developmentOpp) continue;
    var developmentKey = developmentOpp + '||开发';
    if (seen[developmentKey]) continue;
    seen[developmentKey] = true;
    out.push(queueRow_(
      runDate,
      'P0',
      String(cell_(development[d].row, development[d].col, '站点') || '').trim(),
      'DEVELOPMENT',
      '开发',
      '',
      'GSC 开发任务等待人工处理：任务状态=' + taskStatus,
      '',
      '',
      UNIFIED_ACTION_QUEUE.SOURCE_SYSTEMS.GSC,
      developmentOpp,
      String(cell_(development[d].row, development[d].col, '游戏') || '').trim(),
      UNIFIED_ACTION_QUEUE.OPPORTUNITY_TYPES.GSC_DEVELOPMENT,
      taskStatus,
      '热词站_GSC每日监控 / 开发任务 / ' + String(cell_(development[d].row, development[d].col, '开发任务ID') || '').trim()
    ));
  }
  return out;
}

function findResearchByJobId_(jobId, rows) {
  if (!jobId) return null;
  for (var i = 0; i < rows.length; i++) {
    if (String(cell_(rows[i].row, rows[i].col, '任务ID') || '').trim() === jobId) return rows[i];
  }
  return null;
}

function researchAction_(status) {
  var s = String(status || '').trim();
  if (s === RESEARCH_JOB_STATUS.REVIEW || s === RESEARCH_JOB_STATUS_LABELS.REVIEW) return 'Research Review';
  if (s === RESEARCH_JOB_STATUS.APPROVED || s === RESEARCH_JOB_STATUS_LABELS.APPROVED) return '开发';
  if (s === RESEARCH_JOB_STATUS.FAILED || s === RESEARCH_JOB_STATUS_LABELS.FAILED) return 'Research Review';
  if (s === RESEARCH_JOB_STATUS.PENDING || s === RESEARCH_JOB_STATUS_LABELS.PENDING) return 'Research';
  return '';
}

function researchActionPriority_(action) {
  return action === '开发' || action === 'Research Review' ? 'P1' : 'P2';
}

function radarAction_(status) {
  if (status === RADAR_STATUS.DISCOVERED || status === RADAR_STATUS.RESEARCH) return 'Research';
  if (status === RADAR_STATUS.VALIDATED) return 'Decision';
  return '';
}

function queueRow_(date, priority, site, stage, action, domainScore, reason, status, note,
  sourceSystem, opportunityId, game, opportunityType, currentState, sourceReference) {
  return [
    date || todayStr_(), priority || 'P2', site || '', stage || '', action || '',
    domainScore === undefined || domainScore === null ? '' : domainScore,
    reason || '', status || 'TODO', note || '', '',
    sourceSystem || '', opportunityId || '', game || '', opportunityType || '',
    currentState || '', sourceReference || ''
  ];
}

function compareUnifiedQueueRows_(a, b) {
  var p = todayPriorityRank_(a[1]) - todayPriorityRank_(b[1]);
  if (p !== 0) return p;
  var source = String(a[10] || '').localeCompare(String(b[10] || ''));
  if (source !== 0) return source;
  return String(a[12] || a[2] || '').localeCompare(String(b[12] || b[2] || ''));
}
