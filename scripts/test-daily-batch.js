/**
 * Deterministic runtime regression for runDaily batching.
 * Run: node scripts/test-daily-batch.js
 */
'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');

function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function ' + name);
  var next = src.indexOf('\nfunction ', start + 1);
  return next >= 0 ? src.slice(start, next) : src.slice(start);
}

// Static contracts: small fixed batches, cursor state, setup only on the daily entry,
// and no same-day reset after finalization.
var unlocked = extractFn(codeSrc, 'runDailyUnlocked_');
assert(/if \(!isContinuation\) setupSheets\(\)/.test(unlocked), 'daily entry sets up sheets');
assert(/DAILY_MAX_SITES_PER_EXECUTION/.test(unlocked), 'daily has a site batch cap');
assert(/getDailyCursor_\(sites\)/.test(unlocked), 'daily loads cursor');
assert(/setDailyCursor_\(cursor\)/.test(unlocked), 'daily persists cursor');
assert(/processSiteDaily_\(site, runDate\)/.test(unlocked), 'daily preserves site processor');
assert(/recordDailySiteError_\(site, runDate, e\)/.test(unlocked), 'site errors are terminal and isolated');
assert(!/getDailyRunPhase_\(\) === 'done'/.test(codeSrc), 'same-day done state is not reset');
assert(/runDailyWithLock_\(true\)/.test(extractFn(codeSrc, 'runDailyContinuation_')), 'continuation resumes');
assert(/DAILY_CURSOR_PROP/.test(configSrc), 'daily cursor property exists');
assert(/DAILY_MAX_SITES_PER_EXECUTION = 4/.test(configSrc), 'daily batch cap is 4');
assert(/DAILY_CONTINUE_HANDLER/.test(configSrc), 'continuation handler exists');
assert(/function setupSheets/.test(sheetSrc), 'setupSheets remains the existing setup path');
assert(configSrc.indexOf("propertyUrl: 'https://agent-64.vercel.app/'") >= 0, 'Agent 64 short domain');
assert(/seedSitesIfEmpty_[\s\S]*if \(sheet\.getLastRow\(\) > 1\) return/.test(sheetSrc), 'site seed is non-destructive');
assert(extractFn(sheetSrc, 'getEnabledSites').indexOf('normalizePropertyUrlForGsc_(propertyUrl)') >= 0, 'runtime reads current site URL');
var processFn = extractFn(codeSrc, 'processSiteDaily_');
assert(/configuredUrl = site\.propertyUrl/.test(processFn), 'GSC starts from current site config');
assert(/resolveAccessibleGscProperty_/.test(processFn), 'daily resolves accessible GSC property');

// Runtime: execute the real runDaily functions with Apps Script boundary stubs.
var propsState = {};
var props = {
  getProperty: function (key) { return Object.prototype.hasOwnProperty.call(propsState, key) ? propsState[key] : null; },
  setProperty: function (key, value) { propsState[key] = String(value); },
  deleteProperty: function (key) { delete propsState[key]; }
};
var triggers = [];
var calls = [];
var errors = [];
var snapshots = [];
var setupCalls = 0;
var decisionRuns = 0;
var today = '2026-09-08';
var sites = makeSites(20);
var failures = {};

function makeSites(count) {
  var out = [];
  for (var i = 0; i < count; i++) {
    out.push({
      name: 'Site ' + i,
      propertyUrl: 'https://site-' + i + '.example/',
      siteId: 'site-' + i
    });
  }
  return out;
}

function resetState() {
  propsState = {};
  triggers.length = 0;
  calls.length = 0;
  errors.length = 0;
  snapshots.length = 0;
  setupCalls = 0;
  decisionRuns = 0;
  failures = {};
}

var context = { console: console, Date: Date, JSON: JSON, Math: Math };
vm.createContext(context);
vm.runInContext(configSrc + '\n' + codeSrc, context);

