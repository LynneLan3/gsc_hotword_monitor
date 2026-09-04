#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const readOptional = (name) => {
  const file = path.join(root, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};
const config = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
const ledger = fs.readFileSync(path.join(root, 'ExperimentLedger.gs'), 'utf8');
const intent = readOptional('IntentOpportunityEngine.gs');
const early = readOptional('EarlyFollowupEngine.gs');
const developmentTaskHeaders = eval(`[${config.match(/var DEVELOPMENT_TASK_HEADERS\s*=\s*\[([\s\S]*?)\];/)[1]}]`);

class FakeSheet {
  constructor(headers, rows = []) { this.rows = [headers.slice(), ...rows.map((r) => r.slice())]; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows[0].length; }
  getRange(row, col, numRows = 1, numCols = 1) {
    const self = this;
    return {
      getValues() { return self.rows.slice(row - 1, row - 1 + numRows).map((r) => r.slice(col - 1, col - 1 + numCols)); },
      setValues(values) { values.forEach((v, i) => { self.rows[row - 1 + i].splice(col - 1, numCols, ...v); }); },
      setValue(value) { self.rows[row - 1][col - 1] = value; },
      clearContent() { for (let r = row - 1; r < row - 1 + numRows; r++) for (let c = col - 1; c < col - 1 + numCols; c++) self.rows[r][c] = ''; },
      setFontWeight() { return this; }
    };
  }
  appendRow(row) { this.rows.push(row.slice()); }
}

class FakeSpreadsheet {
  constructor(sheets) { this.sheets = sheets; }
  getSheetByName(name) { return this.sheets[name] || null; }
}

function dateAdd(date, delta) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(delta));
  return d.toISOString().slice(0, 10);
}

/** Seed site-level Page / Query×Page rows for every daily date in [end-6, end]. */
function seedDetailCoverage(ss, site, endDate, hubPath = '/') {
  const start = dateAdd(endDate, -6);
  for (let cursor = start; cursor <= endDate; cursor = dateAdd(cursor, 1)) {
    ss.getSheetByName('Page明细').appendRow([
      cursor, site, `https://pitt.example${hubPath}`, hubPath, 1, 10, 0.1, 8
    ]);
    ss.getSheetByName('Query页面明细').appendRow([
      cursor, site, 'project pitt hub', `https://pitt.example${hubPath}`, hubPath, 1, 10, 0.1, 8
    ]);
  }
}

function makeContext(today = '2026-08-24', existing = false) {
  const headers = (name) => {
    const match = config.match(new RegExp(`var ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
    return eval(`[${match[1]}]`);
  };
  const daily = [];
  for (let i = 16; i <= 23; i++) daily.push([`2026-08-${i}`, 'Project P.I.T.T.', 1, 10, 0.1, 10, 1, '', '']);
  const pages = [];
  const queryPages = [];
  const contentRows = [];
  if (existing) {
    for (const page of ['/up-achievement-fuses/', '/200kg-plate/', '/percentage-pipe/', '/secret-ending/', '/']) {
      const row = Array(headers('CONTENT_UPDATE_HEADERS').length).fill('');
      const h = Object.fromEntries(headers('CONTENT_UPDATE_HEADERS').map((x, i) => [x, i]));
      row[h['更新时间']] = '2026-08-24'; row[h['站点']] = 'Project P.I.T.T.'; row[h['页面路径']] = page;
      row[h.InterventionID] = 'PITT-LONGTAIL-CAPTURE-20260824'; row[h.SiteID] = 'project-p-i-t-t';
      row[h.Action] = (page === '/up-achievement-fuses/' || page === '/200kg-plate/') ? 'UPDATE_PAGE' : 'CREATE_PAGE';
      row[h.CommitSHA] = '9c401387ebd2110ed5e192a16fda027a4e227790';
      row[h.PrimaryURL] = `https://pitt.example${page}`; row[h.ProductionURL] = 'https://pitt.example/';
      contentRows.push(row);
    }
  }
  const sheets = {
    '站点配置': new FakeSheet(['站点名称', 'Property URL', 'Sitemap URL', 'Day0', 'Enabled', 'site_id'], [['Project P.I.T.T.', 'https://pitt.example/', '', '', true, 'project-p-i-t-t']]),
    'GSC日数据': new FakeSheet(headers('DAILY_HEADERS'), daily),
    'Page明细': new FakeSheet(headers('PAGE_HEADERS'), pages),
    'Query页面明细': new FakeSheet(headers('QUERY_PAGE_HEADERS'), queryPages),
    '内容更新记录': new FakeSheet(headers('CONTENT_UPDATE_HEADERS'), contentRows),
    '干预观察': new FakeSheet(headers('INTERVENTION_OBSERVATION_HEADERS')),
    '干预时间线': new FakeSheet(headers('INTERVENTION_TIMELINE_HEADERS')),
    '决策历史': new FakeSheet(['DecisionID']),
    '开发任务': new FakeSheet(headers('DEVELOPMENT_TASK_HEADERS'))
  };
  if (existing) sheets['干预时间线'].appendRow(['PITT-LONGTAIL-CAPTURE-20260824', '2026-08-24']);
  const ss = new FakeSpreadsheet(sheets);
  const context = {
    console, JSON, Math, Date, Object, Array, String, Number, isNaN,
    SITE_HEADERS: headers('SITE_HEADERS'),
    CONTENT_UPDATE_HEADERS: headers('CONTENT_UPDATE_HEADERS'),
    INTERVENTION_OBSERVATION_HEADERS: headers('INTERVENTION_OBSERVATION_HEADERS'),
    INTERVENTION_TIMELINE_HEADERS: headers('INTERVENTION_TIMELINE_HEADERS'),
    SHEET_NAMES: { SITES: '站点配置', DAILY: 'GSC日数据', PAGES: 'Page明细', QUERY_PAGES: 'Query页面明细', CONTENT_UPDATES: '内容更新记录', INTERVENTION_OBSERVATIONS: '干预观察', INTERVENTION_TIMELINE: '干预时间线', DECISION_HISTORY: '决策历史', DEVELOPMENT_TASKS: '开发任务' },
    todayStr_: () => today,
    formatDate_: (v) => new Date(v).toISOString().slice(0, 10),
    normalizeKeyDate_: (v) => {
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      const raw = String(v || '').trim();
      if (!raw) return '';
      if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? raw.slice(0, 10) : parsed.toISOString().slice(0, 10);
    },
    addDaysStr_: dateAdd,
    daysBetweenStr_: (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000),
    nowRecordedAt_: () => '2026-08-24T12:00:00+08:00',
    headerIndexMap_: (hs) => Object.fromEntries(hs.map((h, i) => [h, i])),
    getSpreadsheet_: () => ss,
    ensureSheetGrid_: () => {},
    ensureSheet_: () => {},
    ensureContentUpdateHeader_: () => {},
    loadDecisionIdSetFromHistory_: () => ({}),
    writeLog_: () => {},
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'secret', setProperty: () => {} }) },
    Utilities: { formatDate: () => '2026-08-24' },
    Session: { getScriptTimeZone: () => 'Asia/Shanghai' }
  };
  vm.createContext(context);
  vm.runInContext(ledger, context);
  return { context, ss, headers };
}

