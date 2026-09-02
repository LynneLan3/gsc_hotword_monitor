#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
	EXIT,
	exitCodeForCompletionStatus,
	finalizeProductionReceiptWriteback,
	preflightClaspCredentials,
} from './lib/ledger-receipt-client.mjs';
import { validatePublishReceipt } from './lib/ledger-receipt-store.mjs';

const receiptPath = process.argv[2];
if (!receiptPath) {
	console.error('FAIL receipt path is required');
	process.exit(EXIT.INVALID_INPUT);
}

let receipt;
try {
	receipt = JSON.parse(fs.readFileSync(path.resolve(receiptPath), 'utf8'));
	if (receipt?.schemaVersion !== 'deployment-receipt-v1') {
		validatePublishReceipt(receipt);
	}
} catch (error) {
	console.error(`FAIL cannot read receipt JSON: ${error.message}`);
	process.exit(EXIT.INVALID_INPUT);
}

const preflight = await preflightClaspCredentials();
if (!preflight.ok) {
	if (receipt?.schemaVersion !== 'deployment-receipt-v1') {
		try {
			const { savePendingReceipt } = await import('./lib/ledger-receipt-store.mjs');
			const saved = savePendingReceipt(receipt, {
				sourceReceiptPath: path.resolve(receiptPath),
				ledgerStatus: 'DEPLOYED_LEDGER_PENDING',
				lastAttemptError: `${preflight.reason}: ${preflight.message}`,
			});
			console.error(`pending receipt saved: ${saved.path}`);
		} catch (saveError) {
			console.error(`could not save pending receipt: ${saveError.message}`);
		}
	}
	console.error(`${preflight.action} ${preflight.reason}: ${preflight.message}`);
	console.error('retry with: node scripts/record-publish-receipt.mjs <receipt.json>');
	process.exit(EXIT.WRITEBACK_PENDING);
}

const { current, deploymentReceipt } = await finalizeProductionReceiptWriteback(receipt, {
	sourceReceiptPath: path.resolve(receiptPath),
});

if (current.ok) {
	console.log(current.output);
} else if (current.status === 'DEPLOYED_LEDGER_PENDING') {
	console.error(`WRITEBACK_PENDING ${current.error || current.output}`);
} else {
	console.error(`RECEIPT_FAILED ${current.error || current.output}`);
}

console.log(
	`completion=${current.completionStatus} receiptKey=${deploymentReceipt.receiptKey} batchId=${deploymentReceipt.batchId}`,
);

process.exit(current.skipped || current.ok ? EXIT.RECORDED : exitCodeForCompletionStatus(current.completionStatus));
