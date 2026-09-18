/** P1: online Implementation Handoff and machine-task routing checks. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var root = path.join(__dirname, '..');
var developmentTasksSrc = fs.readFileSync(path.join(root, 'DevelopmentTasks.gs'), 'utf8');
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
  'TaskReason', 'SourceReference', 'HandoffStatus', 'HandoffReference',
  'ResearchBatchID', 'SchedulerRunID', 'SchedulerRunURL'
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
  developmentTaskIdFromIdentity_: function (opportunityId, decisionId, actionType, pagePath) {
    return [opportunityId, decisionId, actionType, pagePath].join('|');
  },
  SHEET_NAMES: {DEVELOPMENT_TASKS: '开发任务'},
  DEVELOPMENT_TASK_HEADERS: headers,
  IMPLEMENTATION_HANDOFF_STATUS: {},
  DEVELOPMENT_GOAL_LABELS: {
    EXPAND_EXISTING: '扩充现有页面',
    NEW_PAGE: '新建页面',
    UPDATE_EXISTING: '更新现有页面'
  },
  DEVELOPMENT_PRIORITY_LABELS: { HIGH: '高', MEDIUM: '中', LOW: '低' },
  RESEARCH_RESULT_RECOMMENDATIONS: {
    EXPAND_EXISTING: 'EXPAND_EXISTING',
    NEW_CONTENT: 'NEW_CONTENT',
    WATCH: 'WATCH'
  },
  RESEARCH_RESULT_RECOMMENDATION_LABELS: {
    EXPAND_EXISTING: '扩充现有页面',
    NEW_CONTENT: '新内容',
    WATCH: '继续观察'
  },
  OPPORTUNITY_LEVELS: { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' },
  OPPORTUNITY_LEVEL_LABELS: { HIGH: '高', MEDIUM: '中', LOW: '低' },
  enumFromLabel_: function (labels, value) {
    var raw = String(value || '').trim();
    if (labels[raw]) return raw;
    var keys = Object.keys(labels);
    for (var i = 0; i < keys.length; i++) if (labels[keys[i]] === raw) return keys[i];
    return raw;
  },
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
vm.runInContext(developmentTasksSrc, context);
context.ensureDevelopmentTaskSheets_ = function () {};
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

var steamTask = context.buildDevelopmentTaskFromSteamRow_({
  opportunityId: 'opp-steam-build-001', game: 'Example Game', decision: 'BUILD',
  autoResearchResultPath: 'jobs/steam-build/research.json'
});
var chainedBuild = context.buildImplementationHandoff_(steamTask);
assert(chainedBuild.ResearchResultPath === 'jobs/steam-build/research.json', 'candidate transport reaches handoff');

var unresolved = context.buildImplementationHandoff_({
  development_task_id: 'dev-unresolved-001', status: 'READY_FOR_IMPLEMENTATION',
  site_id: 'registry-only', task_type: 'CONTENT_IMPLEMENTATION', action_type: 'UPDATE_PAGE'
});
assert(unresolved.HandoffStatus === 'READY', 'registry-only site is READY when SiteID present');
assert(unresolved.RepoPath === '' && unresolved.GithubRepo === '', 'registry-only repo fields empty when not in static map');

var witheringRealms = context.buildImplementationHandoff_({
  development_task_id: 'dev-withering-001', source_job_id: 'research-wr-001',
  game: 'Withering Realms', page_path: '/best-builds/', status: 'READY_FOR_IMPLEMENTATION',
  opportunity_id: 'opp-wr-001', decision_id: 'decision-wr-001', site_id: 'withering-realms',
  action_type: 'CREATE_PAGE', task_type: 'CONTENT_IMPLEMENTATION',
  task_reason: 'new content', source_reference: 'research-pack-wr-001',
  evidence_link: 'result-wr-001.json'
});
assert(witheringRealms.HandoffStatus === 'READY', 'withering-realms is READY without static repo map entry');
assert(witheringRealms.SiteID === 'withering-realms', 'withering-realms SiteID preserved');
assert(witheringRealms.RepoPath === '', 'withering-realms RepoPath empty (not in static map)');
assert(witheringRealms.GithubRepo === '', 'withering-realms GithubRepo empty (not in static map)');
assert(witheringRealms.HandoffReference === 'handoffs/dev-withering-001.json', 'withering-realms stable reference');

var noSiteId = context.buildImplementationHandoff_({
  development_task_id: 'dev-nosite-001', status: 'READY_FOR_IMPLEMENTATION',
  task_type: 'CONTENT_IMPLEMENTATION', action_type: 'UPDATE_PAGE'
});
assert(noSiteId.HandoffStatus === 'SITE_ID_UNRESOLVED', 'missing SiteID still blocks');

// Full G039 transport: Research Job row (callback fields) → approved Dev Task → Handoff
var researchHeadersMatch = configSrc.match(/var RESEARCH_JOB_HEADERS\s*=\s*\[([\s\S]*?)\];/);
assert(researchHeadersMatch, 'RESEARCH_JOB_HEADERS extractable');
vm.runInContext(researchHeadersMatch[0], context);
var researchHeaders = context.RESEARCH_JOB_HEADERS;
assert(researchHeaders.indexOf('ResearchBatchID') === researchHeaders.length - 3, 'ResearchBatchID append-only tail');
assert(researchHeaders.indexOf('SchedulerRunID') === researchHeaders.length - 2, 'SchedulerRunID append-only tail');
assert(researchHeaders.indexOf('SchedulerRunURL') === researchHeaders.length - 1, 'SchedulerRunURL append-only tail');
assert(headers.indexOf('ResearchBatchID') === headers.length - 3, 'DevTask ResearchBatchID append-only');
assert(headers.indexOf('SchedulerRunID') === headers.length - 2, 'DevTask SchedulerRunID append-only');
assert(headers.indexOf('SchedulerRunURL') === headers.length - 1, 'DevTask SchedulerRunURL append-only');

var researchCol = context.headerIndexMap_(researchHeaders);
var researchRow = new Array(researchHeaders.length).fill('');
researchRow[researchCol['任务ID']] = 'research-batch-transport-001';
researchRow[researchCol['站点']] = 'Withering Realms';
researchRow[researchCol['游戏']] = 'Withering Realms';
researchRow[researchCol['页面路径']] = '/best-builds/';
researchRow[researchCol['机会等级']] = '高';
researchRow[researchCol['任务状态']] = '已批准';
researchRow[researchCol['研究结果']] = '新内容';
researchRow[researchCol['审核决定']] = '批准开发';
researchRow[researchCol['OpportunityID']] = 'opp-batch-transport-001';
researchRow[researchCol['ResearchBatchID']] = 'batch-abc-123';
researchRow[researchCol['SchedulerRunID']] = 'run-xyz-789';
researchRow[researchCol['SchedulerRunURL']] = 'https://engine.example/runs/run-xyz-789';
var approvedTask = context.buildDevelopmentTaskFromResearchRow_(researchRow, researchCol, new Date('2026-09-18T00:00:00Z'), {
  decisionId: 'decision-batch-transport-001',
  siteId: 'withering-realms',
  actionType: 'CREATE_PAGE'
});
assert(approvedTask.research_batch_id === 'batch-abc-123', 'approved task keeps ResearchBatchID');
assert(approvedTask.scheduler_run_id === 'run-xyz-789', 'approved task keeps SchedulerRunID');
assert(approvedTask.scheduler_run_url === 'https://engine.example/runs/run-xyz-789', 'approved task keeps SchedulerRunURL');
var batchProvenance = context.buildImplementationHandoff_(approvedTask);
assert(batchProvenance.HandoffStatus === 'READY', 'batch-provenance task is READY');
assert(batchProvenance.BatchID === 'batch-abc-123', 'BatchID preserved from research');
assert(batchProvenance.SchedulerRunID === 'run-xyz-789', 'SchedulerRunID preserved from research');
assert(batchProvenance.SchedulerRunURL === 'https://engine.example/runs/run-xyz-789', 'SchedulerRunURL preserved');

// Legacy withering fixture: READY but no batch provenance (not a cloud E2E fixture)
assert(witheringRealms.BatchID === '', 'legacy withering has no BatchID');
assert(witheringRealms.SchedulerRunID === '', 'legacy withering has no SchedulerRunID');

// External/manual path must not invent BatchID
var externalNoBatch = context.buildImplementationHandoff_({
  development_task_id: 'dev-external-001', status: 'READY_FOR_IMPLEMENTATION',
  site_id: 'withering-realms', task_type: 'CONTENT_IMPLEMENTATION', action_type: 'UPDATE_PAGE'
});
assert(externalNoBatch.HandoffStatus === 'READY', 'external without batch is READY');
assert(externalNoBatch.BatchID === '', 'external without batch has empty BatchID');
assert(externalNoBatch.SchedulerRunID === '', 'external without batch has empty SchedulerRunID');

// Legacy existing site without batch stays empty; with explicit batch passes through
assert(existing.BatchID === '', 'existing fixture has no BatchID');
var existingWithBatch = context.buildImplementationHandoff_({
  development_task_id: 'dev-content-batch', source_job_id: 'research-001',
  game: 'Mortal Shell II', page_path: '/crashing-pc/', status: 'READY_FOR_IMPLEMENTATION',
  opportunity_id: 'opp-001', decision_id: 'decision-001', site_id: 'mortal-shell-ii',
  action_type: 'UPDATE_PAGE', task_type: 'CONTENT_IMPLEMENTATION',
  task_reason: 'approved update', source_reference: 'research-pack-001',
  evidence_link: 'result-001.json',
  research_batch_id: 'batch-ms2-001', scheduler_run_id: 'run-ms2-001'
});
assert(existingWithBatch.BatchID === 'batch-ms2-001', 'existing site with batch has BatchID');
assert(existingWithBatch.SchedulerRunID === 'run-ms2-001', 'existing site with batch has SchedulerRunID');
assert(existingWithBatch.HandoffStatus === 'READY', 'existing site with batch is READY');

// SITE_BUILD: batch provenance passes through but status unchanged
var buildWithBatch = context.buildImplementationHandoff_({
  development_task_id: 'dev-build-batch', status: 'WAITING_SITE_CREATION',
  opportunity_id: 'opp-build-batch', action_type: 'BUILD', task_type: 'SITE_BUILD',
  game: 'Example Game', source_reference: 'jobs/example-game/research.json',
  research_batch_id: 'batch-build-001', scheduler_run_id: 'run-build-001'
});
assert(buildWithBatch.HandoffStatus === 'SITE_CREATION_REQUIRED', 'site build with batch still gated');
assert(buildWithBatch.BatchID === 'batch-build-001', 'site build preserves BatchID');

var col = context.headerIndexMap_(headers);
function row(task) {
  var out = new Array(headers.length).fill('');
  Object.keys(task).forEach(function (key) { out[col[key]] = task[key]; });
  return out;
}
var written;
var sheet = {
  getLastRow: function () { return 4; },
  getLastColumn: function () { return headers.length; },
  getRange: function (r, c, n, m) {
    if (r === 1) return {getValues: function () { return [headers]; }};
    if (r === 2 && c === 1) return {getValues: function () {
      return [
        row({开发任务ID: 'dev-content-001', 游戏: 'Mortal Shell II', 页面路径: '/crashing-pc/', 任务状态: 'READY_FOR_IMPLEMENTATION', SiteID: 'mortal-shell-ii', ActionType: 'UPDATE_PAGE', TaskType: 'CONTENT_IMPLEMENTATION'}),
        row({开发任务ID: 'dev-withering-001', 游戏: 'Withering Realms', 页面路径: '/best-builds/', 任务状态: 'READY_FOR_IMPLEMENTATION', SiteID: 'withering-realms', ActionType: 'CREATE_PAGE', TaskType: 'CONTENT_IMPLEMENTATION'}),
        row({开发任务ID: 'dev-done-001', 任务状态: '已完成'})
      ];
    }};
    return {setValues: function (values) { written = values; }};
  }
};
context.getSpreadsheet_ = function () { return {getSheetByName: function () { return sheet; }}; };
var summary = context.refreshImplementationHandoffs_();
assert(/generated=2/.test(summary) && /excluded=1/.test(summary), 'refresh includes registry-resolved tasks');
assert(written[0][0] === 'READY' && written[0][1] === existing.HandoffReference, 'refresh writes mortal-shell-ii snapshot');
assert(written[1][0] === 'READY' && written[1][1] === 'handoffs/dev-withering-001.json', 'refresh writes withering-realms READY even without static map');
assert(written[2][0] === '' && written[2][1] === '', 'refresh clears excluded task');

assert(/pendingImplementationHandoffs/.test(researchSrc), 'online pending handoff route exists');
assert(/implementationHandoff/.test(researchSrc), 'online single handoff route exists');
assert(!/TODAY_ACTIONS|今日行动/.test(handoffSrc), 'handoff path does not route through Today Action');
assert(/syncDevelopmentTasksFromApprovedDecisions\(\)[\s\S]*refreshImplementationHandoffs_\(\)/.test(codeSrc), 'finalizer routes development tasks before handoff');
assert(/HandoffStatus/.test(configSrc) && /HandoffReference/.test(configSrc), 'handoff columns are declared');

console.log('PASS scripts/test-implementation-handoffs.js (online routes, registry resolution, snapshot refresh, Today Action boundary)');
