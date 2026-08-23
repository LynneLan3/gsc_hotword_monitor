const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ExperimentLedger.gs'), 'utf8');
const context = {
  console,
  JSON,
  Math,
  Date,
  Object,
  Array,
  String,
  Number,
  isNaN,
  todayStr_: () => '2026-08-23',
  normalizeKeyDate_: (value) => String(value || '').trim().substring(0, 10),
  addDaysStr_: (date, delta) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Number(delta || 0));
    return d.toISOString().substring(0, 10);
  },
  daysBetweenStr_: (from, to) => {
    const a = new Date(`${from}T00:00:00Z`);
    const b = new Date(`${to}T00:00:00Z`);
    return Math.round((b - a) / 86400000);
  },
  nowRecordedAt_: () => '2026-08-23T11:36:00+08:00',
  headerIndexMap_: (headers) => Object.fromEntries(headers.map((header, index) => [header, index])),
  Utilities: { formatDate: () => '2026-08-23' },
  Session: { getScriptTimeZone: () => 'Asia/Shanghai' }
};
vm.runInNewContext(source, context);

const daily = [
  ['2026-08-16', 'Mortal Shell II', 1, 10],
  ['2026-08-17', 'Mortal Shell II', 2, 20],
  ['2026-08-18', 'Mortal Shell II', 3, 30],
  ['2026-08-19', 'Mortal Shell II', 4, 40],
  ['2026-08-20', 'Mortal Shell II', 5, 50],
  ['2026-08-21', 'Mortal Shell II', 6, 60],
  ['2026-08-22', 'Mortal Shell II', 7, 70]
];
const pages = [
  ['2026-08-16', 'Mortal Shell II', 'https://mortal-shell-ii.vercel.app/mortal-shell-ii/guide/', '/mortal-shell-ii/guide/', 1, 10, 0.1, 10],
  ['2026-08-17', 'Mortal Shell II', 'https://mortal-shell-ii.vercel.app/mortal-shell-ii/guide/', '/mortal-shell-ii/guide/', 2, 20, 0.1, 20]
];
const queryPages = [
  ['2026-08-16', 'Mortal Shell II', 'tar golem', 'https://mortal-shell-ii.vercel.app/mortal-shell-ii/guide/', '/mortal-shell-ii/guide/'],
  ['2026-08-17', 'Mortal Shell II', 'skip prologue', 'https://mortal-shell-ii.vercel.app/mortal-shell-ii/guide/', '/mortal-shell-ii/guide/']
];

const metrics = context.computeLedgerWindowMetrics_({
  dailyRows: daily,
  pageRows: pages,
  queryPageRows: queryPages,
  site: 'Mortal Shell II',
  primaryUrl: '/mortal-shell-ii/guide/',
  endDate: '2026-08-22'
});
assert.equal(metrics.clicks, 3);
assert.equal(metrics.impressions, 30);
assert.equal(metrics.queryCount, 2);
assert.equal(metrics.position, 16.666666666666668);
assert.equal(metrics.siteImpressions, 280);

const empty = context.computeLedgerWindowMetrics_({
  dailyRows: daily,
  pageRows: [],
  queryPageRows: [],
  site: 'Mortal Shell II',
  primaryUrl: '/mortal-shell-ii/new-page/',
  endDate: '2026-08-22'
});
assert.equal(empty.clicks, 0);
assert.equal(empty.impressions, 0);
assert.equal(empty.ctr, '');
assert.equal(empty.position, '');
assert.equal(empty.queryCount, 0);

const ids = context.ledgerInterventionIds_({ map: { InterventionID: 0 }, rows: [['retro-ms2']] }, { map: { InterventionID: 0 }, rows: [['2026-08-23-mortal-shell-ii-create-page-001']] });
assert.equal(context.nextLedgerInterventionId_('2026-08-23', 'mortal-shell-ii', 'CREATE_PAGE', ids), '2026-08-23-mortal-shell-ii-create-page-002');
assert.equal(context.ledgerNormalizePath_('https://mortal-shell-ii.vercel.app/mortal-shell-ii/guide/?x=1'), '/mortal-shell-ii/guide/');

const common = {
  site: 'Mortal Shell II', siteId: 'mortal-shell-ii', batchId: 'b', commitSha: 'sha',
  deploymentUrl: 'https://preview.example', productionUrl: 'https://prod.example/',
  deployedAt: '2026-08-23', releaseDate: '2026-08-20'
};
assert.throws(() => context.resolvePublishedIntervention_({ common: { ...common, decisionId: 'fake' } }, { action: 'UPDATE_PAGE', primaryUrl: '/x/' }, {}, {}), /does not exist/);
const unbound = context.resolvePublishedIntervention_({ common }, { action: 'UPDATE_PAGE', primaryUrl: '/x/' }, {}, {});
assert.equal(unbound.decisionId, '');
assert.equal(context.ledgerReleaseOffset_('2026-08-20', '2026-08-23'), 3);

const plan = { site: 'Mortal Shell II', deployedDate: '2026-08-23', action: 'CREATE_PAGE', releaseOffsetDay: 0, baseline: { impressions: 0 } };
assert.match(context.ledgerConfounders_(plan, [plan, { ...plan, interventionId: 'other' }]), /RELEASE_WINDOW/);
assert.match(context.ledgerConfounders_(plan, [plan, { ...plan, interventionId: 'other' }]), /SAME_DAY_MULTIPLE_INTERVENTIONS/);
assert.match(context.ledgerConfounders_(plan, [plan]), /NEW_PAGE_NO_PRE_BASELINE/);

const sourceConfig = fs.readFileSync(path.join(__dirname, '..', 'Config.gs'), 'utf8');
assert.match(sourceConfig, /'InterventionID'.*'ReceiptKey'.*'RecordedAt'/s);
assert.match(sourceConfig, /'ObservationID'.*'AttributionMode'.*'UpdatedAt'/s);
const contentSource = fs.readFileSync(path.join(__dirname, '..', 'ContentIntervention.gs'), 'utf8');
assert.match(contentSource, /legacy header mismatch/);
assert.doesNotMatch(contentSource, /setValues\(\[CONTENT_UPDATE_HEADERS\]\)/);
assert.match(source, /REALTIME_AUTOMATED/);

console.log('PASS scripts/test-experiment-ledger.js');
