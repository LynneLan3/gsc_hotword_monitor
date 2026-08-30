/**
 * Production publish runtime sync.
 *
 * SITE_LAUNCH is a single-receipt boundary: after the existing Experiment
 * Ledger records the launch, the same receipt idempotently enrolls the site in
 * GSC monitoring and marks the Steam site project as LIVE.  siteId is consumed
 * from the receipt; it is never regenerated from the game name here.
 */
var PUBLISH_RUNTIME_STEAM_SPREADSHEET_ID = '1WVg2p_Vero3MB2JN4yxmtHkLQRgkWO2mz95X4ms9nLE';
var PUBLISH_RUNTIME_GSC_CONFIG_SHEET = '站点配置';
var PUBLISH_RUNTIME_SITE_POOL_SHEET = '站点项目池';
var PUBLISH_RUNTIME_GSC_BINDING_SHEET = '项目GSC关联';

/** Public Execution API used by scripts/record-publish-receipt.mjs. */
function recordPublishedBatchWithRuntimeSync(payload) {
  var receipt = parsePublishRuntimeReceipt_(payload);
  var launch = publishRuntimeLaunchEntry_(receipt);
  if (!launch) return recordPublishedBatch(payload);

  validatePublishRuntimeLaunch_(receipt, launch);
  if (typeof LEDGER_ACTIONS === 'object' && LEDGER_ACTIONS) LEDGER_ACTIONS.SITE_LAUNCH = true;

  var ledgerResult = recordPublishedBatch(receipt);
  if (receipt.dryRun === true) {
    ledgerResult.runtimeSync = {ok: true, dryRun: true, siteId: String(receipt.common.siteId || '').trim()};
    return ledgerResult;
  }

  var syncResult = syncPublishedSiteRuntime_(receipt, launch);
  ledgerResult.runtimeSync = syncResult;
  return ledgerResult;
}

function parsePublishRuntimeReceipt_(payload) {
  var receipt = payload;
  if (typeof receipt === 'string') {
    try {
      receipt = JSON.parse(receipt);
    } catch (e) {
      throw new Error('recordPublishedBatchWithRuntimeSync: payload is not valid JSON');
    }
  }
  if (!receipt || typeof receipt !== 'object') {
    throw new Error('recordPublishedBatchWithRuntimeSync: receipt object is required');
  }
  receipt.common = receipt.common || {};
  receipt.interventions = Array.isArray(receipt.interventions) ? receipt.interventions : [];
  return receipt;
}

function publishRuntimeLaunchEntry_(receipt) {
  for (var i = 0; i < receipt.interventions.length; i++) {
    var entry = receipt.interventions[i] || {};
    if (String(entry.action || '').trim().toUpperCase() === 'SITE_LAUNCH') return entry;
  }
  return null;
}

function validatePublishRuntimeLaunch_(receipt, launch) {
  var common = receipt.common || {};
  var required = ['siteId', 'game', 'steamAppId', 'decisionId', 'opportunityId', 'productionUrl', 'deployedAt'];
  var missing = [];
  for (var i = 0; i < required.length; i++) {
    if (!String(common[required[i]] || '').trim()) missing.push('common.' + required[i]);
  }
  if (missing.length) {
    throw new Error('SITE_LAUNCH runtime sync missing required fields: ' + missing.join(', '));
  }
  if (!String(common.repositoryUrl || '').trim()) {
    throw new Error('SITE_LAUNCH runtime sync missing required field: common.repositoryUrl');
  }
  if (!String(common.sitemapUrl || '').trim()) {
    throw new Error('SITE_LAUNCH runtime sync missing required field: common.sitemapUrl');
  }
  if (!String(launch.primaryUrl || '').trim()) {
    throw new Error('SITE_LAUNCH runtime sync requires launch primaryUrl');
  }
}

