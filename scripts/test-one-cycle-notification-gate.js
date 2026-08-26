/** Hotword OS One-Cycle Validated Notification V1 regressions. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

var root = path.join(__dirname, '..');
var gateSrc = fs.readFileSync(path.join(root, 'OneCycleNotificationGate.gs'), 'utf8');
var context = {};
vm.createContext(context);
vm.runInContext(gateSrc, context);

function plan(values) {
  var base = {
    site: 'Ashen Sanctum',
    siteIdentity: 'ashen-sanctum',
    clusterKey: 'ISAAC',
    actionKey: 'cycle:ashen:isaac',
    targetAction: 'NEW_PAGE_CANDIDATE',
    recommendedAction: 'NEW_PAGE_CANDIDATE',
    finalAction: 'NEW_PAGE_CANDIDATE',
    signals: ['NEW_TOP10_QUERY'],
    currentImpressions: 24,
    currentClicks: 1,
    currentTopPage: '/',
    expectedPage: ''
  };
  Object.keys(values || {}).forEach(function (key) { base[key] = values[key]; });
  return base;
}

function finalized(values) {
  var base = {
    dataState: 'FINALIZED',
    finalizedGsc: true,
    finalizedDataDate: '2026-08-24',
    dataCutoff: '2026-08-24',
    meaningfulFinalizedGsc: true,
    hasExistingPage: false
  };
  Object.keys(values || {}).forEach(function (key) { base[key] = values[key]; });
  return base;
}

// 1. Ashen Sanctum: same finalized date as the content change is cooldown.
var ashen = context.validateOneCycleActionPlan_(plan({}), finalized({
  lastContentChangeDate: '2026-08-24',
  postChangeFinalizedDataDates: ['2026-08-24']
}));
assert(ashen.finalDecision === 'COOLDOWN', 'Ashen: cooldown decision');
assert(!ashen.notify, 'Ashen: no action notification');

// 2. Incomplete realtime growth remains a signal/watch only.
var incompleteGrowth = context.validateOneCycleActionPlan_(plan({
  signals: ['QUERY_GROWTH'],
  currentImpressions: 1300
}), {
  dataState: 'REALTIME',
  dataIncomplete: true,
  dataCutoff: '2026-08-24T14:00:00Z',
  lastContentChangeDate: '2026-08-24',
  meaningfulFinalizedGsc: false
});
assert(incompleteGrowth.finalDecision === 'WATCH', 'incomplete growth: watch');
assert(!incompleteGrowth.notify, 'incomplete growth: no notification');

// 3. QUERY_BLIND_SPOT remains discovery-only.
var blindSpot = context.validateOneCycleActionPlan_(plan({
  finalAction: '',
  targetAction: '',
  recommendedAction: '',
  signals: ['QUERY_BLIND_SPOT']
}), finalized({}));
assert(blindSpot.finalDecision === 'QUERY_BLIND_SPOT_ONLY', 'blind spot: discovery-only decision');
assert(!blindSpot.notify, 'blind spot: no notification');

// 4. A stable winner protects the page from routine CTR action.
var winner = context.validateOneCycleActionPlan_(plan({
  finalAction: 'CTR_ONLY',
  targetAction: 'CTR_ONLY',
  recommendedAction: 'CTR_ONLY',
  signals: ['CTR_LOW']
}), finalized({
  protectedWinner: true,
  winnerClicks7d: 12
}));
assert(winner.finalDecision === 'FREEZE', 'winner: freeze');
assert(!winner.notify, 'winner: no routine CTR notification');

// 5. Official patch/fact conflict overrides winner and cooldown protection.
var factOverride = context.validateOneCycleActionPlan_(plan({
  finalAction: 'MINIMAL_FACT_FIX',
  targetAction: 'MINIMAL_FACT_FIX',
  recommendedAction: 'MINIMAL_FACT_FIX',
  signals: ['OFFICIAL_PATCH']
}), finalized({
  protectedWinner: true,
  lastContentChangeDate: '2026-08-24'
}));
assert(factOverride.finalDecision === 'MINIMAL_FACT_FIX', 'fact override: final action');
assert(factOverride.notify, 'fact override: notification allowed');

// 6. External Reddit demand without finalized search confirmation is watch.
var reddit = context.validateOneCycleActionPlan_(plan({
  finalAction: 'NEW_PAGE_CANDIDATE',
  signals: ['REDDIT_SPIKE'],
  externalOnly: true
}), {
  externalOnly: true,
  dataState: 'REALTIME',
  dataIncomplete: true,
  meaningfulFinalizedGsc: false
});
assert(reddit.finalDecision === 'WATCH', 'reddit: watch');
assert(!reddit.notify, 'reddit: no notification');

// 7. The requested state already exists.
var satisfied = context.validateOneCycleActionPlan_(plan({
  finalAction: 'NEW_PAGE_CANDIDATE'
}), finalized({
  currentStateSatisfied: true,
  currentState: 'CUSTOM_DOMAIN_CONFIGURED',
  targetState: 'CUSTOM_DOMAIN_CONFIGURED'
}));
assert(satisfied.finalDecision === 'STATE_ALREADY_SATISFIED', 'state: already satisfied');
assert(!satisfied.notify, 'state: no notification');

// 8. Genuine finalized underperformer gets exactly one executable action.
var underperformer = context.validateOneCycleActionPlan_(plan({
  finalAction: 'CTR_ONLY',
  targetAction: 'CTR_ONLY',
  recommendedAction: 'CTR_ONLY',
  signals: ['CTR_LOW'],
  clusterKey: 'ISAAC_PAGE'
}), finalized({
  meaningfulFinalizedGsc: true
}));
assert(underperformer.finalDecision === 'CTR_ONLY', 'underperformer: CTR_ONLY');
assert(underperformer.notify, 'underperformer: notification allowed');

var duplicatePlans = context.selectOneCycleFinalPlans_([
  Object.assign({}, plan({ actionKey: 'a', finalAction: 'CTR_ONLY', targetAction: 'CTR_ONLY', recommendedAction: 'CTR_ONLY' }), { oneCycleValidation: underperformer }),
  Object.assign({}, plan({ actionKey: 'b', finalAction: 'APPEND_ONLY', targetAction: 'APPEND_ONLY', recommendedAction: 'APPEND_ONLY' }), { oneCycleValidation: underperformer })
]);
assert(duplicatePlans.length === 1, 'one cycle: duplicate logical opportunity collapses to one plan');
var precedencePlans = context.selectOneCycleFinalPlans_([
  Object.assign({}, plan({}), { oneCycleValidation: ashen }),
  Object.assign({}, plan({}), { oneCycleValidation: factOverride })
]);
assert(precedencePlans.length === 1, 'one cycle: guard collision still collapses');
assert(precedencePlans[0].oneCycleValidation.finalDecision === 'MINIMAL_FACT_FIX', 'one cycle: fact override wins precedence');

console.log(JSON.stringify({
  ashen: ashen.finalDecision,
  incompleteGrowth: incompleteGrowth.finalDecision,
  blindSpot: blindSpot.finalDecision,
  winner: winner.finalDecision,
  factOverride: factOverride.finalDecision,
  reddit: reddit.finalDecision,
  satisfied: satisfied.finalDecision,
  underperformer: underperformer.finalDecision,
  duplicatePlans: duplicatePlans.length,
  precedenceWinner: precedencePlans[0].oneCycleValidation.finalDecision
}, null, 2));
console.log('PASS scripts/test-one-cycle-notification-gate.js');
