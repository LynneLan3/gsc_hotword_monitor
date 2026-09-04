/**
 * G028 P3 — wire ops daily into existing daily/finalizer (no new scheduler).
 * Run: node scripts/test-ops-daily-p3.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function ' + name);
  var next = src.indexOf('\nfunction ', start + 1);
  return next >= 0 ? src.slice(start, next) : src.slice(start);
}

var root = path.join(__dirname, '..');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var leanSrc = fs.readFileSync(path.join(root, 'TimeoutRetentionHotfix.gs'), 'utf8');
var opsSrc = fs.readFileSync(path.join(root, 'OpsDailyReport.gs'), 'utf8');

var finalizer = extractFn(codeSrc, 'runDailyFinalizerUnlocked_');
assert(/runOpsDailyPipelineSafe_\(runDate\)/.test(finalizer), 'finalizer wires pipeline');
assert(
  finalizer.indexOf('runOpsDailyPipelineSafe_') > finalizer.indexOf('runGa4CentralSync_'),
  'ops after GA4 in finalizer'
);
assert(
  finalizer.indexOf('runOpsDailyPipelineSafe_') < finalizer.indexOf("setDailyRunPhase_('done')"),
  'ops before done phase'
);
assert(/OPS_DAILY_PIPELINE_FAILED/.test(finalizer), 'finalizer logs ops failure');
assert(!/throw opsError|throw \(opsError\)/.test(finalizer), 'ops catch does not rethrow');

var lean = extractFn(leanSrc, 'runDailyLeanUnlocked_');
assert(/runOpsDailyPipelineSafe_\(runDate\)/.test(lean), 'lean daily wires pipeline');
assert(
  lean.indexOf('runOpsDailyPipelineSafe_') > lean.indexOf('runDecisionEngine'),
  'ops after lean engines'
);
assert(
  lean.indexOf('runOpsDailyPipelineSafe_') < lean.indexOf('saveGscMonitoringRaw_'),
  'ops before history sync throw path'
);
assert(/OPS_DAILY_PIPELINE_FAILED/.test(lean), 'lean logs ops failure');

var pipeline = extractFn(opsSrc, 'runOpsDailyPipelineSafe_');
assert(pipeline.indexOf('runOpsDailyReportHistory_') < pipeline.indexOf('runOpsDailyReport_'),
  'P1 then P2');
assert(/OPS_DAILY_HISTORY_FAILED/.test(pipeline) && /OPS_DAILY_REPORT_FAILED/.test(pipeline),
  'step failures logged');
assert(/OPS_DAILY_PIPELINE_DONE/.test(pipeline), 'success log marker');

// Must not create a second daily scheduler for ops.
assert(!/newTrigger\(['\"]runOpsDaily/.test(codeSrc + leanSrc + opsSrc),
  'no dedicated ops trigger');
assert(!/newTrigger\(['\"]runOpsDailyPipelineSafe_/.test(codeSrc + leanSrc),
  'pipeline not scheduled separately');

console.log('PASS scripts/test-ops-daily-p3.js');
