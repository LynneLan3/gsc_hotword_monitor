/**
 * Phase 7E：已批准 Opportunity → 现有「开发任务」runtime record。
 *
 * 这里只写「开发任务」Sheet：不改 Opportunity / Decision / Research，
 * 不调用 Codex，不改 Game Repo，不创建 GitHub/Vercel 资源。
 */

/** 兼容现有菜单入口。 */
function createDevelopmentTasks() {
  return syncDevelopmentTasksFromApprovedDecisions();
}

/**
 * 从已批准的 GSC Research Approval 与 Steam BUILD Decision 追加任务。
 * Sheet 是事实源；本函数只追加缺失任务，不更新或删除已有任务。
 * @return {string}
 */
function syncDevelopmentTasksFromApprovedDecisions() {
  ensureDevelopmentTaskSheets_();
  var devSheet = ensureSheet_(SHEET_NAMES.DEVELOPMENT_TASKS, DEVELOPMENT_TASK_HEADERS);
  var existing = loadExistingDevelopmentTaskKeys_(devSheet);
  var createdRows = [];
  var created = 0;
  var skippedExisting = 0;
  var skippedNoOpportunity = 0;
  var skippedNonImplementation = 0;
  var now = new Date();
  var decisionRefs = loadDevelopmentDecisionReferences_();
  var siteRefs = loadDevelopmentSiteReferences_();

  var researchSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (researchSheet && researchSheet.getLastRow() >= 2) {
    var lastCol = Math.max(researchSheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
    var header = researchSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var col = headerIndexMap_(header);
    var rows = researchSheet.getRange(2, 1, researchSheet.getLastRow() - 1, lastCol).getValues();

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var sourceId = String(cell_(row, col, '任务ID') || '').trim();
      if (!sourceId || !isResearchJobReadyForDevelopment_(
        cell_(row, col, '任务状态'),
        cell_(row, col, '审核决定')
      )) continue;

      var opportunityId = String(cell_(row, col, 'OpportunityID') || '').trim();
      if (!opportunityId) {
        // Phase 7C-1 之前没有 OpportunityID 的历史任务不反向补造绑定。
        skippedNoOpportunity++;
        continue;
      }

      var actionType = implementationActionFromResearchRow_(row, col);
      if (!actionType) {
        skippedNonImplementation++;
        continue;
      }

      var task = buildDevelopmentTaskFromResearchRow_(row, col, now, {
        decisionId: developmentDecisionIdFromResearchRow_(row, col, decisionRefs),
        siteId: developmentSiteIdFromResearchRow_(row, col, siteRefs),
        actionType: actionType
      });
      if (developmentTaskAlreadyExists_(existing, task)) {
        skippedExisting++;
        continue;
      }
      createdRows.push(developmentTaskSheetRow_(task));
      markDevelopmentTaskExisting_(existing, task);
      created++;
    }
  }

  // Steam source is read-only. BUILD is an explicit implementation decision;
  // without site_id it remains a task waiting for site creation.
  var steamRows = [];
  try {
    if (typeof loadSteamActionRows_ === 'function') steamRows = loadSteamActionRows_();
  } catch (e) {
    writeLog_('WARN', '', 'Development Task 跳过 Steam Source: ' + e.message);
  }
  for (var s = 0; s < steamRows.length; s++) {
    var steam = steamRows[s] || {};
    if (!isApprovedSteamBuild_(steam)) continue;
    var steamTask = buildDevelopmentTaskFromSteamRow_(steam, now);
    if (developmentTaskAlreadyExists_(existing, steamTask)) {
      skippedExisting++;
      continue;
    }
    createdRows.push(developmentTaskSheetRow_(steamTask));
    markDevelopmentTaskExisting_(existing, steamTask);
    created++;
  }

  if (createdRows.length) {
    var start = Math.max(2, devSheet.getLastRow() + 1);
    devSheet
      .getRange(start, 1, createdRows.length, DEVELOPMENT_TASK_HEADERS.length)
      .setValues(createdRows);
  }

  var summary =
    'syncDevelopmentTasksFromApprovedDecisions 结束 created=' + created +
    ' skippedExisting=' + skippedExisting +
    ' skippedNoOpportunity=' + skippedNoOpportunity +
    ' skippedNonImplementation=' + skippedNonImplementation;
  writeLog_('INFO', '', summary);
  Logger.log(summary);
  return summary;
}

