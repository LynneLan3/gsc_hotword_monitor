/**
 * Recurring Apps Script entrypoints must use the read-only runtime preflight.
 * Run: node scripts/test-runtime-preflight.js
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
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');

function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function ' + name);
  var next = src.indexOf('\nfunction ', start + 1);
  return next >= 0 ? src.slice(start, next) : src.slice(start);
}

function assertRuntimeEntry(name) {
  var fn = extractFn(codeSrc, name);
  assert(/assertRuntimePrerequisites_\(\)/.test(fn), name + ' runs runtime preflight');
  assert(!/setupSheets\s*\(/.test(fn), name + ' does not run full setupSheets');
}

// Daily primary path and continuation share the same lightweight guard.
assertRuntimeEntry('runDailyUnlocked_');
assert(/runDailyWithLock_\(true\)/.test(extractFn(codeSrc, 'runDailyContinuation_')), 'continuation still uses locked runtime path');
assert(/runDailyWithLock_\(false\)/.test(extractFn(codeSrc, 'runDaily')), 'primary daily entry still uses locked runtime path');

// The other recurring/runtime entrypoints must not perform initialization.
assertRuntimeEntry('runDailyFinalizer');
assertRuntimeEntry('runIndexAuditBatch');

// Explicit initialization remains the owner of full setup.
assert(/setupSheets\s*\(\)/.test(extractFn(codeSrc, 'setup')), 'setup still performs full initialization');

var preflight = extractFn(sheetSrc, 'assertRuntimePrerequisites_');
assert(/getSheets\(\)/.test(preflight), 'preflight checks existing sheets');
assert(/Spreadsheet runtime structure incomplete\. Run setup\(\) once\./.test(preflight), 'preflight has actionable missing-structure error');
assert(!/ensureSheet_|insertSheet|setValues|setFont|setColumnWidth|flush|organizeSheetUi_|clearContent|setDataValidation/.test(preflight), 'preflight is read-only and does not perform setup work');

// Exercise the actual preflight body with a complete and an incomplete mock.
var context = {
  RUNTIME_REQUIRED_SHEET_NAMES: ['站点配置', '运行日志'],
  getSpreadsheet_: function () {
    return {
      getSheets: function () {
        return [
          { getName: function () { return '站点配置'; } },
          { getName: function () { return '运行日志'; } }
        ];
      }
    };
  }
};
vm.runInNewContext(preflight + '\nthis.assertRuntimePrerequisites_ = assertRuntimePrerequisites_;', context);
assert(context.assertRuntimePrerequisites_() === true, 'complete runtime structure passes preflight');

context.RUNTIME_REQUIRED_SHEET_NAMES = ['站点配置', '运行日志', 'URL索引'];
var missingError = null;
try {
  context.assertRuntimePrerequisites_();
} catch (e) {
  missingError = String(e && e.message || e);
}
assert(missingError && missingError.indexOf('Spreadsheet runtime structure incomplete. Run setup() once.') >= 0, 'missing runtime structure fails fast');
assert(missingError.indexOf('URL索引') >= 0, 'missing sheet is named in preflight error');

console.log('PASS scripts/test-runtime-preflight.js');
