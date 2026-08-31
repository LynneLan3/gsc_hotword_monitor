import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PENDING_RECEIPT_SCHEMA = 'hotword-pending-receipt-v1';
export const PUBLISH_RECEIPT_SCHEMA = 'hotword-publish-receipt-v1';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_PENDING_ROOT = path.join(ROOT, 'pending-receipts');

/** @deprecated use DEPLOYED_LEDGER_* aliases */
export const LEDGER_STATUS = {
	RECORDED: 'DEPLOYED_LEDGER_RECORDED',
	LEDGER_PENDING: 'DEPLOYED_LEDGER_PENDING',
	LEDGER_FAILED: 'DEPLOYED_LEDGER_FAILED',
};

export const DEPLOYED_LEDGER_STATUS = {
	RECORDED: 'DEPLOYED_LEDGER_RECORDED',
	PENDING: 'DEPLOYED_LEDGER_PENDING',
	FAILED: 'DEPLOYED_LEDGER_FAILED',
};

export const RECEIPT_STATUS = {
	PENDING: 'pending',
	RECORDED: 'recorded',
};

const LEGACY_LEDGER_STATUS = {
	RECORDED: 'RECORDED',
	LEDGER_PENDING: 'LEDGER_PENDING',
	LEDGER_FAILED: 'LEDGER_FAILED',
};

function asString(value) {
	return value === undefined || value === null ? '' : String(value).trim();
}

function stripMalformedUrlPrefix(raw) {
	const trimmed = asString(raw);
	if (/^\/+https?:\/\//i.test(trimmed)) {
		return trimmed.replace(/^\/+/, '');
	}
	return trimmed;
}

function normalizePathOnly(raw) {
	const trimmed = stripMalformedUrlPrefix(raw);
	if (!trimmed || trimmed === '/') return '/';
	if (/^https?:\/\//i.test(trimmed)) {
		try {
			return normalizePathOnly(new URL(trimmed).pathname || '/');
		} catch {
			// fall through
		}
	}
	return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
}

export function normalizePagePath(pagePath, productionUrl = '') {
	const raw = stripMalformedUrlPrefix(pagePath);
	if (!raw) return '/';
	if (/^https?:\/\//i.test(raw)) {
		try {
			const parsed = new URL(raw);
			if (productionUrl) {
				const base = new URL(productionUrl);
				if (parsed.origin !== base.origin) {
					return normalizePathOnly(parsed.pathname || '/');
				}
			}
			return normalizePathOnly(parsed.pathname || '/');
		} catch {
			return normalizePathOnly(raw);
		}
	}
	return normalizePathOnly(raw);
}

export function primaryTargetQuery(intervention) {
	const queries = Array.isArray(intervention?.triggerQueries) ? intervention.triggerQueries : [];
	return asString(queries[0]).toLowerCase();
}

export function interventionDedupeKey(batchId, siteId, pagePath, changeType, targetQuery = '', productionUrl = '') {
	return [
		asString(batchId),
		asString(siteId),
		normalizePagePath(pagePath, productionUrl),
		asString(changeType).toUpperCase(),
		asString(targetQuery).toLowerCase(),
	].join('|');
}

export function pendingReceiptPath(rootDir, siteId, batchId) {
	return path.join(rootDir, asString(siteId), `${asString(batchId)}.json`);
}

export function validatePublishReceipt(receipt) {
	const common = receipt?.common;
	const required = ['site', 'siteId', 'game', 'batchId', 'commitSha', 'deploymentUrl', 'productionUrl', 'deployedAt'];
	const missing = required.filter((key) => !asString(common?.[key]));
	if (receipt?.schemaVersion !== PUBLISH_RECEIPT_SCHEMA || missing.length || !Array.isArray(receipt?.interventions) || !receipt.interventions.length) {
		throw new Error(`invalid publish receipt${missing.length ? `: missing ${missing.join(', ')}` : ''}`);
	}
	return true;
}

export function buildInterventionKeys(receipt) {
	const batchId = asString(receipt.common.batchId);
	const siteId = asString(receipt.common.siteId);
	const productionUrl = asString(receipt.common.productionUrl);
	return receipt.interventions.map((item) =>
		interventionDedupeKey(batchId, siteId, item.primaryUrl, item.action, primaryTargetQuery(item), productionUrl),
	);
}

function normalizeLedgerStatus(status) {
	const value = asString(status);
	if (value === LEGACY_LEDGER_STATUS.RECORDED) return DEPLOYED_LEDGER_STATUS.RECORDED;
	if (value === LEGACY_LEDGER_STATUS.LEDGER_PENDING) return DEPLOYED_LEDGER_STATUS.PENDING;
	if (value === LEGACY_LEDGER_STATUS.LEDGER_FAILED) return DEPLOYED_LEDGER_STATUS.FAILED;
	return value || DEPLOYED_LEDGER_STATUS.PENDING;
}

export function createPendingEnvelope(receipt, options = {}) {
	validatePublishReceipt(receipt);
	const now = options.now || new Date().toISOString();
	return {
		schemaVersion: PENDING_RECEIPT_SCHEMA,
		status: RECEIPT_STATUS.PENDING,
		ledgerStatus: normalizeLedgerStatus(options.ledgerStatus || DEPLOYED_LEDGER_STATUS.PENDING),
		batchId: asString(receipt.common.batchId),
		siteId: asString(receipt.common.siteId),
		sourceReceiptPath: asString(options.sourceReceiptPath),
		pendingSince: now,
		lastAttemptAt: options.lastAttemptAt || null,
		lastAttemptError: asString(options.lastAttemptError),
		recordedAt: null,
		interventionIds: [],
		baselineDataDates: [],
		interventionKeys: buildInterventionKeys(receipt),
		receipt,
	};
}

