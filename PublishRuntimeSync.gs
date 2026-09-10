/**
 * Production publish runtime sync.
 *
 * SITE_LAUNCH is a single-receipt boundary: after the existing Experiment
 * Ledger records the launch, the same receipt idempotently enrolls the site in
 * GSC monitoring and marks the Steam site project as LIVE. siteId is consumed
 * from the receipt; it is never regenerated from the game name here.
 *
 * All real Production receipts also run indexing follow-up: sitemap submit,
 * then URL Inspection of changed canonical URLs compared against deployedAt.
 */
var PUBLISH_RUNTIME_STEAM_SPREADSHEET_ID = '1WVg2p_Vero3MB2JN4yxmtHkLQRgkWO2mz95X4ms9nLE';
var PUBLISH_RUNTIME_GSC_CONFIG_SHEET = '站点配置';
var PUBLISH_RUNTIME_SITE_POOL_SHEET = '站点项目池';
var PUBLISH_RUNTIME_GSC_BINDING_SHEET = '项目GSC关联';

/** Public Execution API used by scripts/record-publish-receipt.mjs. */
function recordPublishedBatchWithRuntimeSync(payload) {
  var receipt = parsePublishRuntimeReceipt_(payload);
  var launch = publishRuntimeLaunchEntry_(receipt);

  var ledgerReceipt = receipt;
  if (launch) {
    validatePublishRuntimeLaunch_(receipt, launch);
    if (typeof LEDGER_ACTIONS === 'object' && LEDGER_ACTIONS) LEDGER_ACTIONS.SITE_LAUNCH = true;
    if (receipt.dryRun === true && receipt.common && receipt.common.decisionId) {
      ledgerReceipt = JSON.parse(JSON.stringify(receipt));
      ledgerReceipt.common.decisionId = '';
      ledgerReceipt.interventions = ledgerReceipt.interventions.map(function (entry) {
        var copy = JSON.parse(JSON.stringify(entry || {}));
        copy.decisionId = '';
        return copy;
      });
    }
  }

  var ledgerResult = recordPublishedBatch(ledgerReceipt);

  if (launch) {
    if (receipt.dryRun === true) {
      ledgerResult.runtimeSync = {
        ok: true,
        dryRun: true,
        siteId: String(receipt.common.siteId || '').trim()
      };
    } else {
      ledgerResult.runtimeSync = syncPublishedSiteRuntime_(receipt, launch);
    }
  }

  ledgerResult.indexingSync = syncPublishedIndexingFollowUp_(receipt);
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

function publishRuntimePath_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  raw = raw.replace(/^https?:\/\/[^/]+/i, '');
  raw = raw.split(/[?#]/)[0] || '/';
  if (raw.charAt(0) !== '/') raw = '/' + raw;
  return raw;
}

function publishRuntimeLaunchPageCount_(common, launch) {
  var explicit = Number(common.launchPageCount);
  if (isFinite(explicit) && explicit >= 0) return explicit;
  var values = Array.isArray(launch.affectedUrls) ? launch.affectedUrls : [];
  var seen = {};
  var count = 0;
  for (var i = 0; i < values.length; i++) {
    var path = publishRuntimePath_(values[i]);
    if (!path) continue;
    if (path === '/' || path === '/guides/' || path === '/routes/' || path === '/robots.txt' || path.indexOf('/sitemap') === 0) continue;
    if (!seen[path]) { seen[path] = true; count += 1; }
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

/**
 * Production indexing follow-up for any publish receipt.
 * Order: sitemap submit → inspect changed canonical URLs → compare lastCrawlTime vs deployedAt.
 * dryRun never performs real GSC write/inspect calls.
 */
function syncPublishedIndexingFollowUp_(receipt) {
  var common = receipt.common || {};
  var deployedAt = String(common.deployedAt || '').trim();
  var siteId = String(common.siteId || '').trim();
  var empty = emptyPublishIndexingSync_(deployedAt);

  var inspectedUrls = extractPublishIndexingUrls_(receipt);
  empty.inspectedUrls = inspectedUrls.slice();

  if (receipt.dryRun === true) {
    empty.ok = true;
    empty.dryRun = true;
    empty.sitemapStatus = { ok: true, dryRun: true, skipped: true };
    return empty;
  }

  var siteConfig = lookupPublishIndexingSiteConfig_(siteId);
  if (!siteConfig || !siteConfig.propertyUrl || !siteConfig.sitemapUrl) {
    empty.ok = false;
    empty.sitemapStatus = {
      ok: false,
      error: 'GSC site config not found for site_id=' + siteId
    };
    return empty;
  }

  var sitemapStatus = submitSitemap(siteConfig.propertyUrl, siteConfig.sitemapUrl);
  empty.sitemapStatus = sitemapStatus;
  if (!sitemapStatus || sitemapStatus.ok !== true) {
    empty.ok = false;
    return empty;
  }

  var currentUrls = [];
  var manualRequestUrls = [];
  var needsFixUrls = [];
  var inspectionErrors = [];

  for (var i = 0; i < inspectedUrls.length; i++) {
    var pageUrl = inspectedUrls[i];
    var insp = inspectUrl(pageUrl, siteConfig.propertyUrl);
    if (!insp || insp.ok !== true) {
      inspectionErrors.push({
        url: pageUrl,
        error: insp && insp.error ? insp.error : 'URL Inspection failed'
      });
      continue;
    }
    var status = extractIndexStatus_(insp.data);
    var classification = classifyPublishIndexingStatus_(status, deployedAt);
    if (classification === 'CURRENT') {
      currentUrls.push(pageUrl);
    } else if (classification === 'NEEDS_FIX') {
      needsFixUrls.push({
        url: pageUrl,
        verdict: status.verdict || '',
        coverageState: status.coverageState || '',
        robotsTxtState: status.robotsTxtState || '',
        indexingState: status.indexingState || '',
        pageFetchState: status.pageFetchState || '',
        googleCanonical: status.googleCanonical || '',
        userCanonical: status.userCanonical || '',
        lastCrawlTime: status.lastCrawlTime || ''
      });
    } else {
      manualRequestUrls.push({
        url: pageUrl,
        verdict: status.verdict || '',
        coverageState: status.coverageState || '',
        lastCrawlTime: status.lastCrawlTime || '',
        reason: classification === 'NEEDS_MANUAL_REQUEST'
          ? 'indexable_but_not_current_crawl'
          : classification
      });
    }
  }

  empty.ok = true;
  empty.currentUrls = currentUrls;
  empty.manualRequestUrls = manualRequestUrls;
  empty.needsFixUrls = needsFixUrls;
  empty.inspectionErrors = inspectionErrors;
  if (typeof writeLog_ === 'function') {
    writeLog_(
      'INFO',
      String(common.game || common.site || siteId || ''),
      'publish indexing sync siteId=' +
        siteId +
        ' inspected=' +
        inspectedUrls.length +
        ' current=' +
        currentUrls.length +
        ' manual=' +
        manualRequestUrls.length +
        ' needsFix=' +
        needsFixUrls.length +
        ' errors=' +
        inspectionErrors.length
    );
  }
  return empty;
}

function emptyPublishIndexingSync_(deployedAt) {
  return {
    ok: false,
    sitemapStatus: null,
    deployedAt: String(deployedAt || '').trim(),
    inspectedUrls: [],
    currentUrls: [],
    manualRequestUrls: [],
    needsFixUrls: [],
    inspectionErrors: []
  };
}

/**
 * Collect intervention primaryUrl + affectedUrls as absolute same-origin
 * canonical candidates. Homepage is included only when the receipt explicitly
 * lists "/" (or an absolute homepage URL).
 */
function extractPublishIndexingUrls_(receipt) {
  var common = (receipt && receipt.common) || {};
  var productionUrl = String(common.productionUrl || '').trim();
  if (!productionUrl) return [];

  var rawValues = [];
  var interventions = (receipt && receipt.interventions) || [];
  for (var i = 0; i < interventions.length; i++) {
    var entry = interventions[i] || {};
    if (entry.primaryUrl !== undefined && entry.primaryUrl !== null && entry.primaryUrl !== '') {
      rawValues.push(entry.primaryUrl);
    }
    var affected = Array.isArray(entry.affectedUrls) ? entry.affectedUrls : [];
    for (var j = 0; j < affected.length; j++) {
      if (affected[j] !== undefined && affected[j] !== null && affected[j] !== '') {
        rawValues.push(affected[j]);
      }
    }
  }

  var seen = {};
  var out = [];
  for (var k = 0; k < rawValues.length; k++) {
    var absolute = resolvePublishIndexingUrl_(productionUrl, rawValues[k]);
    if (!absolute) continue;
    if (!isSameOriginPublishUrl_(productionUrl, absolute)) continue;
    if (seen[absolute]) continue;
    seen[absolute] = true;
    out.push(absolute);
  }
  return out;
}

function resolvePublishIndexingUrl_(productionUrl, value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  var absolute = '';
  if (/^https?:\/\//i.test(raw)) {
    absolute = raw;
  } else {
    var origin = publishIndexingOrigin_(productionUrl);
    if (!origin) return '';
    var path = raw.charAt(0) === '/' ? raw : '/' + raw;
    absolute = origin + path;
  }
  return canonicalizePublishIndexingUrl_(absolute);
}

function canonicalizePublishIndexingUrl_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  raw = raw.split('#')[0].split('?')[0];
  if (!/^https?:\/\//i.test(raw)) return '';
  // Preserve root "/" and trailing-slash style already present in receipt paths.
  if (/^https?:\/\/[^/]+$/i.test(raw)) return raw + '/';
  return raw;
}

function publishIndexingOrigin_(value) {
  var match = String(value || '').trim().match(/^(https?:\/\/[^/]+)/i);
  return match ? match[1] : '';
}

function isSameOriginPublishUrl_(productionUrl, absoluteUrl) {
  var a = publishIndexingOrigin_(productionUrl).toLowerCase();
  var b = publishIndexingOrigin_(absoluteUrl).toLowerCase();
  return !!(a && b && a === b);
}

function lookupPublishIndexingSiteConfig_(siteId) {
  siteId = String(siteId || '').trim();
  if (!siteId) return null;

  var ss = typeof getSpreadsheet_ === 'function' ? getSpreadsheet_() : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  var sheet = ss.getSheetByName(PUBLISH_RUNTIME_GSC_CONFIG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return null;

  var columns =
    typeof getSiteConfigColumns_ === 'function'
      ? getSiteConfigColumns_(sheet)
      : { name: 0, propertyUrl: 1, sitemapUrl: 2, siteId: 5, readWidth: 6 };
  var width = columns.readWidth || Math.max(sheet.getLastColumn(), 6);
  var values = sheet.getRange(2, 1, sheet.getLastRow(), width).getValues();

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (String(row[columns.siteId] || '').trim() !== siteId) continue;
    var propertyUrl = String(row[columns.propertyUrl] || '').trim();
    var sitemapUrl = String(row[columns.sitemapUrl] || '').trim();
    if (!sitemapUrl && propertyUrl && typeof defaultSitemapUrl_ === 'function') {
      sitemapUrl = defaultSitemapUrl_(propertyUrl);
    }
    if (!propertyUrl || !sitemapUrl) return null;
    return {
      siteId: siteId,
      name: String(row[columns.name] || '').trim(),
      propertyUrl:
        typeof normalizePropertyUrlForGsc_ === 'function'
          ? normalizePropertyUrlForGsc_(propertyUrl)
          : propertyUrl,
      sitemapUrl: sitemapUrl
    };
  }
  return null;
}

/**
 * Classification for one inspected URL.
 * CURRENT: verdict PASS and lastCrawlTime >= deployedAt
 * NEEDS_MANUAL_REQUEST: indexable / no hard blocker, but not crawled this version yet
 * NEEDS_FIX: clear robots / indexing / fetch / canonical blocker
 */
function classifyPublishIndexingStatus_(status, deployedAt) {
  status = status || {};
  var verdict = String(status.verdict || '').toUpperCase();
  var robots = String(status.robotsTxtState || '').toUpperCase();
  var indexing = String(status.indexingState || '').toUpperCase();
  var fetchState = String(status.pageFetchState || '').toUpperCase();
  var lastCrawlTime = String(status.lastCrawlTime || '').trim();
  var googleCanonical = String(status.googleCanonical || '').trim();
  var userCanonical = String(status.userCanonical || '').trim();

  if (robots === 'DISALLOWED') return 'NEEDS_FIX';
  if (indexing.indexOf('BLOCKED') >= 0) return 'NEEDS_FIX';
  if (
    fetchState === 'SOFT_404' ||
    fetchState === 'NOT_FOUND' ||
    fetchState === 'ACCESS_DENIED' ||
    fetchState === 'SERVER_ERROR' ||
    fetchState === 'REDIRECT_ERROR'
  ) {
    return 'NEEDS_FIX';
  }
  if (verdict === 'FAIL') return 'NEEDS_FIX';
  if (googleCanonical && userCanonical) {
    var g = canonicalizePublishIndexingUrl_(googleCanonical).replace(/\/+$/, '');
    var u = canonicalizePublishIndexingUrl_(userCanonical).replace(/\/+$/, '');
    if (g && u && g !== u) return 'NEEDS_FIX';
  }

  if (verdict === 'PASS') {
    if (lastCrawlTime && deployedAt && publishIndexingTimeMs_(lastCrawlTime) >= publishIndexingTimeMs_(deployedAt)) {
      return 'CURRENT';
    }
    return 'NEEDS_MANUAL_REQUEST';
  }

  // PARTIAL / NEUTRAL / empty verdict with no hard blocker → still needs attention,
  // but not a completed CURRENT state.
  return 'NEEDS_MANUAL_REQUEST';
}

function publishIndexingTimeMs_(value) {
  var raw = String(value || '').trim();
  if (!raw) return NaN;
  var ms = new Date(raw).getTime();
  return ms;
}
