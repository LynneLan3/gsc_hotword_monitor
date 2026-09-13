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
 * 外部已批准 Research Pack → 现有「开发任务」队列（最薄入口）。
 * 不改 Research Job、不改菜单 createDevelopmentTasks 路径；只追加缺失任务。
 * 幂等：无正式 DecisionID 时用 OpportunityID + ActionType + PagePath；
 * 有正式 DecisionID 时仍用完整 identity。不发明 DecisionID。
 *
 * @param {Object} input
 * @return {Object} 机器可读结果（created | existing）
 */
function registerExternalDevelopmentTask(input) {
  var taskInput = normalizeExternalDevelopmentTaskInput_(input);
  ensureDevelopmentTaskSheets_();
  var sheet = ensureSheet_(SHEET_NAMES.DEVELOPMENT_TASKS, DEVELOPMENT_TASK_HEADERS);
  var existing = loadExistingDevelopmentTaskKeys_(sheet);
  var task = buildDevelopmentTaskFromExternalInput_(taskInput, new Date());

  var priorHit = findExternalDevelopmentTaskHit_(sheet, task);
  if (priorHit || externalDevelopmentTaskAlreadyExists_(existing, task)) {
    var existingResult = priorHit
      ? repairFabricatedExternalDecisionIdInPlace_(sheet, priorHit, task)
      : {
        development_task_id: task.development_task_id,
        opportunity_id: task.opportunity_id,
        decision_id: task.decision_id,
        site_id: task.site_id,
        action_type: task.action_type,
        page_path: task.page_path,
        handoff_status: task.handoff_status,
        handoff_reference: task.handoff_reference,
        source_reference: task.source_reference
      };
    var existingPayload = externalDevelopmentTaskResult_('existing', existingResult);
    writeLog_('INFO', task.site_id || '', 'registerExternalDevelopmentTask existing ' + existingPayload.DevelopmentTaskID);
    return existingPayload;
  }

  var start = Math.max(2, sheet.getLastRow() + 1);
  sheet.getRange(start, 1, 1, DEVELOPMENT_TASK_HEADERS.length).setValues([developmentTaskSheetRow_(task)]);
  markExternalDevelopmentTaskExisting_(existing, task);
  var createdPayload = externalDevelopmentTaskResult_('created', task);
  writeLog_('INFO', task.site_id || '', 'registerExternalDevelopmentTask created ' + createdPayload.DevelopmentTaskID);
  return createdPayload;
}

/**
 * 只读查询「开发任务」；供 CLI / 验证用，不改 Sheet。
 * @param {string} developmentTaskId
 * @return {Object|null}
 */
function getDevelopmentTaskById(developmentTaskId) {
  var wantId = String(developmentTaskId || '').trim();
  if (!wantId) return null;
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DEVELOPMENT_TASKS);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var lastCol = Math.max(sheet.getLastColumn(), DEVELOPMENT_TASK_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var id = String(cell_(row, col, '开发任务ID') || '').trim();
    if (id !== wantId) continue;
    return externalDevelopmentTaskResult_('existing', {
      development_task_id: id,
      opportunity_id: String(cell_(row, col, 'OpportunityID') || '').trim(),
      decision_id: String(cell_(row, col, 'DecisionID') || '').trim(),
      site_id: String(cell_(row, col, 'SiteID') || '').trim(),
      action_type: String(cell_(row, col, 'ActionType') || '').trim(),
      page_path: String(cell_(row, col, '页面路径') || '').trim(),
      handoff_status: String(cell_(row, col, 'HandoffStatus') || '').trim(),
      handoff_reference: String(cell_(row, col, 'HandoffReference') || '').trim(),
      source_reference: String(cell_(row, col, 'SourceReference') || '').trim()
    });
  }
  return null;
}

