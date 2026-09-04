/**
 * GSC timeout + retention hotfix.
 *
 * Purpose:
 * - Keep the existing 6-hour runFreshQueryMonitor as the owner of Fresh Query / Query×Page / Page detail sync.
 * - Make the daily collector lightweight so one high-volume site cannot consume the whole Apps Script execution.
 * - Keep ScriptLock + cursor continuation.
 * - Keep GSC runtime logs for 30 days and archive URL Inspection history after 90 days.
 *
 * This file is additive: it does not delete or redefine the existing runDaily implementation.
 * After deploy, call installTimeoutRetentionHotfix() once to switch only the daily trigger.
 */

var HOTFIX_DAILY_HANDLER = 'runDailyLean';
var HOTFIX_CONTINUE_HANDLER = 'runDailyLeanContinuation_';
var HOTFIX_RUN_DATE_PROP = 'HOTFIX_DAILY_RUN_DATE_V1';
var HOTFIX_CURSOR_PROP = 'HOTFIX_DAILY_CURSOR_V1';
var HOTFIX_CONTINUE_AFTER_MS = 60 * 1000;
var HOTFIX_MAX_MS = 210 * 1000;
var HOTFIX_MAX_SITES_PER_EXECUTION = 4;
var HOTFIX_LOG_RETENTION_DAYS = 30;
var HOTFIX_URL_INDEX_ACTIVE_DAYS = 90;
var HOTFIX_URL_INDEX_ARCHIVE_SHEET = 'URL索引_Archive';

/**
 * One-time installer after clasp push.
 * Replaces only runDaily / hotfix daily triggers. Existing Fresh Query and URL-index triggers are untouched.
 */
function installTimeoutRetentionHotfix() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var handler = triggers[i].getHandlerFunction();
    if (
      handler === 'runDaily' ||
      handler === HOTFIX_DAILY_HANDLER ||
      handler === HOTFIX_CONTINUE_HANDLER
    ) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger(HOTFIX_DAILY_HANDLER)
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .inTimezone('Asia/Shanghai')
    .create();

  PropertiesService.getScriptProperties().deleteProperty(HOTFIX_RUN_DATE_PROP);
  PropertiesService.getScriptProperties().deleteProperty(HOTFIX_CURSOR_PROP);
  writeLog_('INFO', '', 'Timeout/retention hotfix installed: daily=runDailyLean, log=30d, urlIndex=90d+archive');
  return 'installed';
}

function runDailyLean() {
  return runDailyLeanWithLock_(false);
}

function runDailyLeanContinuation_() {
  deleteDailyLeanContinuationTriggers_();
  return runDailyLeanWithLock_(true);
}

function runDailyLeanWithLock_(isContinuation) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    writeLog_('WARN', '', 'runDailyLean skipped: another daily collector is running');
    if (isContinuation) scheduleDailyLeanContinuation_();
    return 'lock busy';
  }

  try {
    return runDailyLeanUnlocked_(!!isContinuation);
  } finally {
    lock.releaseLock();
  }
}

