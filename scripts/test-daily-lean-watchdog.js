/**
 * Regression: lost lean continuation + stale heartbeat must recover via watchdog.
 * Also: completed day must not re-run or stack continuation triggers.
 * Run: node scripts/test-daily-lean-watchdog.js
 */
'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
var hotfixSrc = fs.readFileSync(path.join(root, 'TimeoutRetentionHotfix.gs'), 'utf8');

function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'missing function ' + name);
  var next = src.indexOf('\nfunction ', start + 1);
  return next >= 0 ? src.slice(start, next) : src.slice(start);
}

// --- Static contracts ---
assert(/HOTFIX_HEARTBEAT_AT_PROP/.test(hotfixSrc), 'heartbeat prop exists');
assert(/HOTFIX_COMPLETED_DATE_PROP/.test(hotfixSrc), 'completed-date prop exists');
assert(/HOTFIX_WATCHDOG_HANDLER/.test(hotfixSrc), 'watchdog handler constant exists');
assert(/function runDailyLeanRecoveryWatchdog_/.test(hotfixSrc), 'watchdog function exists');
assert(/function ensureDailyLeanRecoveryWatchdog_/.test(hotfixSrc), 'watchdog installer exists');
assert(/function touchDailyLeanHeartbeat_/.test(hotfixSrc), 'heartbeat helper exists');
assert(
  /ensureDailyLeanRecoveryWatchdog_\(\);\s*\n\s*deleteDailyLeanContinuationTriggers_\(\);/.test(
    extractFn(hotfixSrc, 'runDailyLeanContinuation_')
  ),
  'continuation ensures recovery path before deleting trigger'
);
assert(
  /opsOut = runOpsDailyPipelineSafe_\(runDate\)/.test(extractFn(hotfixSrc, 'runDailyLeanUnlocked_')),
  'lean captures ops pipeline result'
);
assert(
  /HOTFIX_COMPLETED_DATE_PROP[\s\S]*runDate/.test(extractFn(hotfixSrc, 'runDailyLeanUnlocked_')) &&
    /opsOut && opsOut\.ok/.test(extractFn(hotfixSrc, 'runDailyLeanUnlocked_')),
  'completed date set only after OPS ok'
);

// --- Runtime harness ---
var propsState = {};
var triggers = [];
var calls = [];
var logs = [];
var setupCalls = 0;
var decisionRuns = 0;
var opsRuns = 0;
var today = '2026-09-10';
var sites = makeSites(20);
var nowMs = Date.parse('2026-09-10T08:00:00+08:00');

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
  logs.length = 0;
  setupCalls = 0;
  decisionRuns = 0;
  opsRuns = 0;
  nowMs = Date.parse('2026-09-10T08:00:00+08:00');
}

function countHandler(name) {
  return triggers.filter(function (t) {
    return t.getHandlerFunction() === name;
  }).length;
}

function FakeDate() {
  if (!(this instanceof FakeDate)) return new FakeDate();
  this._t = nowMs;
}
FakeDate.now = function () {
  return nowMs;
};
FakeDate.parse = Date.parse;
FakeDate.UTC = Date.UTC;
FakeDate.prototype.getTime = function () {
  return this._t;
};
FakeDate.prototype.toISOString = function () {
  return new Date(this._t).toISOString();
};
FakeDate.prototype.valueOf = function () {
  return this._t;
};

var props = {
  getProperty: function (key) {
    return Object.prototype.hasOwnProperty.call(propsState, key) ? propsState[key] : null;
  },
  setProperty: function (key, value) {
    propsState[key] = String(value);
  },
  deleteProperty: function (key) {
    delete propsState[key];
  }
};

var context = {
  console: console,
  Date: FakeDate,
  JSON: JSON,
  Math: Math,
  String: String,
  parseInt: parseInt,
  isNaN: isNaN
};
vm.createContext(context);

var runtimeSrc =
  extractFn(hotfixSrc, 'runDailyLean') +
  extractFn(hotfixSrc, 'runDailyLeanContinuation_') +
  extractFn(hotfixSrc, 'runDailyLeanWithLock_') +
  extractFn(hotfixSrc, 'runDailyLeanUnlocked_') +
  extractFn(hotfixSrc, 'scheduleDailyLeanContinuation_') +
  extractFn(hotfixSrc, 'deleteDailyLeanContinuationTriggers_') +
  extractFn(hotfixSrc, 'countDailyLeanContinuationTriggers_') +
  extractFn(hotfixSrc, 'touchDailyLeanHeartbeat_') +
  extractFn(hotfixSrc, 'ensureDailyLeanRecoveryWatchdog_') +
  extractFn(hotfixSrc, 'runDailyLeanRecoveryWatchdog_');

