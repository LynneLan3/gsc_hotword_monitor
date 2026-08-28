/**
 * GSC 站点配置 site_id 历史回填 V1。
 *
 * Control Center registry is the only authority. Apps Script cannot read the
 * sibling checkout, so callers must pass an explicit MIGRATION INPUT SNAPSHOT
 * as authorityRecords. Apply is separate and accepts only a planner result.
 */

/**
 * Build a deterministic, write-free site_id backfill plan.
 *
 * Rows and authorityRecords are plain objects so this helper is usable in
 * local tests without SpreadsheetApp. Name is display-only and is never a
 * matching key.
 *
 * Supported stable evidence on an authority record:
 * - propertyUrl / canonicalProductionUrl / productionUrl
 * - identityReferences (explicit references supplied by the migration input)
 *
 * @param {Array<Object>} rows GSC site config row snapshots.
 * @param {Array<Object>} authorityRecords MIGRATION INPUT SNAPSHOT from Control Center.
 * @return {{planned:Array, alreadyCorrect:Array, conflicts:Array, unresolved:Array}}
 */
function planSiteIdBackfill(rows, authorityRecords) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  if (!Array.isArray(authorityRecords)) {
    throw new Error('authorityRecords must be an array');
  }

  var authorities = authorityRecords.map(normalizeSiteIdAuthorityRecord_);
  var result = {
    planned: [],
    alreadyCorrect: [],
    conflicts: [],
    unresolved: []
  };

  for (var i = 0; i < rows.length; i++) {
    var row = normalizeSiteIdBackfillRow_(rows[i], i);
    var existingId = row.siteId;
    var evidenceMatches = findSiteIdAuthorityMatches_(row, authorities);

    if (existingId) {
      var authority = findAuthorityBySiteId_(existingId, authorities);
      if (!authority) {
        result.conflicts.push(siteIdBackfillItem_(row, {
          status: 'CONFLICT',
          reason: 'existing site_id is absent from Control Center authority',
          authority: null
        }));
        continue;
      }
      if (evidenceMatches.length && !containsAuthorityId_(evidenceMatches, existingId)) {
        result.conflicts.push(siteIdBackfillItem_(row, {
          status: 'CONFLICT',
          reason: 'existing site_id conflicts with stable row evidence',
          authority: evidenceMatches
        }));
        continue;
      }
      result.alreadyCorrect.push(siteIdBackfillItem_(row, {
        status: 'ALREADY_CORRECT',
        reason: 'existing site_id is present in Control Center authority',
        authority: authority,
        matchEvidence: evidenceMatches
      }));
      continue;
    }

    if (evidenceMatches.length === 1) {
      var proposed = evidenceMatches[0];
      result.planned.push(siteIdBackfillItem_(row, {
        status: 'PLANNED',
        proposedSiteId: proposed.siteId,
        reason: proposed.matchEvidence,
        authority: proposed
      }));
    } else if (evidenceMatches.length > 1) {
      result.unresolved.push(siteIdBackfillItem_(row, {
        status: 'UNRESOLVED',
        reason: 'stable evidence matches multiple Control Center site_ids',
        authority: evidenceMatches
      }));
    } else {
      result.unresolved.push(siteIdBackfillItem_(row, {
        status: 'UNRESOLVED',
        reason: 'no unique stable identity evidence; display name is insufficient',
        authority: []
      }));
    }
  }
  return result;
}

function normalizeSiteIdBackfillRow_(row, index) {
  row = row || {};
  return {
    rowNumber: Number(row.rowNumber || row.rowIndex || index + 2),
    name: String(row.name || row.siteName || '').trim(),
    propertyUrl: normalizeSiteIdPropertyUrl_(row.propertyUrl || row.propertyURL),
    siteId: String(row.siteId || row.site_id || '').trim(),
    identityReference: String(row.identityReference || '').trim()
  };
}