if (intent) {
  const intentContext = {};
  vm.createContext(intentContext);
  vm.runInContext(config + intent, intentContext);
  const pitt = { name: 'Project P.I.T.T.', siteId: 'project-p-i-t-t', propertyUrl: 'https://pitt.example/' };
  assert.equal(intentContext.classifyIntentCluster_('project pitt 200kg', pitt).key,
    intentContext.classifyIntentCluster_('project pitt 200 kg', pitt).key);
  assert.equal(intentContext.classifyIntentCluster_('project pitt fuse', pitt).key,
    intentContext.classifyIntentCluster_('project pitt fuses', pitt).key);
  assert.equal(intentContext.classifyIntentCluster_('project pitt fuse', pitt).intentFamily, 'FUSE');
}

if (intent && early) {
  const earlyContext = {};
  vm.createContext(earlyContext);
  vm.runInContext(config + intent + early, earlyContext);
  const pitt = { name: 'Project P.I.T.T.', siteId: 'project-p-i-t-t', propertyUrl: 'https://pitt.example/' };
  const rules = Object.fromEntries(earlyContext.DEFAULT_DECISION_RULES.map((r) => [r[0], Number(r[1])]));
  const first = earlyContext.evaluateEarlyFollowupObservation_(
    pitt, { key: 'PITT_200KG', label: '200kg', impressions: 10, clicks: 0, position: 15, topPage: '/', topPageShare: 1, intentType: 'SPECIFIC_INTENT' },
    null, false, rules, new Date('2026-08-24T00:00:00Z'), {}
  );
  assert(first.signals.includes('ABSOLUTE_CAPTURE'), 'absolute signal must not require a previous baseline');
  assert.equal(first.opportunityStage, 'CAPTURE');
  assert.equal(earlyContext.buildAdjacentCaptureCandidates_({ label: 'Fuses' }, [
    { intent: 'Percentage Pipe', sourceRefs: ['serp:test'] }, { intent: 'Secret Ending' }
  ])[0].status, 'ADJACENT_CAPTURE_CANDIDATE');
}

const receipt = {
  schemaVersion: 'deployment-receipt-v1', receiptKey: 'PITT-LONGTAIL-RECEIPT-20260824',
  interventionId: 'PITT-LONGTAIL-CAPTURE-20260824', goalId: 'goal-pitt', siteId: 'project-p-i-t-t',
  siteName: 'Project P.I.T.T.', batchId: 'PITT-20260824', decisionId: '',
  productionDeployedAt: '2026-08-24T10:00:00+08:00', commitSHA: '9c401387ebd2110ed5e192a16fda027a4e227790',
  deploymentURL: 'https://pitt-preview.vercel.app', productionURL: 'https://pitt.example/',
  releaseDate: '2026-08-24', lifecyclePhase: 'CAPTURE', action: 'CREATE_PAGE',
  affectedPages: ['/up-achievement-fuses/', '/200kg-plate/', '/percentage-pipe/', '/secret-ending/', '/'].map((p) => ({
    path: p, action: 'CREATE_PAGE', primaryURL: `https://pitt.example${p}`, triggerType: 'GSC_EXTERNAL',
    triggerQueries: ['project pitt'], triggerSummary: 'P.I.T.T. long-tail capture', sourceRefs: ['fixture'], reason: 'regression fixture'
  }))
};
const { context, ss } = makeContext();
const accepted = context.ingestDeploymentReceipt(receipt);
assert.equal(accepted.result, 'ACCEPTED');
assert.equal(ss.getSheetByName('内容更新记录').getLastRow() - 1, 5);
assert.equal(ss.getSheetByName('干预观察').getLastRow() - 1, 20);

