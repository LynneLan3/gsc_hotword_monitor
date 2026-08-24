/** Goal 3 Early Action Router fixtures A-L. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var routerSrc = fs.readFileSync(path.join(root, 'EarlyActionRouter.gs'), 'utf8');
var followupSrc = fs.readFileSync(path.join(root, 'EarlyFollowupEngine.gs'), 'utf8');
var intentSrc = fs.readFileSync(path.join(root, 'IntentOpportunityEngine.gs'), 'utf8');

function extractAssign(src, name) {
  var match = src.match(new RegExp('var ' + name + '\\s*=\\s*([\\s\\S]*?);\\s*\\n(?:var |/\\*|function )'));
  assert(match, 'missing ' + name);
  return eval('(' + match[1] + ')');
}

var ruleRows = extractAssign(configSrc, 'DEFAULT_DECISION_RULES');
var rules = {};
ruleRows.forEach(function (row) { rules[row[0]] = Number(row[1]); });
assert(rules.EARLY_RESEARCH_MIN_IMPRESSIONS === 10, 'research gate rule configured');

var context = {};
context.EARLY_ACTION_ROUTER_SIGNALS = extractAssign(configSrc, 'EARLY_ACTION_ROUTER_SIGNALS');
context.EXTERNAL_OPPORTUNITY_TYPES = extractAssign(configSrc, 'EXTERNAL_OPPORTUNITY_TYPES');
context.RESEARCH_TYPE = extractAssign(configSrc, 'RESEARCH_TYPE');
context.INTENT_FAMILY_ALIASES = extractAssign(configSrc, 'INTENT_FAMILY_ALIASES');
context.INTENT_CLUSTER_ENTITY_ALIASES = extractAssign(configSrc, 'INTENT_CLUSTER_ENTITY_ALIASES');
vm.createContext(context);
vm.runInContext(routerSrc, context);
vm.runInContext(intentSrc, context);
vm.runInContext(followupSrc, context);

var early = {
  site: 'Project P.I.T.T.',
  day: 2,
  status: 'EARLY_WINNER',
  confidence: 'HIGH',
  metrics: { impressions24h: 51, clicks24h: 5, guideQueryCount24h: 2, top10QueryCount: 5, top20QueryCount: 7 },
  reason: 'Early Winner / HIGH; realtime facts'
};

function followup(key, signals, values) {
  values = values || {};
  return {
    site: 'Project P.I.T.T.',
    day: values.day === undefined ? 2 : values.day,
    clusterKey: key,
    clusterLabel: values.label || key,
    signals: signals,
    confidence: values.confidence || 'HIGH',
    currentImpressions: values.impressions === undefined ? 12 : values.impressions,
    currentClicks: values.clicks === undefined ? 1 : values.clicks,
    currentPosition: values.position === undefined ? 8 : values.position,
    currentTopPage: values.topPage === undefined ? '/guide/' : values.topPage,
    expectedPage: values.expectedPage === undefined ? '' : values.expectedPage,
    currentTopPageShare: values.share === undefined ? 0.8 : values.share,
    observationCount: values.observationCount === undefined ? 2 : values.observationCount,
    opportunityStage: values.opportunityStage || '',
    intentType: values.intentType || '',
    reason: values.reason || signals.join('|') + ' reason'
  };
}

function plansFor(records, contexts, state, earlyOverride) {
  return context.buildEarlyActionPlans_({
    earlyRecords: [earlyOverride || early],
    followupRecords: records || [],
    clusterContexts: contexts || {},
    routerState: state || {},
    rules: rules,
    now: new Date('2026-08-24T00:00:00Z')
  });
}

// A: current EARLY_WINNER gets one automatic follow-up action and no job.
var siteWin = plansFor([], {}, {});
assert(siteWin.length === 1, 'A: one EARLY_SITE_WIN plan');
assert(siteWin[0].opportunityType === 'EARLY_SITE_WIN', 'A: early site win type');
assert(siteWin[0].recommendedAction === 'AUTO_FOLLOWUP', 'A: auto follow-up');
assert(siteWin[0].autoHandled === true && siteWin[0].createResearchJob === false, 'A: auto handled/no job');

// B: the same launch identity never creates a second EARLY_SITE_WIN.
var repeatedWin = plansFor([], {}, { [siteWin[0].actionKey]: { routed: true } });
assert(repeatedWin.length === 0, 'B: repeated site winner is deduped');

// C/D: growth routes by existing-page mapping.
var growingExisting = plansFor(
  [followup('GROW_EXISTING', ['GROWING_INTENT'])],
  { 'Project P.I.T.T.||GROW_EXISTING': { hasExistingPage: true, topPage: '/guide/' } },
  { 'EARLY_SITE_WIN:Project P.I.T.T.': { routed: true } }
);
assert(growingExisting.length === 1, 'C: one growth plan');
assert(growingExisting[0].opportunityType === 'EXPAND_EXISTING_PAGE', 'C: existing page opportunity');
assert(growingExisting[0].priority === 'P2' && growingExisting[0].createResearchJob, 'C: existing page P2 research');

var growingNew = plansFor(
  [followup('GROW_NEW', ['GROWING_INTENT'])],
  { 'Project P.I.T.T.||GROW_NEW': { hasExistingPage: false, topPage: '/' } },
  { 'EARLY_SITE_WIN:Project P.I.T.T.': { routed: true } }
);
assert(growingNew[0].opportunityType === 'NEW_PAGE_CANDIDATE', 'D: new page opportunity');
assert(growingNew[0].recommendedAction === 'RESEARCH_NEW_PAGE', 'D: new page research action');

// E/F: NEW_INTENT gate: 6 impression weak signal is observe-only; 12 is routable.
var weakNew = plansFor(
  [followup('NEW_WEAK', ['NEW_INTENT'], { impressions: 6, clicks: 0, confidence: 'MEDIUM' })],
  { 'Project P.I.T.T.||NEW_WEAK': { hasExistingPage: false, topPage: '/' } },
  { 'EARLY_SITE_WIN:Project P.I.T.T.': { routed: true } }
);
assert(weakNew.length === 1 && weakNew[0].signalState === 'OBSERVE', 'E: weak new intent is observe');
assert(weakNew[0].createTodayAction === false && weakNew[0].createResearchJob === false, 'E: weak new intent creates no action/job');

var strongNew = plansFor(
  [followup('NEW_STRONG', ['NEW_INTENT'], { impressions: 12, clicks: 0, confidence: 'MEDIUM' })],
  { 'Project P.I.T.T.||NEW_STRONG': { hasExistingPage: false, topPage: '/' } },
  { 'EARLY_SITE_WIN:Project P.I.T.T.': { routed: true } }
);
assert(strongNew[0].createTodayAction && strongNew[0].createResearchJob, 'F: strong new intent routes');

// G: NEW + GROWING coalesce into one action/opportunity/job.
var coalesced = plansFor(
  [followup('COEXIST', ['NEW_INTENT', 'GROWING_INTENT'], { impressions: 20 })],
  { 'Project P.I.T.T.||COEXIST': { hasExistingPage: true, topPage: '/guide/' } },
  { 'EARLY_SITE_WIN:Project P.I.T.T.': { routed: true } }
);
assert(coalesced.length === 1, 'G: coalesced plan count');
assert(coalesced[0].signals.join('|') === 'NEW_INTENT|GROWING_INTENT', 'G: signals preserved together');

// H: mismatch is P1 optimization research.
var mismatch = plansFor(
  [followup('MISMATCH', ['PAGE_INTENT_MISMATCH'], { impressions: 20, expectedPage: '/target/' })],
  { 'Project P.I.T.T.||MISMATCH': { hasExistingPage: true, topPage: '/' } },
  { 'EARLY_SITE_WIN:Project P.I.T.T.': { routed: true } }
);
assert(mismatch[0].opportunityType === 'OPTIMIZE_EXISTING_PAGE', 'H: mismatch optimization opportunity');
assert(mismatch[0].priority === 'P1' && mismatch[0].recommendedAction === 'CONTENT_OPTIMIZE', 'H: mismatch P1 action');
assert(mismatch[0].researchType === 'PAGE_OPTIMIZATION_RESEARCH', 'H: mismatch research type');

// I: takeover is saved but creates no action/job.
var takeover = plansFor(
  [followup('TAKEOVER', ['TARGET_PAGE_TAKES_OVER'], { expectedPage: '/target/', topPage: '/target/' })],
  { 'Project P.I.T.T.||TAKEOVER': { hasExistingPage: true, topPage: '/target/' } },
  { 'EARLY_SITE_WIN:Project P.I.T.T.': { routed: true } }
);
assert(takeover[0].signalState === 'AUTO_HANDLED', 'I: takeover auto handled');
assert(takeover[0].createTodayAction === false && takeover[0].createResearchJob === false, 'I: takeover no action/job');

// J: active Research Job dedupe key blocks a second job.
var dedupeKey = context.earlyActionResearchDedupeKey_(mismatch[0]);
assert(!context.shouldCreateEarlyResearchJob_(mismatch[0], [{ dedupeKey: dedupeKey, status: 'PENDING' }], {}), 'J: active job deduped');
assert(!context.shouldCreateEarlyResearchJob_(mismatch[0], [{
  dedupeKey: 'legacy-intent-key',
  site: mismatch[0].site,
  clusterKey: mismatch[0].clusterKey,
  status: 'PENDING'
}], {}), 'J2: legacy active intent job deduped by site and cluster');

// K: Day >= 7 remains routable when the Intent Signal Gate is satisfied.
var d7 = plansFor(
  [followup('D7', ['CAPTURE'], {
    day: 7,
    opportunityStage: 'CAPTURE',
    intentType: 'SPECIFIC_INTENT',
    impressions: 12
  })],
  { 'Project P.I.T.T.||D7': { hasExistingPage: true, topPage: '/guide/' } },
  { 'EARLY_SITE_WIN:Project P.I.T.T.': { routed: true } },
  Object.assign({}, early, { day: 7 })
);
assert(d7.length === 1 && d7[0].opportunityStage === 'CAPTURE', 'K: Day 7 capture remains allowed');

// M: Absolute/Growth split, generic caution, and canonical query normalization.
var strongSpecific = context.evaluateEarlyFollowupObservation_(
  { name: 'Project P.I.T.T.', day: 1 },
  { key: 'PITT_200KG', label: '200kg', intentType: 'SPECIFIC_INTENT', impressions: 12, clicks: 0, position: 12 },
  null, false, rules, new Date('2026-08-24T00:00:00Z'), {}
);
assert(strongSpecific.observationCount === 1, 'M1: strong signal is first observation');
assert(strongSpecific.opportunityStage === 'CAPTURE', 'M1: first strong specific signal captures');
assert(strongSpecific.signals.indexOf('GROWING_INTENT') < 0, 'M2: first observation cannot be growth');
var genericWeak = context.evaluateEarlyFollowupObservation_(
  { name: 'Project P.I.T.T.', day: 1 },
  { key: 'GUIDE', label: 'guide', intentType: 'GENERIC_INTENT', impressions: 6, clicks: 1, position: 8 },
  null, false, rules, new Date('2026-08-24T00:00:00Z'), {}
);
assert(genericWeak.opportunityStage === 'PROBE', 'M3: weak generic signal is probe only');
assert(genericWeak.absoluteSignal !== 'ABSOLUTE_CAPTURE', 'M3: weak generic signal is not capture');
var pittSite = { name: 'Project P.I.T.T.' };
assert(
  context.intentClusterKeyForQuery_('project pitt 200kg', pittSite) ===
    context.intentClusterKeyForQuery_('project pitt 200 kg', pittSite),
  'M4: 200kg and 200 kg share a canonical cluster'
);
assert(
  context.intentClusterKeyForQuery_('fuse', pittSite) ===
    context.intentClusterKeyForQuery_('fuses', pittSite),
  'M5: fuse and fuses share a canonical cluster'
);
assert(context.intentClusterFamilyForQuery_('fuse box') === 'FUSE', 'M6: fuse box has FUSE family');

// L: baseline clusters do not create seven tasks; only the site winner is routable.
var baseline = plansFor([], {
  'Project P.I.T.T.||PITT_1': { hasExistingPage: true },
  'Project P.I.T.T.||PITT_2': { hasExistingPage: false },
  'Project P.I.T.T.||PITT_3': { hasExistingPage: false },
  'Project P.I.T.T.||PITT_4': { hasExistingPage: false },
  'Project P.I.T.T.||PITT_5': { hasExistingPage: false },
  'Project P.I.T.T.||PITT_6': { hasExistingPage: false },
  'Project P.I.T.T.||PITT_7': { hasExistingPage: false }
}, {});
assert(baseline.length === 1 && baseline[0].opportunityType === 'EARLY_SITE_WIN', 'L: baseline creates only site win');

console.log(JSON.stringify({
  siteWin: siteWin[0].opportunityType,
  growingExisting: growingExisting[0].opportunityType,
  growingNew: growingNew[0].opportunityType,
  weakNew: weakNew[0].signalState,
  mismatch: mismatch[0].recommendedAction,
  takeover: takeover[0].signalState,
  d7: d7[0].opportunityStage,
  baselinePlans: baseline.length
}, null, 2));
console.log('PASS scripts/test-early-action-router.js');
