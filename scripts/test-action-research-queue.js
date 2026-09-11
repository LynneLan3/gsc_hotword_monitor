/** Regression check for the producer-side Action Research queue contract. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractAssign(source, name) {
  var match = source.match(
    new RegExp('var ' + name + '\\s*=\\s*([\\s\\S]*?);\\s*\\n(?:var |/\\*|function )')
  );
  assert(match, 'missing ' + name);
  return eval('(' + match[1] + ')');
}

var root = path.join(__dirname, '..');
var config = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var headers = extractAssign(config, 'RESEARCH_JOB_HEADERS');
var RESEARCH_TYPE = extractAssign(config, 'RESEARCH_TYPE');
var context = {
  RESEARCH_TYPE: RESEARCH_TYPE,
  ACTION_RESEARCH_TYPES: extractAssign(config, 'ACTION_RESEARCH_TYPES'),
  OPPORTUNITY_ACTION_LABELS: extractAssign(config, 'OPPORTUNITY_ACTION_LABELS'),
  OPPORTUNITY_LEVEL_LABELS: extractAssign(config, 'OPPORTUNITY_LEVEL_LABELS'),
  RESEARCH_JOB_HEADERS: headers,
  RESEARCH_JOB_STATUS: extractAssign(config, 'RESEARCH_JOB_STATUS'),
  RESEARCH_JOB_STATUS_LABELS: extractAssign(config, 'RESEARCH_JOB_STATUS_LABELS'),
  RESEARCH_TYPE: RESEARCH_TYPE,
  SHEET_NAMES: { RESEARCH_JOBS: '研究任务' },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: function (text) {
      return {
        getContent: function () { return text; },
        setMimeType: function () { return this; }
      };
    }
  }
};

var col = {};
headers.forEach(function (name, index) { col[name] = index; });
function row(overrides) {
  var values = new Array(headers.length).fill('');
  Object.keys(overrides).forEach(function (name) { values[col[name]] = overrides[name]; });
  return values;
}

var rows = [
  row({
    任务ID: 'older-action-research',
    创建时间: '2026-09-10T00:00:00+08:00',
    游戏: 'Mortal Shell II',
    '搜索词 / topic': 'older action topic',
    页面路径: '/mortal-shell-ii/older-action/',
    任务状态: 'PENDING',
    研究类型: 'PAGE_OPTIMIZATION_RESEARCH'
  }),
  row({
    任务ID: 'ms2-crashing-pc-manual-verify-20260911',
    创建时间: '2026-09-11T00:00:00+08:00',
    站点: 'Mortal Shell II',
    游戏: 'Mortal Shell II',
    '搜索词 / topic': 'crashing pc manual verify',
    页面路径: '/mortal-shell-ii/crashing/',
    机会等级: '高',
    建议动作: '研究并扩充现有页面',
    source_query: 'mortal shell 2 crashing pc',
    任务状态: '待处理',
    关联搜索词: 'mortal shell 2 crashing pc | mortal shell ii crash',
    研究类型: 'PAGE_OPTIMIZATION_RESEARCH',
    SourceAction: 'OPTIMIZE_EXISTING',
    ActionContext: JSON.stringify({ pagePath: '/mortal-shell-ii/crashing/', clusterKey: 'CRASHING' })
  }),
  row({
    任务ID: 'ordinary-content-research',
    游戏: 'Mortal Shell II',
    '搜索词 / topic': 'ordinary topic',
    任务状态: '待处理',
    研究类型: 'CONTENT_RESEARCH'
  })
];

context.SpreadsheetApp = {
  getActiveSpreadsheet: function () {
    return {
      getSheetByName: function () {
        return {
          getLastRow: function () { return rows.length + 1; },
          getLastColumn: function () { return headers.length; },
          getRange: function (rowNumber) {
            return {
              getValues: function () { return rowNumber === 1 ? [headers] : rows; }
            };
          }
        };
      }
    };
  }
};

vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'ResearchJobs.gs'), 'utf8'), context);

var jobs = context.loadPendingActionResearchJobs_();
assert(jobs.length === 2, 'only action jobs should be pending');
assert(jobs[0].job_id === 'ms2-crashing-pc-manual-verify-20260911', 'action job selected');
assert(jobs[1].job_id === 'older-action-research', 'older action job follows newer job');
assert(jobs[0].research_type === 'PAGE_OPTIMIZATION_RESEARCH', 'research_type preserved');
assert(jobs[0].source_action === 'OPTIMIZE_EXISTING', 'source_action preserved');
assert(jobs[0].action_context.clusterKey === 'CRASHING', 'action_context preserved');

var required = [
  'job_id', 'game', 'topic', 'existing_page', 'opportunity_level',
  'recommended_action', 'source_query', 'created_at', 'related_queries',
  'research_type', 'source_action', 'action_context'
];
required.forEach(function (field) {
  assert(Object.prototype.hasOwnProperty.call(jobs[0], field), 'missing action payload field: ' + field);
});
assert(jobs[0].related_queries.length === 2, 'related_queries serialized as an array');

var response = JSON.parse(
  context.doGet({ parameter: { action: 'pendingActionResearchJobs' } }).getContent()
);
assert(response.jobs.length === 2, 'route returns action queue');
assert(response.jobs[0].job_id === jobs[0].job_id, 'route returns selected action job');

console.log('PASS scripts/test-action-research-queue.js');
