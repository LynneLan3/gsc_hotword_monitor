/** Phase 7D Unified Action Queue V1 pure-function and source-boundary tests. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
var queueSrc = fs.readFileSync(path.join(root, 'UnifiedActionQueue.gs'), 'utf8');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');

function assert(value, message) {
  if (!value) throw new Error(message);
}

function record(headers, values, rowNumber) {
  var col = {};
  headers.forEach(function (name, index) { col[name] = index; });
  return {row: values, col: col, rowNumber: rowNumber || 2};
}

function action(date, site, nextAction, extra) {
  var item = {
    date: date,
    priority: 'P2',
    site: site,
    lifecycleStage: 'TRACTION',
    recommendedAction: nextAction,
    domainScore: 10,
    reason: 'manual GSC action',
    status: 'TODO',
    note: '',
    decisionId: '',
    opportunityId: '',
    game: site,
    opportunityType: '',
    currentState: nextAction,
    sourceReference: 'gsc-row'
  };
  Object.keys(extra || {}).forEach(function (key) { item[key] = extra[key]; });
  return item;
}

var radarHeaders = ['站点', '游戏', '信号状态', '雷达状态', '研究任务ID', 'OpportunityID'];
var researchHeaders = ['站点', '游戏', '任务状态', '任务ID', 'OpportunityID'];
var decisionHeaders = ['DecisionID', 'Site', 'OpportunityID'];
var developmentHeaders = ['开发任务ID', '来源任务ID', '站点', '游戏', '任务状态'];

var context = {
  SpreadsheetApp: {},
  Logger: {log: function () {}},
  console: console,
  SHEET_NAMES: {TODAY_ACTIONS: '今日行动'},
  RADAR_SIGNAL_STATUS: {ACTIVE: 'ACTIVE', RESOLVED: 'RESOLVED'},
  RADAR_STATUS: {DISCOVERED: 'DISCOVERED', RESEARCH: 'RESEARCH', WATCH: 'WATCH', VALIDATED: 'VALIDATED', ARCHIVED: 'ARCHIVED'},
  RESEARCH_JOB_STATUS: {PENDING: 'PENDING', REVIEW: 'REVIEW', FAILED: 'FAILED', APPROVED: 'APPROVED'},
  RESEARCH_JOB_STATUS_LABELS: {PENDING: '待处理', REVIEW: '待审核', FAILED: '失败', APPROVED: '已批准'},
  DEVELOPMENT_TASK_STATUS: {TODO: 'TODO'},
  DEVELOPMENT_TASK_STATUS_LABELS: {TODO: '待开发'},
  TODAY_ACTION_HEADERS: ['Date', 'Priority', 'Site', 'LifecycleStage', 'RecommendedAction', 'DomainScore', 'Reason', 'Status', '人工备注', 'DecisionID', 'SourceSystem', 'OpportunityID', 'Game', 'OpportunityType', 'CurrentState', 'SourceReference'],
  normalizeTodayStatus_: function (value) { return String(value || '').trim().toUpperCase(); },
  todayPriorityRank_: function (value) {
    return {P0: 0, P1: 1, P2: 2, P3: 3}[String(value || '').toUpperCase()] === undefined ? 9 : {P0: 0, P1: 1, P2: 2, P3: 3}[String(value || '').toUpperCase()];
  },
  todayStr_: function () { return '2026-08-22'; },
  cell_: function (row, col, header) {
    var index = col[header];
    return index === undefined || row[index] === undefined || row[index] === null ? '' : row[index];
  }
};
vm.createContext(context);
vm.runInContext(queueSrc, context);

var steamTitanic = {
  game: 'Titanic Escape Simulator™',
  decision: '',
  nextAction: 'Google Trends',
  researchStatus: '待研究',
  currentStage: '1B完成→人工第二轮',
  opportunityId: 'opp-titanic-escape-simulator-steam-candidate-001',
  sourceReference: 'steam-row'
};
var steamNone = Object.assign({}, steamTitanic, {game: 'Done Candidate', nextAction: 'None', opportunityId: 'opp-done'});
var steamReject = Object.assign({}, steamTitanic, {game: 'Rejected Candidate', decision: 'REJECT', opportunityId: 'opp-reject'});

var positiveGsc = action('2026-08-22', 'Other Game', 'CONTENT_OPTIMIZE', {
  decisionId: 'decision-other',
  sourceReference: 'gsc-manual-row'
});
var earlyAction = action('2026-08-22', 'Project P.I.T.T.', 'AUTO_FOLLOWUP', {
  sourceSystem: 'EARLY',
  opportunityId: 'EARLY_SITE_WIN:project-pitt',
  opportunityType: 'EARLY_SITE_WIN',
  currentState: 'AUTO_HANDLED / AUTO_MONITORING',
  sourceReference: 'early-router-row'
});
var watchGsc = action('2026-08-22', 'Mortal Shell II', 'WATCH', {
  decisionId: 'decision-ms2',
  opportunityId: 'opp-ms2-mortal-shell-ii-skip-prologue-query-blind-spot-001'
});
var watchContext = record(
  radarHeaders,
  ['Mortal Shell II', 'Mortal Shell II', 'ACTIVE', 'WATCH', '', 'opp-ms2-mortal-shell-ii-skip-prologue-query-blind-spot-001']
);
var positiveContext = record(
  decisionHeaders,
  ['decision-other', 'Other Game', 'opp-other-001']
);

var queue = context.buildUnifiedActionQueue_(
  '2026-08-22',
  [positiveGsc, earlyAction, watchGsc, action('2026-08-22', 'Other Game', 'CONTENT_OPTIMIZE', {decisionId: 'decision-other'})],
  [steamTitanic, steamTitanic, steamNone, steamReject],
  {
    radar: [watchContext],
    research: [],
    decisions: [positiveContext],
    development: []
  }
);

assert(queue.length === 3, 'manual GSC + EARLY + Titanic only; no duplicate or WATCH row');
var gscRow = queue.filter(function (row) { return row[10] === 'GSC'; })[0];
var earlyRow = queue.filter(function (row) { return row[10] === 'EARLY'; })[0];
var steamRow = queue.filter(function (row) { return row[10] === 'STEAM'; })[0];
assert(!!gscRow, 'manual GSC action appears');
assert(!!earlyRow, 'EARLY action appears in unified queue');
assert(earlyRow[11] === 'EARLY_SITE_WIN:project-pitt', 'EARLY ActionKey/OpportunityID preserved');
assert(earlyRow[13] === 'EARLY_SITE_WIN', 'EARLY opportunity type preserved');
assert(gscRow[11] === 'opp-other-001', 'GSC OpportunityID comes from Decision History');
assert(gscRow[12] === 'Other Game' && gscRow[13] === 'GSC_DECISION', 'GSC game and opportunity type preserved');
assert(!!steamRow, 'Steam actionable candidate appears');
assert(steamRow[4] === 'Google Trends', 'Titanic NextAction is Google Trends');
assert(steamRow[11] === 'opp-titanic-escape-simulator-steam-candidate-001', 'Titanic OpportunityID preserved');
assert(steamRow[12] === 'Titanic Escape Simulator™', 'Titanic game preserved');
assert(!queue.some(function (row) { return row[11] === 'opp-ms2-mortal-shell-ii-skip-prologue-query-blind-spot-001'; }), 'WATCH-only skip-prologue is excluded');
assert(!queue.some(function (row) { return row[11] === 'opp-done' || row[11] === 'opp-reject'; }), 'Steam None and REJECT are excluded');

var resolved = context.buildUnifiedActionQueue_(
  '2026-08-22',
  [Object.assign({}, positiveGsc, {status: 'DONE'})],
  [Object.assign({}, steamTitanic, {nextAction: 'None'})],
  {radar: [], research: [], decisions: [], development: []}
);
assert(resolved.length === 0, 'resolved actions disappear on rebuild');

var configHeaderBlock = configSrc.match(/var TODAY_ACTION_HEADERS = \[[\s\S]*?\];/)[0];
['SourceSystem', 'OpportunityID', 'Game', 'OpportunityType', 'CurrentState', 'SourceReference'].forEach(function (header) {
  assert(configHeaderBlock.indexOf("'" + header + "'") >= 0, 'unified field exists: ' + header);
});
assert(configHeaderBlock.indexOf("'RecommendedAction'") < configHeaderBlock.indexOf("'SourceSystem'"), 'existing RecommendedAction remains the NextAction field');
assert(/refreshTodayActions_\(runDate, actionRows\)/.test(decisionSrc), 'existing GSC refresh remains');
assert(/refreshUnifiedActionQueue_\(runDate\)/.test(decisionSrc), 'Decision refresh feeds unified queue');
assert(/refreshDemandRadar_\(sites, runDate\)[\s\S]*refreshUnifiedActionQueue_\(runDate\)/.test(codeSrc), 'daily finalizer refreshes unified queue after radar');
assert(/SpreadsheetApp\.openById\(UNIFIED_ACTION_QUEUE\.STEAM_SOURCE_SPREADSHEET_ID\)/.test(queueSrc), 'Steam reads by Spreadsheet ID');
var steamReader = queueSrc.slice(queueSrc.indexOf('function loadSteamActionRows_'), queueSrc.indexOf('\nfunction loadInternalSheetRecords_'));
assert(!/\.setValue|\.setValues|\.clearContent|\.appendRow|\.insertRow|\.deleteRow/.test(steamReader), 'Steam reader is read-only');

console.log('PASS scripts/test-unified-action-queue.js (Steam/GSC inclusion, WATCH/None/REJECT filtering, OpportunityID, idempotency, resolved disappearance, refresh wiring)');
