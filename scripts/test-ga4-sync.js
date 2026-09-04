/**
 * G027 P3 — GA4 Central Sync local acceptance.
 * Run: node scripts/test-ga4-sync.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var root = path.join(__dirname, '..');
var controlTier1 = path.join(
  '/Users/lanling/Code/ai-work-rules/projects/game-search-opportunity-engine/contracts/site-data-v1/tier1-countries.v1.json'
);
var localTier1 = path.join(root, 'contracts/site-data-v1/tier1-countries.v1.json');

var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var ga4Src = fs.readFileSync(path.join(root, 'Ga4Sync.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');
var appsscript = JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));

function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function ' + name);
  var next = src.indexOf('\nfunction ', start + 1);
  return next >= 0 ? src.slice(start, next) : src.slice(start);
}

function extractArrayLiteral(src, varName) {
  var re = new RegExp('var\\s+' + varName + '\\s*=\\s*\\[([\\s\\S]*?)\\];');
  var m = src.match(re);
  assert(m, 'missing array ' + varName);
  return m[1]
    .split(',')
    .map(function (s) {
      return s.replace(/['"\s]/g, '');
    })
    .filter(Boolean);
}

// --- 1. Tier-1 SoT: control plane JSON == local copy == Config.gs freeze ---
var controlJson = JSON.parse(fs.readFileSync(controlTier1, 'utf8'));
var localJson = JSON.parse(fs.readFileSync(localTier1, 'utf8'));
assert(
  JSON.stringify(controlJson.countries) === JSON.stringify(localJson.countries),
  'local tier1 copy must match control-plane contract'
);
var frozen = extractArrayLiteral(configSrc, 'GA4_TIER1_COUNTRIES_V1');
assert(
  JSON.stringify(frozen) === JSON.stringify(controlJson.countries),
  'GA4_TIER1_COUNTRIES_V1 must match contracts/site-data-v1/tier1-countries.v1.json'
);
assert(configSrc.indexOf('GA4_TIER1_DEFINITION_REF') >= 0, 'tier1 definition ref present');
assert(configSrc.indexOf('GA4_DATA_LAG_DAYS') >= 0, 'GA4 lag constant present');

// --- 2. Sheets / headers / scopes / wiring ---
assert(configSrc.indexOf("GA4_DAILY: 'GA4_DAILY'") >= 0, 'GA4_DAILY sheet name');
assert(configSrc.indexOf("GA4_COUNTRY: 'GA4_COUNTRY'") >= 0, 'GA4_COUNTRY sheet name');
assert(configSrc.indexOf("GA4_SITE_ROLLUP: 'GA4_SITE_ROLLUP'") >= 0, 'GA4_SITE_ROLLUP sheet name');
assert(configSrc.indexOf("'ga4_property_id'") >= 0, 'site config ga4_property_id column');
assert(sheetSrc.indexOf('ga4PropertyId') >= 0, 'getEnabledSites exposes ga4PropertyId');
assert(sheetSrc.indexOf('SHEET_NAMES.GA4_DAILY') >= 0, 'setup creates GA4_DAILY');
assert(appsscript.oauthScopes.indexOf('https://www.googleapis.com/auth/analytics.readonly') >= 0, 'analytics.readonly scope');
assert(codeSrc.indexOf('runGa4CentralSync') >= 0, 'menu entry');
var finalizer = extractFn(codeSrc, 'runDailyFinalizerUnlocked_');
assert(/runGa4CentralSync_/.test(finalizer), 'finalizer calls GA4 sync');
assert(/GA4_CENTRAL_SYNC_BATCH_FAILED/.test(finalizer), 'GA4 batch failure does not throw into GSC');
assert(finalizer.indexOf('runDecisionEngine') < finalizer.indexOf('runGa4CentralSync_'), 'GA4 after GSC engines start path still has engines first');

// --- 3. VM: property validation, parse, rollup, skip, failure isolation, idempotency ---
var sandbox = {
  GA4_TIER1_COUNTRIES_V1: frozen.slice(),
  GA4_TIER1_DEFINITION_REF: 'contracts/site-data-v1/tier1-countries.v1.json',
  GA4_SENTINELS: { UNKNOWN: 'UNKNOWN', MISSING: 'MISSING', DISABLED: 'DISABLED' },
  GA4_DATA_LAG_DAYS: 2,
  GA4_SYNC_LOOKBACK_DAYS: 35,
  GA4_ROLLUP_WINDOW_7D: 7,
  GA4_ROLLUP_WINDOW_30D: 30,
  SHEET_NAMES: {
    GA4_DAILY: 'GA4_DAILY',
    GA4_COUNTRY: 'GA4_COUNTRY',
    GA4_SITE_ROLLUP: 'GA4_SITE_ROLLUP',
    SITES: '站点配置',
    LOG: '运行日志'
  },
  GA4_DAILY_HEADERS: ['site_id', 'date', 'sessions', 'synced_at'],
  GA4_COUNTRY_HEADERS: ['site_id', 'date', 'country', 'sessions', 'synced_at'],
  GA4_SITE_ROLLUP_HEADERS: [
    'site_id',
    'as_of',
    'production_url',
    'ga4_sessions_7d',
    'ga4_sessions_30d',
    'tier1_sessions_30d',
    'tier1_share_30d',
    'status',
    'error',
    'synced_at'
  ],
  console: console,
  Logger: { log: function () {} }
};

function addDaysToDateStr_(yyyyMmDd, deltaDays) {
  var p = String(yyyyMmDd).split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2]);
  d.setDate(d.getDate() + Number(deltaDays || 0));
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}
function toDateStr_(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.substring(0, 10);
  return '';
}
function normalizeKeyDate_(v) {
  return toDateStr_(v);
}
function todayStr_() {
  return '2026-09-04';
}

sandbox.addDaysToDateStr_ = addDaysToDateStr_;
sandbox.toDateStr_ = toDateStr_;
sandbox.normalizeKeyDate_ = normalizeKeyDate_;
sandbox.todayStr_ = todayStr_;
sandbox.writeLog_ = function () {};

var store = {
  GA4_DAILY: [],
  GA4_COUNTRY: [],
  GA4_SITE_ROLLUP: []
};

sandbox.ensureGa4Sheets_ = function () {};
sandbox.getSpreadsheet_ = function () {
  return {
    getSheetByName: function (name) {
      if (name === '站点配置') {
        return {
          getLastColumn: function () {
            return 8;
          },
          getRange: function () {
            return { getValues: function () { return [['x']]; }, setValues: function () {}, setFontWeight: function () {} };
          }
        };
      }
      return {
        getLastRow: function () {
          return (store[name] || []).length + 1;
        },
        getRange: function () {
          return {
            getValues: function () {
              return store[name] || [];
            },
            setValues: function (rows) {
              /* update handled in upsert stub */
            }
          };
        },
        appendRow: function () {}
      };
    }
  };
};
sandbox.ensureSheet_ = function () {};
sandbox.ensureSheetHeaders_ = function () {};
sandbox.upsertRow_ = function (sheetName, headers, row, keyFn) {
  var rows = store[sheetName] || (store[sheetName] = []);
  var key = keyFn(row);
  for (var i = 0; i < rows.length; i++) {
    if (keyFn(rows[i]) === key) {
      rows[i] = row.slice();
      return { action: 'update', rowIndex: i + 2 };
    }
  }
  rows.push(row.slice());
  return { action: 'insert', rowIndex: rows.length + 1 };
};

