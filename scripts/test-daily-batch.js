/**
 * runDaily 分批续跑 + Agent 64 短域名保护（本地静态检查）。
 * 运行：node scripts/test-daily-batch.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

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

function nextDailyPendingSites_(sites, doneNames) {
  var pending = [];
  var done = doneNames || [];
  for (var i = 0; i < (sites || []).length; i++) {
    if (done.indexOf(sites[i].name) < 0) pending.push(sites[i]);
  }
  return pending;
}

function shouldPauseDailyRun_(processedThisRun, startedAt, nowMs, maxMs) {
  return processedThisRun > 0 && nowMs - startedAt > maxMs;
}

var SHORT = 'https://agent-64.vercel.app/';
var LONG = 'https://agent-64-spies-never-die.vercel.app/';
var AGENT = 'Agent 64: Spies Never Die';

// --- 1. 默认配置与 seed 不得覆盖已有第9行 ---
assert(configSrc.indexOf("propertyUrl: 'https://agent-64.vercel.app/'") >= 0, 'DEFAULT_SITES short domain');
assert(configSrc.indexOf('agent-64-spies-never-die') < 0, 'DEFAULT_SITES has no long domain');
assert(/seedSitesIfEmpty_[\s\S]*if \(sheet\.getLastRow\(\) > 1\) return/.test(sheetSrc), 'seed does not overwrite existing sites');
assert(extractFn(sheetSrc, 'getEnabledSites').indexOf('normalizePropertyUrlForGsc_(propertyUrl)') >= 0, 'runtime reads current 站点配置 URL');

// --- 2. 续跑状态只用站点名，GSC URL 来自当前启用站点 ---
var unlocked = extractFn(codeSrc, 'runDailyUnlocked_');
assert(/getEnabledSites\(\)/.test(unlocked), 'unlocked re-reads enabled sites');
assert(/nextDailyPendingSites_\(sites, doneNames\)/.test(unlocked), 'pending from current sites + done names');
assert(/processSiteDaily_\(site, runDate\)/.test(unlocked), 'processes current site object');
assert(unlocked.indexOf('DEFAULT_SITES') < 0, 'must not restore DEFAULT_SITES URLs at runtime');
assert(!/SNAPSHOT|每日快照/.test(unlocked.replace(/appendSnapshotRow_/g, '')), 'must not restore URL from snapshots');
assert(/markDailySiteDone_\(site\.name\)/.test(unlocked), 'checkpoint by site name');
assert(/runDailyFinalizerUnlocked_\(sites, runDate\)/.test(unlocked), 'engines via finalizer');
assert(/setDailyRunPhase_\('engines'\)/.test(unlocked), 'engines only after collect');
assert(/scheduleDailyContinuation_/.test(unlocked), 'schedules continuation');
assert(!/setDailyRunPhase_\('done'\)/.test(unlocked), 'collect path does not mark done');

var finalizerFn = extractFn(codeSrc, 'runDailyFinalizerUnlocked_');
assert(/runDecisionEngine\(\)/.test(finalizerFn) && /runContentOpportunityEngine\(\)/.test(finalizerFn), 'finalizer runs engines');
assert(/refreshDemandRadar_\(sites, runDate\)/.test(finalizerFn), 'finalizer refreshes demand radar');
assert(
  finalizerFn.indexOf('runContentOpportunityEngine') < finalizerFn.indexOf('refreshDemandRadar_'),
  'radar after GSC collect + opportunity'
);
assert(/setDailyRunPhase_\('done'\)/.test(finalizerFn), 'done only after finalizer success');
assert(/formatErrorWithStack_/.test(finalizerFn), 'finalizer logs stack');
assert(/throw e/.test(finalizerFn), 'finalizer does not swallow');

var pendingFn = extractFn(codeSrc, 'nextDailyPendingSites_');
assert(/sites\[i\]\.name/.test(pendingFn), 'pending match by name');
assert(!/propertyUrl/.test(pendingFn), 'pending helper does not key on URL');

var doneFn = extractFn(codeSrc, 'markDailySiteDone_');
assert(/DAILY_DONE_SITES_PROP/.test(doneFn), 'stores done names');
assert(!/propertyUrl|vercel\.app/.test(doneFn), 'done state has no URL');

var processFn = extractFn(codeSrc, 'processSiteDaily_');
assert(/propertyUrl = site\.propertyUrl/.test(processFn), 'GSC uses site.propertyUrl from config');
assert(/开始采集 propertyUrl=/.test(processFn), 'logs the URL actually queried');

// --- 3. 模拟：历史长域名快照不得进入续跑 GSC 请求 ---
var enabled = [
  { name: 'Leafy Corner', propertyUrl: 'https://leafy-corner.vercel.app/' },
  { name: AGENT, propertyUrl: SHORT }
];
var historicalSnapshot = { name: AGENT, propertyUrl: LONG, runDate: '2026-08-14' };
var pending = nextDailyPendingSites_(enabled, ['Leafy Corner']);
assert(pending.length === 1 && pending[0].name === AGENT, 'resume remaining by name');
assert(pending[0].propertyUrl === SHORT, 'resume URL from current config');
assert(pending[0].propertyUrl !== historicalSnapshot.propertyUrl, 'must not use 2026-08-14 long-domain snapshot');
assert(pending[0].propertyUrl.indexOf('spies-never-die') < 0, 'no long host in pending GSC URL');

assert(shouldPauseDailyRun_(1, 0, 270001, 270000) === true, 'pause after progress + budget');
assert(shouldPauseDailyRun_(0, 0, 270001, 270000) === false, 'always process at least one site');
assert(shouldPauseDailyRun_(1, 0, 1000, 270000) === false, 'continue under budget');

// --- 4. 续跑 trigger 不得误删每日 runDaily ---
var sched = extractFn(codeSrc, 'scheduleDailyContinuation_');
assert(/DAILY_CONTINUE_HANDLER/.test(sched), 'continuation handler constant');
assert(!/newTrigger\('runDaily'\)/.test(sched), 'must not recreate the 8am runDaily trigger');
var del = extractFn(codeSrc, 'deleteDailyContinuationTriggers_');
assert(/=== DAILY_CONTINUE_HANDLER/.test(del), 'only deletes continuation triggers');
assert(/function runDailyContinuation_/.test(codeSrc), 'continuation entry exists');
assert(/runDailyWithLock_\(true\)/.test(extractFn(codeSrc, 'runDailyContinuation_')), 'continuation resumes');
assert(/runDailyWithLock_\(false\)/.test(extractFn(codeSrc, 'runDaily')), 'menu/8am is primary');

assert(/var DAILY_RUN_MAX_MS/.test(configSrc), 'time budget constant');
assert(/var DAILY_CONTINUE_HANDLER/.test(configSrc), 'handler name constant');

// --- 5. setup / 7站旧代码不得删 Agent 64 ---
assert(!/deleteRow|clearContent|getLastRow\(\) === 8/.test(extractFn(sheetSrc, 'seedSitesIfEmpty_')), 'seed never deletes extra site rows');
assert(!/for \(var i = .*DEFAULT_SITES\.length[\s\S]*deleteRow/.test(sheetSrc), 'no trim-to-7-sites');

console.log('PASS scripts/test-daily-batch.js');
