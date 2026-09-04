/**
 * 后处理 Sheet 范围：numRows=lastRow-1，写入前扩容。
 * 运行：node scripts/test-sheet-range.js
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
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');
var oppSrc = fs.readFileSync(path.join(root, 'OpportunityEngine.gs'), 'utf8');
var utilsSrc = fs.readFileSync(path.join(root, 'Utils.gs'), 'utf8');

function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function ' + name);
  var next = src.indexOf('\nfunction ', start + 1);
  return next >= 0 ? src.slice(start, next) : src.slice(start);
}

function headerCount(src, varName) {
  var m = src.match(new RegExp('var ' + varName + '\\s*=\\s*(\\[[\\s\\S]*?\\]);'));
  assert(m, varName + ' missing');
  return eval(m[1]).length;
}

var siteStatusCols = headerCount(configSrc, 'SITE_STATUS_HEADERS');
var historyCols = headerCount(configSrc, 'DECISION_HISTORY_HEADERS');
assert(siteStatusCols === 39, '站点状态 39 列, got ' + siteStatusCols);
assert(historyCols > 26, '决策历史超过默认 26 列网格, got ' + historyCols);

var gridFn = extractFn(sheetSrc, 'ensureSheetGrid_');
assert(/insertColumnsAfter/.test(gridFn) && /insertRowsAfter/.test(gridFn), 'grid expands');
assert(/getMaxColumns\(\)/.test(gridFn) && /getMaxRows\(\)/.test(gridFn), 'uses max dimensions');

var dataFn = extractFn(sheetSrc, 'getSheetDataRange_');
assert(/sheetDataRowCount_/.test(dataFn), 'data range uses lastRow-1 helper');
assert(/return null/.test(dataFn), 'empty data skips range');

var sortFn = extractFn(sheetSrc, 'sortSheetByHeaders_');
assert(/var numRows = lastRow - 1/.test(sortFn), 'sort numRows is lastRow-1');
assert(!/getRange\(2, 1, lastRow, lastCol\)/.test(sortFn), 'sort no longer uses lastRow as numRows');
assert(/ensureSheetGrid_\(sheet, lastRow, lastCol\)/.test(sortFn), 'sort expands before range');

var replaceFn = extractFn(decisionSrc, 'replaceSheetDataRows_');
assert(/ensureSheetGrid_/.test(replaceFn), 'replace expands');
assert(/existingLast - 1/.test(replaceFn), 'clear uses lastRow-1');
assert(/1 \+ writeRows/.test(replaceFn), 'write expands rows for payload');

assert(/ensureSheetHeaders_\(sheet, SITE_STATUS_HEADERS\)/.test(decisionSrc), '站点状态 header migration is additive');
assert(/function writeDecisionSiteStatusRows_/.test(decisionSrc), '站点状态 daily writer is header addressed');
assert(/EarlySignalStatus/.test(extractFn(decisionSrc, 'writeDecisionSiteStatusRows_')), 'daily writer owns fields before EarlySignalStatus');
assert(/alignRowToHeaders_/.test(extractFn(decisionSrc, 'replaceSheetDataRows_')), 'replace pads rows to schema width');
assert(
  /ensureSheetGrid_\(sheet, 1, DECISION_HISTORY_HEADERS.length\)/.test(decisionSrc),
  '决策历史 header expands'
);

var appendFn = extractFn(decisionSrc, 'appendDecisionHistoryRows_');
assert(/ensureSheetGrid_/.test(appendFn), 'history append expands');

var loadOpp = extractFn(oppSrc, 'loadAllQueryPageRows_');
assert(/getSheetDataRange_/.test(loadOpp), 'opportunity reads Query×Page via safe range');
assert(!/getLastRow\(\), QUERY_PAGE_HEADERS/.test(loadOpp), 'opportunity no lastRow-as-numRows');

var errFn = extractFn(utilsSrc, 'formatErrorWithStack_');
assert(/err.stack/.test(errFn), 'stack in error formatter');

var finalizer = extractFn(codeSrc, 'runDailyFinalizerUnlocked_');
assert(/runDecisionEngine\(\)/.test(finalizer), 'finalizer calls decision');
assert(/runContentOpportunityEngine\(\)/.test(finalizer), 'finalizer calls opportunity');
assert(/setDailyRunPhase_\('done'\)/.test(finalizer), 'done after success');
assert(/throw e/.test(finalizer), 'rethrows');
assert(finalizer.indexOf("setDailyRunPhase_('done')") > finalizer.indexOf('runDecisionEngine()'), 'done after engines');

var unlocked = extractFn(codeSrc, 'runDailyUnlocked_');
assert(!/DECISION_ENGINE_FAILED/.test(unlocked), 'runDaily no longer swallows decision errors');
assert(/runDailyFinalizerUnlocked_/.test(unlocked), 'runDaily delegates finalizer');
assert(codeSrc.indexOf("addItem('重试每日后处理', 'runDailyFinalizer')") < 0, 'retired finalizer menu hidden');

function sheetDataRowCount_(lastRow) {
  return lastRow >= 2 ? lastRow - 1 : 0;
}
assert(sheetDataRowCount_(1) === 0, 'header-only skip');
assert(sheetDataRowCount_(9) === 8, '8 data rows from lastRow=9');
assert(2 + sheetDataRowCount_(9) - 1 === 9, 'range end equals lastRow');
assert(2 + 9 - 1 === 10, 'old lastRow-as-numRows would request row 10');

console.log('PASS scripts/test-sheet-range.js');