// Canonical attribution keeps GoalID independent from OpportunityID and can
// derive the implementation identity from the existing Development Task.
const attributed = makeContext();
const taskHeaderList = developmentTaskHeaders;
const taskRow = Array(taskHeaderList.length).fill('');
for (const [name, value] of [
  ['开发任务ID', 'DEV-PITT-1'], ['OpportunityID', 'opp-pitt-1'], ['DecisionID', 'decision-pitt-1'],
  ['SiteID', 'project-p-i-t-t'], ['ActionType', 'CREATE_PAGE']
]) taskRow[taskHeaderList.indexOf(name)] = value;
attributed.ss.getSheetByName('开发任务').appendRow(taskRow);
attributed.ss.getSheetByName('决策历史').appendRow(['decision-pitt-1']);
attributed.context.loadDecisionIdSetFromHistory_ = () => ({ 'decision-pitt-1': true });
const attributedReceipt = {
  schemaVersion: 'deployment-receipt-v1', receiptKey: 'ATTRIBUTION-1', goalId: 'goal-independent',
  developmentTaskId: 'DEV-PITT-1', siteName: 'Project P.I.T.T.', batchId: 'ATTR-20260824',
  productionDeployedAt: '2026-08-24T10:00:00+08:00', commitSHA: 'a'.repeat(40),
  deploymentURL: 'https://pitt-preview.vercel.app', productionURL: 'https://pitt.example/',
  releaseDate: '2026-08-24', affectedPages: [{ path: '/new/', primaryURL: 'https://pitt.example/new/', reason: 'task' }]
};
assert.equal(attributed.context.ingestDeploymentReceipt(attributedReceipt).result, 'ACCEPTED');
const attributedContent = attributed.ss.getSheetByName('内容更新记录').rows[1];
const attributedContentHeader = Object.fromEntries(attributed.context.CONTENT_UPDATE_HEADERS.map((x, i) => [x, i]));
assert.equal(attributedContent[attributedContentHeader.DevelopmentTaskID], 'DEV-PITT-1');
assert.equal(attributedContent[attributedContentHeader.OpportunityID], 'opp-pitt-1');
assert.equal(attributedContent[attributedContentHeader.DecisionID], 'decision-pitt-1');
assert.equal(attributedContent[attributedContentHeader.GoalID], 'goal-independent');
assert.throws(() => attributed.context.ingestDeploymentReceipt({
  ...attributedReceipt, receiptKey: 'ATTRIBUTION-CONFLICT', opportunityId: 'opp-other'
}), /OpportunityID conflict/);
assert.deepEqual(ss.getSheetByName('干预观察').rows.slice(1).map((r) => r[7]).sort(),
  ['2026-08-25', '2026-08-25', '2026-08-25', '2026-08-25', '2026-08-25',
    '2026-08-27', '2026-08-27', '2026-08-27', '2026-08-27', '2026-08-27',
    '2026-08-31', '2026-08-31', '2026-08-31', '2026-08-31', '2026-08-31',
    '2026-09-07', '2026-09-07', '2026-09-07', '2026-09-07', '2026-09-07']);
assert(ss.getSheetByName('干预观察').rows.slice(1).every((r) => r[9] === 'WAITING_HORIZON'), 'future observations wait for horizon');
const contentHeaders = Object.fromEntries(receipt && context.CONTENT_UPDATE_HEADERS.map((x, i) => [x, i]));
const updateRows = ss.getSheetByName('内容更新记录').rows.slice(1);
const newBaseline = updateRows.find((r) => r[contentHeaders['页面路径']] === '/percentage-pipe/');
const existingBaseline = updateRows.find((r) => r[contentHeaders['页面路径']] === '/200kg-plate/');
assert.equal(newBaseline[contentHeaders.BaselinePageClicks7D], 0, 'new URL baseline clicks are zero');
assert.equal(newBaseline[contentHeaders.BaselinePageImpressions7D], 0, 'new URL baseline impressions are zero');
assert.equal(existingBaseline[contentHeaders.BaselinePageImpressions7D], 0, 'UPDATE_PAGE without page traffic is zero but not new');
assert.equal(context.ingestDeploymentReceipt(receipt).result, 'ALREADY_RECORDED');
assert.equal(ss.getSheetByName('内容更新记录').getLastRow() - 1, 5);
assert.equal(ss.getSheetByName('干预观察').getLastRow() - 1, 20);

