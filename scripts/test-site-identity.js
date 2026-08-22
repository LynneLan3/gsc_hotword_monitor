/**
 * Phase 4B-2 site identity contract checks.
 * Run: node scripts/test-site-identity.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var identitySrc = fs.readFileSync(path.join(root, 'SiteIdentity.gs'), 'utf8');
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');

// --- 1. Additive schemas and registry-aligned defaults ---
assert(
  /var SITE_HEADERS = \['站点名称', 'Property URL', 'Sitemap URL', 'Day0', 'Enabled', 'site_id'\]/.test(configSrc),
  'site config appends site_id'
);
assert(/'TopQueries', 'TopPages', 'NewQueries', 'Status', 'Error', 'site_id'/.test(configSrc), 'snapshot appends site_id');
assert((configSrc.match(/siteId:/g) || []).length === 8, 'all DEFAULT_SITES have registry siteId');
assert(/siteId: 'agent-64-spies-never-die'/.test(configSrc), 'Agent 64 uses registry site_id');

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

console.log('PASS scripts/test-site-identity.js');
