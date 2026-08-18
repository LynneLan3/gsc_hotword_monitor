/**
 * 实时 24h Query 爆量监控：本地 mock 覆盖聚合 / 触发 / 承接。
 * 运行：node scripts/test-fresh-query-monitor.js
 */

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var searchSrc = fs.readFileSync(path.join(root, 'SearchConsole.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');
var freshSrc = fs.readFileSync(path.join(root, 'FreshQueryMonitor.gs'), 'utf8');
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');
var utilsSrc = fs.readFileSync(path.join(root, 'Utils.gs'), 'utf8');

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

// --- 旁路隔离 ---
assert(/FRESH_QUERY_MONITOR:\s*'实时Query监控'/.test(configSrc), 'sheet name');
assert(/ensureSheet_\(SHEET_NAMES\.FRESH_QUERY_MONITOR/.test(sheetSrc), 'setup creates sheet');
assert(/实时Query监控：用 GSC hourly/.test(sheetSrc), 'usage mentions bypass');
assert(/dataState:\s*'hourly_all'/.test(searchSrc), 'hourly_all request');
assert(/dimensions:\s*\['hour', 'query', 'page'\]/.test(searchSrc), 'hour+query+page');
assert(/function searchAnalyticsQueryAllRows_/.test(searchSrc), 'pagination helper');
assert(!/startRow/.test(extractFn(searchSrc, 'fetchFreshQueryPages')), 'existing fetch stays unpaged');
assert(!/hourly_all/.test(extractFn(searchSrc, 'fetchFreshQueriesResult_')), 'daily fresh stays dataState=all');
assert(!/runFreshQueryMonitor/.test(extractFn(codeSrc, 'runDailyUnlocked_')), 'runDaily collect untouched');
assert(
  !/runFreshQueryMonitor/.test(extractFn(codeSrc, 'runDailyFinalizerUnlocked_')),
  'runDaily finalizer untouched'
);
assert(!/newTrigger\('runFreshQueryMonitor'\)/.test(extractFn(codeSrc, 'createDailyTrigger')), 'no prod trigger this round');
assert(!/SHEET_NAMES\.DAILY|upsertDailyRow_/.test(freshSrc), 'must not write GSC日数据');
assert(!/upsertQueryRow_|SHEET_NAMES\.QUERIES/.test(freshSrc), 'must not write Query明细');
assert(!/SHEET_NAMES\.QUERY_PAGES|upsertQueryPage/.test(freshSrc), 'must not write Query页面明细');
assert(!/runDecisionEngine|rebuildEffectEvaluation|createResearchJobs/.test(freshSrc), 'must not hook decision/eval/research');
assert(!/runFreshQueryMonitor/.test(decisionSrc), 'decision engine unchanged');

var FRESH_QUERY_MONITOR_HEADERS = extractAssign(configSrc, 'FRESH_QUERY_MONITOR_HEADERS');
assert(FRESH_QUERY_MONITOR_HEADERS.length === 17, '17 columns');
assert(FRESH_QUERY_MONITOR_HEADERS[0] === '生成时间', 'col 生成时间');
assert(FRESH_QUERY_MONITOR_HEADERS[16] === '数据截止小时', 'col 数据截止小时');
assert(FRESH_QUERY_MONITOR_HEADERS.indexOf('是否触发') >= 0, '是否触发');
assert(FRESH_QUERY_MONITOR_HEADERS.indexOf('页面承接状态') >= 0, '页面承接状态');

var FRESH_QUERY_MONITOR_V1 = extractAssign(configSrc, 'FRESH_QUERY_MONITOR_V1');
var FRESH_QUERY_MS2_SKIP_PROLOGUE = extractAssign(configSrc, 'FRESH_QUERY_MS2_SKIP_PROLOGUE');
assert(FRESH_QUERY_MS2_SKIP_PROLOGUE.query === 'mortal shell 2 skip prologue', 'ms2 query text only');
assert(
  !/85|11 clicks|12\.94/.test(JSON.stringify(FRESH_QUERY_MS2_SKIP_PROLOGUE)),
  'must not hardcode skip prologue metrics'
);

var sandbox = {
  FRESH_QUERY_MONITOR_V1: FRESH_QUERY_MONITOR_V1,
  FRESH_QUERY_MS2_SKIP_PROLOGUE: FRESH_QUERY_MS2_SKIP_PROLOGUE,
  FRESH_QUERY_MONITOR_HEADERS: FRESH_QUERY_MONITOR_HEADERS,
  FRESH_HOURLY_LOOKBACK_DAYS: 3,
  FRESH_HOURLY_ROW_LIMIT: 25000,
  FRESH_QUERY_MONITOR_HANDLER: 'runFreshQueryMonitor',
  FRESH_QUERY_MONITOR_EVERY_HOURS: 6,
  SHEET_NAMES: { FRESH_QUERY_MONITOR: '实时Query监控' },
  OPPORTUNITY_HUB_SLUGS: {
    '': true,
    index: true,
    home: true,
    hub: true,
    guides: true,
    guide: true,
    wiki: true,
    browse: true,
    category: true,
    categories: true
  },
  BRAND_TOKEN_STOPWORDS: { the: true, a: true, an: true, of: true, and: true, to: true, ii: true, iii: true }
};

sandbox.tokenizeBrand_ = function (text) {
  var raw = String(text || '').toLowerCase().split(/[^a-z0-9]+/);
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var tok = raw[i];
    if (!tok || tok.length < 2) continue;
    if (sandbox.BRAND_TOKEN_STOPWORDS[tok]) continue;
    if (/^\d+$/.test(tok)) continue;
    out.push(tok);
  }
  return out;
};

sandbox.getBrandTokenSet_ = function (site) {
  var set = {};
  var chunks = [];
  if (site && site.name) chunks.push(site.name);
  if (site && site.propertyUrl) {
    var host = new URL(site.propertyUrl).hostname || '';
    chunks.push(host.split('.')[0] || '');
  }
  for (var c = 0; c < chunks.length; c++) {
    var toks = sandbox.tokenizeBrand_(chunks[c]);
    for (var t = 0; t < toks.length; t++) set[toks[t]] = true;
  }
  return set;
};

sandbox.isOpportunityHubPath_ = function (pagePath, site) {
  var pathName = sandbox.normalizeOpportunityPath_(pagePath);
  if (!pathName || pathName === '/') return true;
  var segments = pathName.split('/').filter(Boolean);
  if (segments.length === 1) {
    var slug = segments[0].toLowerCase();
    if (sandbox.OPPORTUNITY_HUB_SLUGS[slug]) return true;
    if (site && site.propertyUrl) {
      var host = new URL(site.propertyUrl).hostname || '';
      if (slug === String(host.split('.')[0] || '').toLowerCase()) return true;
    }
    return false;
  }
  return false;
};

sandbox.normalizeOpportunityPath_ = function (pagePath) {
  var p = String(pagePath || '').trim();
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) p = new URL(p).pathname || '/';
  if (p.charAt(0) !== '/') p = '/' + p;
  if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.substring(0, p.length - 1);
  return p || '/';
};

