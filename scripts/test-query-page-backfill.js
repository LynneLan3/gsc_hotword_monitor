/**
 * B1-D2 本地自测：Query页面明细历史补采（不依赖 SpreadsheetApp / GSC API）。
 * 运行：node scripts/test-query-page-backfill.js
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
var portfolioSrc = fs.readFileSync(path.join(root, 'PortfolioEngine.gs'), 'utf8');

function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function ' + name);
  var next = src.indexOf('\nfunction ', start + 1);
  return next >= 0 ? src.slice(start, next) : src.slice(start);
}

// --- 1. backfill 会调用 query-page fetch ---
assert(/function upsertQueryPageDetailsForDate_/.test(codeSrc), 'upsert helper');
assert(
  /fetchFreshQueryPages\(propertyUrl, dataDate, QUERY_ROW_LIMIT\)/.test(
    extractFn(codeSrc, 'upsertQueryPageDetailsForDate_')
  ),
  'single-day write uses fetchFreshQueryPages'
);
assert(
  /upsertQueryPageDetailsForDate_/.test(extractFn(codeSrc, 'backfillQueryPageDetailsForSite_')),
  'site backfill uses query-page write helper'
);
assert(
  /backfillQueryPageDetailsForSite_/.test(extractFn(codeSrc, 'backfillSite_')),
  'backfillSite_ now writes Query页面明细'
);

// --- 2. 返回行会写入 Query页面明细 ---
assert(
  /upsertQueryPageRow_/.test(extractFn(codeSrc, 'upsertQueryPageDetailsForDate_')),
  'API rows upsert into Query页面明细'
);
assert(
  /DataDate \+ Site \+ Query \+ PageURL/.test(sheetSrc) ||
    /normalizeKeyDate_\(r\[0\]\)[\s\S]*r\[1\][\s\S]*r\[2\][\s\S]*r\[3\]/.test(
      extractFn(sheetSrc, 'upsertQueryPageRow_')
    ),
  'upsert key is DataDate+Site+Query+PageURL'
);

// --- 3. 重复执行仍使用 upsert，不重复累计 ---
function queryPageKey(row) {
  return row[0] + '||' + row[1] + '||' + row[2] + '||' + row[3];
}

function simulateUpsertQueryPages(store, dataDate, siteName, apiRows) {
  var inserted = 0;
  var updated = 0;
  for (var i = 0; i < apiRows.length; i++) {
    var qr = apiRows[i];
    if (!qr || !qr.query || !qr.page) continue;
    var row = [
      dataDate,
      siteName,
      qr.query,
      qr.page,
      qr.pagePath || '/',
      qr.clicks || 0,
      qr.impressions || 0,
      qr.ctr || 0,
      qr.position || 0
    ];
    var key = queryPageKey(row);
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

var store = {};
var dayA = [
  {
    query: 'agefield high classes',
    page: 'https://example.test/classes/',
    pagePath: '/classes/',
    clicks: 4,
    impressions: 80
  }
];
var first = simulateUpsertQueryPages(store, '2026-08-10', 'Agefield', dayA);
assert(first.inserted === 1 && first.updated === 0, 'first write inserts');
var again = simulateUpsertQueryPages(
  store,
  '2026-08-10',
  'Agefield',
  [
    {
      query: 'agefield high classes',
      page: 'https://example.test/classes/',
      pagePath: '/classes/',
      clicks: 6,
      impressions: 90
    }
  ]
);
assert(again.inserted === 0 && again.updated === 1, 'repeat uses upsert');
assert(Object.keys(store).length === 1, 'repeat does not duplicate rows');
assert(store[Object.keys(store)[0]][5] === 6, 'upsert replaces clicks, does not add');

// --- 4. 单日为空不会删除已有其它日期数据 ---
var emptyDay = simulateUpsertQueryPages(store, '2026-08-11', 'Agefield', []);
assert(emptyDay.inserted === 0 && emptyDay.updated === 0, 'empty day writes nothing');
assert(Object.keys(store).length === 1, 'empty day does not delete other dates');
assert(store[Object.keys(store)[0]][0] === '2026-08-10', 'prior date retained');

var later = simulateUpsertQueryPages(
  store,
  '2026-08-12',
  'Agefield',
  [
    {
      query: 'agefield high',
      page: 'https://example.test/',
      pagePath: '/',
      clicks: 2,
      impressions: 40
    }
  ]
);
assert(later.inserted === 1, 'later date inserts separately');
assert(Object.keys(store).length === 2, 'two dates coexist');
simulateUpsertQueryPages(store, '2026-08-11', 'Agefield', []);
assert(Object.keys(store).length === 2, 'second empty day still preserves both dates');

// --- 5. 原有 runDaily fresh Query×Page 行为不变 ---
assert(/syncFreshQueryPageDetails_/.test(codeSrc), 'runDaily still syncs Query×Page');
assert(
  /syncFreshQueryPageDetails_\(siteName, propertyUrl, runDate\)/.test(
    extractFn(codeSrc, 'processSiteDaily_')
  ),
  'daily path still calls syncFreshQueryPageDetails_'
);
var freshFn = extractFn(codeSrc, 'syncFreshQueryPageDetails_');
assert(/getFreshQueryDateRange_\(runDate\)/.test(freshFn), 'daily still uses fresh 5-day range');
assert(/upsertQueryPageDetailsForDate_/.test(freshFn), 'daily reuses the same write helper');
assert(/listDatesInclusive_/.test(freshFn), 'daily still walks inclusive fresh dates');

// --- 6. FRESH_QUERY_DAYS 仍保持 5 ---
var freshDays = configSrc.match(/var FRESH_QUERY_DAYS\s*=\s*(\d+)/);
assert(freshDays && Number(freshDays[1]) === 5, 'FRESH_QUERY_DAYS remains 5');
assert(!/FRESH_QUERY_DAYS\s*=\s*7/.test(configSrc), 'must not raise daily fresh window to 7');
assert(/var BACKFILL_DAYS\s*=\s*14/.test(configSrc), 'backfill window remains 14');

// Independent entry: Query页面明细 only
var independentFn = extractFn(codeSrc, 'backfillQueryPageDetails14Days');
assert(/gscTodayStr_\(\)/.test(independentFn), 'independent uses existing GSC today helper');
assert(
  /gscDaysAgoStr_\(BACKFILL_DAYS - 1\)/.test(independentFn),
  'independent uses same 14-day start as backfill14Days'
);
assert(!/upsertDailyRow_/.test(independentFn), 'independent must not write GSC日数据');
assert(!/upsertQueryRow_/.test(independentFn), 'independent must not write Query明细');
assert(!/runDecisionEngine/.test(independentFn), 'independent must not run Decision');
assert(!/runPortfolioEngine/.test(independentFn), 'independent must not run Portfolio');
assert(
  /backfillQueryPageDetailsForSite_/.test(independentFn),
  'independent delegates to site Query×Page backfill'
);

var siteBackfillFn = extractFn(codeSrc, 'backfillQueryPageDetailsForSite_');
assert(/fetchDateRows/.test(siteBackfillFn), 'site backfill reuses existing date discovery');
assert(/catch \(e\)/.test(siteBackfillFn), 'per-day failure continues');
assert(!/clear\(|deleteRow|getRange\(2[\s\S]*clearContent/.test(siteBackfillFn), 'must not wipe sheet');

// No pagination this round
assert(!/startRow/.test(extractFn(searchSrc, 'fetchFreshQueryPages')), 'no pagination on fetch');
assert(!/startRow/.test(extractFn(codeSrc, 'upsertQueryPageDetailsForDate_')), 'no startRow in writer');

// Menu
assert(
  /补采14天Query页面明细',\s*'backfillQueryPageDetails14Days'/.test(codeSrc),
  'menu item for independent backfill'
);

// Portfolio rules untouched
assert(/function findWinnerPage_/.test(portfolioSrc), 'winner function still present');
var winnerFn = extractFn(portfolioSrc, 'findWinnerPage_');
assert(/lead\.clicks < 1/.test(winnerFn), 'winner click floor unchanged');

console.log('PASS scripts/test-query-page-backfill.js');