const existing = makeContext('2026-08-24', true);
// A single-day Page row must never be promoted to a 7D baseline. The frozen
// homepage baseline below is the authority and must win over this detail.
existing.ss.getSheetByName('Page明细').appendRow(['2026-08-23', 'Project P.I.T.T.', 'https://pitt.example/', '/', 4, 38, 4 / 38, 7.03]);
existing.ss.getSheetByName('Query页面明细').appendRow(['2026-08-23', 'Project P.I.T.T.', 'project pitt 200kg', 'https://pitt.example/', '/', 1, 7, 1 / 7, 4.9]);
existing.ss.getSheetByName('Query页面明细').appendRow(['2026-08-23', 'Project P.I.T.T.', 'project pitt fuses', 'https://pitt.example/', '/', 1, 8, 1 / 8, 10.6]);
// Site-level detail coverage for the baseline window is required before a real
// zero can be recorded as EXISTING_URL_NO_GSC_TRAFFIC.
seedDetailCoverage(existing.ss, 'Project P.I.T.T.', '2026-08-23');
const seededContentHeaders = Object.fromEntries(existing.context.CONTENT_UPDATE_HEADERS.map((x, i) => [x, i]));
for (const row of existing.ss.getSheetByName('内容更新记录').rows.slice(1)) {
  if (row[seededContentHeaders['页面路径']] === '/up-achievement-fuses/' || row[seededContentHeaders['页面路径']] === '/200kg-plate/') {
    row[seededContentHeaders.BaselineDataDate] = '2026-08-23';
  }
  if (row[seededContentHeaders['页面路径']] === '/') {
    row[seededContentHeaders.BaselineDataDate] = '2026-08-23';
    row[seededContentHeaders.BaselinePageClicks7D] = 7;
    row[seededContentHeaders.BaselinePageImpressions7D] = 139;
    row[seededContentHeaders.BaselinePageCTR] = 7 / 139;
    row[seededContentHeaders.BaselinePagePosition] = 7.057553957;
    row[seededContentHeaders.BaselinePageQueryCount7D] = 2;
    row[seededContentHeaders.BaselineSiteClicks7D] = 7;
    row[seededContentHeaders.BaselineSiteImpressions7D] = 139;
  }
}
const reconciled = existing.context.reconcileInterventionPipeline();
assert.equal(reconciled.interventions, 1);
assert.equal(existing.ss.getSheetByName('内容更新记录').getLastRow() - 1, 5);
assert.equal(existing.ss.getSheetByName('干预观察').getLastRow() - 1, 20);
assert.equal(existing.ss.getSheetByName('决策历史').getLastRow() - 1, 0);
const recoveredContent = existing.ss.getSheetByName('内容更新记录').rows.slice(1);
const recoveredHeaders = Object.fromEntries(existing.context.CONTENT_UPDATE_HEADERS.map((x, i) => [x, i]));
const fuseBaseline = recoveredContent.find((r) => r[recoveredHeaders['页面路径']] === '/up-achievement-fuses/');
const homeBaseline = recoveredContent.find((r) => r[recoveredHeaders['页面路径']] === '/');
const newPageBaseline = recoveredContent.find((r) => r[recoveredHeaders['页面路径']] === '/percentage-pipe/');
assert.equal(fuseBaseline[recoveredHeaders.BaselineDataDate], '2026-08-23');
assert.equal(fuseBaseline[recoveredHeaders.BaselinePageClicks7D], 0);
assert.equal(fuseBaseline[recoveredHeaders.BaselinePageImpressions7D], 0);
assert.equal(fuseBaseline[recoveredHeaders.BaselinePageQueryCount7D], 0);
assert.equal(homeBaseline[recoveredHeaders.BaselinePageClicks7D], 7);
assert.equal(homeBaseline[recoveredHeaders.BaselinePageImpressions7D], 139);
assert.equal(homeBaseline[recoveredHeaders.BaselinePagePosition], 7.057553957);
assert.equal(homeBaseline[recoveredHeaders.BaselineSiteClicks7D], 7);
assert.equal(homeBaseline[recoveredHeaders.BaselineSiteImpressions7D], 139);
assert.equal(newPageBaseline[recoveredHeaders.BaselinePageClicks7D], 0);
assert.equal(newPageBaseline[recoveredHeaders.BaselinePageImpressions7D], 0);
const recoveredObsHeaders = Object.fromEntries(existing.context.INTERVENTION_OBSERVATION_HEADERS.map((x, i) => [x, i]));
const fuseObservation = existing.ss.getSheetByName('干预观察').rows.slice(1).find((r) => r[recoveredObsHeaders.PrimaryURL].includes('/up-achievement-fuses/'));
assert.equal(fuseObservation[recoveredObsHeaders.BaselineClicks7D], 0);
assert.equal(fuseObservation[recoveredObsHeaders.BaselineImpressions7D], 0);
assert.equal(fuseObservation[recoveredObsHeaders.BaselineMode], 'EXISTING_URL_NO_GSC_TRAFFIC');
assert.equal(fuseObservation[recoveredObsHeaders.BaselineSiteClicks7D], 7);
assert.equal(fuseObservation[recoveredObsHeaders.BaselineSiteImpressions7D], 139);
const homeObservation = existing.ss.getSheetByName('干预观察').rows.slice(1).find((r) => r[recoveredObsHeaders.PrimaryURL] === 'https://pitt.example/');
assert.equal(homeObservation[recoveredObsHeaders.BaselineClicks7D], 7);
assert.equal(homeObservation[recoveredObsHeaders.BaselineImpressions7D], 139);
assert.equal(homeObservation[recoveredObsHeaders.BaselineCTR], 7 / 139);
assert.equal(homeObservation[recoveredObsHeaders.BaselinePosition], 7.057553957);
assert.equal(homeObservation[recoveredObsHeaders.BaselineSiteImpressions7D], 139);
const newObservation = existing.ss.getSheetByName('干预观察').rows.slice(1).find((r) => r[recoveredObsHeaders.PrimaryURL].includes('/percentage-pipe/'));
assert.equal(newObservation[recoveredObsHeaders.BaselineClicks7D], 0);
assert.equal(newObservation[recoveredObsHeaders.BaselineImpressions7D], 0);
assert.equal(newObservation[recoveredObsHeaders.BaselineMode], 'NEW_URL_BASELINE');
assert.equal(existing.context.reconcileInterventionPipeline().observations, 20);
assert.equal(existing.ss.getSheetByName('干预观察').getLastRow() - 1, 20);
const schedule = { D1: '2026-08-25', D3: '2026-08-27', D7: '2026-08-31', D14: '2026-09-07' };
const observationsSheet = existing.ss.getSheetByName('干预观察');
for (const row of observationsSheet.rows.slice(1)) {
  assert.equal(row[recoveredObsHeaders.TargetDate], schedule[row[recoveredObsHeaders.Horizon]]);
  assert.equal(row[recoveredObsHeaders.Status], 'WAITING_HORIZON');
}
const protectedObservation = observationsSheet.rows[1];
protectedObservation[recoveredObsHeaders.ObservedClicks7D] = 123;
protectedObservation[recoveredObsHeaders.Outcome] = 'PRESERVE_SENTINEL';
existing.context.reconcileInterventionPipeline();
assert.equal(protectedObservation[recoveredObsHeaders.ObservedClicks7D], '', 'runtime writer clears stale observed values');
assert.equal(protectedObservation[recoveredObsHeaders.Outcome], '', 'runtime writer clears stale outcomes before horizon');

// Repair must reconstruct a missing schedule without changing identity fields.
const durableBefore = observationsSheet.rows.slice(1).map((row) => ({
  id: row[recoveredObsHeaders.ObservationID], intervention: row[recoveredObsHeaders.InterventionID],
  horizon: row[recoveredObsHeaders.Horizon], primary: row[recoveredObsHeaders.PrimaryURL]
}));
for (const row of observationsSheet.rows.slice(1)) row[recoveredObsHeaders.TargetDate] = '';
existing.context.reconcileInterventionPipeline();
for (let i = 0; i < observationsSheet.rows.slice(1).length; i++) {
  const row = observationsSheet.rows.slice(1)[i];
  assert.equal(row[recoveredObsHeaders.TargetDate], schedule[row[recoveredObsHeaders.Horizon]]);
  assert.equal(row[recoveredObsHeaders.Status], 'WAITING_HORIZON');
  assert.deepEqual({
    id: row[recoveredObsHeaders.ObservationID], intervention: row[recoveredObsHeaders.InterventionID],
    horizon: row[recoveredObsHeaders.Horizon], primary: row[recoveredObsHeaders.PrimaryURL]
  }, durableBefore[i]);
}
assert.equal(observationsSheet.getLastRow() - 1, 20);