/**
 * M1: high-confidence ContentDecision → existing DevelopmentTasks queue.
 * This is a direct structured-decision handoff; it does not add a new review gate.
 */
function createDevelopmentTaskFromContentDecision_(jobRow, jobCol, decision, createdAt) {
  if (!isContentDecisionImplementationEligible_(decision)) {
    return { created: 0, skipped: 1, reason: 'decision_not_implementation_eligible' };
  }
  ensureDevelopmentTaskSheets_();
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DEVELOPMENT_TASKS);
  if (!sheet) return { created: 0, skipped: 1, reason: 'sheet_missing' };
  var existing = loadExistingDevelopmentTaskKeys_(sheet);
  var sourceId = String(cell_(jobRow, jobCol, '任务ID') || '').trim();
  var actionType = contentDecisionDevelopmentAction_(decision.primaryDecision);
  var site = String(cell_(jobRow, jobCol, '站点') || '').trim();
  var pagePath = String(decision.pagePath || cell_(jobRow, jobCol, '页面路径') || '').trim();
  var siteRefs = loadDevelopmentSiteReferences_();
  var task = buildDevelopmentTaskFromResearchRow_(jobRow, jobCol, createdAt, {
    decisionId: decision.decisionId,
    siteId: siteRefs[site] || '',
    actionType: actionType
  });
  task.page_path = pagePath;
  task.goal = decision.primaryDecision === CONTENT_DECISION_PRIMARY_ACTIONS.CREATE_NEW_PAGE
    ? DEVELOPMENT_GOAL_LABELS.NEW_PAGE
    : DEVELOPMENT_GOAL_LABELS.EXPAND_EXISTING;
  task.task_type = 'CONTENT_IMPLEMENTATION';
  task.task_reason = 'ContentDecision ' + decision.decisionId + '：' + (decision.decisionReason || decision.primaryDecision);
  task.source_reference = '研究任务/' + sourceId + ' / Decision/' + decision.decisionId;
  if (developmentTaskAlreadyExists_(existing, task)) {
    return { created: 0, skipped: 1, developmentTaskId: task.development_task_id };
  }
  var start = Math.max(2, sheet.getLastRow() + 1);
  sheet.getRange(start, 1, 1, DEVELOPMENT_TASK_HEADERS.length).setValues([developmentTaskSheetRow_(task)]);
  return { created: 1, skipped: 0, developmentTaskId: task.development_task_id };
}

function isContentDecisionImplementationEligible_(decision) {
  if (!decision || String(decision.confidence || '').toUpperCase() !== 'HIGH') return false;
  var primary = String(decision.primaryDecision || '').toUpperCase();
  return primary === CONTENT_DECISION_PRIMARY_ACTIONS.CREATE_NEW_PAGE ||
    primary === CONTENT_DECISION_PRIMARY_ACTIONS.EXPAND_EXISTING ||
    primary === CONTENT_DECISION_PRIMARY_ACTIONS.REWRITE_SECTION ||
    primary === CONTENT_DECISION_PRIMARY_ACTIONS.ADD_FAQ ||
    primary === CONTENT_DECISION_PRIMARY_ACTIONS.ADD_ENTITY_SECTION ||
    primary === CONTENT_DECISION_PRIMARY_ACTIONS.ADD_COMPARISON ||
    primary === CONTENT_DECISION_PRIMARY_ACTIONS.ADD_STEPS ||
    primary === CONTENT_DECISION_PRIMARY_ACTIONS.REFOCUS_SECONDARY ||
    primary === CONTENT_DECISION_PRIMARY_ACTIONS.FIX_INTERNAL_LINKING;
}

