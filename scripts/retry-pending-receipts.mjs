#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { backfillPendingPublishReceipts } from './lib/ledger-receipt-client.mjs';
import { countPendingReceipts, listPendingReceipts } from './lib/ledger-receipt-store.mjs';

function parseArgs(argv) {
	let siteId = '';
	let dryRun = false;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--site-id') {
			siteId = argv[++i] || '';
			continue;
		}
		if (arg.startsWith('--site-id=')) {
			siteId = arg.slice('--site-id='.length);
			continue;
		}
		if (arg === '--dry-run') {
			dryRun = true;
			continue;
		}
		if (arg === '--help' || arg === '-h') {
			console.log('Usage: node scripts/retry-pending-receipts.mjs [--site-id <siteId>] [--dry-run]');
			process.exit(0);
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return { siteId, dryRun };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	const { siteId, dryRun } = parseArgs(process.argv.slice(2));
	const pending = listPendingReceipts({ siteId });
	if (!pending.length) {
		console.log(`PASS retry-pending-receipts pending=0 recorded=0 siteId=${siteId || 'ALL'}`);
		process.exit(0);
	}
	if (dryRun) {
		console.log(`DRY_RUN pending=${pending.length} siteId=${siteId || 'ALL'}`);
		for (const item of pending) {
			console.log(`- ${item.envelope.batchId} (${item.envelope.siteId}) ${item.filePath}`);
		}
		process.exit(0);
	}
	const result = await backfillPendingPublishReceipts({ siteId });
	console.log(
		`PASS retry-pending-receipts pending=${countPendingReceipts({ siteId })} recorded=${result.recorded} skipped=${result.skipped} failed=${result.failed} ledger_pending=${result.pendingCount} siteId=${siteId || 'ALL'}`,
	);
	for (const item of result.results) {
		const label = item.ok ? 'RECORDED' : item.status;
		console.log(`${label} ${item.filePath}${item.output ? `: ${item.output}` : ''}${item.error ? `: ${item.error}` : ''}`);
	}
	process.exit(result.failed ? 1 : 0);
}

export { backfillPendingPublishReceipts, listPendingReceipts, countPendingReceipts };