// Calendar maturity without GSC coverage is WAITING_DATA, never a fake outcome.
existing.context.todayStr_ = () => '2026-08-26';
existing.context.reconcileInterventionPipeline();
const d1BeforeData = observationsSheet.rows.slice(1).find((r) => r[recoveredObsHeaders.Horizon] === 'D1');
const d3BeforeData = observationsSheet.rows.slice(1).find((r) => r[recoveredObsHeaders.Horizon] === 'D3');
assert.equal(d1BeforeData[recoveredObsHeaders.Status], 'WAITING_DATA');
assert.equal(d3BeforeData[recoveredObsHeaders.Status], 'WAITING_HORIZON');
existing.ss.getSheetByName('GSC日数据').appendRow(['2026-08-25', 'Project P.I.T.T.', 1, 10, 0.1, 10, 1, '', '']);
existing.context.reconcileInterventionPipeline();
const d1WithData = observationsSheet.rows.slice(1).find((r) => r[recoveredObsHeaders.Horizon] === 'D1');
assert.equal(d1WithData[recoveredObsHeaders.Status], 'OBSERVED');

// Once GSC covers the target date, only that target-date rolling window is used.
existing.context.todayStr_ = () => '2026-08-31';
existing.ss.getSheetByName('GSC日数据').appendRow(['2026-08-31', 'Project P.I.T.T.', 3, 30, 0.1, 9, 1, '', '']);
existing.ss.getSheetByName('Page明细').appendRow(['2026-08-31', 'Project P.I.T.T.', 'https://pitt.example/200kg-plate/', '/200kg-plate/', 5, 20, 0.25, 9]);
existing.context.reconcileInterventionPipeline();
const obsHeaders = Object.fromEntries(existing.context.INTERVENTION_OBSERVATION_HEADERS.map((x, i) => [x, i]));
const d7 = existing.ss.getSheetByName('干预观察').rows.slice(1).find((r) => r[obsHeaders.Horizon] === 'D7' && r[obsHeaders.PrimaryURL].includes('/200kg-plate/'));
assert.equal(d7[obsHeaders.Status], 'OBSERVED');
assert.equal(d7[obsHeaders.ObservedDataDate], '2026-08-31');
assert.equal(d7[obsHeaders.ObservedImpressions7D], 20);

const beforeInvalid = existing.ss.getSheetByName('内容更新记录').getLastRow();
assert.equal(existing.context.checkDeploymentReceiptToken_({}, { token: 'wrong', receiptKey: 'x' }), false);
assert.equal(existing.ss.getSheetByName('内容更新记录').getLastRow(), beforeInvalid, 'invalid auth is write-free');

// Serialization regression: the bound Sheet may have a legacy/shuffled header
// order. Values must be written by actual header name, then read back by that
// same header map rather than by the canonical constant position.
const persistence = makeContext('2026-08-24', true);
seedDetailCoverage(persistence.ss, 'Project P.I.T.T.', '2026-08-23');
const canonicalObservationHeaders = persistence.context.INTERVENTION_OBSERVATION_HEADERS.slice();
const shuffledObservationHeaders = canonicalObservationHeaders.slice().reverse().concat('LegacyNote');
persistence.ss.sheets['干预观察'] = new FakeSheet(shuffledObservationHeaders);
const persistedResult = persistence.context.reconcileInterventionPipeline();
assert.equal(persistedResult.observations, 20);
const persistedHeader = Object.fromEntries(shuffledObservationHeaders.map((x, i) => [x, i]));
const persistedRows = persistence.ss.getSheetByName('干预观察').getRange(
  2, 1, persistence.ss.getSheetByName('干预观察').getLastRow() - 1, shuffledObservationHeaders.length
).getValues();
const persistedSchedule = { D1: '2026-08-25', D3: '2026-08-27', D7: '2026-08-31', D14: '2026-09-07' };
for (const row of persistedRows) {
  assert.notEqual(row[persistedHeader.TargetDate], '', 'TargetDate must be serialized into the actual column');
  assert.equal(row[persistedHeader.TargetDate], persistedSchedule[row[persistedHeader.Horizon]]);
  assert.notEqual(row[persistedHeader.BaselineMode], '', 'BaselineMode must be serialized into the actual column');
}
const persistedFuse = persistedRows.find((r) => r[persistedHeader.PrimaryURL].includes('/up-achievement-fuses/'));
const persistedNew = persistedRows.find((r) => r[persistedHeader.PrimaryURL].includes('/percentage-pipe/'));
assert.equal(persistedFuse[persistedHeader.BaselineMode], 'EXISTING_URL_NO_GSC_TRAFFIC');
assert.equal(persistedNew[persistedHeader.BaselineMode], 'NEW_URL_BASELINE');
assert.equal(persistedFuse[persistedHeader.ObservedSiteClicks7D], '');
assert.equal(persistedFuse[persistedHeader.ObservedSiteImpressions7D], '');
assert.equal(persistedFuse[persistedHeader.AttributionMode], 'INTERVENTION_NATIVE');
assert.equal(persistedFuse[persistedHeader.Confounders], '');
assert.equal(persistence.context.reconcileInterventionPipeline().observations, 20);
const persistedRowsAfterRetry = persistence.ss.getSheetByName('干预观察').getRange(
  2, 1, persistence.ss.getSheetByName('干预观察').getLastRow() - 1, shuffledObservationHeaders.length
).getValues();
assert.equal(persistedRowsAfterRetry.length, 20);
for (const row of persistedRowsAfterRetry) {
  assert.notEqual(row[persistedHeader.TargetDate], '');
  assert.notEqual(row[persistedHeader.BaselineMode], '');
}

