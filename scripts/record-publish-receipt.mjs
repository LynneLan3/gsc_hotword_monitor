#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const INDEXING_CHUNK_SIZE = Math.max(1, Number(process.env.HOTWORD_INDEXING_CHUNK_SIZE || 1));
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const claspUser = process.env.HOTWORD_CLASP_USER?.trim() || 'hotword-ledger';

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

const isSiteLaunch = interventions.some((item) => String(item?.action || '').trim().toUpperCase() === 'SITE_LAUNCH');
if (isSiteLaunch) {
  const launchRequired = ['game', 'steamAppId', 'decisionId', 'opportunityId', 'repositoryUrl', 'sitemapUrl'];
  const launchMissing = launchRequired.filter((key) => !common || !String(common[key] || '').trim());
  if (launchMissing.length) {
    console.error(`FAIL SITE_LAUNCH runtime fields missing: ${launchMissing.join(', ')}`);
    process.exit(2);
  }
}

function claspRun(functionName, payload) {
  const params = JSON.stringify([payload]);
  const result = spawnSync(
    'clasp',
    ['--json', 'run', functionName, '--user', claspUser, '--params', params],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      error: result.error ? result.error.message : stderr || stdout || `exit ${result.status}`,
      stdout,
      stderr
    };
  }
  try {
    const response = JSON.parse(stdout);
    const value = response && (response.response || response.result) ? response.response || response.result : response;
    return { ok: true, value, stdout };
  } catch (error) {
    return { ok: false, error: `clasp returned non-JSON output: ${stdout || stderr}`, stdout, stderr };
  }
}

function productionOrigin(productionUrl) {
  const match = String(productionUrl || '').trim().match(/^(https?:\/\/[^/]+)/i);
  return match ? match[1] : '';
}

