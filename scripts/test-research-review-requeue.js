/** Research task review decision: 重新研究 → same Action Research job back to PENDING. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractAssign(src, name) {
  var match = src.match(new RegExp('var ' + name + '\\s*=\\s*([\\s\\S]*?);\\s*\\n(?:var |/\\*|function )'));
  assert(match, 'missing ' + name);
  return eval('(' + match[1] + ')');
}

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var researchSrc = fs.readFileSync(path.join(root, 'ResearchJobs.gs'), 'utf8');
var headers = extractAssign(configSrc, 'RESEARCH_JOB_HEADERS');
var col = {};
headers.forEach(function (name, index) { col[name] = index; });
var RESEARCH_TYPE = extractAssign(configSrc, 'RESEARCH_TYPE');
var RESEARCH_REVIEW_DECISION_LABELS = extractAssign(configSrc, 'RESEARCH_REVIEW_DECISION_LABELS');

var rows = [];
var validationState = {};
var sheet = {
  getLastColumn: function () { return headers.length; },
  getLastRow: function () { return rows.length + 1; },
  getMaxRows: function () { return 100; },
  getRange: function (row, column, rowCount, columnCount) {
    return {
      getValues: function () {
        if (row === 1) return [headers];
        return rows.slice(row - 2, row - 2 + rowCount);
      },
      setValue: function (value) {
        rows[row - 2][column - 1] = value;
      },
      setDataValidation: function (rule) {
        validationState.rule = rule;
      },
      setNumberFormat: function () {},
      setValues: function (values) {
        for (var i = 0; i < values.length; i++) rows[row - 2 + i] = values[i];
      }
    };
  }
};

var context = {
  ACTION_RESEARCH_TYPES: extractAssign(configSrc, 'ACTION_RESEARCH_TYPES'),
  OPPORTUNITY_LEVEL_LABELS: extractAssign(configSrc, 'OPPORTUNITY_LEVEL_LABELS'),
  OPPORTUNITY_ACTION_LABELS: extractAssign(configSrc, 'OPPORTUNITY_ACTION_LABELS'),
  RESEARCH_TYPE: RESEARCH_TYPE,
  RESEARCH_JOB_STATUS: extractAssign(configSrc, 'RESEARCH_JOB_STATUS'),
  RESEARCH_JOB_STATUS_LABELS: extractAssign(configSrc, 'RESEARCH_JOB_STATUS_LABELS'),
  RESEARCH_REVIEW_DECISION: extractAssign(configSrc, 'RESEARCH_REVIEW_DECISION'),
  RESEARCH_REVIEW_DECISION_LABELS: RESEARCH_REVIEW_DECISION_LABELS,
  RESEARCH_REVIEW_DECISION_OPTIONS: extractAssign(configSrc, 'RESEARCH_REVIEW_DECISION_OPTIONS'),
  RESEARCH_JOB_HEADERS: headers,
  SHEET_NAMES: { RESEARCH_JOBS: '研究任务' },
  Logger: { log: function () {} },
  SpreadsheetApp: {
    getActiveSpreadsheet: function () { return { getSheetByName: function () { return sheet; } }; },
    newDataValidation: function () {
      var rule = {};
      return {
        requireValueInList: function (values, showDropdown) {
          rule.values = values.slice();
          rule.showDropdown = showDropdown;
          return this;
        },
        setAllowInvalid: function (allowInvalid) {
          rule.allowInvalid = allowInvalid;
          return this;
        },
        build: function () {
          validationState.rule = rule;
          return rule;
        }
      };
    },
    flush: function () {}
  },
  getSpreadsheet_: function () { return { getSheetByName: function () { return sheet; } }; },
  writeLog_: function () {},
  ensureResearchJobSheets_: function () {},
  headerIndexMap_: function (input) {
    var out = {};
    input.forEach(function (name, index) { out[name] = index; });
    return out;
  },
  cell_: function (row, map, name) {
    return map[name] === undefined ? '' : row[map[name]];
  },
  safeJsonParse_: function (value, fallback) {
    try { return JSON.parse(String(value || '')); } catch (e) { return fallback; }
  },
  opportunityLabel_: function (map, value) { return (map && map[value]) || value || ''; },
  enumFromLabel_: function (map, value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    if (map[raw]) return raw;
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      if (map[keys[i]] === raw) return keys[i];
    }
    return '';
  },
  Date: Date
};

vm.createContext(context);
vm.runInContext(researchSrc, context);
// Keep the test focused on decision logic; avoid real Sheet setup/validation.
context.ensureResearchJobSheets_ = function () {};

assert(
  context.RESEARCH_REVIEW_DECISION_OPTIONS.join('|') ===
    '批准开发|继续观察|无需处理|重新研究',
  '审核决定 strict dropdown has exactly four fixed options'
);
assert(context.statusAfterResearchReviewDecision_('批准开发') === '已批准', '批准开发 unchanged');
assert(context.statusAfterResearchReviewDecision_('继续观察') === '继续观察', '继续观察 unchanged');
assert(context.statusAfterResearchReviewDecision_('无需处理') === '已归档', '无需处理 unchanged');
assert(
  context.statusAfterResearchReviewDecision_('重新研究', 'PAGE_OPTIMIZATION_RESEARCH') === '待处理',
  'Action Research requeue maps to PENDING label'
);
assert(
  context.statusAfterResearchReviewDecision_('重新研究', 'CONTENT_RESEARCH') === '',
  'legacy content research cannot be requeued by 重新研究'
);

function makeRow(researchType, decision, status, auditTime) {
  var row = new Array(headers.length).fill('');
  row[col['任务ID']] = 'ms2-gloombound-flame-20260823';
  row[col['站点']] = 'Mortal Shell II';
  row[col['游戏']] = 'Mortal Shell II';
  row[col['搜索词 / topic']] = 'Gloombound Flame';
  row[col['页面路径']] = '/mortal-shell-ii/gloombound-flame/';
  row[col['任务状态']] = status || context.RESEARCH_JOB_STATUS_LABELS.REVIEW;
  row[col['关联搜索词']] = 'gloombound flame|lantern';
  row[col['研究类型']] = researchType;
  row[col['SourceAction']] = 'OPTIMIZE_EXISTING';
  row[col['ActionContext']] = JSON.stringify({
    pagePath: '/mortal-shell-ii/gloombound-flame/',
    clusterKey: 'GLOOMBOUND_FLAME',
    clusterQueries: ['gloombound flame', 'lantern'],
    pageImpressions: 158
  });
  row[col['审核决定']] = decision;
  row[col['审核时间']] = auditTime || '';
  return row;
}

assert(typeof context.refreshResearchReviewValidation === 'function', 'public dropdown refresh entry exists');
assert(/重新研究/.test(context.refreshResearchReviewValidation()), 'public dropdown refresh completes');
assert(validationState.rule.showDropdown === true, '审核决定 dropdown is strict list mode');
assert(validationState.rule.allowInvalid === false, '审核决定 dropdown rejects invalid values');
assert(
  validationState.rule.values.join('|') === '批准开发|继续观察|无需处理|重新研究',
  '审核决定 validation has exactly four options'
);

var actionContextBefore = JSON.parse(makeRow('PAGE_OPTIMIZATION_RESEARCH', '重新研究')[col['ActionContext']]);
var oldEvidence = [{ 任务ID: 'ms2-gloombound-flame-20260823', 证据摘录: 'old evidence remains' }];
rows.push(makeRow('PAGE_OPTIMIZATION_RESEARCH', '重新研究'));
var actionRowBefore = rows[0].slice();
assert(context.isResearchJobAwaitingReview_('待审核') === true, 'Action Research row is awaiting review');
var processed = context.processResearchReviewDecisions();
assert(/processed=1/.test(processed), 'Action Research requeue processed: ' + processed);
assert(rows[0][col['任务ID']] === actionRowBefore[col['任务ID']], 'JobID unchanged');
assert(rows[0][col['研究类型']] === actionRowBefore[col['研究类型']], 'ResearchType unchanged');
assert(rows[0][col['SourceAction']] === actionRowBefore[col['SourceAction']], 'SourceAction unchanged');
assert(rows[0][col['ActionContext']] === actionRowBefore[col['ActionContext']], 'ActionContext unchanged');
assert(JSON.parse(rows[0][col['ActionContext']]).clusterKey === actionContextBefore.clusterKey, 'ActionContext content unchanged');
assert(rows[0][col['任务状态']] === context.RESEARCH_JOB_STATUS_LABELS.PENDING, 'status restored to 待处理');
assert(rows[0][col['审核决定']] === '', '审核决定 cleared after successful requeue');
assert(rows[0][col['审核时间']] === '', '审核时间 reset for the new review cycle');
assert(oldEvidence[0]['证据摘录'] === 'old evidence remains', 'old evidence is not deleted during requeue');

var pending = context.loadPendingActionResearchJobs_();
assert(pending.length === 1, 'pendingActionResearchJobs returns requeued job');
assert(pending[0].job_id === 'ms2-gloombound-flame-20260823', 'pending job keeps JobID');
assert(pending[0].research_type === 'PAGE_OPTIMIZATION_RESEARCH', 'pending job keeps ResearchType');
assert(pending[0].source_action === 'OPTIMIZE_EXISTING', 'pending job keeps SourceAction');
assert(pending[0].action_context.clusterKey === 'GLOOMBOUND_FLAME', 'pending job keeps ActionContext');

function assertRequeueFromCompletedStatus(status) {
  rows.length = 0;
  rows.push(makeRow('PAGE_OPTIMIZATION_RESEARCH', '重新研究', status, new Date('2026-08-23T10:00:00Z')));
  var result = context.processResearchReviewDecisions();
  assert(/processed=1/.test(result), status + ' + 重新研究 requeues');
  assert(rows[0][col['任务状态']] === context.RESEARCH_JOB_STATUS_LABELS.PENDING, status + ' → 待处理');
  assert(rows[0][col['审核决定']] === '', status + ' clears 审核决定');
  assert(rows[0][col['审核时间']] === '', status + ' clears old 审核时间');
}

assertRequeueFromCompletedStatus(context.RESEARCH_JOB_STATUS_LABELS.APPROVED);
assertRequeueFromCompletedStatus(context.RESEARCH_JOB_STATUS_LABELS.WATCH);
assertRequeueFromCompletedStatus(context.RESEARCH_JOB_STATUS_LABELS.ARCHIVED);

function assertRequeueBlockedFrom(status) {
  rows.length = 0;
  rows.push(makeRow('PAGE_OPTIMIZATION_RESEARCH', '重新研究', status, new Date('2026-08-23T10:00:00Z')));
  var result = context.processResearchReviewDecisions();
  assert(/processed=0/.test(result), status + ' + 重新研究 is not processed');
  assert(rows[0][col['任务状态']] === status, status + ' status unchanged');
  assert(rows[0][col['审核决定']] === '重新研究', status + ' decision remains for blocked requeue');
}

assertRequeueBlockedFrom(context.RESEARCH_JOB_STATUS_LABELS.PENDING);
assertRequeueBlockedFrom(context.RESEARCH_JOB_STATUS_LABELS.RUNNING);

rows.length = 0;
rows.push(makeRow('CONTENT_RESEARCH', '重新研究', context.RESEARCH_JOB_STATUS_LABELS.APPROVED, new Date('2026-08-23T10:00:00Z')));
var legacyResult = context.processResearchReviewDecisions();
assert(/processed=0/.test(legacyResult), 'legacy research is not requeued');
assert(rows[0][col['任务状态']] === context.RESEARCH_JOB_STATUS_LABELS.APPROVED, 'legacy status unchanged');
assert(rows[0][col['审核决定']] === '重新研究', 'legacy decision is not cleared');

console.log('PASS scripts/test-research-review-requeue.js');