// Constants used by extracted fns
vm.runInContext(
  [
    "var HOTFIX_DAILY_HANDLER = 'runDailyLean';",
    "var HOTFIX_CONTINUE_HANDLER = 'runDailyLeanContinuation_';",
    "var HOTFIX_WATCHDOG_HANDLER = 'runDailyLeanRecoveryWatchdog_';",
    "var HOTFIX_RUN_DATE_PROP = 'HOTFIX_DAILY_RUN_DATE_V1';",
    "var HOTFIX_CURSOR_PROP = 'HOTFIX_DAILY_CURSOR_V1';",
    "var HOTFIX_HEARTBEAT_AT_PROP = 'HOTFIX_DAILY_HEARTBEAT_AT_V1';",
    "var HOTFIX_COMPLETED_DATE_PROP = 'HOTFIX_DAILY_COMPLETED_DATE_V1';",
    'var HOTFIX_CONTINUE_AFTER_MS = 60 * 1000;',
    'var HOTFIX_MAX_MS = 210 * 1000;',
    'var HOTFIX_MAX_SITES_PER_EXECUTION = 4;',
    'var HOTFIX_HEARTBEAT_STALE_MS = 10 * 60 * 1000;',
    'var HOTFIX_WATCHDOG_EVERY_MINUTES = 15;',
    "var SHEET_NAMES = { LOG: '运行日志' };",
    runtimeSrc
  ].join('\n'),
  context
);

context.PropertiesService = { getScriptProperties: function () { return props; } };
context.ScriptApp = {
  getProjectTriggers: function () {
    return triggers.slice();
  },
  deleteTrigger: function (trigger) {
    var index = triggers.indexOf(trigger);
    if (index >= 0) triggers.splice(index, 1);
  },
  newTrigger: function (handler) {
    var builder = {
      timeBased: function () {
        return builder;
      },
      after: function () {
        return builder;
      },
      everyMinutes: function () {
        return builder;
      },
      atHour: function () {
        return builder;
      },
      everyDays: function () {
        return builder;
      },
      inTimezone: function () {
        return builder;
      },
      create: function () {
        triggers.push({
          getHandlerFunction: function () {
            return handler;
          }
        });
      }
    };
    return builder;
  }
};
context.LockService = {
  getScriptLock: function () {
    return {
      tryLock: function () {
        return true;
      },
      releaseLock: function () {}
    };
  }
};
context.Logger = { log: function () {} };
context.clearGscPropertyResolutionCache_ = function () {};
context.setupSheets = function () {
  setupCalls += 1;
};
context.getEnabledSites = function () {
  return sites;
};
context.todayStr_ = function () {
  return today;
};
context.writeLog_ = function (level, site, message) {
  logs.push(level + '|' + message);
};
context.appendSnapshotRow_ = function () {};
context.processSiteDailyLean_ = function (site) {
  calls.push(site.name);
};
context.sortMonitoringSheetsNewestFirst_ = function () {};
context.runDecisionEngine = function () {
  decisionRuns += 1;
};
context.runContentOpportunityEngine = function () {};
context.refreshDemandRadar_ = function () {};
context.runOpsDailyPipelineSafe_ = function (runDate) {
  opsRuns += 1;
  return { ok: true, history: { written: sites.length }, report: { actions: [] }, errors: [] };
};
context.formatErrorWithStack_ = function (e) {
  return String(e && e.message ? e.message : e);
};
context.saveGscMonitoringRaw_ = function () {};
context.runGscRetentionCleanup = function () {};
context.sortSheetsNewestFirst_ = function () {};

function runContinuationUntilPausedOrDone() {
  var guard = 0;
  while (guard < 30) {
    guard += 1;
    var result = context.runDailyLeanContinuation_();
    if (String(result).indexOf('done') === 0) return result;
    if (String(result).indexOf('paused') === 0) return result;
  }
  throw new Error('continuation loop did not settle');
}