function contentDecisionDevelopmentAction_(primaryDecision) {
  return primaryDecision === CONTENT_DECISION_PRIMARY_ACTIONS.CREATE_NEW_PAGE
    ? 'CREATE_PAGE'
    : 'UPDATE_PAGE';
}

function ensureDevelopmentTaskSheets_() {
  ensureSheet_(SHEET_NAMES.DEVELOPMENT_TASKS, DEVELOPMENT_TASK_HEADERS);
  ensureDevelopmentTaskHeader_();
}

function ensureDevelopmentTaskHeader_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DEVELOPMENT_TASKS);
  if (!sheet) return;
  ensureDevelopmentTaskColumns_(sheet);
}

/** 仅追加「开发任务」缺失列；不改已有数据。 */
function ensureDevelopmentTaskColumns_(sheet) {
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var have = {};
  for (var i = 0; i < header.length; i++) {
    var name = String(header[i] || '').trim();
    if (name) have[name] = true;
  }
  var toAdd = [];
  for (var n = 0; n < DEVELOPMENT_TASK_HEADERS.length; n++) {
    if (!have[DEVELOPMENT_TASK_HEADERS[n]]) toAdd.push(DEVELOPMENT_TASK_HEADERS[n]);
  }
  if (!toAdd.length) return;
  var startCol = lastCol + 1;
  if (String(header[header.length - 1] || '').trim() === '') startCol = lastCol;
  sheet.getRange(1, startCol, 1, toAdd.length).setValues([toAdd]);
  sheet.getRange(1, startCol, 1, toAdd.length).setFontWeight('bold');
}

/** Legacy compatibility helper. */
function loadExistingDevelopmentSourceIds_(sheet) {
  return loadExistingDevelopmentTaskKeys_(sheet).sourceIds;
}

/** @return {{identity:Object<string, boolean>, sourceIds:Object<string, boolean>}} */
function loadExistingDevelopmentTaskKeys_(sheet) {
  var result = { identity: {}, sourceIds: {} };
  if (!sheet || sheet.getLastRow() < 2) return result;
  var lastCol = Math.max(sheet.getLastColumn(), DEVELOPMENT_TASK_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var sourceId = String(cell_(row, col, '来源任务ID') || '').trim();
    var opportunityId = String(cell_(row, col, 'OpportunityID') || '').trim();
    var decisionId = String(cell_(row, col, 'DecisionID') || '').trim();
    var actionType = String(cell_(row, col, 'ActionType') || '').trim();
    var targetPath = String(cell_(row, col, '页面路径') || '').trim();
    if (opportunityId && actionType) {
      result.identity[developmentTaskIdentityKey_(
        opportunityId, decisionId, actionType, targetPath
      )] = true;
    } else if (sourceId) {
      // Only legacy rows without a Phase 7E identity use source-job fallback.
      result.sourceIds[sourceId] = true;
    }
  }
  return result;
}

function developmentTaskAlreadyExists_(existing, task) {
  var key = developmentTaskIdentityKey_(
    task.opportunity_id,
    task.decision_id,
    task.action_type,
    task.page_path
  );
  if (task.opportunity_id && task.action_type && existing.identity[key]) return true;
  // Do not create a second Phase 7E row for a legacy task from the same job.
  return !!(task.source_job_id && existing.sourceIds[task.source_job_id]);
}

function markDevelopmentTaskExisting_(existing, task) {
  if (task.opportunity_id && task.action_type) {
    existing.identity[developmentTaskIdentityKey_(
      task.opportunity_id,
      task.decision_id,
      task.action_type,
      task.page_path
    )] = true;
  }
  if (!task.opportunity_id && task.source_job_id) {
    existing.sourceIds[task.source_job_id] = true;
  }
}

/** Opportunity + Decision + Action + TargetPath; never Sheet row number. */
function developmentTaskIdentityKey_(opportunityId, decisionId, actionType, targetPath) {
  return [opportunityId, decisionId, actionType, targetPath].map(function (value) {
    return String(value || '').trim();
  }).join('\u001f');
}

