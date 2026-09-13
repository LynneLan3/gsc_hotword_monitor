/** P1: online Implementation Handoff and machine-task routing checks. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var root = path.join(__dirname, '..');
var handoffSrc = fs.readFileSync(path.join(root, 'ImplementationHandoffs.gs'), 'utf8');
var researchSrc = fs.readFileSync(path.join(root, 'ResearchJobs.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');

function assert(value, message) {
  if (!value) throw new Error(message);
}

var headers = [
  '开发任务ID', '创建时间', '来源任务ID', '站点', '游戏', '页面路径',
  '开发目标', 'Evidence链接', '优先级', '任务状态', '完成时间', '备注',
  'OpportunityID', 'DecisionID', 'SiteID', 'ActionType', 'TaskType',
  'TaskReason', 'SourceReference', 'HandoffStatus', 'HandoffReference'
];
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
  DEVELOPMENT_TASK_HEADERS: headers,
  IMPLEMENTATION_HANDOFF_STATUS: {},
  Logger: {log: function () {}},
  writeLog_: function () {},
  ensureDevelopmentTaskSheets_: function () {},
  getSiteRepositoryReferenceBySiteId_: function (siteId) {
    return siteId === 'mortal-shell-ii'
      ? {repoPath: '/repo/mortal-shell-ii', githubRepo: 'LynneLan3/Mortal-Shell-II'}
      : {repoPath: '', githubRepo: ''};
  },
  headerIndexMap_: function (list) {
    var out = {};
    list.forEach(function (name, index) { out[name] = index; });
    return out;
  },
  cell_: function (row, col, name) {
    return col[name] === undefined ? '' : row[col[name]];
  },
  console: console
};
vm.createContext(context);
vm.runInContext(handoffSrc, context);

var existing = context.buildImplementationHandoff_({
  development_task_id: 'dev-content-001', source_job_id: 'research-001',
  game: 'Mortal Shell II', page_path: '/crashing-pc/', status: 'READY_FOR_IMPLEMENTATION',
  opportunity_id: 'opp-001', decision_id: 'decision-001', site_id: 'mortal-shell-ii',
  action_type: 'UPDATE_PAGE', task_type: 'CONTENT_IMPLEMENTATION',
  task_reason: 'approved update', source_reference: 'research-pack-001',
  evidence_link: 'result-001.json'
});
assert(existing.HandoffStatus === 'READY', 'existing site is READY');
assert(existing.RepoPath === '/repo/mortal-shell-ii', 'repo path resolved by SiteID');
assert(existing.GithubRepo === 'LynneLan3/Mortal-Shell-II', 'GitHub repo resolved by SiteID');
assert(existing.HandoffReference === 'handoffs/dev-content-001.json', 'stable reference');

var build = context.buildImplementationHandoff_({
  development_task_id: 'dev-build-001', status: 'WAITING_SITE_CREATION',
  opportunity_id: 'opp-build', action_type: 'BUILD', task_type: 'SITE_BUILD',
  game: 'Example Game', source_reference: 'jobs/example-game/research.json'
});
assert(build.HandoffStatus === 'SITE_CREATION_REQUIRED', 'site build remains gated');
assert(build.Starter === 'game-wiki-starter', 'site build starter preserved');
assert(build.RepoPath === '' && build.GithubRepo === '', 'site build does not guess repo');
assert(build.ResearchResultPath === 'jobs/example-game/research.json', 'BUILD ResearchResultPath preserved');

var unresolved = context.buildImplementationHandoff_({
  development_task_id: 'dev-unresolved-001', status: 'READY_FOR_IMPLEMENTATION',
  site_id: 'registry-only', task_type: 'CONTENT_IMPLEMENTATION', action_type: 'UPDATE_PAGE'
});
assert(unresolved.HandoffStatus === 'REPO_REFERENCE_UNRESOLVED', 'unresolved registry is explicit');

var col = context.headerIndexMap_(headers);
function row(task) {
  var out = new Array(headers.length).fill('');
  Object.keys(task).forEach(function (key) { out[col[key]] = task[key]; });
  return out;
}
var written;
var sheet = {
  getLastRow: function () { return 3; },
  getLastColumn: function () { return headers.length; },
  getRange: function (r, c, n, m) {
    if (r === 1) return {getValues: function () { return [headers]; }};
    if (r === 2 && c === 1) return {getValues: function () {
      return [
        row({开发任务ID: 'dev-content-001', 游戏: 'Mortal Shell II', 页面路径: '/crashing-pc/', 任务状态: 'READY_FOR_IMPLEMENTATION', SiteID: 'mortal-shell-ii', ActionType: 'UPDATE_PAGE', TaskType: 'CONTENT_IMPLEMENTATION'}),
        row({开发任务ID: 'dev-done-001', 任务状态: '已完成'})
      ];
    }};
    return {setValues: function (values) { written = values; }};
  }
};
context.getSpreadsheet_ = function () { return {getSheetByName: function () { return sheet; }}; };
var summary = context.refreshImplementationHandoffs_();
assert(/generated=1/.test(summary) && /excluded=1/.test(summary), 'refresh filters machine tasks');
assert(written[0][0] === 'READY' && written[0][1] === existing.HandoffReference, 'refresh writes snapshot');
assert(written[1][0] === '' && written[1][1] === '', 'refresh clears excluded task');

assert(/pendingImplementationHandoffs/.test(researchSrc), 'online pending handoff route exists');
assert(/implementationHandoff/.test(researchSrc), 'online single handoff route exists');
assert(!/TODAY_ACTIONS|今日行动/.test(handoffSrc), 'handoff path does not route through Today Action');
assert(/syncDevelopmentTasksFromApprovedDecisions\(\)[\s\S]*refreshImplementationHandoffs_\(\)/.test(codeSrc), 'finalizer routes development tasks before handoff');
assert(/HandoffStatus/.test(configSrc) && /HandoffReference/.test(configSrc), 'handoff columns are declared');

console.log('PASS scripts/test-implementation-handoffs.js (online routes, registry resolution, snapshot refresh, Today Action boundary)');