// 1) First slice pauses at 4/20 with continuation + watchdog + heartbeat.
resetState();
var first = context.runDailyLean();
assert.match(String(first), /paused 4\/20/);
assert.deepStrictEqual(calls, ['Site 0', 'Site 1', 'Site 2', 'Site 3']);
assert.strictEqual(propsState.HOTFIX_DAILY_CURSOR_V1, '4');
assert.strictEqual(propsState.HOTFIX_DAILY_RUN_DATE_V1, today);
assert.ok(propsState.HOTFIX_DAILY_HEARTBEAT_AT_V1, 'heartbeat written after progress');
assert.strictEqual(countHandler('runDailyLeanContinuation_'), 1, 'continuation pending after pause');
assert.strictEqual(countHandler('runDailyLeanRecoveryWatchdog_'), 1, 'watchdog installed');
assert.strictEqual(decisionRuns, 0);
assert.strictEqual(opsRuns, 0);

// 2) Production fault: continuation disappears while cursor incomplete + heartbeat goes stale.
triggers = triggers.filter(function (t) {
  return t.getHandlerFunction() !== 'runDailyLeanContinuation_';
});
assert.strictEqual(countHandler('runDailyLeanContinuation_'), 0, 'continuation lost');
nowMs += 11 * 60 * 1000; // past HOTFIX_HEARTBEAT_STALE_MS (10m)

var recovered = context.runDailyLeanRecoveryWatchdog_();
assert.strictEqual(recovered, 'recover-continuation');
assert.strictEqual(countHandler('runDailyLeanContinuation_'), 1, 'watchdog restored continuation');
assert.strictEqual(countHandler('runDailyLeanRecoveryWatchdog_'), 1, 'still exactly one watchdog');
assert.strictEqual(calls.length, 4, 'watchdog only schedules; does not process sites itself');

// 3) Resume through restored continuation until complete.
nowMs += 60 * 1000;
while (propsState.HOTFIX_DAILY_COMPLETED_DATE_V1 !== today) {
  var step = context.runDailyLeanContinuation_();
  if (String(step).indexOf('paused') === 0) {
    nowMs += 60 * 1000;
    continue;
  }
  if (String(step).indexOf('done') === 0) break;
  throw new Error('unexpected step: ' + step);
}
assert.strictEqual(calls.length, 20, 'all sites processed after recovery');
assert.strictEqual(propsState.HOTFIX_DAILY_CURSOR_V1, '20');
assert.strictEqual(propsState.HOTFIX_DAILY_COMPLETED_DATE_V1, today, 'completed after OPS ok');
assert.strictEqual(decisionRuns, 1);
assert.strictEqual(opsRuns, 1);
assert.strictEqual(countHandler('runDailyLeanContinuation_'), 0, 'no continuation after done');
assert.ok(
  logs.some(function (line) {
    return line.indexOf('runDailyLean 完成') >= 0;
  }),
  'completion log present'
);

// 4) Completed day: watchdog is a no-op and does not stack triggers.
var continueBefore = countHandler('runDailyLeanContinuation_');
var watchdogBefore = countHandler('runDailyLeanRecoveryWatchdog_');
nowMs += 30 * 60 * 1000;
var skipped = context.runDailyLeanRecoveryWatchdog_();
assert.strictEqual(skipped, 'complete');
assert.strictEqual(countHandler('runDailyLeanContinuation_'), continueBefore);
assert.strictEqual(countHandler('runDailyLeanRecoveryWatchdog_'), watchdogBefore);
assert.strictEqual(opsRuns, 1, 'watchdog does not re-run OPS after complete');
assert.strictEqual(decisionRuns, 1, 'watchdog does not re-run engines after complete');

// 5) Cursor complete but OPS not marked complete → recover finalizer.
resetState();
propsState.HOTFIX_DAILY_RUN_DATE_V1 = today;
propsState.HOTFIX_DAILY_CURSOR_V1 = '20';
propsState.HOTFIX_DAILY_HEARTBEAT_AT_V1 = String(nowMs - 11 * 60 * 1000);
context.ensureDailyLeanRecoveryWatchdog_();
var finalizerRecover = context.runDailyLeanRecoveryWatchdog_();
assert.strictEqual(finalizerRecover, 'recover-finalizer');
assert.strictEqual(countHandler('runDailyLeanContinuation_'), 1);
context.runDailyLeanContinuation_();
assert.strictEqual(opsRuns, 1, 'finalizer recovery runs OPS');
assert.strictEqual(propsState.HOTFIX_DAILY_COMPLETED_DATE_V1, today);

console.log('PASS scripts/test-daily-lean-watchdog.js');