sandbox.isOpportunityRelatedGuidePage_ = function (query, pagePath, site) {
  if (sandbox.isOpportunityHubPath_(pagePath, site)) return false;
  var pathName = sandbox.normalizeOpportunityPath_(pagePath);
  var pathTokens = sandbox.tokenizeBrand_(pathName.replace(/[\/\-_]+/g, ' '));
  var qTokens = sandbox.tokenizeBrand_(query);
  var brand = sandbox.getBrandTokenSet_(site);
  var residual = [];
  for (var i = 0; i < qTokens.length; i++) {
    if (!brand[qTokens[i]]) residual.push(qTokens[i]);
  }
  if (!pathTokens.length || !residual.length) return false;
  for (var r = 0; r < residual.length; r++) {
    for (var p = 0; p < pathTokens.length; p++) {
      if (residual[r] === pathTokens[p]) return true;
    }
  }
  return false;
};

sandbox.parseGscHourMs_ = function (hourStr) {
  var s = String(hourStr || '').trim();
  if (!s) return null;
  var d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.getTime();
};

vm.createContext(sandbox);
vm.runInContext(extractFn(searchSrc, 'normalizeHourlyQueryPageRows_'), sandbox);
vm.runInContext(freshSrc, sandbox);

var mortal = {
  name: 'Mortal Shell II',
  propertyUrl: 'https://mortal-shell-ii.vercel.app/'
};

function hourRow(hour, query, page, clicks, impressions, position) {
  return {
    keys: [hour, query, page],
    clicks: clicks,
    impressions: impressions,
    position: position
  };
}

var OLD_PAGE = 'https://mortal-shell-ii.vercel.app/mortal-shell-ii/beta-progress-carry-over/';
var NEW_PAGE = 'https://mortal-shell-ii.vercel.app/mortal-shell-ii/skip-prologue/';
var HUB_PAGE = 'https://mortal-shell-ii.vercel.app/mortal-shell-ii/';
var SKIP_Q = 'mortal shell 2 skip prologue';