function normalizeSiteIdAuthorityRecord_(record) {
  record = record || {};
  var urls = [];
  [record.propertyUrl, record.canonicalProductionUrl, record.productionUrl].forEach(function (url) {
    var normalized = normalizeSiteIdPropertyUrl_(url);
    if (normalized && urls.indexOf(normalized) < 0) urls.push(normalized);
  });
  var references = Array.isArray(record.identityReferences)
    ? record.identityReferences.map(function (value) { return String(value || '').trim(); }).filter(Boolean)
    : [];
  return {
    siteId: String(record.siteId || record.site_id || '').trim(),
    name: String(record.name || '').trim(),
    propertyUrls: urls,
    identityReferences: references,
    authoritySource: String(record.authoritySource || 'Control Center registry').trim()
  };
}

/** Reuse the existing GSC URL normalizer; no local URL normalization rules. */
function normalizeSiteIdPropertyUrl_(url) {
  url = String(url || '').trim();
  if (!url) return '';
  return typeof normalizePropertyUrlForGsc_ === 'function'
    ? normalizePropertyUrlForGsc_(url)
    : url;
}

function findSiteIdAuthorityMatches_(row, authorities) {
  var matches = [];
  for (var i = 0; i < authorities.length; i++) {
    var authority = authorities[i];
    var evidence = '';
    if (row.propertyUrl && authority.propertyUrls.indexOf(row.propertyUrl) >= 0) {
      evidence = 'canonical production/property URL';
    } else if (
      row.identityReference &&
      authority.identityReferences.indexOf(row.identityReference) >= 0
    ) {
      evidence = 'explicit identity reference';
    }
    if (evidence && authority.siteId) {
      matches.push({
        siteId: authority.siteId,
        name: authority.name,
        matchEvidence: evidence,
        authoritySource: authority.authoritySource,
        propertyUrls: authority.propertyUrls.slice()
      });
    }
  }
  return dedupeAuthorityMatches_(matches);
}

function dedupeAuthorityMatches_(matches) {
  var byId = {};
  for (var i = 0; i < matches.length; i++) {
    var item = matches[i];
    if (!byId[item.siteId]) byId[item.siteId] = item;
  }
  return Object.keys(byId).sort().map(function (siteId) { return byId[siteId]; });
}

function findAuthorityBySiteId_(siteId, authorities) {
  for (var i = 0; i < authorities.length; i++) {
    if (authorities[i].siteId === siteId) return authorities[i];
  }
  return null;
}

function containsAuthorityId_(matches, siteId) {
  return matches.some(function (match) { return match.siteId === siteId; });
}

function siteIdBackfillItem_(row, details) {
  return {
    status: details.status,
    rowNumber: row.rowNumber,
    siteDisplayName: row.name,
    propertyUrl: row.propertyUrl,
    oldSiteId: row.siteId,
    proposedSiteId: details.proposedSiteId || '',
    matchEvidence: details.matchEvidence || details.reason,
    reason: details.reason,
    authoritySource: authoritySourceLabel_(details.authority),
    authority: details.authority
  };
}

function authoritySourceLabel_(authority) {
  if (Array.isArray(authority)) {
    return authority.map(function (item) { return item.authoritySource || ''; }).filter(Boolean).join(', ');
  }
  return authority && authority.authoritySource ? authority.authoritySource : '';
}

/**
 * Read-only Apps Script preview entry. The input must be a
 * MIGRATION INPUT SNAPSHOT; this function never creates or mutates a Sheet.
 */
function previewSiteIdBackfill(authorityRecords) {
  if (!Array.isArray(authorityRecords)) {
    throw new Error('Pass MIGRATION INPUT SNAPSHOT authorityRecords explicitly');
  }
  return planSiteIdBackfill(getEnabledSites(), authorityRecords);
}

