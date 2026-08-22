/**
 * Phase 7F: Development Task -> Implementation Handoff.
 *
 * An Implementation Handoff is a derived execution snapshot. The Development
 * Task sheet remains the runtime source of truth; only HandoffStatus and the
 * deterministic HandoffReference are persisted there. No agent, repo,
 * GitHub, Vercel, site_id or site-spec operation happens here.
 */

var IMPLEMENTATION_HANDOFF_STATUS = {
  READY: 'READY',
  REPO_PATH_UNRESOLVED: 'REPO_PATH_UNRESOLVED',
  REPO_REFERENCE_UNRESOLVED: 'REPO_REFERENCE_UNRESOLVED',
  SITE_ID_UNRESOLVED: 'SITE_ID_UNRESOLVED',
  SITE_CREATION_REQUIRED: 'SITE_CREATION_REQUIRED'
};

var IMPLEMENTATION_HANDOFF_STARTER = 'game-wiki-starter';

/**
 * Stable current-snapshot reference. It is deliberately not timestamped.
 * @param {string} taskId
 * @return {string}
 */
function implementationHandoffReference_(taskId) {
  var raw = String(taskId || '').trim();
  return 'handoffs/' + encodeURIComponent(raw).replace(/%/g, '_') + '.json';
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

/**
 * Resolve an existing site through the current GSC Site Identity row and the
 * existing site_id-keyed Control Center registry adapter.
 */
function resolveImplementationSiteReference_(task) {
  var siteId = String((task && (task.site_id || task.SiteID)) || '').trim();
  var siteName = String((task && (task.site || task.site_name)) || '').trim();
  var resolved = {
    siteId: siteId,
    game: String((task && task.game) || '').trim(),
    targetPath: String((task && (task.page_path || task.target_path)) || '').trim(),
    repoPath: '',
    githubRepo: ''
  };

  if (!siteId) return resolved;

  var registry = getSiteRepositoryReferenceBySiteId_(siteId) || {};
  resolved.repoPath = String(registry.repoPath || '').trim();
  resolved.githubRepo = String(registry.githubRepo || '').trim();
  return resolved;
}

function implementationHandoffStatusForExistingSite_(site) {
  if (!site.siteId) return IMPLEMENTATION_HANDOFF_STATUS.SITE_ID_UNRESOLVED;
  if (!site.githubRepo) return IMPLEMENTATION_HANDOFF_STATUS.REPO_REFERENCE_UNRESOLVED;
  if (!site.repoPath) return IMPLEMENTATION_HANDOFF_STATUS.REPO_PATH_UNRESOLVED;
  return IMPLEMENTATION_HANDOFF_STATUS.READY;
}

/**
 * Build the minimal machine-readable handoff payload. Research content is
 * never copied; only its task ID, result path and source reference survive.
 *
 * @param {Object} developmentTask
 * @return {Object}
 */
function buildImplementationHandoff_(developmentTask) {
  var task = developmentTask || {};
  var taskId = implementationHandoffTaskId_(task);
  var taskType = String((task.task_type || task.TaskType) || '').trim();
  var actionType = String((task.action_type || task.ActionType) || '').trim();
  var status = String((task.status || task.TaskStatus) || '').trim();
  var handoff = {
    TaskID: taskId,
    OpportunityID: String((task.opportunity_id || task.OpportunityID) || '').trim(),
    DecisionID: String((task.decision_id || task.DecisionID) || '').trim(),
    Game: String(task.game || '').trim(),
    SiteID: String((task.site_id || task.SiteID) || '').trim(),
    TaskType: taskType,
    ActionType: actionType,
    TaskReason: String((task.task_reason || task.TaskReason) || '').trim(),
    TargetPath: String((task.page_path || task.target_path || task.TargetPath) || '').trim(),
    RepoPath: '',
    GithubRepo: '',
    ResearchTaskID: String((task.source_job_id || task.ResearchTaskID) || '').trim(),
    ResearchResultPath: String((task.evidence_link || task.ResearchResultPath) || '').trim(),
    SourceReference: String((task.source_reference || task.SourceReference) || '').trim(),
    Starter: '',
    HandoffStatus: '',
    HandoffReference: implementationHandoffReference_(taskId)
  };

  if (taskType === 'SITE_BUILD' && status === DEVELOPMENT_TASK_STATUS.WAITING_SITE_CREATION) {
    handoff.SiteID = '';
    handoff.RepoPath = '';
    handoff.GithubRepo = '';
    handoff.Starter = IMPLEMENTATION_HANDOFF_STARTER;
    handoff.HandoffStatus = IMPLEMENTATION_HANDOFF_STATUS.SITE_CREATION_REQUIRED;
    return handoff;
  }

  if (taskType === 'CONTENT_IMPLEMENTATION' &&
      status === DEVELOPMENT_TASK_STATUS.READY_FOR_IMPLEMENTATION) {
    var site = resolveImplementationSiteReference_(task);
    handoff.SiteID = site.siteId;
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
    site: String(cell_(row, col, '站点') || '').trim(),
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

/**
 * Refresh the current handoff snapshot in-place. Same TaskID always keeps the
 * same reference; excluded tasks have stale handoff fields cleared.
 * @return {string}
 */
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

  var rowCount = sheet.getLastRow() - 1;
  var values = sheet.getRange(2, 1, rowCount, lastCol).getValues();
  var output = [];
  var generated = 0;
  var excluded = 0;
  for (var i = 0; i < values.length; i++) {
    var task = implementationHandoffTaskFromSheetRow_(values[i], col);
    var taskStatus = String(task.status || '').trim();
    if (!implementationHandoffEligibleStatus_(taskStatus) || !implementationHandoffTaskId_(task)) {
      output.push(['', '']);
      excluded++;
      continue;
    }
    var handoff = buildImplementationHandoff_(task);
    output.push([handoff.HandoffStatus, handoff.HandoffReference]);
    generated++;
  }

  var startCol = Math.min(statusCol, referenceCol) + 1;
  if (Math.abs(statusCol - referenceCol) !== 1) {
    for (var j = 0; j < output.length; j++) {
      sheet.getRange(j + 2, statusCol + 1).setValue(output[j][0]);
      sheet.getRange(j + 2, referenceCol + 1).setValue(output[j][1]);
    }
  } else {
    if (statusCol > referenceCol) {
      output = output.map(function (item) { return [item[1], item[0]]; });
    }
    sheet.getRange(2, startCol, output.length, 2).setValues(output);
  }

  var summary = 'refreshImplementationHandoffs 结束 generated=' + generated + ' excluded=' + excluded;
  writeLog_('INFO', '', summary);
  Logger.log(summary);
  return summary;
}
