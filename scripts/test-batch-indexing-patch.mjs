import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBatchIndexingPatch } from './lib/ledger-receipt-client.mjs';

test('maps GSC-owned production indexing evidence into the shared receipt patch', () => {
  const patch = buildBatchIndexingPatch({
    ledgerResult: {
      indexingSync: {
        sitemapStatus: { ok: true },
        inspectedUrls: ['https://demo.test/demo/'],
        currentUrls: ['https://demo.test/demo/'],
        manualRequestUrls: [],
        inspectionErrors: []
      }
    }
  });
  assert.equal(patch.status, 'INDEXING_CHECKED');
  assert.deepEqual(patch.indexing, {
    sitemap: 'PASS', IndexNow: 'NOT_RUN', 'URL Inspection': 'PASS', manual_request_indexing_urls: []
  });
});
