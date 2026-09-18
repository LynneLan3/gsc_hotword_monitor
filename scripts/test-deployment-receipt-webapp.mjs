#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeploymentReceiptFromPublishReceipt,
  submitDeploymentReceiptViaWebApp,
} from './lib/ledger-receipt-client.mjs';
import { DEPLOYED_LEDGER_STATUS } from './lib/ledger-receipt-store.mjs';

function deploymentReceipt() {
  return {
    schemaVersion: 'deployment-receipt-v1',
    receiptKey: 'webapp-1',
    siteId: 'site-1',
    siteName: 'Site 1',
    batchId: 'batch-1',
    commitSHA: 'a'.repeat(40),
    deploymentURL: 'https://deploy.example',
    productionURL: 'https://site.example/',
    productionDeployedAt: '2026-08-26T00:00:00Z',
    action: 'UPDATE_PAGE',
    affectedPages: [{
      path: '/guide/',
      action: 'UPDATE_PAGE',
      primaryURL: 'https://site.example/guide/',
    }],
  };
}

test('HTTP web app transport accepts ACCEPTED without clasp', async () => {
  const result = await submitDeploymentReceiptViaWebApp(deploymentReceipt(), {
    url: 'https://example.test/exec',
    token: 'deploy-secret',
    fetch: async (_url, options) => {
      assert.match(String(options.body || ''), /authToken":"deploy-secret"/);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, result: 'ACCEPTED', receiptKey: 'webapp-1' }),
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.result, 'ACCEPTED');
  assert.equal(result.transport, 'deployment-receipt-webapp');
  assert.doesNotMatch(JSON.stringify(result), /deploy-secret/);
});

test('HTTP web app temporary failure stays PENDING', async () => {
  const result = await submitDeploymentReceiptViaWebApp(deploymentReceipt(), {
    url: 'https://example.test/exec',
    token: 'deploy-secret',
    fetch: async () => {
      throw new Error('ECONNRESET');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, DEPLOYED_LEDGER_STATUS.PENDING);
  assert.equal(result.transport, 'deployment-receipt-webapp');
});

test('HTTP unauthorized is a truthful failure', async () => {
  const result = await submitDeploymentReceiptViaWebApp(deploymentReceipt(), {
    url: 'https://example.test/exec',
    token: 'bad',
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: false, error: 'unauthorized' }),
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, DEPLOYED_LEDGER_STATUS.FAILED);
  assert.equal(result.error, 'unauthorized');
});

test('buildDeploymentReceiptFromPublishReceipt remains the conversion owner', () => {
  const converted = buildDeploymentReceiptFromPublishReceipt({
    schemaVersion: 'hotword-publish-receipt-v1',
    common: {
      site: 'Site 1',
      siteId: 'site-1',
      game: 'Site 1',
      batchId: 'batch-1',
      commitSha: 'a'.repeat(40),
      deploymentUrl: 'https://deploy.example',
      productionUrl: 'https://site.example/',
      deployedAt: '2026-08-26T00:00:00Z',
      developmentTaskId: 'dev-1',
      lifecyclePhase: 'PRODUCTION',
      reason: 'test',
      triggerType: 'content_research',
      triggerSummary: 'test',
      sourceRefs: [],
      generatedAt: '2026-08-26T00:00:00Z',
      attributionMode: 'OBSERVATIONAL_ONLY',
    },
    interventions: [{
      action: 'UPDATE_PAGE',
      primaryUrl: '/guide/',
      affectedUrls: ['/guide/'],
      reason: 'test',
      changeSummary: 'test',
    }],
  });
  assert.equal(converted.schemaVersion, 'deployment-receipt-v1');
  assert.equal(converted.developmentTaskId, 'dev-1');
});
