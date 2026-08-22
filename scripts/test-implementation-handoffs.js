/** Phase 7F Implementation Handoff contract tests. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var identitySrc = fs.readFileSync(path.join(root, 'SiteIdentity.gs'), 'utf8');
var handoffSrc = fs.readFileSync(path.join(root, 'ImplementationHandoffs.gs'), 'utf8');
var developmentSrc = fs.readFileSync(path.join(root, 'DevelopmentTasks.gs'), 'utf8');

function assert(value, message) {
  if (!value) throw new Error(message);
}

var context = {
  DEVELOPMENT_TASK_STATUS: {
    READY_FOR_IMPLEMENTATION: 'READY_FOR_IMPLEMENTATION',
    WAITING_SITE_CREATION: 'WAITING_SITE_CREATION'
  },
  DEVELOPMENT_TASK_STATUS_LABELS: {
    READY_FOR_IMPLEMENTATION: 'READY_FOR_IMPLEMENTATION',
    WAITING_SITE_CREATION: 'WAITING_SITE_CREATION'
  },
  SHEET_NAMES: {DEVELOPMENT_TASKS: '开发任务'},
  DEVELOPMENT_TASK_HEADERS: [
    '开发任务ID', '创建时间', '来源任务ID', '站点', '游戏', '页面路径',
    '开发目标', 'Evidence链接', '优先级', '任务状态', '完成时间', '备注',
    'OpportunityID', 'DecisionID', 'SiteID', 'ActionType', 'TaskType',
    'TaskReason', 'SourceReference', 'HandoffStatus', 'HandoffReference'
  ],
  IMPLEMENTATION_HANDOFF_STATUS: {},
  Logger: {log: function () {}},
  writeLog_: function () {},
  ensureDevelopmentTaskSheets_: function () {},
  getSpreadsheet_: function () { throw new Error('refresh not run in this pure test'); },
  headerIndexMap_: function (headers) {
    var out = {};
    headers.forEach(function (header, index) { out[String(header || '').trim()] = index; });
    return out;
  },
  cell_: function (row, col, name) {
    return col[name] === undefined ? '' : row[col[name]];
  },
  console: console
};
vm.createContext(context);
vm.runInContext(identitySrc, context);
vm.runInContext(handoffSrc, context);

// Existing-site CONTENT_IMPLEMENTATION: all required handoff references survive.
var existingTask = {
  development_task_id: 'dev-content-fixture-001',
  source_job_id: 'research-fixture-001',
  site: 'Mortal Shell II',
  game: 'Mortal Shell II',
  page_path: '/mortal-shell-ii/crashing-pc/',
  evidence_link: 'docs/research-result-fixture-001.json',
  status: 'READY_FOR_IMPLEMENTATION',
  opportunity_id: 'opp-content-fixture-001',
  decision_id: 'decision-content-fixture-001',
  site_id: 'mortal-shell-ii',
  action_type: 'UPDATE_PAGE',
  task_type: 'CONTENT_IMPLEMENTATION',
  task_reason: 'approved content update',
  source_reference: 'research-job/research-fixture-001'
};
var existing = context.buildImplementationHandoff_(existingTask);
assert(existing.TaskID === 'dev-content-fixture-001', 'TaskID preserved');
assert(existing.OpportunityID === 'opp-content-fixture-001', 'OpportunityID preserved');
assert(existing.DecisionID === 'decision-content-fixture-001', 'DecisionID preserved');
assert(existing.SiteID === 'mortal-shell-ii', 'SiteID preserved');
assert(existing.Game === 'Mortal Shell II', 'Game preserved');
assert(existing.ActionType === 'UPDATE_PAGE', 'ActionType preserved');
assert(existing.TargetPath === '/mortal-shell-ii/crashing-pc/', 'TargetPath preserved');
assert(existing.ResearchTaskID === 'research-fixture-001', 'ResearchTaskID preserved');
assert(existing.ResearchResultPath === 'docs/research-result-fixture-001.json', 'Research result reference preserved');
assert(existing.SourceReference === 'research-job/research-fixture-001', 'SourceReference preserved');
assert(existing.RepoPath === '/Users/lanling/Code/hot_words_websites/Mortal Shell II', 'RepoPath resolved from site registry');
assert(existing.GithubRepo === 'LynneLan3/Mortal-Shell-II', 'GithubRepo resolved from site registry');
assert(existing.HandoffStatus === 'READY', 'existing-site handoff ready');

// SITE_BUILD fixture: no site_id/repo/Vercel operation, and starter is explicit.
var build = context.buildImplementationHandoff_({
  development_task_id: 'dev-build-fixture-001',
  source_job_id: 'steam-candidate-fixture-001',
  game: 'Example Game',
  status: 'WAITING_SITE_CREATION',
  opportunity_id: 'opp-example-game-steam-candidate-001',
  decision_id: 'example-build-decision',
  site_id: '',
  action_type: 'BUILD',
  task_type: 'SITE_BUILD',
  task_reason: 'Steam Decision=BUILD',
  source_reference: 'steam-candidate/opp-example-game-steam-candidate-001'
});
assert(build.OpportunityID === 'opp-example-game-steam-candidate-001', 'BUILD OpportunityID preserved');
assert(build.DecisionID === 'example-build-decision', 'BUILD DecisionID preserved');
assert(build.Game === 'Example Game', 'BUILD game preserved');
assert(build.ActionType === 'BUILD', 'BUILD action preserved');
assert(build.SiteID === '', 'BUILD does not create site_id');
assert(build.RepoPath === '' && build.GithubRepo === '', 'BUILD has no repo reference');
assert(build.Starter === 'game-wiki-starter', 'BUILD starter preserved');
assert(build.HandoffStatus === 'SITE_CREATION_REQUIRED', 'BUILD status');

// Explicit unresolved path: no guessed /Users path is introduced.
var originalResolver = context.getSiteRepositoryReferenceBySiteId_;
context.getSiteRepositoryReferenceBySiteId_ = function (siteId) {
  assert(siteId === 'registry-only-site', 'resolver receives SiteID, not game name');
  return {repoPath: '', githubRepo: 'LynneLan3/registry-only-repo'};
};
var unresolved = context.buildImplementationHandoff_(Object.assign({}, existingTask, {
  development_task_id: 'dev-content-fixture-unresolved',
  site_id: 'registry-only-site'
}));
assert(unresolved.GithubRepo === 'LynneLan3/registry-only-repo', 'known GithubRepo retained');
assert(unresolved.RepoPath === '', 'unresolved RepoPath remains empty');
assert(unresolved.HandoffStatus === 'REPO_PATH_UNRESOLVED', 'unresolved RepoPath is explicit');
context.getSiteRepositoryReferenceBySiteId_ = originalResolver;

// Status filtering, deterministic identity, and refresh order contract.
assert(context.implementationHandoffEligibleStatus_('READY_FOR_IMPLEMENTATION'), 'READY included');
assert(context.implementationHandoffEligibleStatus_('WAITING_SITE_CREATION'), 'SITE_BUILD included');
['DONE', 'SKIPPED', 'TODO', 'WATCH', 'RESEARCH'].forEach(function (status) {
  assert(!context.implementationHandoffEligibleStatus_(status), status + ' excluded');
});
var sameA = context.implementationHandoffReference_('dev-same-task');
var sameB = context.implementationHandoffReference_('dev-same-task');
assert(sameA === sameB, 'same TaskID keeps same HandoffReference');
assert(sameA === 'handoffs/dev-same-task.json', 'reference is deterministic and untimestamped');
assert(context.buildImplementationHandoff_(Object.assign({}, existingTask, {
  task_reason: 'changed current snapshot'
})).HandoffReference === existing.HandoffReference, 'changed task content refreshes same snapshot');

// Refresh writes the current two-column snapshot in place and clears excluded rows.
var refreshHeaders = context.DEVELOPMENT_TASK_HEADERS;
var refreshCol = context.headerIndexMap_(refreshHeaders);
function sheetRow(task) {
  var row = new Array(refreshHeaders.length).fill('');
  row[refreshCol['开发任务ID']] = task.development_task_id;
  row[refreshCol['来源任务ID']] = task.source_job_id || '';
  row[refreshCol['站点']] = task.site || '';
  row[refreshCol['游戏']] = task.game || '';
  row[refreshCol['页面路径']] = task.page_path || '';
  row[refreshCol['Evidence链接']] = task.evidence_link || '';
  row[refreshCol['任务状态']] = task.status || '';
  row[refreshCol['OpportunityID']] = task.opportunity_id || '';
  row[refreshCol['DecisionID']] = task.decision_id || '';
  row[refreshCol['SiteID']] = task.site_id || '';
  row[refreshCol['ActionType']] = task.action_type || '';
  row[refreshCol['TaskType']] = task.task_type || '';
  row[refreshCol['TaskReason']] = task.task_reason || '';
  row[refreshCol['SourceReference']] = task.source_reference || '';
  return row;
}
var writtenHandoffs = null;
var refreshSheet = {
  getLastRow: function () { return 3; },
  getLastColumn: function () { return refreshHeaders.length; },
  getRange: function (row, column, numRows, numColumns) {
    if (row === 1) return {getValues: function () { return [refreshHeaders]; }};
    if (row === 2 && column === 1) {
      return {getValues: function () {
        return [sheetRow(existingTask), sheetRow({
          development_task_id: 'dev-done-fixture', status: 'DONE', task_type: 'CONTENT_IMPLEMENTATION'
        })];
      }};
    }
    return {setValues: function (values) { writtenHandoffs = values; }};
  }
};
context.getSpreadsheet_ = function () {
  return {getSheetByName: function () { return refreshSheet; }};
};
var refreshSummary = context.refreshImplementationHandoffs_();
assert(/generated=1/.test(refreshSummary) && /excluded=1/.test(refreshSummary), 'refresh counts eligible/excluded tasks');
assert(writtenHandoffs[0][0] === 'READY' && writtenHandoffs[0][1] === existing.HandoffReference, 'refresh writes existing handoff');
assert(writtenHandoffs[1][0] === '' && writtenHandoffs[1][1] === '', 'refresh clears excluded handoff');
var firstWritten = JSON.stringify(writtenHandoffs);
context.refreshImplementationHandoffs_();
assert(JSON.stringify(writtenHandoffs) === firstWritten, 'rerun has no duplicate handoff output/history');

var finalizer = codeSrc.slice(codeSrc.indexOf('function runDailyFinalizerUnlocked_'));
assert(finalizer.indexOf('refreshUnifiedActionQueue_') < finalizer.indexOf('syncDevelopmentTasksFromApprovedDecisions'), 'queue before development tasks');
assert(finalizer.indexOf('syncDevelopmentTasksFromApprovedDecisions') < finalizer.indexOf('refreshImplementationHandoffs_'), 'development tasks before handoffs');
assert(!/clasp run|UrlFetchApp|DriveApp|SpreadsheetApp\.openById|Codex/i.test(handoffSrc), 'handoff helper has no external agent or publishing call');
assert(/HandoffStatus/.test(configSrc) && /HandoffReference/.test(configSrc), 'handoff columns declared');
assert(/function buildImplementationHandoff_/.test(handoffSrc), 'builder exists');
assert(/function refreshImplementationHandoffs_/.test(handoffSrc), 'refresh entry exists');
assert(/function getSiteRepositoryReferenceBySiteId_/.test(identitySrc), 'existing site registry adapter exists');

console.log('PASS scripts/test-implementation-handoffs.js (existing-site, SITE_BUILD, exclusions, registry resolution, unresolved RepoPath, identity/idempotency, refresh order)');
