/**
 * Index audit rolling cursor + URL upsert + property resolve + row-width locks.
 * Run: node scripts/test-index-audit-batch.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var root = path.join(__dirname, '..');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var utilsSrc = fs.readFileSync(path.join(root, 'Utils.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');
var leanSrc = fs.readFileSync(path.join(root, 'TimeoutRetentionHotfix.gs'), 'utf8');
var freshSrc = fs.readFileSync(path.join(root, 'FreshQueryMonitor.gs'), 'utf8');

function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function ' + name);
  var next = src.indexOf('\nfunction ', start + 1);
  return next >= 0 ? src.slice(start, next) : src.slice(start);
}

// --- Static contract ---
assert(/INDEX_AUDIT_MAX_MS/.test(configSrc), 'time budget constant');
assert(!/INDEX_AUDIT_BATCH_SIZE/.test(configSrc), 'old batch-size constant removed');
assert(/INDEX_AUDIT_URL_CURSOR_PROP/.test(configSrc), 'URL cursor prop');
assert(/INDEX_AUDIT_SITE_KEY_PROP/.test(configSrc), 'site key prop');

var batchFn = extractFn(codeSrc, 'runIndexAuditBatch');
assert(/LockService\.getScriptLock/.test(batchFn), 'index audit uses script lock');
assert(/runIndexAuditBatchUnlocked_/.test(batchFn), 'delegates to unlocked body');
var unlockedFn = extractFn(codeSrc, 'runIndexAuditBatchUnlocked_');
assert(/loadIndexAuditCursorState_/.test(unlockedFn), 'loads rolling cursor');
assert(!/ensureIndexAuditDay_/.test(unlockedFn), 'no daily cursor reset');
assert(!/INDEX_AUDIT_BATCH_SIZE/.test(unlockedFn), 'no fixed 2-site batch');
assert(/processSiteUrlInspectionBatch_/.test(unlockedFn), 'partial URL processor');
assert(/wrap 到 0/.test(unlockedFn), 'wrap after full round');

var partialFn = extractFn(codeSrc, 'processSiteUrlInspectionBatch_');
assert(/saveIndexAuditUrlCursor_/.test(partialFn), 'persists URL cursor per URL');
assert(/upsertUrlIndexRow_/.test(partialFn), 'idempotent URL index write');
assert(/resolveAccessibleGscProperty_/.test(partialFn), 'resolves accessible property');

assert(/function upsertUrlIndexRow_/.test(sheetSrc), 'URL index upsert exists');
assert(/function alignRowToHeaders_/.test(sheetSrc), 'row align helper');
assert(/alignRowToHeaders_\(row, headers\)/.test(extractFn(sheetSrc, 'upsertRow_')), 'upsert pads to schema');

assert(/function resolveAccessibleGscProperty_/.test(utilsSrc), 'property resolver');
assert(/sc-domain:/.test(extractFn(utilsSrc, 'gscPropertyCandidates_')), 'domain candidate');
assert(/noteGscPropertyPermissionOnce_/.test(utilsSrc), 'once-per-run permission note');

assert(/resolveAccessibleGscProperty_/.test(extractFn(codeSrc, 'processSiteDaily_')), 'daily resolves property');
assert(/resolveAccessibleGscProperty_/.test(extractFn(leanSrc, 'processSiteDailyLean_')), 'lean resolves property');
assert(/resolveFreshRealtimePropertyUrls_/.test(freshSrc), 'fresh monitor resolves property');
assert(/site\.siteId \|\| ''/.test(extractFn(codeSrc, 'runDailyUnlocked_')), 'daily error snapshot has site_id');

assert(/EarlySignalStatus/.test(extractFn(decisionSrc, 'writeDecisionSiteStatusRows_')), 'owned fields from schema');
assert(/alignRowToHeaders_/.test(extractFn(decisionSrc, 'replaceSheetDataRows_')), 'replace pads to schema');

// --- Runtime: property resolve ---
var context = {
  console: console,
  URL: URL,
  listGscSites: function () {
    return context.__sites || [];
  }
};
vm.createContext(context);
vm.runInContext(
  extractFn(utilsSrc, 'ensureTrailingSlash_') +
    extractFn(utilsSrc, 'normalizePropertyUrlForGsc_') +
    'var GSC_SITES_LIST_CACHE_ = null;\n' +
    'var GSC_PROPERTY_PERM_NOTED_ = {};\n' +
    extractFn(utilsSrc, 'clearGscPropertyResolutionCache_') +
    extractFn(utilsSrc, 'getAccessibleGscSitesCached_') +
    extractFn(utilsSrc, 'buildGscAccessSet_') +
    extractFn(utilsSrc, 'gscPropertyCandidates_') +
    extractFn(utilsSrc, 'extractHostFromPropertyUrl_') +
    extractFn(utilsSrc, 'resolveAccessibleGscProperty_') +
    extractFn(utilsSrc, 'formatPropertyPermissionMessage_') +
    extractFn(utilsSrc, 'noteGscPropertyPermissionOnce_') +
    extractFn(utilsSrc, 'isGscPropertyPermissionNoted_'),
  context
);

context.__sites = [
  'https://mortal-shell-ii.vercel.app/',
  'sc-domain:crushlanding.wiki',
  'sc-domain:resonance-a-plague-tale-legacy.vercel.app'
];
context.clearGscPropertyResolutionCache_();

var exact = context.resolveAccessibleGscProperty_('https://mortal-shell-ii.vercel.app');
assert(exact.ok && exact.matchedAs === 'url-prefix', 'exact url-prefix');
assert(exact.propertyUrl === 'https://mortal-shell-ii.vercel.app/', 'normalized exact');

var crush = context.resolveAccessibleGscProperty_('https://crushlanding.wiki/');
assert(crush.ok && crush.matchedAs === 'sc-domain', 'crush via domain');
assert(crush.propertyUrl === 'sc-domain:crushlanding.wiki', 'crush identity');

var resonance = context.resolveAccessibleGscProperty_(
  'https://resonance-a-plague-tale-legacy.vercel.app/'
);
assert(resonance.ok && resonance.matchedAs === 'sc-domain', 'resonance via domain');

context.__sites = ['https://other.example/'];
context.clearGscPropertyResolutionCache_();
var missing = context.resolveAccessibleGscProperty_('https://crushlanding.wiki/');
assert(!missing.ok, 'missing when neither form accessible');
assert(missing.tried.indexOf('sc-domain:crushlanding.wiki') >= 0, 'tried domain');
assert(context.noteGscPropertyPermissionOnce_('Crush', missing) === true, 'first note');
assert(context.noteGscPropertyPermissionOnce_('Crush', missing) === false, 'second note suppressed');

// --- Runtime: align row width ---
vm.runInContext(extractFn(sheetSrc, 'alignRowToHeaders_'), context);
var padded = context.alignRowToHeaders_(['a', 'b'], ['A', 'B', 'C', 'D']);
assert(padded.length === 4 && padded[2] === '' && padded[3] === '', 'pad short row');
var truncated = context.alignRowToHeaders_(['a', 'b', 'c', 'd', 'e'], ['A', 'B', 'C']);
assert(truncated.length === 3 && truncated[2] === 'c', 'truncate long row');

// --- Runtime: cursor wrap math ---
function advanceSiteCursor(siteCursor, total) {
  var next = siteCursor + 1;
  if (next >= total) next = 0;
  return next;
}
assert(advanceSiteCursor(18, 19) === 0, 'wrap after last site');
assert(advanceSiteCursor(0, 19) === 1, 'advance mid round');

console.log('PASS scripts/test-index-audit-batch.js');
