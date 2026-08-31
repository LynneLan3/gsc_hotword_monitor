#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
	EXIT,
	backfillPublishedBatchReceipt,
	exitCodeForLedgerStatus,
	preflightClaspCredentials,
} from './lib/ledger-receipt-client.mjs';
import { DEPLOYED_LEDGER_STATUS, validatePublishReceipt } from './lib/ledger-receipt-store.mjs';

function parseArgs(argv) {
	let receiptPath = '';
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') {
			console.log('Usage: node scripts/backfill-published-batch.mjs <receipt.json|pending-envelope.json>');
			process.exit(0);
		}
		if (!arg.startsWith('-') && !receiptPath) {
			receiptPath = arg;
		}
	}
	return { receiptPath };
}

function loadReceipt(filePath) {
	const raw = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
	if (raw?.schemaVersion === 'hotword-pending-receipt-v1') {
		return raw.receipt;
	}
	return raw;
}

const { receiptPath } = parseArgs(process.argv.slice(2));
if (!receiptPath) {
	console.error('FAIL receipt path is required');
	process.exit(EXIT.INVALID_INPUT);
}

let receipt;
try {
	receipt = loadReceipt(receiptPath);
	validatePublishReceipt(receipt);
} catch (error) {
	console.error(`FAIL cannot read receipt JSON: ${error.message}`);
	process.exit(EXIT.INVALID_INPUT);
}

const preflight = await preflightClaspCredentials();
if (!preflight.ok) {
	console.error(`${preflight.action} ${preflight.reason}: ${preflight.message}`);
	process.exit(EXIT.LEDGER_PENDING);
}

const result = await backfillPublishedBatchReceipt(receipt);
if (result.ok) {
	const value = result.response || {};
	console.log(
		`PASS backfill-published-batch batch=${value.batchId || receipt.common.batchId} inserted=${value.inserted ?? 0} updated=${value.updated ?? 0} skipped=${value.skipped ?? 0} observations=${JSON.stringify(value.observations || {})}`,
	);
} else if (result.status === DEPLOYED_LEDGER_STATUS.PENDING) {
	console.error(`DEPLOYED_LEDGER_PENDING ${result.error || result.output}`);
} else {
	console.error(`FAIL backfill-published-batch: ${result.error || result.output}`);
}

process.exit(result.ok ? EXIT.RECORDED : exitCodeForLedgerStatus(result.status));
