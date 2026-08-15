/**
 * M3 本地 mock 自测：不写生产 Sheet、不改 MS2/AU。
 * 逻辑与 DevelopmentTasks.gs 纯函数对齐。
 * 运行：node scripts/test-development-tasks.js
 */

var RESEARCH_JOB_STATUS = {
  APPROVED: 'APPROVED',
  REVIEW: 'REVIEW',
  WATCH: 'WATCH',
  ARCHIVED: 'ARCHIVED'
};
var RESEARCH_JOB_STATUS_LABELS = {
  APPROVED: '已批准',
  REVIEW: '待审核',
  WATCH: '继续观察',
  ARCHIVED: '已归档'
};
var RESEARCH_REVIEW_DECISION = { APPROVE: 'APPROVE' };
var RESEARCH_REVIEW_DECISION_LABELS = {
  APPROVE: '批准开发',
  WATCH: '继续观察',
  NO_ACTION: '无需处理'
};
var RESEARCH_RESULT_RECOMMENDATIONS = {
  EXPAND_EXISTING: 'EXPAND_EXISTING',
  NEW_CONTENT: 'NEW_CONTENT'
};
var RESEARCH_RESULT_RECOMMENDATION_LABELS = {
  EXPAND_EXISTING: '扩充现有页面',
  NEW_CONTENT: '新内容',
  WATCH: '继续观察'
};
var OPPORTUNITY_LEVELS = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', WATCH: 'WATCH' };
var OPPORTUNITY_LEVEL_LABELS = { HIGH: '高', MEDIUM: '中', WATCH: '观察' };
var DEVELOPMENT_GOAL_LABELS = {
  EXPAND_EXISTING: '扩充现有页面',
  NEW_PAGE: '新建页面',
  UPDATE_EXISTING: '更新现有页面'
};
var DEVELOPMENT_PRIORITY_LABELS = { HIGH: '高', MEDIUM: '中', LOW: '低' };
var DEVELOPMENT_TASK_STATUS_LABELS = { TODO: '待开发' };

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

function isResearchJobReadyForDevelopment_(status, decision) {
  var statusRaw = String(status || '').trim();
  var decisionRaw = String(decision || '').trim();
  if (!statusRaw || !decisionRaw) return false;

  var statusEnum = statusRaw;
  if (statusRaw === RESEARCH_JOB_STATUS_LABELS.APPROVED) {
    statusEnum = RESEARCH_JOB_STATUS.APPROVED;
  } else if (statusRaw !== RESEARCH_JOB_STATUS.APPROVED) {
    statusEnum = enumFromLabel_(RESEARCH_JOB_STATUS_LABELS, statusRaw);
  }

  var decisionEnum = decisionRaw;
  if (decisionRaw === RESEARCH_REVIEW_DECISION_LABELS.APPROVE) {
    decisionEnum = RESEARCH_REVIEW_DECISION.APPROVE;
  } else if (decisionRaw !== RESEARCH_REVIEW_DECISION.APPROVE) {
    decisionEnum = enumFromLabel_(RESEARCH_REVIEW_DECISION_LABELS, decisionRaw);
  }

  return (
    statusEnum === RESEARCH_JOB_STATUS.APPROVED &&
    decisionEnum === RESEARCH_REVIEW_DECISION.APPROVE
  );
}

function developmentGoalFromResearchResult_(resultLabel) {
  var raw = String(resultLabel || '').trim();
  if (!raw) return DEVELOPMENT_GOAL_LABELS.UPDATE_EXISTING;
  var recEnum = enumFromLabel_(RESEARCH_RESULT_RECOMMENDATION_LABELS, raw);
  if (recEnum === RESEARCH_RESULT_RECOMMENDATIONS.EXPAND_EXISTING) {
    return DEVELOPMENT_GOAL_LABELS.EXPAND_EXISTING;
  }
  if (recEnum === RESEARCH_RESULT_RECOMMENDATIONS.NEW_CONTENT) {
    return DEVELOPMENT_GOAL_LABELS.NEW_PAGE;
  }
  if (raw === DEVELOPMENT_GOAL_LABELS.UPDATE_EXISTING || raw.indexOf('更新') >= 0) {
    return DEVELOPMENT_GOAL_LABELS.UPDATE_EXISTING;
  }
  return DEVELOPMENT_GOAL_LABELS.UPDATE_EXISTING;
}

