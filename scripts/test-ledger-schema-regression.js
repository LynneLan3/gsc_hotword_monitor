/**
 * Publish ledger schema regression tests.
 * 运行：node scripts/test-ledger-schema-regression.js
 */
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');

function extractArray(varName) {
	const m = configSrc.match(new RegExp(`var ${varName}\\s*=\\s*(\\[[\\s\\S]*?\\]);`));
	assert(m, `${varName} missing`);
	return eval(m[1]);
}

function headerIndexMap(headerRow) {
	const map = {};
	for (let i = 0; i < headerRow.length; i += 1) {
		const name = String(headerRow[i] || '').trim();
		if (name && map[name] === undefined) map[name] = i;
	}
	return map;
}

function assertHeaderUnique(headers, label) {
	const seen = {};
	for (const name of headers) {
		const key = String(name || '').trim();
		if (!key) continue;
		assert(!seen[key], `${label}: duplicate header ${key}`);
		seen[key] = true;
	}
}

const CONTENT_UPDATE_HEADERS = extractArray('CONTENT_UPDATE_HEADERS');
const INTERVENTION_OBSERVATION_HEADERS = extractArray('INTERVENTION_OBSERVATION_HEADERS');
const CONTENT_UPDATE_PUBLISH_FIELD_HEADERS = extractArray('CONTENT_UPDATE_PUBLISH_FIELD_HEADERS');

// 1) header uniqueness
assertHeaderUnique(CONTENT_UPDATE_HEADERS, '内容更新记录 canonical header');
[
	'ProductionURL',
	'ProductionDeployedAt',
	'ReceiptKey',
	'RecordedAt',
	'PageReceiptKey',
	'GoalID',
].forEach((name) => {
	assert(CONTENT_UPDATE_HEADERS.includes(name), `missing canonical column ${name}`);
	assert.equal(
		CONTENT_UPDATE_HEADERS.filter((h) => h === name).length,
		1,
		`${name} must appear exactly once`,
	);
});

for (const key of CONTENT_UPDATE_PUBLISH_FIELD_HEADERS) {
	assert(
		CONTENT_UPDATE_HEADERS.includes(key),
		`publish field ${key} must map to existing canonical column`,
	);
}

// 2) observation semantic alignment fixture
const OBSERVATION_STATUS = { PENDING: 'PENDING' };
const INTERVENTION_OBSERVATION_HORIZONS = [
	{ name: 'D1', days: 1 },
	{ name: 'D3', days: 3 },
	{ name: 'D7', days: 7 },
	{ name: 'D14', days: 14 },
];

function normalizePublishPathOnly(raw) {
	const value = String(raw || '').trim();
	if (!value || value === '/') return '/';
	return `/${value.replace(/^\/+|\/+$/g, '')}/`;
}

const GSC_TIMEZONE = 'Asia/Shanghai';

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
	const [y, m, d] = String(dateStr || '').split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	dt.setUTCDate(dt.getUTCDate() + Number(delta || 0));
	return dt.toISOString().slice(0, 10);
}

function computeInterventionOutcomeTargetDate(deployedAtIso, daysAfter) {
	const base = deployedLocalDateFromIso(deployedAtIso);
	if (!base) return '';
	return addDaysStr(base, daysAfter);
}

function buildInterventionObservationId(interventionId, primaryUrl, horizon) {
	return [
		String(interventionId || '').trim(),
		normalizePublishPathOnly(primaryUrl),
		String(horizon || '').trim(),
	].join('|');
}

function buildInterventionObservation(opts) {
	const primaryUrl = normalizePublishPathOnly(opts.primaryUrl || '/');
	const horizon = String(opts.horizon || '').trim();
	const interventionId = String(opts.interventionId || '').trim();
	return {
		ObservationID: buildInterventionObservationId(interventionId, primaryUrl, horizon),
		InterventionID: interventionId,
		DecisionID: String(opts.decisionId || '').trim(),
		SiteID: String(opts.siteId || '').trim(),
		Site: String(opts.site || '').trim(),
		PrimaryURL: primaryUrl,
		Horizon: horizon,
		TargetDate: String(opts.targetDate || '').trim(),
		ObservedDataDate: '',
		Status: String(opts.status || OBSERVATION_STATUS.PENDING).trim(),
		BaselineDataDate: String(opts.baselineDataDate || '').trim(),
		AttributionMode: String(opts.attributionMode || '').trim(),
		UpdatedAt: String(opts.updatedAt || '').trim(),
	};
}

function observationRowFromObject(observation, header) {
	return header.map((name) => (Object.prototype.hasOwnProperty.call(observation, name) ? observation[name] : ''));
}

function readObservationByHeader(row, header) {
	const map = headerIndexMap(header);
	const out = {};
	for (const name of INTERVENTION_OBSERVATION_HEADERS) {
		const idx = map[name];
		out[name] = idx === undefined ? '' : row[idx];
	}
	return out;
}

const common = {
	siteId: 'project-p-i-t-t',
	batchId: 'project-p-i-t-t-site-opt-20260831',
	deployedAt: '2026-08-31T07:04:52.000Z',
};
const interventionId = 'iv-34a332011225fe56';
const primaryUrl = '/';
const targetDate = computeInterventionOutcomeTargetDate(common.deployedAt, 1);

const observation = buildInterventionObservation({
	interventionId,
	decisionId: '',
	siteId: common.siteId,
	site: 'Project P.I.T.T.',
	primaryUrl,
	horizon: 'D1',
	targetDate,
	status: OBSERVATION_STATUS.PENDING,
	baselineDataDate: '2026-08-28',
	attributionMode: 'OBSERVATIONAL_ONLY',
	updatedAt: '2026-08-31T07:47:46.571Z',
});

const row = observationRowFromObject(observation, INTERVENTION_OBSERVATION_HEADERS);
assert.equal(row.length, INTERVENTION_OBSERVATION_HEADERS.length);

const byHeader = readObservationByHeader(row, INTERVENTION_OBSERVATION_HEADERS);
assert.equal(byHeader.PrimaryURL, '/');
assert.equal(byHeader.Horizon, 'D1');
assert.equal(byHeader.TargetDate, '2026-09-01');
assert.equal(byHeader.Status, 'PENDING');
assert.equal(byHeader.SiteID, 'project-p-i-t-t');
assert.equal(byHeader.InterventionID, interventionId);
assert.equal(byHeader.ObservationID, `${interventionId}|/|D1`);

console.log('PASS scripts/test-ledger-schema-regression.js');
