import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	interventionDedupeKey,
	primaryTargetQuery,
	savePendingReceipt,
	countPendingReceipts,
	readPendingEnvelope,
	DEPLOYED_LEDGER_STATUS,
} from './lib/ledger-receipt-store.mjs';
import {
	backfillPendingPublishReceipts,
	finalizeLedgerWriteback,
	persistAndSubmitLedger,
	retryPendingReceipts,
} from './lib/ledger-receipt-client.mjs';

function sampleReceipt(overrides = {}) {
	const batchId = overrides.batchId || 'batch-a';
	return {
		schemaVersion: 'hotword-publish-receipt-v1',
		common: {
			site: 'Example',
			siteId: 'example-site',
			game: 'Example',
			batchId,
			commitSha: 'a'.repeat(40),
			deploymentUrl: 'https://example-site-abc.vercel.app',
			productionUrl: 'https://example-site.vercel.app',
			deployedAt: overrides.deployedAt || '2026-08-31T07:00:00.000Z',
		},
		interventions: overrides.interventions || [
			{ action: 'UPDATE_PAGE', primaryUrl: '/guides/', affectedUrls: ['/guides/'], reason: 'sync' },
			{
				action: 'INTERNAL_LINK',
				primaryUrl: 'https://example-site.vercel.app/',
				affectedUrls: ['/target/'],
				triggerQueries: ['project pitt keypad code'],
				reason: 'link',
			},
		],
	};
}

function mockSubmitSuccess(receipt) {
	return {
		ok: true,
		status: DEPLOYED_LEDGER_STATUS.RECORDED,
		output: `PASS ledger writeback batch=${receipt.common.batchId} interventions=iv-1,iv-2 baseline=2026-08-30 deployedAt=${receipt.common.deployedAt}`,
		summary: {
			batchId: receipt.common.batchId,
			interventionIds: ['iv-1', 'iv-2'],
			baselineDataDates: ['2026-08-30', '2026-08-30'],
			deployedAt: receipt.common.deployedAt,
		},
		error: '',
	};
}

test('intervention dedupe key uses batchId + siteId + page_path + change_type + target_query', () => {
	assert.equal(
		interventionDedupeKey('batch-a', 'example-site', '/guides/', 'UPDATE_PAGE', '', 'https://example-site.vercel.app'),
		'batch-a|example-site|/guides/|UPDATE_PAGE|',
	);
	assert.equal(
		interventionDedupeKey('batch-a', 'example-site', 'https://example-site.vercel.app/', 'INTERNAL_LINK', 'project pitt keypad code', 'https://example-site.vercel.app'),
		'batch-a|example-site|/|INTERNAL_LINK|project pitt keypad code',
	);
	assert.equal(primaryTargetQuery({ triggerQueries: ['Alpha', 'Beta'] }), 'alpha');
});

test('A: ledger write failure keeps durable pending receipt', async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'ledger-fail-'));
	try {
		const receipt = sampleReceipt({ batchId: 'batch-fail' });
		const result = await persistAndSubmitLedger(receipt, {
			rootDir: root,
			submit: () => ({
				ok: false,
				status: DEPLOYED_LEDGER_STATUS.PENDING,
				output: '',
				error: 'invalid_grant',
				summary: { batchId: 'batch-fail', interventionIds: [], baselineDataDates: [] },
			}),
		});
		assert.equal(result.status, DEPLOYED_LEDGER_STATUS.PENDING);
		assert.equal(countPendingReceipts({ rootDir: root }), 1);
		const pending = readPendingEnvelope(result.pendingPath);
		assert.equal(pending.ledgerStatus, DEPLOYED_LEDGER_STATUS.PENDING);
		assert.equal(pending.receipt.common.deployedAt, '2026-08-31T07:00:00.000Z');
		assert.equal(pending.receipt.common.commitSha, receipt.common.commitSha);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('B: backfill records pending receipt', async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'ledger-backfill-'));
	try {
		savePendingReceipt(sampleReceipt({ batchId: 'batch-retry' }), { rootDir: root });
		const first = await backfillPendingPublishReceipts({ rootDir: root, submit: mockSubmitSuccess });
		assert.equal(first.recorded, 1);
		assert.equal(countPendingReceipts({ rootDir: root }), 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('C: duplicate publish skips ledger insert', async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'ledger-dup-'));
	try {
		const receipt = sampleReceipt({ batchId: 'batch-dup' });
		const first = await persistAndSubmitLedger(receipt, { rootDir: root, submit: mockSubmitSuccess });
		assert.equal(first.ok, true);
		const second = await persistAndSubmitLedger(receipt, { rootDir: root, submit: mockSubmitSuccess });
		assert.equal(second.skipped, true);
		assert.match(second.output, /already recorded/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('D: publish finalizer retries historical pending receipts', async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'ledger-finalize-'));
	try {
		savePendingReceipt(sampleReceipt({ batchId: 'historical-pending', deployedAt: '2026-08-30T12:00:00.000Z' }), { rootDir: root });
		const current = sampleReceipt({ batchId: 'current-batch', deployedAt: '2026-08-31T08:00:00.000Z' });
		const result = await finalizeLedgerWriteback(current, { rootDir: root, submit: mockSubmitSuccess });
		assert.equal(result.current.ok, true);
		assert.equal(result.backfill.recorded, 1);
		assert.equal(countPendingReceipts({ rootDir: root }), 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('E: outcome anchor uses original deployedAt in ledger output', async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'ledger-deployed-at-'));
	try {
		const deployedAt = '2026-08-29T15:30:00.000Z';
		const result = await persistAndSubmitLedger(sampleReceipt({ batchId: 'anchor-batch', deployedAt }), {
			rootDir: root,
			submit: mockSubmitSuccess,
		});
		assert.match(result.output, /deployedAt=2026-08-29T15:30:00.000Z/);
		assert.equal(result.summary.deployedAt, deployedAt);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('retry pending uses mock submit and marks recorded', async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'ledger-retry-'));
	try {
		const saved = savePendingReceipt(sampleReceipt({ batchId: 'batch-retry' }), { rootDir: root });
		const result = await retryPendingReceipts({
			pendingFiles: [{ filePath: saved.path, envelope: saved.envelope }],
			submit: mockSubmitSuccess,
		});
		assert.equal(result.recorded, 1);
		assert.equal(countPendingReceipts({ rootDir: root }), 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

console.log('PASS scripts/test-ledger-receipt-store.js');
