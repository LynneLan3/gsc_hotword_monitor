/**
 * Phase 4B-2 site identity contract checks.
 * Run: node scripts/test-site-identity.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertThrows(fn, pattern, msg) {
  var error = null;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  assert(error && pattern.test(String(error.message || error)), msg);
}

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var identitySrc = fs.readFileSync(path.join(root, 'SiteIdentity.gs'), 'utf8');
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');

var configContext = {};
vm.runInNewContext(configSrc, configContext);
var identityContext = {};
vm.runInNewContext(identitySrc + '\nthis.getSiteIdentityKey_ = getSiteIdentityKey_;', identityContext);

// --- 1. Additive schemas and registry-aligned defaults ---
assert(
  /var SITE_HEADERS = \['站点名称', 'Property URL', 'Sitemap URL', 'Day0', 'Enabled', 'site_id'\]/.test(configSrc),
  'site config appends site_id'
);
assert(/'TopQueries', 'TopPages', 'NewQueries', 'Status', 'Error', 'site_id'/.test(configSrc), 'snapshot appends site_id');
assert(/'AveragePosition', 'ReturnedQueryCount', 'TopQueries', 'TopPages', 'site_id'/.test(configSrc), 'daily appends site_id');
assert(/'AveragePosition'\]?,?\s*'site_id'/.test(configSrc) || /'AveragePosition', 'site_id'/.test(configSrc), 'query appends site_id');
assert(/'Clicks', 'Impressions', 'CTR', 'Position', 'site_id'/.test(configSrc), 'page appends site_id');
assert(/'Clicks', 'Impressions', 'CTR', 'AveragePosition', 'site_id'/.test(configSrc), 'query-page appends site_id');
assert(/'GoogleCanonical', 'UserCanonical', 'CrawledAs', 'Error', 'site_id'/.test(configSrc), 'URL index appends site_id');

var knownStableSiteIds = {
  'Agefield High: Rock the School': 'agefield-high-rock-the-school',
  'Mortal Shell II': 'mortal-shell-ii',
  BeastLink: 'beastlink',
  'Sovereign Tower': 'sovereign-tower',
  'Approximately Up': 'approximately-up',
  'Grain Rot': 'grain-rot',
  'Leafy Corner': 'leafy-corner',
  'Agent 64: Spies Never Die': 'agent-64-spies-never-die',
  'Serious Sam: Shatterverse': 'serious-sam-shatterverse'
};

function assertSiteIdentitySet(sites, label) {
  assert(Array.isArray(sites) && sites.length > 0, label + ' has sites');
  var ids = sites.map(function (site, index) {
    var siteId = String((site && (site.siteId || site.site_id)) || '').trim();
    assert(siteId, label + ' site[' + index + '] has non-empty siteId');
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(siteId), label + ' site[' + index + '] has lowercase kebab-case siteId');
    assert(identityContext.getSiteIdentityKey_(site) === 'site_id:' + siteId, label + ' site[' + index + '] uses site_id identity');
    return siteId;
  });
  assert(new Set(ids).size === ids.length, label + ' siteIds are unique');
}

var defaultSites = configContext.DEFAULT_SITES;
assertSiteIdentitySet(defaultSites, 'DEFAULT_SITES');
Object.keys(knownStableSiteIds).forEach(function (name) {
  var site = defaultSites.find(function (candidate) { return candidate.name === name; });
  assert(site && site.siteId === knownStableSiteIds[name], name + ' stable site_id is unchanged');
});

// Adding a future valid site must not require changing a hardcoded site count.
assertSiteIdentitySet(defaultSites.concat([{
  name: 'Future Valid Site',
  propertyUrl: 'https://future-valid-site.example/',
  siteId: 'future-valid-site'
}]), 'DEFAULT_SITES plus future site');

assertThrows(function () {
  assertSiteIdentitySet(defaultSites.concat([{ name: 'Blank Site', siteId: '' }]), 'blank fixture');
}, /non-empty siteId/, 'blank site_id must fail');
assertThrows(function () {
  assertSiteIdentitySet(defaultSites.concat([{ name: 'Duplicate Site', siteId: defaultSites[0].siteId }]), 'duplicate fixture');
}, /siteIds are unique/, 'duplicate site_id must fail');
assertThrows(function () {
  assertSiteIdentitySet(defaultSites.concat([{ name: 'Malformed Site', siteId: 'Future Site 2026' }]), 'malformed fixture');
}, /lowercase kebab-case siteId/, 'malformed site_id must fail');

// --- 2. Site config reader: new and legacy rows ---
assert(/getSiteConfigColumns_\(sheet\)/.test(sheetSrc), 'reader resolves config columns');
assert(/siteId: index\('site_id', 5\)/.test(sheetSrc), 'reader falls back to legacy column layout');
assert(/siteId: siteId/.test(sheetSrc) && /identityKey: getSiteIdentityKey_/.test(sheetSrc), 'reader exposes additive identity');
assert(/ensureAdditiveSiteIdentityHeaders_\(\)/.test(sheetSrc), 'setup adds headers without data migration');

function readSiteRow(headers, row) {
  function index(header, fallback) {
    var found = headers.indexOf(header);
    return found >= 0 ? found : fallback;
  }
  var columns = {
    name: index('站点名称', 0),
    propertyUrl: index('Property URL', 1),
    sitemapUrl: index('Sitemap URL', 2),
    day0: index('Day0', 3),
    enabled: index('Enabled', 4),
    siteId: index('site_id', 5)
  };
  return {
    name: String(row[columns.name] || '').trim(),
    propertyUrl: String(row[columns.propertyUrl] || '').trim(),
    siteId: String(row[columns.siteId] || '').trim(),
    enabled: row[columns.enabled]
  };
}

var legacy = readSiteRow(
  ['站点名称', 'Property URL', 'Sitemap URL', 'Day0', 'Enabled'],
  ['Legacy Site', 'https://legacy.example/', 'https://legacy.example/sitemap.xml', '', true]
);
assert(legacy.name === 'Legacy Site' && legacy.siteId === '', 'legacy config remains readable');

var current = readSiteRow(
  ['站点名称', 'Property URL', 'Sitemap URL', 'Day0', 'Enabled', 'site_id'],
  ['Mortal Shell II', 'https://mortal-shell-ii.vercel.app/', '', '', true, 'mortal-shell-ii']
);
assert(current.name === 'Mortal Shell II', 'Site Name remains display field');
assert(current.propertyUrl === 'https://mortal-shell-ii.vercel.app/', 'Property URL remains validation field');
assert(current.siteId === 'mortal-shell-ii', 'new site_id is read');

// --- 3. Identity priority and snapshot compatibility ---
assert(/function getSiteIdentityKey_/.test(identitySrc), 'identity key helper exists');
assert(/return 'site_id:' \+ siteId/.test(identitySrc), 'site_id is machine identity priority');
assert(/function siteIdentityMatches_/.test(identitySrc), 'identity matcher exists');
assert(/if \(leftId && rightId\) return leftId === rightId/.test(identitySrc), 'legacy name fallback remains available');
assert(/getSnapshotIdentityColumns_/.test(identitySrc), 'identity snapshot reader supports schema lookup');
assert(/siteId: siteId >= 0 \? siteId : 19/.test(identitySrc), 'snapshot reader falls back to legacy 19-column rows');
assert(/Existing data rows are[\s\S]*neither rewritten nor backfilled/.test(identitySrc), 'snapshot header helper does not migrate history');

function identityKey(site) {
  var id = String((site && (site.siteId || site.site_id)) || '').trim();
  return id ? 'site_id:' + id : 'site_name:' + String((site && site.name) || '').trim();
}

assert(identityKey({ name: 'Renamed Site', siteId: 'stable-site' }) === 'site_id:stable-site', 'site_id wins over name');
assert(identityKey({ name: 'Legacy Site' }) === 'site_name:Legacy Site', 'legacy name fallback');

// Decision Engine is an explicit no-touch boundary for this phase.
assert(!/site_id|siteId/.test(decisionSrc), 'Decision Engine remains untouched by site_id adoption');
assert(/site\.siteId \|\| ''/.test(codeSrc), 'future snapshots carry site_id');
assert(/upsertDailyRow_\(\[[\s\S]*?topPages, siteId/.test(codeSrc), 'daily rows carry site_id');
assert(/upsertQueryRow_\(\[[\s\S]*?siteId \|\| ''/.test(codeSrc), 'query rows carry site_id');
assert(/upsertQueryPageRow_\(\[[\s\S]*?siteId \|\| ''/.test(codeSrc), 'query-page rows carry site_id');
assert(/upsertPageRow_\(\[[\s\S]*?siteId \|\| ''/.test(codeSrc), 'page rows carry site_id');
assert(/appendUrlIndexRow_\(\[[\s\S]*?siteId/.test(codeSrc), 'URL index rows carry site_id');
assert(/ensureAdditiveHeader_\(SHEET_NAMES\.DAILY, 'site_id', 10\)/.test(identitySrc), 'daily header is additive');
assert(/ensureAdditiveHeader_\(SHEET_NAMES\.URL_INDEX, 'site_id', 14\)/.test(identitySrc), 'URL index header is additive');

console.log('PASS scripts/test-site-identity.js');
