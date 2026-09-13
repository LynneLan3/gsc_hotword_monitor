/**
 * Phase 7F: Development Task -> online Implementation Handoff.
 *
 * The existing 开发任务 sheet stays the source of truth. This file only
 * derives deterministic, read-only machine handoffs and refreshes their two
 * snapshot columns; it does not call an agent or publish a site.
 */

var IMPLEMENTATION_HANDOFF_STATUS = {
  READY: 'READY',
  REPO_PATH_UNRESOLVED: 'REPO_PATH_UNRESOLVED',
  REPO_REFERENCE_UNRESOLVED: 'REPO_REFERENCE_UNRESOLVED',
  SITE_ID_UNRESOLVED: 'SITE_ID_UNRESOLVED',
  SITE_CREATION_REQUIRED: 'SITE_CREATION_REQUIRED'
};

var IMPLEMENTATION_HANDOFF_STARTER = 'game-wiki-starter';

function implementationHandoffReference_(taskId) {
  return 'handoffs/' + encodeURIComponent(String(taskId || '').trim()).replace(/%/g, '_') + '.json';
}

function implementationHandoffEligibleStatus_(status) {
  var raw = String(status || '').trim();
  return raw === DEVELOPMENT_TASK_STATUS.READY_FOR_IMPLEMENTATION ||
    raw === DEVELOPMENT_TASK_STATUS_LABELS.READY_FOR_IMPLEMENTATION ||
    raw === DEVELOPMENT_TASK_STATUS.WAITING_SITE_CREATION ||
    raw === DEVELOPMENT_TASK_STATUS_LABELS.WAITING_SITE_CREATION;
}

function implementationHandoffTaskId_(task) {
  return String((task && (task.development_task_id || task.task_id || task.TaskID)) || '').trim();
}

function resolveImplementationSiteReference_(task) {
  var siteId = String((task && (task.site_id || task.SiteID)) || '').trim();
  var registry = siteId && getSiteRepositoryReferenceBySiteId_(siteId) || {};
  return {
    siteId: siteId,
    repoPath: String(registry.repoPath || '').trim(),
    githubRepo: String(registry.githubRepo || '').trim()
  };
}

function implementationHandoffStatusForExistingSite_(site) {
  if (!site.siteId) return IMPLEMENTATION_HANDOFF_STATUS.SITE_ID_UNRESOLVED;
  if (!site.githubRepo) return IMPLEMENTATION_HANDOFF_STATUS.REPO_REFERENCE_UNRESOLVED;
  if (!site.repoPath) return IMPLEMENTATION_HANDOFF_STATUS.REPO_PATH_UNRESOLVED;
  return IMPLEMENTATION_HANDOFF_STATUS.READY;
}

function buildImplementationHandoff_(developmentTask) {
  var task = developmentTask || {};
  var taskId = implementationHandoffTaskId_(task);
  var taskType = String((task.task_type || task.TaskType) || '').trim();
  var status = String((task.status || task.TaskStatus) || '').trim();
  var handoff = {
    TaskID: taskId,
    OpportunityID: String((task.opportunity_id || task.OpportunityID) || '').trim(),
    DecisionID: String((task.decision_id || task.DecisionID) || '').trim(),
    Game: String(task.game || '').trim(),
    SiteID: String((task.site_id || task.SiteID) || '').trim(),
    TaskType: taskType,
    ActionType: String((task.action_type || task.ActionType) || '').trim(),
    TaskReason: String((task.task_reason || task.TaskReason) || '').trim(),
    TargetPath: String((task.page_path || task.target_path || task.TargetPath) || '').trim(),
    RepoPath: '',
    GithubRepo: '',
    ResearchTaskID: String((task.source_job_id || task.ResearchTaskID) || '').trim(),
    ResearchResultPath: String((task.evidence_link || task.ResearchResultPath ||
      task.research_result_path || task.source_reference || task.SourceReference) || '').trim(),
    SourceReference: String((task.source_reference || task.SourceReference) || '').trim(),
    Starter: '',
    HandoffStatus: '',
    HandoffReference: implementationHandoffReference_(taskId)
  };

  if (taskType === 'SITE_BUILD' && status === DEVELOPMENT_TASK_STATUS.WAITING_SITE_CREATION) {
    handoff.SiteID = '';
    handoff.Starter = IMPLEMENTATION_HANDOFF_STARTER;
    handoff.HandoffStatus = IMPLEMENTATION_HANDOFF_STATUS.SITE_CREATION_REQUIRED;
    return handoff;
  }

  if (taskType === 'CONTENT_IMPLEMENTATION' &&
      status === DEVELOPMENT_TASK_STATUS.READY_FOR_IMPLEMENTATION) {
    var site = resolveImplementationSiteReference_(task);
    handoff.RepoPath = site.repoPath;
    handoff.GithubRepo = site.githubRepo;
    handoff.HandoffStatus = implementationHandoffStatusForExistingSite_(site);
  }
  return handoff;
}

