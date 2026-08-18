/**
 * R2A 本地纯逻辑验证：Demand Radar → DEMAND_DISCOVERY Job Contract
 * 运行：node scripts/test-demand-discovery-jobs.js
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

// Constants from Config.gs
var QUERY_BLIND_SPOT_TRIGGER = extractAssign(configSrc, 'QUERY_BLIND_SPOT_TRIGGER');
var RADAR_SIGNAL_STATUS = extractAssign(configSrc, 'RADAR_SIGNAL_STATUS');
var RADAR_STATUS = extractAssign(configSrc, 'RADAR_STATUS');
var OPPORTUNITY_CONFIDENCE = extractAssign(configSrc, 'OPPORTUNITY_CONFIDENCE');
var RESEARCH_TYPE = extractAssign(configSrc, 'RESEARCH_TYPE');
var RESEARCH_JOB_STATUS = extractAssign(configSrc, 'RESEARCH_JOB_STATUS');
var RESEARCH_JOB_STATUS_LABELS = extractAssign(configSrc, 'RESEARCH_JOB_STATUS_LABELS');
var RESEARCH_JOB_HEADERS = extractAssign(configSrc, 'RESEARCH_JOB_HEADERS');

// Sandbox stubs for Apps Script-only helpers used by toIso8601_()
var sandbox = {
  QUERY_BLIND_SPOT_TRIGGER: QUERY_BLIND_SPOT_TRIGGER,
  RADAR_SIGNAL_STATUS: RADAR_SIGNAL_STATUS,
  RADAR_STATUS: RADAR_STATUS,
  OPPORTUNITY_CONFIDENCE: OPPORTUNITY_CONFIDENCE,
  RESEARCH_TYPE: RESEARCH_TYPE,
  RESEARCH_JOB_STATUS: RESEARCH_JOB_STATUS,
  RESEARCH_JOB_STATUS_LABELS: RESEARCH_JOB_STATUS_LABELS,
  RESEARCH_JOB_HEADERS: RESEARCH_JOB_HEADERS,
  opportunityLabel_: function (map, key) {
    return (map && map[key]) || key || '';
  },

  // Minimal stubs to support toIso8601_() conversion
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
      // "yyyy-MM-dd'T'HH:mm:ss"
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

assert(typeof sandbox.isDemandDiscoveryEligible_ === 'function', 'missing isDemandDiscoveryEligible_');
assert(
  typeof sandbox.buildDemandDiscoveryJobContract_ === 'function',
  'missing buildDemandDiscoveryJobContract_'
);
assert(typeof sandbox.chooseBestDemandDiscoveryRadarForSite_ === 'function', 'missing chooseBestDemandDiscoveryRadarForSite_');
assert(typeof sandbox.buildDemandDiscoveryJobId_ === 'function', 'missing buildDemandDiscoveryJobId_');
assert(typeof sandbox.demandDiscoveryDedupeKey_ === 'function', 'missing demandDiscoveryDedupeKey_');
assert(typeof sandbox.demandDiscoveryRowToApi_ === 'function', 'missing demandDiscoveryRowToApi_');
assert(typeof sandbox.parseDemandDiscoveryPageTopicFromAnchorPage_ === 'function', 'missing page topic extractor');
assert(typeof sandbox.isResearchJobPending_ === 'function', 'missing isResearchJobPending_');

var RUN_DATE = '2026-08-18';
var GAME = 'Agefield High: Rock the School';
var SITE = 'Agefield High';

// Case 1: ACTIVE + DISCOVERED + DISCOVERY_ONLY + CrossValidated=false → create 1 DEMAND_DISCOVERY Job
var radar1 = {
  radar_id: 'agefield|/agefield-high-rock-the-school/classes/|QUERY_BLIND_SPOT',
  site: SITE,
  game: GAME,
  anchor_page: '/agefield-high-rock-the-school/classes/',
  trigger_type: QUERY_BLIND_SPOT_TRIGGER,
  source_signal_summary: 'Page 7D has search traffic but visible Query×Page coverage is low.',
  trigger_reason: 'Page 7D has search traffic but visible Query×Page coverage is low.',
  page_clicks7d: 10,
  page_impressions7d: 1000,
  opportunity_confidence: OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY,
  cross_validated: false,
  signal_status: RADAR_SIGNAL_STATUS.ACTIVE,
  radar_status: RADAR_STATUS.DISCOVERED,
  research_job_id: '',
  recent_found: RUN_DATE
};

assert(sandbox.isDemandDiscoveryEligible_(radar1, { runDate: RUN_DATE }) === true, 'Case1 eligible');

var created = new Date('2026-08-18T00:00:00Z');
var contract1 = sandbox.buildDemandDiscoveryJobContract_(radar1, created, RUN_DATE);
assert(contract1.research_type === RESEARCH_TYPE.DEMAND_DISCOVERY, 'Case1 research_type');
assert(contract1.radar_id === radar1.radar_id, 'Case1 radar_id');
assert(contract1.trigger_type === QUERY_BLIND_SPOT_TRIGGER, 'Case1 trigger_type');
assert(contract1.anchor_page === radar1.anchor_page, 'Case1 anchor_page');
assert(contract1.discovery_cycle_date === RUN_DATE, 'Case1 discovery_cycle_date');
assert(/-20260818$/.test(contract1.job_id), 'Case1 job_id ends with cycle YYYYMMDD');
assert(contract1.job_id.indexOf(':') < 0, 'Case1 job_id has no time-of-day');
assert(contract1.discovery_scope && contract1.discovery_scope.page_topic === 'classes', 'Case1 page_topic');
assert(contract1.seed_terms.length <= 5, 'Case1 seed_terms <=5');
assert(contract1.seed_terms[0] === GAME, 'Case1 seed_terms[0] game');
assert(contract1.seed_terms[1] === GAME + ' classes', 'Case1 seed_terms[1] game+topic');
assert(
  Array.isArray(contract1.source_families_requested) && contract1.source_families_requested.join(',') === 'COMMUNITY,VIDEO',
  'Case1 fixed source families'
);

// Case 7: payload must not include forbidden content-opportunity fields
['opportunity_level', 'recommended_action', 'source_query'].forEach(function (k) {
  assert(contract1[k] === undefined, 'forbidden field missing: ' + k);
});

// Case 2: same radar again (research_job_id now exists) → Eligibility 仍拦截；本阶段不自动重跑
var radar1Dup = Object.assign({}, radar1, {
  research_job_id: sandbox.buildDemandDiscoveryJobId_(radar1.radar_id, RUN_DATE)
});
assert(sandbox.isDemandDiscoveryEligible_(radar1Dup, { runDate: RUN_DATE }) === false, 'Case2 ResearchJobID ineligible');

// Case A: 同 Radar + 同 cycle → 同 JobID / 同 dedupe key
var contractA1 = sandbox.buildDemandDiscoveryJobContract_(radar1, created, RUN_DATE);
var contractA2 = sandbox.buildDemandDiscoveryJobContract_(radar1, new Date('2026-08-18T23:59:59Z'), RUN_DATE);
assert(contractA1.job_id === contractA2.job_id, 'CaseA same cycle same JobID');
assert(contractA1.discovery_cycle_date === contractA2.discovery_cycle_date, 'CaseA same cycle date');
assert(
  sandbox.demandDiscoveryDedupeKey_(radar1.radar_id, RUN_DATE) ===
    sandbox.demandDiscoveryDedupeKey_(radar1.radar_id, '20260818'),
  'CaseA dedupe key ignores YYYYMMDD vs YYYY-MM-DD'
);

// Case B: 同 Radar + 不同 cycle → 不同 JobID（仅验证 contract，不绕过 Eligibility 自动创建）
var contractB = sandbox.buildDemandDiscoveryJobContract_(radar1, created, '2026-08-21');
assert(contractB.job_id !== contractA1.job_id, 'CaseB different cycle different JobID');
assert(contractB.discovery_cycle_date === '2026-08-21', 'CaseB cycle date 2026-08-21');
assert(/-20260821$/.test(contractB.job_id), 'CaseB job_id ends with 20260821');
assert(
  sandbox.demandDiscoveryDedupeKey_(radar1.radar_id, RUN_DATE) !==
    sandbox.demandDiscoveryDedupeKey_(radar1.radar_id, '2026-08-21'),
  'CaseB different cycle different dedupe key'
);
assert(
  sandbox.isDemandDiscoveryEligible_(radar1Dup, { runDate: '2026-08-21' }) === false,
  'CaseB Eligibility still blocked while ResearchJobID is set'
);

// Case C: pendingDemandDiscoveryJobs payload includes discovery_cycle_date
var sheetRow = sandbox.demandDiscoveryResearchJobSheetRow_(contractA1, SITE, created);
assert(sheetRow.length === RESEARCH_JOB_HEADERS.length, 'CaseC sheet row matches headers');
assert(sheetRow[RESEARCH_JOB_HEADERS.indexOf('发现周期日期')] === RUN_DATE, 'CaseC sheet stores cycle date');
var payload = sandbox.demandDiscoveryRowToApi_(sheetRow, sandbox.headerIndexMap_(RESEARCH_JOB_HEADERS));
assert(payload.job_id === contractA1.job_id, 'CaseC payload job_id');
assert(payload.research_type === RESEARCH_TYPE.DEMAND_DISCOVERY, 'CaseC payload research_type');
assert(payload.radar_id === radar1.radar_id, 'CaseC payload radar_id');
assert(payload.discovery_cycle_date === RUN_DATE, 'CaseC payload discovery_cycle_date');
assert(payload.opportunity_level === undefined, 'CaseC payload has no opportunity_level');
assert(payload.source_query === undefined, 'CaseC payload has no source_query');

// Case 3: same site two radars → only best clicks then impressions
var radarA = Object.assign({}, radar1, {
  radar_id: 'd1',
  page_clicks7d: 10,
  page_impressions7d: 10
});
var radarB = Object.assign({}, radar1, {
  radar_id: 'd2',
  page_clicks7d: 3,
  page_impressions7d: 9999
});
var best = sandbox.chooseBestDemandDiscoveryRadarForSite_([radarA, radarB]);
assert(best.radar_id === 'd1', 'Case3 choose higher PageClicks7D');

// Case 4: ResearchJobID already exists → not eligible
var radar4 = Object.assign({}, radar1, { research_job_id: 'any-existing-job' });
assert(sandbox.isDemandDiscoveryEligible_(radar4, { runDate: RUN_DATE }) === false, 'Case4 ResearchJobID exists');

// Case 5: CrossValidated=true → not eligible
var radar5 = Object.assign({}, radar1, { cross_validated: true });
assert(sandbox.isDemandDiscoveryEligible_(radar5, { runDate: RUN_DATE }) === false, 'Case5 CrossValidated true');

// Case 6: SignalStatus=RESOLVED → not eligible
var radar6 = Object.assign({}, radar1, { signal_status: RADAR_SIGNAL_STATUS.RESOLVED });
assert(sandbox.isDemandDiscoveryEligible_(radar6, { runDate: RUN_DATE }) === false, 'Case6 SignalStatus RESOLVED');

// Case 8/9: old content opportunity / asset research contract not affected:
// researchJobRowToApi_ must still not output research_type key.
var start = researchSrc.indexOf('function researchJobRowToApi_');
var end = researchSrc.indexOf('function safeJsonParse_', start);
assert(start >= 0 && end > start, 'cannot locate researchJobRowToApi_/createResearchJobs segment');
var seg = researchSrc.slice(start, end);
assert(!/research_type\\s*:/.test(seg), 'Case8/9 pendingResearchJobs payload still omits research_type property');
assert(!/discovery_cycle_date/.test(seg), 'CaseD old pending payload has no discovery_cycle_date');
assert(researchSrc.indexOf('function researchJobSheetRow_') >= 0, 'CaseD content research sheet writer remains');

// Case 10: scheduler compatibility — old pendingResearchJobs only consumes PENDING/待处理
assert(
  sandbox.isResearchJobPending_(RESEARCH_JOB_STATUS.PENDING) === true,
  'Case10 PENDING enum is pending'
);
var readyLabel = RESEARCH_JOB_STATUS_LABELS.READY_FOR_DISCOVERY_RUNNER;
assert(
  sandbox.isResearchJobPending_(readyLabel) === false,
  'Case10 READY_FOR_DISCOVERY_RUNNER label is NOT pending'
);
assert(
  sandbox.isResearchJobPending_(RESEARCH_JOB_STATUS.READY_FOR_DISCOVERY_RUNNER) === false,
  'Case10 READY_FOR_DISCOVERY_RUNNER enum is NOT pending'
);

console.log('PASS scripts/test-demand-discovery-jobs.js');

