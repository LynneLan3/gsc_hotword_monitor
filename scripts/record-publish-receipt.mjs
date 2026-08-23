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

const common = receipt && receipt.common;
const interventions = receipt && receipt.interventions;
const required = ['site', 'siteId', 'batchId', 'commitSha', 'deploymentUrl', 'productionUrl', 'deployedAt'];
const missing = required.filter((key) => !common || !String(common[key] || '').trim());
if (receipt?.schemaVersion !== 'hotword-publish-receipt-v1' || missing.length || !Array.isArray(interventions) || !interventions.length) {
  console.error(`FAIL invalid minimum receipt fields${missing.length ? `: ${missing.join(', ')}` : ''}`);
  process.exit(2);
}

const params = JSON.stringify([receipt]);
const claspUser = process.env.HOTWORD_CLASP_USER?.trim() || 'hotword-ledger';
const result = spawnSync('clasp', ['--json', 'run', 'recordPublishedBatch', '--user', claspUser, '--params', params], {
  cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'),
  encoding: 'utf8'
});

const stdout = String(result.stdout || '').trim();
const stderr = String(result.stderr || '').trim();
if (result.error || result.status !== 0) {
  console.error(`FAIL ledger writeback: ${result.error ? result.error.message : stderr || stdout || `exit ${result.status}`}`);
  process.exit(result.status || 1);
}

let response = null;
try {
  response = JSON.parse(stdout);
} catch (error) {
  console.error(`FAIL clasp returned non-JSON output: ${stdout || stderr}`);
  process.exit(1);
}

const value = response && (response.response || response.result) ? (response.response || response.result) : response;
if (!value || value.ok !== true) {
  console.error(`FAIL ledger writeback: ${stdout}`);
  process.exit(1);
}

const ids = (value.interventions || []).map((item) => item.interventionId).filter(Boolean).join(',');
const baseline = (value.interventions || []).map((item) => item.baselineDataDate || '(blank)').join(',');
console.log(`PASS ledger writeback batch=${value.batchId || ''} interventions=${ids || '(none)'} baseline=${baseline}`);
