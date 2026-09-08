/**
 * Local pure-logic checks for external Development Task registration.
 * Mirrors DevelopmentTasks.gs helpers; does not write production Sheets.
 * Run: node scripts/test-external-development-task-registration.js
 */

var DEVELOPMENT_GOAL_LABELS = {
  EXPAND_EXISTING: '扩充现有页面',
  NEW_PAGE: '新建页面',
  UPDATE_EXISTING: '更新现有页面'
};
var DEVELOPMENT_PRIORITY_LABELS = { HIGH: '高', MEDIUM: '中', LOW: '低' };
var DEVELOPMENT_TASK_STATUS_LABELS = {
  READY_FOR_IMPLEMENTATION: 'READY_FOR_IMPLEMENTATION',
  WAITING_SITE_CREATION: 'WAITING_SITE_CREATION'
};
var OPPORTUNITY_LEVELS = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', WATCH: 'WATCH' };
var OPPORTUNITY_LEVEL_LABELS = { HIGH: '高', MEDIUM: '中', WATCH: '观察' };

function enumFromLabel_(labelMap, value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  if (labelMap[raw]) return raw;
  var keys = Object.keys(labelMap);
  for (var i = 0; i < keys.length; i++) {
    if (labelMap[keys[i]] === raw) return keys[i];
  }
  return raw;
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

function normalizeExternalDevelopmentPagePath_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  if (raw === '/') return '/';
  if (raw.charAt(0) !== '/') raw = '/' + raw;
  if (raw.charAt(raw.length - 1) !== '/') raw += '/';
  return raw;
}

