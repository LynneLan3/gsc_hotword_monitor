/**
 * INDEX_CHECK null / unavailable semantics.
 * Run: node scripts/test-index-check-null-semantics.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
const utilsSrc = fs.readFileSync(path.join(root, 'Utils.gs'), 'utf8');
const decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');

assert(!/if \(indexUnknown\) return true/.test(decisionSrc), 'must not treat unknown index as CHECK_INDEX');
assert(
  /Index audit unavailable \+ no observed search visibility/.test(decisionSrc),
  'fallback reason present'
);
assert(
  /null \/ missing \/ no-history index data must not be treated as IndexRate < 50%/.test(decisionSrc),
  'rate-based rule comment present'
);

const context = {
  console,
  Date,
  Math,
  JSON,
  Object,
  String,
  Number,
  Array,
  RegExp,
  Logger: { log() {} },
  writeLog_() {},
  Utilities: { formatDate() { return ''; } },
  Session: { getScriptTimeZone() { return 'UTC'; } }
};
vm.createContext(context);
vm.runInContext(configSrc, context);
vm.runInContext(utilsSrc, context);
vm.runInContext(decisionSrc, context);

const rules = {};
for (let i = 0; i < context.DEFAULT_DECISION_RULES.length; i++) {
  rules[context.DEFAULT_DECISION_RULES[i][0]] = Number(context.DEFAULT_DECISION_RULES[i][1]);
}

function base(over) {
  const m = {
    day: 7,
    indexedCount: '',
    indexRate: '',
    sitemapCount: 0,
    impressions24h: 0,
    impressions7d: 0,
    guideQueryCount7d: 0,
    queryCount7d: 0,
    top50QueryCount: 0,
    top30QueryCount: 0,
    top20QueryCount: 0,
    clicks7d: 0,
    hasGrowth: false,
    growth3d: 0,
    canExpandContent: false,
    intentCategoryCount: 0,
    realtimeImpressions24h: 0,
    realtimeClicks24h: 0,
    realtimeGuideQueries: 0,
    realtimeTop10Queries: 0,
    realtimeTop20Queries: 0,
    realtimeIntentClusters: 0
  };
  return Object.assign(m, over || {});
}

function decide(metrics) {
  const scores = context.computeDomainScores_(metrics, rules);
  const decision = context.decideRecommendedAction_(metrics, scores, rules);
  const reason = context.buildDecisionReason_(metrics, scores, decision, rules);
  return { scores, decision, reason };
}

const brigandine = decide(base({
  day: 7,
  indexedCount: null,
  realtimeImpressions24h: 236,
  realtimeClicks24h: 51,
  realtimeGuideQueries: 7,
  realtimeTop10Queries: 9,
  realtimeTop20Queries: 10,
  realtimeIntentClusters: 3
}));
assert.notEqual(brigandine.decision.action, 'CHECK_INDEX', 'Brigandine false positive action');
assert.notEqual(brigandine.decision.stage, 'INDEX_CHECK', 'Brigandine false positive stage');
assert.ok(!brigandine.reason.includes('Index Rate n/a，低于'), 'Brigandine n/a rate reason');
console.log('PASS case 1 Brigandine false positive', brigandine.decision.action, brigandine.decision.stage);

const pitt = decide(base({
  day: 9,
  indexedCount: '',
  impressions7d: 728,
  clicks7d: 34,
  realtimeImpressions24h: 198,
  realtimeClicks24h: 12,
  top20QueryCount: 17,
  top50QueryCount: 17,
  guideQueryCount7d: 5
}));
assert.notEqual(pitt.decision.action, 'CHECK_INDEX', 'PITT false positive action');
assert.notEqual(pitt.decision.stage, 'INDEX_CHECK', 'PITT false positive stage');
console.log('PASS case 2 Project P.I.T.T. false positive', pitt.decision.action, pitt.decision.stage);

const agefield = decide(base({
  day: 8,
  indexedCount: 6,
  sitemapCount: 13,
  indexRate: 6 / 13,
  impressions7d: 80,
  clicks7d: 4,
  guideQueryCount7d: 3,
  top20QueryCount: 3,
  top50QueryCount: 3
}));
assert.equal(agefield.decision.action, 'CHECK_INDEX', 'Agefield true low-index action');
assert.equal(agefield.decision.stage, 'INDEX_CHECK', 'Agefield true low-index stage');
assert.ok(agefield.reason.includes('低于'), 'Agefield rate reason');
console.log('PASS case 3 Agefield true low index', agefield.decision.action, agefield.reason);

const noVis = decide(base({
  day: 7,
  indexedCount: '',
  indexRate: '',
  sitemapCount: 0
}));
assert.equal(noVis.decision.action, 'CHECK_INDEX', 'no-visibility fallback action');
assert.ok(
  noVis.reason.includes('Index audit unavailable + no observed search visibility'),
  'no-visibility fallback reason'
);
assert.ok(!noVis.reason.includes('Index Rate n/a，低于'), 'no-visibility must not use n/a < 50%');
console.log('PASS case 4 no-index-data + no-search-visibility fallback', noVis.reason);

console.log('PASS scripts/test-index-check-null-semantics.js');
