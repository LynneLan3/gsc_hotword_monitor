#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const receiptPath = process.argv[2];
if (!receiptPath) {
  console.error('FAIL receipt path is required');
  process.exit(2);
}

let receipt;
try {
  receipt = JSON.parse(fs.readFileSync(path.resolve(receiptPath), 'utf8'));
} catch (error) {
  console.error(`FAIL cannot read receipt JSON: ${error.message}`);
  process.exit(2);
}

const required = [
  'receiptKey', 'siteId', 'siteName', 'batchId', 'commitSHA',
  'deploymentURL', 'productionURL', 'productionDeployedAt', 'action'
];
const missing = required.filter((key) => !String(receipt?.[key] || '').trim());
if (receipt?.schemaVersion !== 'deployment-receipt-v1' || missing.length ||
    !Array.isArray(receipt.affectedPages) || !receipt.affectedPages.length) {
  console.error(`FAIL invalid deployment receipt fields${missing.length ? `: ${missing.join(', ')}` : ''}`);
  process.exit(2);
}

const params = JSON.stringify([receipt]);
const claspUser = process.env.HOTWORD_CLASP_USER?.trim() || 'hotword-ledger';
const result = spawnSync('clasp', ['--json', 'run', 'ingestDeploymentReceipt', '--user', claspUser, '--params', params], {
  cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'),
  encoding: 'utf8'
});
const stdout = String(result.stdout || '').trim();
const stderr = String(result.stderr || '').trim();
if (result.error || result.status !== 0) {
  console.error(`FAIL deployment receipt writeback: ${result.error ? result.error.message : stderr || stdout || `exit ${result.status}`}`);
  process.exit(result.status || 1);
}

let response;
try {
  response = JSON.parse(stdout);
} catch {
  console.error(`FAIL clasp returned non-JSON output: ${stdout || stderr}`);
  process.exit(1);
}
const value = response && (response.response || response.result) ? (response.response || response.result) : response;
if (!value || value.ok !== true || !['ACCEPTED', 'DUPLICATE_ACCEPTED'].includes(value.result)) {
  console.error(`FAIL deployment receipt writeback: ${stdout}`);
  process.exit(1);
}
console.log(`PASS deployment receipt result=${value.result} receiptKey=${value.receiptKey || receipt.receiptKey} intervention=${value.interventionId || receipt.interventionId}`);