function runDailyLeanUnlocked_(isContinuation) {
  var startedAt = Date.now();
  if (!isContinuation) setupSheets();

  var sites = getEnabledSites();
  var runDate = todayStr_();
  var props = PropertiesService.getScriptProperties();
  var storedDate = props.getProperty(HOTFIX_RUN_DATE_PROP);
  var cursor = parseInt(props.getProperty(HOTFIX_CURSOR_PROP) || '0', 10);
  if (isNaN(cursor) || cursor < 0) cursor = 0;

  if (storedDate !== runDate) {
    cursor = 0;
    props.setProperty(HOTFIX_RUN_DATE_PROP, runDate);
    props.setProperty(HOTFIX_CURSOR_PROP, '0');
  } else if (!isContinuation && cursor >= sites.length) {
    // A manual rerun on the same day intentionally starts a fresh idempotent pass.
    cursor = 0;
    props.setProperty(HOTFIX_CURSOR_PROP, '0');
  }

  writeLog_(
    'INFO',
    '',
    'runDailyLean 开始 sites=' + sites.length +
      ' cursor=' + cursor +
      ' continuation=' + (isContinuation ? 'yes' : 'no')
  );

  var processed = 0;
  while (cursor < sites.length) {
    if (
      processed >= HOTFIX_MAX_SITES_PER_EXECUTION ||
      (processed > 0 && Date.now() - startedAt >= HOTFIX_MAX_MS)
    ) {
      props.setProperty(HOTFIX_CURSOR_PROP, String(cursor));
      scheduleDailyLeanContinuation_();
      writeLog_('INFO', '', 'runDailyLean 分批暂停 cursor=' + cursor + '/' + sites.length);
      return 'paused ' + cursor + '/' + sites.length;
    }

    var site = sites[cursor];
    try {
      processSiteDailyLean_(site, runDate);
    } catch (e) {
      var errMsg = String(e && e.message ? e.message : e);
      writeLog_('ERROR', site.name, 'LEAN_DAILY_FAILED | ' + errMsg);
      appendSnapshotRow_([
        runDate, '', site.name, site.propertyUrl, '',
        '', '', '', '', '', '', '', '', '',
        '', '', '', '🔴 需要检查', errMsg,
        site.siteId || ''
      ]);
    }

    cursor += 1;
    processed += 1;
    props.setProperty(HOTFIX_CURSOR_PROP, String(cursor));
  }

  deleteDailyLeanContinuationTriggers_();

  // Existing downstream engines consume the latest finalized + fresh-monitor data.
  try {
    sortMonitoringSheetsNewestFirst_();
    runDecisionEngine();
    runContentOpportunityEngine();
    refreshDemandRadar_(sites, runDate);
  } catch (e) {
    writeLog_('ERROR', '', 'LEAN_DAILY_FINALIZER_FAILED | ' + String(e && e.message ? e.message : e));
  }

  try {
    // G028 P3 — same ops pipeline as runDailyFinalizer; must not break GSC facts.
    runOpsDailyPipelineSafe_(runDate);
  } catch (opsError) {
    var opsDetail =
      typeof formatErrorWithStack_ === 'function'
        ? formatErrorWithStack_(opsError)
        : String(opsError && opsError.message ? opsError.message : opsError);
    writeLog_('WARN', '', 'OPS_DAILY_PIPELINE_FAILED | ' + opsDetail);
    Logger.log('OPS_DAILY_PIPELINE_FAILED | ' + opsDetail);
  }

  try {
    saveGscMonitoringRaw_('gsc-daily-' + runDate, runDate);
  } catch (e) {
    writeLog_('ERROR', '', 'HISTORY_SYNC_FAILED | ' + String(e && e.message ? e.message : e));
    throw e;
  }

  try {
    runGscRetentionCleanup();
  } catch (e) {
    writeLog_('WARN', '', 'RETENTION_CLEANUP_FAILED | ' + String(e && e.message ? e.message : e));
  }

  sortSheetsNewestFirst_([SHEET_NAMES.LOG]);
  var elapsedMs = Date.now() - startedAt;
  writeLog_('INFO', '', 'runDailyLean 完成 sites=' + sites.length + ' elapsedMs=' + elapsedMs);
  return 'done ' + sites.length + ' elapsedMs=' + elapsedMs;
}

/**
 * Lightweight finalized collector.
 * IMPORTANT: no syncFreshQueryDetails_, syncFreshQueryPageDetails_ or syncFreshPageDetails_ here.
 * Those are already handled by runFreshQueryMonitor on its own schedule.
 */