var context = vm.createContext(sandbox);
vm.runInContext(
  [
    extractFn(ga4Src, 'getGa4Tier1Countries_'),
    extractFn(ga4Src, 'getGa4Tier1CountrySet_'),
    extractFn(ga4Src, 'ga4LatestCompleteDateStr_'),
    extractFn(ga4Src, 'isGa4Sentinel_'),
    extractFn(ga4Src, 'normalizeGa4PropertyId_'),
    extractFn(ga4Src, 'normalizeGa4ApiDate_'),
    extractFn(ga4Src, 'parseGa4DatedMetricRows_'),
    extractFn(ga4Src, 'parseGa4CountryMetricRows_'),
    extractFn(ga4Src, 'sumGa4SessionsInWindow_'),
    extractFn(ga4Src, 'sumGa4Tier1SessionsInWindow_'),
    extractFn(ga4Src, 'computeTier1Share_'),
    extractFn(ga4Src, 'computeGa4SiteRollupFromFacts_'),
    extractFn(ga4Src, 'upsertGa4DailyRow_'),
    extractFn(ga4Src, 'upsertGa4CountryRow_'),
    extractFn(ga4Src, 'upsertGa4SiteRollupRow_'),
    extractFn(ga4Src, 'findGa4SiteRollupRow_'),
    extractFn(ga4Src, 'writeGa4DailyFacts_'),
    extractFn(ga4Src, 'writeGa4CountryFacts_'),
    extractFn(ga4Src, 'preserveGa4RollupOnFailure_'),
    extractFn(ga4Src, 'fetchGa4DailySessions_'),
    extractFn(ga4Src, 'fetchGa4CountrySessions_'),
    extractFn(ga4Src, 'syncGa4ForSite_'),
    extractFn(ga4Src, 'runGa4CentralSync_')
  ].join('\n'),
  context
);

