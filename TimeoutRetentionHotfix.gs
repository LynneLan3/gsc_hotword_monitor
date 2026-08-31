/**
 * GSC timeout + retention hotfix.
 *
 * Purpose:
 * - Keep the existing 6-hour runFreshQueryMonitor as the owner of Fresh Query / Query×Page / Page detail sync.
 * - Make the daily collector lightweight so one high-volume site cannot consume the whole Apps Script execution.
 * - Keep ScriptLock + cursor continuation.
 * - Prune high-churn GSC log/index history to a rolling 14-day window.
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
var HOTFIX_RETENTION_DAYS = 14;

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
  writeLog_('INFO', '', 'Timeout/retention hotfix installed: daily=runDailyLean, retention=' + HOTFIX_RETENTION_DAYS + 'd');
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
        '', '', '', '🔴 需要检查', errMsg
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
    runGscRetentionCleanup();
  } catch (e) {
    writeLog_('WARN', '', 'RETENTION_CLEANUP_FAILED | ' + String(e && e.message ? e.message : e));
  }

  sortSheetsNewestFirst_([SHEET_NAMES.LOG]);
  writeLog_('INFO', '', 'runDailyLean 完成 sites=' + sites.length);
  return 'done ' + sites.length;
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
    errors.join(' | ')
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

/** Rolling retention for high-churn raw history only. */
function runGscRetentionCleanup() {
  var cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - HOTFIX_RETENTION_DAYS);

  var removedLog = deleteRowsOlderThan_(SHEET_NAMES.LOG, 1, cutoff);
  var removedIndex = deleteRowsOlderThan_(SHEET_NAMES.URL_INDEX, 1, cutoff);
  writeLog_(
    'INFO',
    '',
    'Retention cleanup ' + HOTFIX_RETENTION_DAYS + 'd | log=' + removedLog + ' | urlIndex=' + removedIndex
  );
  return { log: removedLog, urlIndex: removedIndex };
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