function processSiteDailyLean_(site, runDate) {
  var errors = [];
  var propertyUrl = site.propertyUrl;
  var siteName = site.name;
  var permissionBlocked = false;
  writeLog_('INFO', siteName, 'Lean开始采集 propertyUrl=' + propertyUrl);

  var latestDate = '';
  try {
    latestDate = findLatestGscDataDate(propertyUrl, LOOKBACK_DAYS_FOR_LATEST);
  } catch (e) {
    if (typeof isGscPermissionError_ === 'function' && isGscPermissionError_(e)) {
      permissionBlocked = true;
      errors.push('PROPERTY_PERMISSION | siteUrl=' + propertyUrl + ' | ' + e.message);
    } else {
      errors.push('GSC最新日期: ' + e.message);
    }
  }

  var sitemapCount = 0;
  try {
    sitemapCount = fetchSitemapUrls(site.sitemapUrl).length;
  } catch (e) {
    errors.push('Sitemap: ' + e.message);
  }

  var indexedCount = '';
  var indexRate = '';
  var known = getLatestKnownIndexStats_(siteName);
  if (known) {
    indexedCount = known.indexedCount;
    indexRate = sitemapCount > 0 ? percent_(indexedCount, sitemapCount) : '';
  }

  var totals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  var queryRows = [];
  var pageRows = [];
  var topQueries = '';
  var topPages = '';
  var returnedQueryCount = 0;
  var newQueriesText = '';

  if (latestDate && !permissionBlocked) {
    try {
      totals = fetchSiteTotals(propertyUrl, latestDate);
    } catch (e) {
      errors.push('Totals: ' + e.message);
    }

    try {
      queryRows = fetchQueries(propertyUrl, latestDate, QUERY_ROW_LIMIT);
      returnedQueryCount = queryRows.length;
      topQueries = formatTopList_(queryRows, 'query', TOP_N);
    } catch (e) {
      errors.push('Queries: ' + e.message);
    }

    try {
      pageRows = fetchPages(propertyUrl, latestDate, QUERY_ROW_LIMIT);
      topPages = formatTopList_(pageRows, 'page', TOP_N);
    } catch (e) {
      errors.push('Pages: ' + e.message);
    }

    try {
      upsertDailyRow_([
        latestDate, siteName,
        totals.clicks, totals.impressions, totals.ctr, totals.position,
        returnedQueryCount, topQueries, topPages
      ]);
    } catch (e) {
      errors.push('写GSC日数据: ' + e.message);
    }

    try {
      newQueriesText = computeNewQueries_(siteName, latestDate, queryRows);
    } catch (e) {
      errors.push('NewQueries: ' + e.message);
    }
  }

  var firstImpression = getKnownFirstImpressionDate_(siteName);
  if (!firstImpression && site.day0 && latestDate && site.day0 <= latestDate) {
    try {
      firstImpression = findFirstImpressionDate(propertyUrl, site.day0, latestDate);
    } catch (e) {
      errors.push('FirstImpression: ' + e.message);
    }
  }

  var dayNum = calcDayNumber_(site.day0, latestDate || runDate);
  var status = computeStatus_({
    sitemapCount: sitemapCount,
    indexedCount: indexedCount,
    impressions: totals.impressions || 0,
    newQueries: newQueriesText,
    hasError: errors.length > 0
  });

  appendSnapshotRow_([
    runDate,
    latestDate || '',
    siteName,
    propertyUrl,
    dayNum === '' ? '' : dayNum,
    sitemapCount,
    indexedCount === '' ? '' : indexedCount,
    indexRate === '' ? '' : indexRate,
    totals.impressions || 0,
    totals.clicks || 0,
    totals.ctr || 0,
    totals.position || 0,
    returnedQueryCount,
    firstImpression || '',
    topQueries,
    topPages,
    newQueriesText,
    status,
    errors.join(' | '),
    site.siteId || ''
  ]);

  writeLog_(
    errors.length ? 'WARN' : 'INFO',
    siteName,
    'Lean完成 latest=' + (latestDate || '无') +
      ' sitemap=' + sitemapCount +
      ' indexed=' + (indexedCount === '' ? '无历史' : indexedCount) +
      (errors.length ? ' errors=' + errors.length : '')
  );
}