function syncPublishedSiteRuntime_(receipt, launch) {
  var common = receipt.common || {};
  var facts = {
    siteId: String(common.siteId || '').trim(),
    game: String(common.game || common.site || '').trim(),
    steamAppId: String(common.steamAppId || '').trim(),
    decisionId: String(common.decisionId || '').trim(),
    opportunityId: String(common.opportunityId || '').trim(),
    repositoryUrl: String(common.repositoryUrl || '').trim(),
    productionUrl: normalizePublishRuntimeUrl_(common.productionUrl),
    sitemapUrl: normalizePublishRuntimeUrl_(common.sitemapUrl),
    deployedAt: String(common.deployedAt || '').trim(),
    deployedDate: publishRuntimeDate_(common.deployedAt),
    templateVersion: String(common.templateVersion || '').trim(),
    launchPageCount: publishRuntimeLaunchPageCount_(common, launch)
  };

  upsertPublishRuntimeGscConfig_(facts);
  upsertPublishRuntimeSteam_(facts);
  if (typeof writeLog_ === 'function') {
    writeLog_('INFO', facts.game, 'SITE_LAUNCH runtime sync complete siteId=' + facts.siteId + ' appId=' + facts.steamAppId);
  }
  return {
    ok: true,
    siteId: facts.siteId,
    steamAppId: facts.steamAppId,
    productionUrl: facts.productionUrl,
    gscConfig: 'UPSERTED',
    steamSitePool: 'UPSERTED',
    steamGscBinding: 'UPSERTED'
  };
}

function normalizePublishRuntimeUrl_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '') + '/';
}