// Date objects from Google Sheets must survive the content-row -> plan ->
// observation path without becoming locale-dependent "Mon Aug..." strings.
const dateContext = makeContext();
const dateContentHeaders = Object.fromEntries(dateContext.context.CONTENT_UPDATE_HEADERS.map((x, i) => [x, i]));
const dateContentRow = Array(dateContext.context.CONTENT_UPDATE_HEADERS.length).fill('');
dateContentRow[dateContentHeaders['更新时间']] = new Date('2026-08-24T00:00:00Z');
dateContentRow[dateContentHeaders['站点']] = 'Project P.I.T.T.';
dateContentRow[dateContentHeaders['页面路径']] = '/';
dateContentRow[dateContentHeaders.InterventionID] = 'DATE-FIXTURE';
dateContentRow[dateContentHeaders.SiteID] = 'project-p-i-t-t';
dateContentRow[dateContentHeaders.Action] = 'CREATE_PAGE';
dateContentRow[dateContentHeaders.PrimaryURL] = 'https://pitt.example/';
dateContentRow[dateContentHeaders.ProductionURL] = 'https://pitt.example/';
dateContentRow[dateContentHeaders.ProductionDeployedAt] = new Date('2026-08-24T00:00:00Z');
dateContentRow[dateContentHeaders.RecordedMode] = 'RECEIPT_AUTO';
dateContentRow[dateContentHeaders.OpportunityID] = 'opp-only';
const datePlan = dateContext.context.planFromDeploymentContentGroup_([dateContentRow], dateContentHeaders);
assert.equal(datePlan.deployedDate, '2026-08-24');
assert.equal(datePlan.opportunityId, 'opp-only');
assert.equal(datePlan.goalId, '', 'OpportunityID must never backfill GoalID');
const dateObservation = dateContext.context.buildDeploymentObservation_(
  datePlan, datePlan.pages[0], { name: 'D1', days: 1 }, dateContext.context.deploymentObservationDataContext_()
);
assert.equal(dateObservation.TargetDate, '2026-08-25');

// The one-time repair is bounded to the known P.I.T.T. 5x4 set, maps by the
// actual Sheet headers, clears the confirmed contamination, and is idempotent.
const dirty = makeContext();
const dirtyCanonical = dirty.context.INTERVENTION_OBSERVATION_HEADERS;
const dirtyHeaders = dirtyCanonical.slice().reverse().concat('LegacyNote');
const dirtyMap = Object.fromEntries(dirtyHeaders.map((x, i) => [x, i]));
const dirtyPages = ['/', '/up-achievement-fuses/', '/200kg-plate/', '/percentage-pipe/', '/secret-ending/'];
const dirtyHorizons = ['D1', 'D3', 'D7', 'D14'];
const dirtyRows = [];
for (const page of dirtyPages) {
  for (const horizon of dirtyHorizons) {
    const canonicalRow = Array(dirtyCanonical.length).fill('');
    const canonicalMap = Object.fromEntries(dirtyCanonical.map((x, i) => [x, i]));
    canonicalRow[canonicalMap.ObservationID] = `PITT-LONGTAIL-CAPTURE-20260824|${page}|${horizon}`;
    canonicalRow[canonicalMap.InterventionID] = 'PITT-LONGTAIL-CAPTURE-20260824';
    canonicalRow[canonicalMap.SiteID] = 'project-p-i-t-t';
    canonicalRow[canonicalMap.Site] = 'Project P.I.T.T.';
    canonicalRow[canonicalMap.PrimaryURL] = `https://pitt.example${page}`;
    canonicalRow[canonicalMap.Horizon] = horizon;
    canonicalRow[canonicalMap.TargetDate] = '';
    canonicalRow[canonicalMap.Status] = 'PENDING';
    canonicalRow[canonicalMap.ObservedSiteClicks7D] = 'INTERVENTION_NATIVE';
    canonicalRow[canonicalMap.ObservedSiteImpressions7D] = 139;
    canonicalRow[canonicalMap.BaselineMode] = '';
    canonicalRow[canonicalMap.AttributionMode] = 'INTERVENTION_NATIVE';
    canonicalRow[canonicalMap.Confounders] = 'timestamp';
    dirtyRows.push(dirtyHeaders.map((header) => header === 'LegacyNote' ? 'keep' : canonicalRow[canonicalMap[header]]));
  }
}
dirty.ss.sheets['干预观察'] = new FakeSheet(dirtyHeaders, dirtyRows);
const dirtyRepair = dirty.context.repairPittInterventionObservations();
assert.equal(dirtyRepair.observations, 20);
assert.equal(dirty.ss.getSheetByName('干预观察').getLastRow() - 1, 20);
const repairedMap = Object.fromEntries(dirtyHeaders.map((x, i) => [x, i]));
const repairedRows = dirty.ss.getSheetByName('干预观察').rows.slice(1);
const repairSchedule = { D1: '2026-08-25', D3: '2026-08-27', D7: '2026-08-31', D14: '2026-09-07' };
for (const row of repairedRows) {
  const page = new URL(row[repairedMap.PrimaryURL]).pathname;
  assert.equal(row[repairedMap.TargetDate], repairSchedule[row[repairedMap.Horizon]]);
  assert.equal(row[repairedMap.Status], 'WAITING_HORIZON');
  assert.equal(row[repairedMap.AttributionMode], 'INTERVENTION_NATIVE');
  assert.equal(row[repairedMap.ObservedSiteClicks7D], '');
  assert.equal(row[repairedMap.ObservedSiteImpressions7D], '');
  assert.equal(row[repairedMap.Confounders], '');
  assert.equal(row[repairedMap.BaselineSiteClicks7D], 7);
  assert.equal(row[repairedMap.BaselineSiteImpressions7D], 139);
  if (page === '/') {
    assert.equal(row[repairedMap.BaselineClicks7D], 7);
    assert.equal(row[repairedMap.BaselineImpressions7D], 139);
    assert.equal(row[repairedMap.BaselineCTR], 0.05035971223);
    assert.equal(row[repairedMap.BaselinePosition], 7.057553957);
    assert.equal(row[repairedMap.BaselineMode], 'FROZEN_BASELINE');
  } else if (page === '/up-achievement-fuses/' || page === '/200kg-plate/') {
    assert.equal(row[repairedMap.BaselineClicks7D], 0);
    assert.equal(row[repairedMap.BaselineImpressions7D], 0);
    assert.equal(row[repairedMap.BaselineMode], 'EXISTING_URL_NO_GSC_TRAFFIC');
  } else {
    assert.equal(row[repairedMap.BaselineClicks7D], 0);
    assert.equal(row[repairedMap.BaselineImpressions7D], 0);
    assert.equal(row[repairedMap.BaselineMode], 'NEW_URL_BASELINE');
  }
}
assert.equal(dirty.context.repairPittInterventionObservations().repaired, 0);
assert.equal(dirty.ss.getSheetByName('干预观察').getLastRow() - 1, 20);

