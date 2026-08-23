/**
 * Phase 7C-3B M6A local fixture tests.
 * Run: node scripts/test-research-recommendation-enqueue-m6a.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function extractAssign(src, name) {
  var re = new RegExp('var ' + name + '\\s*=\\s*([\\s\\S]*?);\\s*\\n(?:var |/\\*|function )');
  var match = src.match(re);
  assert(match, 'cannot parse ' + name);
  return eval('(' + match[1] + ')');
}

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var researchSrc = fs.readFileSync(path.join(root, 'ResearchJobs.gs'), 'utf8');
var identitySrc = fs.readFileSync(path.join(root, 'SiteIdentity.gs'), 'utf8');

var RESEARCH_TYPE = extractAssign(configSrc, 'RESEARCH_TYPE');
var RESEARCH_JOB_STATUS = extractAssign(configSrc, 'RESEARCH_JOB_STATUS');
var RESEARCH_JOB_STATUS_LABELS = extractAssign(configSrc, 'RESEARCH_JOB_STATUS_LABELS');
var RESEARCH_JOB_HEADERS = extractAssign(configSrc, 'RESEARCH_JOB_HEADERS');
var SHEET_NAMES = extractAssign(configSrc, 'SHEET_NAMES');

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

var sandbox = {
  RESEARCH_TYPE: RESEARCH_TYPE,
  RESEARCH_JOB_STATUS: RESEARCH_JOB_STATUS,
  RESEARCH_JOB_STATUS_LABELS: RESEARCH_JOB_STATUS_LABELS,
  RESEARCH_JOB_HEADERS: RESEARCH_JOB_HEADERS,
  SHEET_NAMES: SHEET_NAMES,
  opportunityLabel_: function (map, key) { return (map && map[key]) || key || ''; },
  headerIndexMap_: function (headers) {
    var out = {};
    headers.forEach(function (header, i) { out[header] = i; });
    return out;
  },
  cell_: function (row, col, name) { return col[name] === undefined ? '' : row[col[name]]; },
  Session: { getScriptTimeZone: function () { return 'UTC'; } },
  Utilities: {
    formatDate: function (date, tz, fmt) {
      var d = new Date(date);
      if (fmt === 'yyyy-MM-dd') {
        return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
      }
      return d.toISOString();
    }
  }
};

vm.createContext(sandbox);
vm.runInContext(identitySrc, sandbox);
vm.runInContext(researchSrc, sandbox);

var col = sandbox.headerIndexMap_(RESEARCH_JOB_HEADERS);

function fixtureRow(opts) {
  opts = opts || {};
  var row = new Array(RESEARCH_JOB_HEADERS.length).fill('');
  row[col['任务ID']] = opts.jobId || '';
  row[col['创建时间']] = opts.createdAt || '2026-08-23T00:00:00Z';
  row[col['站点']] = opts.site || 'Mortal Shell II';
  row[col['游戏']] = opts.game || 'Mortal Shell II';
  row[col['任务状态']] = opts.status || '';
  row[col['研究类型']] = opts.researchType || '';
  row[col['结果路径']] = opts.resultPath || '';
  row[col['发现周期日期']] = opts.cycleDate || '2026-08-23';
  row[col['雷达ID']] = opts.radarId || 'radar-1';
  row[col['OpportunityID']] = opts.opportunityId || 'opp-1';
  if (opts.scope) row[col['发现范围']] = JSON.stringify(opts.scope);
  if (opts.searchJobId) row[col['Search任务ID']] = opts.searchJobId;
  if (opts.socialJobId) row[col['Social任务ID']] = opts.socialJobId;
  if (opts.searchResultPath) row[col['Search结果路径']] = opts.searchResultPath;
  if (opts.socialResultPath) row[col['Social结果路径']] = opts.socialResultPath;
  return row;
}

function search(opts) {
  opts = opts || {};
  return fixtureRow({
    jobId: opts.jobId || 'search-ms2-20260823',
    site: opts.site,
    game: opts.game,
    cycleDate: opts.cycleDate,
    researchType: RESEARCH_TYPE.SEARCH_DEMAND,
    status: opts.status || RESEARCH_JOB_STATUS.SEARCH_CONFIRMED,
    resultPath: opts.resultPath,
    radarId: opts.radarId,
    opportunityId: opts.opportunityId
  });
}

function social(opts) {
  opts = opts || {};
  return fixtureRow({
    jobId: opts.jobId || 'game-wide-ms2-20260823',
    site: opts.site,
    game: opts.game,
    cycleDate: opts.cycleDate,
    researchType: RESEARCH_TYPE.DEMAND_DISCOVERY,
    status: opts.status || RESEARCH_JOB_STATUS.DISCOVERY_DONE,
    resultPath: opts.resultPath,
    scope: { scope: 'GAME_WIDE' }
  });
}

function recommendation(opts) {
  opts = opts || {};
  return fixtureRow({
    jobId: opts.jobId || 'recommend-mortal-shell-ii-20260823-search-ms2-20260823',
    site: opts.site,
    game: opts.game,
    cycleDate: opts.cycleDate,
    researchType: RESEARCH_TYPE.RESEARCH_RECOMMENDATION,
    status: opts.status || RESEARCH_JOB_STATUS.PENDING,
    searchJobId: opts.searchJobId || 'search-ms2-20260823',
    socialJobId: opts.socialJobId || 'game-wide-ms2-20260823',
    searchResultPath: opts.searchResultPath || 'search/result.json',
    socialResultPath: opts.socialResultPath || 'social/result.json'
  });
}

function plan(rows) {
  return sandbox.planResearchRecommendationJobs_(rows, {
    createdAt: '2026-08-23T01:00:00Z'
  });
}

function oneRecommendation(rows, label) {
  var result = plan(rows);
  assert(result.created === 1, label + ' creates one recommendation');
  assert(result.jobRowsToAppend.length === 1, label + ' appends one row');
  return result.jobRowsToAppend[0];
}

// 1. Search + completed GAME_WIDE -> both paths are linked.
var both = oneRecommendation([
  search({ resultPath: 'search/ms2.json' }),
  social({ resultPath: 'social/ms2.json' })
], 'completed sources');
assert(both[col['研究类型']] === RESEARCH_TYPE.RESEARCH_RECOMMENDATION, 'case1 type');
assert(both[col['Search任务ID']] === 'search-ms2-20260823', 'case1 search id');
assert(both[col['Social任务ID']] === 'game-wide-ms2-20260823', 'case1 social id');
assert(both[col['Search结果路径']] === 'search/ms2.json', 'case1 search path');
assert(both[col['Social结果路径']] === 'social/ms2.json', 'case1 social path');

// 2. Search completed while Social is pending -> wait.
assert(plan([
  search({ resultPath: 'search/ms2.json' }),
  social({ status: RESEARCH_JOB_STATUS.READY_FOR_DISCOVERY_RUNNER })
]).created === 0, 'case2 pending social blocks');

// 3. Social completed while Search is pending -> no required Search input.
assert(plan([
  search({ status: RESEARCH_JOB_STATUS.READY_FOR_SEARCH_RUNNER, resultPath: '' }),
  social({ resultPath: 'social/ms2.json' })
]).created === 0, 'case3 pending search blocks');

// 4. Failed Social is terminal but contributes no path.
var failedSocial = oneRecommendation([
  search({ resultPath: 'search/ms2.json' }),
  social({ status: RESEARCH_JOB_STATUS.FAILED, resultPath: '' })
], 'failed social');
assert(failedSocial[col['Social任务ID']] === 'game-wide-ms2-20260823', 'case4 failed social id retained');
assert(failedSocial[col['Social结果路径']] === '', 'case4 failed social path blank');

// 5. Missing Social is allowed and leaves optional linkage blank.
var noSocial = oneRecommendation([search({ resultPath: 'search/ms2.json' })], 'missing social');
assert(noSocial[col['Social任务ID']] === '', 'case5 missing social id blank');
assert(noSocial[col['Social结果路径']] === '', 'case5 missing social path blank');

// 6. Search failed or missing result path never becomes ready.
assert(plan([search({ status: RESEARCH_JOB_STATUS.FAILED, resultPath: 'search/ms2.json' })]).created === 0,
  'case6 failed search blocked');
assert(plan([search({ status: RESEARCH_JOB_STATUS.SEARCH_CONFIRMED, resultPath: '' })]).created === 0,
  'case6 missing search path blocked');

// 7. Existing Recommendation row makes the pair idempotent.
assert(plan([
  search({ resultPath: 'search/ms2.json' }),
  social({ resultPath: 'social/ms2.json' }),
  recommendation()
]).created === 0, 'case7 duplicate recommendation suppressed');

// 8. Site/cycle are part of pairing; no cross-site or cross-cycle Social evidence.
var separated = plan([
  search({ jobId: 'search-a-20260823', site: 'Site A', cycleDate: '2026-08-23', resultPath: 'a.json' }),
  social({ jobId: 'social-b-20260823', site: 'Site B', cycleDate: '2026-08-23', resultPath: 'b.json' }),
  search({ jobId: 'search-a-20260824', site: 'Site A', cycleDate: '2026-08-24', resultPath: 'a2.json' }),
  social({ jobId: 'social-a-20260825', site: 'Site A', cycleDate: '2026-08-25', resultPath: 'a-social.json' })
]);
assert(separated.created === 2, 'case8 two independent search cycles');
assert(separated.jobRowsToAppend[0][col['Social结果路径']] === '', 'case8 site mismatch not paired');
assert(separated.jobRowsToAppend[1][col['Social结果路径']] === '', 'case8 cycle mismatch not paired');

// 9-10. M5 GET adapter has an exact contract and reads only.
var getRows = [
  recommendation({ searchResultPath: 'search/ms2.json', socialResultPath: 'social/ms2.json' }),
  recommendation({ jobId: 'recommend-failed', status: RESEARCH_JOB_STATUS.FAILED }),
  fixtureRow({ researchType: RESEARCH_TYPE.CONTENT_RESEARCH, status: RESEARCH_JOB_STATUS.PENDING })
];
var reads = 0;
var writes = 0;
var mockSheet = {
  getLastRow: function () { reads++; return getRows.length + 1; },
  getLastColumn: function () { reads++; return RESEARCH_JOB_HEADERS.length; },
  getRange: function (row, column, numRows, numCols) {
    reads++;
    return {
      getValues: function () {
        reads++;
        if (row === 1) return [RESEARCH_JOB_HEADERS];
        return getRows.slice(row - 2, row - 2 + numRows);
      },
      setValues: function () { writes++; throw new Error('GET must not write'); }
    };
  }
};
sandbox.SpreadsheetApp = {
  getActiveSpreadsheet: function () {
    return { getSheetByName: function () { return mockSheet; } };
  }
};
var pending = sandbox.loadPendingResearchRecommendationJobs_();
assert(pending.length === 1, 'case9 only pending recommendation returned');
assert(JSON.stringify(Object.keys(pending[0]).sort()) === JSON.stringify([
  'created_at', 'game_name', 'job_id', 'job_type', 'search_result_path',
  'site_key', 'social_result_path'
].sort()), 'case9 exact M5 keys');
assert(pending[0].job_type === 'RESEARCH_RECOMMENDATION', 'case9 job type');
assert(pending[0].search_result_path === 'search/ms2.json', 'case9 search path');
assert(pending[0].social_result_path === 'social/ms2.json', 'case9 social path');
assert(writes === 0 && reads > 0, 'case10 GET is read-only');

var callbackSource = fs.readFileSync(path.join(root, 'ResearchJobs.gs'), 'utf8');
assert(/function handleSearchDemandCallback_[\s\S]*?enqueueReadyResearchRecommendationJobs_\(\)/.test(callbackSource),
  'Search callback triggers enqueue');
assert(/function handleGameWideDiscoveryCallback_[\s\S]*?enqueueReadyResearchRecommendationJobs_\(\)/.test(callbackSource),
  'GAME_WIDE callback triggers enqueue');
var linkageStart = RESEARCH_JOB_HEADERS.indexOf('Search任务ID');
assert(linkageStart >= 0 && RESEARCH_JOB_HEADERS.slice(linkageStart, linkageStart + 4).join('|') ===
  'Search任务ID|Social任务ID|Search结果路径|Social结果路径',
  'linkage headers remain append-only before M1 fields');

console.log('PASS scripts/test-research-recommendation-enqueue-m6a.js');
