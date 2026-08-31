/* Static regression coverage for the lean daily collector and retention boundary. */
'use strict';

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = path.join(__dirname, '..');
const hotfix = fs.readFileSync(path.join(root, 'TimeoutRetentionHotfix.gs'), 'utf8');
const config = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');

const lean = hotfix.slice(hotfix.indexOf('function processSiteDailyLean_('), hotfix.indexOf('\nfunction scheduleDailyLeanContinuation_'));
const installer = hotfix.slice(hotfix.indexOf('function installTimeoutRetentionHotfix('), hotfix.indexOf('\nfunction runDailyLean()'));
const cleanup = hotfix.slice(hotfix.indexOf('function runGscRetentionCleanup('), hotfix.indexOf('\nfunction retentionCutoff_'));

assert(/function runDailyLean\(\)/.test(hotfix), 'lean daily entry exists');
assert(/HOTFIX_MAX_SITES_PER_EXECUTION = 4/.test(hotfix), 'daily batch cap is 4');
assert(/HOTFIX_MAX_MS = 210 \* 1000/.test(hotfix), 'daily budget is 210 seconds');
assert(/LockService\.getScriptLock\(\)/.test(hotfix), 'daily uses ScriptLock');
assert(/HOTFIX_CURSOR_PROP/.test(hotfix) && /scheduleDailyLeanContinuation_\(\)/.test(hotfix), 'cursor continuation exists');
assert(/runDecisionEngine\(\)/.test(hotfix) && /runContentOpportunityEngine\(\)/.test(hotfix), 'finalizer remains after collection');
['syncFreshQueryDetails_', 'syncFreshQueryPageDetails_', 'syncFreshPageDetails_'].forEach(name => {
  assert(!new RegExp('\\b' + name + '\\s*\\(').test(lean), 'lean collector does not call ' + name);
});
assert(/handler === 'runDaily'/.test(installer), 'installer removes legacy daily trigger');
assert(/handler === HOTFIX_DAILY_HANDLER/.test(installer), 'installer removes duplicate lean trigger');
assert(/handler === HOTFIX_CONTINUE_HANDLER/.test(installer), 'installer removes stale continuation');
assert(/atHour\(8\)/.test(installer) && /everyDays\(1\)/.test(installer), 'installer creates 08:00 daily trigger');
assert(/HOTFIX_LOG_RETENTION_DAYS = 30/.test(hotfix), 'logs retain 30 days');
assert(/HOTFIX_URL_INDEX_ACTIVE_DAYS = 90/.test(hotfix), 'URL index hot data retains 90 days');
assert(/GSC_RAW_ARCHIVE_PROOF_DATES_V1/.test(hotfix) && /pruneUrlIndexAfterRawProof_\(urlCutoff\)/.test(cleanup), 'URL index requires local RAW proof');
assert(/markGscRawArchiveProof/.test(hotfix), 'RAW proof marker exists');
assert(/source\.deleteRow\(rowNumber\)/.test(hotfix), 'only RAW-proven URL rows are removed from active');
assert(!/HOTFIX_RETENTION_DAYS/.test(hotfix), 'old 14-day retention constant removed');
assert(/URL_INDEX_HEADERS/.test(config), 'URL index schema remains canonical');

console.log('PASS scripts/test-timeout-retention-hotfix.js');
