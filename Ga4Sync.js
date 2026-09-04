/**
 * G027 P3 — GA4 Central Sync
 *
 * Writes GA4_DAILY / GA4_COUNTRY / GA4_SITE_ROLLUP keyed by site_id.
 * Uses numeric GA4 Property ID only (never Measurement ID as Property ID).
 * Tier-1 countries: GA4_TIER1_COUNTRIES_V1 ← contracts/site-data-v1/tier1-countries.v1.json
 */

function getGa4Tier1Countries_() {
  return GA4_TIER1_COUNTRIES_V1.slice();
}

function getGa4Tier1CountrySet_() {
  var set = {};
  var list = getGa4Tier1Countries_();
  for (var i = 0; i < list.length; i++) set[list[i]] = true;
  return set;
}

/** Latest complete GA4 calendar day (script TZ), excluding incomplete trailing days. */
function ga4LatestCompleteDateStr_() {
  return addDaysToDateStr_(todayStr_(), -GA4_DATA_LAG_DAYS);
}

function isGa4Sentinel_(value) {
  var text = String(value == null ? '' : value).trim().toUpperCase();
  return (
    text === GA4_SENTINELS.UNKNOWN ||
    text === GA4_SENTINELS.MISSING ||
    text === GA4_SENTINELS.DISABLED ||
    text === 'NULL' ||
    text === 'NONE' ||
    text === 'N/A' ||
    text === '-'
  );
}

/**
 * Numeric GA4 Property ID only. Measurement IDs (G-…) are rejected.
 * @return {string} usable property id or ''
 */
function normalizeGa4PropertyId_(value) {
  if (value == null) return '';
  var text = String(value).trim();
  if (!text || isGa4Sentinel_(text)) return '';
  if (/^G-/i.test(text)) return '';
  if (/^\d+$/.test(text)) return text;
  return '';
}

function ensureGa4Sheets_() {
  ensureSheet_(SHEET_NAMES.GA4_DAILY, GA4_DAILY_HEADERS);
  ensureSheet_(SHEET_NAMES.GA4_COUNTRY, GA4_COUNTRY_HEADERS);
  ensureSheet_(SHEET_NAMES.GA4_SITE_ROLLUP, GA4_SITE_ROLLUP_HEADERS);
  var sites = getSpreadsheet_().getSheetByName(SHEET_NAMES.SITES);
  if (sites) ensureSheetHeaders_(sites, SITE_HEADERS);
}

/**
 * Menu / clasp entrypoint. Uses enabled sites from 站点配置.
 */
function runGa4CentralSync() {
  assertRuntimePrerequisites_();
  var sites = getEnabledSites();
  return runGa4CentralSync_(sites, {});
}

/**
 * Sync one site by site_id (Execution API friendly; avoids long batch timeouts).
 * @param {string} siteId
 * @return {{ok:number, skipped:number, failed:number, as_of:string, details:Array}}
 */
function runGa4CentralSyncForSiteId(siteId) {
  assertRuntimePrerequisites_();
  var want = String(siteId || '').trim();
  if (!want) throw new Error('siteId required');
  var sites = getEnabledSites().filter(function (s) {
    return String(s.siteId || '').trim() === want;
  });
  if (!sites.length) throw new Error('site_id not found in enabled sites: ' + want);
  return runGa4CentralSync_(sites, {});
}

/**
 * @param {Array<Object>} sites from getEnabledSites()
 * @param {Object=} options { fetchReport, nowDateStr, lagDays, lookbackDays }
 * @return {{ok:number, skipped:number, failed:number, as_of:string, details:Array}}
 */