// 1) normalize hour+query+page
var normalized = sandbox.normalizeHourlyQueryPageRows_([
  hourRow('2026-08-18T14:00:00-07:00', SKIP_Q, OLD_PAGE, 11, 85, 3.7),
  { keys: ['2026-08-18T14:00:00-07:00', SKIP_Q], clicks: 1, impressions: 1, position: 1 },
  { keys: ['bad', SKIP_Q, OLD_PAGE], clicks: 1, impressions: 1, position: 1 }
]);
assert(normalized.length === 1, 'skip incomplete keys / bad hour');
assert(normalized[0].query === SKIP_Q, 'query key');
assert(normalized[0].page === OLD_PAGE, 'page key');
assert(normalized[0].hourMs > 0, 'hour parsed');

// 2) 24h windows by hour timestamp, not calendar day
var mixed = sandbox.normalizeHourlyQueryPageRows_([
  hourRow('2026-08-18T14:00:00-07:00', 'q', OLD_PAGE, 1, 10, 5),
  hourRow('2026-08-17T15:00:00-07:00', 'q', OLD_PAGE, 1, 5, 5),
  hourRow('2026-08-17T14:00:00-07:00', 'q', OLD_PAGE, 0, 40, 5),
  hourRow('2026-08-16T14:00:00-07:00', 'q', OLD_PAGE, 0, 999, 5)
]);
var windows = sandbox.splitFreshQueryWindows_(mixed);
assert(windows.cutoffHour === '2026-08-18T14:00:00-07:00', 'cutoff = max hour');
assert(windows.recent.length === 2, 'recent 24h has two hour buckets');
assert(windows.previous.length === 1, 'previous 24h has 17T14');
assert(windows.previous[0].impressions === 40, 'older 16T14 excluded');

// 3) 85/11 burst + CTR + weighted position + MS2 old page
var burstRows = sandbox.normalizeHourlyQueryPageRows_([
  hourRow('2026-08-18T10:00:00-07:00', SKIP_Q, OLD_PAGE, 6, 50, 3.2),
  hourRow('2026-08-18T14:00:00-07:00', SKIP_Q, OLD_PAGE, 5, 35, 4.4)
]);
var builtBurst = sandbox.buildFreshQueryMonitorRows_(burstRows, {
  site: mortal,
  generatedAt: new Date('2026-08-18T22:00:00+08:00'),
  metadata: { firstIncompleteHour: '2026-08-18T14:00:00-07:00' }
});
assert(builtBurst.triggered.length === 1, 'skip prologue triggered');
assert(builtBurst.incomplete === true, 'incomplete metadata preserved');
var burstRow = builtBurst.triggered[0];
assert(burstRow[2] === SKIP_Q, 'query written');
assert(burstRow[3] === OLD_PAGE, 'old page url');
assert(burstRow[4] === 11, 'clicks 11');
assert(burstRow[5] === 85, 'impressions 85');
assert(Math.abs(burstRow[6] - 11 / 85) < 1e-10, 'CTR recomputed');
assert(Math.abs(burstRow[7] - (3.2 * 50 + 4.4 * 35) / 85) < 1e-10, 'position weighted');
assert(burstRow[8] === 0, 'no previous window');
assert(burstRow[10] === '是', 'new query');
assert(burstRow[11] === '是', 'triggered');
assert(burstRow[12].indexOf('展现≥30') >= 0, 'reason impressions');
assert(burstRow[12].indexOf('点击≥3') >= 0, 'reason clicks');
assert(burstRow[12].indexOf('新Query进入Top10') >= 0, 'reason new top10');
assert(burstRow[13] === '旧页承接，观察新页切换', 'ms2 old page landing');
assert(burstRow[14] === '继续观察', 'do not auto-create page');
assert(burstRow[15] === '是', 'incomplete flag');
assert(burstRow[16] === '2026-08-18T14:00:00-07:00', 'cutoff hour');

// 4) +100% growth
var growthRows = sandbox.normalizeHourlyQueryPageRows_([
  hourRow('2026-08-18T14:00:00-07:00', 'grain rot map', OLD_PAGE, 1, 80, 12),
  hourRow('2026-08-17T14:00:00-07:00', 'grain rot map', OLD_PAGE, 0, 40, 12)
]);
var growthBuilt = sandbox.buildFreshQueryMonitorRows_(growthRows, { site: mortal });
assert(growthBuilt.triggered.length === 1, 'growth triggered');
assert(growthBuilt.triggered[0][5] === 80, 'recent 80');
assert(growthBuilt.triggered[0][8] === 40, 'prev 40');
assert(growthBuilt.triggered[0][9] === 1, 'growth ratio 100%');
assert(growthBuilt.triggered[0][10] === '否', 'not new');
assert(growthBuilt.triggered[0][12].indexOf('展现增长≥100%') >= 0, 'growth reason');

