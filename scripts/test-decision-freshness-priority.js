/** Regression coverage for the current Decision Engine failure. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var root = path.join(__dirname, '..');
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');
var context = {
  console: console,
  DEFAULT_DECISION_RULES: [
    ['DOMAIN_SCORE_PREPARE', 60],
    ['DOMAIN_SCORE_PROMOTE', 75],
    ['DOMAIN_MIN_DAY', 3],
    ['DOMAIN_MIN_INDEXED_URLS', 2],
    ['DOMAIN_MIN_7D_IMPRESSIONS', 30],
    ['DOMAIN_MIN_GUIDE_QUERIES', 2],
    ['FAST_TRACK_24H_IMPRESSIONS', 300],
    ['FAST_TRACK_GUIDE_QUERIES', 5],
    ['ARCHIVE_MIN_DAY', 14],
    ['ARCHIVE_MAX_7D_IMPRESSIONS', 10],
    ['INDEX_CHECK_DAY', 7],
    ['INDEX_RATE_WARNING', 0.5],
    ['CONTENT_OPTIMIZE_MIN_7D_IMPRESSIONS', 30],
    ['CONTENT_OPTIMIZE_MIN_GUIDE_QUERIES', 2],
    ['CONTENT_OPTIMIZE_MIN_CLICKS', 1]
  ],
  TODAY_ACTION_EXCLUDED: { WAIT: true, ARCHIVE: true },
  GUIDE_INTENT_CATEGORIES: [{ key: 'guide', terms: ['guide', 'wiki', 'walkthrough'] }],
  BRAND_TOKEN_STOPWORDS: { the: true, a: true, an: true, of: true, and: true, to: true, ii: true, iii: true },
  normalizeKeyDate_: function (v) {
    return v ? String(v).substring(0, 10) : '';
  },
  addDaysStr_: function (value, delta) {
    var p = String(value).split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    d.setUTCDate(d.getUTCDate() + Number(delta || 0));
    return d.toISOString().substring(0, 10);
  },
  parseDateOnly_: function (value) {
    var p = String(value).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  },
  formatDate_: function (value) {
    return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
  },
  percent_: function (a, b) { return b ? a / b : ''; },
  calcDayNumber_: function () { return 8; },
  getLatestKnownIndexStats_: function () { return null; }
};
vm.createContext(context);
vm.runInContext(decisionSrc, context);

var daily = [
  ['2026-09-08', 'Halloween', 1, 10],
  ['2026-09-09', 'Halloween', 2, 20],
  ['2026-09-10', 'Halloween', 5, 50]
];
var query = [
  ['2026-09-09', 'Halloween', 'halloween map guide', 2, 40, 0.05, 12]
];
var dates = context.resolveDecisionDataDates_(daily, query);
var metrics = context.computeAlignedMetrics_(
  daily,
  query,
  [],
  { name: 'Halloween' },
  dates.performanceDataDate,
  dates.queryDataDate
);
assert(dates.performanceDataDate === '2026-09-10', 'performance date uses latest daily');
assert(dates.queryDataDate === '2026-09-09', 'query date uses latest query');
assert(dates.decisionDataDate === '2026-09-10', 'compatibility date uses the newest source date');
assert(metrics.impressions7d === 80 && metrics.clicks7d === 8, 'fresh performance traffic survives query lag');
assert(metrics.queryCount7d === 1 && metrics.top20QueryCount === 1, 'query metrics use query date');

var mismatchReason = context.buildDecisionReason_(
  Object.assign(metrics, {
    day: 8,
    indexedCount: 1,
    sitemapCount: 10,
    indexRate: 0.1,
    dataMismatch: true,
    queryDataLag: true
  }),
  context.computeDomainScores_(metrics, {
    DOMAIN_MIN_INDEXED_URLS: 2,
    INDEX_RATE_WARNING: 0.5
  }),
  { action: 'CONTENT_OPTIMIZE', fastTrack: false },
  { INDEX_RATE_WARNING: 0.5 }
);
assert(/DATA_MISMATCH/.test(mismatchReason), 'reason marks data mismatch');
assert(/QUERY_DATA_LAG/.test(mismatchReason), 'reason marks query lag');

var highTrafficLowIndex = {
  day: 8,
  indexedCount: 1,
  indexRate: 0.1,
  sitemapCount: 10,
  impressions24h: 120,
  impressions7d: 500,
  previous3d: 100,
  latest3d: 400,
  clicks7d: 10,
  queryCount7d: 5,
  guideQueryCount7d: 5,
  top50QueryCount: 5,
  top30QueryCount: 4,
  top20QueryCount: 3,
  intentCategoryCount: 3,
  canExpandContent: false,
  hasGrowth: true,
  growth3d: 4
};
var rules = {
  DOMAIN_MIN_INDEXED_URLS: 2,
  DOMAIN_MIN_7D_IMPRESSIONS: 30,
  DOMAIN_MIN_GUIDE_QUERIES: 2,
  DOMAIN_SCORE_PREPARE: 60,
  DOMAIN_SCORE_PROMOTE: 75,
  DOMAIN_MIN_DAY: 3,
  INDEX_CHECK_DAY: 7,
  INDEX_RATE_WARNING: 0.5,
  ARCHIVE_MIN_DAY: 14,
  ARCHIVE_MAX_7D_IMPRESSIONS: 10,
  CONTENT_OPTIMIZE_MIN_7D_IMPRESSIONS: 30,
  CONTENT_OPTIMIZE_MIN_GUIDE_QUERIES: 2,
  CONTENT_OPTIMIZE_MIN_CLICKS: 1
};
var decision = context.decideRecommendedAction_(
  highTrafficLowIndex,
  context.computeDomainScores_(highTrafficLowIndex, rules),
  rules
);
assert(decision.action !== 'CHECK_INDEX', 'high traffic must not be hijacked by CHECK_INDEX');
assert(
  decision.action === 'DOMAIN_UPGRADE' || decision.action === 'DOMAIN_PREPARE' || decision.action === 'CONTENT_OPTIMIZE',
  'high traffic keeps a value action'
);

var oneSided = context.buildSiteMetrics_(
  { name: 'Halloween' },
  '2026-09-10',
  rules,
  daily,
  [],
  [],
  null
);
assert(oneSided.dataMismatch && oneSided.queryDataLag, 'missing query data is exposed as query lag');

console.log('PASS scripts/test-decision-freshness-priority.js');
