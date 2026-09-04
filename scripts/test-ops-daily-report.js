/**
 * G028 P1 — 经营日报历史 local acceptance.
 * Run: node scripts/test-ops-daily-report.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var opsSrc = fs.readFileSync(path.join(root, 'OpsDailyReport.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');

function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function ' + name);
  var next = src.indexOf('\nfunction ', start + 1);
  return next >= 0 ? src.slice(start, next) : src.slice(start);
}

// --- 1. Wiring / headers ---
assert(configSrc.indexOf("OPS_DAILY_HISTORY: '经营日报历史'") >= 0, 'sheet name');
assert(configSrc.indexOf('OPS_DAILY_HISTORY_HEADERS') >= 0, 'headers constant');
assert(configSrc.indexOf("GROWTH: '增长'") >= 0, 'ops status growth');
assert(configSrc.indexOf("DECLINE: '衰退'") >= 0, 'ops status decline');
assert(configSrc.indexOf("PAUSE: '暂停投入'") >= 0, 'ops status pause');
assert(sheetSrc.indexOf('SHEET_NAMES.OPS_DAILY_HISTORY') >= 0, 'setup creates ops history');
assert(codeSrc.indexOf('runOpsDailyReportHistory') >= 0, 'menu entry');
assert(codeSrc.indexOf('runOpsDailyReportHistory') < codeSrc.indexOf('runDailyFinalizerUnlocked_') ||
  !/runOpsDailyReportHistory/.test(extractFn(codeSrc, 'runDailyFinalizerUnlocked_')),
  'P1 must not auto-wire into finalizer (P3)');
assert(!/runOpsDailyReportHistory/.test(extractFn(codeSrc, 'runDailyFinalizerUnlocked_')),
  'finalizer does not call ops daily yet');

// --- 2. VM classification + record + idempotent upsert ---
var sandbox = {
  SHEET_NAMES: { OPS_DAILY_HISTORY: '经营日报历史' },
  OPS_DAILY_HISTORY_HEADERS: [
    '日期', 'Site ID', '站点', '游戏阶段', '点击', '曝光', 'CTR', '平均排名',
    '7日趋势', '站点状态', '经营状态', '主要变化', '建议操作', '优先级', '判断原因', '最近修改'
  ],
  OPS_STATUS: { GROWTH: '增长', STABLE: '稳定', DECLINE: '衰退', PAUSE: '暂停投入' },
  OPS_TREND_GROWTH_MIN: 1.2,
  OPS_TREND_DECLINE_MAX: 0.8,
  INVESTMENT_TIER: { FROZEN: 'FROZEN' },
  PORTFOLIO_ACTION: { FREEZE: 'FREEZE' },
  console: console,
  Logger: { log: function () {} },
  writeLog_: function () {}
};

function normalizeKeyDate_(v) {
  if (!v) return '';
  return String(v).substring(0, 10);
}
sandbox.normalizeKeyDate_ = normalizeKeyDate_;
sandbox.todayStr_ = function () { return '2026-09-04'; };

vm.createContext(sandbox);
vm.runInContext(
  'function ensureOpsDailyHistorySheet_() {}\n' +
    'function loadOpsContentUpdatesBySite_() { return {}; }\n' +
    extractFn(opsSrc, 'formatOpsGrowth_') +
    extractFn(opsSrc, 'formatOpsTrend7d_') +
    extractFn(opsSrc, 'isOpsIndexAuditKnown_') +
    extractFn(opsSrc, 'isOpsRealtimeIncomplete_') +
    extractFn(opsSrc, 'classifyOpsStatus_') +
    extractFn(opsSrc, 'buildOpsMainChange_') +
    extractFn(opsSrc, 'blankableNumber_') +
    extractFn(opsSrc, 'buildOpsDailyRecord_') +
    extractFn(opsSrc, 'opsDailyHistoryRow_') +
    extractFn(opsSrc, 'runOpsDailyReportHistory_'),
  sandbox
);

var growth = sandbox.classifyOpsStatus_({ hasGrowth: true, growth3d: 1.5 });
assert(growth.status === '增长', 'growth status');

var stable = sandbox.classifyOpsStatus_({ hasGrowth: true, growth3d: 1.0 });
assert(stable.status === '稳定', 'stable status');

var decline = sandbox.classifyOpsStatus_({ hasGrowth: true, growth3d: 0.5 });
assert(decline.status === '衰退', 'decline status');

var noTrend = sandbox.classifyOpsStatus_({
  hasGrowth: false,
  realtimeIncomplete: true,
  realtimeClickGrowth: -0.8
});
assert(noTrend.status === '稳定', 'incomplete realtime must not force decline');
assert(noTrend.reason.indexOf('realtime') >= 0, 'reason mentions realtime guard');

var pause = sandbox.classifyOpsStatus_({
  investmentTier: 'FROZEN',
  hasGrowth: true,
  growth3d: 0.4
});
assert(pause.status === '暂停投入', 'frozen → pause');

var archivePause = sandbox.classifyOpsStatus_({
  recommendedAction: 'ARCHIVE',
  hasGrowth: true,
  growth3d: 2
});
assert(archivePause.status === '暂停投入', 'ARCHIVE → pause');

var main = sandbox.buildOpsMainChange_({
  hasGrowth: false,
  indexKnown: false,
  realtimeIncomplete: true,
  recommendedAction: 'WAIT'
});
assert(main.indexOf('索引审计暂缺') >= 0, 'notes missing index without anomaly');
assert(main.indexOf('不触发低索引异常') >= 0, 'explicitly avoids low-index false positive');
assert(!/触发低索引异常(?!）)/.test(main.replace('不触发低索引异常', '')), 'must not invent low-index anomaly');
assert(main.indexOf('realtime 未完整') >= 0, 'notes incomplete realtime');

var record = sandbox.buildOpsDailyRecord_({
  reportDate: '2026-09-04',
  site: { name: 'Brigandine Abyss', siteId: 'brigandine-abyss' },
  snapshot: [
    '2026-09-04', '2026-09-02', 'Brigandine Abyss', 'sc-domain:x', 7,
    10, '', '', 120, 5, 0.041, 18.2
  ],
  siteStatus: {
    lifecycleStage: 'TRACTION',
    recommendedAction: 'CONTENT_OPTIMIZE',
    priority: 'P2',
    indexedCount: null,
    hasGrowth: true,
    growth3d: 1.4
  },
  portfolio: { investmentTier: 'T1_TRACTION', portfolioAction: 'HOLD' },
  fresh: { dataIncomplete: true, clickGrowthRate: -0.9, impressionGrowthRate: -0.5 },
  lastContentUpdate: { date: '2026-09-01', lifecyclePhase: 'WEEK1' }
});
assert(record.opsStatus === '增长', 'record uses formal growth despite realtime drop');
assert(record.gameStage === 'WEEK1', 'game stage from content update when present');
assert(record.clicks === 5, 'clicks from snapshot');
assert(record.impressions === 120, 'impressions from snapshot');
assert(record.mainChange.indexOf('低索引') < 0 || record.mainChange.indexOf('不触发低索引异常') >= 0,
  'null IndexedURLCount does not trigger low-index anomaly');
assert(record.reason.indexOf('正式3日曝光增长') >= 0, 'reason from formal trend');

var store = [];
function fakeUpsert(row) {
  var key = normalizeKeyDate_(row[0]) + '||' + String(row[1] || '').trim();
  for (var i = 0; i < store.length; i++) {
    var existingKey = normalizeKeyDate_(store[i][0]) + '||' + String(store[i][1] || '').trim();
    if (existingKey === key) {
      store[i] = row;
      return { action: 'update', rowIndex: i + 2 };
    }
  }
  store.push(row);
  return { action: 'insert', rowIndex: store.length + 1 };
}

var sites = [
  { name: 'Brigandine Abyss', siteId: 'brigandine-abyss' },
  { name: 'Project P.I.T.T.', siteId: 'project-p-i-t-t' },
  { name: 'No Id Site', siteId: '' }
];
var snapshotBySite = {
  'Brigandine Abyss': [
    '2026-09-04', '2026-09-02', 'Brigandine Abyss', 'u', 7, 10, 3, 0.3, 200, 8, 0.04, 12
  ],
  'Project P.I.T.T.': [
    '2026-09-04', '2026-09-02', 'Project P.I.T.T.', 'u', 9, 20, '', '', 50, 1, 0.02, 40
  ]
};
var siteStatusBySite = {
  'Brigandine Abyss': {
    lifecycleStage: 'TRACTION',
    recommendedAction: 'WAIT',
    priority: 'P3',
    indexedCount: 3,
    hasGrowth: true,
    growth3d: 1.6
  },
  'Project P.I.T.T.': {
    lifecycleStage: 'LOW_SIGNAL',
    recommendedAction: 'ARCHIVE',
    priority: 'P3',
    indexedCount: null,
    hasGrowth: true,
    growth3d: 0.4
  }
};
var portfolioBySite = {
  'Brigandine Abyss': { investmentTier: 'T1_TRACTION', portfolioAction: 'HOLD' },
  'Project P.I.T.T.': { investmentTier: 'FROZEN', portfolioAction: 'FREEZE' }
};

var first = sandbox.runOpsDailyReportHistory_('2026-09-04', {
  sites: sites,
  snapshotBySite: snapshotBySite,
  siteStatusBySite: siteStatusBySite,
  portfolioBySite: portfolioBySite,
  freshBySite: {},
  contentUpdates: {},
  upsert: fakeUpsert
});
assert(first.written === 2, 'writes enabled sites with site_id');
assert(first.skipped === 1, 'skips missing site_id');
assert(first.inserted === 2, 'first run inserts');
assert(first.byStatus['增长'] === 1, 'one growth');
assert(first.byStatus['暂停投入'] === 1, 'one pause');
assert(store.length === 2, 'two history rows');

var second = sandbox.runOpsDailyReportHistory_('2026-09-04', {
  sites: sites,
  snapshotBySite: snapshotBySite,
  siteStatusBySite: siteStatusBySite,
  portfolioBySite: portfolioBySite,
  freshBySite: {},
  contentUpdates: {},
  upsert: fakeUpsert
});
assert(second.updated === 2, 'rerun updates same date+site_id');
assert(second.inserted === 0, 'rerun inserts none');
assert(store.length === 2, 'idempotent: no duplicate rows');

console.log('PASS scripts/test-ops-daily-report.js');