function runGa4CentralSync_(sites, options) {
  options = options || {};
  ensureGa4Sheets_();
  var asOf = options.asOf || ga4LatestCompleteDateStr_();
  var lookback = options.lookbackDays != null ? options.lookbackDays : GA4_SYNC_LOOKBACK_DAYS;
  var startDate = addDaysToDateStr_(asOf, -(lookback - 1));
  var fetchReport = options.fetchReport || ga4RunReport_;
  var syncedAt = options.syncedAt || new Date().toISOString();
  var tier1Set = getGa4Tier1CountrySet_();

  var summary = { ok: 0, skipped: 0, failed: 0, as_of: asOf, details: [] };
  writeLog_(
    'INFO',
    '',
    'GA4_CENTRAL_SYNC_START as_of=' +
      asOf +
      ' start=' +
      startDate +
      ' lagDays=' +
      GA4_DATA_LAG_DAYS +
      ' sites=' +
      (sites ? sites.length : 0) +
      ' tier1_ref=' +
      GA4_TIER1_DEFINITION_REF
  );

  for (var i = 0; i < (sites || []).length; i++) {
    var site = sites[i];
    var result;
    try {
      result = syncGa4ForSite_(site, {
        asOf: asOf,
        startDate: startDate,
        fetchReport: fetchReport,
        syncedAt: syncedAt,
        tier1Set: tier1Set
      });
    } catch (e) {
      result = {
        status: 'FAILED',
        site_id: site && site.siteId,
        error: String(e.message || e)
      };
      writeLog_('ERROR', (site && site.name) || '', 'GA4_SYNC_SITE_FAILED | ' + result.error);
      preserveGa4RollupOnFailure_(site, asOf, syncedAt, result.error);
    }

    summary.details.push(result);
    if (result.status === 'OK') summary.ok += 1;
    else if (result.status === 'SKIPPED') summary.skipped += 1;
    else summary.failed += 1;
  }

  var msg =
    'GA4_CENTRAL_SYNC_DONE as_of=' +
    asOf +
    ' ok=' +
    summary.ok +
    ' skipped=' +
    summary.skipped +
    ' failed=' +
    summary.failed;
  writeLog_('INFO', '', msg);
  Logger.log(msg);
  return summary;
}

/**
 * Per-site sync. Never throws for skip conditions; API errors throw to caller
 * which isolates failure without zeroing historical facts.
 */
function syncGa4ForSite_(site, ctx) {
  var siteId = String((site && site.siteId) || '').trim();
  var productionUrl = String((site && site.propertyUrl) || '').trim();
  var propertyId = normalizeGa4PropertyId_(site && site.ga4PropertyId);

  if (!siteId) {
    writeLog_('WARN', (site && site.name) || '', 'GA4_SYNC_SKIPPED | missing site_id');
    return { status: 'SKIPPED', site_id: '', reason: 'MISSING_SITE_ID' };
  }
  if (!propertyId) {
    writeLog_(
      'INFO',
      site.name || siteId,
      'GA4_SYNC_SKIPPED | ga4_property_id UNKNOWN/MISSING/DISABLED or non-numeric'
    );
    upsertGa4SiteRollupRow_([
      siteId,
      ctx.asOf,
      productionUrl,
      '',
      '',
      '',
      '',
      'SKIPPED',
      'GA4_PROPERTY_ID_UNUSABLE',
      ctx.syncedAt
    ]);
    return { status: 'SKIPPED', site_id: siteId, reason: 'GA4_PROPERTY_ID_UNUSABLE' };
  }

  var dailyRows = fetchGa4DailySessions_(propertyId, ctx.startDate, ctx.asOf, ctx.fetchReport);
  var countryRows = fetchGa4CountrySessions_(propertyId, ctx.startDate, ctx.asOf, ctx.fetchReport);

  writeGa4DailyFacts_(siteId, dailyRows, ctx.syncedAt);
  writeGa4CountryFacts_(siteId, countryRows, ctx.syncedAt);

  var rollup = computeGa4SiteRollupFromFacts_(dailyRows, countryRows, ctx.asOf, ctx.tier1Set);
  upsertGa4SiteRollupRow_([
    siteId,
    ctx.asOf,
    productionUrl,
    rollup.ga4_sessions_7d,
    rollup.ga4_sessions_30d,
    rollup.tier1_sessions_30d,
    rollup.tier1_share_30d,
    'OK',
    '',
    ctx.syncedAt
  ]);

  return {
    status: 'OK',
    site_id: siteId,
    property_id: propertyId,
    ga4_sessions_7d: rollup.ga4_sessions_7d,
    ga4_sessions_30d: rollup.ga4_sessions_30d,
    tier1_sessions_30d: rollup.tier1_sessions_30d,
    tier1_share_30d: rollup.tier1_share_30d
  };
}

