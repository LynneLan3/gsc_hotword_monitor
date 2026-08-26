/** Goal 3 router I/O contract: one production-like write, then idempotent repeat. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var routerSrc = fs.readFileSync(path.join(root, 'EarlyActionRouter.gs'), 'utf8');
var gateSrc = fs.readFileSync(path.join(root, 'OneCycleNotificationGate.gs'), 'utf8');

function extractAssign(src, name) {
  var match = src.match(new RegExp('var ' + name + '\\s*=\\s*([\\s\\S]*?);\\s*\\n(?:var |/\\*|function )'));
  assert(match, 'missing ' + name);
  return eval('(' + match[1] + ')');
}

function FakeRange(sheet, row, column, numRows, numColumns) {
  this.sheet = sheet;
  this.row = row;
  this.column = column;
  this.numRows = numRows;
  this.numColumns = numColumns;
}

FakeRange.prototype.getValues = function () {
  var out = [];
  for (var r = 0; r < this.numRows; r++) {
    var source = this.row + r === 1 ? this.sheet.header : this.sheet.rows[this.row + r - 2] || [];
    var line = [];
    for (var c = 0; c < this.numColumns; c++) line.push(source[this.column + c - 1] === undefined ? '' : source[this.column + c - 1]);
    out.push(line);
  }
  return out;
};

FakeRange.prototype.setValues = function (values) {
  for (var r = 0; r < values.length; r++) {
    var targetRow = this.row + r;
    if (targetRow === 1) {
      for (var hc = 0; hc < values[r].length; hc++) this.sheet.header[this.column + hc - 1] = values[r][hc];
      continue;
    }
    var index = targetRow - 2;
    while (this.sheet.rows.length <= index) this.sheet.rows.push([]);
    for (var c = 0; c < values[r].length; c++) this.sheet.rows[index][this.column + c - 1] = values[r][c];
  }
  return this;
};

FakeRange.prototype.setValue = function (value) {
  return this.setValues([[value]]);
};

FakeRange.prototype.setFontWeight = function () { return this; };

function FakeSheet(headers) {
  this.header = headers.slice();
  this.rows = [];
}

FakeSheet.prototype.getLastRow = function () { return this.rows.length + 1; };
FakeSheet.prototype.getLastColumn = function () { return this.header.length; };
FakeSheet.prototype.getRange = function (row, column, numRows, numColumns) {
  return new FakeRange(this, row, column, numRows, numColumns);
};

var ruleRows = extractAssign(configSrc, 'DEFAULT_DECISION_RULES');
var rules = {};
ruleRows.forEach(function (row) { rules[row[0]] = Number(row[1]); });
var context = {
  EARLY_ACTION_ROUTER_SIGNALS: extractAssign(configSrc, 'EARLY_ACTION_ROUTER_SIGNALS'),
  EXTERNAL_OPPORTUNITY_TYPES: extractAssign(configSrc, 'EXTERNAL_OPPORTUNITY_TYPES'),
  RESEARCH_TYPE: extractAssign(configSrc, 'RESEARCH_TYPE'),
  RESEARCH_JOB_HEADERS: extractAssign(configSrc, 'RESEARCH_JOB_HEADERS'),
  RESEARCH_JOB_STATUS_LABELS: extractAssign(configSrc, 'RESEARCH_JOB_STATUS_LABELS'),
  TODAY_ACTION_HEADERS: extractAssign(configSrc, 'TODAY_ACTION_HEADERS'),
  OPPORTUNITY_HEADERS: extractAssign(configSrc, 'OPPORTUNITY_HEADERS').concat(extractAssign(configSrc, 'EXTERNAL_OPPORTUNITY_HEADERS')),
  SHEET_NAMES: {OPPORTUNITIES: '内容机会', TODAY_ACTIONS: '今日行动', RESEARCH_JOBS: '研究任务'},
  getDecisionRules_: function () { return rules; },
  seedMissingDecisionRules_: function () {},
  ensureExternalOpportunityHeaders_: function () {},
  ensureTodayActionHeader_: function () {},
  ensureSheetGrid_: function () {},
  ensureSheet_: function (name, headers) {
    if (!sheets[name]) sheets[name] = new FakeSheet(headers);
    return sheets[name];
  },
  headerIndexMap_: function (headers) {
    var out = {};
    headers.forEach(function (value, index) { out[value] = index; });
    return out;
  },
  cell_: function (row, col, header) {
    return col[header] === undefined ? '' : (row[col[header]] === undefined ? '' : row[col[header]]);
  },
  safeJsonParse_: function (value, fallback) {
    try { return value ? JSON.parse(value) : fallback; } catch (e) { return fallback; }
  },
  todayStr_: function () { return '2026-08-24'; },
  writeLog_: function (level, site, message) { logs.push(message); },
  Logger: {log: function () {}},
  PropertiesService: {
    getScriptProperties: function () {
      return {
        getProperty: function (key) { return properties[key] || null; },
        setProperty: function (key, value) { properties[key] = value; }
      };
    }
  },
  getSpreadsheet_: function () { return spreadsheet; }
};

var sheets = {};
var properties = {};
var logs = [];
var spreadsheet = {
  getSheetByName: function (name) { return sheets[name] || null; }
};

context.writeExternalOpportunityCandidatesM0_ = function (candidates) {
  var sheet = context.ensureSheet_(context.SHEET_NAMES.OPPORTUNITIES, context.OPPORTUNITY_HEADERS);
  var col = context.headerIndexMap_(sheet.header);
  candidates.forEach(function (candidate) {
    var row = new Array(sheet.header.length).fill('');
    row[col.OpportunityID] = candidate.OpportunityID;
    row[col.Game] = candidate.Game;
    row[col.OpportunityType] = candidate.OpportunityType;
    row[col.SignalState] = candidate.SignalState;
    row[col.ActionKey] = candidate.ActionKey;
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  });
  return candidates.length;
};

vm.createContext(context);
vm.runInContext(gateSrc, context);
vm.runInContext(routerSrc, context);

var snapshots = [{
  site: {
    name: 'Project P.I.T.T.',
    siteId: 'project-pitt',
    propertyUrl: 'https://project-pitt.vercel.app/',
    day0: '2026-08-22'
  },
  clusters: []
}];
var earlyRecords = [{
  site: 'Project P.I.T.T.',
  day: 2,
  status: 'EARLY_WINNER',
  confidence: 'HIGH',
  metrics: {impressions24h: 51, clicks24h: 5},
  reason: 'Early Winner / HIGH; real realtime metrics'
}];

var first = context.runEarlyActionRouter({snapshots: snapshots, earlyRecords: earlyRecords, now: new Date('2026-08-24T10:00:00Z')});
assert(first.plans.length === 1, 'first run creates one site-win plan');
assert(first.opportunities === 1 && first.todayActions === 0 && first.researchJobs === 0, 'signal-only winner writes no action or job');
assert(sheets['内容机会'].rows.length === 1, 'one opportunity row persisted');
assert(!sheets['今日行动'] || sheets['今日行动'].rows.length === 0, 'signal-only winner writes no today action');
var opportunityCol = context.headerIndexMap_(sheets['内容机会'].header);
assert(sheets['内容机会'].rows[0][opportunityCol.OpportunityType] === 'EARLY_SITE_WIN', 'opportunity type persisted');
assert(sheets['内容机会'].rows[0][opportunityCol.SignalState] === 'WATCH', 'opportunity final decision persisted');

var second = context.runEarlyActionRouter({snapshots: snapshots, earlyRecords: earlyRecords, now: new Date('2026-08-24T11:00:00Z')});
assert(second.plans.length === 0, 'repeat run is state-deduped');
assert(sheets['内容机会'].rows.length === 1 && (!sheets['今日行动'] || sheets['今日行动'].rows.length === 0), 'repeat run creates no duplicate rows');
assert(properties.EARLY_ACTION_ROUTER_STATE_V1, 'router state persisted');
assert(logs.some(function (message) { return /runEarlyActionRouter 完成/.test(message); }), 'router runtime log emitted');

// A finalized, meaningful new-page candidate crosses the gate exactly once.
var validSnapshot = [{
  site: snapshots[0].site,
  dataState: 'FINALIZED',
  finalizedDataDate: '2026-08-24',
  incomplete: false,
  clusters: [{key: 'ISAAC', hasExistingPage: false, topPage: '/'}]
}];
var valid = context.runEarlyActionRouter({
  snapshots: validSnapshot,
  earlyRecords: [],
  followupRecords: [{
    site: 'Project P.I.T.T.',
    clusterKey: 'ISAAC',
    clusterLabel: 'Isaac guide',
    signals: ['NEW_INTENT'],
    confidence: 'MEDIUM',
    currentImpressions: 20,
    currentClicks: 1,
    currentTopPage: '/',
    expectedPage: '',
    observationCount: 1,
    opportunityStage: 'CAPTURE',
    reason: 'finalized GSC evidence'
  }],
  now: new Date('2026-08-24T12:00:00Z')
});
assert(valid.plans.length === 1 && valid.todayActions === 1, 'validated new-page candidate writes one action');
assert(sheets['今日行动'].rows.length === 1, 'one validated today action persisted');
var validActionCol = context.headerIndexMap_(sheets['今日行动'].header);
assert(sheets['今日行动'].rows[0][validActionCol.RecommendedAction] === 'NEW_PAGE_CANDIDATE', 'final action persisted');
assert(/Data cutoff: 2026-08-24/.test(sheets['今日行动'].rows[0][validActionCol.Reason]), 'data cutoff included in notification');
assert(/Recommended action: NEW_PAGE_CANDIDATE/.test(sheets['今日行动'].rows[0][validActionCol.Reason]), 'recommended action included in notification');

console.log('PASS scripts/test-early-action-router-io.js (production-like write and idempotent repeat)');