export function savePendingReceipt(receipt, options = {}) {
	const rootDir = options.rootDir || DEFAULT_PENDING_ROOT;
	validatePublishReceipt(receipt);
	const siteId = asString(receipt.common.siteId);
	const batchId = asString(receipt.common.batchId);
	const target = pendingReceiptPath(rootDir, siteId, batchId);
	mkdirSync(path.dirname(target), { recursive: true });
	const existing = existsSync(target) ? readPendingEnvelope(target) : null;
	const envelope = existing && existing.batchId === batchId
		? {
				...existing,
				receipt,
				sourceReceiptPath: asString(options.sourceReceiptPath) || existing.sourceReceiptPath,
				interventionKeys: buildInterventionKeys(receipt),
				lastAttemptAt: options.lastAttemptAt || existing.lastAttemptAt,
				lastAttemptError: asString(options.lastAttemptError ?? existing.lastAttemptError),
				ledgerStatus: normalizeLedgerStatus(options.ledgerStatus || existing.ledgerStatus || DEPLOYED_LEDGER_STATUS.PENDING),
			}
		: createPendingEnvelope(receipt, options);
	writeFileSync(target, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
	return { path: target, envelope };
}

export function readPendingEnvelope(filePath) {
	const envelope = JSON.parse(readFileSync(path.resolve(filePath), 'utf8'));
	if (envelope?.schemaVersion !== PENDING_RECEIPT_SCHEMA) {
		throw new Error(`unsupported pending receipt schema in ${filePath}`);
	}
	envelope.ledgerStatus = normalizeLedgerStatus(envelope.ledgerStatus);
	return envelope;
}

export function markPendingRecorded(filePath, result = {}) {
	const envelope = readPendingEnvelope(filePath);
	envelope.status = RECEIPT_STATUS.RECORDED;
	envelope.ledgerStatus = DEPLOYED_LEDGER_STATUS.RECORDED;
	envelope.recordedAt = result.recordedAt || new Date().toISOString();
	envelope.lastAttemptAt = envelope.recordedAt;
	envelope.lastAttemptError = '';
	envelope.interventionIds = Array.isArray(result.interventionIds) ? result.interventionIds : envelope.interventionIds;
	envelope.baselineDataDates = Array.isArray(result.baselineDataDates) ? result.baselineDataDates : envelope.baselineDataDates;
	writeFileSync(filePath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
	return envelope;
}

export function markPendingAttempt(filePath, { ledgerStatus, error = '' } = {}) {
	const envelope = readPendingEnvelope(filePath);
	const normalized = normalizeLedgerStatus(ledgerStatus || envelope.ledgerStatus);
	envelope.status = normalized === DEPLOYED_LEDGER_STATUS.RECORDED ? RECEIPT_STATUS.RECORDED : RECEIPT_STATUS.PENDING;
	envelope.ledgerStatus = normalized;
	envelope.lastAttemptAt = new Date().toISOString();
	envelope.lastAttemptError = asString(error);
	writeFileSync(filePath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
	return envelope;
}

export function listPendingReceiptFiles(rootDir = DEFAULT_PENDING_ROOT, { siteId } = {}) {
	if (!existsSync(rootDir)) return [];
	const files = [];
	for (const siteEntry of readdirSync(rootDir, { withFileTypes: true })) {
		if (!siteEntry.isDirectory()) continue;
		if (siteId && siteEntry.name !== siteId) continue;
		const siteDir = path.join(rootDir, siteEntry.name);
		for (const file of readdirSync(siteDir)) {
			if (!file.endsWith('.json') || file === 'recorded') continue;
			files.push(path.join(siteDir, file));
		}
	}
	return files.sort();
}

export function listPendingReceipts(options = {}) {
	const rootDir = options.rootDir || DEFAULT_PENDING_ROOT;
	return listPendingReceiptFiles(rootDir, options)
		.map((filePath) => {
			try {
				return { filePath, envelope: readPendingEnvelope(filePath) };
			} catch {
				return null;
			}
		})
		.filter(Boolean)
		.filter(({ envelope }) => envelope.status !== RECEIPT_STATUS.RECORDED);
}

export function countPendingReceipts(options = {}) {
	return listPendingReceipts(options).length;
}

export function findRecordedInterventionKeys(rootDir = DEFAULT_PENDING_ROOT) {
	const keys = new Set();
	for (const filePath of listPendingReceiptFiles(rootDir)) {
		try {
			const envelope = readPendingEnvelope(filePath);
			if (envelope.status !== RECEIPT_STATUS.RECORDED) continue;
			for (const key of envelope.interventionKeys || []) keys.add(key);
		} catch {
			// ignore corrupt files
		}
	}
	return keys;
}

export function shouldSkipIntervention(receipt, recordedKeys) {
	const batchId = asString(receipt.common.batchId);
	const siteId = asString(receipt.common.siteId);
	const productionUrl = asString(receipt.common.productionUrl);
	return receipt.interventions.every((item) =>
		recordedKeys.has(interventionDedupeKey(batchId, siteId, item.primaryUrl, item.action, primaryTargetQuery(item), productionUrl)),
	);
}

export function archiveRecordedReceipt(filePath) {
	const recordedDir = path.join(path.dirname(filePath), 'recorded');
	mkdirSync(recordedDir, { recursive: true });
	const target = path.join(recordedDir, path.basename(filePath));
	if (existsSync(target)) return target;
	renameSync(filePath, target);
	return target;
}
