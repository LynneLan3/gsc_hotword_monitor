/** Query Cluster RESEARCH_NEW_INTENT → 既有 ResearchJobs 幂等联动测试。 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var engineSrc = fs.readFileSync(path.join(root, 'IntentOpportunityEngine.gs'), 'utf8');

function extractAssign(src, name) {
  var match = src.match(new RegExp('var ' + name + '\\s*=\\s*([\\s\\S]*?);\\s*\\n(?:var |/\\*|function )'));
  assert(match, 'missing ' + name);
  return eval('(' + match[1] + ')');
}

var headers = extractAssign(configSrc, 'RESEARCH_JOB_HEADERS');
var context = {
  INTENT_CLUSTER_ENTITY_ALIASES: extractAssign(configSrc, 'INTENT_CLUSTER_ENTITY_ALIASES'),
  INTENT_CLUSTER_ACTIONS: extractAssign(configSrc, 'INTENT_CLUSTER_ACTIONS'),
  INTENT_CLUSTER_THRESHOLDS: extractAssign(configSrc, 'INTENT_CLUSTER_THRESHOLDS'),
  OPPORTUNITY_HUB_SLUGS: extractAssign(configSrc, 'OPPORTUNITY_HUB_SLUGS'),
  OPPORTUNITY_LEVELS: extractAssign(configSrc, 'OPPORTUNITY_LEVELS'),
  OPPORTUNITY_ACTIONS: extractAssign(configSrc, 'OPPORTUNITY_ACTIONS'),
  OPPORTUNITY_LEVEL_LABELS: extractAssign(configSrc, 'OPPORTUNITY_LEVEL_LABELS'),
  OPPORTUNITY_ACTION_LABELS: extractAssign(configSrc, 'OPPORTUNITY_ACTION_LABELS'),
  RESEARCH_TYPE: extractAssign(configSrc, 'RESEARCH_TYPE'),
  RESEARCH_JOB_STATUS: extractAssign(configSrc, 'RESEARCH_JOB_STATUS'),
  RESEARCH_JOB_STATUS_LABELS: extractAssign(configSrc, 'RESEARCH_JOB_STATUS_LABELS'),
  RESEARCH_JOB_HEADERS: headers,
  SHEET_NAMES: { RESEARCH_JOBS: '研究任务' },
  Utilities: { formatDate: function () { return '20260823'; } },
  Session: { getScriptTimeZone: function () { return 'Asia/Shanghai'; } },
  Date: Date
};

var sheetRows = [];
var sheet = {
  getLastColumn: function () { return headers.length; },
  getLastRow: function () { return sheetRows.length + 1; },
  getRange: function (row, col, count) {
    return {
      getValues: function () {
        if (row === 1) return [headers];
        return sheetRows.slice(row - 2, row - 2 + count);
      },
      setValues: function (values) {
        for (var i = 0; i < values.length; i++) sheetRows.push(values[i]);
      }
    };
  }
};
var spreadsheet = { getSheetByName: function () { return sheet; } };
vm.createContext(context);
vm.runInContext(engineSrc, context);
context.ensureResearchJobSheets_ = function () {};
context.getSpreadsheet_ = function () { return spreadsheet; };
context.headerIndexMap_ = function (row) {
  var out = {};
  row.forEach(function (name, i) { out[name] = i; });
  return out;
};
context.cell_ = function (row, col, name) { return col[name] === undefined ? '' : row[col[name]]; };
context.makeResearchJobId_ = function (site, page, topic) {
  return 'ms2-' + String(topic).toLowerCase().replace(/[^a-z]+/g, '-') + '-20260823';
};
context.uniquifyResearchJobId_ = function (id) { return id + '-dup'; };
context.researchJobSheetRow_ = function (job, site) {
  var row = new Array(headers.length).fill('');
  var col = context.headerIndexMap_(headers);
  row[col['任务ID']] = job.job_id;
  row[col['站点']] = site;
  row[col['游戏']] = job.game;
  row[col['搜索词 / topic']] = job.topic;
  row[col['source_query']] = job.source_query;
  row[col['任务状态']] = context.RESEARCH_JOB_STATUS_LABELS.PENDING;
  row[col['建议动作']] = job.recommended_action;
  return row;
};
context.writeLog_ = function () {};

var candidate = {
  site: 'Mortal Shell II',
  key: 'QUERY_BEACONS_MAP',
  label: 'Beacons Map',
  action: 'RESEARCH_NEW_INTENT',
  clusterLabel: 'Beacons Map',
  topQuery: 'mortal shell 2 beacons map',
  queries: [{ query: 'mortal shell 2 beacons map' }],
  hotspotLevel: 'MEDIUM'
};

var first = context.enqueueIntentResearchJobs_([candidate]);
assert(first.created === 1 && first.skipped === 0, 'first signal creates one job');
assert(sheetRows.length === 1, 'one ResearchJobs row');
assert(candidate.researchJobId, 'candidate receives ResearchJobID');

var againCandidate = {
  site: candidate.site,
  key: candidate.key,
  action: candidate.action,
  clusterLabel: candidate.clusterLabel,
  topQuery: candidate.topQuery,
  queries: candidate.queries,
  hotspotLevel: candidate.hotspotLevel
};
var second = context.enqueueIntentResearchJobs_([againCandidate]);
assert(second.created === 0 && second.skipped === 1, 'same Site+ClusterKey open job is deduped');
assert(againCandidate.researchJobId === candidate.researchJobId, 'dedupe returns existing job id');

var alias = context.enqueueIntentResearchJobs_([{
  site: 'Mortal Shell II',
  key: 'GLOOMBOUND_FLAME',
  action: 'MULTILINGUAL_ALIAS',
  clusterLabel: 'Gloombound Flame',
  topQuery: 'mortal shell 2 düstergebundene flamme',
  queries: [],
  hotspotLevel: 'HIGH'
}]);
assert(alias.created === 0, 'MULTILINGUAL_ALIAS never creates research');

console.log('PASS scripts/test-intent-research-enqueue.js');
