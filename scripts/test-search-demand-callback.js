/**
 * R3A SEARCH_DEMAND callback receiver tests.
 * 运行：node scripts/test-search-demand-callback.js
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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
var SEARCH_DEMAND_STATUS = extractAssign(configSrc, 'SEARCH_DEMAND_STATUS');
var SERP_GAP_STATUS = extractAssign(configSrc, 'SERP_GAP_STATUS');
var OPPORTUNITY_CONFIDENCE = extractAssign(configSrc, 'OPPORTUNITY_CONFIDENCE');
var RESEARCH_TYPE = extractAssign(configSrc, 'RESEARCH_TYPE');
var RESEARCH_JOB_STATUS = extractAssign(configSrc, 'RESEARCH_JOB_STATUS');
var RESEARCH_JOB_STATUS_LABELS = extractAssign(configSrc, 'RESEARCH_JOB_STATUS_LABELS');
var DEMAND_RADAR_HEADERS = extractAssign(configSrc, 'DEMAND_RADAR_HEADERS');
var RESEARCH_JOB_HEADERS = extractAssign(configSrc, 'RESEARCH_JOB_HEADERS');
var SEARCH_SOURCES_REQUESTED = extractAssign(configSrc, 'SEARCH_SOURCES_REQUESTED');

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

var sandbox = {
  SOURCE_FAMILY: SOURCE_FAMILY,
  SOURCE_FAMILY_ORDER: SOURCE_FAMILY_ORDER,
  SOURCE_FAMILY_ALIASES: SOURCE_FAMILY_ALIASES,
  RADAR_STATUS: RADAR_STATUS,
  SEARCH_DEMAND_STATUS: SEARCH_DEMAND_STATUS,
  SERP_GAP_STATUS: SERP_GAP_STATUS,
  OPPORTUNITY_CONFIDENCE: OPPORTUNITY_CONFIDENCE,
  RESEARCH_TYPE: RESEARCH_TYPE,
  RESEARCH_JOB_STATUS: RESEARCH_JOB_STATUS,
  RESEARCH_JOB_STATUS_LABELS: RESEARCH_JOB_STATUS_LABELS,
  DEMAND_RADAR_HEADERS: DEMAND_RADAR_HEADERS,
  RESEARCH_JOB_HEADERS: RESEARCH_JOB_HEADERS,
  SEARCH_SOURCES_REQUESTED: SEARCH_SOURCES_REQUESTED,
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
  row[col['搜索需求状态']] = opts.searchDemandStatus || SEARCH_DEMAND_STATUS.UNKNOWN;
  row[col['SERP缺口状态']] = opts.serpGapStatus || SERP_GAP_STATUS.UNKNOWN;
  row[col['机会置信度']] = opts.opportunityConfidence || OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY;
  row[col['雷达状态']] = opts.radarStatus || 'DISCOVERED';
  row[col['研究任务ID']] = opts.researchJobId || 'demand-existing';
  row[col['搜索需求任务ID']] = opts.searchDemandJobId || 'search-job-1';
  return row;
}

function makeJobRow(jobId, radarId, cycleDate, opts) {
  opts = opts || {};
  var row = new Array(RESEARCH_JOB_HEADERS.length);
  for (var i = 0; i < row.length; i++) row[i] = '';
  var col = makeCol(RESEARCH_JOB_HEADERS);
  row[col['任务ID']] = jobId;
  row[col['研究类型']] = opts.researchType || RESEARCH_TYPE.SEARCH_DEMAND;
  row[col['雷达ID']] = radarId;
  row[col['发现周期日期']] = cycleDate;
  row[col['任务状态']] = opts.initialJobStatus || RESEARCH_JOB_STATUS_LABELS.READY_FOR_SEARCH_RUNNER;
  return row;
}

function searchPayload(opts) {
  opts = opts || {};
  return {
    token: 't',
    job_id: opts.jobId || 'search-job-1',
    research_type: RESEARCH_TYPE.SEARCH_DEMAND,
    radar_id: opts.radarId || 'radar-1',
    search_cycle_date: opts.cycleDate || '2026-08-18',
    execution_status: opts.executionStatus || 'COMPLETED',
    search_demand_status: opts.searchDemandStatus || SEARCH_DEMAND_STATUS.CONFIRMED,
    discovery_scope: opts.discoveryScope || 'ANCHOR',
    search_evidence_count: opts.searchEvidenceCount == null ? 3 : opts.searchEvidenceCount,
    search_sources: opts.searchSources || ['GOOGLE_AUTOCOMPLETE', 'BING_AUTOCOMPLETE'],
    matched_queries: opts.matchedQueries || ['agefield high classes', 'agefield high classes'],
    top_questions: opts.topQuestions || ['what are the classes?'],
    result_path: opts.resultPath || 'jobs/search-job-1/result.json',
    error: opts.error || 'boom'
  };
}

var radarCol = makeCol(DEMAND_RADAR_HEADERS);
var jobCol = makeCol(RESEARCH_JOB_HEADERS);
var radarId = 'agefield|/agefield-high-rock-the-school/classes/|QUERY_BLIND_SPOT';
var jobId = 'search-smoke';
var cycleDate = '2026-08-18';
var completedAt = new Date('2026-08-18T10:00:00+08:00');

function applyRadar(radarRow, payload) {
  return sandbox.applySearchDemandCallbackToDemandRadarRow_(radarRow, radarCol, payload, completedAt);
}

function applyJob(jobRow, payload) {
  return sandbox.applySearchDemandCallbackToResearchJobRow_(jobRow, jobCol, payload, completedAt);
}

// Case 7 — GSC + SEARCH → count2 / cross true / SEARCH_CONFIRMED / VALIDATED
{
  var radarRow = makeRadarRow(radarId, {
    sourceFamilies: 'GSC',
    familyCount: 1,
    crossValidated: false,
    opportunityConfidence: OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY,
    radarStatus: 'RESEARCH'
  });
  var payload = searchPayload({
    radarId: radarId,
    searchDemandStatus: SEARCH_DEMAND_STATUS.CONFIRMED,
    searchSources: ['GOOGLE_AUTOCOMPLETE', 'GOOGLE_PAA', 'BING_AUTOCOMPLETE']
  });
  var next = applyRadar(radarRow, payload);
  assert(next[radarCol['来源族']] === 'GSC,SEARCH', 'case7 families GSC,SEARCH');
  assert(next[radarCol['独立来源族数']] === 2, 'case7 count 2');
  assert(next[radarCol['交叉验证']] === true, 'case7 cross true');
  assert(next[radarCol['搜索需求状态']] === SEARCH_DEMAND_STATUS.CONFIRMED, 'case7 search CONFIRMED');
  assert(next[radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.SEARCH_CONFIRMED, 'case7 SEARCH_CONFIRMED');
  assert(next[radarCol['雷达状态']] === RADAR_STATUS.VALIDATED, 'case7 VALIDATED');
  assert(next[radarCol['SERP缺口状态']] === SERP_GAP_STATUS.UNKNOWN, 'case7 serp UNKNOWN');
  assert(next[radarCol['机会置信度']] !== OPPORTUNITY_CONFIDENCE.OPPORTUNITY_VALIDATED, 'case7 not OPPORTUNITY_VALIDATED');
  assert(next[radarCol['研究任务ID']] === 'demand-existing', 'case7 R2 job id untouched');

  var nextJob = applyJob(makeJobRow(jobId, radarId, cycleDate), payload);
  assert(
    nextJob[jobCol['任务状态']] === RESEARCH_JOB_STATUS_LABELS.SEARCH_CONFIRMED,
    'case7 job 搜索需求已确认'
  );
  assert(nextJob[jobCol['任务状态']] === '搜索需求已确认', 'case7 job zh label');
  var summary = JSON.parse(nextJob[jobCol['研究结果']]);
  assert(summary.matched_queries.length === 1, 'case7 matched queries deduped');
}

// Case 8 — GSC|COMMUNITY + SEARCH → count3 / SEARCH_CONFIRMED / 不重复 COMMUNITY
{
  var radarRow = makeRadarRow(radarId, {
    sourceFamilies: 'GSC,COMMUNITY',
    familyCount: 2,
    crossValidated: true,
    opportunityConfidence: OPPORTUNITY_CONFIDENCE.CROSS_VALIDATED,
    radarStatus: RADAR_STATUS.VALIDATED
  });
  var payload = searchPayload({
    radarId: radarId,
    searchSources: ['GOOGLE_AUTOCOMPLETE', 'COMMUNITY', 'BING_AUTOCOMPLETE']
  });
  var next = applyRadar(radarRow, payload);
  assert(next[radarCol['来源族']] === 'GSC,SEARCH,COMMUNITY', 'case8 ordered families');
  assert(next[radarCol['独立来源族数']] === 3, 'case8 count 3');
  assert(next[radarCol['交叉验证']] === true, 'case8 cross stays true');
  assert(next[radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.SEARCH_CONFIRMED, 'case8 upgrades to SEARCH_CONFIRMED');
  assert(next[radarCol['搜索需求状态']] === SEARCH_DEMAND_STATUS.CONFIRMED, 'case8 confirmed');
  assert(String(next[radarCol['来源族']]).split(',').filter(function (x) {
    return x === 'COMMUNITY';
  }).length === 1, 'case8 community not duplicated');
}

// Case 9 — NO_SIGNAL 不删除已有 family
{
  var radarRow = makeRadarRow(radarId, {
    sourceFamilies: 'GSC,COMMUNITY',
    familyCount: 2,
    crossValidated: true,
    opportunityConfidence: OPPORTUNITY_CONFIDENCE.CROSS_VALIDATED,
    radarStatus: RADAR_STATUS.VALIDATED
  });
  var payload = searchPayload({
    radarId: radarId,
    searchDemandStatus: SEARCH_DEMAND_STATUS.NO_SIGNAL,
    searchEvidenceCount: 0,
    searchSources: []
  });
  var next = applyRadar(radarRow, payload);
  assert(next[radarCol['来源族']] === 'GSC,COMMUNITY', 'case9 families kept');
  assert(next[radarCol['独立来源族数']] === 2, 'case9 count kept');
  assert(next[radarCol['交叉验证']] === true, 'case9 cross not lowered');
  assert(next[radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.CROSS_VALIDATED, 'case9 confidence not lowered');
  assert(next[radarCol['雷达状态']] === RADAR_STATUS.VALIDATED, 'case9 VALIDATED kept');
  assert(next[radarCol['搜索需求状态']] === SEARCH_DEMAND_STATUS.NO_SIGNAL, 'case9 NO_SIGNAL');
  assert(next[radarCol['SERP缺口状态']] === SERP_GAP_STATUS.UNKNOWN, 'case9 serp UNKNOWN');

  var gscOnly = applyRadar(
    makeRadarRow(radarId, { radarStatus: 'RESEARCH' }),
    payload
  );
  assert(gscOnly[radarCol['来源族']] === 'GSC', 'case9b GSC kept');
  assert(gscOnly[radarCol['雷达状态']] === RADAR_STATUS.WATCH, 'case9b no higher result → WATCH');
  assert(gscOnly[radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY, 'case9b confidence kept');
  var noSignalJob = applyJob(makeJobRow(jobId, radarId, cycleDate), payload);
  assert(
    noSignalJob[jobCol['任务状态']] === RESEARCH_JOB_STATUS_LABELS.SEARCH_NO_SIGNAL,
    'case9 job 搜索需求无有效信号'
  );
  assert(noSignalJob[jobCol['任务状态']] === '搜索需求无有效信号', 'case9 job zh label');
}

// Case 10 — GAME_WIDE evidence 不升级 Search
{
  var radarRow = makeRadarRow(radarId, { radarStatus: 'RESEARCH' });
  var payload = searchPayload({
    radarId: radarId,
    discoveryScope: 'GAME_WIDE',
    searchDemandStatus: SEARCH_DEMAND_STATUS.CONFIRMED,
    searchEvidenceCount: 8
  });
  var next = applyRadar(radarRow, payload);
  assert(next[radarCol['来源族']] === 'GSC', 'case10 no SEARCH family');
  assert(next[radarCol['搜索需求状态']] === SEARCH_DEMAND_STATUS.UNKNOWN, 'case10 not CONFIRMED');
  assert(next[radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY, 'case10 confidence unchanged');
  assert(next[radarCol['雷达状态']] === 'RESEARCH', 'case10 radar status unchanged');
  assert(next[radarCol['SERP缺口状态']] === SERP_GAP_STATUS.UNKNOWN, 'case10 serp UNKNOWN');

  var nextJob = applyJob(makeJobRow(jobId, radarId, cycleDate), payload);
  var summary = JSON.parse(nextJob[jobCol['研究结果']]);
  assert(summary.discovery_scope === 'GAME_WIDE', 'case10 job may save GAME_WIDE summary');
  assert(
    nextJob[jobCol['任务状态']] === RESEARCH_JOB_STATUS_LABELS.SEARCH_CONFIRMED,
    'case10 GAME_WIDE job can complete as SEARCH_CONFIRMED'
  );
}

// Case 10b — GAME_WIDE + NO_SIGNAL must not change Anchor SearchDemandStatus
{
  var radarRow = makeRadarRow(radarId, {
    searchDemandStatus: SEARCH_DEMAND_STATUS.UNKNOWN,
    radarStatus: 'RESEARCH'
  });
  var payload = searchPayload({
    radarId: radarId,
    discoveryScope: 'GAME_WIDE',
    searchDemandStatus: SEARCH_DEMAND_STATUS.NO_SIGNAL,
    searchEvidenceCount: 0,
    searchSources: []
  });
  var next = applyRadar(radarRow, payload);
  assert(next[radarCol['搜索需求状态']] === SEARCH_DEMAND_STATUS.UNKNOWN, 'case10b SearchDemandStatus stays UNKNOWN');
  assert(next[radarCol['来源族']] === 'GSC', 'case10b no SEARCH family');
  assert(next[radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY, 'case10b confidence unchanged');
  assert(next[radarCol['雷达状态']] === 'RESEARCH', 'case10b radar status unchanged');
  assert(next[radarCol['交叉验证']] === false, 'case10b cross unchanged');

  var nextJob = applyJob(makeJobRow(jobId, radarId, cycleDate), payload);
  assert(
    nextJob[jobCol['任务状态']] === RESEARCH_JOB_STATUS_LABELS.SEARCH_NO_SIGNAL,
    'case10b GAME_WIDE job can complete as SEARCH_NO_SIGNAL'
  );
}

// Case A — ANCHOR + CONFIRMED + evidence=3 + GOOGLE_AUTOCOMPLETE → SEARCH_CONFIRMED
{
  var payload = searchPayload({
    radarId: radarId,
    searchDemandStatus: SEARCH_DEMAND_STATUS.CONFIRMED,
    searchEvidenceCount: 3,
    searchSources: ['GOOGLE_AUTOCOMPLETE']
  });
  assert(sandbox.canConfirmSearchDemand_(payload) === true, 'caseA can confirm');
  assert(sandbox.validateSearchDemandCompletedPayload_(payload).ok === true, 'caseA payload valid');
  var next = applyRadar(makeRadarRow(radarId, { radarStatus: 'RESEARCH' }), payload);
  assert(next[radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.SEARCH_CONFIRMED, 'caseA SEARCH_CONFIRMED');
  assert(next[radarCol['来源族']] === 'GSC,SEARCH', 'caseA one SEARCH family');
  var nextJob = applyJob(makeJobRow(jobId, radarId, cycleDate), payload);
  assert(nextJob[jobCol['任务状态']] === '搜索需求已确认', 'caseA job final status');
}

// Case B — ANCHOR + CONFIRMED + evidence=3 + UNKNOWN_SOURCE → 不得 SEARCH_CONFIRMED
{
  var payload = searchPayload({
    radarId: radarId,
    searchDemandStatus: SEARCH_DEMAND_STATUS.CONFIRMED,
    searchEvidenceCount: 3,
    searchSources: ['UNKNOWN_SOURCE']
  });
  assert(sandbox.canConfirmSearchDemand_(payload) === false, 'caseB cannot confirm');
  var check = sandbox.validateSearchDemandCompletedPayload_(payload);
  assert(check.ok === false, 'caseB invalid callback');
  assert(check.error === 'invalid_search_confirmation', 'caseB invalid_search_confirmation');
  var next = applyRadar(makeRadarRow(radarId, { radarStatus: 'RESEARCH' }), payload);
  assert(next[radarCol['来源族']] === 'GSC', 'caseB no SEARCH family');
  assert(next[radarCol['搜索需求状态']] === SEARCH_DEMAND_STATUS.UNKNOWN, 'caseB status not CONFIRMED');
  assert(next[radarCol['机会置信度']] === OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY, 'caseB not SEARCH_CONFIRMED');
  assert(next[radarCol['雷达状态']] === 'RESEARCH', 'caseB radar not upgraded');
}

// Case C — Google + Bing 同时存在 → SourceFamilies 仍只增加一个 SEARCH
{
  var payload = searchPayload({
    radarId: radarId,
    searchSources: ['GOOGLE_AUTOCOMPLETE', 'BING_AUTOCOMPLETE']
  });
  assert(sandbox.allowedSearchSources_(payload.search_sources).join(',') === 'GOOGLE_AUTOCOMPLETE,BING_AUTOCOMPLETE', 'caseC both allowed');
  var next = applyRadar(makeRadarRow(radarId, { radarStatus: 'RESEARCH' }), payload);
  assert(next[radarCol['来源族']] === 'GSC,SEARCH', 'caseC only one SEARCH family');
  assert(next[radarCol['独立来源族数']] === 2, 'caseC count 2');
  assert(String(next[radarCol['来源族']]).split(',').filter(function (x) {
    return x === 'SEARCH';
  }).length === 1, 'caseC SEARCH not duplicated');
}

// Case 11 — cycle Date object 与 YYYY-MM-DD 可正确匹配
{
  var sheetDate = new Date('2026-08-18T00:00:00+08:00');
  var jobRow = makeJobRow(jobId, radarId, sheetDate);
  var payload = searchPayload({ jobId: jobId, radarId: radarId, cycleDate: '2026-08-18' });
  var ok = sandbox.validateSearchDemandJobIdentity_(jobRow, jobCol, payload);
  assert(ok.ok === true, 'case11 Date vs YYYY-MM-DD must accept');
}

// Case 12 — cycle mismatch reject
{
  var jobRow = makeJobRow(jobId, radarId, new Date('2026-08-17T00:00:00+08:00'));
  var payload = searchPayload({ jobId: jobId, radarId: radarId, cycleDate: '2026-08-18' });
  var ok = sandbox.validateSearchDemandJobIdentity_(jobRow, jobCol, payload);
  assert(ok.ok === false, 'case12 mismatch rejected');
  assert(ok.error === 'search_cycle_date_mismatch', 'case12 search_cycle_date_mismatch');
}

// Case 13 — callback idempotent
{
  var radarRow = makeRadarRow(radarId, { radarStatus: 'RESEARCH' });
  var payload = searchPayload({
    radarId: radarId,
    matchedQueries: ['q1', 'q1', 'q2'],
    searchSources: ['GOOGLE_AUTOCOMPLETE', 'GOOGLE_AUTOCOMPLETE', 'BING_AUTOCOMPLETE']
  });
  var r1 = applyRadar(radarRow, payload);
  var r2 = applyRadar(r1, payload);
  assert(JSON.stringify(r1) === JSON.stringify(r2), 'case13 radar idempotent');
  assert(r2[radarCol['来源族']] === 'GSC,SEARCH', 'case13 family not duplicated');

  var jobRow = makeJobRow(jobId, radarId, cycleDate);
  var j1 = applyJob(jobRow, payload);
  var j2 = applyJob(j1, payload);
  assert(JSON.stringify(j1) === JSON.stringify(j2), 'case13 job idempotent');
  var summary = JSON.parse(j2[jobCol['研究结果']]);
  assert(summary.matched_queries.join(',') === 'q1,q2', 'case13 queries unique');
  assert(summary.search_sources.join(',') === 'GOOGLE_AUTOCOMPLETE,BING_AUTOCOMPLETE', 'case13 sources unique');
}

// Case 14 — SerpGapStatus 永远不因本阶段改变
{
  var payloads = [
    searchPayload({ radarId: radarId }),
    searchPayload({ radarId: radarId, searchDemandStatus: SEARCH_DEMAND_STATUS.NO_SIGNAL, searchEvidenceCount: 0 }),
    searchPayload({ radarId: radarId, discoveryScope: 'GAME_WIDE' })
  ];
  for (var i = 0; i < payloads.length; i++) {
    var next = applyRadar(makeRadarRow(radarId, { serpGapStatus: SERP_GAP_STATUS.UNKNOWN }), payloads[i]);
    assert(next[radarCol['SERP缺口状态']] === SERP_GAP_STATUS.UNKNOWN, 'case14 serp stays UNKNOWN #' + i);
    assert(
      next[radarCol['机会置信度']] !== OPPORTUNITY_CONFIDENCE.OPPORTUNITY_VALIDATED,
      'case14 never OPPORTUNITY_VALIDATED #' + i
    );
  }
}

// FAILED：Job 失败，Radar validation 不变
{
  var radarRow = makeRadarRow(radarId, { radarStatus: 'RESEARCH' });
  var payload = searchPayload({
    radarId: radarId,
    executionStatus: 'FAILED',
    error: 'network'
  });
  var nextJob = applyJob(makeJobRow(jobId, radarId, cycleDate), payload);
  assert(nextJob[jobCol['任务状态']] === RESEARCH_JOB_STATUS_LABELS.FAILED, 'failed job status');
  assert(nextJob[jobCol['错误信息']] === 'network', 'failed error');
  var nextRadar = applyRadar(radarRow, payload);
  assert(nextRadar[radarCol['来源族']] === 'GSC', 'failed radar families unchanged');
  assert(nextRadar[radarCol['搜索需求状态']] === SEARCH_DEMAND_STATUS.UNKNOWN, 'failed search status unchanged');
  assert(nextRadar[radarCol['雷达状态']] === 'RESEARCH', 'failed radar status unchanged');
}

console.log('PASS scripts/test-search-demand-callback.js');