function developmentTaskIdFromIdentity_(opportunityId, decisionId, actionType, targetPath) {
  var raw = developmentTaskIdentityKey_(opportunityId, decisionId, actionType, targetPath);
  return 'dev-' + encodeURIComponent(raw).replace(/%/g, '_');
}

function developmentTaskIdFromSource_(sourceJobId) {
  return 'dev-' + String(sourceJobId || '').trim();
}

/** 仅：任务状态=已批准 且 审核决定=批准开发。 */
function isResearchJobReadyForDevelopment_(status, decision) {
  var statusRaw = String(status || '').trim();
  var decisionRaw = String(decision || '').trim();
  if (!statusRaw || !decisionRaw) return false;
  var statusEnum = statusRaw === RESEARCH_JOB_STATUS_LABELS.APPROVED
    ? RESEARCH_JOB_STATUS.APPROVED
    : enumFromLabel_(RESEARCH_JOB_STATUS_LABELS, statusRaw);
  var decisionEnum = decisionRaw === RESEARCH_REVIEW_DECISION_LABELS.APPROVE
    ? RESEARCH_REVIEW_DECISION.APPROVE
    : enumFromLabel_(RESEARCH_REVIEW_DECISION_LABELS, decisionRaw);
  return statusEnum === RESEARCH_JOB_STATUS.APPROVED &&
    decisionEnum === RESEARCH_REVIEW_DECISION.APPROVE;
}

/** Research-only / WATCH 不进入实施任务。 */
function implementationActionFromResearchRow_(row, col) {
  var result = String(cell_(row, col, '研究结果') || '').trim();
  var directResult = normalizeDevelopmentAction_(result);
  if (directResult) return directResult;
  if ((result && isPassiveDevelopmentValue_(result)) || /RESEARCH|研究/.test(result.toUpperCase())) return '';

  var researchType = String(cell_(row, col, '研究类型') || '').trim().toUpperCase();
  var suggested = String(cell_(row, col, '建议动作') || '').trim();
  var directSuggested = normalizeDevelopmentAction_(suggested);
  if (directSuggested) return directSuggested;
  if ((suggested && isPassiveDevelopmentValue_(suggested)) || /RESEARCH|研究/.test(suggested.toUpperCase())) return '';
  if (researchType === RESEARCH_TYPE.DEMAND_DISCOVERY || researchType === RESEARCH_TYPE.SEARCH_DEMAND) return '';

  // No explicit implementation action means this is still a signal/research
  // record, even if its review gate was filled accidentally.
  return '';
}

function normalizeDevelopmentAction_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  var upper = raw.toUpperCase();
  if (upper === 'CREATE_PAGE' || raw === '新建页面' || raw === '新内容') return 'CREATE_PAGE';
  if (upper === 'UPDATE_PAGE' || upper === 'UPDATE_EXISTING' || raw === '更新现有页面' || raw === '扩充现有页面') return 'UPDATE_PAGE';
  if (upper === 'CONTENT_OPTIMIZE' || raw === '内容优化') return 'CONTENT_OPTIMIZE';
  if (upper === 'BUILD' || upper === 'SITE_BUILD' || raw === '建站') return 'BUILD';
  return '';
}

function isPassiveDevelopmentValue_(value) {
  var raw = String(value || '').trim();
  var upper = raw.toUpperCase();
  return !raw || upper === 'WATCH' || upper === 'MONITOR' || upper === 'MONITORING' ||
    raw === '继续观察' || raw === '自动监控' || raw === '纯被动等待';
}

