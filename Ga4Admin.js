/**
 * G027 P4 — GA4 identity discovery via Analytics Admin (readonly).
 *
 * Manual entrypoints (run in Apps Script UI after clasp push):
 *   1) authorizeGa4Admin      — triggers Google OAuth consent once
 *   2) discoverGa4SiteBindings — list accounts/properties/web streams,
 *      exact-match production_url, backfill only unique MATCHED rows
 *
 * Matching rules (deterministic only):
 *   - Primary: Web Stream defaultUri vs Registry/Sheet production_url
 *     (scheme + hostname + trailing-slash normalized)
 *   - Secondary: existing Measurement ID as cross-check (conflict → CONFLICT)
 *   - Never fuzzy-match property display names or invent IDs
 */

/**
 * Minimal OAuth trigger: one real Analytics Admin readonly call.
 * Run this first in the Apps Script editor so Google can show consent.
 * @return {{ok:boolean, account_summaries:number, properties:number}}
 */
function authorizeGa4Admin() {
  var page = listGa4AccountSummariesPage_('');
  var summaries = (page && page.accountSummaries) || [];
  var propertyCount = 0;
  for (var i = 0; i < summaries.length; i++) {
    propertyCount += ((summaries[i].propertySummaries) || []).length;
  }
  var result = {
    ok: true,
    account_summaries: summaries.length,
    properties: propertyCount
  };
  Logger.log('GA4_ADMIN_AUTH_OK ' + JSON.stringify(result));
  writeLog_(
    'INFO',
    '',
    'GA4_ADMIN_AUTH_OK accounts=' +
      result.account_summaries +
      ' properties=' +
      result.properties
  );
  return result;
}

/**
 * Discover all accessible GA4 web streams, match Active sites by production URL,
 * and backfill Sheet identity columns for unique MATCHED rows only.
 * @return {Object} summary counts + per-site results
 */
function discoverGa4SiteBindings() {
  ensureGa4Sheets_();
  ensureSheet_(SHEET_NAMES.GA4_DISCOVERY, GA4_DISCOVERY_HEADERS);
  ensureSheetHeaders_(
    getSpreadsheet_().getSheetByName(SHEET_NAMES.SITES),
    SITE_HEADERS
  );

  var streams = listAllGa4WebStreams_();
  var sites = getEnabledSites();
  var discoveredAt = new Date().toISOString();
  var results = [];
  var counts = {
    matched: 0,
    no_match: 0,
    ambiguous: 0,
    conflict: 0,
    written_property_id: 0,
    streams_indexed: streams.length,
    sites: sites.length
  };

  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    var decision = matchGa4SiteBinding_(site, streams);
    results.push(decision);
    if (decision.match_status === 'MATCHED') counts.matched++;
    else if (decision.match_status === 'AMBIGUOUS') counts.ambiguous++;
    else if (decision.match_status === 'CONFLICT') counts.conflict++;
    else counts.no_match++;

    writeGa4DiscoveryRow_(decision, discoveredAt);

    if (decision.match_status === 'MATCHED' && decision.write) {
      var wrote = applyGa4SiteBinding_(site, decision);
      if (wrote.property_id_written) counts.written_property_id++;
    }
  }

  var summary = {
    ok: true,
    counts: counts,
    results: results
  };
  Logger.log('GA4_DISCOVERY_DONE ' + JSON.stringify(counts));
  writeLog_(
    'INFO',
    '',
    'GA4_DISCOVERY_DONE matched=' +
      counts.matched +
      ' no_match=' +
      counts.no_match +
      ' ambiguous=' +
      counts.ambiguous +
      ' conflict=' +
      counts.conflict +
      ' written_property_id=' +
      counts.written_property_id +
      ' streams=' +
      counts.streams_indexed
  );
  return summary;
}

/** @deprecated Prefer authorizeGa4Admin; kept for earlier P4 docs. */
function listGa4AccountSummaries() {
  return authorizeGa4Admin();
}