function preserveGa4RollupOnFailure_(site, asOf, syncedAt, errorMsg) {
  var siteId = String((site && site.siteId) || '').trim();
  if (!siteId) return;
  var existing = findGa4SiteRollupRow_(siteId);
  var productionUrl = String((site && site.propertyUrl) || '').trim();
  if (existing) {
    upsertGa4SiteRollupRow_([
      siteId,
      existing[1] || asOf,
      existing[2] || productionUrl,
      existing[3],
      existing[4],
      existing[5],
      existing[6],
      'FAILED',
      String(errorMsg || '').substring(0, 500),
      syncedAt
    ]);
    return;
  }
  upsertGa4SiteRollupRow_([
    siteId,
    asOf,
    productionUrl,
    '',
    '',
    '',
    '',
    'FAILED',
    String(errorMsg || '').substring(0, 500),
    syncedAt
  ]);
}

function ga4RunReport_(propertyId, body) {
  // UrlFetch uses the effective-user OAuth token (Execution API / UI).
  // Analytics Data API must be enabled on that OAuth client's GCP project.
  try {
    var url =
      'https://analyticsdata.googleapis.com/v1beta/properties/' +
      encodeURIComponent(propertyId) +
      ':runReport';
    return gscFetch(url, {
      method: 'post',
      payload: body,
      contentType: 'application/json',
      contextHint: 'GA4 propertyId=' + propertyId
    });
  } catch (err) {
    // Fallback: Advanced Service (Apps Script managed project). Arg order is
    // (request, parent) — not REST-style (parent, body).
    if (
      typeof AnalyticsData !== 'undefined' &&
      AnalyticsData.Properties &&
      typeof AnalyticsData.Properties.runReport === 'function'
    ) {
      return AnalyticsData.Properties.runReport(
        body,
        'properties/' + propertyId
      );
    }
    throw err;
  }
}

function fetchGa4DailySessions_(propertyId, startDate, endDate, fetchReport) {
  var result = fetchReport(propertyId, {
    dateRanges: [{ startDate: startDate, endDate: endDate }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
    keepEmptyRows: false,
    limit: 100000
  });
  return parseGa4DatedMetricRows_(result, 'sessions');
}

function fetchGa4CountrySessions_(propertyId, startDate, endDate, fetchReport) {
  var result = fetchReport(propertyId, {
    dateRanges: [{ startDate: startDate, endDate: endDate }],
    dimensions: [{ name: 'date' }, { name: 'countryId' }],
    metrics: [{ name: 'sessions' }],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
    keepEmptyRows: false,
    limit: 250000
  });
  return parseGa4CountryMetricRows_(result, 'sessions');
}

/** @return {Array<{date:string, sessions:number}>} */
function parseGa4DatedMetricRows_(result, metricName) {
  var rows = (result && result.rows) || [];
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var dims = rows[i].dimensionValues || [];
    var metrics = rows[i].metricValues || [];
    var rawDate = dims[0] && dims[0].value;
    var date = normalizeGa4ApiDate_(rawDate);
    var sessions = Number(metrics[0] && metrics[0].value);
    if (!date || !isFinite(sessions)) continue;
    out.push({ date: date, sessions: sessions });
  }
  return out;
}

/** @return {Array<{date:string, country:string, sessions:number}>} */
function parseGa4CountryMetricRows_(result, metricName) {
  var rows = (result && result.rows) || [];
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var dims = rows[i].dimensionValues || [];
    var metrics = rows[i].metricValues || [];
    var date = normalizeGa4ApiDate_(dims[0] && dims[0].value);
    var country = String((dims[1] && dims[1].value) || '')
      .trim()
      .toUpperCase();
    var sessions = Number(metrics[0] && metrics[0].value);
    if (!date || !country || country === '(OTHER)' || !isFinite(sessions)) continue;
    // GA4 countryId is ISO-3166-1 alpha-2 (UK traffic appears as GB).
    out.push({ date: date, country: country, sessions: sessions });
  }
  return out;
}

/** GA4 date dimension may be YYYYMMDD. */
function normalizeGa4ApiDate_(raw) {
  var text = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{8}$/.test(text)) {
    return text.slice(0, 4) + '-' + text.slice(4, 6) + '-' + text.slice(6, 8);
  }
  return toDateStr_(text) || '';
}

function writeGa4DailyFacts_(siteId, rows, syncedAt) {
  for (var i = 0; i < rows.length; i++) {
    upsertGa4DailyRow_([siteId, rows[i].date, rows[i].sessions, syncedAt]);
  }
}