function externalOpportunityIdFromInput_(siteId, pagePath, actionType, sourceReference) {
  var pathToken = String(pagePath || '/').replace(/^\/+|\/+$/g, '') || 'root';
  pathToken = pathToken.replace(/[^A-Za-z0-9._-]+/g, '-');
  var packToken = String(sourceReference || '')
    .replace(/\.md$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ('opp-ext-' + [siteId, pathToken, actionType, packToken].join('-')).toLowerCase();
}

function developmentTaskIdentityKey_(opportunityId, decisionId, actionType, targetPath) {
  return [opportunityId, decisionId, actionType, targetPath].map(function (value) {
    return String(value || '').trim();
  }).join('\u001f');
}

function developmentTaskIdFromIdentity_(opportunityId, decisionId, actionType, targetPath) {
  var raw = developmentTaskIdentityKey_(opportunityId, decisionId, actionType, targetPath);
  return 'dev-' + encodeURIComponent(raw).replace(/%/g, '_');
}

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

function developmentGoalFromActionType_(actionType) {
  var action = String(actionType || '').trim().toUpperCase();
  if (action === 'CREATE_PAGE') return DEVELOPMENT_GOAL_LABELS.NEW_PAGE;
  if (action === 'BUILD') return '建站';
  if (action === 'CONTENT_OPTIMIZE') return DEVELOPMENT_GOAL_LABELS.EXPAND_EXISTING;
  return DEVELOPMENT_GOAL_LABELS.UPDATE_EXISTING;
}

function normalizeExternalDevelopmentTaskInput_(input) {
  var raw = input || {};
  var siteId = String(raw.siteId || '').trim();
  var site = String(raw.site || '').trim();
  var game = String(raw.game || '').trim();
  if (!site) site = game;
  if (!game) game = site;
  var pagePath = normalizeExternalDevelopmentPagePath_(raw.pagePath);
  var actionType = normalizeDevelopmentAction_(raw.actionType);
  var sourceReference = String(raw.sourceReference || '').trim();
  var opportunityId = String(raw.opportunityId || '').trim();
  var decisionId = String(raw.decisionId || '').trim();
  if (!opportunityId) {
    opportunityId = externalOpportunityIdFromInput_(siteId, pagePath, actionType, sourceReference);
  }
  if (!decisionId) decisionId = 'external-approval:' + sourceReference;
  return {
    siteId: siteId,
    site: site,
    game: game,
    pagePath: pagePath,
    actionType: actionType,
    taskType: String(raw.taskType || 'CONTENT_IMPLEMENTATION').trim(),
    taskReason: String(raw.taskReason || '').trim(),
    priority: String(raw.priority || '').trim(),
    sourceReference: sourceReference,
    evidenceReference: String(raw.evidenceReference || sourceReference).trim(),
    opportunityId: opportunityId,
    decisionId: decisionId
  };
}

function buildDevelopmentTaskFromExternalInput_(input) {
  var developmentTaskId = developmentTaskIdFromIdentity_(
    input.opportunityId, input.decisionId, input.actionType, input.pagePath
  );
  return {
    development_task_id: developmentTaskId,
    opportunity_id: input.opportunityId,
    decision_id: input.decisionId,
    site_id: input.siteId,
    action_type: input.actionType,
    page_path: input.pagePath,
    priority: developmentPriorityFromLevel_(input.priority),
    goal: developmentGoalFromActionType_(input.actionType),
    task_type: input.taskType,
    task_reason: input.taskReason,
    source_reference: input.sourceReference,
    handoff_status: DEVELOPMENT_TASK_STATUS_LABELS.READY_FOR_IMPLEMENTATION,
    handoff_reference: 'handoff:' + developmentTaskId
  };
}

function developmentTaskAlreadyExists_(existing, task) {
  var key = developmentTaskIdentityKey_(
    task.opportunity_id, task.decision_id, task.action_type, task.page_path
  );
  return !!(task.opportunity_id && task.action_type && existing.identity[key]);
}

var fails = [];
function assert(cond, msg) {
  if (!cond) fails.push(msg);
}

var input = normalizeExternalDevelopmentTaskInput_({
  siteId: 'withering-realms',
  site: 'Withering Realms Guide',
  game: 'Withering Realms Guide',
  pagePath: 'category',
  actionType: 'UPDATE_PAGE',
  taskType: 'CONTENT_IMPLEMENTATION',
  taskReason: 'Launch Intent Hub upgrade from verified launch research',
  priority: 'high',
  sourceReference: 'withering_realms_research_pack_2026-09-08.md',
  evidenceReference: 'withering_realms_research_pack_2026-09-08.md'
});

assert(input.pagePath === '/category/', 'page path normalized');
assert(input.actionType === 'UPDATE_PAGE', 'action normalized');
assert(input.opportunityId.indexOf('opp-ext-withering-realms-category-update_page-') === 0, 'opportunity id');
assert(input.decisionId === 'external-approval:withering_realms_research_pack_2026-09-08.md', 'decision id');

var task = buildDevelopmentTaskFromExternalInput_(input);
assert(task.priority === '高', 'priority high');
assert(task.goal === '更新现有页面', 'goal from UPDATE_PAGE');
assert(task.handoff_reference === 'handoff:' + task.development_task_id, 'handoff ref');

var existing = { identity: {}, sourceIds: {} };
existing.identity[developmentTaskIdentityKey_(
  task.opportunity_id, task.decision_id, task.action_type, task.page_path
)] = true;
assert(developmentTaskAlreadyExists_(existing, task) === true, 'idempotent identity hit');

var second = buildDevelopmentTaskFromExternalInput_(
  normalizeExternalDevelopmentTaskInput_({
    siteId: 'withering-realms',
    site: 'Withering Realms Guide',
    pagePath: '/category/',
    actionType: 'UPDATE_PAGE',
    taskType: 'CONTENT_IMPLEMENTATION',
    taskReason: 'Launch Intent Hub upgrade from verified launch research',
    priority: 'high',
    sourceReference: 'withering_realms_research_pack_2026-09-08.md'
  })
);
assert(second.development_task_id === task.development_task_id, 'same inputs → same DevelopmentTaskID');

if (fails.length) {
  console.error('FAIL ' + fails.join('; '));
  process.exit(1);
}
console.log('PASS external development task registration logic');
