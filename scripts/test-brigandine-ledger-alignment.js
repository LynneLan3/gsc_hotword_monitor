/**
 * Brigandine INDEX_FIX ledger alignment regression tests.
 * 运行：node scripts/test-brigandine-ledger-alignment.js
 */
import assert from 'node:assert/strict';
import { interventionDedupeKey, normalizePagePath } from './lib/ledger-receipt-store.mjs';

const PRODUCTION_URL = 'https://brigandine-abyss.vercel.app';
const BATCH_ID = 'brigandine-abyss-p0-seo-protection-20260831';
const SITE_ID = 'brigandine-abyss';
const INTERVENTION_ID = 'iv-7ce4709d9b48710f';
const DEPLOYED_AT = '2026-08-31T07:04:21.819Z';
const GSC_TIMEZONE = 'Asia/Shanghai';

function normalizePublishPathOnly(raw) {
	let value = String(raw || '').trim();
	if (/^\/+https?:\/\//i.test(value)) {
		value = value.replace(/^\/+/, '');
		if (/^https?:\/\//i.test(value)) {
			try {
				return normalizePublishPathOnly(new URL(value).pathname || '/');
			} catch {
				// fall through
			}
		}
	}
	if (!value || value === '/') return '/';
	return `/${value.replace(/^\/+|\/+$/g, '')}/`;
}

function normalizePublishPagePath(pagePath, productionUrl = '') {
	let raw = String(pagePath || '').trim();
	if (!raw) return '/';
	if (/^\/+https?:\/\//i.test(raw)) {
		raw = raw.replace(/^\/+/, '');
	}
	if (/^https?:\/\//i.test(raw)) {
		try {
			const parsed = new URL(raw);
			return normalizePublishPathOnly(parsed.pathname || '/');
		} catch {
			return normalizePublishPathOnly(raw);
		}
	}
	return normalizePublishPathOnly(raw);
}

function normalizePublishLedgerKey(ledgerKey) {
	const parts = String(ledgerKey || '').trim().split('|');
	if (parts.length < 3) return String(ledgerKey || '').trim();
	parts[2] = normalizePublishPagePath(parts[2], '');
	return parts.join('|');
}

function buildInterventionObservationId(interventionId, primaryUrl, horizon) {
	return [
		String(interventionId || '').trim(),
		normalizePublishPathOnly(primaryUrl),
		String(horizon || '').trim(),
	].join('|');
}

function deployedLocalDateFromIso(deployedAtIso) {
	const d = new Date(deployedAtIso);
	if (Number.isNaN(d.getTime())) return '';
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: GSC_TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(d);
}

function addDaysStr(dateStr, delta) {
	const [y, m, day] = String(dateStr || '').split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, day));
	dt.setUTCDate(dt.getUTCDate() + Number(delta || 0));
	return dt.toISOString().slice(0, 10);
}

function computeInterventionOutcomeTargetDate(deployedAtIso, daysAfter) {
	const base = deployedLocalDateFromIso(deployedAtIso);
	if (!base) return '';
	return addDaysStr(base, daysAfter);
}

// A. root URL canonicalization
assert.equal(normalizePublishPagePath('https://brigandine-abyss.vercel.app/', PRODUCTION_URL), '/');
assert.equal(normalizePagePath('https://brigandine-abyss.vercel.app/', PRODUCTION_URL), '/');
assert.equal(
	normalizePublishPagePath('/https://brigandine-abyss.vercel.app/', PRODUCTION_URL),
	'/',
	'malformed /https:// prefix must canonicalize to /',
);
assert.notEqual(
	normalizePublishPagePath('/https://brigandine-abyss.vercel.app/', PRODUCTION_URL),
	'/https://brigandine-abyss.vercel.app/',
);

const pageReceiptKey = normalizePublishLedgerKey(
	interventionDedupeKey(BATCH_ID, SITE_ID, 'https://brigandine-abyss.vercel.app/', 'INDEX_FIX', '', PRODUCTION_URL),
);
assert.equal(pageReceiptKey, `${BATCH_ID}|${SITE_ID}|/|INDEX_FIX|`);

// B. observation ownership
const horizons = ['D1', 'D3', 'D7', 'D14'];
const walkthroughInterventionId = 'iv-walkthrough-create-page';
const observationIds = horizons.map((hz) => buildInterventionObservationId(INTERVENTION_ID, '/', hz));
for (const observationId of observationIds) {
	assert.equal(observationId.startsWith(`${INTERVENTION_ID}|/|`), true);
	assert.equal(observationId.includes(walkthroughInterventionId), false);
	assert.equal(observationId.includes('/walkthrough/'), false);
}
const targetDates = horizons.map((hz, index) =>
	computeInterventionOutcomeTargetDate(DEPLOYED_AT, [1, 3, 7, 14][index]),
);
assert.deepEqual(targetDates, ['2026-09-01', '2026-09-03', '2026-09-07', '2026-09-14']);

// C. repeat backfill idempotency (pure dedupe-key stability)
const firstKey = interventionDedupeKey(
	BATCH_ID,
	SITE_ID,
	'https://brigandine-abyss.vercel.app/',
	'INDEX_FIX',
	'',
	PRODUCTION_URL,
);
const secondKey = interventionDedupeKey(
	BATCH_ID,
	SITE_ID,
	'/https://brigandine-abyss.vercel.app/',
	'INDEX_FIX',
	'',
	PRODUCTION_URL,
);
assert.equal(firstKey, secondKey);
assert.equal(firstKey, pageReceiptKey);

console.log('PASS scripts/test-brigandine-ledger-alignment.js');
