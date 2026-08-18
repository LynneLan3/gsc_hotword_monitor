/**
 * R2C-A deterministic tests for DEMAND_DISCOVERY callback receiver.
 *
 * Run:
 *   node scripts/test-demand-discovery-callback.js
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function ' + name);
  var next = src.indexOf('\nfunction ', start + 1);
  return next >= 0 ? src.slice(start, next) : src.slice(start);
}

function extractAssign(src, name) {
  var m = src.match(new RegExp('var ' + name + '\\s*=\\s*([\\s\\S]*?);\\s*\\n(?:var |/\\*|function )'));
  assert(m, 'cannot parse ' + name);
  return eval('(' + m[1] + ')');
}

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var radarSrc = fs.readFileSync(path.join(root, 'DemandRadar.gs'), 'utf8');
var researchJobsSrc = fs.readFileSync(path.join(root, 'ResearchJobs.gs'), 'utf8');

var SOURCE_FAMILY = extractAssign(configSrc, 'SOURCE_FAMILY');
var SOURCE_FAMILY_ORDER = extractAssign(configSrc, 'SOURCE_FAMILY_ORDER');
var SOURCE_FAMILY_ALIASES = extractAssign(configSrc, 'SOURCE_FAMILY_ALIASES');
var RADAR_STATUS = extractAssign(configSrc, 'RADAR_STATUS');
var OPPORTUNITY_CONFIDENCE = extractAssign(configSrc, 'OPPORTUNITY_CONFIDENCE');
var RESEARCH_TYPE = extractAssign(configSrc, 'RESEARCH_TYPE');
var RESEARCH_JOB_STATUS = extractAssign(configSrc, 'RESEARCH_JOB_STATUS');
var RESEARCH_JOB_STATUS_LABELS = extractAssign(configSrc, 'RESEARCH_JOB_STATUS_LABELS');
var DEMAND_RADAR_HEADERS = extractAssign(configSrc, 'DEMAND_RADAR_HEADERS');
var RESEARCH_JOB_HEADERS = extractAssign(configSrc, 'RESEARCH_JOB_HEADERS');

function pad2_(n) {
  return n < 10 ? '0' + n : '' + n;
}

function formatYmdInTz_(date, tz) {
  var d = new Date(date);
  if (tz === 'Asia/Shanghai') {
    d = new Date(d.getTime() + 8 * 3600 * 1000);
    return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
  }
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}

// Provide minimal stubs used by helper functions / file load-time.
var sandbox = {
  SOURCE_FAMILY: SOURCE_FAMILY,
  SOURCE_FAMILY_ORDER: SOURCE_FAMILY_ORDER,
  SOURCE_FAMILY_ALIASES: SOURCE_FAMILY_ALIASES,
  RADAR_STATUS: RADAR_STATUS,
  OPPORTUNITY_CONFIDENCE: OPPORTUNITY_CONFIDENCE,
  RESEARCH_TYPE: RESEARCH_TYPE,
  RESEARCH_JOB_STATUS: RESEARCH_JOB_STATUS,
  RESEARCH_JOB_STATUS_LABELS: RESEARCH_JOB_STATUS_LABELS,
  DEMAND_RADAR_HEADERS: DEMAND_RADAR_HEADERS,
  RESEARCH_JOB_HEADERS: RESEARCH_JOB_HEADERS,
  Session: {
    getScriptTimeZone: function () {
      return 'Asia/Shanghai';
    }
  },
  Utilities: {
    formatDate: function (date, tz, fmt) {
      if (fmt === 'yyyy-MM-dd') return formatYmdInTz_(date, tz);
      var d = new Date(date);
      if (tz === 'Asia/Shanghai') d = new Date(d.getTime() + 8 * 3600 * 1000);
      if (fmt === 'Z') return 'Z';
      if (fmt && fmt.indexOf('yyyy-MM-dd') === 0) {
        return (
          d.getUTCFullYear() +
          '-' +
          pad2_(d.getUTCMonth() + 1) +
          '-' +
          pad2_(d.getUTCDate()) +
          'T' +
          pad2_(d.getUTCHours()) +
          ':' +
          pad2_(d.getUTCMinutes()) +
          ':' +
          pad2_(d.getUTCSeconds())
        );
      }
      return d.toISOString();
    }
  }
};

vm.createContext(sandbox);
vm.runInContext(radarSrc, sandbox);
vm.runInContext(researchJobsSrc, sandbox);

function makeCol(headers) {
  return sandbox.headerIndexMap_(headers);
}

function makeRadarRow(radarId, opts) {
  opts = opts || {};
  var row = new Array(DEMAND_RADAR_HEADERS.length);
  for (var i = 0; i < row.length; i++) row[i] = '';

  var col = makeCol(DEMAND_RADAR_HEADERS);
  row[col['雷达ID']] = radarId;
  row[col['来源族']] = opts.sourceFamilies || 'GSC';
  row[col['独立来源族数']] = opts.familyCount == null ? 1 : opts.familyCount;
  row[col['交叉验证']] = opts.crossValidated || false;
  row[col['机会置信度']] = opts.opportunityConfidence || OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY;
  row[col['雷达状态']] = opts.radarStatus || 'DISCOVERED';
  row[col['最近报告时间']] = opts.recentReportTime || '';
  // discovery summary columns
  if (col['发现状态'] !== undefined) row[col['发现状态']] = opts.discoveryStatus || '';
  if (col['外部来源族'] !== undefined) row[col['外部来源族']] = opts.externalSourceFamilies || '';
  if (col['外部证据数'] !== undefined) row[col['外部证据数']] = opts.anchorEvidenceCount || 0;
  if (col['发现主题'] !== undefined) row[col['发现主题']] = opts.discoveryThemes || '';
  if (col['代表问题'] !== undefined) row[col['代表问题']] = opts.representativeQuestions || '';
  if (col['研究结果路径'] !== undefined) row[col['研究结果路径']] = opts.resultPath || '';

  return row;
}

function makeJobRow(jobId, radarId, cycleDate, opts) {
  opts = opts || {};
  var row = new Array(RESEARCH_JOB_HEADERS.length);
  for (var i = 0; i < row.length; i++) row[i] = '';
  var col = makeCol(RESEARCH_JOB_HEADERS);
  row[col['任务ID']] = jobId;
  row[col['研究类型']] = RESEARCH_TYPE.DEMAND_DISCOVERY;
  row[col['雷达ID']] = radarId;
  row[col['发现周期日期']] = cycleDate;
  row[col['任务状态']] = opts.initialJobStatus || RESEARCH_JOB_STATUS_LABELS.READY_FOR_DISCOVERY_RUNNER;
  row[col['错误信息']] = opts.error || '';
  row[col['证据数量']] = opts.evidenceCount || '';
  row[col['结果路径']] = opts.resultPath || '';
  row[col['完成时间']] = opts.finishedAt || '';
  return row;
}

function discoveryPayload(opts) {
  opts = opts || {};
  return {
    token: 't',
    job_id: opts.jobId || 'job-1',
    research_type: RESEARCH_TYPE.DEMAND_DISCOVERY,
    radar_id: opts.radarId || 'radar-1',
    discovery_cycle_date: opts.cycleDate || '2026-08-18',
    execution_status: opts.executionStatus || 'COMPLETED',
    discovery_status: opts.discoveryStatus || 'NO_SIGNAL',
    discovery_scope: opts.discoveryScope || 'ANCHOR',
    anchor_evidence_count: opts.anchorEvidenceCount == null ? 0 : opts.anchorEvidenceCount,
    background_evidence_count: opts.backgroundEvidenceCount == null ? 0 : opts.backgroundEvidenceCount,
    external_source_families: opts.externalSourceFamilies || [],
    cross_validated_cluster_count: opts.crossValidatedClusterCount == null ? 0 : opts.crossValidatedClusterCount,
    top_clusters: opts.topClusters || [],
    result_path: opts.resultPath || 'jobs/job-1/result.json',
    error: opts.error || 'boom'
  };
}

var radarCol = makeCol(DEMAND_RADAR_HEADERS);
var jobCol = makeCol(RESEARCH_JOB_HEADERS);

var radarId = 'agefield|/agefield-high-rock-the-school/classes/|QUERY_BLIND_SPOT';
var jobId = 'demand-smoke';
var cycleDate = '2026-08-18';
var completedAt = new Date('2026-08-18T10:00:00+08:00');

// Case 1 — Agefield smoke: GSC only → NO_SIGNAL → RadarStatus WATCH (no family merge).
{
  var radarRow = makeRadarRow(radarId, {
    sourceFamilies: 'GSC',
    familyCount: 1,
    crossValidated: false,
    opportunityConfidence: OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY,
    radarStatus: 'DISCOVERED'
  });
  var payload = discoveryPayload({
    radarId: radarId,
    cycleDate: cycleDate,
    discoveryStatus: 'NO_SIGNAL',
    discoveryScope: 'ANCHOR',
    anchorEvidenceCount: 0,
    backgroundEvidenceCount: 14,
    externalSourceFamilies: [],
    topClusters: [],
    resultPath: 'jobs/..../demand_discovery_result.json'
  });

  var nextRadarRow = sandbox.applyDemandDiscoveryCallbackToDemandRadarRow_(
    radarRow,
    radarCol,
    payload,
    completedAt
  );
  assert(nextRadarRow[radarCol['来源族']] === 'GSC', 'case1 source families keep');
  assert(nextRadarRow[radarCol['独立来源族数']] === 1, 'case1 family count');
  assert(nextRadarRow[radarCol['交叉验证']] === false, 'case1 cross validated');
  assert(nextRadarRow[radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY, 'case1 confidence');
  assert(nextRadarRow[radarCol['雷达状态']] === RADAR_STATUS.WATCH, 'case1 radar status WATCH');
}

// Case 2 — GSC + COMMUNITY → DISCOVERED → RadarStatus VALIDATED, Confidence CROSS_VALIDATED.
{
  var radarRow = makeRadarRow(radarId, {
    sourceFamilies: 'GSC',
    familyCount: 1,
    crossValidated: false,
    opportunityConfidence: OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY,
    radarStatus: 'DISCOVERED'
  });
  var payload = discoveryPayload({
    radarId: radarId,
    cycleDate: cycleDate,
    discoveryStatus: 'DISCOVERED',
    discoveryScope: 'ANCHOR',
    anchorEvidenceCount: 5,
    externalSourceFamilies: ['COMMUNITY'],
    topClusters: [
      {
        cluster_id: 'c1',
        representative_signal: 'German class answers',
        representative_question: 'What are the German class answers?',
        evidence_count: 3,
        providers: ['reddit'],
        source_families: ['COMMUNITY'],
        independent_source_family_count: 1,
        cross_validated: false,
        example_urls: [],
        example_excerpts: []
      }
    ],
    resultPath: 'jobs/..../demand_discovery_result.json'
  });

  var nextRadarRow = sandbox.applyDemandDiscoveryCallbackToDemandRadarRow_(
    radarRow,
    radarCol,
    payload,
    completedAt
  );
  assert(nextRadarRow[radarCol['来源族']] === 'GSC,COMMUNITY', 'case2 merged families');
  assert(nextRadarRow[radarCol['独立来源族数']] === 2, 'case2 independent family count');
  assert(nextRadarRow[radarCol['交叉验证']] === true, 'case2 cross validated true');
  assert(nextRadarRow[radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.CROSS_VALIDATED, 'case2 confidence CROSS_VALIDATED');
  assert(nextRadarRow[radarCol['雷达状态']] === RADAR_STATUS.VALIDATED, 'case2 radar status VALIDATED');

  // discovery summary external families only.
  assert(nextRadarRow[radarCol['外部来源族']] === 'COMMUNITY', 'case2 external source families summary');
  assert(nextRadarRow[radarCol['外部证据数']] === 5, 'case2 external evidence count');
}

// Case 3 — GSC + VIDEO → DISCOVERED → CrossValidated=true.
{
  var radarRow = makeRadarRow(radarId, { radarStatus: 'DISCOVERED' });
  var payload = discoveryPayload({
    radarId: radarId,
    cycleDate: cycleDate,
    discoveryStatus: 'DISCOVERED',
    discoveryScope: 'ANCHOR',
    anchorEvidenceCount: 7,
    externalSourceFamilies: ['VIDEO']
  });
  var nextRadarRow = sandbox.applyDemandDiscoveryCallbackToDemandRadarRow_(
    radarRow,
    radarCol,
    payload,
    completedAt
  );
  assert(nextRadarRow[radarCol['来源族']] === 'GSC,VIDEO', 'case3 merged families');
  assert(nextRadarRow[radarCol['交叉验证']] === true, 'case3 cross validated true');
  assert(nextRadarRow[radarCol['雷达状态']] === RADAR_STATUS.VALIDATED, 'case3 radar VALIDATED');
}

// Case 4 — GSC + COMMUNITY + VIDEO → still CROSS_VALIDATED only (no upgrade beyond).
{
  var radarRow = makeRadarRow(radarId, { radarStatus: 'DISCOVERED' });
  var payload = discoveryPayload({
    radarId: radarId,
    cycleDate: cycleDate,
    discoveryStatus: 'CROSS_VALIDATED',
    discoveryScope: 'ANCHOR',
    anchorEvidenceCount: 9,
    externalSourceFamilies: ['COMMUNITY', 'VIDEO']
  });
  var nextRadarRow = sandbox.applyDemandDiscoveryCallbackToDemandRadarRow_(
    radarRow,
    radarCol,
    payload,
    completedAt
  );
  assert(nextRadarRow[radarCol['来源族']] === 'GSC,COMMUNITY,VIDEO', 'case4 merged families');
  assert(nextRadarRow[radarCol['独立来源族数']] === 3, 'case4 family count');
  assert(nextRadarRow[radarCol['交叉验证']] === true, 'case4 cross validated true');
  assert(nextRadarRow[radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.CROSS_VALIDATED, 'case4 confidence stays CROSS_VALIDATED');
  assert(nextRadarRow[radarCol['雷达状态']] === RADAR_STATUS.VALIDATED, 'case4 radar VALIDATED');
}

// Case 5 — discovery_status=DISCOVERED but external families only COMMUNITY: radar still cross validated due to GSC+COMMUNITY.
{
  var radarRow = makeRadarRow(radarId, { radarStatus: 'DISCOVERED' });
  var payload = discoveryPayload({
    radarId: radarId,
    cycleDate: cycleDate,
    discoveryStatus: 'DISCOVERED',
    discoveryScope: 'ANCHOR',
    anchorEvidenceCount: 2,
    externalSourceFamilies: ['COMMUNITY']
  });
  var nextRadarRow = sandbox.applyDemandDiscoveryCallbackToDemandRadarRow_(
    radarRow,
    radarCol,
    payload,
    completedAt
  );
  assert(nextRadarRow[radarCol['交叉验证']] === true, 'case5 cross validated true via union families');
  assert(nextRadarRow[radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.CROSS_VALIDATED, 'case5 confidence CROSS_VALIDATED');
}

// Case 6 — background families do not count: anchor=0 => external=[] => NO_SIGNAL keeps cross validated false.
{
  var radarRow = makeRadarRow(radarId, { radarStatus: 'DISCOVERED' });
  var payload = discoveryPayload({
    radarId: radarId,
    cycleDate: cycleDate,
    discoveryStatus: 'NO_SIGNAL',
    discoveryScope: 'ANCHOR',
    anchorEvidenceCount: 0,
    externalSourceFamilies: []
  });
  var nextRadarRow = sandbox.applyDemandDiscoveryCallbackToDemandRadarRow_(
    radarRow,
    radarCol,
    payload,
    completedAt
  );
  assert(nextRadarRow[radarCol['来源族']] === 'GSC', 'case6 families unchanged');
  assert(nextRadarRow[radarCol['交叉验证']] === false, 'case6 cross validated false');
  assert(nextRadarRow[radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY, 'case6 confidence DISCOVERY_ONLY');
}

// Case 7 — GAME_WIDE scope: do not union families, do not upgrade radar fields (only discovery summary fields may change).
{
  var radarRow = makeRadarRow(radarId, {
    sourceFamilies: 'GSC',
    familyCount: 1,
    crossValidated: false,
    opportunityConfidence: OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY,
    radarStatus: 'DISCOVERED'
  });
  var payload = discoveryPayload({
    radarId: radarId,
    cycleDate: cycleDate,
    discoveryStatus: 'DISCOVERED',
    discoveryScope: 'GAME_WIDE',
    anchorEvidenceCount: 10,
    externalSourceFamilies: ['COMMUNITY']
  });

  var nextRadarRow = sandbox.applyDemandDiscoveryCallbackToDemandRadarRow_(
    radarRow,
    radarCol,
    payload,
    completedAt
  );
  assert(nextRadarRow[radarCol['来源族']] === 'GSC', 'case7 families unchanged under GAME_WIDE');
  assert(nextRadarRow[radarCol['交叉验证']] === false, 'case7 cross validated unchanged');
  assert(nextRadarRow[radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY, 'case7 confidence unchanged');
  assert(nextRadarRow[radarCol['雷达状态']] === 'DISCOVERED', 'case7 radar status unchanged');
}

// Case 8 — repeated callback (idempotency): apply twice with same completedAt/payload should be stable.
{
  var radarRow = makeRadarRow(radarId, { radarStatus: 'DISCOVERED' });
  var payload = discoveryPayload({
    radarId: radarId,
    cycleDate: cycleDate,
    discoveryStatus: 'DISCOVERED',
    discoveryScope: 'ANCHOR',
    anchorEvidenceCount: 1,
    externalSourceFamilies: ['COMMUNITY'],
    topClusters: [
      {
        cluster_id: 'c1',
        representative_signal: 'X',
        representative_question: 'Y',
        evidence_count: 1,
        providers: ['reddit'],
        source_families: ['COMMUNITY'],
        independent_source_family_count: 1,
        cross_validated: false,
        example_urls: [],
        example_excerpts: []
      }
    ]
  });

  var r1 = sandbox.applyDemandDiscoveryCallbackToDemandRadarRow_(
    radarRow,
    radarCol,
    payload,
    completedAt
  );
  var r2 = sandbox.applyDemandDiscoveryCallbackToDemandRadarRow_(
    r1,
    radarCol,
    payload,
    completedAt
  );
  assert(
    JSON.stringify(r1) === JSON.stringify(r2),
    'case8 repeated callback stable'
  );
}

// Case 9 — identity mismatch: radar_id mismatch => validate fails.
{
  var jobRow = makeJobRow(jobId, radarId, cycleDate, {});
  var payload = discoveryPayload({
    jobId: jobId,
    radarId: 'mismatch-radar',
    cycleDate: cycleDate
  });
  var ok = sandbox.validateDemandDiscoveryJobIdentity_(jobRow, jobCol, payload);
  assert(ok.ok === false, 'case9 must reject');
  assert(ok.error === 'radar_id_mismatch', 'case9 radar_id_mismatch');
}

// Case 10 — identity mismatch: discovery_cycle_date mismatch => validate fails.
{
  var jobRow = makeJobRow(jobId, radarId, cycleDate, {});
  var payload = discoveryPayload({
    jobId: jobId,
    radarId: radarId,
    cycleDate: '2026-08-21'
  });
  var ok = sandbox.validateDemandDiscoveryJobIdentity_(jobRow, jobCol, payload);
  assert(ok.ok === false, 'case10 must reject');
  assert(ok.error === 'discovery_cycle_date_mismatch', 'case10 discovery_cycle_date_mismatch');
}

// Case 13 — Sheet cycle Date object 2026-08-18 vs payload "2026-08-18" => accepted.
{
  var sheetDate = new Date('2026-08-18T00:00:00+08:00');
  var jobRow = makeJobRow(jobId, radarId, sheetDate, {});
  var payload = discoveryPayload({
    jobId: jobId,
    radarId: radarId,
    cycleDate: '2026-08-18'
  });
  var ok = sandbox.validateDemandDiscoveryJobIdentity_(jobRow, jobCol, payload);
  assert(ok.ok === true, 'case13 Date vs YYYY-MM-DD must accept');
}

// Case 14 — Sheet cycle string 2026-08-18 vs payload "2026-08-18" => accepted.
{
  var jobRow = makeJobRow(jobId, radarId, '2026-08-18', {});
  var payload = discoveryPayload({
    jobId: jobId,
    radarId: radarId,
    cycleDate: '2026-08-18'
  });
  var ok = sandbox.validateDemandDiscoveryJobIdentity_(jobRow, jobCol, payload);
  assert(ok.ok === true, 'case14 string vs string must accept');
}

// Case 15 — Sheet cycle 2026-08-17 vs payload "2026-08-18" => discovery_cycle_date_mismatch.
{
  var jobRow = makeJobRow(jobId, radarId, new Date('2026-08-17T00:00:00+08:00'), {});
  var payload = discoveryPayload({
    jobId: jobId,
    radarId: radarId,
    cycleDate: '2026-08-18'
  });
  var ok = sandbox.validateDemandDiscoveryJobIdentity_(jobRow, jobCol, payload);
  assert(ok.ok === false, 'case15 different dates must reject');
  assert(ok.error === 'discovery_cycle_date_mismatch', 'case15 discovery_cycle_date_mismatch');
}

// Case 11 — FAILED: update research job only, radar unaffected.
{
  var jobRow = makeJobRow(jobId, radarId, cycleDate, {});
  var payload = discoveryPayload({
    jobId: jobId,
    radarId: radarId,
    cycleDate: cycleDate,
    executionStatus: 'FAILED',
    error: 'network'
  });
  var nextJobRow = sandbox.applyDemandDiscoveryCallbackToResearchJobRow_(
    jobRow,
    jobCol,
    payload,
    completedAt
  );
  assert(
    nextJobRow[jobCol['任务状态']] === RESEARCH_JOB_STATUS_LABELS[RESEARCH_JOB_STATUS.FAILED],
    'case11 job status FAILED'
  );
  assert(nextJobRow[jobCol['错误信息']] === 'network', 'case11 error written');
}

// Case 12 — already VALIDATED then NO_SIGNAL must not downgrade.
{
  var radarRow = makeRadarRow(radarId, {
    sourceFamilies: 'GSC,COMMUNITY',
    familyCount: 2,
    crossValidated: true,
    opportunityConfidence: OPPORTUNITY_CONFIDENCE.CROSS_VALIDATED,
    radarStatus: RADAR_STATUS.VALIDATED
  });
  var payload = discoveryPayload({
    radarId: radarId,
    cycleDate: cycleDate,
    discoveryStatus: 'NO_SIGNAL',
    discoveryScope: 'ANCHOR',
    anchorEvidenceCount: 0,
    externalSourceFamilies: []
  });
  var nextRadarRow = sandbox.applyDemandDiscoveryCallbackToDemandRadarRow_(
    radarRow,
    radarCol,
    payload,
    completedAt
  );
  assert(nextRadarRow[radarCol['雷达状态']] === RADAR_STATUS.VALIDATED, 'case12 radar stays VALIDATED');
  assert(nextRadarRow[radarCol['交叉验证']] === true, 'case12 cross validated remains true');
  assert(nextRadarRow[radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.CROSS_VALIDATED, 'case12 confidence remains CROSS_VALIDATED');
}

console.log('PASS scripts/test-demand-discovery-callback.js');