function buildDevelopmentTaskFromResearchRow_(row, col, createdAt, refs) {
  refs = refs || {};
  var sourceId = String(cell_(row, col, '任务ID') || '').trim();
  var opportunityId = String(cell_(row, col, 'OpportunityID') || '').trim();
  var decisionId = String(refs.decisionId || '').trim();
  var actionType = String(refs.actionType || implementationActionFromResearchRow_(row, col) || '').trim();
  var pagePath = String(cell_(row, col, '页面路径') || '').trim();
  var siteId = String(refs.siteId || cell_(row, col, 'SiteID') || '').trim();
  var hasPhase7EBinding = !!opportunityId;
  return {
    development_task_id: hasPhase7EBinding
      ? developmentTaskIdFromIdentity_(opportunityId, decisionId, actionType, pagePath)
      : developmentTaskIdFromSource_(sourceId),
    created_at: createdAt || new Date(),
    source_job_id: sourceId,
    site: String(cell_(row, col, '站点') || '').trim(),
    game: String(cell_(row, col, '游戏') || '').trim(),
    page_path: pagePath,
    goal: developmentGoalFromResearchResult_(String(cell_(row, col, '研究结果') || '').trim()),
    evidence_link: String(cell_(row, col, '审核链接') || '').trim(),
    priority: developmentPriorityFromLevel_(String(cell_(row, col, '机会等级') || '').trim()),
    status: hasPhase7EBinding
      ? (siteId ? DEVELOPMENT_TASK_STATUS_LABELS.READY_FOR_IMPLEMENTATION : DEVELOPMENT_TASK_STATUS_LABELS.WAITING_SITE_CREATION)
      : DEVELOPMENT_TASK_STATUS_LABELS.TODO,
    completed_at: '',
    note: '',
    opportunity_id: opportunityId,
    decision_id: decisionId,
    site_id: siteId,
    action_type: actionType,
    task_type: hasPhase7EBinding ? 'CONTENT_IMPLEMENTATION' : '',
    task_reason: '已批准实施：' + (actionType || 'UPDATE_PAGE'),
    source_reference: String(cell_(row, col, '审核链接') || '').trim() || '研究任务/' + sourceId
  };
}

function buildDevelopmentTaskFromSteamRow_(item, createdAt) {
  var opportunityId = String(item.opportunityId || '').trim();
  return {
    development_task_id: developmentTaskIdFromIdentity_(opportunityId, '', 'BUILD', ''),
    created_at: createdAt || new Date(),
    source_job_id: '',
    site: '',
    game: String(item.game || '').trim(),
    page_path: '',
    goal: '建站',
    evidence_link: '',
    priority: 'P0',
    status: DEVELOPMENT_TASK_STATUS_LABELS.WAITING_SITE_CREATION,
    completed_at: '',
    note: '',
    opportunity_id: opportunityId,
    // Steam 候选决策源通常没有 DecisionID 列；只保留上游明确提供的值。
    decision_id: String(item.decisionId || '').trim(),
    site_id: '',
    action_type: 'BUILD',
    task_type: 'SITE_BUILD',
    task_reason: 'Steam Decision=BUILD；尚无 site_id，等待站点创建',
    source_reference: String(item.sourceReference || '').trim()
  };
}

function isApprovedSteamBuild_(item) {
  return !!(item && String(item.opportunityId || '').trim() &&
    String(item.decision || '').trim().toUpperCase() === 'BUILD');
}

function developmentDecisionIdFromResearchRow_(row, col, decisionRefs) {
  var explicit = String(cell_(row, col, 'DecisionID') || '').trim();
  if (explicit) return explicit;
  var opportunityId = String(cell_(row, col, 'OpportunityID') || '').trim();
  if (opportunityId && decisionRefs[opportunityId]) return decisionRefs[opportunityId];
  // The Research Approval is the explicit gate; keep this reference deterministic.
  return 'approval:' + String(cell_(row, col, '任务ID') || '').trim();
}

function loadDevelopmentDecisionReferences_() {
  var out = {};
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DECISION_HISTORY);
  if (!sheet || sheet.getLastRow() < 2) return out;
  var lastCol = Math.max(sheet.getLastColumn(), DECISION_HISTORY_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var oppIdx = col['OpportunityID'];
  var idIdx = col['DecisionID'];
  if (oppIdx === undefined || idIdx === undefined) return out;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  for (var i = 0; i < values.length; i++) {
    var opportunityId = String(values[i][oppIdx] || '').trim();
    var decisionId = String(values[i][idIdx] || '').trim();
    if (opportunityId && decisionId && !out[opportunityId]) out[opportunityId] = decisionId;
  }
  return out;
}