function developmentPriorityFromLevel_(levelLabel) {
  var raw = String(levelLabel || '').trim();
  var levelEnum = enumFromLabel_(OPPORTUNITY_LEVEL_LABELS, raw);
  if (levelEnum === OPPORTUNITY_LEVELS.HIGH || raw === '高') {
    return DEVELOPMENT_PRIORITY_LABELS.HIGH;
  }
  if (levelEnum === OPPORTUNITY_LEVELS.MEDIUM || raw === '中') {
    return DEVELOPMENT_PRIORITY_LABELS.MEDIUM;
  }
  return DEVELOPMENT_PRIORITY_LABELS.LOW;
}

function developmentTaskIdFromSource_(sourceJobId) {
  return 'dev-' + String(sourceJobId || '').trim();
}

function simulateCreate(candidates, existingInit) {
  var existing = Object.assign({}, existingInit || {});
  var created = 0;
  var skippedExisting = 0;
  var built = [];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (!isResearchJobReadyForDevelopment_(c.status, c.decision)) continue;
    if (existing[c.id]) {
      skippedExisting++;
      continue;
    }
    built.push({
      development_task_id: developmentTaskIdFromSource_(c.id),
      source_job_id: c.id,
      goal: developmentGoalFromResearchResult_(c.result),
      priority: developmentPriorityFromLevel_(c.level),
      status: DEVELOPMENT_TASK_STATUS_LABELS.TODO
    });
    existing[c.id] = true;
    created++;
  }
  return { created: created, skippedExisting: skippedExisting, built: built, existing: existing };
}

var fails = [];
function assert(cond, msg) {
  if (!cond) fails.push(msg);
}

assert(isResearchJobReadyForDevelopment_('已批准', '批准开发') === true, 'A ready');
assert(isResearchJobReadyForDevelopment_('已归档', '无需处理') === false, 'C archived');
assert(isResearchJobReadyForDevelopment_('继续观察', '') === false, 'D watch');
assert(isResearchJobReadyForDevelopment_('待审核', '') === false, 'E review');
assert(isResearchJobReadyForDevelopment_('待审核', '批准开发') === false, 'E review+approve');

var candidates = [
  {
    id: 'mock-approved-expand-20260815',
    status: '已批准',
    decision: '批准开发',
    result: '扩充现有页面',
    level: '高'
  },
  {
    id: 'mock-archived-20260815',
    status: '已归档',
    decision: '无需处理',
    result: '扩充现有页面',
    level: '高'
  },
  {
    id: 'mock-watch-20260815',
    status: '继续观察',
    decision: '',
    result: '继续观察',
    level: '中'
  },
  {
    id: 'mock-review-20260815',
    status: '待审核',
    decision: '',
    result: '扩充现有页面',
    level: '高'
  }
];

var run1 = simulateCreate(candidates, {});
assert(run1.created === 1, 'A created=1');
assert(run1.skippedExisting === 0, 'A skipped=0');
assert(run1.built[0].development_task_id === 'dev-mock-approved-expand-20260815', 'dev- id');
assert(run1.built[0].status === '待开发', '初始待开发');
assert(run1.built[0].goal === '扩充现有页面', 'goal');
assert(run1.built[0].priority === '高', 'priority');

var run2 = simulateCreate(candidates, run1.existing);
assert(run2.created === 0 && run2.skippedExisting === 1, 'B no duplicate');

assert(developmentGoalFromResearchResult_('新内容') === '新建页面', '新建页面');
assert(developmentPriorityFromLevel_('观察') === '低', '观察→低');

if (fails.length) {
  console.error('FAIL (' + fails.length + '):\n' + fails.join('\n'));
  process.exit(1);
}
console.log('PASS: Development Tasks mock self-check');
console.log(
  'A created=1; B skippedExisting=1; C/D/E not created; initial status=待开发'
);