assert(context.normalizeGa4PropertyId_('123456789') === '123456789', 'numeric property ok');
assert(context.normalizeGa4PropertyId_('G-ABCDEF12') === '', 'measurement id rejected');
assert(context.normalizeGa4PropertyId_('UNKNOWN') === '', 'UNKNOWN skipped');
assert(context.normalizeGa4PropertyId_('MISSING') === '', 'MISSING skipped');
assert(context.normalizeGa4PropertyId_('DISABLED') === '', 'DISABLED skipped');
assert(context.ga4LatestCompleteDateStr_() === '2026-09-02', 'lag=2 latest complete');

var apiDaily = {
  rows: [
    { dimensionValues: [{ value: '20260901' }], metricValues: [{ value: '10' }] },
    { dimensionValues: [{ value: '2026-09-02' }], metricValues: [{ value: '20' }] }
  ]
};
var parsedDaily = context.parseGa4DatedMetricRows_(apiDaily, 'sessions');
assert(parsedDaily.length === 2 && parsedDaily[0].date === '2026-09-01', 'date normalize YYYYMMDD');
assert(parsedDaily[1].sessions === 20, 'sessions parsed');

var apiCountry = {
  rows: [
    {
      dimensionValues: [{ value: '2026-09-01' }, { value: 'US' }],
      metricValues: [{ value: '7' }]
    },
    {
      dimensionValues: [{ value: '2026-09-01' }, { value: 'GB' }],
      metricValues: [{ value: '3' }]
    },
    {
      dimensionValues: [{ value: '2026-09-02' }, { value: 'JP' }],
      metricValues: [{ value: '5' }]
    },
    {
      dimensionValues: [{ value: '2026-09-02' }, { value: 'BR' }],
      metricValues: [{ value: '4' }]
    }
  ]
};
var parsedCountry = context.parseGa4CountryMetricRows_(apiCountry, 'sessions');
assert(parsedCountry.length === 4, 'country rows parsed');

var tier1Set = context.getGa4Tier1CountrySet_();
assert(tier1Set.US && tier1Set.GB && !tier1Set.BR, 'tier1 set from contract');

// Build 30d fixture ending 2026-09-02
var dailyFacts = [];
var countryFacts = [];
for (var d = 0; d < 30; d++) {
  var day = addDaysToDateStr_('2026-09-02', -(29 - d));
  dailyFacts.push({ date: day, sessions: 10 });
  countryFacts.push({ date: day, country: 'US', sessions: 6 });
  countryFacts.push({ date: day, country: 'BR', sessions: 4 });
}
var rollup = context.computeGa4SiteRollupFromFacts_(dailyFacts, countryFacts, '2026-09-02', tier1Set);
assert(rollup.ga4_sessions_7d === 70, '7D sessions=70 got ' + rollup.ga4_sessions_7d);
assert(rollup.ga4_sessions_30d === 300, '30D sessions=300 got ' + rollup.ga4_sessions_30d);
assert(rollup.tier1_sessions_30d === 180, 'tier1 30D=180 got ' + rollup.tier1_sessions_30d);
assert(rollup.tier1_share_30d === 0.6, 'tier1 share=0.6 got ' + rollup.tier1_share_30d);

function fakeFetch(propertyId, body) {
  assert(/^\d+$/.test(propertyId), 'API uses numeric property id');
  var dims = (body.dimensions || []).map(function (d) {
    return d.name;
  });
  if (dims.length === 1 && dims[0] === 'date') {
    return {
      rows: dailyFacts.map(function (r) {
        return {
          dimensionValues: [{ value: r.date }],
          metricValues: [{ value: String(r.sessions) }]
        };
      })
    };
  }
  return {
    rows: countryFacts.map(function (r) {
      return {
        dimensionValues: [{ value: r.date }, { value: r.country }],
        metricValues: [{ value: String(r.sessions) }]
      };
    })
  };
}

store.GA4_DAILY = [];
store.GA4_COUNTRY = [];
store.GA4_SITE_ROLLUP = [];