function loadDevelopmentSiteReferences_() {
  var out = {};
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.SITES);
  if (!sheet || sheet.getLastRow() < 2) return out;
  var lastCol = Math.max(sheet.getLastColumn(), SITE_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var nameIdx = col['站点名称'];
  var siteIdx = col['site_id'];
  if (nameIdx === undefined || siteIdx === undefined) return out;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  for (var i = 0; i < values.length; i++) {
    var name = String(values[i][nameIdx] || '').trim();
    if (name && !out[name]) out[name] = String(values[i][siteIdx] || '').trim();
  }
  return out;
}

function developmentSiteIdFromResearchRow_(row, col, siteRefs) {
  var explicit = String(cell_(row, col, 'SiteID') || '').trim();
  if (explicit) return explicit;
  return siteRefs[String(cell_(row, col, '站点') || '').trim()] || '';
}

/** 研究结果 → 旧列「开发目标」短中文显示。 */
function developmentGoalFromResearchResult_(resultLabel) {
  var raw = String(resultLabel || '').trim();
  if (!raw) return DEVELOPMENT_GOAL_LABELS.UPDATE_EXISTING;
  var recEnum = enumFromLabel_(RESEARCH_RESULT_RECOMMENDATION_LABELS, raw);
  if (recEnum === RESEARCH_RESULT_RECOMMENDATIONS.EXPAND_EXISTING || raw === '扩充现有页面') return DEVELOPMENT_GOAL_LABELS.EXPAND_EXISTING;
  if (recEnum === RESEARCH_RESULT_RECOMMENDATIONS.NEW_CONTENT || raw === '新内容') return DEVELOPMENT_GOAL_LABELS.NEW_PAGE;
  if (raw === DEVELOPMENT_GOAL_LABELS.NEW_PAGE) return DEVELOPMENT_GOAL_LABELS.NEW_PAGE;
  return DEVELOPMENT_GOAL_LABELS.UPDATE_EXISTING;
}

/** 机会等级 → 高 / 中 / 低 */
function developmentPriorityFromLevel_(levelLabel) {
  var raw = String(levelLabel || '').trim();
  var levelEnum = enumFromLabel_(OPPORTUNITY_LEVEL_LABELS, raw);
  if (levelEnum === OPPORTUNITY_LEVELS.HIGH || raw === '高') return DEVELOPMENT_PRIORITY_LABELS.HIGH;
  if (levelEnum === OPPORTUNITY_LEVELS.MEDIUM || raw === '中') return DEVELOPMENT_PRIORITY_LABELS.MEDIUM;
  return DEVELOPMENT_PRIORITY_LABELS.LOW;
}

function developmentTaskSheetRow_(task) {
  return [
    task.development_task_id, task.created_at || new Date(), task.source_job_id || '',
    task.site || '', task.game || '', task.page_path || '', task.goal || '',
    task.evidence_link || '', task.priority || '',
    task.status || DEVELOPMENT_TASK_STATUS_LABELS.TODO, task.completed_at || '',
    task.note || '', task.opportunity_id || '', task.decision_id || '',
    task.site_id || '', task.action_type || '', task.task_type || '',
    task.task_reason || '', task.source_reference || '',
    task.handoff_status || '', task.handoff_reference || ''
  ];
}

