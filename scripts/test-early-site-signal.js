/** Goal 1 Early Site Signal pure aggregation, rules, confidence, and debounce tests. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

var root = path.join(__dirname, '..');
var config = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var engine = fs.readFileSync(path.join(root, 'EarlySiteSignalEngine.gs'), 'utf8');

function extractAssign(src, name) {
  var re = new RegExp('var ' + name + '\\s*=\\s*([\\s\\S]*?);\\s*\\n(?:var |/\\*|function )');
  var match = src.match(re);
  assert(match, 'missing config ' + name);
  return eval('(' + match[1] + ')');
}

var statusHeaders = extractAssign(config, 'SITE_STATUS_HEADERS');
var rulesRows = extractAssign(config, 'DEFAULT_DECISION_RULES');
var ruleKeys = {};
rulesRows.forEach(function (row) { ruleKeys[row[0]] = row[1]; });
[
  'EARLY_SIGNAL_MAX_DAY',
  'EARLY_WINNER_MIN_24H_IMPRESSIONS',
  'EARLY_WINNER_MIN_CLICKS',
  'EARLY_WINNER_MIN_GUIDE_QUERIES',
  'EARLY_WATCH_MIN_IMPRESSIONS',
  'EARLY_TOP10_MIN_QUERIES',
  'EARLY_TOP20_MIN_QUERIES',
  'EARLY_MIN_INTENT_CLUSTERS',
  'EARLY_SIGNAL_COOLDOWN_HOURS',
  'EARLY_DOWNGRADE_CONFIRM_RUNS'
].forEach(function (key) { assert(ruleKeys[key] !== undefined, 'rule configured: ' + key); });
[
  'EarlySignalStatus', 'EarlySignalConfidence', 'RealtimeImpressions24H',
  'RealtimeClicks24H', 'RealtimeGuideQueries', 'RealtimeTop10Queries',
  'RealtimeTop20Queries', 'RealtimeIntentClusters', 'EarlySignalUpdatedAt',
  'EarlySignalReason'
].forEach(function (header) {
  assert(statusHeaders.indexOf(header) >= 0, 'status field: ' + header);
});

var context = {
  EARLY_SIGNAL_STATUSES: { EARLY_WINNER: 'EARLY_WINNER', WATCH: 'WATCH', NO_SIGNAL: 'NO_SIGNAL' },
  EARLY_SIGNAL_RANKS: { EARLY_WINNER: 0, WATCH: 1, NO_SIGNAL: 2 },
  EARLY_SIGNAL_CONFIDENCES: { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' },
  matchGuideIntentCategories_: function (query) {
    return /guide|fuse|200\s*kg/i.test(String(query || '')) ? ['guide'] : [];
  }
};
vm.createContext(context);
vm.runInContext(engine, context);

var site = { name: 'Project P.I.T.T.', siteId: 'project-pitt', propertyUrl: 'https://project-pitt.example/' };
var snapshot = {
  site: site,
  cutoffHour: '2026-08-24T08:00:00Z',
  incomplete: true,
  clusters: [
    {
      key: 'QUERY_200KG',
      impressions: 120,
      clicks: 3,
      position: 8,
      queryCount: 2,
      queries: [
        { query: 'project pitt 200kg guide', impressions: 80, clicks: 2, position: 7 },
        { query: 'project pitt 200 kg', impressions: 40, clicks: 1, position: 10 }
      ]
    },
    {
      key: 'QUERY_FUSES',
      impressions: 40,
      clicks: 1,
      position: 12,
      queryCount: 2,
      queries: [
        { query: 'project pitt fuses guide', impressions: 25, clicks: 1, position: 11 },
        { query: 'project pitt fuse box', impressions: 15, clicks: 0, position: 14 }
      ]
    }
  ]
};

var aggregate = context.buildEarlySiteSignalAggregate_(snapshot, site);
assert(aggregate.impressions24h === 160, '24h impressions aggregate');
assert(aggregate.clicks24h === 4, '24h clicks aggregate');
assert(aggregate.queryCount24h === 4, 'query count aggregate');
assert(aggregate.guideQueryCount24h === 4, 'guide query classification reuses helper');
assert(aggregate.clickedQueryCount === 3, 'clicked query count');
assert(aggregate.top10QueryCount === 2, 'top10 query count');
assert(aggregate.top20QueryCount === 4, 'top20 query count');
assert(aggregate.intentClusterCount === 2, 'intent cluster count');
assert(aggregate.dataIncomplete === true, 'incomplete flag');

var rules = {};
rulesRows.forEach(function (row) { rules[row[0]] = Number(row[1]); });
var candidate = context.classifyEarlySiteSignal_(aggregate, rules);
assert(candidate.status === 'EARLY_WINNER', 'PITT winner status');
assert(candidate.rule.indexOf('A') >= 0, 'Rule A matched');
assert(candidate.rule.indexOf('B') >= 0, 'Rule B matched');
assert(candidate.rule.indexOf('C') >= 0, 'Rule C matched');
assert(
  context.classifyEarlySignalConfidence_(aggregate, candidate.status) === 'HIGH',
  'strong multi-query incomplete signal can be HIGH'
);

var firstDowngrade = context.resolveEarlySignalState_('EARLY_WINNER', 'WATCH', 0, 2);
assert(firstDowngrade.status === 'EARLY_WINNER', 'first downgrade is debounced');
assert(firstDowngrade.downgradeRuns === 1, 'first downgrade confirmation count');
var secondDowngrade = context.resolveEarlySignalState_('EARLY_WINNER', 'WATCH', 1, 2);
assert(secondDowngrade.status === 'WATCH', 'second downgrade applies');
assert(secondDowngrade.downgradeRuns === 0, 'downgrade counter resets');
var upgrade = context.resolveEarlySignalState_('WATCH', 'EARLY_WINNER', 1, 2);
assert(upgrade.status === 'EARLY_WINNER', 'upgrade is immediate');
var merged = context.mergeEarlySignalSnapshots_(
  [{ site: { name: 'Fresh Site' } }],
  [{ site: { name: 'Project P.I.T.T.' } }]
);
assert(merged.length === 2, 'live snapshot fallback merges with fresh snapshots');

console.log(JSON.stringify({
  aggregate: {
    impressions24h: aggregate.impressions24h,
    clicks24h: aggregate.clicks24h,
    guideQueryCount24h: aggregate.guideQueryCount24h,
    top10QueryCount: aggregate.top10QueryCount,
    top20QueryCount: aggregate.top20QueryCount,
    intentClusterCount: aggregate.intentClusterCount
  },
  status: candidate.status,
  confidence: context.classifyEarlySignalConfidence_(aggregate, candidate.status)
}, null, 2));
console.log('PASS scripts/test-early-site-signal.js');