/** P4: ensure ga4_property_id column exists; write MISSING where blank (no invent). */
function markMissingGa4PropertyIds() {
  var ss = getSpreadsheet_();
  ensureGa4Sheets_();
  var sheet = ss.getSheetByName(SHEET_NAMES.SITES);
  var data = sheet.getDataRange().getValues();
  if (!data.length) return { updated: 0 };
  var headers = data[0].map(function (h) {
    return String(h || '').trim();
  });
  var col = headers.indexOf('ga4_property_id');
  if (col < 0) throw new Error('ga4_property_id column missing');
  var enabledCol = headers.indexOf('Enabled');
  var updated = 0;
  for (var i = 1; i < data.length; i++) {
    var enabled = String(enabledCol >= 0 ? data[i][enabledCol] : '')
      .trim()
      .toUpperCase();
    if (enabled === 'FALSE') continue;
    var cur = String(data[i][col] || '').trim();
    if (!cur) {
      sheet.getRange(i + 1, col + 1).setValue('MISSING');
      updated++;
    }
  }
  return { updated: updated, column: col + 1 };
}

// ---------------------------------------------------------------------------
// Admin API listing (Advanced Service preferred; UrlFetch fallback)
// ---------------------------------------------------------------------------

/**
 * @param {string=} pageToken
 * @return {Object} accountSummaries page
 */
function listGa4AccountSummariesPage_(pageToken) {
  if (typeof AnalyticsAdmin !== 'undefined' && AnalyticsAdmin.AccountSummaries) {
    var opts = { pageSize: 200 };
    if (pageToken) opts.pageToken = pageToken;
    return AnalyticsAdmin.AccountSummaries.list(opts) || {};
  }
  var url =
    'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200';
  if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
  return gscFetch(url, {
    method: 'get',
    contextHint: 'GA4 Admin accountSummaries'
  });
}

/**
 * @param {string} propertyResourceName e.g. properties/123456
 * @param {string=} pageToken
 * @return {Object} dataStreams page
 */
function listGa4DataStreamsPage_(propertyResourceName, pageToken) {
  var parent = String(propertyResourceName || '').trim();
  if (!parent) return {};
  if (
    typeof AnalyticsAdmin !== 'undefined' &&
    AnalyticsAdmin.Properties &&
    AnalyticsAdmin.Properties.DataStreams
  ) {
    var opts = { pageSize: 200 };
    if (pageToken) opts.pageToken = pageToken;
    return AnalyticsAdmin.Properties.DataStreams.list(parent, opts) || {};
  }
  var url =
    'https://analyticsadmin.googleapis.com/v1beta/' +
    parent +
    '/dataStreams?pageSize=200';
  if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
  return gscFetch(url, {
    method: 'get',
    contextHint: 'GA4 Admin dataStreams ' + parent
  });
}

/** @return {Array<Object>} all account/property summaries (paginated) */
function listAllGa4AccountSummaries_() {
  var out = [];
  var pageToken = '';
  do {
    var page = listGa4AccountSummariesPage_(pageToken);
    var summaries = (page && page.accountSummaries) || [];
    for (var i = 0; i < summaries.length; i++) out.push(summaries[i]);
    pageToken = (page && page.nextPageToken) || '';
  } while (pageToken);
  return out;
}

/**
 * Flatten every accessible WEB_DATA_STREAM across all properties.
 * Handles accountSummaries + dataStreams pagination.
 * @return {Array<{
 *   property_id:string,
 *   property_display_name:string,
 *   stream_id:string,
 *   measurement_id:string,
 *   default_uri:string,
 *   match_key:string
 * }>}
 */
