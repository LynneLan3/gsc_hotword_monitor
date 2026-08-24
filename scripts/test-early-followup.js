/** Goal 2 Early Winner follow-up signal fixtures. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

var root = path.join(__dirname, '..');
var config = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var engine = fs.readFileSync(path.join(root, 'EarlyFollowupEngine.gs'), 'utf8');
var fresh = fs.readFileSync(path.join(root, 'FreshQueryMonitor.gs'), 'utf8');

function extractAssign(src, name) {
  var re = new RegExp('var ' + name + '\\s*=\\s*([\\s\\S]*?);\\s*\\n(?:var |/\\*|function )');
  var match = src.match(re);
  assert(match, 'missing config ' + name);
  return eval('(' + match[1] + ')');
}

var rulesRows = extractAssign(config, 'DEFAULT_DECISION_RULES');
var rules = {};
rulesRows.forEach(function (row) { rules[row[0]] = Number(row[1]); });
[
  'EARLY_FOLLOWUP_MAX_DAY', 'EARLY_QUERY_GROWTH_RATE',
  'EARLY_QUERY_GROWTH_MIN_PREVIOUS_IMPRESSIONS', 'EARLY_QUERY_GROWTH_MIN_ABSOLUTE_DELTA',
  'EARLY_NEW_INTENT_MIN_IMPRESSIONS', 'EARLY_NEW_INTENT_MAX_POSITION',
  'EARLY_PAGE_TAKEOVER_MIN_SHARE', 'EARLY_PAGE_SIGNAL_MIN_IMPRESSIONS',
  'EARLY_PAGE_MISMATCH_MIN_IMPRESSIONS', 'EARLY_PAGE_MISMATCH_DOMINANT_SHARE',
  'EARLY_PAGE_MISMATCH_CONFIRM_RUNS', 'EARLY_FOLLOWUP_SIGNAL_COOLDOWN_HOURS'
].forEach(function (key) { assert(rules[key] !== undefined, 'rule configured: ' + key); });

var intentHeaders = extractAssign(config, 'INTENT_OPPORTUNITY_HEADERS');
[
  'PreviousClusterImpressions', 'CurrentClusterImpressions', 'FollowupGrowthRate',
  'PreviousTopPage', 'ExpectedPage', 'CurrentTopPage', 'FollowupSignals',
  'FollowupConfidence', 'FollowupReason', 'FollowupFirstSeenAt', 'FollowupLastObservedAt'
].forEach(function (header) { assert(intentHeaders.indexOf(header) >= 0, 'Intent follow-up field: ' + header); });
assert(/runEarlyFollowupEngine/.test(fresh), 'Fresh pipeline calls follow-up engine');
assert(/earlySignalResult.records/.test(fresh), 'follow-up receives Early Winner records');

var context = {};
vm.createContext(context);
vm.runInContext(engine, context);

var site = { name: 'Project P.I.T.T.', day: 2 };
function cluster(key, impressions, clicks, position, topPage, share) {
  return {
    key: key,
    label: key,
    impressions: impressions,
    clicks: clicks,
    position: position,
    topPage: topPage,
    topPageShare: share
  };
}
function at(seconds) { return new Date(seconds * 1000); }

// A: 10 -> 20 satisfies both relative and absolute growth thresholds.
var base = context.evaluateEarlyFollowupObservation_(
  site, cluster('PITT_200KG', 10, 1, 5.2, '/', 1), null, false, rules, at(1), {}
);
assert(base.signals.length === 0, 'first observation establishes baseline only');
var growing = context.evaluateEarlyFollowupObservation_(
  site, cluster('PITT_200KG', 20, 2, 4.8, '/', 1), base.state, true, rules, at(2), {}
);
assert(growing.signals.indexOf('GROWING_INTENT') >= 0, '10 to 20 emits GROWING_INTENT');
var repeatedGrowth = context.evaluateEarlyFollowupObservation_(
  site, cluster('PITT_200KG', 20, 2, 4.8, '/', 1), growing.state, true, rules, at(3), {}
);
assert(repeatedGrowth.event === false, 'same signal does not emit a duplicate event');

// B: small sample growth does not trigger.
var smallBase = context.evaluateEarlyFollowupObservation_(
  site, cluster('SMALL', 2, 0, 30, '/', 1), null, false, rules, at(3), {}
);
var small = context.evaluateEarlyFollowupObservation_(
  site, cluster('SMALL', 3, 0, 30, '/', 1), smallBase.state, true, rules, at(4), {}
);
assert(small.signals.indexOf('GROWING_INTENT') < 0, '2 to 3 does not emit growth');

// C: a cluster introduced after baseline can become NEW_INTENT.
var newIntent = context.evaluateEarlyFollowupObservation_(
  site, cluster('NEW_CLUSTER', 6, 0, 18, '/', 1), null, true, rules, at(5), {}
);
assert(newIntent.signals.indexOf('NEW_INTENT') >= 0, 'new 6-impression cluster emits NEW_INTENT');

// D: first run for an existing cluster is not NEW_INTENT.
var firstExisting = context.evaluateEarlyFollowupObservation_(
  site, cluster('EXISTING', 20, 1, 8, '/', 1), null, false, rules, at(6), {}
);
assert(firstExisting.signals.indexOf('NEW_INTENT') < 0, 'first existing cluster observation is baseline');

var pageOpts = {
  expectedPageResolver: function () { return '/200kg-plate/'; },
  pageEvidenceResolver: function () { return { exists: true, valid: true }; }
};

// E: target page takeover is positive and requires a prior different page.
var takeoverBase = context.evaluateEarlyFollowupObservation_(
  site, cluster('TAKEOVER', 8, 1, 7, '/', 0.9), null, false, rules, at(7), pageOpts
);
var takeover = context.evaluateEarlyFollowupObservation_(
  site, cluster('TAKEOVER', 9, 1, 6, '/200kg-plate/', 0.8), takeoverBase.state, true, rules, at(8), pageOpts
);
assert(takeover.signals.indexOf('TARGET_PAGE_TAKES_OVER') >= 0, 'target page takeover signal');

// F: mismatch needs two consecutive dominant observations.
var mismatchBase = context.evaluateEarlyFollowupObservation_(
  site, cluster('MISMATCH', 10, 1, 8, '/', 0.8), null, false, rules, at(9), pageOpts
);
var mismatchFirst = context.evaluateEarlyFollowupObservation_(
  site, cluster('MISMATCH', 11, 1, 8, '/', 0.8), mismatchBase.state, true, rules, at(10), pageOpts
);
assert(mismatchFirst.signals.indexOf('PAGE_INTENT_MISMATCH') < 0, 'first mismatch confirmation is insufficient');
var mismatchSecond = context.evaluateEarlyFollowupObservation_(
  site, cluster('MISMATCH', 20, 1, 8, '/', 0.8), mismatchFirst.state, true, rules, at(11), pageOpts
);
assert(mismatchSecond.signals.indexOf('PAGE_INTENT_MISMATCH') >= 0, 'second mismatch confirmation emits signal');
assert(mismatchSecond.signals.indexOf('GROWING_INTENT') >= 0, 'signals can coexist');

// G: UNKNOWN expected page suppresses all page signals.
var unknown = context.evaluateEarlyFollowupObservation_(
  site, cluster('UNKNOWN', 12, 1, 8, '/', 0.8), mismatchBase.state, true, rules, at(12), {
    expectedPageResolver: function () { return ''; }
  }
);
assert(unknown.signals.indexOf('TARGET_PAGE_TAKES_OVER') < 0, 'UNKNOWN suppresses takeover');
assert(unknown.signals.indexOf('PAGE_INTENT_MISMATCH') < 0, 'UNKNOWN suppresses mismatch');

console.log(JSON.stringify({
  growing: growing.signals,
  newIntent: newIntent.signals,
  takeover: takeover.signals,
  mismatchFirst: mismatchFirst.signals,
  mismatchSecond: mismatchSecond.signals,
  unknown: unknown.signals
}, null, 2));
console.log('PASS scripts/test-early-followup.js');
