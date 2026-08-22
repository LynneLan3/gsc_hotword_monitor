/**
 * Phase 7C-3A local contract tests for the daily GAME_WIDE enqueue planner.
 * Run: node scripts/test-daily-game-wide-orchestrator.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function extractAssign(src, name) {
  var re = new RegExp('var ' + name + '\\s*=\\s*([\\s\\S]*?);\\s*\\n(?:var |/\\*|function )');
  var m = src.match(re);
  assert(m, 'cannot parse ' + name);
  return eval('(' + m[1] + ')');
}

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var researchSrc = fs.readFileSync(path.join(root, 'ResearchJobs.gs'), 'utf8');
var identitySrc = fs.readFileSync(path.join(root, 'SiteIdentity.gs'), 'utf8');
var utilsSrc = fs.readFileSync(path.join(root, 'Utils.gs'), 'utf8');
var RESEARCH_TYPE = extractAssign(configSrc, 'RESEARCH_TYPE');
var RESEARCH_JOB_STATUS = extractAssign(configSrc, 'RESEARCH_JOB_STATUS');
var RESEARCH_JOB_STATUS_LABELS = extractAssign(configSrc, 'RESEARCH_JOB_STATUS_LABELS');
var RESEARCH_JOB_HEADERS = extractAssign(configSrc, 'RESEARCH_JOB_HEADERS');
var DAILY_GAME_WIDE_TRIGGER = extractAssign(configSrc, 'DAILY_GAME_WIDE_TRIGGER');

var sandbox = {
  RESEARCH_TYPE: RESEARCH_TYPE,
  RESEARCH_JOB_STATUS: RESEARCH_JOB_STATUS,
  RESEARCH_JOB_STATUS_LABELS: RESEARCH_JOB_STATUS_LABELS,
  RESEARCH_JOB_HEADERS: RESEARCH_JOB_HEADERS,
  DAILY_GAME_WIDE_TRIGGER: DAILY_GAME_WIDE_TRIGGER,
  DAILY_GAME_WIDE_LOOKBACK_HOURS: 24,
  DAILY_GAME_WIDE_SOURCE_FAMILIES: ['COMMUNITY', 'VIDEO'],
  opportunityLabel_: function (map, key) { return (map && map[key]) || key || ''; },
  radarSiteSlug_: function (name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); },
  headerIndexMap_: function (headers) { var out = {}; headers.forEach(function (h, i) { out[h] = i; }); return out; },
  cell_: function (row, col, name) { return col[name] === undefined ? '' : row[col[name]]; },
  safeJsonParse_: function (value, fallback) { try { return JSON.parse(value); } catch (e) { return fallback; } },
  getSiteIdentityKey_: function (site) { return site && site.siteId ? 'site_id:' + site.siteId : 'site_name:' + String(site && site.name || ''); },
  Session: { getScriptTimeZone: function () { return 'UTC'; } },
  Utilities: {
    formatDate: function (date, tz, fmt) {
      var d = new Date(date);
      function pad(n) { return n < 10 ? '0' + n : '' + n; }
      if (fmt === 'yyyyMMdd') return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
      if (fmt === 'yyyy-MM-dd') return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
      if (fmt === 'Z') return 'Z';
      return d.toISOString().replace('.000Z', '');
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(identitySrc, sandbox);
vm.runInContext(utilsSrc, sandbox);
vm.runInContext(researchSrc, sandbox);

var ms2 = { name: 'Mortal Shell II', siteId: 'mortal-shell-ii', propertyUrl: 'https://mortal-shell-ii.vercel.app/', enabled: true };
var inactive = { name: 'Archived Site', siteId: 'archived-site', propertyUrl: 'https://archived.example/', enabled: true, status: 'ARCHIVED' };
var runDate = '2026-08-22';

assert(sandbox.isDailyGameWideSiteEligible_(ms2), 'eligible live site');
assert(!sandbox.isDailyGameWideSiteEligible_(inactive), 'inactive/archived site excluded');
assert(sandbox.dailyGameWideDedupeKey_(ms2, DAILY_GAME_WIDE_TRIGGER, runDate) === 'mortal-shell-ii||DAILY_GAME_WIDE||2026-08-22', 'site/date dedupe key');

var first = sandbox.planDailyGameWideDiscoveryJobs_([ms2, inactive], [], runDate, new Date('2026-08-22T01:00:00Z'));
assert(first.created === 1 && first.excluded === 1, 'eligible creates and inactive excludes');
assert(first.contracts[0].research_type === RESEARCH_TYPE.DEMAND_DISCOVERY, 'research type');
assert(first.contracts[0].trigger_type === DAILY_GAME_WIDE_TRIGGER, 'daily trigger');
assert(first.contracts[0].discovery_scope.scope === 'GAME_WIDE', 'game-wide scope');
assert(first.contracts[0].discovery_scope.lookback_hours === 24, '24h lookback');
assert(first.contracts[0].source_families_requested.join(',') === 'COMMUNITY,VIDEO', 'source families');
assert(first.contracts[0].seed_terms.join(',') === 'Mortal Shell II,Mortal Shell 2', 'existing seed alias rule');

var prior = [{ site: ms2, job_id: first.contracts[0].job_id, trigger_type: DAILY_GAME_WIDE_TRIGGER, discovery_cycle_date: runDate }];
var second = sandbox.planDailyGameWideDiscoveryJobs_([ms2], prior, runDate, new Date('2026-08-22T02:00:00Z'));
assert(second.created === 0 && second.skipped === 1 && second.dedupe_hits === 1, 'same site/date deduped');

var next = sandbox.planDailyGameWideDiscoveryJobs_([ms2], prior, '2026-08-23', new Date('2026-08-23T02:00:00Z'));
assert(next.created === 1, 'next date creates new job');
assert(next.contracts[0].job_id !== first.contracts[0].job_id, 'next date job id differs');

var row = sandbox.gameWideDiscoveryResearchJobSheetRow_(first.contracts[0], ms2.name, new Date('2026-08-22T01:00:00Z'));
assert(row.length === RESEARCH_JOB_HEADERS.length, 'row matches existing research job schema');
var api = sandbox.gameWideDiscoveryRowToApi_(row, sandbox.headerIndexMap_(RESEARCH_JOB_HEADERS));
assert(api.research_type === 'DEMAND_DISCOVERY', 'API research type');
assert(api.discovery_scope.scope === 'GAME_WIDE', 'API scope');
assert(api.lookback_hours === 24, 'API lookback');
assert(api.aliases[0] === 'Mortal Shell 2', 'API aliases');
assert(api.trigger_type === DAILY_GAME_WIDE_TRIGGER, 'API trigger');
assert(api.discovery_cycle_date === runDate, 'API cycle date');
assert(api.source_families_requested.join(',') === 'COMMUNITY,VIDEO', 'API source families');

assert(/runDailyFinalizerUnlocked_/.test(fs.readFileSync(path.join(root, 'Code.gs'), 'utf8')), 'daily finalizer remains entry');
assert(/createGameWideDiscoveryJobForSite_/.test(researchSrc), 'manual GAME_WIDE creator remains intact');
console.log('PASS scripts/test-daily-game-wide-orchestrator.js');
