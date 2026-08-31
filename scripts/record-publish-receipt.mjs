#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
	EXIT,
	exitCodeForLedgerStatus,
	finalizeLedgerWriteback,
	preflightClaspCredentials,
} from './lib/ledger-receipt-client.mjs';
import { DEPLOYED_LEDGER_STATUS, countPendingReceipts, validatePublishReceipt } from './lib/ledger-receipt-store.mjs';

const receiptPath = process.argv[2];
if (!receiptPath) {
	console.error('FAIL receipt path is required');
	process.exit(EXIT.INVALID_INPUT);
}

let receipt;
try {
	receipt = JSON.parse(fs.readFileSync(path.resolve(receiptPath), 'utf8'));
	validatePublishReceipt(receipt);
} catch (error) {
	console.error(`FAIL cannot read receipt JSON: ${error.message}`);
	process.exit(EXIT.INVALID_INPUT);
}

const preflight = await preflightClaspCredentials();
if (!preflight.ok) {
	console.error(`${preflight.action} ${preflight.reason}: ${preflight.message}`);
	console.error('pending receipts remain durable; retry with: node scripts/backfill-pending-publish-receipts.mjs');
	process.exit(EXIT.LEDGER_PENDING);
}

const { current, backfill } = await finalizeLedgerWriteback(receipt, { sourceReceiptPath: path.resolve(receiptPath) });

if (current.ok) {
	console.log(current.output);
} else if (current.status === DEPLOYED_LEDGER_STATUS.PENDING) {
	console.error(`DEPLOYED_LEDGER_PENDING ${current.error || current.output}`);
	console.error(`pending receipt saved: ${current.pendingPath}`);
} else {
	console.error(`FAIL ledger writeback: ${current.error || current.output}`);
}

console.log(
	`backfill recorded=${backfill.recorded} skipped=${backfill.skipped} failed=${backfill.failed} ledger_pending=${backfill.pendingCount} pending_total=${countPendingReceipts()}`,
);

process.exit(current.skipped || current.ok ? EXIT.RECORDED : exitCodeForLedgerStatus(current.status));