function normalizeExternalDevelopmentTaskInput_(input) {
  var raw = input || {};
  var siteId = String(raw.siteId || raw.SiteID || '').trim();
  var site = String(raw.site || raw.siteName || raw.Site || '').trim();
  var game = String(raw.game || raw.Game || '').trim();
  if (!site && !game) {
    var siteOrGame = String(raw.siteOrGame || raw.gameOrSite || raw['site/game'] || '').trim();
    site = siteOrGame;
    game = siteOrGame;
  }
  if (!site) site = game;
  if (!game) game = site;
  var pagePath = normalizeExternalDevelopmentPagePath_(raw.pagePath || raw.page || raw.Page || raw['page path']);
  var actionType = normalizeDevelopmentAction_(raw.actionType || raw.ActionType || '');
  var taskType = String(raw.taskType || raw.TaskType || 'CONTENT_IMPLEMENTATION').trim() || 'CONTENT_IMPLEMENTATION';
  var taskReason = String(raw.taskReason || raw.TaskReason || '').trim();
  var sourceReference = String(
    raw.sourceReference || raw.SourceReference || raw.researchPack || raw.ResearchPack || ''
  ).trim();
  var evidenceReference = String(
    raw.evidenceReference || raw.EvidenceReference || raw.evidenceLink || ''
  ).trim();
  var opportunityId = String(raw.opportunityId || raw.OpportunityID || '').trim();
  // Canonical attribution: blank unless Decision owner already recorded a formal ID.
  // Never invent external-approval:* / synthetic DecisionIDs.
  var decisionId = String(raw.decisionId || raw.DecisionID || '').trim();
  if (isFabricatedExternalDecisionId_(decisionId)) decisionId = '';
  var priority = String(raw.priority || raw.Priority || '').trim();

  if (!siteId) throw new Error('registerExternalDevelopmentTask: siteId required');
  if (!pagePath) throw new Error('registerExternalDevelopmentTask: pagePath required');
  if (!actionType) throw new Error('registerExternalDevelopmentTask: actionType required (CREATE_PAGE|UPDATE_PAGE|CONTENT_OPTIMIZE|BUILD)');
  if (!sourceReference) throw new Error('registerExternalDevelopmentTask: sourceReference / Research Pack required');
  if (!taskReason) throw new Error('registerExternalDevelopmentTask: taskReason required');

  if (!opportunityId) {
    opportunityId = externalOpportunityIdFromInput_(siteId, pagePath, actionType, sourceReference);
  }
  if (!evidenceReference) evidenceReference = sourceReference;

  return {
    siteId: siteId,
    site: site,
    game: game,
    pagePath: pagePath,
    actionType: actionType,
    taskType: taskType,
    taskReason: taskReason,
    priority: priority,
    sourceReference: sourceReference,
    evidenceReference: evidenceReference,
    opportunityId: opportunityId,
    decisionId: decisionId
  };
}

function normalizeExternalDevelopmentPagePath_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  if (raw === '/') return '/';
  if (raw.charAt(0) !== '/') raw = '/' + raw;
  if (raw.charAt(raw.length - 1) !== '/') raw += '/';
  return raw;
}

