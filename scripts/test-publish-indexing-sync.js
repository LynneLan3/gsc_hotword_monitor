/**
 * Production publish → GSC indexing follow-up regressions.
 * Run: node scripts/test-publish-indexing-sync.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertEqual(actual, expected, msg) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg || 'assertEqual') + ' expected=' + e + ' actual=' + a);
}

var root = path.join(__dirname, '..');
var src = fs.readFileSync(path.join(root, 'PublishRuntimeSync.gs'), 'utf8');
var searchSrc = fs.readFileSync(path.join(root, 'SearchConsole.gs'), 'utf8');
var appsscript = JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));

assert(
  appsscript.oauthScopes.indexOf('https://www.googleapis.com/auth/webmasters') >= 0,
  'appsscript upgrades to webmasters write scope'
);
assert(
  appsscript.oauthScopes.indexOf('https://www.googleapis.com/auth/webmasters.readonly') < 0,
  'appsscript no longer uses webmasters.readonly alone'
);
assert(/function submitSitemap\(/.test(searchSrc), 'SearchConsole.gs defines submitSitemap');
assert(/function inspectUrl\(/.test(searchSrc), 'inspectUrl remains in SearchConsole.gs');

function loadRuntime(overrides) {
  overrides = overrides || {};
  var calls = {
    recordPublishedBatch: [],
    submitSitemap: [],
    inspectUrl: [],
    syncPublishedSiteRuntime: []
  };

  var context = {
    LEDGER_ACTIONS: {},
    SpreadsheetApp: {},
    Utilities: {
      formatDate: function (date) {
        return date.toISOString().slice(0, 10);
      }
    },
    Session: { getScriptTimeZone: function () { return 'Asia/Shanghai'; } },
    recordPublishedBatch: function (payload) {
      calls.recordPublishedBatch.push(payload);
      return {
        ok: true,
        batchId: payload && payload.common ? payload.common.batchId : '',
        interventions: (payload && payload.interventions) || []
      };
    },
    submitSitemap: function (siteUrl, sitemapUrl) {
      calls.submitSitemap.push({ siteUrl: siteUrl, sitemapUrl: sitemapUrl });
      if (typeof overrides.submitSitemap === 'function') {
        return overrides.submitSitemap(siteUrl, sitemapUrl);
      }
      return { ok: true, siteUrl: siteUrl, sitemapUrl: sitemapUrl };
    },
    inspectUrl: function (pageUrl, siteUrl) {
      calls.inspectUrl.push({ pageUrl: pageUrl, siteUrl: siteUrl });
      if (typeof overrides.inspectUrl === 'function') {
        return overrides.inspectUrl(pageUrl, siteUrl);
      }
      return {
        ok: true,
        data: {
          inspectionResult: {
            indexStatusResult: {
              verdict: 'PASS',
              lastCrawlTime: '2026-09-10T12:00:00Z',
              robotsTxtState: 'ALLOWED',
              indexingState: 'INDEXING_ALLOWED',
              pageFetchState: 'SUCCESSFUL'
            }
          }
        }
      };
    },
    extractIndexStatus_: function (inspectionResponse) {
      var status =
        inspectionResponse &&
        inspectionResponse.inspectionResult &&
        inspectionResponse.inspectionResult.indexStatusResult
          ? inspectionResponse.inspectionResult.indexStatusResult
          : {};
      return {
        verdict: status.verdict || '',
        coverageState: status.coverageState || '',
        robotsTxtState: status.robotsTxtState || '',
        indexingState: status.indexingState || '',
        lastCrawlTime: status.lastCrawlTime || '',
        pageFetchState: status.pageFetchState || '',
        googleCanonical: status.googleCanonical || '',
        userCanonical: status.userCanonical || '',
        crawledAs: status.crawledAs || ''
      };
    },
    getSpreadsheet_: function () {
      return overrides.spreadsheet || null;
    },
    getSiteConfigColumns_: function () {
      return { name: 0, propertyUrl: 1, sitemapUrl: 2, day0: 3, enabled: 4, siteId: 5, readWidth: 6 };
    },
    normalizePropertyUrlForGsc_: function (url) {
      return String(url || '').trim();
    },
    writeLog_: function () {},
    console: console
  };

  // Keep real syncPublishedSiteRuntime_ out of dry paths; stub enrollment for SITE_LAUNCH.
  vm.runInNewContext(src, context);

  if (overrides.stubRuntimeSync !== false) {
    var originalSync = context.syncPublishedSiteRuntime_;
    context.syncPublishedSiteRuntime_ = function (receipt, launch) {
      calls.syncPublishedSiteRuntime.push({ receipt: receipt, launch: launch });
      if (typeof overrides.syncPublishedSiteRuntime_ === 'function') {
        return overrides.syncPublishedSiteRuntime_(receipt, launch);
      }
      return {
        ok: true,
        siteId: String(receipt.common.siteId || '').trim(),
        steamAppId: String(receipt.common.steamAppId || '').trim(),
        productionUrl: String(receipt.common.productionUrl || '').trim(),
        gscConfig: 'UPSERTED',
        steamSitePool: 'UPSERTED',
        steamGscBinding: 'UPSERTED'
      };
    };
    context.__originalSyncPublishedSiteRuntime_ = originalSync;
  }

  context.__calls = calls;
  return context;
}

function makeSiteSpreadsheet(rows) {
  return {
    getSheetByName: function (name) {
      if (name !== '站点配置') return null;
      return {
        getLastRow: function () {
          return rows.length + 1;
        },
        getLastColumn: function () {
          return 6;
        },
        getRange: function (r1, c1, r2, c2) {
          return {
            getValues: function () {
              if (r1 === 1) {
                return [['站点名称', 'Property URL', 'Sitemap URL', 'Day0', 'Enabled', 'site_id']];
              }
              return rows.slice(r1 - 2, r2 - 1);
            }
          };
        }
      };
    }
  };
}

var deployedAt = '2026-09-10T08:00:00+08:00';
var productionUrl = 'https://example-game.vercel.app/';

function baseReceipt(overrides) {
  overrides = overrides || {};
  return {
    schemaVersion: 'hotword-publish-receipt-v1',
    dryRun: overrides.dryRun === true,
    common: Object.assign(
      {
        site: 'Example Game',
        siteId: 'example-game',
        game: 'Example Game',
        batchId: 'example-batch-1',
        commitSha: 'abc123',
        deploymentUrl: 'https://example-game-deploy.vercel.app',
        productionUrl: productionUrl,
        deployedAt: deployedAt
      },
      overrides.common || {}
    ),
    interventions: overrides.interventions || [
      {
        action: 'UPDATE_PAGE',
        primaryUrl: '/guides/foo/',
        affectedUrls: ['/guides/foo/', '/guides/bar/']
      }
    ]
  };
}

// --- 1. Ordinary UPDATE_PAGE now enters indexing sync ---
(function () {
  var ctx = loadRuntime({
    spreadsheet: makeSiteSpreadsheet([
      ['Example Game', productionUrl, productionUrl + 'sitemap.xml', '2026-09-01', true, 'example-game']
    ])
  });
  var result = ctx.recordPublishedBatchWithRuntimeSync(baseReceipt());
  assert(result.ok === true, 'UPDATE_PAGE ledger ok');
  assert(result.indexingSync && result.indexingSync.ok === true, 'UPDATE_PAGE runs indexing sync');
  assert(ctx.__calls.submitSitemap.length === 1, 'UPDATE_PAGE submits sitemap');
  assert(ctx.__calls.inspectUrl.length === 2, 'UPDATE_PAGE inspects changed URLs');
  assert(!result.runtimeSync, 'non-SITE_LAUNCH does not invent runtimeSync');
})();

// --- 2. CREATE_PAGE absolute URL normalization ---
(function () {
  var ctx = loadRuntime({
    spreadsheet: makeSiteSpreadsheet([
      ['Example Game', productionUrl, productionUrl + 'sitemap.xml', '2026-09-01', true, 'example-game']
    ])
  });
  var urls = ctx.extractPublishIndexingUrls_({
    common: { productionUrl: productionUrl },
    interventions: [
      {
        action: 'CREATE_PAGE',
        primaryUrl: '/guides/new-page/',
        affectedUrls: ['https://example-game.vercel.app/guides/related/']
      }
    ]
  });
  assertEqual(
    urls,
    [
      'https://example-game.vercel.app/guides/new-page/',
      'https://example-game.vercel.app/guides/related/'
    ],
    'CREATE_PAGE normalizes relative + absolute same-origin URLs'
  );
})();

// --- 3. primaryUrl + affectedUrls dedupe ---
(function () {
  var ctx = loadRuntime();
  var urls = ctx.extractPublishIndexingUrls_({
    common: { productionUrl: productionUrl },
    interventions: [
      {
        action: 'UPDATE_PAGE',
        primaryUrl: '/guides/foo/',
        affectedUrls: ['/guides/foo/', '/guides/bar/', 'https://example-game.vercel.app/guides/bar/']
      }
    ]
  });
  assertEqual(
    urls,
    [
      'https://example-game.vercel.app/guides/foo/',
      'https://example-game.vercel.app/guides/bar/'
    ],
    'primaryUrl + affectedUrls are deduped'
  );
})();

// --- 4. Homepage is not auto-attached ---
(function () {
  var ctx = loadRuntime();
  var urls = ctx.extractPublishIndexingUrls_({
    common: { productionUrl: productionUrl },
    interventions: [
      {
        action: 'UPDATE_PAGE',
        primaryUrl: '/guides/only/',
        affectedUrls: ['/guides/only/']
      }
    ]
  });
  assert(urls.indexOf('https://example-game.vercel.app/') < 0, 'homepage not auto-added');
  assertEqual(urls, ['https://example-game.vercel.app/guides/only/'], 'only explicit URLs kept');

  var withHome = ctx.extractPublishIndexingUrls_({
    common: { productionUrl: productionUrl },
    interventions: [
      {
        action: 'UPDATE_PAGE',
        primaryUrl: '/',
        affectedUrls: ['/guides/only/']
      }
    ]
  });
  assert(withHome.indexOf('https://example-game.vercel.app/') >= 0, 'explicit "/" is kept as homepage');
})();

// --- 5. PASS but lastCrawlTime < deployedAt → NEEDS_MANUAL_REQUEST ---
(function () {
  var ctx = loadRuntime();
  var cls = ctx.classifyPublishIndexingStatus_(
    {
      verdict: 'PASS',
      lastCrawlTime: '2026-09-09T08:00:00+08:00',
      robotsTxtState: 'ALLOWED',
      indexingState: 'INDEXING_ALLOWED',
      pageFetchState: 'SUCCESSFUL'
    },
    deployedAt
  );
  assertEqual(cls, 'NEEDS_MANUAL_REQUEST', 'stale crawl is manual request');
})();

// --- 6. PASS and lastCrawlTime >= deployedAt → CURRENT ---
(function () {
  var ctx = loadRuntime();
  var cls = ctx.classifyPublishIndexingStatus_(
    {
      verdict: 'PASS',
      lastCrawlTime: '2026-09-10T10:00:00+08:00',
      robotsTxtState: 'ALLOWED',
      indexingState: 'INDEXING_ALLOWED',
      pageFetchState: 'SUCCESSFUL'
    },
    deployedAt
  );
  assertEqual(cls, 'CURRENT', 'fresh crawl is CURRENT');
})();

// --- 7. Inspection failure is not CURRENT ---
(function () {
  var ctx = loadRuntime({
    spreadsheet: makeSiteSpreadsheet([
      ['Example Game', productionUrl, productionUrl + 'sitemap.xml', '2026-09-01', true, 'example-game']
    ]),
    inspectUrl: function () {
      return { ok: false, error: 'quota exceeded' };
    }
  });
  var result = ctx.recordPublishedBatchWithRuntimeSync(baseReceipt({
    interventions: [{ action: 'UPDATE_PAGE', primaryUrl: '/guides/foo/', affectedUrls: [] }]
  }));
  assert(result.indexingSync.ok === true, 'pipeline ok even when inspection fails');
  assertEqual(result.indexingSync.currentUrls, [], 'failed inspection is not CURRENT');
  assert(result.indexingSync.inspectionErrors.length === 1, 'inspection error captured');
  assertEqual(result.indexingSync.inspectionErrors[0].url, 'https://example-game.vercel.app/guides/foo/');
})();

// --- 8. SITE_LAUNCH runtime sync does not regress ---
(function () {
  var ctx = loadRuntime({
    spreadsheet: makeSiteSpreadsheet([
      ['Example Game', productionUrl, productionUrl + 'sitemap.xml', '2026-09-01', true, 'example-game']
    ])
  });
  var receipt = baseReceipt({
    common: {
      steamAppId: '12345',
      decisionId: 'DEC-1',
      opportunityId: 'OPP-1',
      repositoryUrl: 'https://github.com/example/game',
      sitemapUrl: productionUrl + 'sitemap.xml'
    },
    interventions: [
      {
        action: 'SITE_LAUNCH',
        primaryUrl: '/',
        affectedUrls: ['/', '/guides/a/', '/guides/b/']
      }
    ]
  });
  var result = ctx.recordPublishedBatchWithRuntimeSync(receipt);
  assert(result.runtimeSync && result.runtimeSync.ok === true, 'SITE_LAUNCH runtime sync still runs');
  assertEqual(result.runtimeSync.siteId, 'example-game', 'SITE_LAUNCH runtime siteId preserved');
  assert(ctx.__calls.syncPublishedSiteRuntime.length === 1, 'SITE_LAUNCH enrollment invoked once');
  assert(result.indexingSync && result.indexingSync.ok === true, 'SITE_LAUNCH also runs indexing sync');
  assert(ctx.LEDGER_ACTIONS.SITE_LAUNCH === true, 'SITE_LAUNCH still enabled in LEDGER_ACTIONS');
})();

// --- 9. dry-run does not write GSC ---
(function () {
  var ctx = loadRuntime({
    spreadsheet: makeSiteSpreadsheet([
      ['Example Game', productionUrl, productionUrl + 'sitemap.xml', '2026-09-01', true, 'example-game']
    ])
  });
  var result = ctx.recordPublishedBatchWithRuntimeSync(
    baseReceipt({
      dryRun: true,
      interventions: [{ action: 'UPDATE_PAGE', primaryUrl: '/guides/foo/', affectedUrls: ['/guides/bar/'] }]
    })
  );
  assert(result.indexingSync.ok === true, 'dry-run indexingSync ok');
  assert(result.indexingSync.dryRun === true, 'dry-run flag set');
  assert(result.indexingSync.sitemapStatus && result.indexingSync.sitemapStatus.dryRun === true, 'sitemap skipped');
  assertEqual(ctx.__calls.submitSitemap, [], 'dry-run does not submit sitemap');
  assertEqual(ctx.__calls.inspectUrl, [], 'dry-run does not inspect URLs');
  assertEqual(
    result.indexingSync.inspectedUrls,
    [
      'https://example-game.vercel.app/guides/foo/',
      'https://example-game.vercel.app/guides/bar/'
    ],
    'dry-run still reports candidate URLs'
  );
})();

// --- 10. dry-run SITE_LAUNCH keeps runtime dry-run and skips GSC writes ---
(function () {
  var ctx = loadRuntime();
  var result = ctx.recordPublishedBatchWithRuntimeSync(
    baseReceipt({
      dryRun: true,
      common: {
        steamAppId: '12345',
        decisionId: 'DEC-1',
        opportunityId: 'OPP-1',
        repositoryUrl: 'https://github.com/example/game',
        sitemapUrl: productionUrl + 'sitemap.xml'
      },
      interventions: [{ action: 'SITE_LAUNCH', primaryUrl: '/', affectedUrls: ['/'] }]
    })
  );
  assert(result.runtimeSync && result.runtimeSync.dryRun === true, 'SITE_LAUNCH dry-run runtimeSync');
  assertEqual(ctx.__calls.syncPublishedSiteRuntime, [], 'dry-run does not enroll runtime sheets');
  assertEqual(ctx.__calls.submitSitemap, [], 'SITE_LAUNCH dry-run does not write GSC');
})();

// --- 11. NEEDS_FIX is not treated as CURRENT ---
(function () {
  var ctx = loadRuntime();
  var cls = ctx.classifyPublishIndexingStatus_(
    {
      verdict: 'FAIL',
      robotsTxtState: 'DISALLOWED',
      indexingState: 'BLOCKED_BY_ROBOTS_TXT',
      pageFetchState: 'SUCCESSFUL',
      lastCrawlTime: '2026-09-11T00:00:00Z'
    },
    deployedAt
  );
  assertEqual(cls, 'NEEDS_FIX', 'robots blocker is NEEDS_FIX');
})();

// --- 12. off-origin URLs dropped ---
(function () {
  var ctx = loadRuntime();
  var urls = ctx.extractPublishIndexingUrls_({
    common: { productionUrl: productionUrl },
    interventions: [
      {
        action: 'UPDATE_PAGE',
        primaryUrl: 'https://other.example/guides/x/',
        affectedUrls: ['/guides/ok/']
      }
    ]
  });
  assertEqual(urls, ['https://example-game.vercel.app/guides/ok/'], 'off-origin URLs dropped');
})();

console.log('PASS scripts/test-publish-indexing-sync.js');