// Legacy observation functions are retained as compatibility symbols but no
// longer write current canonical rows; the daily finalizer has one receipt
// reconciliation call after legacy maintenance.
const ledgerSource = ledger;
const legacyWriter = ledgerSource.slice(ledgerSource.indexOf('function writeLedgerObservationRows_'), ledgerSource.indexOf('function ledgerObservationDataContext_'));
const legacyRefresh = ledgerSource.slice(ledgerSource.indexOf('function refreshInterventionObservations_'), ledgerSource.indexOf('function ledgerConfounders_'));
assert(!/upsertLedgerObservation_\(/.test(legacyWriter));
assert(!/upsertLedgerObservation_\(/.test(legacyRefresh));
const planPublished = ledgerSource.slice(ledgerSource.indexOf('function planPublishedBatch_'), ledgerSource.indexOf('function resolvePublishedIntervention_'));
assert(!/writeLedgerObservationRows_\(/.test(planPublished));
const maintain = ledgerSource.slice(ledgerSource.indexOf('function maintainExperimentLedger_'), ledgerSource.indexOf('function runExperimentLedgerMaintenance'));
assert(!/reconcileInterventionPipeline\(/.test(maintain));
const codeSource = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
const finalizerStart = codeSource.indexOf('function runDailyFinalizerUnlocked_');
const finalizerEnd = codeSource.indexOf('\nfunction ', finalizerStart + 1);
const finalizer = codeSource.slice(finalizerStart, finalizerEnd < 0 ? codeSource.length : finalizerEnd);
assert.equal((finalizer.match(/runInterventionObservationsUnlocked_\(/g) || []).length, 1);

// Post-deploy ingest: same-day Page rows must not downgrade CONTENT_EXPANSION new URLs
// to EXISTING_URL_NO_GSC_TRAFFIC. Only strict pre-deploy GSC evidence marks a page existing.
const postDeploy = makeContext('2026-09-01');
seedDetailCoverage(postDeploy.ss, 'Project P.I.T.T.', '2026-08-23');
postDeploy.ss.getSheetByName('Page明细').appendRow([
  '2026-09-01', 'Project P.I.T.T.', 'https://pitt.example/maps/', '/maps/', 2, 20, 0.1, 5
]);
const postDeployReceipt = {
  schemaVersion: 'deployment-receipt-v1',
  receiptKey: 'PITT-POST-DEPLOY-CONTENT-EXPANSION',
  interventionId: 'PITT-POST-DEPLOY-CONTENT-EXPANSION',
  siteId: 'project-p-i-t-t',
  siteName: 'Project P.I.T.T.',
  batchId: 'PITT-POST-DEPLOY',
  productionDeployedAt: '2026-09-01T00:00:00+08:00',
  commitSHA: 'b'.repeat(40),
  deploymentURL: 'https://pitt-preview.vercel.app',
  productionURL: 'https://pitt.example/',
  releaseDate: '2026-09-01',
  action: 'CONTENT_EXPANSION',
  affectedPages: [
    {
      path: '/maps/', action: 'CONTENT_EXPANSION', primaryURL: 'https://pitt.example/maps/',
      triggerType: 'site_expansion', triggerQueries: [], triggerSummary: 'new pillar', reason: 'new maps hub'
    },
    {
      path: '/early-access-release-time/', action: 'ADD_INTERNAL_LINK',
      primaryURL: 'https://pitt.example/early-access-release-time/',
      triggerType: 'internal_link', triggerQueries: [], triggerSummary: 'internal links', reason: 'link refresh'
    }
  ]
};
assert.equal(postDeploy.context.ingestDeploymentReceipt(postDeployReceipt).result, 'ACCEPTED');
const postDeployObsHeaders = Object.fromEntries(postDeploy.context.INTERVENTION_OBSERVATION_HEADERS.map((x, i) => [x, i]));
const postDeployObs = postDeploy.ss.getSheetByName('干预观察').rows.slice(1);
const mapsObs = postDeployObs.find((r) => r[postDeployObsHeaders.PrimaryURL].includes('/maps/'));
const linkObs = postDeployObs.find((r) => r[postDeployObsHeaders.PrimaryURL].includes('/early-access-release-time/'));
assert.equal(mapsObs[postDeployObsHeaders.BaselineMode], 'NEW_URL_BASELINE');
assert.equal(linkObs[postDeployObsHeaders.BaselineMode], 'EXISTING_URL_NO_GSC_TRAFFIC');
assert.equal(
  postDeploy.context.resolveDeploymentReceiptPageRole_('CONTENT_EXPANSION', false),
  postDeploy.context.DEPLOYMENT_RECEIPT_PAGE_ROLE.NEW_PAGE
);
assert.equal(
  postDeploy.context.resolveDeploymentReceiptPageRole_('ADD_INTERNAL_LINK', false),
  postDeploy.context.DEPLOYMENT_RECEIPT_PAGE_ROLE.INTERNAL_LINK_ONLY
);
assert.equal(
  postDeploy.context.resolveDeploymentReceiptPageRole_('CONTENT_EXPANSION', false, 'EXISTING_PAGE_UPDATE'),
  postDeploy.context.DEPLOYMENT_RECEIPT_PAGE_ROLE.EXISTING_PAGE_UPDATE
);

// Receipt manifest pageRole must override post-deploy Page rows for the homepage.
const homeRole = makeContext('2026-09-01');
// Coverage rows must not land on the homepage under test, or the page would gain
// window traffic and become EXISTING_URL_BASELINE instead of a proven real zero.
seedDetailCoverage(homeRole.ss, 'Project P.I.T.T.', '2026-08-23', '/coverage-hub/');
homeRole.ss.getSheetByName('Page明细').appendRow([
  '2026-09-01', 'Project P.I.T.T.', 'https://pitt.example/', '/', 5, 50, 0.1, 5
]);
const homeRoleReceipt = {
  schemaVersion: 'deployment-receipt-v1',
  receiptKey: 'PITT-HOME-ROLE-FIXTURE',
  interventionId: 'PITT-HOME-ROLE-FIXTURE',
  siteId: 'project-p-i-t-t',
  siteName: 'Project P.I.T.T.',
  batchId: 'PITT-HOME-ROLE',
  productionDeployedAt: '2026-09-01T00:00:00+08:00',
  commitSHA: 'c'.repeat(40),
  deploymentURL: 'https://pitt-preview.vercel.app',
  productionURL: 'https://pitt.example/',
  releaseDate: '2026-09-01',
  action: 'CONTENT_EXPANSION',
  affectedPages: [{
    path: '/',
    pageRole: 'EXISTING_PAGE_UPDATE',
    action: 'CONTENT_EXPANSION',
    primaryURL: 'https://pitt.example/',
    triggerType: 'site_expansion',
    triggerQueries: [],
    triggerSummary: 'home hub refresh',
    reason: 'existing launch page expanded'
  }]
};
assert.equal(homeRole.context.ingestDeploymentReceipt(homeRoleReceipt).result, 'ACCEPTED');
const homeRoleObsHeaders = Object.fromEntries(homeRole.context.INTERVENTION_OBSERVATION_HEADERS.map((x, i) => [x, i]));
const homeRoleObs = homeRole.ss.getSheetByName('干预观察').rows.slice(1);
assert.equal(homeRoleObs.length, 4);
assert(homeRoleObs.every((r) => r[homeRoleObsHeaders.BaselineMode] === 'EXISTING_URL_NO_GSC_TRAFFIC'));

// Stale/missing detail sources must never become fake zero baselines.
const stale = makeContext('2026-09-04');
// Daily remains current through 08-23, but Page / Query×Page stay empty → stale.
const staleReceipt = {
  schemaVersion: 'deployment-receipt-v1',
  receiptKey: 'PITT-STALE-DETAIL-FIXTURE',
  interventionId: 'PITT-STALE-DETAIL-FIXTURE',
  siteId: 'project-p-i-t-t',
  siteName: 'Project P.I.T.T.',
  batchId: 'PITT-STALE',
  productionDeployedAt: '2026-09-04T00:00:00+08:00',
  commitSHA: 'd'.repeat(40),
  deploymentURL: 'https://pitt-preview.vercel.app',
  productionURL: 'https://pitt.example/',
  releaseDate: '2026-09-04',
  action: 'CONTENT_REFRESH',
  affectedPages: [{
    path: '/early-access-release-time/',
    pageRole: 'EXISTING_PAGE_UPDATE',
    action: 'CONTENT_REFRESH',
    primaryURL: 'https://pitt.example/early-access-release-time/',
    triggerType: 'gsc_ctr_intent',
    triggerQueries: ['project pitt'],
    triggerSummary: 'stale detail guard',
    reason: 'must not fake zero'
  }]
};
const staleLogs = [];
stale.context.writeLog_ = (level, site, message) => {
  staleLogs.push({ level, site, message: String(message || '') });
};
assert.equal(stale.context.ingestDeploymentReceipt(staleReceipt).result, 'ACCEPTED');
const staleObsHeaders = Object.fromEntries(stale.context.INTERVENTION_OBSERVATION_HEADERS.map((x, i) => [x, i]));
const staleObs = stale.ss.getSheetByName('干预观察').rows.slice(1);
assert(staleObs.every((r) => r[staleObsHeaders.BaselineMode] === 'BASELINE_UNKNOWN'));
assert(staleObs.every((r) => r[staleObsHeaders.BaselineClicks7D] === '' || r[staleObsHeaders.BaselineClicks7D] === undefined));
assert(staleObs.every((r) => r[staleObsHeaders.BaselineImpressions7D] === '' || r[staleObsHeaders.BaselineImpressions7D] === undefined));
assert(
  staleLogs.some((entry) => entry.message.indexOf('BASELINE_DETAIL_SOURCE_STALE') >= 0),
  'stale detail source must log BASELINE_DETAIL_SOURCE_STALE'
);
assert(/function deploymentDetailSourceReady_/.test(ledger), 'coverage guard helper exists');
assert(/BASELINE_DETAIL_SOURCE_STALE/.test(ledger), 'stale log marker present');
assert(/function repairContaminatedDeploymentBaselinesSince20260831/.test(ledger), 'contaminated repair entry exists');
assert(/function repairHalloweenCtrIntentOwnershipBaseline/.test(ledger), 'Halloween repair entry exists');

console.log('PASS scripts/test-deployment-receipt-v1.js');
