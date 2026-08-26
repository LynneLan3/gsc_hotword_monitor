#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function readReceiptFile(receiptPath) {
  return JSON.parse(fs.readFileSync(path.resolve(receiptPath), 'utf8'));
}

export function validateDeploymentReceiptMinimum(receipt) {
  const required = [
    'receiptKey', 'siteId', 'siteName', 'batchId', 'commitSHA',
    'deploymentURL', 'productionURL', 'productionDeployedAt', 'action'
  ];
  const missing = required.filter((key) => !String(receipt?.[key] || '').trim());
  if (receipt?.schemaVersion !== 'deployment-receipt-v1' || missing.length ||
      !Array.isArray(receipt.affectedPages) || !receipt.affectedPages.length) {
    throw new Error(`invalid deployment receipt fields${missing.length ? `: ${missing.join(', ')}` : ''}`);
  }
  return true;
}

function unwrapClaspResponse(stdout) {
  const response = JSON.parse(String(stdout || '').trim());
  return response && (response.response || response.result) ? (response.response || response.result) : response;
}

export function submitDeploymentReceipt(receiptPath, options = {}) {
  const receipt = options.receipt ?? readReceiptFile(receiptPath);
  validateDeploymentReceiptMinimum(receipt);
  const claspUser = options.claspUser || process.env.HOTWORD_CLASP_USER?.trim() || 'hotword-ledger';
  const run = options.run ?? ((command, args, runOptions) => spawnSync(command, args, runOptions));
  const result = run('clasp', [
    '--json', 'run', 'ingestDeploymentReceipt', '--user', claspUser,
    '--params', JSON.stringify([receipt])
  ], {
    cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'),
    encoding: 'utf8'
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      code: result.status || 1,
      output: `deployment receipt writeback failed: ${result.error ? result.error.message : output || `exit ${result.status}`}`
    };
  }
  let value;
  try {
    value = unwrapClaspResponse(result.stdout);
  } catch {
    return { ok: false, code: 1, output: `clasp returned non-JSON output: ${output}` };
  }
  const accepted = value?.ok === true && ['ACCEPTED', 'DUPLICATE_ACCEPTED'].includes(value.result);
  return {
    ok: accepted,
    code: accepted ? 0 : 1,
    result: value?.result || 'INVALID',
    value,
    output: accepted
      ? `PASS deployment receipt result=${value.result} receiptKey=${value.receiptKey || receipt.receiptKey} intervention=${value.interventionId || receipt.interventionId}`
      : `deployment receipt writeback rejected: ${output}`
  };
}

export function main(argv = process.argv.slice(2), options = {}) {
  const receiptPath = argv[0];
  if (!receiptPath) {
    console.error('FAIL receipt path is required');
    return 2;
  }
  try {
    const result = submitDeploymentReceipt(receiptPath, options);
    if (!result.ok) {
      console.error(`FAIL ${result.output}`);
      return result.code || 1;
    }
    console.log(result.output);
    return 0;
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main();
}