function scheduleDailyLeanContinuation_() {
  deleteDailyLeanContinuationTriggers_();
  ScriptApp.newTrigger(HOTFIX_CONTINUE_HANDLER)
    .timeBased()
    .after(HOTFIX_CONTINUE_AFTER_MS)
    .create();
}

function deleteDailyLeanContinuationTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === HOTFIX_CONTINUE_HANDLER) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * Retention boundary:
 * - 运行日志 is diagnostic-only and may be deleted after 30 days.
 * - URL索引 remains hot for 90 days; older rows move to URL索引_Archive.
 *   The archive is not read by the daily collector.
 */
function runGscRetentionCleanup() {
  var now = new Date();
  var logCutoff = retentionCutoff_(now, HOTFIX_LOG_RETENTION_DAYS);
  var urlCutoff = retentionCutoff_(now, HOTFIX_URL_INDEX_ACTIVE_DAYS);
  var removedLog = deleteLogsAfterRawProof_(logCutoff);
  var archivedIndex = pruneUrlIndexAfterRawProof_(urlCutoff);
  writeLog_(
    'INFO',
    '',
    'Retention cleanup log=30d deleted=' + removedLog +
      ' | urlIndex=90d active deleted=' + archivedIndex.deleted +
      ' awaitingRawProof=' + archivedIndex.awaitingRawProof
  );
  return { log: removedLog, urlIndexArchived: 0, urlIndexDeleted: archivedIndex.deleted, awaitingRawProof: archivedIndex.awaitingRawProof };
}

function gscRawArchiveProofDates_() {
  var raw = PropertiesService.getScriptProperties().getProperty('GSC_RAW_ARCHIVE_PROOF_DATES_V1');
  try { return new Set(JSON.parse(raw || '[]')); } catch (e) { return new Set(); }
}

function markGscRawArchiveProof(dates) {
  var current = gscRawArchiveProofDates_();
  (dates || []).forEach(function (date) { if (/^\d{4}-\d{2}-\d{2}$/.test(String(date))) current.add(String(date)); });
  PropertiesService.getScriptProperties().setProperty('GSC_RAW_ARCHIVE_PROOF_DATES_V1', JSON.stringify(Array.from(current).sort()));
  return Array.from(current).sort();
}

function pruneUrlIndexAfterRawProof_(cutoff) {
  var source = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.URL_INDEX);
  if (!source || source.getLastRow() < 2) return {deleted: 0, awaitingRawProof: 0};
  var proof = gscRawArchiveProofDates_(), rows = source.getRange(2, 1, source.getLastRow() - 1, URL_INDEX_HEADERS.length).getValues();
  var toDelete = [], awaiting = 0;
  rows.forEach(function (row, i) {
    var value = row[0], date = value instanceof Date ? Utilities.formatDate(value, 'Asia/Shanghai', 'yyyy-MM-dd') : String(value || '').substring(0, 10);
    if (!date || new Date(date) >= cutoff) return;
    if (!proof.has(date) && !gscRawDateExists_(date)) { awaiting++; return; }
    toDelete.push(i + 2);
  });
  toDelete.reverse().forEach(function (rowNumber) { source.deleteRow(rowNumber); });
  return {deleted: toDelete.length, awaitingRawProof: awaiting};
}

function retentionCutoff_(now, days) {
  var cutoff = new Date(now.getTime());
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

function deleteLogsAfterRawProof_(cutoff) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.LOG);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var width = Math.max(sheet.getLastColumn(), 1), headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  var dateCol = headers.indexOf('Timestamp'); if (dateCol < 0) dateCol = headers.indexOf('运行时间');
  if (dateCol < 0) return 0;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues(), remove = [];
  rows.forEach(function (row, i) {
    var raw = row[dateCol], date = raw instanceof Date ? Utilities.formatDate(raw, 'Asia/Shanghai', 'yyyy-MM-dd') : String(raw || '').substring(0, 10);
    if (date && new Date(date) < cutoff && gscRawDateExists_(date)) remove.push(i + 2);
  });
  remove.reverse().forEach(function (rowNumber) { sheet.deleteRow(rowNumber); });
  return remove.length;
}