// 5) new query Top10
var newTopRows = sandbox.normalizeHourlyQueryPageRows_([
  hourRow('2026-08-18T14:00:00-07:00', 'mortal shell 2 console commands', OLD_PAGE, 1, 12, 8.1)
]);
var newTop = sandbox.buildFreshQueryMonitorRows_(newTopRows, { site: mortal });
assert(newTop.triggered.length === 1, 'new top10 triggered');
assert(newTop.triggered[0][12] === '新Query进入Top10', 'only new-top10 reason');

// 6) below threshold
var quietRows = sandbox.normalizeHourlyQueryPageRows_([
  hourRow('2026-08-18T14:00:00-07:00', 'mortal shell 2 news', HUB_PAGE, 1, 20, 15),
  hourRow('2026-08-17T14:00:00-07:00', 'mortal shell 2 news', HUB_PAGE, 0, 18, 16)
]);
var quiet = sandbox.buildFreshQueryMonitorRows_(quietRows, { site: mortal, metadata: null });
assert(quiet.all.length === 1, 'quiet query still computed');
assert(quiet.triggered.length === 0, 'below threshold not written as trigger');
assert(quiet.incomplete === false, 'no fake incomplete');
assert(quiet.all[0][11] === '否', 'not triggered');

// 7) two-page competition
var competeRows = sandbox.normalizeHourlyQueryPageRows_([
  hourRow('2026-08-18T14:00:00-07:00', SKIP_Q, OLD_PAGE, 4, 40, 4),
  hourRow('2026-08-18T13:00:00-07:00', SKIP_Q, NEW_PAGE, 3, 30, 5)
]);
var compete = sandbox.buildFreshQueryMonitorRows_(competeRows, { site: mortal });
assert(compete.triggered.length === 1, 'competition still burst');
assert(compete.triggered[0][13] === '可能页面竞争', 'ms2 both pages compete');
assert(compete.triggered[0][14] === '检查页面意图与内链', 'competition action');

// 8) new page already ranking
var newPageRows = sandbox.normalizeHourlyQueryPageRows_([
  hourRow('2026-08-18T14:00:00-07:00', SKIP_Q, NEW_PAGE, 11, 85, 3.7)
]);
var newPageBuilt = sandbox.buildFreshQueryMonitorRows_(newPageRows, { site: mortal });
assert(newPageBuilt.triggered[0][13] === '新页已承接', 'new page landing');
assert(newPageBuilt.triggered[0][14] === '继续观察', 'keep watching new page');

// 9) hub + specific intent → maybe new page, not because of threshold alone
var hubIntent = sandbox.classifyFreshQueryLanding_(
  'mortal shell 2 skip prologue',
  [{ page: HUB_PAGE, impressions: 40, clicks: 4 }],
  mortal
);
assert(hubIntent.status === '可能需要新页', 'hub specific intent');
assert(hubIntent.action === '研究补新页', 'research new page');

var relatedWatch = sandbox.classifyFreshQueryLanding_(
  'mortal shell 2 skip prologue',
  [{ page: NEW_PAGE, impressions: 40, clicks: 4 }],
  mortal
);
assert(relatedWatch.status === '新页已承接', 'matched new page');

// 10) pagination helper exists and existing daily fetch unchanged
assert(/startRow/.test(extractFn(searchSrc, 'searchAnalyticsQueryAllRows_')), 'hourly paginates');
assert(/rowLimit \|\| FRESH_HOURLY_ROW_LIMIT/.test(extractFn(searchSrc, 'fetchHourlyQueryPagesResult_')), 'large rowLimit');

console.log(
  JSON.stringify(
    {
      burstCtr: +(11 / 85).toFixed(4),
      burstReasons: burstRow[12],
      oldLanding: burstRow[13],
      competeLanding: compete.triggered[0][13],
      newLanding: newPageBuilt.triggered[0][13],
      growth: growthBuilt.triggered[0][9],
      quietTriggered: quiet.triggered.length
    },
    null,
    2
  )
);
console.log('PASS scripts/test-fresh-query-monitor.js');
