/**
 * GSC Opportunity identity helpers.
 * Opportunity identity is derived from the canonical RadarID only.
 * No date, random value, Sheet row number, or rerun counter is involved.
 */

function slugifyOpportunityIdentity_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Contract shape: opp-{game_id}-{opportunity-slug}-{sequence}.
 * RadarID already contains the stable site/game slug before the first pipe.
 * The fixed 001 sequence is intentional: one canonical RadarID is one
 * Opportunity identity, rather than a new identity per run or cycle.
 */
function buildOpportunityIdFromRadarId_(radarId) {
  var canonical = String(radarId || '').trim();
  if (!canonical) return '';

  var parts = canonical.split('|');
  var gameId = slugifyOpportunityIdentity_(parts.shift());
  var topic = slugifyOpportunityIdentity_(parts.join('-'));
  if (!gameId || !topic) return '';

  return 'opp-' + gameId + '-' + topic + '-001';
}

function isStableOpportunityId_(opportunityId) {
  return /^opp-[a-z0-9]+(?:-[a-z0-9]+)+-\d{3}$/.test(
    String(opportunityId || '').trim()
  );
}
