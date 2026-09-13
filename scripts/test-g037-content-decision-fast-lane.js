/** G037 P3 self-check: action callback -> ContentDecision -> DevelopmentTask. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

var headers = [
  '任务ID', '创建时间', '站点', '游戏', '搜索词 / topic', '页面路径',
  '机会等级', '建议动作', 'source_query', '任务状态', '关联搜索词',
  '研究结果', '证据数量', '结果路径', '完成时间', '错误信息',
  '审核摘要', '审核链接', '审核决定', '审核备注', '审核时间', '研究类型',
  '雷达ID', '触发类型', '锚点页面', '发现范围', '种子词', '来源族请求', '信号摘要',
  '发现周期日期', 'OpportunityID', 'Search任务ID', 'Social任务ID', 'Search结果路径',
  'Social结果路径', 'SourceAction', 'ActionContext', 'DecisionID', 'PrimaryDecision',
  'SecondaryActions', 'DecisionReason', 'EvidenceSummary', 'TargetQueries',
  'RecommendedSections', 'RecommendedTitleChange', 'RecommendedInternalLinks',
  'Confidence', 'DecisionCreatedAt'
];

function row(overrides) {
  var values = new Array(headers.length).fill('');
  Object.keys(overrides).forEach(function (name) {
    values[headers.indexOf(name)] = overrides[name];
  });
  return values;
}

function FakeSheet(sheetHeaders, rows) {
  this.headers = sheetHeaders;
  this.rows = rows || [];
}
FakeSheet.prototype.getLastRow = function () { return this.rows.length + 1; };
FakeSheet.prototype.getLastColumn = function () { return this.headers.length; };
FakeSheet.prototype.getRange = function (rowNumber, columnNumber, rowCount, columnCount) {
  var sheet = this;
  return {
    getValues: function () {
      if (rowNumber === 1) return [sheet.headers.slice()];
      if (columnCount === 1 && rowNumber === 2 && columnNumber > 1) {
        return sheet.rows.map(function (row) { return [row[columnNumber - 1]]; });
      }
      return sheet.rows.slice(rowNumber - 2, rowNumber - 2 + (rowCount || 1)).map(function (row) {
        return row.slice(columnNumber - 1, columnNumber - 1 + (columnCount || sheet.headers.length));
      });
    },
    setValue: function (value) {
      sheet.rows[rowNumber - 2][columnNumber - 1] = value;
    },
    setValues: function (values) {
      for (var r = 0; r < values.length; r++) {
        sheet.rows[rowNumber - 2 + r] = values[r].slice();
      }
    }
  };
};

var researchSheet = new FakeSheet(headers, [row({
  '任务ID': 'g037-page-opt-001',
  '创建时间': '2026-09-13T00:00:00+08:00',
  '站点': 'Mortal Shell II',
  '游戏': 'Mortal Shell II',
  '搜索词 / topic': 'gloombound flame',
  '页面路径': '/mortal-shell-ii/gloombound-flame/',
  '机会等级': '高',
  '研究类型': 'PAGE_OPTIMIZATION_RESEARCH',
  '任务状态': '待处理',
  'SourceAction': 'OPTIMIZE_EXISTING',
  'ActionContext': JSON.stringify({ pagePath: '/mortal-shell-ii/gloombound-flame/' })
})]);
var developmentSheet = new FakeSheet([
  '开发任务ID', '创建时间', '来源任务ID', '站点', '游戏', '页面路径', '开发目标',
  'Evidence链接', '优先级', '任务状态', '完成时间', '备注', 'OpportunityID', 'DecisionID',
  'SiteID', 'ActionType', 'TaskType', 'TaskReason', 'SourceReference', 'HandoffStatus',
  'HandoffReference'
], []);
var spreadsheet = {
  getSheetByName: function (name) {
    if (name === '研究任务') return researchSheet;
    if (name === '开发任务') return developmentSheet;
    return null;
  }
};

var context = {
  RESEARCH_JOB_HEADERS: headers,
  RESEARCH_TYPE: {
    NEW_INTENT_RESEARCH: 'NEW_INTENT_RESEARCH',
    PAGE_OPTIMIZATION_RESEARCH: 'PAGE_OPTIMIZATION_RESEARCH'
  },
  RESEARCH_JOB_STATUS: { REVIEW: 'REVIEW', WATCH: 'WATCH', FAILED: 'FAILED' },
  RESEARCH_JOB_STATUS_LABELS: { REVIEW: '待审核', WATCH: '继续观察', FAILED: '失败' },
  RESEARCH_RESULT_RECOMMENDATION_LABELS: {
    EXPAND_EXISTING: '扩充现有页面', NEW_CONTENT: '新内容', WATCH: '继续观察'
  },
  RESEARCH_RESULT_RECOMMENDATIONS: {
    EXPAND_EXISTING: 'EXPAND_EXISTING', NEW_CONTENT: 'NEW_CONTENT', WATCH: 'WATCH'
  },
  RESEARCH_EVIDENCE_SOURCE_LABELS: {},
  RESEARCH_REVIEW_HEADERS: [],
  RESEARCH_REVIEW_DECISION: {},
  SHEET_NAMES: { RESEARCH_JOBS: '研究任务', DEVELOPMENT_TASKS: '开发任务' },
  CONTENT_DECISION_PRIMARY_ACTIONS: {
    CREATE_NEW_PAGE: 'CREATE_NEW_PAGE', EXPAND_EXISTING: 'EXPAND_EXISTING',
    REWRITE_SECTION: 'REWRITE_SECTION', ADD_FAQ: 'ADD_FAQ', ADD_ENTITY_SECTION: 'ADD_ENTITY_SECTION',
    ADD_COMPARISON: 'ADD_COMPARISON', ADD_STEPS: 'ADD_STEPS', REFOCUS_SECONDARY: 'REFOCUS_SECONDARY',
    FIX_INTERNAL_LINKING: 'FIX_INTERNAL_LINKING'
  },
  DEVELOPMENT_TASK_HEADERS: developmentSheet.headers,
  DEVELOPMENT_TASK_STATUS_LABELS: {
    TODO: '待开发', READY_FOR_IMPLEMENTATION: 'READY_FOR_IMPLEMENTATION',
    WAITING_SITE_CREATION: 'WAITING_SITE_CREATION'
  },
  DEVELOPMENT_GOAL_LABELS: { NEW_PAGE: '新建页面', EXPAND_EXISTING: '扩充现有页面' },
  OPPORTUNITY_LEVEL_LABELS: { HIGH: '高', MEDIUM: '中', LOW: '低' },
  OPPORTUNITY_LEVELS: { HIGH: 'HIGH', MEDIUM: 'MEDIUM' },
  DEVELOPMENT_PRIORITY_LABELS: { HIGH: '高', MEDIUM: '中', LOW: '低' },
  SpreadsheetApp: {
    getActiveSpreadsheet: function () { return spreadsheet; },
    flush: function () {}
  },
  getSpreadsheet_: function () { return spreadsheet; },
  Logger: { log: function () {} },
  Utilities: {
    getUuid: function () { return 'test-uuid'; },
    formatDate: function (date) { return new Date(date).toISOString().replace('Z', ''); }
  },
  Session: { getScriptTimeZone: function () { return 'Asia/Shanghai'; } }
};
context.opportunityLabel_ = function (labels, value) { return labels[value] || value; };
context.headerIndexMap_ = function (header) {
  var out = {};
  header.forEach(function (name, index) { out[name] = index; });
  return out;
};
context.cell_ = function (rowValues, col, name) {
  return col[name] === undefined ? '' : rowValues[col[name]];
};
context.enumFromLabel_ = function (labels, value) {
  var raw = String(value || '').trim();
  if (labels[raw]) return raw;
  var keys = Object.keys(labels);
  for (var i = 0; i < keys.length; i++) if (labels[keys[i]] === raw) return keys[i];
  return raw;
};
context.toIso8601_ = function (date) { return new Date(date).toISOString(); };

vm.createContext(context);
var root = path.join(__dirname, '..');
vm.runInContext(fs.readFileSync(path.join(root, 'DevelopmentTasks.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'ResearchJobs.gs'), 'utf8'), context);

context.ensureDevelopmentTaskSheets_ = function () {};
context.ensureResearchJobResultColumns_ = function () {};
context.writeResearchReviewEvidence_ = function () {
  return { rows: 5, link: 'review-link' };
};
context.loadDevelopmentSiteReferences_ = function () {
  return { 'Mortal Shell II': 'site-ms2' };
};

var result = context.writeResearchJobResult_({
  job_id: 'g037-page-opt-001',
  research_type: 'PAGE_OPTIMIZATION_RESEARCH',
  status: 'REVIEW',
  recommendation: 'EXPAND_EXISTING',
  evidence_count: 5,
  result_path: 'research/g037-page-opt-001.json',
  review_summary: 'verified coverage gaps',
  evidence: [{ source: 'reddit', evidence: 'gap 1' }],
  content_decision: {
    source_action: 'OPTIMIZE_EXISTING',
    primary_decision: 'EXPAND_EXISTING',
    secondary_actions: ['ADD_FAQ'],
    decision_reason: 'verified coverage gaps',
    evidence_summary: 'five relevant sources',
    target_queries: ['gloombound flame', 'lantern'],
    recommended_sections: ['Lantern use'],
    recommended_title_change: 'Align title',
    recommended_internal_links: [],
    confidence: 'HIGH'
  }
});

assert(result.ok === true, 'callback succeeds');
assert(result.development_task && result.development_task.created === 1, 'task created');
assert(developmentSheet.rows.length === 1, 'one development task row');
var task = developmentSheet.rows[0];
assert(task[developmentSheet.headers.indexOf('来源任务ID')] === 'g037-page-opt-001', 'source job bound');
assert(task[developmentSheet.headers.indexOf('任务状态')] === 'READY_FOR_IMPLEMENTATION', 'task ready');
assert(task[developmentSheet.headers.indexOf('ActionType')] === 'UPDATE_PAGE', 'update action bound');
assert(task[developmentSheet.headers.indexOf('SiteID')] === 'site-ms2', 'site bound');
assert(researchSheet.rows[0][headers.indexOf('PrimaryDecision')] === 'EXPAND_EXISTING', 'decision persisted');
assert(researchSheet.rows[0][headers.indexOf('Confidence')] === 'HIGH', 'confidence persisted');
assert(context.writeResearchJobResult_({
  job_id: 'g037-page-opt-001',
  research_type: 'PAGE_OPTIMIZATION_RESEARCH',
  status: 'WATCH',
  recommendation: 'WATCH',
  content_decision: { primary_decision: 'WATCH', confidence: 'LOW' }
}).development_task === null, 'WATCH does not create a task');

console.log('test-g037-content-decision-fast-lane: PASS');