function canonicalizeUrl(productionUrl, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let absolute = '';
  if (/^https?:\/\//i.test(raw)) absolute = raw;
  else {
    const origin = productionOrigin(productionUrl);
    if (!origin) return '';
    absolute = origin + (raw.charAt(0) === '/' ? raw : `/${raw}`);
  }
  absolute = absolute.split('#')[0].split('?')[0];
  if (/^https?:\/\/[^/]+$/i.test(absolute)) absolute += '/';
  return absolute;
}

function extractIndexingUrls(sourceReceipt) {
  const productionUrl = String(sourceReceipt?.common?.productionUrl || '').trim();
  const origin = productionOrigin(productionUrl).toLowerCase();
  const seen = new Set();
  const out = [];
  for (const entry of sourceReceipt.interventions || []) {
    const values = [];
    if (entry?.primaryUrl !== undefined && entry?.primaryUrl !== null && entry?.primaryUrl !== '') {
      values.push(entry.primaryUrl);
    }
    for (const item of Array.isArray(entry?.affectedUrls) ? entry.affectedUrls : []) {
      if (item !== undefined && item !== null && item !== '') values.push(item);
    }
    for (const value of values) {
      const absolute = canonicalizeUrl(productionUrl, value);
      if (!absolute) continue;
      const itemOrigin = productionOrigin(absolute).toLowerCase();
      if (!origin || itemOrigin !== origin) continue;
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      out.push(absolute);
    }
  }
  return out;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function mergeIndexingSync(parts) {
  const merged = {
    ok: true,
    sitemapStatus: null,
    deployedAt: String(common.deployedAt || ''),
    inspectedUrls: [],
    currentUrls: [],
    manualRequestUrls: [],
    needsFixUrls: [],
    inspectionErrors: []
  };
  const seenInspected = new Set();
  const seenCurrent = new Set();
  for (const part of parts) {
    if (!part || part.ok !== true) merged.ok = false;
    if (!merged.sitemapStatus && part?.sitemapStatus) merged.sitemapStatus = part.sitemapStatus;
    if (part?.sitemapStatus?.ok === true && part.sitemapStatus.skipped !== true) {
      merged.sitemapStatus = part.sitemapStatus;
    }
    if (part?.deployedAt) merged.deployedAt = part.deployedAt;
    for (const url of part?.inspectedUrls || []) {
      if (seenInspected.has(url)) continue;
      seenInspected.add(url);
      merged.inspectedUrls.push(url);
    }
    for (const url of part?.currentUrls || []) {
      if (seenCurrent.has(url)) continue;
      seenCurrent.add(url);
      merged.currentUrls.push(url);
    }
    merged.manualRequestUrls.push(...(part?.manualRequestUrls || []));
    merged.needsFixUrls.push(...(part?.needsFixUrls || []));
    merged.inspectionErrors.push(...(part?.inspectionErrors || []));
    if (part?.dryRun === true) merged.dryRun = true;
  }
  return merged;
}

// 1) Ledger + optional SITE_LAUNCH runtime, defer indexing to avoid Execution API ~60s gateway resets.
const ledgerReceipt = { ...receipt, skipIndexingSync: true };
const ledgerCall = claspRun('recordPublishedBatchWithRuntimeSync', ledgerReceipt);
if (!ledgerCall.ok || !ledgerCall.value || ledgerCall.value.ok !== true) {
  console.error(`FAIL ledger/runtime writeback: ${ledgerCall.error || ledgerCall.stdout}`);
  process.exit(1);
}
const value = ledgerCall.value;

if (isSiteLaunch && (!value.runtimeSync || value.runtimeSync.ok !== true)) {
  console.error(`FAIL SITE_LAUNCH runtime sync incomplete: ${ledgerCall.stdout}`);
  process.exit(1);
}

// 2) Chunked indexing follow-up (sitemap once, then inspect URL chunks).
let indexing = null;
if (receipt.dryRun === true) {
  indexing = {
    ok: true,
    dryRun: true,
    sitemapStatus: { ok: true, dryRun: true, skipped: true },
    deployedAt: String(common.deployedAt || ''),
    inspectedUrls: extractIndexingUrls(receipt),
    currentUrls: [],
    manualRequestUrls: [],
    needsFixUrls: [],
    inspectionErrors: []
  };
} else {
  const urls = extractIndexingUrls(receipt);
  const chunks = chunk(urls, INDEXING_CHUNK_SIZE);
  const parts = [];
  if (!chunks.length) {
    // Still submit sitemap even when receipt has no inspectable URLs.
    const sitemapOnly = claspRun('syncPublishedIndexingFollowUp', {
      ...receipt,
      indexingOptions: { urls: [], skipSitemap: false }
    });
    if (!sitemapOnly.ok || !sitemapOnly.value) {
      console.error(`FAIL indexing sync: ${sitemapOnly.error || sitemapOnly.stdout}`);
      process.exit(1);
    }
    parts.push(sitemapOnly.value);
  } else {
    for (let i = 0; i < chunks.length; i++) {
      const indexingCall = claspRun('syncPublishedIndexingFollowUp', {
        ...receipt,
        indexingOptions: {
          urls: chunks[i],
          skipSitemap: i > 0
        }
      });
      if (!indexingCall.ok || !indexingCall.value) {
        console.error(`FAIL indexing sync chunk ${i + 1}/${chunks.length}: ${indexingCall.error || indexingCall.stdout}`);
        process.exit(1);
      }
      parts.push(indexingCall.value);
    }
  }
  indexing = mergeIndexingSync(parts);
}

value.indexingSync = indexing;

const ids = (value.interventions || []).map((item) => item.interventionId).filter(Boolean).join(',');
const baseline = (value.interventions || []).map((item) => item.baselineDataDate || '(blank)').join(',');
const runtime = value.runtimeSync?.ok ? ` runtime=PASS siteId=${value.runtimeSync.siteId || common.siteId}` : '';

let indexingSummary = '';
if (indexing) {
  const inspected = Array.isArray(indexing.inspectedUrls) ? indexing.inspectedUrls.length : 0;
  const current = Array.isArray(indexing.currentUrls) ? indexing.currentUrls.length : 0;
  const manual = Array.isArray(indexing.manualRequestUrls) ? indexing.manualRequestUrls.length : 0;
  const needsFix = Array.isArray(indexing.needsFixUrls) ? indexing.needsFixUrls.length : 0;
  const errors = Array.isArray(indexing.inspectionErrors) ? indexing.inspectionErrors.length : 0;
  const sitemap = indexing.sitemapStatus?.ok === true ? 'PASS' : indexing.dryRun ? 'DRY_RUN' : 'FAIL';
  indexingSummary =
    ` indexing=${indexing.ok === true ? 'PASS' : 'FAIL'}` +
    ` sitemap=${sitemap}` +
    ` inspected=${inspected}` +
    ` current=${current}` +
    ` manual=${manual}` +
    ` needsFix=${needsFix}` +
    ` inspectErrors=${errors}`;
  if (indexing.dryRun === true) indexingSummary += ' dryRun=1';
}

console.log(
  `PASS ledger writeback batch=${value.batchId || ''} interventions=${ids || '(none)'} baseline=${baseline}${runtime}${indexingSummary}`
);

if (indexing) {
  console.log(
    JSON.stringify({
      indexingSync: {
        ok: indexing.ok === true,
        dryRun: indexing.dryRun === true || undefined,
        sitemapStatus: indexing.sitemapStatus || null,
        deployedAt: indexing.deployedAt || common.deployedAt || '',
        inspectedUrls: indexing.inspectedUrls || [],
        currentUrls: indexing.currentUrls || [],
        manualRequestUrls: indexing.manualRequestUrls || [],
        needsFixUrls: indexing.needsFixUrls || [],
        inspectionErrors: indexing.inspectionErrors || []
      }
    })
  );
}
