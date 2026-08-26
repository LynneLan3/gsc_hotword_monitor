#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  submitDeploymentReceipt,
  validateDeploymentReceiptMinimum,
} from './record-deployment-receipt.mjs';

function receipt() {
  return {
    schemaVersion: 'deployment-receipt-v1',
    receiptKey: 'receipt-1', siteId: 'site-1', siteName: 'Site 1', batchId: 'batch-1',
    commitSHA: 'a'.repeat(40), deploymentURL: 'https://deploy.example',
    productionURL: 'https://site.example', productionDeployedAt: '2026-08-26T00:00:00Z',
    action: 'UPDATE_PAGE', affectedPages: [{ path: '/guide/', action: 'UPDATE_PAGE', primaryURL: 'https://site.example/guide/' }],
    developmentTaskId: '', opportunityId: '', decisionId: '', goalId: 'goal-1'
  };
}

test('canonical transport adapter submits deployment-receipt-v1 and accepts duplicate', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'deployment-receipt-adapter-'));
  const file = path.join(root, 'receipt.json');
  writeFileSync(file, `${JSON.stringify(receipt())}\n`);
  let calls = 0;
  const run = (_command, args) => {
    calls += 1;
    assert.equal(args[2], 'ingestDeploymentReceipt');
    const params = JSON.parse(args[args.indexOf('--params') + 1]);
    assert.equal(params[0].schemaVersion, 'deployment-receipt-v1');
    assert.equal(params[0].goalId, 'goal-1');
    return {
      status: 0, stdout: JSON.stringify({ response: { ok: true, result: calls === 1 ? 'ACCEPTED' : 'DUPLICATE_ACCEPTED', receiptKey: 'receipt-1' } }), stderr: ''
    };
  };
  assert.equal(submitDeploymentReceipt(file, { run }).result, 'ACCEPTED');
  assert.equal(submitDeploymentReceipt(file, { run }).result, 'DUPLICATE_ACCEPTED');
  assert.equal(calls, 2);
});

test('canonical transport rejects legacy receipt schema', () => {
  assert.throws(() => validateDeploymentReceiptMinimum({ schemaVersion: 'hotword-publish-receipt-v1' }), /invalid deployment receipt fields/);
});