function listAllGa4WebStreams_() {
  var accountSummaries = listAllGa4AccountSummaries_();
  var streams = [];
  for (var a = 0; a < accountSummaries.length; a++) {
    var props = accountSummaries[a].propertySummaries || [];
    for (var p = 0; p < props.length; p++) {
      var prop = props[p];
      var propertyName = String((prop && prop.property) || '').trim();
      if (!propertyName) continue;
      var propertyId = propertyName.replace(/^properties\//, '');
      var displayName = String((prop && prop.displayName) || '').trim();
      var pageToken = '';
      do {
        var page = listGa4DataStreamsPage_(propertyName, pageToken);
        var rows = (page && page.dataStreams) || [];
        for (var s = 0; s < rows.length; s++) {
          var mapped = mapGa4WebStream_(rows[s], propertyId, displayName);
          if (mapped) streams.push(mapped);
        }
        pageToken = (page && page.nextPageToken) || '';
      } while (pageToken);
    }
  }
  return streams;
}

/**
 * @param {Object} stream Admin API DataStream resource
 * @param {string} propertyId numeric property id
 * @param {string} propertyDisplayName
 * @return {Object|null}
 */
function mapGa4WebStream_(stream, propertyId, propertyDisplayName) {
  if (!stream) return null;
  var type = String(stream.type || '').toUpperCase();
  var web = stream.webStreamData || null;
  // Some payloads omit type but still carry webStreamData.
  if (type && type !== 'WEB_DATA_STREAM' && !web) return null;
  if (!web) return null;
  var streamName = String(stream.name || '');
  var streamId = '';
  var m = streamName.match(/dataStreams\/([^/]+)$/);
  if (m) streamId = m[1];
  var measurementId = String(web.measurementId || '').trim();
  var defaultUri = String(web.defaultUri || '').trim();
  return {
    property_id: String(propertyId || '').trim(),
    property_display_name: String(propertyDisplayName || '').trim(),
    stream_id: streamId,
    measurement_id: measurementId,
    default_uri: defaultUri,
    match_key: normalizeGa4MatchKey_(defaultUri)
  };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Normalize URL for exact production-host comparison:
 * scheme + lowercase hostname + single trailing slash (path/query ignored).
 * Sentinels / empty → ''.
 * @param {string} url
 * @return {string}
 */
function normalizeGa4MatchKey_(url) {
  var raw = String(url || '').trim();
  if (!raw) return '';
  var upper = raw.toUpperCase();
  if (
    upper === GA4_SENTINELS.UNKNOWN ||
    upper === GA4_SENTINELS.MISSING ||
    upper === GA4_SENTINELS.DISABLED ||
    upper === 'NULL' ||
    upper === 'NONE'
  ) {
    return '';
  }
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  var match = raw.match(/^(https?):\/\/([^\/?#]+)/i);
  if (!match) return '';
  var scheme = match[1].toLowerCase();
  var host = match[2].toLowerCase();
  // Strip default ports if present
  if (scheme === 'https' && /:443$/.test(host)) host = host.replace(/:443$/, '');
  if (scheme === 'http' && /:80$/.test(host)) host = host.replace(/:80$/, '');
  return scheme + '://' + host + '/';
}

/**
 * Resolve production_url baseline: Sheet column → Registry snapshot → Property URL.
 * @param {Object} site from getEnabledSites()
 * @return {{production_url:string, measurement_id:string, source:string}}
 */
function resolveGa4SiteIdentityBaseline_(site) {
  var siteId = String((site && site.siteId) || '').trim();
  var registry =
    (typeof GA4_REGISTRY_IDENTITY_V1 !== 'undefined' &&
      GA4_REGISTRY_IDENTITY_V1 &&
      GA4_REGISTRY_IDENTITY_V1[siteId]) ||
    null;

  var productionUrl = String((site && site.productionUrl) || '').trim();
  var source = 'sheet.production_url';
  if (!normalizeGa4MatchKey_(productionUrl) && registry) {
    productionUrl = String(registry.production_url || '').trim();
    source = 'registry.production_url';
  }
  if (!normalizeGa4MatchKey_(productionUrl)) {
    productionUrl = String((site && site.propertyUrl) || '').trim();
    source = 'sheet.property_url';
  }

  var measurementId = String((site && site.ga4MeasurementId) || '').trim();
  if (!isGa4MeasurementId_(measurementId) && registry) {
    measurementId = String(registry.ga4_measurement_id || '').trim();
  }
  if (!isGa4MeasurementId_(measurementId)) measurementId = '';

  return {
    production_url: productionUrl,
    measurement_id: measurementId,
    source: source
  };
}

function isGa4MeasurementId_(value) {
  return /^G-[A-Z0-9]+$/i.test(String(value || '').trim());
}

function isBlankGa4IdentityValue_(value) {
  var text = String(value || '').trim();
  if (!text) return true;
  var upper = text.toUpperCase();
  if (
    upper === GA4_SENTINELS.UNKNOWN ||
    upper === GA4_SENTINELS.MISSING ||
    upper === GA4_SENTINELS.DISABLED
  ) {
    return true;
  }
  if (text === '0') return true;
  return false;
}

/**
 * Deterministic match for one Active site against indexed web streams.
 * @param {Object} site
 * @param {Array<Object>} streams
 * @return {Object} decision
 */
function matchGa4SiteBinding_(site, streams) {
  var baseline = resolveGa4SiteIdentityBaseline_(site);
  var matchKey = normalizeGa4MatchKey_(baseline.production_url);
  var siteId = String((site && site.siteId) || '').trim();
  var siteName = String((site && site.name) || '').trim();
  var existingPropertyId = String((site && site.ga4PropertyId) || '').trim();
  var existingStreamId = String((site && site.ga4StreamId) || '').trim();
  var existingMeasurementId = baseline.measurement_id;

  var base = {
    site_id: siteId,
    site_name: siteName,
    production_url: baseline.production_url,
    production_url_source: baseline.source,
    match_key: matchKey,
    existing_property_id: existingPropertyId,
    existing_stream_id: existingStreamId,
    existing_measurement_id: existingMeasurementId,
    ga4_property_id: '',
    ga4_stream_id: '',
    ga4_measurement_id: '',
    property_display_name: '',
    default_uri: '',
    candidate_count: 0,
    notes: '',
    write: false
  };

  if (!matchKey) {
    return Object.assign({}, base, {
      match_status: 'NO_MATCH',
      notes: 'no usable production_url'
    });
  }

  var candidates = [];
  for (var i = 0; i < streams.length; i++) {
    if (streams[i].match_key && streams[i].match_key === matchKey) {
      candidates.push(streams[i]);
    }
  }

  // Deduplicate identical property+stream+measurement tuples
  candidates = uniqueGa4StreamCandidates_(candidates);
  base.candidate_count = candidates.length;

  if (candidates.length === 0) {
    return Object.assign({}, base, {
      match_status: 'NO_MATCH',
      notes: 'no web stream defaultUri exact host match'
    });
  }

  if (candidates.length > 1) {
    return Object.assign({}, base, {
      match_status: 'AMBIGUOUS',
      notes:
        'multiple web streams share production host: ' +
        candidates
          .map(function (c) {
            return (
              c.property_id +
              '/' +
              c.stream_id +
              '/' +
              c.measurement_id
            );
          })
          .join('; '),
      write: false
    });
  }

  var hit = candidates[0];
  base.ga4_property_id = hit.property_id;
  base.ga4_stream_id = hit.stream_id;
  base.ga4_measurement_id = hit.measurement_id;
  base.property_display_name = hit.property_display_name;
  base.default_uri = hit.default_uri;

  // Secondary cross-check: known Measurement ID must agree when present.
  if (
    existingMeasurementId &&
    hit.measurement_id &&
    existingMeasurementId.toUpperCase() !== hit.measurement_id.toUpperCase()
  ) {
    return Object.assign({}, base, {
      match_status: 'CONFLICT',
      notes:
        'existing measurement_id ' +
        existingMeasurementId +
        ' != Admin API ' +
        hit.measurement_id,
      write: false
    });
  }

  // Existing numeric property_id must agree when already set.
  if (
    !isBlankGa4IdentityValue_(existingPropertyId) &&
    /^\d+$/.test(existingPropertyId) &&
    existingPropertyId !== hit.property_id
  ) {
    return Object.assign({}, base, {
      match_status: 'CONFLICT',
      notes:
        'existing ga4_property_id ' +
        existingPropertyId +
        ' != Admin API ' +
        hit.property_id,
      write: false
    });
  }

  return Object.assign({}, base, {
    match_status: 'MATCHED',
    notes: existingMeasurementId
      ? 'defaultUri exact match + measurement_id confirmed'
      : 'defaultUri exact match',
    write: true
  });
}

function uniqueGa4StreamCandidates_(candidates) {
  var seen = {};
  var out = [];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var key =
      String(c.property_id || '') +
      '|' +
      String(c.stream_id || '') +
      '|' +
      String(c.measurement_id || '').toUpperCase();
    if (seen[key]) continue;
    seen[key] = true;
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sheet writes (MATCHED only; never overwrite conflicting MID)
// ---------------------------------------------------------------------------

/**
 * @param {Object} site
 * @param {Object} decision MATCHED decision
 * @return {{property_id_written:boolean, stream_id_written:boolean, measurement_id_written:boolean}}
 */
function applyGa4SiteBinding_(site, decision) {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.SITES);
  var header = ensureSheetHeaders_(sheet, SITE_HEADERS);
  var col = sheetHeaderIndexMap_(header);
  var rowIndex = site.rowIndex;
  var out = {
    property_id_written: false,
    stream_id_written: false,
    measurement_id_written: false
  };
  if (!rowIndex) return out;

  if (col.ga4_property_id !== undefined && decision.ga4_property_id) {
    var curProp = String(
      sheet.getRange(rowIndex, col.ga4_property_id + 1).getValue() || ''
    ).trim();
    if (isBlankGa4IdentityValue_(curProp) || curProp === decision.ga4_property_id) {
      if (curProp !== decision.ga4_property_id) {
        sheet.getRange(rowIndex, col.ga4_property_id + 1).setValue(decision.ga4_property_id);
      }
      out.property_id_written = true;
    }
  }

  if (col.ga4_stream_id !== undefined && decision.ga4_stream_id) {
    var curStream = String(
      sheet.getRange(rowIndex, col.ga4_stream_id + 1).getValue() || ''
    ).trim();
    if (isBlankGa4IdentityValue_(curStream) || curStream === decision.ga4_stream_id) {
      if (curStream !== decision.ga4_stream_id) {
        sheet.getRange(rowIndex, col.ga4_stream_id + 1).setValue(decision.ga4_stream_id);
      }
      out.stream_id_written = true;
    }
  }

  if (col.ga4_measurement_id !== undefined && decision.ga4_measurement_id) {
    var curMid = String(
      sheet.getRange(rowIndex, col.ga4_measurement_id + 1).getValue() || ''
    ).trim();
    if (isBlankGa4IdentityValue_(curMid)) {
      sheet
        .getRange(rowIndex, col.ga4_measurement_id + 1)
        .setValue(decision.ga4_measurement_id);
      out.measurement_id_written = true;
    } else if (
      isGa4MeasurementId_(curMid) &&
      curMid.toUpperCase() !== String(decision.ga4_measurement_id).toUpperCase()
    ) {
      writeLog_(
        'WARN',
        site.name || '',
        'GA4_MEASUREMENT_CONFLICT_SKIP_WRITE sheet=' +
          curMid +
          ' api=' +
          decision.ga4_measurement_id
      );
    } else if (
      isGa4MeasurementId_(curMid) &&
      curMid.toUpperCase() === String(decision.ga4_measurement_id).toUpperCase()
    ) {
      out.measurement_id_written = true;
    } else {
      sheet
        .getRange(rowIndex, col.ga4_measurement_id + 1)
        .setValue(decision.ga4_measurement_id);
      out.measurement_id_written = true;
    }
  }

  if (col.production_url !== undefined && decision.production_url) {
    var curProd = String(
      sheet.getRange(rowIndex, col.production_url + 1).getValue() || ''
    ).trim();
    if (
      isBlankGa4IdentityValue_(curProd) &&
      normalizeGa4MatchKey_(decision.production_url)
    ) {
      sheet.getRange(rowIndex, col.production_url + 1).setValue(decision.production_url);
    }
  }

  return out;
}

function writeGa4DiscoveryRow_(decision, discoveredAt) {
  upsertRow_(
    SHEET_NAMES.GA4_DISCOVERY,
    GA4_DISCOVERY_HEADERS,
    [
      decision.site_id || '',
      decision.site_name || '',
      decision.production_url || '',
      decision.match_status || '',
      decision.ga4_property_id || '',
      decision.ga4_stream_id || '',
      decision.ga4_measurement_id || '',
      decision.property_display_name || '',
      decision.default_uri || '',
      decision.candidate_count != null ? decision.candidate_count : '',
      decision.notes || '',
      discoveredAt || new Date().toISOString()
    ],
    function (r) {
      return String(r[0] || '');
    }
  );
}
