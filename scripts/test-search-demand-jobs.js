/**
 * R3A 本地纯逻辑验证：Demand Radar → SEARCH_DEMAND Job Contract
 * 运行：node scripts/test-search-demand-jobs.js
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function extractAssign(src, name) {
  var re = new RegExp('var ' + name + '\\s*=\\s*([\\s\\S]*?);\\s*\\n(?:var |/\\*|function )');
  var m = src.match(re);
  assert(m, 'cannot parse ' + name);
  return eval('(' + m[1] + ')');
}

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var researchSrc = fs.readFileSync(path.join(root, 'ResearchJobs.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');

var QUERY_BLIND_SPOT_TRIGGER = extractAssign(configSrc, 'QUERY_BLIND_SPOT_TRIGGER');
var RADAR_SIGNAL_STATUS = extractAssign(configSrc, 'RADAR_SIGNAL_STATUS');
var RADAR_STATUS = extractAssign(configSrc, 'RADAR_STATUS');
var SEARCH_DEMAND_STATUS = extractAssign(configSrc, 'SEARCH_DEMAND_STATUS');
var SERP_GAP_STATUS = extractAssign(configSrc, 'SERP_GAP_STATUS');
var OPPORTUNITY_CONFIDENCE = extractAssign(configSrc, 'OPPORTUNITY_CONFIDENCE');
var RESEARCH_TYPE = extractAssign(configSrc, 'RESEARCH_TYPE');
var RESEARCH_JOB_STATUS = extractAssign(configSrc, 'RESEARCH_JOB_STATUS');
var RESEARCH_JOB_STATUS_LABELS = extractAssign(configSrc, 'RESEARCH_JOB_STATUS_LABELS');
var RESEARCH_JOB_HEADERS = extractAssign(configSrc, 'RESEARCH_JOB_HEADERS');
var DEMAND_RADAR_HEADERS = extractAssign(configSrc, 'DEMAND_RADAR_HEADERS');
var SEARCH_SOURCES_REQUESTED = extractAssign(configSrc, 'SEARCH_SOURCES_REQUESTED');

var sandbox = {
  QUERY_BLIND_SPOT_TRIGGER: QUERY_BLIND_SPOT_TRIGGER,
  RADAR_SIGNAL_STATUS: RADAR_SIGNAL_STATUS,
  RADAR_STATUS: RADAR_STATUS,
  SEARCH_DEMAND_STATUS: SEARCH_DEMAND_STATUS,
  SERP_GAP_STATUS: SERP_GAP_STATUS,
  OPPORTUNITY_CONFIDENCE: OPPORTUNITY_CONFIDENCE,
  RESEARCH_TYPE: RESEARCH_TYPE,
  RESEARCH_JOB_STATUS: RESEARCH_JOB_STATUS,
  RESEARCH_JOB_STATUS_LABELS: RESEARCH_JOB_STATUS_LABELS,
  RESEARCH_JOB_HEADERS: RESEARCH_JOB_HEADERS,
  DEMAND_RADAR_HEADERS: DEMAND_RADAR_HEADERS,
  SEARCH_SOURCES_REQUESTED: SEARCH_SOURCES_REQUESTED,
  opportunityLabel_: function (map, key) {
    return (map && map[key]) || key || '';
  },
  Session: {
    getScriptTimeZone: function () {
      return 'UTC';
    }
  },
  Utilities: {
    formatDate: function (date, tz, fmt) {
      var d = new Date(date);
      function pad(n) {
        return n < 10 ? '0' + n : '' + n;
      }
      if (fmt === 'Z') return 'Z';
      if (fmt === 'yyyy-MM-dd') {
        return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
      }
      if (fmt.indexOf('yyyy-MM-dd') === 0) {
        return (
          d.getUTCFullYear() +
          '-' +
          pad(d.getUTCMonth() + 1) +
          '-' +
          pad(d.getUTCDate()) +
          'T' +
          pad(d.getUTCHours()) +
          ':' +
          pad(d.getUTCMinutes()) +
          ':' +
          pad(d.getUTCSeconds())
        );
      }
      return d.toISOString();
    }
  }
};

vm.createContext(sandbox);
vm.runInContext(researchSrc, sandbox);

assert(typeof sandbox.isSearchDemandEligible_ === 'function', 'missing isSearchDemandEligible_');
assert(typeof sandbox.buildSearchDemandJobContract_ === 'function', 'missing SEARCH contract');
assert(typeof sandbox.planSearchDemandJobs_ === 'function', 'missing planSearchDemandJobs_');
assert(typeof sandbox.isSearchDemandReadyJob_ === 'function', 'missing isSearchDemandReadyJob_');
assert(RESEARCH_TYPE.SEARCH_DEMAND === 'SEARCH_DEMAND', 'SEARCH_DEMAND type');
assert(
  RESEARCH_JOB_STATUS_LABELS.READY_FOR_SEARCH_RUNNER === '待搜索需求执行',
  'search runner zh label'
);
assert(
  !/addItem\('创建搜索需求任务', 'createSearchDemandJobs'\)/.test(codeSrc),
  'search demand menu is retired'
);
assert(!/createSearchDemandJobs/.test(codeSrc.slice(
  codeSrc.indexOf('function runDailyUnlocked_'),
  codeSrc.indexOf('function nextDailyPendingSites_')
)), 'runDaily does not create search jobs');

var RUN_DATE = '2026-08-18';
var GAME = 'Agefield High: Rock the School';
var SITE = 'Agefield High';
var RADAR_ID = 'agefield|/agefield-high-rock-the-school/classes/|QUERY_BLIND_SPOT';

function radar_(opts) {
  opts = opts || {};
  return {
    radar_id: opts.radar_id || RADAR_ID,
    site: opts.site || SITE,
    game: opts.game || GAME,
    anchor_page: opts.anchor_page || '/agefield-high-rock-the-school/classes/',
    trigger_type: opts.trigger_type || QUERY_BLIND_SPOT_TRIGGER,
    trigger_reason: 'Page 7D has search traffic but visible Query×Page coverage is low.',
    page_clicks7d: opts.page_clicks7d == null ? 11 : opts.page_clicks7d,
    page_impressions7d: opts.page_impressions7d == null ? 53 : opts.page_impressions7d,
    signal_status: opts.signal_status || RADAR_SIGNAL_STATUS.ACTIVE,
    radar_status: opts.radar_status || RADAR_STATUS.DISCOVERED,
    search_demand_status: opts.search_demand_status || SEARCH_DEMAND_STATUS.UNKNOWN,
    search_demand_job_id: opts.search_demand_job_id || '',
    research_job_id: opts.research_job_id || '',
    recent_found: opts.recent_found == null ? RUN_DATE : opts.recent_found,
    opportunity_confidence: opts.opportunity_confidence || OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY,
    cross_validated: opts.cross_validated || false
  };
}

function makeRadarSheetRow(radar) {
  var row = new Array(DEMAND_RADAR_HEADERS.length);
  for (var i = 0; i < row.length; i++) row[i] = '';
  var col = sandbox.headerIndexMap_(DEMAND_RADAR_HEADERS);
  row[col['雷达ID']] = radar.radar_id;
  row[col['最近发现']] = radar.recent_found;
  row[col['站点']] = radar.site;
  row[col['游戏']] = radar.game;
  row[col['锚点页面']] = radar.anchor_page;
  row[col['触发类型']] = radar.trigger_type;
  row[col['触发原因']] = radar.trigger_reason;
  row[col['页面点击7日']] = radar.page_clicks7d;
  row[col['页面曝光7日']] = radar.page_impressions7d;
  row[col['来源族']] = radar.source_families || 'GSC';
  row[col['独立来源族数']] = radar.family_count == null ? 1 : radar.family_count;
  row[col['交叉验证']] = radar.cross_validated || false;
  row[col['搜索需求状态']] = radar.search_demand_status;
  row[col['SERP缺口状态']] = SERP_GAP_STATUS.UNKNOWN;
  row[col['机会置信度']] = radar.opportunity_confidence;
  row[col['信号状态']] = radar.signal_status;
  row[col['雷达状态']] = radar.radar_status;
  row[col['研究任务ID']] = radar.research_job_id;
  row[col['搜索需求任务ID']] = radar.search_demand_job_id;
  return row;
}

function makeDiscoveryJobRow(jobId, radarId, cycleDate) {
  var row = new Array(RESEARCH_JOB_HEADERS.length);
  for (var i = 0; i < row.length; i++) row[i] = '';
  var col = sandbox.headerIndexMap_(RESEARCH_JOB_HEADERS);
  row[col['任务ID']] = jobId;
  row[col['研究类型']] = RESEARCH_TYPE.DEMAND_DISCOVERY;
  row[col['雷达ID']] = radarId;
  row[col['发现周期日期']] = cycleDate;
  row[col['任务状态']] = RESEARCH_JOB_STATUS_LABELS.READY_FOR_DISCOVERY_RUNNER;
  return row;
}

// Case 1: R2 ResearchJobID 非空，但 Search任务ID为空 → SEARCH_DEMAND eligible
var radar1 = radar_({
  research_job_id: 'demand-agefield-classes-20260817',
  radar_status: RADAR_STATUS.RESEARCH
});
assert(sandbox.isSearchDemandEligible_(radar1, { runDate: RUN_DATE }) === true, 'Case1 R2 job does not block SEARCH');
assert(sandbox.isDemandDiscoveryEligible_(radar1, { runDate: RUN_DATE }) === false, 'Case1 R2 still blocked by ResearchJobID');

var contract1 = sandbox.buildSearchDemandJobContract_(radar1, new Date('2026-08-18T00:00:00Z'), RUN_DATE);
assert(contract1.research_type === RESEARCH_TYPE.SEARCH_DEMAND, 'Case1 research_type');
assert(contract1.radar_id === RADAR_ID, 'Case1 radar_id');
assert(contract1.search_cycle_date === RUN_DATE, 'Case1 search_cycle_date');
assert(/-20260818$/.test(contract1.job_id), 'Case1 job_id ends with cycle');
assert(contract1.job_id.indexOf('search-') === 0, 'Case1 job_id search prefix');
assert(contract1.discovery_scope.page_topic === 'classes', 'Case1 page_topic');
assert(contract1.seed_terms[0] === GAME, 'Case1 seed game');
assert(contract1.seed_terms[1] === GAME + ' classes', 'Case1 seed game+topic');
assert(contract1.seed_terms.length <= 2, 'Case1 seed_terms not a keyword generator');
assert(
  contract1.search_sources_requested.join(',') ===
    'GOOGLE_AUTOCOMPLETE,GOOGLE_PAA,GOOGLE_RELATED,BING_AUTOCOMPLETE',
  'Case1 search sources requested'
);
['opportunity_level', 'recommended_action', 'source_query'].forEach(function (k) {
  assert(contract1[k] === undefined, 'forbidden field missing: ' + k);
});

// Case 2: Agefield WATCH + Search UNKNOWN → eligible
var radarWatch = radar_({
  radar_status: RADAR_STATUS.WATCH,
  research_job_id: 'demand-agefield-classes-20260817'
});
assert(sandbox.isSearchDemandEligible_(radarWatch, { runDate: RUN_DATE }) === true, 'Case2 Agefield WATCH eligible');
assert(
  sandbox.isSearchDemandEligible_(
    radar_({ radar_status: RADAR_STATUS.VALIDATED, research_job_id: 'x' }),
    { runDate: RUN_DATE }
  ) === true,
  'Case2b VALIDATED still eligible for SEARCH'
);

// Case 3: SearchDemandStatus CONFIRMED → 不 eligible
assert(
  sandbox.isSearchDemandEligible_(
    radar_({ search_demand_status: SEARCH_DEMAND_STATUS.CONFIRMED }),
    { runDate: RUN_DATE }
  ) === false,
  'Case3 CONFIRMED ineligible'
);
assert(
  sandbox.isSearchDemandEligible_(
    radar_({ search_demand_job_id: 'search-existing' }),
    { runDate: RUN_DATE }
  ) === false,
  'Case3b existing search job id ineligible'
);

var createdAt = new Date('2026-08-18T00:00:00Z');
var radarCol = sandbox.headerIndexMap_(DEMAND_RADAR_HEADERS);

// Case 4: 每 site/runDate 最多 1 job
var siteTwo = [
  makeRadarSheetRow(radar_({ radar_id: 'd1', page_clicks7d: 10, page_impressions7d: 10 })),
  makeRadarSheetRow(radar_({ radar_id: 'd2', page_clicks7d: 3, page_impressions7d: 9999 }))
];
var plan4 = sandbox.planSearchDemandJobs_(siteTwo, [], { runDate: RUN_DATE, createdAt: createdAt, nowTs: RUN_DATE });
assert(plan4.created === 1, 'Case4 one job per site');
assert(plan4.jobRowsToAppend.length === 1, 'Case4 one sheet row');
assert(plan4.jobRowsToAppend[0][0].indexOf('search-d1') === 0, 'Case4 higher clicks wins');
assert(String(plan4.radarRows[0][radarCol['搜索需求任务ID']] || '').indexOf('search-') === 0, 'Case4 best bound');
assert(String(plan4.radarRows[1][radarCol['搜索需求任务ID']] || '') === '', 'Case4 second radar unbound');
assert(plan4.radarRows[0][radarCol['研究任务ID']] === '', 'Case4 does not write R2 ResearchJobID');
assert(plan4.radarRows[0][radarCol['来源族']] === 'GSC', 'Case4 create does not add SEARCH family');
assert(plan4.radarRows[0][radarCol['搜索需求状态']] === SEARCH_DEMAND_STATUS.UNKNOWN, 'Case4 status stays UNKNOWN');
assert(plan4.radarRows[0][radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY, 'Case4 confidence unchanged');
assert(plan4.radarRows[0][radarCol['SERP缺口状态']] === SERP_GAP_STATUS.UNKNOWN, 'Case4 serp stays UNKNOWN');
assert(plan4.radarRows[0][radarCol['雷达状态']] === RADAR_STATUS.RESEARCH, 'Case4 DISCOVERED → RESEARCH');

var twoSites = [
  makeRadarSheetRow(radar_({ radar_id: 'a1', site: 'Agefield High', page_clicks7d: 5 })),
  makeRadarSheetRow(radar_({ radar_id: 'm1', site: 'Mortal Shell II', page_clicks7d: 8 }))
];
var plan4b = sandbox.planSearchDemandJobs_(twoSites, [], { runDate: RUN_DATE, createdAt: createdAt });
assert(plan4b.created === 2, 'Case4b one job per site across sites');

// Case 5: Radar + cycle dedupe
var radarRow5 = makeRadarSheetRow(radar_({ research_job_id: 'demand-old' }));
var existingSearch = sandbox.searchDemandResearchJobSheetRow_(
  sandbox.buildSearchDemandJobContract_(radar_(), createdAt, RUN_DATE),
  SITE,
  createdAt
);
var plan5 = sandbox.planSearchDemandJobs_([radarRow5], [existingSearch], {
  runDate: RUN_DATE,
  createdAt: createdAt
});
assert(plan5.created === 0, 'Case5 same radar+cycle does not create');
assert(plan5.skipped === 1, 'Case5 skipped');

var existingDiscovery = [makeDiscoveryJobRow('demand-old', RADAR_ID, RUN_DATE)];
var plan5b = sandbox.planSearchDemandJobs_([radarRow5], existingDiscovery, {
  runDate: RUN_DATE,
  createdAt: createdAt
});
assert(plan5b.created === 1, 'Case5b R2 DEMAND_DISCOVERY job does not block SEARCH job');
assert(plan5b.radarRows[0][radarCol['研究任务ID']] === 'demand-old', 'Case5b R2 job id preserved');
assert(String(plan5b.radarRows[0][radarCol['搜索需求任务ID']] || '').indexOf('search-') === 0, 'Case5b search job bound');

var validatedRow = makeRadarSheetRow(
  radar_({ radar_status: RADAR_STATUS.VALIDATED, research_job_id: 'demand-old' })
);
var plan5c = sandbox.planSearchDemandJobs_([validatedRow], [], {
  runDate: RUN_DATE,
  createdAt: createdAt
});
assert(plan5c.radarRows[0][radarCol['雷达状态']] === RADAR_STATUS.VALIDATED, 'Case5c VALIDATED not downgraded');

assert(
  sandbox.searchDemandDedupeKey_(RADAR_ID, RUN_DATE) ===
    sandbox.searchDemandDedupeKey_(RADAR_ID, '20260818'),
  'Case5d YYYYMMDD vs YYYY-MM-DD same key'
);

// Case 6: pendingSearchDemandJobs 只返回 SEARCH_DEMAND
var searchSheetRow = sandbox.searchDemandResearchJobSheetRow_(contract1, SITE, createdAt);
assert(searchSheetRow.length === RESEARCH_JOB_HEADERS.length, 'Case6 sheet row matches headers');
assert(
  searchSheetRow[RESEARCH_JOB_HEADERS.indexOf('任务状态')] === '待搜索需求执行',
  'Case6 status label'
);
assert(
  sandbox.isSearchDemandReadyJob_(searchSheetRow, sandbox.headerIndexMap_(RESEARCH_JOB_HEADERS)) ===
    true,
  'Case6 SEARCH ready'
);
assert(
  sandbox.isSearchDemandReadyJob_(existingSearch, sandbox.headerIndexMap_(RESEARCH_JOB_HEADERS)) ===
    true,
  'Case6 existing SEARCH ready'
);
assert(
  sandbox.isSearchDemandReadyJob_(
    makeDiscoveryJobRow('demand-old', RADAR_ID, RUN_DATE),
    sandbox.headerIndexMap_(RESEARCH_JOB_HEADERS)
  ) === false,
  'Case6 DEMAND_DISCOVERY excluded from search queue'
);

var pendingPayload = sandbox.searchDemandRowToApi_(
  searchSheetRow,
  sandbox.headerIndexMap_(RESEARCH_JOB_HEADERS)
);
assert(pendingPayload.research_type === RESEARCH_TYPE.SEARCH_DEMAND, 'Case6 payload type');
assert(pendingPayload.search_cycle_date === RUN_DATE, 'Case6 payload search_cycle_date');
assert(pendingPayload.opportunity_level === undefined, 'Case6 no opportunity_level');
assert(pendingPayload.source_query === undefined, 'Case6 no source_query');
assert(pendingPayload.discovery_cycle_date === undefined, 'Case6 no discovery_cycle_date');

var discoveryReady = sandbox.demandDiscoveryRowToApi_(
  makeDiscoveryJobRow('demand-old', RADAR_ID, RUN_DATE),
  sandbox.headerIndexMap_(RESEARCH_JOB_HEADERS)
);
assert(discoveryReady.research_type === RESEARCH_TYPE.DEMAND_DISCOVERY, 'Case6 discovery payload stays discovery');

assert(
  sandbox.isResearchJobPending_(RESEARCH_JOB_STATUS.READY_FOR_SEARCH_RUNNER) === false,
  'Case6 search runner not pendingResearchJobs'
);

assert(
  sandbox.isSearchDemandEligible_(
    Object.assign({}, radar1, { recent_found: new Date('2026-08-18T08:00:00+08:00') }),
    { runDate: RUN_DATE }
  ) === true,
  'Date object same day eligible'
);

console.log('PASS scripts/test-search-demand-jobs.js');
