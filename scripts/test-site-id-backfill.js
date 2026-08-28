/** GSC Site ID Historical Backfill V1: planner, apply, and read-back tests. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function ids(items) { return items.map(function (item) { return item.siteDisplayName; }); }

var root = path.join(__dirname, '..');
var src = fs.readFileSync(path.join(root, 'SiteIdBackfill.gs'), 'utf8');
var context = {
  normalizePropertyUrlForGsc_: function (url) { return String(url || '').replace(/\/+$/, '') + '/'; },
  getEnabledSites: function () { return context.fixtureRows; }
};
vm.runInNewContext(src + '\nthis.planSiteIdBackfill = planSiteIdBackfill;\nthis.previewSiteIdBackfill = previewSiteIdBackfill;\nthis.applySiteIdBackfill = applySiteIdBackfill;\nthis.verifySiteIdBackfill = verifySiteIdBackfill;', context);

// MIGRATION INPUT SNAPSHOT: test-only projection of Control Center authority.
var authority = [
  { site_id: 'mortal-shell-ii', name: 'Mortal Shell II', canonicalProductionUrl: 'https://mortalshell2guide.com/' },
  { site_id: 'beastlink', name: 'BeastLink', canonicalProductionUrl: 'https://beast-link.vercel.app/' },
  { site_id: 'other-beast', name: 'Other Beast', canonicalProductionUrl: 'https://beast-link.vercel.app/' },
  { site_id: 'nba-2k27', name: 'NBA 2K27', canonicalProductionUrl: 'https://nba-2k27-game.vercel.app/' }
];

var planned = context.planSiteIdBackfill([
  { rowNumber: 2, name: 'Mortal Shell II', propertyUrl: 'https://mortalshell2guide.com/', site_id: '' }
], authority);
assert(planned.planned.length === 1 && planned.planned[0].proposedSiteId === 'mortal-shell-ii', 'blank unique URL is planned');

var correct = context.planSiteIdBackfill([
  { rowNumber: 3, name: 'NBA 2K27', propertyUrl: 'https://nba-2k27-game.vercel.app/', site_id: 'nba-2k27' }
], authority);
assert(correct.alreadyCorrect.length === 1, 'existing correct site_id is already correct');

var wrong = context.planSiteIdBackfill([
  { rowNumber: 4, name: 'NBA 2K27', propertyUrl: 'https://nba-2k27-game.vercel.app/', site_id: 'mortal-shell-ii' }
], authority);
assert(wrong.conflicts.length === 1 && wrong.conflicts[0].proposedSiteId === '', 'wrong non-empty site_id conflicts and is not overwritten');

var missing = context.planSiteIdBackfill([
  { rowNumber: 5, name: 'Unknown', propertyUrl: 'https://unknown.example/', site_id: '' }
], authority);
assert(missing.unresolved.length === 1, 'no authority match is unresolved');

var ambiguous = context.planSiteIdBackfill([
  { rowNumber: 6, name: 'BeastLink', propertyUrl: 'https://beast-link.vercel.app/', site_id: '' }
], authority);
assert(ambiguous.unresolved.length === 1 && ambiguous.planned.length === 0, 'ambiguous URL is never planned');

var nameOnly = context.planSiteIdBackfill([
  { rowNumber: 7, name: 'Mortal Shell II', propertyUrl: 'https://different.example/', site_id: '' }
], authority);
assert(nameOnly.unresolved.length === 1, 'display name alone is insufficient');

// Current known runtime cases: 3 existing IDs and 9 historical blanks.
var knownAuthority = [
  { site_id: 'agefield-high-rock-the-school', canonicalProductionUrl: 'https://agefield-high-rock-the-school.vercel.app/' },
  { site_id: 'mortal-shell-ii', canonicalProductionUrl: 'https://mortalshell2guide.com/' },
  { site_id: 'beastlink', canonicalProductionUrl: 'https://beast-link.vercel.app/' },
  { site_id: 'sovereign-tower', canonicalProductionUrl: 'https://sovereign-tower.vercel.app/' },
  { site_id: 'approximately-up', canonicalProductionUrl: 'https://approximately-up.vercel.app/' },
  { site_id: 'grain-rot', canonicalProductionUrl: 'https://grainrot.vercel.app/' },
  { site_id: 'leafy-corner', canonicalProductionUrl: 'https://leafy-corner.vercel.app/' },
  { site_id: 'agent-64-spies-never-die', canonicalProductionUrl: 'https://agent-64.vercel.app/' },
  { site_id: 'brigandine-abyss', canonicalProductionUrl: 'https://brigandine-abyss.vercel.app/' },
  { site_id: 'bombanana', canonicalProductionUrl: 'https://bombanana-guide.vercel.app/' },
  { site_id: 'nba-2k27', canonicalProductionUrl: 'https://nba-2k27-game.vercel.app/' },
  { site_id: 'project-p-i-t-t', canonicalProductionUrl: 'https://project-p-i-t-t.vercel.app/' }
];
var knownRows = [
  ['Agefield High: Rock the School', 'https://agefield-high-rock-the-school.vercel.app/', ''],
  ['Mortal Shell II', 'https://mortalshell2guide.com/', ''],
  ['BeastLink', 'https://beast-link.vercel.app/', ''],
  ['Sovereign Tower', 'https://sovereign-tower.vercel.app/', ''],
  ['Approximately Up', 'https://approximately-up.vercel.app/', ''],
  ['Grain Rot', 'https://grainrot.vercel.app/', ''],
  ['Leafy Corner', 'https://leafy-corner.vercel.app/', ''],
  ['Agent 64: Spies Never Die', 'https://agent-64.vercel.app/', ''],
  ['BRIGANDINE ABYSS', 'https://brigandine-abyss.vercel.app/', ''],
  ['Project P.I.T.T.', 'https://project-p-i-t-t.vercel.app/', 'project-p-i-t-t'],
  ['NBA 2K27', 'https://nba-2k27-game.vercel.app/', 'nba-2k27'],
  ['BOMBANANA!', 'https://bombanana-guide.vercel.app/', 'bombanana']
].map(function (item, index) {
  return { rowNumber: index + 2, name: item[0], propertyUrl: item[1], siteId: item[2] };
});
var knownPlan = context.planSiteIdBackfill(knownRows, knownAuthority);
assert(knownPlan.planned.length === 9, 'known historical blanks produce 9 planned items');
assert(knownPlan.alreadyCorrect.length === 3, 'known populated IDs produce 3 already-correct items');
assert(knownPlan.conflicts.length === 0 && knownPlan.unresolved.length === 0, 'known cases have no unresolved or conflicts');
assert(ids(knownPlan.planned).indexOf('BRIGANDINE ABYSS') >= 0, 'known case plan retains display name');

context.fixtureRows = [
  { rowIndex: 2, name: 'Mortal Shell II', propertyUrl: 'https://mortalshell2guide.com/', siteId: '' }
];
var beforeWriteKeywords = ['setValue', 'setValues', 'appendRow', 'clear', 'setup', 'sync', 'backfill metrics', 'update timestamp'];
var entryStart = src.indexOf('function previewSiteIdBackfill');
var entryEnd = src.indexOf('\nfunction applySiteIdBackfill', entryStart);
var entryBody = src.slice(entryStart, entryEnd < 0 ? src.length : entryEnd);
beforeWriteKeywords.forEach(function (keyword) {
  assert(entryBody.toLowerCase().indexOf(keyword.toLowerCase()) < 0, 'preview entry contains no write/setup path: ' + keyword);
});
var preview = context.previewSiteIdBackfill([{ site_id: 'mortal-shell-ii', canonicalProductionUrl: 'https://mortalshell2guide.com/' }]);
assert(preview.planned.length === 1, 'preview reads rows and returns plan');

function fakeSheet(rows, headers) {
  var values = [headers.slice()].concat(rows.map(function (row) { return row.slice(); }));
  var writes = [];
  return {
    writes: writes,
    getLastColumn: function () { return headers.length; },
    getRange: function (row, column, numRows, numColumns) {
      var width = numColumns || 1;
      return {
        getValues: function () { return [values[row - 1].slice(column - 1, column - 1 + width)]; },
        getValue: function () { return values[row - 1][column - 1]; },
        setValue: function (value) {
          writes.push({ row: row, column: column, value: value });
          values[row - 1][column - 1] = value;
        }
      };
    },
    snapshot: function () { return values.map(function (row) { return row.slice(); }); }
  };
}

var headers = ['站点名称', 'Property URL', 'Sitemap URL', 'Day0', 'Enabled', 'site_id'];
var applyRows = [
  ['Mortal Shell II', 'https://mortalshell2guide.com/', 'https://mortalshell2guide.com/sitemap.xml', '2026-01-01', true, ''],
  ['BeastLink', 'https://beast-link.vercel.app/', 'https://beast-link.vercel.app/sitemap.xml', '2026-01-02', true, ''],
  ['NBA 2K27', 'https://nba-2k27-game.vercel.app/', 'https://nba-2k27-game.vercel.app/sitemap.xml', '2026-01-03', true, 'nba-2k27']
];
var applySheet = fakeSheet(applyRows, headers);
var applyPlan = context.planSiteIdBackfill([
  { rowNumber: 2, name: 'Mortal Shell II', propertyUrl: applyRows[0][1], siteId: '' },
  { rowNumber: 3, name: 'BeastLink', propertyUrl: applyRows[1][1], siteId: '' },
  { rowNumber: 4, name: 'NBA 2K27', propertyUrl: applyRows[2][1], siteId: applyRows[2][5] }
], authority.filter(function (record) { return record.site_id !== 'other-beast'; }));
var baseline = applyRows.map(function (row, index) {
  return { rowNumber: index + 2, propertyUrl: row[1], sitemapUrl: row[2], day0: row[3], enabled: row[4] };
});
var bulkRows = knownRows.map(function (row) {
  return [row.name, row.propertyUrl, row.propertyUrl + 'sitemap.xml', '2026-01-01', true, row.siteId];
});
var bulkSheet = fakeSheet(bulkRows, headers);
var bulkBaseline = bulkRows.map(function (row, index) {
  return { rowNumber: index + 2, propertyUrl: row[1], sitemapUrl: row[2], day0: row[3], enabled: row[4] };
});
var bulkApplied = context.applySiteIdBackfill(knownPlan, bulkSheet);
assert(bulkApplied.status === 'SUCCESS' && bulkApplied.written.length === 9, 'nine planned blanks produce exactly nine writes');
assert(bulkSheet.writes.length === 9 && bulkSheet.writes.every(function (write) { return write.column === 6; }), 'bulk apply writes only nine site_id cells');
assert(context.verifySiteIdBackfill(knownPlan, bulkSheet, bulkBaseline).status === 'SUCCESS', 'bulk read-back confirms nine new and three existing IDs');
var applied = context.applySiteIdBackfill(applyPlan, applySheet);
assert(applied.status === 'SUCCESS' && applied.written.length === 2, 'planned blanks write exactly planned cells');
assert(applied.skipped.length === 0, 'initial apply has no skips');
assert(applySheet.writes.every(function (write) { return write.column === 6; }), 'writes target only site_id column');
assert(JSON.stringify(applySheet.snapshot().map(function (row) { return row.slice(0, 5); })) === JSON.stringify([headers.slice(0, 5)].concat(applyRows.map(function (row) { return row.slice(0, 5); }))), 'other columns unchanged');
assert(context.verifySiteIdBackfill(applyPlan, applySheet, baseline).status === 'SUCCESS', 'read-back protects expected IDs and fields');
var applyBody = src.slice(src.indexOf('function applySiteIdBackfill'), src.indexOf('\nfunction verifySiteIdBackfill'));
assert(applyBody.indexOf('planSiteIdBackfill(') < 0 && applyBody.indexOf('propertyUrl') < 0 && applyBody.indexOf('siteDisplayName') < 0, 'apply does not infer identity from planner-independent fields');

function emptyPlan(overrides) {
  return Object.assign({ planned: [], alreadyCorrect: [], conflicts: [], unresolved: [] }, overrides || {});
}
var conflictSheet = fakeSheet(applyRows, headers);
assert(context.applySiteIdBackfill(emptyPlan({ planned: applyPlan.planned, conflicts: [{ status: 'CONFLICT' }] }), conflictSheet).written.length === 0 && conflictSheet.writes.length === 0, 'conflict aborts before any write');
var unresolvedSheet = fakeSheet(applyRows, headers);
assert(context.applySiteIdBackfill(emptyPlan({ planned: applyPlan.planned, unresolved: [{ status: 'UNRESOLVED' }] }), unresolvedSheet).written.length === 0 && unresolvedSheet.writes.length === 0, 'unresolved aborts before any write');

var skipSheet = fakeSheet(applyRows, headers);
skipSheet.getRange(2, 6).setValue('mortal-shell-ii');
skipSheet.writes.length = 0;
var skipResult = context.applySiteIdBackfill(emptyPlan({ planned: [applyPlan.planned[0]] }), skipSheet);
assert(skipResult.status === 'SUCCESS' && skipResult.skipped.length === 1 && skipSheet.writes.length === 0, 'same concurrent value is skipped');

var concurrentSheet = fakeSheet(applyRows, headers);
concurrentSheet.getRange(2, 6).setValue('different-id');
concurrentSheet.writes.length = 0;
var concurrentResult = context.applySiteIdBackfill(emptyPlan({ planned: [applyPlan.planned[0]] }), concurrentSheet);
assert(concurrentResult.status === 'ABORTED' && concurrentResult.reason.indexOf('CONCURRENT_CONFLICT') >= 0 && concurrentSheet.writes.length === 0, 'different concurrent value aborts without overwrite');

var correctSheet = fakeSheet([applyRows[2]], headers);
var correctOnly = emptyPlan({ alreadyCorrect: [applyPlan.alreadyCorrect[0]] });
assert(context.applySiteIdBackfill(correctOnly, correctSheet).written.length === 0 && correctSheet.writes.length === 0, 'existing correct records produce zero writes');
var changed = applySheet.snapshot().slice(1);
changed[0][1] = 'changed-property';
var verifyChangedSheet = fakeSheet(changed, headers);
assert(context.verifySiteIdBackfill(applyPlan, verifyChangedSheet, baseline).status === 'FAILURE', 'protected field drift is a verification failure');

console.log('PASS apply/read-back tests');

console.log('PASS scripts/test-site-id-backfill.js');