context.PropertiesService = { getScriptProperties: function () { return props; } };
context.ScriptApp = {
  getProjectTriggers: function () { return triggers.slice(); },
  deleteTrigger: function (trigger) {
    var index = triggers.indexOf(trigger);
    if (index >= 0) triggers.splice(index, 1);
  },
  newTrigger: function (handler) {
    var builder = {
      timeBased: function () { return builder; },
      after: function () { return builder; },
      create: function () {
        triggers.push({ getHandlerFunction: function () { return handler; } });
      }
    };
    return builder;
  }
};
context.LockService = {
  getScriptLock: function () {
    return { tryLock: function () { return true; }, releaseLock: function () {} };
  }
};
context.Logger = { log: function () {} };
context.assertRuntimePrerequisites_ = function () {};
context.setupSheets = function () { setupCalls += 1; };
context.getEnabledSites = function () { return sites; };
context.todayStr_ = function () { return today; };
context.gscTodayStr_ = function () { return today; };
context.writeLog_ = function (level, siteName, message) {
  if (level === 'ERROR') errors.push(siteName + '|' + message);
};
context.appendSnapshotRow_ = function (row) { snapshots.push(row); };
context.processSiteDaily_ = function (site) {
  calls.push(site.name);
  if (failures[site.name]) throw new Error('fixture failure');
};
context.runDailyFinalizerUnlocked_ = function (finalizerSites, runDate) {
  assert.equal(finalizerSites.length, sites.length, 'finalizer sees all enabled sites');
  assert.equal(runDate, today, 'finalizer uses the current run date');
  decisionRuns += 1;
  context.setDailyRunPhase_('done');
  context.deleteDailyContinuationTriggers_();
  return 'done';
};

function runContinuationUntilDone() {
  while (propsState.DAILY_RUN_PHASE !== 'done') context.runDailyContinuation_();
}

// 1-3, 6: 20 sites are split, cursor is saved, continuation starts at cursor 4,
// and the decision engine waits for the final batch and runs once.
var firstResult = context.runDaily();
assert.match(firstResult, /cursor=4\/20/);
assert.equal(setupCalls, 1, 'daily entry calls setupSheets once');
assert.deepEqual(calls, ['Site 0', 'Site 1', 'Site 2', 'Site 3'], 'one call handles only one small batch');
assert.equal(propsState.DAILY_CURSOR, '4', 'batch end saves cursor 4');
assert.equal(propsState.DAILY_RUN_PHASE, 'collect', 'batch end remains in collect phase');
assert.equal(triggers.length, 1, 'one continuation trigger is pending');
assert.equal(decisionRuns, 0, 'decision waits for all sites');

context.runDailyContinuation_();
assert.equal(setupCalls, 1, 'continuation does not repeat full setup');
assert.deepEqual(calls.slice(4, 8), ['Site 4', 'Site 5', 'Site 6', 'Site 7'], 'continuation starts at cursor 4');
assert.equal(propsState.DAILY_CURSOR, '8', 'second batch saves cursor 8');
runContinuationUntilDone();
assert.deepEqual(calls, makeSites(20).map(function (site) { return site.name; }), 'all sites run once');
assert.equal(propsState.DAILY_CURSOR, '20', 'completed cursor reaches site count');
assert.equal(decisionRuns, 1, 'decision runs once after collection');
assert.equal(triggers.length, 0, 'continuation trigger is removed after completion');

// 7: same-day primary entry is idempotent after the full run.
var callsAfterDone = calls.length;
context.runDaily();
assert.equal(calls.length, callsAfterDone, 'same-day completed run does not recollect');
assert.equal(decisionRuns, 1, 'same-day completed run does not rerun decision');

// 4-5: a new date resets the cursor, and a terminal site error advances it.
resetState();
sites = makeSites(3);
today = '2026-09-09';
failures['Site 1'] = true;
context.runDaily();
assert.deepEqual(calls, ['Site 0', 'Site 1', 'Site 2'], 'failed site does not block later sites');
assert.equal(errors.length, 1, 'failed site writes one error');
assert.equal(snapshots.length, 1, 'failed site writes one snapshot');
assert.equal(propsState.DAILY_CURSOR, '3', 'failed site still advances cursor');
assert.equal(decisionRuns, 1, 'decision runs after terminal site error');

today = '2026-09-10';
sites = makeSites(20);
context.runDaily();
assert.equal(propsState.DAILY_RUN_DATE, today, 'date change stores new run date');
assert.equal(propsState.DAILY_CURSOR, '4', 'date change resets cursor before first new batch');
assert.deepEqual(calls.slice(3, 7), ['Site 0', 'Site 1', 'Site 2', 'Site 3'], 'new date starts at site 0');

console.log('PASS scripts/test-daily-batch.js');
