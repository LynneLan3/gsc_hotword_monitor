/**
 * End-to-end local mock of the runFreshQueryMonitor entry path.
 * Covers multi-property merging, rolling cutoff, top-N snapshots, and the
 * header-addressed daily/realtime coexistence contract.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
const utils = fs.readFileSync(path.join(root, 'Utils.gs'), 'utf8');
const fresh = fs.readFileSync(path.join(root, 'FreshQueryMonitor.gs'), 'utf8');
const decision = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');

class FakeSheet {
  constructor(headers) { this.rows = [headers.slice()]; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows[0].length; }
  getMaxRows() { return Math.max(100, this.rows.length); }
  getMaxColumns() { return Math.max(26, this.rows[0].length); }
  insertColumnsAfter(_col, count) { this.rows.forEach((row) => { for (let i = 0; i < count; i++) row.push(''); }); }
  insertRowsAfter(_row, count) { for (let i = 0; i < count; i++) this.rows.push(Array(this.rows[0].length).fill('')); }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    return {
      getValues() { return Array.from({ length: numRows }, (_, r) => Array.from({ length: numCols }, (_, c) => (sheet.rows[row - 1 + r] || [])[col - 1 + c] || '')); },
      setValues(values) {
        values.forEach((source, r) => {
          while (sheet.rows.length < row + r) sheet.rows.push(Array(sheet.rows[0].length).fill(''));
          while (sheet.rows[row - 1 + r].length < col - 1 + source.length) sheet.rows[row - 1 + r].push('');
          source.forEach((value, c) => { sheet.rows[row - 1 + r][col - 1 + c] = value; });
        });
      },
      clearContent() { for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) sheet.rows[row - 1 + r][col - 1 + c] = ''; },
      setFontWeight() {}
    };
  }
}

function hour(offset) { return new Date(Date.UTC(2026, 8, 1, 0) + offset * 3600000).toISOString(); }
function hrow(offset, clicks, impressions, position, extra) {
  return Object.assign({ hour: hour(offset), hourMs: Date.parse(hour(offset)), clicks, impressions, position }, extra || {});
}
function propertyData(property, siteSeed, pageCount) {
  const totals = [hrow(24, 1, 10, 9), hrow(25, 4, 40, 7), hrow(48, 6, 60, 5)];
  const query = [
    hrow(24, 0, 2, 9, { query: siteSeed + ' guide', page: property + 'old/' }),
    hrow(25, 1, 5, 7, { query: siteSeed + ' guide', page: property + 'guide/' }),
    hrow(48, 2, 15, 5, { query: siteSeed + ' guide', page: property + 'guide/' })
  ];
  const pages = [hrow(24, 0, 2, 9, { page: property + 'old/' })];
  for (let i = 0; i < pageCount; i++) {
    pages.push(hrow(48, i + 1, 100 - i, 4 + i / 10, { page: property + 'page-' + i + '/' }));
  }
  return { totals, query, pages };
}

const pitt = 'https://pitt.example/';
const serious = 'https://serious.example/';
const halloweenNew = 'https://www.halloweengameguide.wiki/';
const halloweenOld = 'https://halloween-the-game-guide.vercel.app/';
const fixtures = {
  [pitt]: propertyData(pitt, 'project pitt', 2),
  [serious]: propertyData(serious, 'serious sam', 35),
  [halloweenNew]: propertyData(halloweenNew, 'halloween game', 2),
  [halloweenOld]: propertyData(halloweenOld, 'halloween game', 2)
};

const sheets = {};
const context = { console, Date, Math, JSON, Object, String, Number, Array, RegExp };
vm.createContext(context);
vm.runInContext(config, context);
vm.runInContext(utils, context);
context.getSpreadsheet_ = () => ({ getSheetByName: (name) => sheets[name] || null });
context.ensureSheet_ = (name, headers) => sheets[name] || (sheets[name] = new FakeSheet(headers));
context.ensureSheetGrid_ = (sheet, rows, cols) => {
  while (sheet.rows.length < rows) sheet.rows.push(Array(sheet.rows[0].length).fill(''));
  while (sheet.rows[0].length < cols) sheet.rows.forEach((row) => row.push(''));
};
context.ensureSheetHeaders_ = (sheet, headers) => {
  const header = sheet.rows[0];
  headers.forEach((name) => { if (!header.includes(name)) header.push(name); });
  sheet.rows.forEach((row) => { while (row.length < header.length) row.push(''); });
  return header.slice();
};
context.sheetHeaderIndexMap_ = (headers) => Object.fromEntries(headers.map((name, index) => [name, index]));
context.getEnabledSites = () => [
  { name: 'Project P.I.T.T.', propertyUrl: pitt, day0: '2026-08-31' },
  { name: 'Serious Sam', propertyUrl: serious, day0: '2026-08-31' },
  { name: 'Halloween: The Game', propertyUrl: halloweenNew, realtimePropertyUrls: halloweenNew + '|' + halloweenOld, day0: '2026-08-31' }
];
context.getFreshQueryHourlyDateRange_ = () => ({ startDate: '2026-08-30', endDate: '2026-09-02' });
context.normalizePropertyUrlForGsc_ = (value) => value;
context.fetchHourlySiteTotalsResult_ = (property) => ({ rows: fixtures[property].totals, metadata: null });
context.fetchHourlyQueryPagesResult_ = (property) => ({ rows: fixtures[property].query, metadata: property === halloweenOld ? { firstIncompleteHour: hour(48) } : null });
context.fetchHourlyPagesResult_ = (property) => ({ rows: fixtures[property].pages, metadata: null });
context.matchGuideIntentCategories_ = (query) => /guide/.test(query) ? ['GUIDE'] : [];
context.calcDayNumber_ = () => 1;
context.toDateStr_ = () => '2026-09-01';
context.writeLog_ = () => {};
context.alertUi_ = () => {};
context.Logger = { log() {} };
vm.runInContext(fresh, context);
vm.runInContext(decision, context);
context.getFreshQueryHourlyDateRange_ = () => ({ startDate: '2026-08-30', endDate: '2026-09-02' });
context.getDecisionRules_ = () => ({
  EARLY_SIGNAL_MAX_DAY: 3, EARLY_WINNER_MIN_24H_IMPRESSIONS: 100,
  EARLY_WINNER_MIN_CLICKS: 1, EARLY_WINNER_MIN_GUIDE_QUERIES: 2,
  EARLY_TOP20_MIN_QUERIES: 2, EARLY_TOP10_MIN_QUERIES: 2,
  EARLY_MIN_INTENT_CLUSTERS: 2, EARLY_WATCH_MIN_IMPRESSIONS: 10,
  EARLY_DOWNGRADE_CONFIRM_RUNS: 2, EARLY_SIGNAL_COOLDOWN_HOURS: 12
});

const summary = context.runFreshQueryMonitorUnlocked_();
assert.match(summary, /sites=3/);
const read = (sheetName) => {
  const sheet = sheets[sheetName];
  const map = Object.fromEntries(sheet.rows[0].map((name, index) => [name, index]));
  return { map, rows: sheet.rows.slice(1).filter((row) => row.some((v) => v !== '')) };
};
const site = read('实时站点监控');
const query = read('实时Query监控');
const page = read('实时Page监控');
const status = read('站点状态');
const pittRow = site.rows.find((row) => row[site.map['站点']] === 'Project P.I.T.T.');
const halloweenRow = site.rows.find((row) => row[site.map['站点']] === 'Halloween: The Game');
assert.equal(pittRow[site.map['近24小时展现']], 100, 'site total comes from total endpoint, not 20 query impressions');
assert.equal(pittRow[site.map['前24小时展现']], 10, 'previous window includes cutoff-24h boundary');
assert.equal(pittRow[site.map['展现增长率']], 9, 'rolling current/previous growth uses returned-hour cutoff');
assert.equal(halloweenRow[site.map['近24小时展现']], 200, 'Halloween totals merge both properties');
assert.equal(halloweenRow[site.map['数据是否未完全']], '是', 'incomplete property is retained');
assert.equal(halloweenRow[site.map['数据截止小时']], hour(48), 'cutoff comes from actual latest returned hour');
const halloweenQuery = query.rows.find((row) => row[query.map['站点']] === 'Halloween: The Game');
assert.equal(halloweenQuery[query.map['近24小时展现']], 40, 'same query merges two properties');
assert.match(halloweenQuery[query.map['Property来源']], /halloweengameguide/);
assert.match(halloweenQuery[query.map['Property来源']], /vercel/);
assert.equal(page.rows.filter((row) => row[page.map['站点']] === 'Serious Sam').length, 30, 'Page snapshot is Top30');
assert.equal(
  page.rows.find((row) => row[page.map['页面URL']] === serious + 'page-0/')[page.map['页面路径']],
  '/page-0',
  'Page path is parsed without relying on browser URL globals'
);
const halloweenPageSources = page.rows
  .filter((row) => row[page.map['站点']] === 'Halloween: The Game')
  .map((row) => row[page.map['Property来源']]);
assert(halloweenPageSources.includes(halloweenNew) && halloweenPageSources.includes(halloweenOld), 'Pages preserve both property provenance values');
const pittStatus = status.rows.find((row) => row[status.map.Site] === 'Project P.I.T.T.');
assert.equal(pittStatus[status.map.RealtimeImpressions24H], 100, 'realtime status written');
assert.equal(pittStatus[status.map.EarlySignalStatus], 'WATCH', 'existing early signal rule runs');

// Daily writer may set its Decision fields but cannot clear realtime state.
const dailyRow = Array(27).fill('');
dailyRow[0] = '2026-09-01'; dailyRow[1] = 'Project P.I.T.T.'; dailyRow[24] = 'WAIT';
context.writeDecisionSiteStatusRows_([dailyRow]);
const afterDaily = read('站点状态').rows.find((row) => row[status.map.Site] === 'Project P.I.T.T.');
assert.equal(afterDaily[status.map.RealtimeImpressions24H], 100, 'daily writer preserves realtime fields');
assert.equal(afterDaily[status.map.EarlySignalStatus], 'WATCH', 'daily WAIT does not erase effective realtime state');

console.log(JSON.stringify({
  pitt24h: pittRow[site.map['近24小时展现']],
  halloween24h: halloweenRow[site.map['近24小时展现']],
  seriousPages: page.rows.filter((row) => row[page.map['站点']] === 'Serious Sam').length,
  cutoff: halloweenRow[site.map['数据截止小时']],
  pittTopQuery: query.rows.find((row) => row[query.map['站点']] === 'Project P.I.T.T.')[query.map['搜索词']],
  pittTopPage: page.rows.find((row) => row[page.map['站点']] === 'Project P.I.T.T.')[page.map['页面URL']],
  seriousTopQuery: query.rows.find((row) => row[query.map['站点']] === 'Serious Sam')[query.map['搜索词']],
  seriousTopPage: page.rows.find((row) => row[page.map['站点']] === 'Serious Sam')[page.map['页面URL']]
}, null, 2));
console.log('PASS scripts/test-realtime-rolling-monitor.js');