function implementationHandoffTaskFromSheetRow_(row, col) {
  return {
    development_task_id: String(cell_(row, col, '开发任务ID') || '').trim(),
    source_job_id: String(cell_(row, col, '来源任务ID') || '').trim(),
    game: String(cell_(row, col, '游戏') || '').trim(),
    page_path: String(cell_(row, col, '页面路径') || '').trim(),
    evidence_link: String(cell_(row, col, 'Evidence链接') || '').trim(),
    status: String(cell_(row, col, '任务状态') || '').trim(),
    opportunity_id: String(cell_(row, col, 'OpportunityID') || '').trim(),
    decision_id: String(cell_(row, col, 'DecisionID') || '').trim(),
    site_id: String(cell_(row, col, 'SiteID') || '').trim(),
    action_type: String(cell_(row, col, 'ActionType') || '').trim(),
    task_type: String(cell_(row, col, 'TaskType') || '').trim(),
    task_reason: String(cell_(row, col, 'TaskReason') || '').trim(),
    source_reference: String(cell_(row, col, 'SourceReference') || '').trim()
  };
}

function readImplementationHandoffs_(onlyReady, taskId) {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DEVELOPMENT_TASKS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var lastCol = Math.max(sheet.getLastColumn(), DEVELOPMENT_TASK_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var task = implementationHandoffTaskFromSheetRow_(values[i], col);
    if (taskId && task.development_task_id !== taskId) continue;
    if (!implementationHandoffEligibleStatus_(task.status) || !task.development_task_id) continue;
    var handoff = buildImplementationHandoff_(task);
    if (onlyReady && handoff.HandoffStatus !== IMPLEMENTATION_HANDOFF_STATUS.READY) continue;
    out.push(handoff);
  }
  return out;
}

/** Read-only Web App payload for the next machine implementation tasks. */
function loadPendingImplementationHandoffs_() {
  return readImplementationHandoffs_(true, '');
}

function getImplementationHandoffByTaskId_(taskId) {
  var rows = readImplementationHandoffs_(false, String(taskId || '').trim());
  return rows.length ? rows[0] : null;
}

/** Refresh current handoff status/reference columns without creating history. */
function refreshImplementationHandoffs_() {
  ensureDevelopmentTaskSheets_();
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DEVELOPMENT_TASKS);
  if (!sheet || sheet.getLastRow() < 2) return 'refreshImplementationHandoffs 结束 generated=0 excluded=0';

  var lastCol = Math.max(sheet.getLastColumn(), DEVELOPMENT_TASK_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var statusCol = col.HandoffStatus;
  var referenceCol = col.HandoffReference;
  if (statusCol === undefined || referenceCol === undefined) {
    throw new Error('开发任务缺少 HandoffStatus/HandoffReference columns');
  }

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var output = [];
  var generated = 0;
  var excluded = 0;
  for (var i = 0; i < values.length; i++) {
    var task = implementationHandoffTaskFromSheetRow_(values[i], col);
    if (!implementationHandoffEligibleStatus_(task.status) || !task.development_task_id) {
      output.push(['', '']);
      excluded++;
      continue;
    }
    var handoff = buildImplementationHandoff_(task);
    output.push([handoff.HandoffStatus, handoff.HandoffReference]);
    generated++;
  }

  if (Math.abs(statusCol - referenceCol) === 1) {
    if (statusCol > referenceCol) {
      output = output.map(function (item) { return [item[1], item[0]]; });
    }
    sheet.getRange(2, Math.min(statusCol, referenceCol) + 1, output.length, 2).setValues(output);
  } else {
    for (var j = 0; j < output.length; j++) {
      sheet.getRange(j + 2, statusCol + 1).setValue(output[j][0]);
      sheet.getRange(j + 2, referenceCol + 1).setValue(output[j][1]);
    }
  }

  var summary = 'refreshImplementationHandoffs 结束 generated=' + generated + ' excluded=' + excluded;
  writeLog_('INFO', '', summary);
  Logger.log(summary);
  return summary;
}