/** 纯逻辑自测入口；不写 Sheet、不碰生产 Research/Steam。 */
function debugDevelopmentTasksSelfCheck() {
  var fails = [];
  function assert(cond, msg) { if (!cond) fails.push(msg); }
  assert(DEVELOPMENT_TASK_HEADERS.length === 21, '开发任务 headers append-only');
  assert(DEVELOPMENT_TASK_HEADERS[0] === '开发任务ID' && DEVELOPMENT_TASK_HEADERS[11] === '备注', '旧列顺序保留');
  assert(DEVELOPMENT_TASK_HEADERS.indexOf('OpportunityID') > 11, 'OpportunityID appended');
  assert(DEVELOPMENT_TASK_HEADERS.indexOf('DecisionID') > 11, 'DecisionID appended');
  assert(DEVELOPMENT_TASK_HEADERS.indexOf('SiteID') > 11, 'SiteID appended');
  assert(DEVELOPMENT_TASK_HEADERS.indexOf('ActionType') > 11, 'ActionType appended');
  assert(DEVELOPMENT_TASK_HEADERS.indexOf('SourceReference') > 11, 'SourceReference appended');
  assert(DEVELOPMENT_TASK_HEADERS.indexOf('HandoffStatus') > 11, 'HandoffStatus appended');
  assert(DEVELOPMENT_TASK_HEADERS.indexOf('HandoffReference') > 11, 'HandoffReference appended');
  assert(isResearchJobReadyForDevelopment_('已批准', '批准开发') === true, 'approved gate');
  assert(isResearchJobReadyForDevelopment_('待审核', '批准开发') === false, 'review excluded');
  assert(isResearchJobReadyForDevelopment_('继续观察', '继续观察') === false, 'watch excluded');

  var col = headerIndexMap_(RESEARCH_JOB_HEADERS);
  var row = [];
  for (var i = 0; i < RESEARCH_JOB_HEADERS.length; i++) row.push('');
  row[col['任务ID']] = 'fixture-ms2-approved';
  row[col['站点']] = 'Mortal Shell II';
  row[col['游戏']] = 'Mortal Shell II';
  row[col['页面路径']] = '/skip-prologue/';
  row[col['机会等级']] = '高';
  row[col['任务状态']] = '已批准';
  row[col['研究结果']] = '扩充现有页面';
  row[col['审核决定']] = '批准开发';
  row[col['OpportunityID']] = 'opp-ms2-fixture-001';
  var task = buildDevelopmentTaskFromResearchRow_(row, col, new Date('2026-08-22T00:00:00Z'), {
    decisionId: 'decision-ms2-fixture-001', siteId: 'mortal-shell-ii'
  });
  assert(task.opportunity_id === 'opp-ms2-fixture-001', 'OpportunityID preserved');
  assert(task.decision_id === 'decision-ms2-fixture-001', 'DecisionID bound');
  assert(task.site_id === 'mortal-shell-ii', 'SiteID preserved');
  assert(task.action_type === 'UPDATE_PAGE', 'approved update action');
  assert(task.status === 'READY_FOR_IMPLEMENTATION', 'ready status');
  assert(developmentTaskIdentityKey_('o', 'd', 'UPDATE_PAGE', '/x') !== developmentTaskIdentityKey_('o', 'd', 'UPDATE_PAGE', '/y'), 'path in identity');

  var steamTask = buildDevelopmentTaskFromSteamRow_({
    opportunityId: 'opp-steam-build-fixture', game: 'Steam Fixture', sourceReference: 'steam-row'
  }, new Date('2026-08-22T00:00:00Z'));
  assert(steamTask.action_type === 'BUILD' && steamTask.task_type === 'SITE_BUILD', 'Steam site build');
  assert(steamTask.site_id === '' && steamTask.status === 'WAITING_SITE_CREATION', 'Steam boundary');
  assert(isApprovedSteamBuild_({ opportunityId: 'o', decision: 'BUILD' }) === true, 'Steam BUILD included');
  assert(isApprovedSteamBuild_({ opportunityId: 'o', decision: 'REJECT' }) === false, 'Steam REJECT excluded');
  assert(implementationActionFromResearchRow_(row, col) === 'UPDATE_PAGE', 'research implementation included');
  row[col['研究结果']] = '继续观察';
  assert(implementationActionFromResearchRow_(row, col) === '', 'research WATCH excluded');
  row[col['研究结果']] = '';
  row[col['建议动作']] = '研究新内容';
  assert(implementationActionFromResearchRow_(row, col) === '', 'research-only excluded');

  assert(developmentTaskSheetRow_(task).length === DEVELOPMENT_TASK_HEADERS.length, 'sheet row length');
  if (fails.length) throw new Error('DevelopmentTasks self-check failed: ' + fails.join('; '));
  return 'PASS DevelopmentTasks self-check';
}