/** Apply only PLANNED items; writes one re-read, site_id-only cell at a time. */
function applySiteIdBackfill(plan, sheet) {
  validateSiteIdBackfillPlan_(plan);
  if (!sheet || typeof sheet.getRange !== 'function') throw new Error('sheet is required');
  if (plan.conflicts.length) return siteIdBackfillApplyAbort_('CONFLICT items are present');
  if (plan.unresolved.length) return siteIdBackfillApplyAbort_('UNRESOLVED items are present');

  var siteIdColumn = findSiteIdColumn_(sheet);
  var written = [];
  var skipped = [];
  for (var i = 0; i < plan.planned.length; i++) {
    var item = plan.planned[i];
    var cell = sheet.getRange(item.rowNumber, siteIdColumn);
    var current = String(cell.getValue() || '').trim();
    if (current) {
      if (current === item.proposedSiteId) {
        skipped.push(siteIdBackfillApplyItem_(item, 'SKIP_ALREADY_CORRECT'));
        continue;
      }
      return {
        status: 'ABORTED', written: written, skipped: skipped,
        reason: 'ABORT_CONCURRENT_CONFLICT at row ' + item.rowNumber
      };
    }
    cell.setValue(item.proposedSiteId);
    written.push(siteIdBackfillApplyItem_(item, 'WRITTEN'));
  }
  return { status: 'SUCCESS', written: written, skipped: skipped, reason: '' };
}

/** Read-back verification; failure is explicit and does not rollback. */
function verifySiteIdBackfill(plan, sheet, baselineRows) {
  validateSiteIdBackfillPlan_(plan);
  if (!sheet || typeof sheet.getRange !== 'function') throw new Error('sheet is required');
  var siteIdColumn = findSiteIdColumn_(sheet);
  var expected = plan.planned.concat(plan.alreadyCorrect);
  var baselineByRow = {};
  (baselineRows || []).forEach(function (row) { baselineByRow[row.rowNumber] = row; });
  var seenIds = {};
  var failures = [];
  expected.forEach(function (item) {
    var actual = String(sheet.getRange(item.rowNumber, siteIdColumn).getValue() || '').trim();
    var wanted = item.proposedSiteId || item.oldSiteId;
    if (!actual || actual !== wanted) failures.push('row ' + item.rowNumber + ' site_id mismatch');
    if (actual && seenIds[actual]) failures.push('duplicate site_id: ' + actual);
    if (actual) seenIds[actual] = true;
    var baseline = baselineByRow[item.rowNumber];
    if (!baseline) return;
    ['propertyUrl', 'sitemapUrl', 'day0', 'enabled'].forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(baseline, field) &&
          sheetIdBackfillCellValue_(sheet, item.rowNumber, field) !== String(baseline[field] == null ? '' : baseline[field])) {
        failures.push('row ' + item.rowNumber + ' protected field changed: ' + field);
      }
    });
  });
  return failures.length ? { status: 'FAILURE', failures: failures } : { status: 'SUCCESS', failures: [] };
}

function validateSiteIdBackfillPlan_(plan) {
  if (!plan || !Array.isArray(plan.planned) || !Array.isArray(plan.alreadyCorrect) ||
      !Array.isArray(plan.conflicts) || !Array.isArray(plan.unresolved)) throw new Error('invalid site_id backfill plan');
}

function findSiteIdColumn_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var column = headers.indexOf('site_id') + 1;
  if (column < 1) throw new Error('site_id header missing');
  return column;
}

function siteIdBackfillApplyAbort_(reason) {
  return { status: 'ABORTED', written: [], skipped: [], reason: reason };
}

function siteIdBackfillApplyItem_(item, action) {
  return { action: action, rowNumber: item.rowNumber, siteId: item.proposedSiteId };
}

function sheetIdBackfillCellValue_(sheet, rowNumber, field) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var column = headers.indexOf({ propertyUrl: 'Property URL', sitemapUrl: 'Sitemap URL', day0: 'Day0', enabled: 'Enabled' }[field]);
  return column < 0 ? '' : String(sheet.getRange(rowNumber, column + 1).getValue() == null ? '' : sheet.getRange(rowNumber, column + 1).getValue());
}
