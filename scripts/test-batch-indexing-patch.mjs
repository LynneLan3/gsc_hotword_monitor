import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBatchIndexingPatch } from './lib/ledger-receipt-client.mjs';

test('builds indexing callback from production and ledger-owned evidence', () => {
  const patch = buildBatchIndexingPatch({
    publishResult: { sitemapUrl: 'https://example.test/sitemap.xml', indexNow: 'PASS', indexNowUrls: 2 },
    ledgerResult: { ok: true, response: { urlInspection: 'PASS' } },
    changedUrls: ['https://example.test/a/', 'https://example.test/a/'],
  });
  assert.equal(patch.status, 'INDEXING_CHECKED');
  assert.equal(patch.indexing.sitemap, 'PASS');
  assert.equal(patch.indexing.IndexNow, 'PASS');
  assert.equal(patch.indexing['URL Inspection'], 'PASS');
  assert.deepEqual(patch.indexing.manual_request_indexing_urls, []);
});