/** Deterministic OpportunityID when caller omits one. */
function externalOpportunityIdFromInput_(siteId, pagePath, actionType, sourceReference) {
  var pathToken = String(pagePath || '/').replace(/^\/+|\/+$/g, '') || 'root';
  pathToken = pathToken.replace(/[^A-Za-z0-9._-]+/g, '-');
  var packToken = String(sourceReference || '')
    .replace(/\.md$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ('opp-ext-' + [siteId, pathToken, actionType, packToken].join('-')).toLowerCase();
}

function buildDevelopmentTaskFromExternalInput_(input, createdAt) {
  var opportunityId = String(input.opportunityId || '').trim();
  var decisionId = String(input.decisionId || '').trim();
  var actionType = String(input.actionType || '').trim();
  var pagePath = String(input.pagePath || '').trim();
  var siteId = String(input.siteId || '').trim();
  var developmentTaskId = developmentTaskIdFromIdentity_(
    opportunityId, decisionId, actionType, pagePath
  );
  return {
    development_task_id: developmentTaskId,
    created_at: createdAt || new Date(),
    source_job_id: 'external:' + String(input.sourceReference || '').trim(),
    site: String(input.site || '').trim(),
    game: String(input.game || '').trim(),
    page_path: pagePath,
    goal: developmentGoalFromActionType_(actionType),
    evidence_link: String(input.evidenceReference || '').trim(),
    priority: developmentPriorityFromLevel_(input.priority),
    status: siteId
      ? DEVELOPMENT_TASK_STATUS_LABELS.READY_FOR_IMPLEMENTATION
      : DEVELOPMENT_TASK_STATUS_LABELS.WAITING_SITE_CREATION,
    completed_at: '',
    note: '',
    opportunity_id: opportunityId,
    decision_id: decisionId,
    site_id: siteId,
    action_type: actionType,
    task_type: String(input.taskType || 'CONTENT_IMPLEMENTATION').trim(),
    task_reason: String(input.taskReason || '').trim(),
    source_reference: String(input.sourceReference || '').trim(),
    handoff_status: DEVELOPMENT_TASK_STATUS_LABELS.READY_FOR_IMPLEMENTATION,
    handoff_reference: 'handoff:' + developmentTaskId
  };
}

function developmentGoalFromActionType_(actionType) {
  var action = String(actionType || '').trim().toUpperCase();
  if (action === 'CREATE_PAGE') return DEVELOPMENT_GOAL_LABELS.NEW_PAGE;
  if (action === 'BUILD') return '建站';
  if (action === 'CONTENT_OPTIMIZE') return DEVELOPMENT_GOAL_LABELS.EXPAND_EXISTING;
  return DEVELOPMENT_GOAL_LABELS.UPDATE_EXISTING;
}

function externalDevelopmentTaskResult_(status, task) {
  return {
    ok: true,
    status: status,
    created: status === 'created',
    existing: status === 'existing',
    DevelopmentTaskID: String(task.development_task_id || '').trim(),
    OpportunityID: String(task.opportunity_id || '').trim(),
    SiteID: String(task.site_id || '').trim(),
    HandoffStatus: String(task.handoff_status || '').trim(),
    HandoffReference: String(task.handoff_reference || '').trim(),
    SourceReference: String(task.source_reference || '').trim(),
    DecisionID: String(task.decision_id || '').trim(),
    ActionType: String(task.action_type || '').trim(),
    PagePath: String(task.page_path || '').trim()
  };
}

/** Fabricated DecisionIDs invented by the first external-registration build. */
function isFabricatedExternalDecisionId_(decisionId) {
  return /^external-approval:/i.test(String(decisionId || '').trim());
}

/** External idempotency without a formal DecisionID. */
function externalDevelopmentTaskMatchKey_(opportunityId, actionType, targetPath) {
  return [opportunityId, actionType, targetPath].map(function (value) {
    return String(value || '').trim();
  }).join('\u001f');
}

function ledgerAttributionModeForDecisionId_(decisionId) {
  return String(decisionId || '').trim() ? 'FORMAL_DECISION_LINKED' : 'OBSERVATIONAL_ONLY';
}

/**
 * @return {{rowIndex:number, task:Object, col:Object}|null}
 * rowIndex is 1-based Sheet row.
 */
function findExternalDevelopmentTaskHit_(sheet, task) {
  if (!sheet || sheet.getLastRow() < 2 || !task) return null;
  var lastCol = Math.max(sheet.getLastColumn(), DEVELOPMENT_TASK_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var wantKey = developmentTaskIdentityKey_(
    task.opportunity_id, task.decision_id, task.action_type, task.page_path
  );
  var wantExternalKey = externalDevelopmentTaskMatchKey_(
    task.opportunity_id, task.action_type, task.page_path
  );
  var wantId = String(task.development_task_id || '').trim();
  var allowExternalMatch = !String(task.decision_id || '').trim();

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var opportunityId = String(cell_(row, col, 'OpportunityID') || '').trim();
    var decisionId = String(cell_(row, col, 'DecisionID') || '').trim();
    var actionType = String(cell_(row, col, 'ActionType') || '').trim();
    var pagePath = String(cell_(row, col, '页面路径') || '').trim();
    var developmentTaskId = String(cell_(row, col, '开发任务ID') || '').trim();
    var key = developmentTaskIdentityKey_(opportunityId, decisionId, actionType, pagePath);
    var externalKey = externalDevelopmentTaskMatchKey_(opportunityId, actionType, pagePath);
    var exact = opportunityId && actionType && key === wantKey;
    var byId = !!(wantId && developmentTaskId === wantId);
    var externalSame = allowExternalMatch && opportunityId && actionType &&
      externalKey === wantExternalKey &&
      (!decisionId || isFabricatedExternalDecisionId_(decisionId));
    if (exact || byId || externalSame) {
      return {
        rowIndex: i + 2,
        col: col,
        task: {
          development_task_id: developmentTaskId,
          opportunity_id: opportunityId,
          decision_id: decisionId,
          site_id: String(cell_(row, col, 'SiteID') || '').trim(),
          action_type: actionType,
          page_path: pagePath,
          handoff_status: String(cell_(row, col, 'HandoffStatus') || '').trim(),
          handoff_reference: String(cell_(row, col, 'HandoffReference') || '').trim(),
          source_reference: String(cell_(row, col, 'SourceReference') || '').trim()
        }
      };
    }
  }
  return null;
}

/** @return {Object|null} task-shaped object from an existing sheet row */
function findExistingDevelopmentTaskRow_(sheet, task) {
  var hit = findExternalDevelopmentTaskHit_(sheet, task);
  return hit ? hit.task : null;
}

/**
 * Clear fabricated external-approval DecisionID in place.
 * Keeps DevelopmentTaskID / OpportunityID / HandoffReference unchanged.
 */
function repairFabricatedExternalDecisionIdInPlace_(sheet, hit, incomingTask) {
  var task = hit.task || {};
  var incomingDecision = String((incomingTask && incomingTask.decision_id) || '').trim();
  if (isFabricatedExternalDecisionId_(task.decision_id) && !incomingDecision) {
    var decisionCol = hit.col && hit.col['DecisionID'];
    if (decisionCol !== undefined && hit.rowIndex >= 2) {
      sheet.getRange(hit.rowIndex, decisionCol + 1).setValue('');
    }
    task.decision_id = '';
  }
  return task;
}

function externalDevelopmentTaskAlreadyExists_(existing, task) {
  if (developmentTaskAlreadyExists_(existing, task)) return true;
  if (!task || !task.opportunity_id || !task.action_type) return false;
  if (String(task.decision_id || '').trim()) return false;
  return !!(existing && existing.external &&
    existing.external[externalDevelopmentTaskMatchKey_(
      task.opportunity_id, task.action_type, task.page_path
    )]);
}

function markExternalDevelopmentTaskExisting_(existing, task) {
  markDevelopmentTaskExisting_(existing, task);
  if (!existing.external) existing.external = {};
  if (task && task.opportunity_id && task.action_type) {
    existing.external[externalDevelopmentTaskMatchKey_(
      task.opportunity_id, task.action_type, task.page_path
    )] = true;
  }
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
  task.status = siteRefs[site]
    ? DEVELOPMENT_TASK_STATUS_LABELS.READY_FOR_IMPLEMENTATION
    : DEVELOPMENT_TASK_STATUS_LABELS.WAITING_SITE_CREATION;
  task.evidence_link = String(
    cell_(jobRow, jobCol, '结果路径') || cell_(jobRow, jobCol, '审核链接') || ''
  ).trim();
  task.task_type = 'CONTENT_IMPLEMENTATION';
  task.task_reason = 'ContentDecision' + (decision.decisionId ? ' ' + decision.decisionId : '') + '：' +
    (decision.decisionReason || decision.primaryDecision);
  task.source_reference = '研究任务/' + sourceId +
    (decision.decisionId ? ' / Decision/' + decision.decisionId : '');
  if (developmentTaskAlreadyExists_(existing, task)) {
    return { created: 0, skipped: 1, developmentTaskId: task.development_task_id };
  }
  var start = Math.max(2, sheet.getLastRow() + 1);
  sheet.getRange(start, 1, 1, DEVELOPMENT_TASK_HEADERS.length).setValues([developmentTaskSheetRow_(task)]);
  return { created: 1, skipped: 0, developmentTaskId: task.development_task_id };
}

function isContentDecisionImplementationEligible_(decision) {
  if (!decision || String(decision.confidence || '').toUpperCase() !== 'HIGH') return false;
  if (String(decision.publishState || decision.publish_state || '').toUpperCase() !== 'READY_FOR_WRITER') return false;
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

/** @return {{identity:Object<string, boolean>, sourceIds:Object<string, boolean>, external:Object<string, boolean>}} */
function loadExistingDevelopmentTaskKeys_(sheet) {
  var result = { identity: {}, sourceIds: {}, external: {} };
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
      if (!decisionId || isFabricatedExternalDecisionId_(decisionId)) {
        result.external[externalDevelopmentTaskMatchKey_(
          opportunityId, actionType, targetPath
        )] = true;
      }
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
  var researchResultPath = String(
    item.ResearchResultPath || item.researchResultPath ||
    item.autoResearchResultPath || item.AutoResearchResultPath ||
    item.sourceReference || item.SourceReference || ''
  ).trim();
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
    source_reference: researchResultPath
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

/** 机会等级 → 高 / 中 / 低（兼容 high / HIGH / 高） */
function developmentPriorityFromLevel_(levelLabel) {
  var raw = String(levelLabel || '').trim();
  var upper = raw.toUpperCase();
  var levelEnum = enumFromLabel_(OPPORTUNITY_LEVEL_LABELS, raw);
  if (levelEnum === OPPORTUNITY_LEVELS.HIGH || raw === '高' || upper === 'HIGH') {
    return DEVELOPMENT_PRIORITY_LABELS.HIGH;
  }
  if (levelEnum === OPPORTUNITY_LEVELS.MEDIUM || raw === '中' || upper === 'MEDIUM') {
    return DEVELOPMENT_PRIORITY_LABELS.MEDIUM;
  }
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
    opportunityId: 'opp-steam-build-fixture', game: 'Steam Fixture', autoResearchResultPath: 'jobs/steam-build/research.json'
  }, new Date('2026-08-22T00:00:00Z'));
  assert(steamTask.action_type === 'BUILD' && steamTask.task_type === 'SITE_BUILD', 'Steam site build');
  assert(steamTask.site_id === '' && steamTask.status === 'WAITING_SITE_CREATION', 'Steam boundary');
  assert(steamTask.source_reference === 'jobs/steam-build/research.json', 'Steam ResearchResultPath preserved');
  assert(isApprovedSteamBuild_({ opportunityId: 'o', decision: 'BUILD' }) === true, 'Steam BUILD included');
  assert(isApprovedSteamBuild_({ opportunityId: 'o', decision: 'REJECT' }) === false, 'Steam REJECT excluded');
  assert(implementationActionFromResearchRow_(row, col) === 'UPDATE_PAGE', 'research implementation included');
  row[col['研究结果']] = '继续观察';
  assert(implementationActionFromResearchRow_(row, col) === '', 'research WATCH excluded');
  row[col['研究结果']] = '';
  row[col['建议动作']] = '研究新内容';
  assert(implementationActionFromResearchRow_(row, col) === '', 'research-only excluded');

  assert(developmentTaskSheetRow_(task).length === DEVELOPMENT_TASK_HEADERS.length, 'sheet row length');

  var externalInput = normalizeExternalDevelopmentTaskInput_({
    siteId: 'withering-realms',
    site: 'Withering Realms Guide',
    game: 'Withering Realms Guide',
    pagePath: '/category/',
    actionType: 'UPDATE_PAGE',
    taskType: 'CONTENT_IMPLEMENTATION',
    taskReason: 'Launch Intent Hub upgrade from verified launch research',
    priority: 'high',
    sourceReference: 'withering_realms_research_pack_2026-09-08.md',
    evidenceReference: 'withering_realms_research_pack_2026-09-08.md'
  });
  assert(externalInput.opportunityId.indexOf('opp-ext-withering-realms-category-update_page') === 0, 'external OpportunityID rule');
  assert(externalInput.decisionId === '', 'external DecisionID stays blank');
  assert(isFabricatedExternalDecisionId_('external-approval:pack.md') === true, 'fabricated DecisionID detected');
  var stripped = normalizeExternalDevelopmentTaskInput_({
    siteId: 'withering-realms',
    site: 'Withering Realms Guide',
    pagePath: '/category/',
    actionType: 'UPDATE_PAGE',
    taskType: 'CONTENT_IMPLEMENTATION',
    taskReason: 'x',
    priority: 'high',
    sourceReference: 'pack.md',
    decisionId: 'external-approval:pack.md'
  });
  assert(stripped.decisionId === '', 'fabricated DecisionID stripped');
  var externalTask = buildDevelopmentTaskFromExternalInput_(externalInput, new Date('2026-09-08T00:00:00Z'));
  assert(externalTask.site_id === 'withering-realms', 'external SiteID');
  assert(externalTask.action_type === 'UPDATE_PAGE', 'external ActionType');
  assert(externalTask.task_type === 'CONTENT_IMPLEMENTATION', 'external TaskType');
  assert(externalTask.decision_id === '', 'external task DecisionID blank');
  assert(externalTask.handoff_status === 'READY_FOR_IMPLEMENTATION', 'external HandoffStatus');
  assert(externalTask.handoff_reference.indexOf('handoff:dev-') === 0, 'external HandoffReference');
  assert(externalTask.development_task_id === developmentTaskIdFromIdentity_(
    externalTask.opportunity_id, '', externalTask.action_type, externalTask.page_path
  ), 'external DevelopmentTaskID from blank-decision identity');
  assert(ledgerAttributionModeForDecisionId_(externalTask.decision_id) === 'OBSERVATIONAL_ONLY', 'no DecisionID → observational');
  var existingKeys = { identity: {}, sourceIds: {}, external: {} };
  markExternalDevelopmentTaskExisting_(existingKeys, externalTask);
  assert(externalDevelopmentTaskAlreadyExists_(existingKeys, externalTask) === true, 'external idempotent key');
  var legacyTaskId = developmentTaskIdFromIdentity_(
    externalTask.opportunity_id,
    'external-approval:withering_realms_research_pack_2026-09-08.md',
    externalTask.action_type,
    externalTask.page_path
  );
  assert(legacyTaskId !== externalTask.development_task_id, 'legacy fabricated ID differs from blank-decision ID');
  assert(
    externalDevelopmentTaskMatchKey_(externalTask.opportunity_id, externalTask.action_type, externalTask.page_path) ===
      externalDevelopmentTaskMatchKey_(
        externalTask.opportunity_id, 'UPDATE_PAGE', '/category/'
      ),
    'legacy row shares external match key'
  );
  var externalResult = externalDevelopmentTaskResult_('created', externalTask);
  assert(externalResult.ok === true && externalResult.created === true && externalResult.existing === false, 'external result flags');
  assert(externalResult.DevelopmentTaskID === externalTask.development_task_id, 'external result ID');
  assert(externalResult.DecisionID === '', 'external result DecisionID blank');
  assert(typeof createDevelopmentTasks === 'function', 'menu createDevelopmentTasks preserved');
  assert(typeof registerExternalDevelopmentTask === 'function', 'external registration entry present');

  if (fails.length) throw new Error('DevelopmentTasks self-check failed: ' + fails.join('; '));
  return 'PASS DevelopmentTasks self-check';
}
