/**
 * GSC site identity adapter.
 *
 * site_id is a cross-system reference owned by Control Center. This file
 * provides additive identity helpers without changing existing operational
 * keys, Sheet history, or Decision/Intervention/Outcome contracts.
 */

/**
 * @param {Object} site Site config or a compatible identity object.
 * @return {string} site_id key when present; otherwise legacy Site Name key.
 */
function getSiteIdentityKey_(site) {
  var siteId = String((site && (site.siteId || site.site_id)) || '').trim();
  if (siteId) return 'site_id:' + siteId;
  return 'site_name:' + String((site && site.name) || '').trim();
}

/**
 * Match by site_id whenever both sides provide it. Legacy name matching is
 * retained only for records that do not yet carry the additive reference.
 */
function siteIdentityMatches_(left, right) {
  var leftId = String((left && (left.siteId || left.site_id)) || '').trim();
  var rightId = String((right && (right.siteId || right.site_id)) || '').trim();
  if (leftId && rightId) return leftId === rightId;
  return (
    String((left && left.name) || '').trim() ===
    String((right && right.name) || '').trim()
  );
}

/**
 * Add only the new header cells to existing sheets. Existing data rows are
 * neither rewritten nor backfilled.
 */
function ensureAdditiveSiteIdentityHeaders_() {
  ensureAdditiveHeader_(SHEET_NAMES.SITES, 'site_id', 6);
  ensureAdditiveHeader_(SHEET_NAMES.SNAPSHOT, 'site_id', 20);
}

function ensureAdditiveHeader_(sheetName, header, column) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) return;
  var width = Math.max(column, sheet.getLastColumn() || column);
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  if (headers.indexOf(header) >= 0) return;
  ensureSheetGrid_(sheet, 1, column);
  sheet.getRange(1, column).setValue(header);
}

/**
 * Identity-aware snapshot reader for future consumers. The existing
 * loadLatestSnapshotBySite_() remains untouched because Decision Engine
 * compatibility is explicitly out of scope for this phase.
 *
 * @return {Object<string, Array>} latest snapshot rows keyed by identityKey
 */
function loadLatestSnapshotByIdentity_() {
  var map = {};
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.SNAPSHOT);
  if (!sheet || sheet.getLastRow() < 2) return map;

  var columns = getSnapshotIdentityColumns_(sheet);
  var range = getSheetDataRange_(sheet, columns.readWidth);
  if (!range) return map;

  var values = range.getValues();
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var name = String(row[columns.siteName] || '').trim();
    if (!name) continue;
    var siteId = String(row[columns.siteId] || '').trim();
    var key = getSiteIdentityKey_({ name: name, siteId: siteId });
    var runDate = normalizeKeyDate_(row[0]);
    var prev = map[key];
    if (!prev || runDate > prev.runDate) {
      map[key] = { runDate: runDate, row: row };
    }
  }

  var out = {};
  var keys = Object.keys(map);
  for (var k = 0; k < keys.length; k++) out[keys[k]] = map[keys[k]].row;
  return out;
}

function getSnapshotIdentityColumns_(sheet) {
  var width = Math.max(
    SNAPSHOT_HEADERS.length,
    sheet.getLastColumn() || SNAPSHOT_HEADERS.length
  );
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  var siteName = headers.indexOf('Site');
  var siteId = headers.indexOf('site_id');
  return {
    siteName: siteName >= 0 ? siteName : 2,
    siteId: siteId >= 0 ? siteId : 19,
    readWidth: width
  };
}
