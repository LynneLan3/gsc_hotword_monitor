/** Canonical intervention observation contract regression tests. */
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const ledger = fs.readFileSync(path.join(root, 'ExperimentLedger.gs'), 'utf8');
const config = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
const code = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');

const headers = [...config.match(/var INTERVENTION_OBSERVATION_HEADERS = (\[[\s\S]*?\]);/)[1]
  .matchAll(/'([^']+)'/g)].map((m) => m[1]);
const map = (row) => Object.fromEntries(row.map((name, index) => [name, index]));
const shuffled = [...headers].reverse();
const oldLayout = headers.slice(0, 30).reverse();
const row = oldLayout.map((name) => ({
	ObservationID: 'iv-34a332011225fe56|/|D1',
	InterventionID: 'iv-34a332011225fe56',
	PrimaryURL: '/',
	Status: 'PENDING',
	BaselineDataDate: 'Fri Aug 28 2026 00:00:00 GMT+0800',
	UpdatedAt: 'Mon Aug 31 2026 15:47:46 GMT+0800',
	ObservedSiteClicks7D: 'INTERVENTION_NATIVE',
	Confounders: 'Mon Aug 31 2026 15:47:46 GMT+0800',
	BaselineMode: '',
}[name] ?? ''));
const read = (name) => row[map(oldLayout)[name]] ?? '';
const contaminatedLayout = [...headers].reverse();
const contaminatedRow = contaminatedLayout.map((name) => ({
	ObservedSiteClicks7D: 'INTERVENTION_NATIVE',
	Confounders: 'Mon Aug 31 2026 15:47:46 GMT+0800',
}[name] ?? ''));
const readContaminated = (name) => contaminatedRow[map(contaminatedLayout)[name]] ?? '';

assert.equal(read('ObservationID'), 'iv-34a332011225fe56|/|D1');
assert.equal(readContaminated('ObservedSiteClicks7D'), 'INTERVENTION_NATIVE');
assert.equal(readContaminated('Confounders'), 'Mon Aug 31 2026 15:47:46 GMT+0800');
assert.equal(headers.length, 36);
assert.equal(new Set(headers).size, 36);

assert.match(ledger, /function upsertCanonicalInterventionObservations_\(/);
assert.match(ledger, /function repairInterventionObservationRows\(\)/);
assert.match(ledger, /INTERVENTION_OBSERVATION_STATUS\.WAITING_HORIZON/);
assert.match(ledger, /canonicalObservationUrl_\(/);
assert.match(ledger, /function resolveCanonicalObservationPrimaryUrl_\(/);
assert.match(ledger, /findEnabledSiteByNameOrId_\(siteName \|\| '', siteId \|\| ''\)/);
assert.match(ledger, /validInterventionBaselineMode_\(/);
assert.match(ledger, /function backfillMissingLaunchBaselineMode\(\)/);
assert.match(ledger, /SITE_LAUNCH/);
assert.match(ledger, /legacyAction = ledgerCell_\(contentRow, content\.map, '更新类型'\)/);
assert.match(ledger, /'SiteID', 'Action'/);
assert.doesNotMatch(ledger, /Status: String\(opts\.status \|\| OBSERVATION_STATUS\.PENDING/);
assert.match(code, /reconcileInterventionObservations_\(\);/);
assert.equal((code.match(/reconcileInterventionObservations_\(\);/g) || []).length, 1);

function canonicalUrl(raw, productionUrl) {
	let value = String(raw || '').trim().replace(/^\/+/, '');
	if (/^https?:\/\//i.test(value)) value = new URL(value).pathname;
	if (!value || value === '/') return `${productionUrl}/`;
	return `${productionUrl}/${value.replace(/^\/+|\/+$/g, '')}/`;
}
assert.equal(canonicalUrl('/', 'https://project-p-i-t-t.vercel.app'), 'https://project-p-i-t-t.vercel.app/');
assert.equal(canonicalUrl('/guides/', 'https://project-p-i-t-t.vercel.app'), 'https://project-p-i-t-t.vercel.app/guides/');
assert.equal(canonicalUrl('/', 'https://metal-gear-solid-4-master-collection.example'), 'https://metal-gear-solid-4-master-collection.example/');
assert.equal(canonicalUrl('/walkthrough/', 'https://brigandine-abyss.example'), 'https://brigandine-abyss.example/walkthrough/');

function statusFor(today, target, latest) {
	if (today < target) return 'WAITING_HORIZON';
	if (!latest || latest < target) return 'WAITING_DATA';
	return 'OBSERVED';
}
assert.equal(statusFor('2026-08-31', '2026-08-30', '2026-08-29'), 'WAITING_DATA');
assert.equal(statusFor('2026-08-29', '2026-08-30', ''), 'WAITING_HORIZON');
assert.match(ledger, /'NEW_SITE_BASELINE'/);

function backfillMode(row, launchKeys) {
	if (row.BaselineMode) return row;
	if (!launchKeys.has(row.InterventionID) && !launchKeys.has(row.DecisionID)) return row;
	return { ...row, BaselineMode: 'NEW_SITE_BASELINE' };
}
assert.equal(
	backfillMode({ InterventionID: 'launch-batch', BaselineMode: '' }, new Set(['launch-batch'])).BaselineMode,
	'NEW_SITE_BASELINE',
);
assert.equal(
	backfillMode({ InterventionID: 'gsc-observation', BaselineMode: 'GSC_ALIGNED' }, new Set(['gsc-observation'])).BaselineMode,
	'GSC_ALIGNED',
);
assert.equal(
	backfillMode({ InterventionID: 'ordinary-observation', DecisionID: '', BaselineMode: '' }, new Set()).BaselineMode,
	'',
);
assert.equal(
	backfillMode({ InterventionID: 'launch-batch', BaselineMode: '' }, new Set(['launch-batch'])).BaselineMode,
	'NEW_SITE_BASELINE',
	'positional launch evidence still resolves through a durable batch key',
);

function key(interventionId, primaryPath, horizon) {
	return `${interventionId}|${primaryPath}|${horizon}`;
}
assert.equal(key('iv-34a', '/', 'D1'), key('iv-34a', '/', 'D1'));
assert.notEqual(key('iv-34a', '/', 'D1'), key('iv-34a', '/', 'D3'));

console.log('PASS scripts/test-intervention-observation-contract.js');
