/**
 * Publish receipt → 内容更新记录 mapper 本地自测（纯函数镜像）。
 * 运行：node scripts/test-publish-ledger-mapper.js
 */

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

const CONTENT_UPDATE_HEADERS = extractArray('CONTENT_UPDATE_HEADERS');
const CONTENT_UPDATE_PUBLISH_FIELD_HEADERS = extractArray('CONTENT_UPDATE_PUBLISH_FIELD_HEADERS');

function joinPublishListField(values) {
	if (!values?.length) return '';
	return values.map((v) => String(v || '').trim()).filter(Boolean).join('|');
}

function buildPublishInterventionNote(item) {
	const parts = [];
	if (item.reason) parts.push(item.reason);
	if (item.changeSummary && item.changeSummary !== item.reason) parts.push(item.changeSummary);
	if (item.triggerSummary) parts.push(`trigger=${item.triggerSummary}`);
	return parts.join(' | ');
}

function buildPublishReceiptFields(
	rawItem,
	item,
	common,
	deployedAt,
	recordedAt,
	ledgerKey,
	pageReceiptKey,
	interventionId,
	baselineDataDate,
	releaseDate,
	releaseOffsetDay,
) {
	return {
		InterventionID: String(interventionId || '').trim(),
		SiteID: String(common.siteId || '').trim(),
		BatchID: String(common.batchId || '').trim(),
		Action: String(item.action || '').trim(),
		PrimaryURL: String(item.primaryUrl || item.pagePath || '').trim(),
		AffectedURLs: joinPublishListField(item.affectedUrls),
		TriggerType: String(item.triggerType || '').trim(),
		TriggerQueries: joinPublishListField(item.triggerQueries),
		TriggerSummary: String(item.triggerSummary || '').trim(),
		SourceRefs: joinPublishListField(item.sourceRefs),
		Reason: String(item.reason || '').trim(),
		LifecyclePhase: String(common.lifecyclePhase || '').trim(),
		ReleaseDate: String(releaseDate || '').trim(),
		ReleaseOffsetDay: releaseOffsetDay === '' ? '' : String(releaseOffsetDay),
		CommitSHA: String(common.commitSha || rawItem.commitSha || '').trim(),
		DeploymentURL: String(common.deploymentUrl || rawItem.deploymentUrl || '').trim(),
		ProductionURL: String(common.productionUrl || rawItem.productionUrl || '').trim(),
		ProductionDeployedAt: String(deployedAt || common.deployedAt || rawItem.deployedAt || '').trim(),
		DevelopmentTaskID: String(item.developmentTaskId || common.developmentTaskId || '').trim(),
		OpportunityID: String(item.opportunityId || common.opportunityId || '').trim(),
		RecordedMode: 'REALTIME',
		BaselineDataDate: String(baselineDataDate || '').trim(),
		ReceiptKey: String(common.batchId || '').trim(),
		RecordedAt: String(recordedAt || '').trim(),
		PageReceiptKey: String(pageReceiptKey || '').trim(),
		GoalID: String(item.goalId || '').trim(),
	};
}

function buildContentUpdateRow(base, publishFields) {
	const fields = {
		'更新时间': base.updateDate,
		'站点': base.site,
		'页面路径': base.pagePath,
		'来源': base.source,
		'更新说明': base.note,
		'更新类型': base.updateType,
		DecisionID: base.decisionId,
	};
	for (const key of CONTENT_UPDATE_PUBLISH_FIELD_HEADERS) {
		if (publishFields[key] !== undefined && publishFields[key] !== null) {
			fields[key] = String(publishFields[key]).trim();
		}
	}
	return CONTENT_UPDATE_HEADERS.map((header) => String(fields[header] ?? '').trim());
}

function addDaysStr(dateStr, delta) {
	const [y, m, d] = String(dateStr || '').split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	dt.setUTCDate(dt.getUTCDate() + Number(delta || 0));
	return dt.toISOString().slice(0, 10);
}

function computeInterventionOutcomeTargetDate(deployedAtIso, daysAfter, timeZone = 'Asia/Shanghai') {
	const d = new Date(deployedAtIso);
	if (Number.isNaN(d.getTime())) return '';
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(d);
	const y = parts.find((p) => p.type === 'year')?.value;
	const m = parts.find((p) => p.type === 'month')?.value;
	const day = parts.find((p) => p.type === 'day')?.value;
	return addDaysStr(`${y}-${m}-${day}`, daysAfter);
}

