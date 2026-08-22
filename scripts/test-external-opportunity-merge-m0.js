/**
 * Phase 7C-3B M0 pure merge acceptance.
 * 运行：node scripts/test-external-opportunity-merge-m0.js
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractAssign(source, name) {
  var re = new RegExp('var ' + name + '\\s*=\\s*([\\s\\S]*?);\\s*\\n(?:var |/\\*|function )');
  var match = source.match(re);
  assert(match, 'cannot parse ' + name);
  return eval('(' + match[1] + ')');
}

var root = path.join(__dirname, '..');
var config = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var identity = fs.readFileSync(path.join(root, 'OpportunityIdentity.gs'), 'utf8');
var merge = fs.readFileSync(path.join(root, 'ExternalOpportunityMerge.gs'), 'utf8');
var opportunityEngine = fs.readFileSync(path.join(root, 'OpportunityEngine.gs'), 'utf8');

var sandbox = {
  RESEARCH_TYPE: extractAssign(config, 'RESEARCH_TYPE'),
  EXTERNAL_OPPORTUNITY_HEADERS: extractAssign(config, 'EXTERNAL_OPPORTUNITY_HEADERS'),
  EXTERNAL_OPPORTUNITY_TYPES: extractAssign(config, 'EXTERNAL_OPPORTUNITY_TYPES'),
  EXTERNAL_OPPORTUNITY_CONFIDENCE: extractAssign(config, 'EXTERNAL_OPPORTUNITY_CONFIDENCE')
};
vm.createContext(sandbox);
vm.runInContext(identity, sandbox);
vm.runInContext(merge, sandbox);

var cluster = {
  topic_key: 'mortal-shell-2-best-weapons',
  topic: 'mortal shell 2 best weapons',
  representative_questions: ['What are the best weapons?'],
  evidence_count: 2,
  source_families: ['COMMUNITY'],
  providers: ['steam']
};

function research(clusters) {
  return {
    job_id: 'game-wide-ms2-20260822',
    research_type: 'DEMAND_DISCOVERY',
    discovery_scope: { scope: 'GAME_WIDE' },
    site_key: 'Mortal Shell II',
    game_name: 'Mortal Shell II',
    result_path: 'jobs/game-wide-ms2-20260822/game_wide_social_result.json',
    clusters: clusters
  };
}

var gsc = {
  queryPages: [{
    site: 'Mortal Shell II',
    data_date: '2026-08-22',
    query: 'mortal shell 2 best weapons',
    page_url: 'https://mortal-shell-ii.vercel.app/weapons/',
    page_path: '/weapons/',
    clicks: 3,
    impressions: 42
  }]
};
var assets = [{
  site: 'Mortal Shell II',
  page_path: '/weapons/',
  title: 'Weapons'
}];

// external + gsc + asset → EXPAND_EXISTING / HIGH
var expanded = sandbox.mergeGameWideOpportunityCandidatesM0_(research([cluster]), gsc, assets);
assert(expanded.ok === true, 'expand merge accepted');
assert(expanded.candidates.length === 1, 'expand emits one candidate');
var high = expanded.candidates[0];
assert(high.OpportunityType === 'EXPAND_EXISTING', 'external + gsc + asset type');
assert(high.Confidence === 'HIGH', 'external + gsc + asset confidence');
assert(high.ExistingAsset.pagePath === '/weapons/', 'existing /weapons/ asset');
assert(high.GSCEvidence.length === 1, 'GSC evidence attached');
assert(high.SourceReference.indexOf('research-result:') === 0, 'research source reference');

// external + gsc, no asset → NEW_PAGE_CANDIDATE / MEDIUM
var newPage = sandbox.mergeGameWideOpportunityCandidatesM0_(research([cluster]), gsc, []);
assert(newPage.candidates[0].OpportunityType === 'NEW_PAGE_CANDIDATE', 'no asset type');
assert(newPage.candidates[0].Confidence === 'MEDIUM', 'no asset confidence');

// external only → WATCH / LOW
var watch = sandbox.mergeGameWideOpportunityCandidatesM0_(research([cluster]), { queryPages: [] }, []);
assert(watch.candidates[0].OpportunityType === 'WATCH', 'external-only type');
assert(watch.candidates[0].Confidence === 'LOW', 'external-only confidence');

// Duplicate clusters reuse one OpportunityID and do not create a second row.
var duplicate = sandbox.mergeGameWideOpportunityCandidatesM0_(
  research([cluster, Object.assign({}, cluster, { evidence_count: 4 })]), gsc, assets
);
assert(duplicate.candidates.length === 1, 'duplicate Opportunity emits one candidate');
assert(
  duplicate.candidates[0].OpportunityID === high.OpportunityID,
  'duplicate OpportunityID is stable'
);
assert(
  high.OpportunityID === 'opp-mortal-shell-ii-mortal-shell-2-best-weapons-001',
  'Mortal Shell II reuses existing OpportunityID builder'
);

// Only the requested research type/scope is consumable.
assert(
  sandbox.mergeGameWideOpportunityCandidatesM0_(
    Object.assign({}, research([cluster]), { research_type: 'SEARCH_DEMAND' }), gsc, assets
  ).error === 'research_type_not_supported',
  'rejects SEARCH_DEMAND'
);
assert(
  sandbox.mergeGameWideOpportunityCandidatesM0_(
    Object.assign({}, research([cluster]), { discovery_scope: { scope: 'ANCHOR' } }), gsc, assets
  ).error === 'discovery_scope_not_supported',
  'rejects ANCHOR'
);

// M0 must remain outside existing Decision / Action Queue / Publishing flows.
assert(!/runDecisionEngine|refreshUnifiedActionQueue|create[A-Z][A-Za-z]+Page|vercel|clasp/.test(merge), 'merge runtime boundary');
assert(/mergeExternalOpportunityRowsIntoLegacyOutput_/.test(opportunityEngine), 'legacy snapshot preserves M0 rows');

console.log('PASS scripts/test-external-opportunity-merge-m0.js (classification, asset merge, identity, dedupe, scope gate, runtime boundary)');
