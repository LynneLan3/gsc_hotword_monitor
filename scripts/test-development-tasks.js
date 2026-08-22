/**
 * Phase 7E local fixture test.  No SpreadsheetApp / production Sheet access.
 * Run: node scripts/test-development-tasks.js
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var RESEARCH_JOB_STATUS = {
  APPROVED: 'APPROVED', REVIEW: 'REVIEW', WATCH: 'WATCH', ARCHIVED: 'ARCHIVED'
};
var RESEARCH_JOB_STATUS_LABELS = {
  APPROVED: '已批准', REVIEW: '待审核', WATCH: '继续观察', ARCHIVED: '已归档'
};
var RESEARCH_REVIEW_DECISION = { APPROVE: 'APPROVE' };
var RESEARCH_REVIEW_DECISION_LABELS = {
  APPROVE: '批准开发', WATCH: '继续观察', NO_ACTION: '无需处理'
};
var RESEARCH_RESULT_RECOMMENDATIONS = {
  EXPAND_EXISTING: 'EXPAND_EXISTING', NEW_CONTENT: 'NEW_CONTENT', WATCH: 'WATCH'
};
var RESEARCH_RESULT_RECOMMENDATION_LABELS = {
  EXPAND_EXISTING: '扩充现有页面', NEW_CONTENT: '新内容', WATCH: '继续观察'
};
var RESEARCH_TYPE = {
  CONTENT_RESEARCH: 'CONTENT_RESEARCH', ASSET_RESEARCH: 'ASSET_RESEARCH',
  DEMAND_DISCOVERY: 'DEMAND_DISCOVERY', SEARCH_DEMAND: 'SEARCH_DEMAND'
};
var OPPORTUNITY_LEVELS = { HIGH: 'HIGH', MEDIUM: 'MEDIUM' };
var OPPORTUNITY_LEVEL_LABELS = { HIGH: '高', MEDIUM: '中', WATCH: '观察' };
var DEVELOPMENT_GOAL_LABELS = {
  EXPAND_EXISTING: '扩充现有页面', NEW_PAGE: '新建页面', UPDATE_EXISTING: '更新现有页面'
};
var DEVELOPMENT_PRIORITY_LABELS = { HIGH: '高', MEDIUM: '中', LOW: '低' };
var DEVELOPMENT_TASK_STATUS_LABELS = {
  TODO: '待开发', READY_FOR_IMPLEMENTATION: 'READY_FOR_IMPLEMENTATION',
  WAITING_SITE_CREATION: 'WAITING_SITE_CREATION'
};
var DEVELOPMENT_TASK_HEADERS = [
  '开发任务ID', '创建时间', '来源任务ID', '站点', '游戏', '页面路径',
  '开发目标', 'Evidence链接', '优先级', '任务状态', '完成时间', '备注',
  'OpportunityID', 'DecisionID', 'SiteID', 'ActionType', 'TaskType',
  'TaskReason', 'SourceReference', 'HandoffStatus', 'HandoffReference'
];
var RESEARCH_JOB_HEADERS = [
  '任务ID', '创建时间', '站点', '游戏', '搜索词 / topic', '页面路径',
  '机会等级', '建议动作', 'source_query', '任务状态', '关联搜索词',
  '研究结果', '证据数量', '结果路径', '完成时间', '错误信息', '审核摘要',
  '审核链接', '审核决定', '审核备注', '审核时间', '研究类型', '雷达ID',
  '触发类型', '锚点页面', '发现范围', '种子词', '来源族请求', '信号摘要',
  '发现周期日期', 'OpportunityID'
];

function enumFromLabel_(labelMap, value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  if (labelMap[raw]) return raw;
  var keys = Object.keys(labelMap);
  for (var i = 0; i < keys.length; i++) if (labelMap[keys[i]] === raw) return keys[i];
  return raw;
}
function headerIndexMap_(headers) {
  var out = {};
  for (var i = 0; i < headers.length; i++) out[String(headers[i] || '').trim()] = i;
  return out;
}
function cell_(row, col, name) {
  return col[name] === undefined ? '' : row[col[name]];
}

var context = {
  RESEARCH_JOB_STATUS: RESEARCH_JOB_STATUS,
  RESEARCH_JOB_STATUS_LABELS: RESEARCH_JOB_STATUS_LABELS,
  RESEARCH_REVIEW_DECISION: RESEARCH_REVIEW_DECISION,
  RESEARCH_REVIEW_DECISION_LABELS: RESEARCH_REVIEW_DECISION_LABELS,
  RESEARCH_RESULT_RECOMMENDATIONS: RESEARCH_RESULT_RECOMMENDATIONS,
  RESEARCH_RESULT_RECOMMENDATION_LABELS: RESEARCH_RESULT_RECOMMENDATION_LABELS,
  RESEARCH_TYPE: RESEARCH_TYPE,
  OPPORTUNITY_LEVELS: OPPORTUNITY_LEVELS,
  OPPORTUNITY_LEVEL_LABELS: OPPORTUNITY_LEVEL_LABELS,
  DEVELOPMENT_GOAL_LABELS: DEVELOPMENT_GOAL_LABELS,
  DEVELOPMENT_PRIORITY_LABELS: DEVELOPMENT_PRIORITY_LABELS,
  DEVELOPMENT_TASK_STATUS_LABELS: DEVELOPMENT_TASK_STATUS_LABELS,
  DEVELOPMENT_TASK_HEADERS: DEVELOPMENT_TASK_HEADERS,
  RESEARCH_JOB_HEADERS: RESEARCH_JOB_HEADERS,
  enumFromLabel_: enumFromLabel_,
  headerIndexMap_: headerIndexMap_,
  cell_: cell_
};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '..', 'DevelopmentTasks.gs'), 'utf8'),
  context
);

var fails = [];
function assert(cond, msg) { if (!cond) fails.push(msg); }
function row(overrides) {
  var col = headerIndexMap_(RESEARCH_JOB_HEADERS);
  var out = new Array(RESEARCH_JOB_HEADERS.length).fill('');
  out[col['任务ID']] = 'fixture-job-001';
  out[col['站点']] = 'Mortal Shell II';
  out[col['游戏']] = 'Mortal Shell II';
  out[col['页面路径']] = '/skip-prologue/';
  out[col['机会等级']] = '高';
  out[col['任务状态']] = '已批准';
  out[col['研究结果']] = '扩充现有页面';
  out[col['审核决定']] = '批准开发';
  out[col['OpportunityID']] = 'opp-fixture-001';
  Object.keys(overrides || {}).forEach(function (key) { out[col[key]] = overrides[key]; });
  return { values: out, col: col };
}
function build(r, refs) {
  return context.buildDevelopmentTaskFromResearchRow_(r.values, r.col, new Date('2026-08-22T00:00:00Z'), refs || {
    decisionId: 'decision-fixture-001', siteId: 'mortal-shell-ii'
  });
}

// approved CREATE/UPDATE → task created and bound
var create = row({ '研究结果': '新内容', '任务ID': 'fixture-create-001', 'OpportunityID': 'opp-create-001' });
var createTask = build(create);
assert(context.implementationActionFromResearchRow_(create.values, create.col) === 'CREATE_PAGE', 'approved CREATE action');
assert(createTask.action_type === 'CREATE_PAGE', 'CREATE task action');
assert(createTask.status === 'READY_FOR_IMPLEMENTATION', 'existing site READY');
assert(createTask.opportunity_id === 'opp-create-001', 'OpportunityID preserved');
assert(createTask.decision_id === 'decision-fixture-001', 'DecisionID preserved');
assert(createTask.site_id === 'mortal-shell-ii', 'SiteID preserved');

var update = row({ '任务ID': 'fixture-update-001', 'OpportunityID': 'opp-update-001' });
var updateTask = build(update);
assert(updateTask.action_type === 'UPDATE_PAGE', 'approved UPDATE action');
assert(updateTask.page_path === '/skip-prologue/', 'TargetPath reuses 页面路径');

// WATCH / REJECT / research-only → excluded
var watch = row({ '任务状态': '继续观察', '审核决定': '继续观察', '研究结果': '继续观察' });
assert(context.isResearchJobReadyForDevelopment_(watch.values[watch.col['任务状态']], watch.values[watch.col['审核决定']]) === false, 'WATCH excluded');
var reject = row({ '审核决定': '无需处理', '任务状态': '已归档' });
assert(context.isResearchJobReadyForDevelopment_(reject.values[reject.col['任务状态']], reject.values[reject.col['审核决定']]) === false, 'REJECT excluded');
var researchOnly = row({ '研究结果': '', '建议动作': '研究新内容', '研究类型': 'CONTENT_RESEARCH' });
assert(context.implementationActionFromResearchRow_(researchOnly.values, researchOnly.col) === '', 'research-only excluded');
var discoveryOnly = row({ '研究结果': '', '建议动作': '', '研究类型': 'DEMAND_DISCOVERY' });
assert(context.implementationActionFromResearchRow_(discoveryOnly.values, discoveryOnly.col) === '', 'discovery-only excluded');
var noAction = row({ '研究结果': '', '建议动作': '', '研究类型': 'CONTENT_RESEARCH' });
assert(context.implementationActionFromResearchRow_(noAction.values, noAction.col) === '', 'empty action excluded');

// exact four-part identity and rerun idempotency
var existing = { identity: {}, sourceIds: {} };
context.markDevelopmentTaskExisting_(existing, updateTask);
assert(context.developmentTaskAlreadyExists_(existing, updateTask) === true, 'same identity no duplicate');
var changedPath = build(row({ '页面路径': '/different-path/', 'OpportunityID': 'opp-update-001' }));
assert(context.developmentTaskAlreadyExists_(existing, changedPath) === false, 'changed TargetPath is new identity');
var changedDecision = build(row({ 'OpportunityID': 'opp-update-001' }), {
  decisionId: 'decision-fixture-002', siteId: 'mortal-shell-ii'
});
assert(context.developmentTaskAlreadyExists_(existing, changedDecision) === false, 'changed DecisionID is new identity');
assert(context.developmentTaskIdentityKey_('o', 'd', 'UPDATE_PAGE', '/a') !== context.developmentTaskIdentityKey_('o', 'd', 'UPDATE_PAGE', '/b'), 'identity includes TargetPath');

// resolved approval disappears on refresh
var resolved = row({ '任务状态': '继续观察', '审核决定': '继续观察' });
assert(context.isResearchJobReadyForDevelopment_(resolved.values[resolved.col['任务状态']], resolved.values[resolved.col['审核决定']]) === false, 'resolved action disappears');

// Steam BUILD boundary: no site_id, no repo operation
var steam = context.buildDevelopmentTaskFromSteamRow_({
  opportunityId: 'opp-steam-build-fixture', game: 'Steam Fixture', sourceReference: 'steam-fixture'
}, new Date('2026-08-22T00:00:00Z'));
assert(context.isApprovedSteamBuild_({ opportunityId: 'opp-steam-build-fixture', decision: 'BUILD' }) === true, 'Steam BUILD included');
assert(steam.opportunity_id === 'opp-steam-build-fixture', 'Steam OpportunityID preserved');
assert(steam.action_type === 'BUILD' && steam.task_type === 'SITE_BUILD', 'Steam SITE_BUILD type');
assert(steam.site_id === '', 'Steam site_id remains empty');
assert(steam.status === 'WAITING_SITE_CREATION', 'Steam waiting status');
assert(context.isApprovedSteamBuild_({ opportunityId: 'opp-steam-build-fixture', decision: 'REJECT' }) === false, 'Steam REJECT excluded');

assert(context.developmentTaskSheetRow_(createTask).length === DEVELOPMENT_TASK_HEADERS.length, 'row/header width');

if (fails.length) {
  console.error('FAIL (' + fails.length + '):\n' + fails.join('\n'));
  process.exit(1);
}
console.log('PASS scripts/test-development-tasks.js (approved create/update, WATCH/REJECT/research exclusion, bindings, four-part idempotency, Steam BUILD boundary, resolved disappearance)');
