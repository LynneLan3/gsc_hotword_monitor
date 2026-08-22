/**
 * R1 本地自测：Daily Demand Radar 数据层（不依赖 SpreadsheetApp）。
 * 运行：node scripts/test-demand-radar.js
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var radarSrc = fs.readFileSync(path.join(root, 'DemandRadar.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');
var opportunitySrc = fs.readFileSync(path.join(root, 'OpportunityEngine.gs'), 'utf8');
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');
var researchSrc = fs.readFileSync(path.join(root, 'ResearchJobs.gs'), 'utf8');
var identitySrc = fs.readFileSync(path.join(root, 'OpportunityIdentity.gs'), 'utf8');

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

assert(/DEMAND_RADAR:\s*'需求雷达'/.test(configSrc), 'sheet name 需求雷达');
assert(/ensureSheet_\(SHEET_NAMES\.DEMAND_RADAR/.test(sheetSrc), 'setup creates 需求雷达');
assert(/需求雷达：记录 GSC Query/.test(sheetSrc), 'usage guide mentions 需求雷达');
assert(/CrossValidated 只有在至少两个独立 Source Family/.test(sheetSrc), 'usage cross-validated note');
assert(/refreshDemandRadar_\(sites, runDate\)/.test(extractFn(codeSrc, 'runDailyFinalizerUnlocked_')),
  'runDaily finalizer calls radar');
assert(!/refreshDemandRadar_/.test(extractFn(codeSrc, 'runDailyUnlocked_')),
  'collect path does not refresh radar before GSC finishes');
assert(!/SHEET_NAMES\.OPPORTUNITIES/.test(radarSrc), 'must not write 内容机会');
assert(!/SHEET_NAMES\.TODAY_ACTIONS/.test(radarSrc), 'must not write 今日行动');
assert(!/SHEET_NAMES\.RESEARCH_JOBS/.test(radarSrc), 'must not write 研究任务');
assert(!/createResearchJobs|createResearchJob/.test(radarSrc), 'must not create research jobs');
assert(!/QUERY_BLIND_SPOT/.test(opportunitySrc), 'opportunity engine unchanged');
assert(!/DEMAND_RADAR|refreshDemandRadar_/.test(decisionSrc), 'decision engine unchanged');
assert(!/createDemandDiscoveryJobs/.test(radarSrc), 'refreshDemandRadar does not create discovery jobs');
assert(!/createSearchDemandJobs/.test(radarSrc), 'refreshDemandRadar does not create search jobs');

var QUERY_BLIND_SPOT_V1 = extractAssign(configSrc, 'QUERY_BLIND_SPOT_V1');
var SOURCE_FAMILY = extractAssign(configSrc, 'SOURCE_FAMILY');
var SOURCE_FAMILY_ORDER = extractAssign(configSrc, 'SOURCE_FAMILY_ORDER');
var SOURCE_FAMILY_ALIASES = extractAssign(configSrc, 'SOURCE_FAMILY_ALIASES');
var RADAR_SIGNAL_STATUS = extractAssign(configSrc, 'RADAR_SIGNAL_STATUS');
var RADAR_STATUS = extractAssign(configSrc, 'RADAR_STATUS');
var SEARCH_DEMAND_STATUS = extractAssign(configSrc, 'SEARCH_DEMAND_STATUS');
var SERP_GAP_STATUS = extractAssign(configSrc, 'SERP_GAP_STATUS');
var OPPORTUNITY_CONFIDENCE = extractAssign(configSrc, 'OPPORTUNITY_CONFIDENCE');
var RESEARCH_GAME_SLUGS = extractAssign(configSrc, 'RESEARCH_GAME_SLUGS');
var DEMAND_RADAR_HEADERS = extractAssign(configSrc, 'DEMAND_RADAR_HEADERS');

assert(DEMAND_RADAR_HEADERS.indexOf('雷达ID') === 0, 'RadarID header');
assert(DEMAND_RADAR_HEADERS.indexOf('交叉验证') >= 0, 'CrossValidated header');
assert(DEMAND_RADAR_HEADERS.indexOf('独立来源族数') >= 0, 'family count header');
assert(DEMAND_RADAR_HEADERS.indexOf('研究任务ID') === 24, 'R2 ResearchJobID column unmoved');
assert(DEMAND_RADAR_HEADERS.indexOf('搜索需求任务ID') >= 0, 'search job id appended');
assert(
  DEMAND_RADAR_HEADERS[DEMAND_RADAR_HEADERS.length - 2] === '最近搜索需求时间',
  'search job time appended'
);
assert(DEMAND_RADAR_HEADERS[DEMAND_RADAR_HEADERS.length - 1] === 'OpportunityID',
  'opportunity id appended');
assert(DEMAND_RADAR_HEADERS.length === 35, 'header count');

function pagePathFromUrl_(pageUrl) {
  var raw = String(pageUrl || '').trim();
  if (!raw) return '';
  try {
    var u = new URL(raw);
    return u.pathname || '/';
  } catch (e) {
    return raw;
  }
}

function normalizeOpportunityPath_(pagePath) {
  var p = String(pagePath || '').trim();
  if (!p) return '';
  try {
    if (/^https?:\/\//i.test(p)) p = pagePathFromUrl_(p);
  } catch (e) {}
  if (p.charAt(0) !== '/') p = '/' + p;
  if (p.length > 1 && p.charAt(p.length - 1) === '/') {
    p = p.substring(0, p.length - 1);
  }
  return p || '/';
}

function normalizeKeyDate_(v) {
  if (!v) return '';
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return '';
}

var sandbox = {
  QUERY_BLIND_SPOT_V1: QUERY_BLIND_SPOT_V1,
  QUERY_BLIND_SPOT_TRIGGER: 'QUERY_BLIND_SPOT',
  SOURCE_FAMILY: SOURCE_FAMILY,
  SOURCE_FAMILY_ORDER: SOURCE_FAMILY_ORDER,
  SOURCE_FAMILY_ALIASES: SOURCE_FAMILY_ALIASES,
  RADAR_SIGNAL_STATUS: RADAR_SIGNAL_STATUS,
  RADAR_STATUS: RADAR_STATUS,
  SEARCH_DEMAND_STATUS: SEARCH_DEMAND_STATUS,
  SERP_GAP_STATUS: SERP_GAP_STATUS,
  OPPORTUNITY_CONFIDENCE: OPPORTUNITY_CONFIDENCE,
  RESEARCH_GAME_SLUGS: RESEARCH_GAME_SLUGS,
  DEMAND_RADAR_HEADERS: DEMAND_RADAR_HEADERS,
  normalizeOpportunityPath_: normalizeOpportunityPath_,
  pagePathFromUrl_: pagePathFromUrl_,
  normalizeKeyDate_: normalizeKeyDate_
};
vm.createContext(sandbox);
vm.runInContext(identitySrc, sandbox);
vm.runInContext(radarSrc, sandbox);

var AGEFIELD = 'Agefield High: Rock the School';
var CLASSES_URL =
  'https://agefield-high-rock-the-school.vercel.app/agefield-high-rock-the-school/classes/';
var CLASSES_PATH = '/agefield-high-rock-the-school/classes/';

function detection_(opts) {
  opts = opts || {};
  return {
    site: opts.site || AGEFIELD,
    pageUrl: opts.pageUrl || CLASSES_URL,
    pagePath: opts.pagePath || CLASSES_PATH,
    dataEndDate: opts.dataEndDate || '2026-08-10',
    pageClicks7D: opts.pageClicks7D == null ? 11 : opts.pageClicks7D,
    pageImpressions7D: opts.pageImpressions7D == null ? 53 : opts.pageImpressions7D,
    visibleQueryClicks7D: opts.visibleQueryClicks7D == null ? 0 : opts.visibleQueryClicks7D,
    visibleQueryImpressions7D:
      opts.visibleQueryImpressions7D == null ? 0 : opts.visibleQueryImpressions7D,
    queryClickCoverage: 0,
    queryImpressionCoverage: 0,
    triggerType: 'QUERY_BLIND_SPOT',
    triggerReason:
      opts.triggerReason ||
      'Page 7D has 11 clicks, but visible Query×Page rows explain 0 clicks (0% coverage).',
    isBlindSpot: opts.isBlindSpot !== false
  };
}

function col(name) {
  var i = DEMAND_RADAR_HEADERS.indexOf(name);
  assert(i >= 0, 'missing header ' + name);
  return i;
}

function findRow(rows, id) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === id) return rows[i];
  }
  return null;
}

// --- Case 6 helpers first ---
assert(sandbox.countIndependentSourceFamilies_(['GSC']) === 1, 'GSC count 1');
assert(sandbox.isCrossValidated_(['GSC']) === false, 'GSC not cross-validated');
assert(sandbox.countIndependentSourceFamilies_(['COMMUNITY', 'COMMUNITY']) === 1, 'dup community');
assert(sandbox.isCrossValidated_(['COMMUNITY', 'COMMUNITY']) === false, 'dup community false');
assert(sandbox.normalizeSourceFamilies_(['Reddit', 'Steam']).join(',') === 'COMMUNITY',
  'Reddit+Steam → COMMUNITY');
assert(sandbox.countIndependentSourceFamilies_(['Reddit', 'Steam']) === 1, 'reddit+steam count 1');
assert(sandbox.isCrossValidated_(['Reddit', 'Steam']) === false, 'reddit+steam not independent');
assert(sandbox.countIndependentSourceFamilies_(['GSC', 'COMMUNITY']) === 2, 'gsc+community 2');
assert(sandbox.isCrossValidated_(['GSC', 'COMMUNITY']) === true, 'gsc+community true');
assert(sandbox.countIndependentSourceFamilies_(['COMMUNITY', 'VIDEO']) === 2, 'community+video 2');
assert(sandbox.isCrossValidated_(['COMMUNITY', 'VIDEO']) === true, 'community+video true');
assert(
  sandbox.normalizeSourceFamilies_(['GOOGLE_AUTOCOMPLETE', 'BING_AUTOCOMPLETE']).join(',') ===
    'SEARCH',
  'google+bing autocomplete is one SEARCH family'
);
assert(
  sandbox.countIndependentSourceFamilies_(['GSC', 'GOOGLE_AUTOCOMPLETE', 'BING_AUTOCOMPLETE']) === 2,
  'GSC + google + bing count 2'
);
assert(
  sandbox.opportunityConfidenceRank_('SEARCH_CONFIRMED') >
    sandbox.opportunityConfidenceRank_('CROSS_VALIDATED'),
  'SEARCH_CONFIRMED ranks above CROSS_VALIDATED'
);

// --- Case 1 first discover ---
var day1 = sandbox.reconcileDemandRadarRows_([], [detection_()], {
  site: AGEFIELD,
  runDate: '2026-08-17',
  nowTs: '2026-08-17 10:00:00'
});
assert(day1.skipped === false, 'case1 not skipped');
assert(day1.rows.length === 1, 'case1 one row');
var row1 = day1.rows[0];
var radarId = String(row1[col('雷达ID')]);
var opportunityId = String(row1[col('OpportunityID')]);
assert(opportunityId === 'opp-agefield-agefield-high-rock-the-school-classes-query-blind-spot-001',
  'case1 stable OpportunityID');
assert(sandbox.isStableOpportunityId_(opportunityId), 'case1 OpportunityID format');
assert(radarId.indexOf('agefield|') === 0, 'slug from RESEARCH_GAME_SLUGS');
assert(/\|\/agefield-high-rock-the-school\/classes\/\|QUERY_BLIND_SPOT$/.test(radarId),
  'stable id path+trigger');
assert(row1[col('信号状态')] === 'ACTIVE', 'case1 ACTIVE');
assert(row1[col('雷达状态')] === 'DISCOVERED', 'case1 DISCOVERED');
assert(String(row1[col('来源族')]) === 'GSC', 'case1 GSC');
assert(row1[col('独立来源族数')] === 1, 'case1 family count 1');
assert(row1[col('交叉验证')] === false, 'case1 CrossValidated false');
assert(row1[col('机会置信度')] === 'DISCOVERY_ONLY', 'case1 DISCOVERY_ONLY');
assert(row1[col('搜索需求状态')] === 'UNKNOWN', 'case1 search unknown');
assert(row1[col('SERP缺口状态')] === 'UNKNOWN', 'case1 serp unknown');
assert(row1[col('首次发现')] === '2026-08-17', 'case1 first seen');
assert(row1[col('最近发现')] === '2026-08-17', 'case1 last seen');
assert(row1[col('研究任务ID')] === '', 'case1 no research job');

// --- Case 2 second run still ACTIVE ---
var day2Det = detection_({
  pageClicks7D: 14,
  pageImpressions7D: 60,
  triggerReason: 'Page 7D has 14 clicks, but visible Query×Page rows explain 0 clicks (0% coverage).'
});
var day2 = sandbox.reconcileDemandRadarRows_(day1.rows, [day2Det], {
  site: AGEFIELD,
  runDate: '2026-08-18',
  nowTs: '2026-08-18 10:00:00'
});
assert(day2.rows.length === 1, 'case2 no second row');
var row2 = day2.rows[0];
assert(row2[col('雷达ID')] === radarId, 'case2 same id');
assert(row2[col('OpportunityID')] === opportunityId, 'case2 same OpportunityID');
assert(row2[col('雷达ID')] && row2[col('OpportunityID')], 'case2 RadarID and OpportunityID both present');
assert(row2[col('首次发现')] === '2026-08-17', 'case2 first seen frozen');
assert(row2[col('最近发现')] === '2026-08-18', 'case2 last seen updated');
assert(row2[col('页面点击7日')] === 14, 'case2 metrics updated');
assert(row2[col('信号状态')] === 'ACTIVE', 'case2 still ACTIVE');
assert(row2[col('雷达状态')] === 'DISCOVERED', 'case2 radar status kept');

// --- Case 3 blind spot gone ---
var day3 = sandbox.reconcileDemandRadarRows_(day2.rows, [], {
  site: AGEFIELD,
  runDate: '2026-08-19',
  nowTs: '2026-08-19 10:00:00'
});
assert(day3.rows.length === 1, 'case3 row kept');
var row3 = day3.rows[0];
assert(row3[col('信号状态')] === 'RESOLVED', 'case3 RESOLVED');
assert(row3[col('最近发现')] === '2026-08-18', 'case3 last seen stays last ACTIVE');
assert(row3[col('首次发现')] === '2026-08-17', 'case3 first seen kept');
assert(row3[col('雷达ID')] === radarId, 'case3 same id');

// --- Case 4 reappears ---
var day4 = sandbox.reconcileDemandRadarRows_(day3.rows, [detection_({ pageClicks7D: 12 })], {
  site: AGEFIELD,
  runDate: '2026-08-20',
  nowTs: '2026-08-20 10:00:00'
});
assert(day4.rows.length === 1, 'case4 no duplicate');
var row4 = day4.rows[0];
assert(row4[col('雷达ID')] === radarId, 'case4 same RadarID');
assert(row4[col('信号状态')] === 'ACTIVE', 'case4 ACTIVE again');
assert(row4[col('最近发现')] === '2026-08-20', 'case4 last seen updated');
assert(row4[col('首次发现')] === '2026-08-17', 'case4 first seen still original');

// --- Case 5 collection failure ---
var day5 = sandbox.reconcileDemandRadarRows_(day4.rows, [], {
  site: AGEFIELD,
  runDate: '2026-08-21',
  snapshotError: 'QUERY_PAGE_FAILED | HTTP 500',
  queryPageCollectionOk: false
});
assert(day5.skipped === true, 'case5 skipped');
assert(day5.rows.length === 1, 'case5 keep row');
assert(day5.rows[0][col('信号状态')] === 'ACTIVE', 'case5 must not RESOLVE');
assert(day5.rows[0][col('最近发现')] === '2026-08-20', 'case5 last seen unchanged');

var day5b = sandbox.reconcileDemandRadarRows_(day4.rows, [], {
  site: AGEFIELD,
  runDate: '2026-08-21',
  collectionFailed: true
});
assert(day5b.rows[0][col('信号状态')] === 'ACTIVE', 'case5b collectionFailed keeps ACTIVE');

// --- Case 7 trailing slash same RadarID ---
var slashA = sandbox.buildRadarId_(
  AGEFIELD,
  'https://agefield-high-rock-the-school.vercel.app/agefield-high-rock-the-school/classes',
  '/agefield-high-rock-the-school/classes',
  'QUERY_BLIND_SPOT'
);
var slashB = sandbox.buildRadarId_(
  AGEFIELD,
  CLASSES_URL,
  CLASSES_PATH,
  'QUERY_BLIND_SPOT'
);
assert(slashA === slashB, 'trailing slash must not fork RadarID');
assert(slashA === radarId, 'slash ids match case1 id');
assert(
  sandbox.buildOpportunityIdFromRadarId_(radarId) !==
    sandbox.buildOpportunityIdFromRadarId_('agefield|/agefield-high-rock-the-school/other/|QUERY_BLIND_SPOT'),
  'different RadarID gets different OpportunityID'
);
assert(
  sandbox.buildOpportunityIdFromRadarId_(
    'ms2|/mortal-shell-ii/skip-prologue/|QUERY_BLIND_SPOT'
  ) === 'opp-ms2-mortal-shell-ii-skip-prologue-query-blind-spot-001',
  'Mortal Shell II skip-prologue OpportunityID'
);

var slashMerge = sandbox.reconcileDemandRadarRows_(day1.rows, [
  detection_({
    pageUrl:
      'https://agefield-high-rock-the-school.vercel.app/agefield-high-rock-the-school/classes',
    pagePath: '/agefield-high-rock-the-school/classes'
  })
], {
  site: AGEFIELD,
  runDate: '2026-08-18'
});
assert(slashMerge.rows.length === 1, 'slash reconcile no extra row');

// --- Case 8 canonical pathname helper ---
assert(
  sandbox.canonicalRadarPathname_(
    'https://agefield-high-rock-the-school.vercel.app/agefield-high-rock-the-school/classes/'
  ) === '/agefield-high-rock-the-school/classes/',
  'absolute URL canonical pathname'
);
assert(
  sandbox.canonicalRadarPathname_('https://approximately-up.vercel.app/') === '/',
  'root URL canonical pathname'
);
assert(
  sandbox.canonicalRadarPathname_('https://example.com/foo/?a=1#x') === '/foo/',
  'query/hash removed'
);
assert(
  sandbox.canonicalRadarPathname_('/mortal-shell-ii/beta-progress-carry-over/') ===
    '/mortal-shell-ii/beta-progress-carry-over/',
  'path input unchanged'
);
assert(
  sandbox.canonicalRadarPathname_('foo/bar/') === '/foo/bar/',
  'relative path canonicalized'
);

// --- Case 9 malformed existing row should be canonicalized in-place ---
var malformedId =
  'agefield|/https://agefield-high-rock-the-school.vercel.app/agefield-high-rock-the-school/classes/|QUERY_BLIND_SPOT';
var malformedRow = day1.rows[0].slice();
malformedRow[col('雷达ID')] = malformedId;
malformedRow[col('锚点页面')] =
  '/https://agefield-high-rock-the-school.vercel.app/agefield-high-rock-the-school/classes/';
malformedRow[col('首次发现')] = '2026-08-17';
malformedRow[col('最近发现')] = '2026-08-17';

var fixMalformed = sandbox.reconcileDemandRadarRows_([malformedRow], [detection_()], {
  site: AGEFIELD,
  runDate: '2026-08-18',
  nowTs: '2026-08-18 10:00:00'
});
assert(fixMalformed.rows.length === 1, 'malformed row fixed without duplicate');
var fixed = fixMalformed.rows[0];
assert(fixed[col('雷达ID')] === radarId, 'malformed id rewritten to canonical id');
assert(
  fixed[col('锚点页面')] === '/agefield-high-rock-the-school/classes/',
  'malformed anchor rewritten to canonical path'
);
assert(fixed[col('首次发现')] === '2026-08-17', 'malformed row keeps first seen');
assert(fixed[col('最近发现')] === '2026-08-18', 'malformed row updates last seen');

console.log(
  JSON.stringify(
    {
      radarId: radarId,
      case1: row1[col('信号状态')] + '/' + row1[col('雷达状态')],
      case2Rows: day2.rows.length,
      case3: row3[col('信号状态')],
      case4: row4[col('信号状态')],
      case5: day5.rows[0][col('信号状态')],
      families: {
        redditSteam: sandbox.normalizeSourceFamilies_(['Reddit', 'Steam']),
        gscCommunity: sandbox.isCrossValidated_(['GSC', 'COMMUNITY'])
      }
    },
    null,
    2
  )
);
console.log('PASS scripts/test-demand-radar.js');
