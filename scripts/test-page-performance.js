/**
 * B1-D3 本地自测：Page-only Performance 数据层（不依赖 SpreadsheetApp / GSC API）。
 * 运行：node scripts/test-page-performance.js
 */

var fs = require('fs');
var path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var root = path.join(__dirname, '..');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');
var searchSrc = fs.readFileSync(path.join(root, 'SearchConsole.gs'), 'utf8');
var engineSrc = fs.readFileSync(path.join(root, 'PortfolioEngine.gs'), 'utf8');

function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function ' + name);
  var next = src.indexOf('\nfunction ', start + 1);
  return next >= 0 ? src.slice(start, next) : src.slice(start);
}

// --- 1. fetch page-only 使用 dimensions=['page'] ---
var fetchFn = extractFn(searchSrc, 'fetchFreshPages');
assert(/dimensions:\s*\['page'\]/.test(fetchFn), 'fetchFreshPages uses page dimension');
assert(!/dimensions:\s*\[[^\]]*query/.test(fetchFn), 'fetchFreshPages must not request query');
assert(/dataState:\s*'all'/.test(fetchFn), 'fetchFreshPages uses dataState=all');
assert(!/startRow/.test(fetchFn), 'no pagination this round');
assert(/searchAnalyticsQuery/.test(fetchFn), 'reuses searchAnalyticsQuery');

// --- 2. page row 正确写入 Page明细 ---
assert(/function upsertPageRow_/.test(sheetSrc), 'upsertPageRow_');
assert(
  /fetchFreshPages/.test(extractFn(codeSrc, 'upsertPageDetailsForDate_')),
  'daily/backfill write helper fetches pages'
);
assert(
  /upsertPageRow_/.test(extractFn(codeSrc, 'upsertPageDetailsForDate_')),
  'API rows upsert into Page明细'
);
assert(/ensureSheet_\(SHEET_NAMES\.PAGES, PAGE_HEADERS\)/.test(sheetSrc), 'setup creates Page明细');

var headersMatch = configSrc.match(/var PAGE_HEADERS\s*=\s*(\[[\s\S]*?\]);/);
assert(headersMatch, 'PAGE_HEADERS present');
var headers = eval(headersMatch[1]);
assert(headers.join('|') === 'DataDate|Site|PageURL|PagePath|Clicks|Impressions|CTR|Position', 'page headers');

// --- 3. 唯一键 DataDate + Site + PageURL ---
var upsertFn = extractFn(sheetSrc, 'upsertPageRow_');
assert(/normalizeKeyDate_\(r\[0\]\)/.test(upsertFn), 'key includes date');
assert(/r\[1\]/.test(upsertFn), 'key includes site');
assert(/r\[2\]/.test(upsertFn), 'key includes PageURL');
assert(!/r\[3\]/.test(upsertFn.replace(/PAGE_HEADERS/, '')), 'PagePath not part of unique key');

function pageKey(row) {
  return row[0] + '||' + row[1] + '||' + row[2];
}

function simulateUpsertPages(store, dataDate, siteName, apiRows) {
  var inserted = 0;
  var updated = 0;
  for (var i = 0; i < apiRows.length; i++) {
    var pr = apiRows[i];
    if (!pr || !pr.page) continue;
    var row = [
      dataDate,
      siteName,
      pr.page,
      pr.pagePath || '/',
      pr.clicks || 0,
      pr.impressions || 0,
      pr.ctr || 0,
      pr.position || 0
    ];
    var key = pageKey(row);
    if (store[key]) {
      store[key] = row;
      updated++;
    } else {
      store[key] = row;
      inserted++;
    }
  }
  return { inserted: inserted, updated: updated };
}

// --- 4. 重复执行 update 不累计 ---
var store = {};
var first = simulateUpsertPages(store, '2026-08-10', 'Site', [
  { page: 'https://example.test/classes/', pagePath: '/classes/', clicks: 10, impressions: 80 }
]);
assert(first.inserted === 1 && first.updated === 0, 'first insert');
var again = simulateUpsertPages(store, '2026-08-10', 'Site', [
  { page: 'https://example.test/classes/', pagePath: '/classes/', clicks: 12, impressions: 90 }
]);
assert(again.inserted === 0 && again.updated === 1, 'repeat updates');
assert(Object.keys(store).length === 1, 'no duplicate rows');
assert(store[Object.keys(store)[0]][4] === 12, 'upsert replaces clicks, does not add');

// --- 5. 空日不删除已有数据 ---
var empty = simulateUpsertPages(store, '2026-08-11', 'Site', []);
assert(empty.inserted === 0 && empty.updated === 0, 'empty day writes nothing');
assert(Object.keys(store).length === 1, 'empty day keeps prior rows');
simulateUpsertPages(store, '2026-08-12', 'Site', [
  { page: 'https://example.test/', pagePath: '/', clicks: 2, impressions: 30 }
]);
assert(Object.keys(store).length === 2, 'later date inserts separately');
simulateUpsertPages(store, '2026-08-11', 'Site', []);
assert(Object.keys(store).length === 2, 'second empty day still preserves both dates');

// --- 6. runDaily 继续使用 FRESH_QUERY_DAYS=5 ---
var freshDays = configSrc.match(/var FRESH_QUERY_DAYS\s*=\s*(\d+)/);
assert(freshDays && Number(freshDays[1]) === 5, 'FRESH_QUERY_DAYS remains 5');
var dailyFn = extractFn(codeSrc, 'syncFreshPageDetails_');
assert(/getFreshQueryDateRange_\(runDate\)/.test(dailyFn), 'daily page sync uses fresh range');
assert(
  /syncFreshPageDetails_\(siteName, propertyUrl, runDate\)/.test(
    extractFn(codeSrc, 'processSiteDaily_')
  ),
  'runDaily collects Page明细'
);

// --- 7. 14日 backfill 能补 Page明细 ---
assert(/function backfillPageDetails14Days/.test(codeSrc), 'independent page backfill');
var independentFn = extractFn(codeSrc, 'backfillPageDetails14Days');
assert(/gscDaysAgoStr_\(BACKFILL_DAYS - 1\)/.test(independentFn), 'same 14-day window');
assert(!/upsertDailyRow_/.test(independentFn), 'must not write GSC日数据');
assert(!/upsertQueryRow_/.test(independentFn), 'must not write Query明细');
assert(!/upsertQueryPageRow_/.test(independentFn), 'must not write Query页面明细');
assert(!/runDecisionEngine/.test(independentFn), 'must not run Decision');
assert(!/runPortfolioEngine/.test(independentFn), 'must not run Portfolio');
assert(
  /backfillPageDetailsForSite_/.test(extractFn(codeSrc, 'backfillSite_')),
  'full GSC backfill also writes Page明细'
);
assert(/fetchDateRows/.test(extractFn(codeSrc, 'backfillPageDetailsForSite_')), 'uses existing dates');
assert(/catch \(e\)/.test(extractFn(codeSrc, 'backfillPageDetailsForSite_')), 'per-day failure continues');

assert(/PAGES:\s*'Page明细'/.test(configSrc), 'display name Page明细');
assert(/findWinnerPage_\(\s*pageBySite/.test(engineSrc), 'Winner Page reads Page明细');
assert(/collectWinnerQueries_/.test(engineSrc), 'WinnerIntent still uses Query×Page');

console.log('PASS scripts/test-page-performance.js');