function writeGa4CountryFacts_(siteId, rows, syncedAt) {
  for (var i = 0; i < rows.length; i++) {
    upsertGa4CountryRow_([siteId, rows[i].date, rows[i].country, rows[i].sessions, syncedAt]);
  }
}

function upsertGa4DailyRow_(row) {
  return upsertRow_(SHEET_NAMES.GA4_DAILY, GA4_DAILY_HEADERS, row, function (r) {
    return String(r[0] || '') + '||' + normalizeKeyDate_(r[1]);
  });
}

function upsertGa4CountryRow_(row) {
  return upsertRow_(SHEET_NAMES.GA4_COUNTRY, GA4_COUNTRY_HEADERS, row, function (r) {
    return (
      String(r[0] || '') +
      '||' +
      normalizeKeyDate_(r[1]) +
      '||' +
      String(r[2] || '').toUpperCase()
    );
  });
}

function upsertGa4SiteRollupRow_(row) {
  return upsertRow_(SHEET_NAMES.GA4_SITE_ROLLUP, GA4_SITE_ROLLUP_HEADERS, row, function (r) {
    return String(r[0] || '');
  });
}

function findGa4SiteRollupRow_(siteId) {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.GA4_SITE_ROLLUP);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, GA4_SITE_ROLLUP_HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '') === siteId) return values[i];
  }
  return null;
}

/**
 * Pure rollup from in-memory facts for asOf (inclusive windows).
 * 7D = [asOf-6, asOf]; 30D = [asOf-29, asOf].
 */
function computeGa4SiteRollupFromFacts_(dailyRows, countryRows, asOf, tier1Set) {
  var start7 = addDaysToDateStr_(asOf, -(GA4_ROLLUP_WINDOW_7D - 1));
  var start30 = addDaysToDateStr_(asOf, -(GA4_ROLLUP_WINDOW_30D - 1));
  var sessions7 = sumGa4SessionsInWindow_(dailyRows, start7, asOf);
  var sessions30 = sumGa4SessionsInWindow_(dailyRows, start30, asOf);
  var tier1 = sumGa4Tier1SessionsInWindow_(countryRows, start30, asOf, tier1Set);
  return {
    ga4_sessions_7d: sessions7,
    ga4_sessions_30d: sessions30,
    tier1_sessions_30d: tier1,
    tier1_share_30d: computeTier1Share_(tier1, sessions30)
  };
}

function sumGa4SessionsInWindow_(dailyRows, startDate, endDate) {
  var total = 0;
  for (var i = 0; i < (dailyRows || []).length; i++) {
    var d = dailyRows[i].date;
    if (d >= startDate && d <= endDate) total += Number(dailyRows[i].sessions) || 0;
  }
  return total;
}

function sumGa4Tier1SessionsInWindow_(countryRows, startDate, endDate, tier1Set) {
  var total = 0;
  for (var i = 0; i < (countryRows || []).length; i++) {
    var row = countryRows[i];
    if (row.date < startDate || row.date > endDate) continue;
    if (tier1Set && tier1Set[row.country]) total += Number(row.sessions) || 0;
  }
  return total;
}

function computeTier1Share_(tier1Sessions, sessions30) {
  var total = Number(sessions30);
  if (!total || !isFinite(total) || total <= 0) return null;
  var tier1 = Number(tier1Sessions) || 0;
  return Math.round((tier1 / total) * 10000) / 10000;
}

/** Journey-ready read helper (no GSC clicks fallback). */
function getGa4JourneyReadyRows_() {
  ensureGa4Sheets_();
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.GA4_SITE_ROLLUP);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, GA4_SITE_ROLLUP_HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    out.push({
      site_id: String(values[i][0] || ''),
      production_url: String(values[i][2] || ''),
      ga4_sessions_30d: values[i][4] === '' || values[i][4] == null ? null : Number(values[i][4]),
      tier1_sessions_30d: values[i][5] === '' || values[i][5] == null ? null : Number(values[i][5]),
      tier1_share_30d: values[i][6] === '' || values[i][6] == null ? null : Number(values[i][6]),
      status: String(values[i][7] || ''),
      as_of: normalizeKeyDate_(values[i][1])
    });
  }
  return out;
}