function publishRuntimeDate_(value) {
  var raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.substring(0, 10);
  var date = new Date(raw);
  if (isNaN(date.getTime())) throw new Error('SITE_LAUNCH deployedAt is not a valid date');
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function publishRuntimeLaunchPageCount_(common, launch) {
  var explicit = Number(common.launchPageCount);
  if (isFinite(explicit) && explicit >= 0) return explicit;
  var values = Array.isArray(launch.affectedUrls) ? launch.affectedUrls : [];
  var seen = {};
  var count = 0;
  for (var i = 0; i < values.length; i++) {
    var raw = String(values[i] || '').trim();
    if (!raw) continue;
    try {
      var url = new URL(raw, String(common.productionUrl || ''));
      var path = url.pathname || '/';
      if (path === '/' || path === '/guides/' || path === '/routes/' || path === '/robots.txt' || path.indexOf('/sitemap') === 0) continue;
      if (!seen[path]) { seen[path] = true; count += 1; }
    } catch (e) {}
  }
  return count;
}

function upsertPublishRuntimeGscConfig_(facts) {
  var ss = typeof getSpreadsheet_ === 'function' ? getSpreadsheet_() : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('SITE_LAUNCH runtime sync cannot resolve GSC spreadsheet');
  var headers = ['站点名称', 'Property URL', 'Sitemap URL', 'Day0', 'Enabled', 'site_id'];
  var sheet = ensurePublishRuntimeSheet_(ss, PUBLISH_RUNTIME_GSC_CONFIG_SHEET, headers);
  var row = findPublishRuntimeRow_(sheet, headers, 'site_id', facts.siteId);
  var values = [facts.game, facts.productionUrl, facts.sitemapUrl, facts.deployedDate, true, facts.siteId];
  writePublishRuntimeRow_(sheet, row, values);
}

function upsertPublishRuntimeSteam_(facts) {
  var ss = SpreadsheetApp.openById(PUBLISH_RUNTIME_STEAM_SPREADSHEET_ID);
  if (!ss) throw new Error('SITE_LAUNCH runtime sync cannot open Steam spreadsheet');

  var poolHeaders = ['Site ID','游戏名称','Steam App ID','当前状态','BUILD日期','Build状态','Repo URL','Vercel URL','上线日期','模板版本','GSC状态','GSC Site','GSC URL Prefix','GSC Last Sync','SEO阶段','Index状态','首次曝光日期','Clicks','Impressions','CTR','Average Position','OpportunityID','ExperimentType','ActualLiveAt','LaunchPageCount'];
  var pool = ensurePublishRuntimeSheet_(ss, PUBLISH_RUNTIME_SITE_POOL_SHEET, poolHeaders);
  var poolRow = findPublishRuntimeRow_(pool, poolHeaders, 'Steam App ID', facts.steamAppId);
  if (!poolRow) poolRow = findPublishRuntimeRow_(pool, poolHeaders, 'Site ID', facts.siteId);
  var existingPool = poolRow ? pool.getRange(poolRow, 1, 1, poolHeaders.length).getValues()[0] : new Array(poolHeaders.length).fill('');
  var set = function(name, value) { existingPool[poolHeaders.indexOf(name)] = value; };
  set('Site ID', facts.siteId);
  set('游戏名称', facts.game);
  set('Steam App ID', facts.steamAppId);
  set('当前状态', 'LIVE');
  if (!existingPool[poolHeaders.indexOf('BUILD日期')]) set('BUILD日期', facts.deployedDate);
  set('Build状态', 'LIVE');
  set('Repo URL', facts.repositoryUrl);
  set('Vercel URL', facts.productionUrl);
  set('上线日期', facts.deployedDate);
  if (facts.templateVersion) set('模板版本', facts.templateVersion);
  set('GSC状态', 'CONNECTED');
  set('GSC Site', facts.productionUrl);
  set('GSC URL Prefix', facts.productionUrl);
  set('SEO阶段', 'WAITING_INDEX');
  if (!existingPool[poolHeaders.indexOf('Index状态')]) set('Index状态', 'UNKNOWN');
  set('OpportunityID', facts.opportunityId);
  if (!existingPool[poolHeaders.indexOf('ExperimentType')]) set('ExperimentType', 'PROBE');
  set('ActualLiveAt', facts.deployedAt);
  set('LaunchPageCount', facts.launchPageCount);
  writePublishRuntimeRow_(pool, poolRow, existingPool);

  var bindingHeaders = ['Site ID','游戏名称','Steam App ID','网站URL','GSC Property','GSC状态','首次同步日期','最近同步日期'];
  var binding = ensurePublishRuntimeSheet_(ss, PUBLISH_RUNTIME_GSC_BINDING_SHEET, bindingHeaders);
  var bindingRow = findPublishRuntimeRow_(binding, bindingHeaders, 'Steam App ID', facts.steamAppId);
  if (!bindingRow) bindingRow = findPublishRuntimeRow_(binding, bindingHeaders, 'Site ID', facts.siteId);
  var existingBinding = bindingRow ? binding.getRange(bindingRow, 1, 1, bindingHeaders.length).getValues()[0] : new Array(bindingHeaders.length).fill('');
  var bind = function(name, value) { existingBinding[bindingHeaders.indexOf(name)] = value; };
  bind('Site ID', facts.siteId);
  bind('游戏名称', facts.game);
  bind('Steam App ID', facts.steamAppId);
  bind('网站URL', facts.productionUrl);
  bind('GSC Property', facts.productionUrl);
  bind('GSC状态', 'CONNECTED');
  if (!existingBinding[bindingHeaders.indexOf('首次同步日期')]) bind('首次同步日期', facts.deployedDate);
  bind('最近同步日期', facts.deployedDate);
  writePublishRuntimeRow_(binding, bindingRow, existingBinding);
}

function ensurePublishRuntimeSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() < 1) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var actual = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getDisplayValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (actual[i] !== headers[i]) throw new Error(name + ' header mismatch at column ' + (i + 1) + ': expected ' + headers[i] + ' got ' + (actual[i] || '(blank)'));
  }
  return sheet;
}

function findPublishRuntimeRow_(sheet, headers, keyName, keyValue) {
  var keyIndex = headers.indexOf(keyName);
  if (keyIndex < 0 || sheet.getLastRow() < 2) return 0;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getDisplayValues();
  var target = String(keyValue || '').trim();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][keyIndex] || '').trim() === target) return i + 2;
  }
  return 0;
}

function writePublishRuntimeRow_(sheet, rowNumber, values) {
  var row = rowNumber || (sheet.getLastRow() + 1);
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
  return row;
}