function archiveUrlIndexRows_(cutoff) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var source = ss.getSheetByName(SHEET_NAMES.URL_INDEX);
  if (!source || source.getLastRow() < 2) return { archived: 0, deleted: 0 };

  var archive = ss.getSheetByName(HOTFIX_URL_INDEX_ARCHIVE_SHEET);
  if (!archive) archive = ss.insertSheet(HOTFIX_URL_INDEX_ARCHIVE_SHEET);
  if (archive.getLastRow() < 1) archive.getRange(1, 1, 1, URL_INDEX_HEADERS.length).setValues([URL_INDEX_HEADERS]);

  var rows = source.getRange(2, 1, source.getLastRow() - 1, URL_INDEX_HEADERS.length).getValues();
  var oldRows = [];
  var rowNumbers = [];
  for (var i = 0; i < rows.length; i++) {
    var raw = rows[i][0];
    var date = raw instanceof Date ? new Date(raw.getTime()) : new Date(raw);
    if (date instanceof Date && !isNaN(date.getTime()) && date < cutoff) {
      oldRows.push(rows[i]);
      rowNumbers.push(i + 2);
    }
  }
  if (!oldRows.length) return { archived: 0, deleted: 0 };

  // A deterministic row fingerprint makes retries idempotent without making the
  // daily collector read the archive.
  var existing = {};
  if (archive.getLastRow() >= 2) {
    archive.getRange(2, 1, archive.getLastRow() - 1, URL_INDEX_HEADERS.length).getValues().forEach(function (row) {
      existing[urlIndexArchiveKey_(row)] = true;
    });
  }
  var toAppend = oldRows.filter(function (row) {
    var key = urlIndexArchiveKey_(row);
    if (existing[key]) return false;
    existing[key] = true;
    return true;
  });
  if (toAppend.length) archive.getRange(archive.getLastRow() + 1, 1, toAppend.length, URL_INDEX_HEADERS.length).setValues(toAppend);

  for (var r = rowNumbers.length - 1; r >= 0; r--) source.deleteRow(rowNumbers[r]);
  return { archived: toAppend.length, deleted: rowNumbers.length };
}

function urlIndexArchiveKey_(row) {
  return row.map(function (value) {
    return value instanceof Date ? value.toISOString() : String(value === null || value === undefined ? '' : value);
  }).join('\u001f');
}

/**
 * Delete data rows where the date in dateColumn1Based is older than cutoff.
 * Deletes contiguous blocks bottom-up so row indexes remain stable.
 */
function deleteRowsOlderThan_(sheetName, dateColumn1Based, cutoff) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(2, dateColumn1Based, lastRow - 1, 1).getValues();
  var blocks = [];
  var start = null;
  var removed = 0;

  for (var i = 0; i < values.length; i++) {
    var raw = values[i][0];
    var d = raw instanceof Date ? new Date(raw.getTime()) : new Date(raw);
    var old = d instanceof Date && !isNaN(d.getTime()) && d < cutoff;
    var rowNumber = i + 2;

    if (old && start === null) start = rowNumber;
    if ((!old || i === values.length - 1) && start !== null) {
      var end = old && i === values.length - 1 ? rowNumber : rowNumber - 1;
      blocks.push({ start: start, count: end - start + 1 });
      removed += end - start + 1;
      start = null;
    }
  }

  for (var b = blocks.length - 1; b >= 0; b--) {
    sheet.deleteRows(blocks[b].start, blocks[b].count);
  }
  return removed;
}