const common = {
	siteId: 'project-p-i-t-t',
	batchId: 'project-p-i-t-t-site-opt-20260831',
	commitSha: 'cc4db56b23569b0d684abdf2d32538cb273297ca',
	deploymentUrl: 'https://project-p-i-t-q1uvnlnos-lynnelan3s-projects.vercel.app',
	productionUrl: 'https://project-p-i-t-t.vercel.app',
	deployedAt: '2026-08-31T07:04:52.000Z',
	lifecyclePhase: 'growth',
	releaseDate: '2026-08-19',
};
const rawItem = {
	action: 'INTERNAL_LINK',
	primaryUrl: '/',
	affectedUrls: ['/elevator-code/'],
	triggerType: 'gsc_query',
	triggerQueries: ['project pitt keypad code'],
	triggerSummary: 'Route keypad query to dedicated elevator code guide from homepage Popular Questions.',
	reason: 'Send keypad intent to the dedicated elevator code authority page while preserving Secret Ending for END? intent.',
};
const item = {
	action: 'INTERNAL_LINK',
	primaryUrl: '/',
	pagePath: '/',
	triggerType: 'gsc_query',
	triggerQueries: ['project pitt keypad code'],
	triggerSummary: rawItem.triggerSummary,
	reason: rawItem.reason,
	affectedUrls: rawItem.affectedUrls,
	goalId: '',
};
const ledgerKey =
	'project-p-i-t-t-site-opt-20260831|project-p-i-t-t|/|INTERNAL_LINK|project pitt keypad code';
const pageReceiptKey = ledgerKey;
const interventionId = 'iv-13c15c144cd590c4';
const fields = buildPublishReceiptFields(
	rawItem,
	item,
	common,
	common.deployedAt,
	'2026-08-31T07:47:46.571Z',
	ledgerKey,
	pageReceiptKey,
	interventionId,
	'2026-08-28',
	common.releaseDate,
	12,
);

assert.equal(fields.SiteID, 'project-p-i-t-t');
assert.equal(fields.BatchID, 'project-p-i-t-t-site-opt-20260831');
assert.equal(fields.InterventionID, interventionId);
assert.equal(fields.CommitSHA, 'cc4db56b23569b0d684abdf2d32538cb273297ca');
assert.equal(fields.ProductionDeployedAt, '2026-08-31T07:04:52.000Z');
assert.equal(fields.PageReceiptKey, pageReceiptKey);
assert.equal(fields.ReceiptKey, 'project-p-i-t-t-site-opt-20260831');
assert.equal(fields.TriggerQueries, 'project pitt keypad code');
assert.equal(fields.LifecyclePhase, 'growth');
assert.equal(fields.ReleaseDate, '2026-08-19');
assert(!fields.GoalID);

const note = buildPublishInterventionNote(item);
assert.match(note, /Send keypad intent/);
assert.match(note, /trigger=Route keypad query/);

const row = buildContentUpdateRow(
	{
		updateDate: '2026-08-31',
		site: 'Project P.I.T.T.',
		pagePath: '/',
		source: `hotword-publish:${ledgerKey}`,
		note,
		updateType: 'INTERNAL_LINK',
		decisionId: '',
	},
	fields,
);
assert.equal(row.length, CONTENT_UPDATE_HEADERS.length);
const siteIdIdx = CONTENT_UPDATE_HEADERS.indexOf('SiteID');
const batchIdx = CONTENT_UPDATE_HEADERS.indexOf('BatchID');
const pageReceiptIdx = CONTENT_UPDATE_HEADERS.indexOf('PageReceiptKey');
assert.equal(row[siteIdIdx], 'project-p-i-t-t');
assert.equal(row[batchIdx], 'project-p-i-t-t-site-opt-20260831');
assert.equal(row[pageReceiptIdx], pageReceiptKey);

assert.equal(computeInterventionOutcomeTargetDate(common.deployedAt, 1), '2026-09-01');
assert.equal(computeInterventionOutcomeTargetDate(common.deployedAt, 3), '2026-09-03');
assert.equal(computeInterventionOutcomeTargetDate(common.deployedAt, 7), '2026-09-07');
assert.equal(computeInterventionOutcomeTargetDate(common.deployedAt, 14), '2026-09-14');

console.log('PASS scripts/test-publish-ledger-mapper.js');
