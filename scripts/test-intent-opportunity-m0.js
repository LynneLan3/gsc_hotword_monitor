/** Query Cluster → Page Hotspot → Action M0 验收测试。 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

var root = path.join(__dirname, '..');
var config = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var engine = fs.readFileSync(path.join(root, 'IntentOpportunityEngine.gs'), 'utf8');
var fresh = fs.readFileSync(path.join(root, 'FreshQueryMonitor.gs'), 'utf8');

function extractAssign(src, name) {
  var re = new RegExp('var ' + name + '\\s*=\\s*([\\s\\S]*?);\\s*\\n(?:var |/\\*|function )');
  var match = src.match(re);
  assert(match, 'missing config ' + name);
  return eval('(' + match[1] + ')');
}

assert(/INTENT_OPPORTUNITIES:\s*'Intent机会'/.test(config), 'Intent机会 sheet name');
assert(/buildIntentOpportunitySnapshot_/.test(fresh), 'Fresh monitor builds intent snapshot');
assert(/enqueueIntentResearchJobs_/.test(fresh), 'Fresh monitor enqueues research jobs');
assert(/writeIntentOpportunityRows_/.test(fresh), 'Fresh monitor writes aggregate sheet');
assert(/ensureIntentOpportunityHeader_/.test(engine), 'Intent机会 header migration exists');
var intentHeaders = extractAssign(config, 'INTENT_OPPORTUNITY_HEADERS');
['ClusterKey', 'TopPageShare', 'PageClusterCount', 'HotspotLevel', 'Action', 'ActionReason',
  'ClusterAction', 'ClusterActionReason', 'PageAction', 'PageActionReason', 'PageActionOwner']
  .forEach(function (header) { assert(intentHeaders.indexOf(header) >= 0, 'output header ' + header); });

var context = {
  INTENT_CLUSTER_ENTITY_ALIASES: extractAssign(config, 'INTENT_CLUSTER_ENTITY_ALIASES'),
  INTENT_CLUSTER_ACTIONS: extractAssign(config, 'INTENT_CLUSTER_ACTIONS'),
  INTENT_PAGE_ACTIONS: extractAssign(config, 'INTENT_PAGE_ACTIONS'),
  INTENT_CLUSTER_THRESHOLDS: extractAssign(config, 'INTENT_CLUSTER_THRESHOLDS'),
  OPPORTUNITY_HUB_SLUGS: extractAssign(config, 'OPPORTUNITY_HUB_SLUGS')
};
vm.createContext(context);
vm.runInContext(engine, context);

var site = {
  name: 'Mortal Shell II',
  siteId: 'mortal-shell-ii',
  propertyUrl: 'https://mortal-shell-ii.vercel.app/'
};

function row(query, page, clicks, impressions, position) {
  return { query: query, page: page, clicks: clicks, impressions: impressions, position: position };
}

var skipPage = '/mortal-shell-ii/skip-prologue/';
var home = '/mortal-shell-ii/';
var skipRows = [
  row('mortal shell 2 skip prologue', skipPage, 8, 47, 6),
  row('mortal shell 2 how to skip prologue', skipPage, 4, 31, 7),
  row('skip prologue mortal shell 2', skipPage, 3, 20, 8),
  row('mortal shell 2 prologue skip', skipPage, 2, 14, 9),
  row('how to skip prologue mortal shell 2', skipPage, 1, 9, 10),
  row('mortal shell 2 skip intro', skipPage, 1, 8, 11),
  row('mortal shell 2 skip tutorial', skipPage, 1, 7, 12),
  row('should i skip prologue mortal shell 2', skipPage, 1, 6, 13)
];
var skipSnapshot = context.buildIntentOpportunitySnapshot_(skipRows, {
  site: site,
  previousRows: [row('mortal shell 2 skip prologue', skipPage, 0, 98, 8)]
});
var skip = skipSnapshot.clusters[0];
assert(skip.key === 'SKIP_PROLOGUE', 'all skip variants share SKIP_PROLOGUE');
assert(skip.queryCount === 8, 'skip variants are retained as query details');
assert(skip.impressions === 142, 'skip cluster aggregates all impressions');
assert(skip.previousImpressions === 98, 'trend uses cluster aggregate, not one query');
assert(skip.hotspotLevel === 'HIGH', 'skip cluster high signal');
assert(skip.action === 'OBSERVE', 'skip ClusterAction stays intent-level');
assert(skip.pageHotspot.pageAction === 'EXISTING_GROWTH', 'skip PageAction existing growth');
assert(skip.topPage === '/mortal-shell-ii/skip-prologue' && skip.topPageShare === 1, 'skip dominant page');
assert(
  context.intentClusterKeyForQuery_('mortal shell 2 skip prologue or not', site) === 'SKIP_PROLOGUE',
  'skip prologue or not consolidates'
);

var crashingVariants = [
  'mortal shell 2 crashing',
  'mortal shell 2 crashing pc',
  'mortal shell 2 crash',
  'mortal shell 2 crash on load',
  'mortal shell 2 crash on loading',
  'mortal shell 2 keeps crashing'
];
crashingVariants.forEach(function (query) {
  assert(context.intentClusterKeyForQuery_(query, site) === 'CRASHING', 'crashing variant consolidates: ' + query);
});

[
  "mortal shell 2 great martyr's blade",
  'great martyrs blade',
  'martyr blade mortal shell 2'
].forEach(function (query) {
  assert(
    context.intentClusterKeyForQuery_(query, site) === 'GREAT_MARTYRS_BLADE',
    'Great Martyr variant consolidates: ' + query
  );
});

var lightRows = [
  row('light extinguished lantern mortal shell 2', home, 0, 12, 18),
  row('mortal shell 2 light extinguished lantern', home, 0, 12, 19),
  row('mortal shell 2 lantern', home, 0, 2, 20)
];
var light = context.buildIntentOpportunitySnapshot_(lightRows, { site: site }).clusters[0];
assert(light.key === 'GLOOMBOUND_FLAME', 'lantern queries map to GLOOMBOUND_FLAME');
assert(light.impressions === 26, 'light cluster reaches 26 impressions');
assert(light.hasExistingPage === false, 'home is not an explicit content page');
assert(light.action === 'OBSERVE', 'known Gloombound entity does not enter new-page research');

var independentPageSnapshot = context.buildIntentOpportunitySnapshot_([
  row('mortal shell 2 skip prologue', skipPage, 4, 113, 8)
], {
  site: site,
  pageRows: [
    row('', skipPage, 22, 568, 7),
    row('', '/mortal-shell-ii/crashing-pc/', 5, 213, 8),
    row('', '/mortal-shell-ii/gloombound-flame/', 2, 140, 9),
    row('', '/mortal-shell-ii/slayer-seal-difficulty/', 1, 116, 11)
  ]
});
var independentSkip = independentPageSnapshot.clusters[0];
var independentPages = {};
independentPageSnapshot.pageHotspots.forEach(function (p) { independentPages[p.page] = p; });
assert(independentSkip.impressions === 113, 'cluster keeps Query×Page impressions');
assert(independentPages['/mortal-shell-ii/skip-prologue'].impressions === 568, 'page hotspot uses page rows');
assert(independentPages['/mortal-shell-ii/crashing-pc'].impressions === 213, 'page-only hotspot is retained');
assert(independentPages['/mortal-shell-ii/gloombound-flame'].impressions === 140, 'page-only Gloombound hotspot');
assert(independentPages['/mortal-shell-ii/slayer-seal-difficulty'].impressions === 116, 'page-only Slayer hotspot');

var optimize = context.buildIntentOpportunitySnapshot_([
  row('mortal shell 2 crashing pc', '/mortal-shell-ii/crashing-pc/', 1, 120, 8)
], { site: site }).clusters[0];
assert(optimize.action === 'OBSERVE', 'ClusterAction does not optimize pages');
assert(optimize.pageHotspot.pageAction === 'OPTIMIZE_EXISTING', 'PageAction optimizes once');

var competing = context.buildIntentOpportunitySnapshot_([
  row('mortal shell 2 crash fix', '/mortal-shell-ii/crashing-pc/', 1, 30, 8),
  row('mortal shell 2 crash fix', '/mortal-shell-ii/other-crash-page/', 1, 25, 9)
], { site: site }).clusters[0];
assert(competing.action === 'CANNIBALIZATION', 'two materially exposed pages flag cannibalization');

var fullRows = lightRows.concat([
  row('mortal shell 2 gloombound flame', '/mortal-shell-ii/gloombound-flame/', 2, 138, 8),
  row('mortal shell 2 düstergebundene flamme', '/mortal-shell-ii/gloombound-flame/', 0, 2, 9),
  row('mortal shell 2 crashing pc', '/mortal-shell-ii/crashing-pc/', 5, 213, 7),
  row('mortal shell 2 call forth the night', '/mortal-shell-ii/slayer-seal-difficulty/', 0, 5, 10),
  row('mortal shell 2 slayer seal difficulty', '/mortal-shell-ii/slayer-seal-difficulty/', 1, 116, 9.5),
  row('mortal shell 2 quiet guide', '/mortal-shell-ii/quiet-guide/', 0, 10, 20),
  row('mortal shell 2 noisy intent', '/mortal-shell-ii/a/', 0, 1, 20),
  row('mortal shell 2 noisy intent', '/mortal-shell-ii/b/', 0, 1, 20)
]);
var full = context.buildIntentOpportunitySnapshot_(fullRows, { site: site });
var byKey = {};
full.clusters.forEach(function (c) { byKey[c.key] = c; });
assert(byKey.GLOOMBOUND_FLAME.action === 'MULTILINGUAL_ALIAS', 'German alias reuses existing entity page');
assert(byKey.GLOOMBOUND_FLAME.hasExistingPage === true, 'Gloombound page is explicit承接');
assert(byKey.GLOOMBOUND_FLAME.topPage === '/mortal-shell-ii/gloombound-flame', 'Gloombound top page');
assert(byKey.GLOOMBOUND_FLAME.topPageShare > 0.60, 'Gloombound dominant page');
assert(byKey.GLOOMBOUND_FLAME.clusterAction === 'MULTILINGUAL_ALIAS', 'Gloombound ClusterAction alias');
assert(byKey.GLOOMBOUND_FLAME.pageHotspot.pageAction === 'OPTIMIZE_EXISTING', 'Gloombound PageAction optimize');
assert(byKey.QUERY_INTENT_NOISY.possibleCannibalization === false, '1+1 impressions is not cannibalization');

var pageMap = {};
full.pageHotspots.forEach(function (p) { pageMap[p.page] = p; });
assert(pageMap['/mortal-shell-ii/crashing-pc'].hotspotLevel === 'HIGH', 'crashing page hotspot');
assert(pageMap['/mortal-shell-ii/gloombound-flame'].hotspotLevel === 'HIGH', 'gloombound page hotspot');
assert(pageMap['/mortal-shell-ii/slayer-seal-difficulty'].hotspotLevel === 'HIGH', 'slayer page hotspot');
assert(pageMap['/mortal-shell-ii/crashing-pc'].clusterCount === 1, 'page cluster count');
assert(pageMap['/mortal-shell-ii/slayer-seal-difficulty'].clusterCount === 2, 'slayer has two clusters');
assert(pageMap['/mortal-shell-ii/slayer-seal-difficulty'].pageAction === 'OPTIMIZE_EXISTING', 'slayer PageAction optimize');

var sheetRows = context.buildIntentOpportunitySheetRows_(full);
var headerIndex = {};
intentHeaders.forEach(function (header, index) { headerIndex[header] = index; });
var slayerRows = sheetRows.filter(function (sheetRow) {
  return sheetRow[headerIndex.TopPage] === '/mortal-shell-ii/slayer-seal-difficulty';
});
assert(slayerRows.length === 2, 'slayer has two cluster rows');
assert(
  slayerRows.filter(function (sheetRow) { return sheetRow[headerIndex.PageActionOwner] === 'TRUE'; }).length === 1,
  'slayer has one PageAction owner'
);
assert(
  slayerRows.filter(function (sheetRow) { return sheetRow[headerIndex.PageAction] === 'OPTIMIZE_EXISTING'; }).length === 1,
  'slayer PageAction is written once'
);

console.log(JSON.stringify({
  skip: { key: skip.key, queryCount: skip.queryCount, impressions: skip.impressions, action: skip.action },
  light: { key: light.key, impressions: light.impressions, action: light.action },
  alias: { key: byKey.GLOOMBOUND_FLAME.key, action: byKey.GLOOMBOUND_FLAME.action },
  hotspots: [
    pageMap['/mortal-shell-ii/crashing-pc'].page,
    pageMap['/mortal-shell-ii/gloombound-flame'].page,
    pageMap['/mortal-shell-ii/slayer-seal-difficulty'].page
  ]
}, null, 2));
console.log('PASS scripts/test-intent-opportunity-m0.js');