var okSite = {
  name: 'Fixture OK',
  siteId: 'fixture-ok',
  propertyUrl: 'https://fixture-ok.example/',
  ga4PropertyId: '999001'
};
var ok = context.syncGa4ForSite_(okSite, {
  asOf: '2026-09-02',
  startDate: addDaysToDateStr_('2026-09-02', -34),
  fetchReport: fakeFetch,
  syncedAt: '2026-09-04T00:00:00Z',
  tier1Set: tier1Set
});
assert(ok.status === 'OK', 'normal property OK');
assert(ok.ga4_sessions_30d === 300, 'site sync 30d');
assert(store.GA4_DAILY.length === 30, 'daily rows written');
assert(store.GA4_COUNTRY.length === 60, 'country rows written');

// Idempotent rerun
var beforeDaily = store.GA4_DAILY.length;
var beforeCountry = store.GA4_COUNTRY.length;
context.syncGa4ForSite_(okSite, {
  asOf: '2026-09-02',
  startDate: addDaysToDateStr_('2026-09-02', -34),
  fetchReport: fakeFetch,
  syncedAt: '2026-09-04T01:00:00Z',
  tier1Set: tier1Set
});
assert(store.GA4_DAILY.length === beforeDaily, 'daily rerun idempotent');
assert(store.GA4_COUNTRY.length === beforeCountry, 'country rerun idempotent');
assert(store.GA4_SITE_ROLLUP.length === 1, 'rollup upsert by site_id');

// SKIPPED sentinels / measurement id
var skippedSites = [
  { name: 'A', siteId: 's-a', propertyUrl: 'https://a.example/', ga4PropertyId: 'UNKNOWN' },
  { name: 'B', siteId: 's-b', propertyUrl: 'https://b.example/', ga4PropertyId: 'MISSING' },
  { name: 'C', siteId: 's-c', propertyUrl: 'https://c.example/', ga4PropertyId: 'G-ABC' },
  { name: 'D', siteId: 's-d', propertyUrl: 'https://d.example/', ga4PropertyId: '' }
];
var batch = context.runGa4CentralSync_(
  [okSite].concat(skippedSites).concat([
    {
      name: 'Failing',
      siteId: 's-fail',
      propertyUrl: 'https://fail.example/',
      ga4PropertyId: '999002'
    }
  ]),
  {
    asOf: '2026-09-02',
    lookbackDays: 35,
    syncedAt: '2026-09-04T02:00:00Z',
    fetchReport: function (propertyId, body) {
      if (propertyId === '999002') throw new Error('simulated GA4 API failure');
      return fakeFetch(propertyId, body);
    }
  }
);
assert(batch.ok === 1, 'batch ok=1 got ' + batch.ok);
assert(batch.skipped === 4, 'batch skipped=4 got ' + batch.skipped);
assert(batch.failed === 1, 'batch failed=1 got ' + batch.failed);

// Failure must not zero prior OK metrics for fixture-ok
var okRollup = store.GA4_SITE_ROLLUP.filter(function (r) {
  return r[0] === 'fixture-ok';
})[0];
assert(okRollup && okRollup[4] === 300, 'prior OK metrics preserved across batch');

// Seed an OK rollup then fail same site — metrics preserved
store.GA4_SITE_ROLLUP.push([
  's-preserve',
  '2026-09-01',
  'https://preserve.example/',
  11,
  22,
  9,
  0.4,
  'OK',
  '',
  't0'
]);
context.preserveGa4RollupOnFailure_(
  { siteId: 's-preserve', propertyUrl: 'https://preserve.example/' },
  '2026-09-02',
  't1',
  'boom'
);
var preserved = store.GA4_SITE_ROLLUP.filter(function (r) {
  return r[0] === 's-preserve';
})[0];
assert(preserved[4] === 22 && preserved[7] === 'FAILED', 'failure preserves sessions, marks FAILED');
assert(preserved[3] === 11, '7d preserved');

// Journey fields available without GSC clicks
assert(ga4Src.indexOf('getGa4JourneyReadyRows_') >= 0, 'journey-ready reader exists');
assert(!/clicks/i.test(extractFn(ga4Src, 'getGa4JourneyReadyRows_')), 'journey reader has no GSC clicks fallback');

console.log('test-ga4-sync: PASS');
console.log(
  JSON.stringify(
    {
      tier1_countries: frozen.length,
      batch_ok: batch.ok,
      batch_skipped: batch.skipped,
      batch_failed: batch.failed,
      sample_rollup: {
        ga4_sessions_7d: rollup.ga4_sessions_7d,
        ga4_sessions_30d: rollup.ga4_sessions_30d,
        tier1_sessions_30d: rollup.tier1_sessions_30d,
        tier1_share_30d: rollup.tier1_share_30d
      }
    },
    null,
    2
  )
);
