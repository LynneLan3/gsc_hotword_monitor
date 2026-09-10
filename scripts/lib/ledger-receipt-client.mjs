import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SCRIPT_EXECUTION_SCOPE = 'https://www.googleapis.com/auth/script.scriptapp';
const value = (input) => String(input ?? '').trim();

function claspUser() {
  return value(process.env.HOTWORD_CLASP_USER) || 'hotword-ledger';
}

export async function preflightClaspCredentials() {
  const home = value(process.env.HOME);
  const tokenFile = home ? `${home}/.clasprc.json` : '';
  if (!tokenFile || !existsSync(tokenFile)) {
    return { ok: false, reason: 'MISSING_CLASP_REFRESH_TOKEN', scope: SCRIPT_EXECUTION_SCOPE };
  }
  return { ok: true, scope: SCRIPT_EXECUTION_SCOPE };
}

export async function invokeClaspRecordPublishedBatch(receipt) {
  const result = spawnSync('clasp', [
    '--json', 'run', 'recordPublishedBatchWithRuntimeSync',
    '--user', claspUser(), '--params', JSON.stringify([receipt])
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, HOTWORD_CLASP_USER: claspUser() },
    timeout: 120000
  });
  const stdout = value(result.stdout);
  const stderr = value(result.stderr);
  if (result.error || result.status !== 0) {
    throw new Error(`GSC_RECEIPT_WRITEBACK_FAILED: ${result.error?.message || stderr || stdout || `exit ${result.status}`}`);
  }
  let body;
  try {
    body = JSON.parse(stdout);
  } catch {
    throw new Error('GSC_RECEIPT_WRITEBACK_INVALID_RESPONSE');
  }
  const response = body?.response || body?.result || body;
  if (!response || response.ok !== true) throw new Error('GSC_RECEIPT_WRITEBACK_REJECTED');
  return { ok: true, status: 'RECORDED', response, indexingSync: response.indexingSync || null };
}

export function buildBatchIndexingPatch({ publishResult = {}, ledgerResult = {}, changedUrls = [] } = {}) {
  const sync = ledgerResult.indexingSync || publishResult.indexingSync || {};
  const sitemap = sync.sitemapStatus?.ok === true ? 'PASS' : sync.sitemapStatus ? 'FAIL' : 'NOT_RUN';
  const inspected = Array.isArray(sync.inspectedUrls) ? sync.inspectedUrls : [];
  const errors = Array.isArray(sync.inspectionErrors) ? sync.inspectionErrors : [];
  const urlInspection = inspected.length && !errors.length ? 'PASS' : inspected.length ? 'HOLD' : 'NOT_RUN';
  const manual = Array.isArray(sync.manualRequestUrls)
    ? sync.manualRequestUrls.map((item) => typeof item === 'string' ? item : item?.url).filter(Boolean)
    : (urlInspection === 'PASS' ? [] : changedUrls);
  return {
    status: 'INDEXING_CHECKED',
    indexing: {
      sitemap,
      IndexNow: 'NOT_RUN',
      'URL Inspection': urlInspection,
      manual_request_indexing_urls: [...new Set(manual)]
    }
  };
}
