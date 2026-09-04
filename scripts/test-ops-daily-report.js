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
assert(configSrc.indexOf('OPS_TREND_GROWTH_PCT_MIN') >= 0, 'pct growth threshold');
assert(configSrc.indexOf('OPS_TREND_MIN_WINDOW_IMPRESSIONS') >= 0, 'min window impressions');
assert(!/OPS_TREND_GROWTH_MIN\s*=\s*1\.2/.test(configSrc), 'old multiplier thresholds removed');
assert(sheetSrc.indexOf('SHEET_NAMES.OPS_DAILY_HISTORY') >= 0, 'setup creates ops history');
assert(codeSrc.indexOf('runOpsDailyReportHistory') >= 0, 'menu entry');
assert(!/runOpsDailyReportHistory/.test(extractFn(codeSrc, 'runDailyFinalizerUnlocked_')),
  'finalizer does not call ops daily yet');
assert(opsSrc.indexOf('computeOpsSiteTrendFromDaily_') >= 0, 'daily trend helper');
assert(opsSrc.indexOf('Growth3D') < 0 || opsSrc.indexOf('never stale Growth3D') >= 0,
  'must not rely on stale Growth3D for classification');
assert(!/status\.growth3d|status\.hasGrowth/.test(opsSrc), 'record builder ignores status Growth3D');

// --- 2. VM ---
var sandbox = {
  SHEET_NAMES: { OPS_DAILY_HISTORY: '经营日报历史' },
  OPS_DAILY_HISTORY_HEADERS: [
    '日期', 'Site ID', '站点', '游戏阶段', '点击', '曝光', 'CTR', '平均排名',
    '7日趋势', '站点状态', '经营状态', '主要变化', '建议操作', '优先级', '判断原因', '最近修改'
  ],
  OPS_STATUS: { GROWTH: '增长', STABLE: '稳定', DECLINE: '衰退', PAUSE: '暂停投入' },
  OPS_TREND_GROWTH_PCT_MIN: 25,
  OPS_TREND_DECLINE_PCT_MAX: -25,
  OPS_TREND_MIN_WINDOW_IMPRESSIONS: 50,
  OPS_TREND_MIN_7D_IMPRESSIONS: 80,
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
function addDaysStr_(yyyyMmDd, deltaDays) {
  var p = String(yyyyMmDd).split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2]);
  d.setDate(d.getDate() + Number(deltaDays || 0));
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}
function latestDateInRows_(rows, dateCol) {
  var latest = '';
  for (var i = 0; i < (rows || []).length; i++) {
    var d = normalizeKeyDate_(rows[i][dateCol]);
    if (d && d > latest) latest = d;
  }
  return latest;
}

sandbox.normalizeKeyDate_ = normalizeKeyDate_;
sandbox.todayStr_ = function () { return '2026-09-04'; };
sandbox.addDaysStr_ = addDaysStr_;
sandbox.latestDateInRows_ = latestDateInRows_;

vm.createContext(sandbox);
vm.runInContext(
  'function ensureOpsDailyHistorySheet_() {}\n' +
    'function loadOpsContentUpdatesBySite_() { return {}; }\n' +
    'function loadDailyRowsBySite_() { return {}; }\n' +
    extractFn(opsSrc, 'computeOpsSiteTrendFromDaily_') +
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

function dailyRow(date, impressions, clicks) {
  return [date, 'Site', clicks || 0, impressions];
}

// Mortal Shell II style: recent clear decline (not the stale 144x Growth3D spike).
var ms2Daily = [
  dailyRow('2026-08-26', 5908, 61),
  dailyRow('2026-08-27', 3215, 41),
  dailyRow('2026-08-28', 1796, 23),
  dailyRow('2026-08-29', 1512, 18),
  dailyRow('2026-08-30', 1270, 3),
  dailyRow('2026-08-31', 894, 4),
  dailyRow('2026-09-01', 664, 4)
];
var ms2Trend = sandbox.computeOpsSiteTrendFromDaily_(ms2Daily);
assert(ms2Trend.ok, 'MS2 trend computable');
assert(ms2Trend.endDate === '2026-09-01', 'MS2 uses latest daily date');
assert(ms2Trend.pctChange < -25, 'MS2 recent down');
assert(ms2Trend.label.indexOf('下降') === 0, 'MS2 label is 下降 %');
assert(ms2Trend.label.indexOf('x') < 0, 'no multiplier in label');
var ms2Class = sandbox.classifyOpsStatus_({ trend: ms2Trend });
assert(ms2Class.status === '衰退', 'MS2 → 衰退');

// Agefield style: tiny volumes → 稳定 even if ratio looks down.
var ageDaily = [
  dailyRow('2026-08-26', 30, 4),
  dailyRow('2026-08-27', 20, 5),
  dailyRow('2026-08-28', 15, 3),
  dailyRow('2026-08-29', 15, 5),
  dailyRow('2026-08-30', 14, 2),
  dailyRow('2026-08-31', 6, 1),
  dailyRow('2026-09-01', 13, 5)
];
var ageTrend = sandbox.computeOpsSiteTrendFromDaily_(ageDaily);
assert(!ageTrend.ok, 'Agefield sample insufficient');
assert(ageTrend.label === '样本不足', 'Agefield trend label');
var ageClass = sandbox.classifyOpsStatus_({ trend: ageTrend });
assert(ageClass.status === '稳定', 'Agefield → 稳定 not 衰退');

// Clear growth with enough volume.
var growthTrend = sandbox.computeOpsSiteTrendFromDaily_([
  dailyRow('2026-08-26', 100),
  dailyRow('2026-08-27', 100),
  dailyRow('2026-08-28', 100),
  dailyRow('2026-08-29', 100),
  dailyRow('2026-08-30', 160),
  dailyRow('2026-08-31', 170),
  dailyRow('2026-09-01', 180)
]);
assert(growthTrend.ok && growthTrend.pctChange >= 25, 'growth pct');
assert(sandbox.classifyOpsStatus_({ trend: growthTrend }).status === '增长', 'growth status');

// Mild move → 稳定
var mild = sandbox.computeOpsSiteTrendFromDaily_([
  dailyRow('2026-08-26', 100),
  dailyRow('2026-08-27', 100),
  dailyRow('2026-08-28', 100),
  dailyRow('2026-08-29', 100),
  dailyRow('2026-08-30', 105),
  dailyRow('2026-08-31', 110),
  dailyRow('2026-09-01', 100)
]);
assert(sandbox.classifyOpsStatus_({ trend: mild }).status === '稳定', 'mild → stable');

var noTrend = sandbox.classifyOpsStatus_({
  trend: { ok: false, reason: '样本不足', label: '样本不足' },
  realtimeIncomplete: true
});
assert(noTrend.status === '稳定', 'incomplete realtime must not force decline');
assert(noTrend.reason.indexOf('realtime') >= 0, 'reason mentions realtime guard');

assert(
  sandbox.classifyOpsStatus_({
    investmentTier: 'FROZEN',
    trend: ms2Trend
  }).status === '暂停投入',
  'frozen → pause'
);
assert(
  sandbox.classifyOpsStatus_({
    recommendedAction: 'ARCHIVE',
    trend: growthTrend
  }).status === '暂停投入',
  'ARCHIVE → pause'
);

var main = sandbox.buildOpsMainChange_({
  trend: ageTrend,
  trend7d: ageTrend.label,
  indexKnown: false,
  realtimeIncomplete: true,
  recommendedAction: 'WAIT'
});
assert(main.indexOf('样本不足') >= 0, 'main change uses trend label');
assert(main.indexOf('不触发低索引异常') >= 0, 'index null guard');

var record = sandbox.buildOpsDailyRecord_({
  reportDate: '2026-09-04',
  site: { name: 'Mortal Shell II', siteId: 'mortal-shell-ii' },
  snapshot: [
    '2026-09-04', '2026-09-01', 'Mortal Shell II', 'u', 7,
    10, '', '', 664, 4, 0.006, 8.4
  ],
  siteStatus: {
    lifecycleStage: 'DOMAIN_READY',
    recommendedAction: 'DOMAIN_UPGRADE',
    priority: 'P0',
    indexedCount: 10,
    // Stale status Growth3D must be ignored if present.
    hasGrowth: true,
    growth3d: 144.99
  },
  portfolio: { investmentTier: 'T2_WINNER', portfolioAction: 'INVEST' },
  fresh: { dataIncomplete: true, clickGrowthRate: -0.9 },
  dailyRows: ms2Daily,
  lastContentUpdate: { date: '2026-09-03', lifecyclePhase: 'PUBLISHED' }
});
assert(record.opsStatus === '衰退', 'MS2 record ignores stale 144x Growth3D');
assert(record.trend7d.indexOf('下降') === 0, 'MS2 trend7d is direction %');
assert(record.trend7d.indexOf('x') < 0, 'no x multiplier');
assert(record.gameStage === 'PUBLISHED', 'game stage preserved');

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
  { name: 'Mortal Shell II', siteId: 'mortal-shell-ii' },
  { name: 'Agefield High: Rock the School', siteId: 'agefield-high-rock-the-school' },
  { name: 'No Id Site', siteId: '' }
];
var first = sandbox.runOpsDailyReportHistory_('2026-09-04', {
  sites: sites,
  snapshotBySite: {
    'Mortal Shell II': [
      '2026-09-04', '2026-09-01', 'Mortal Shell II', 'u', 7, 10, 3, 0.3, 664, 4, 0.006, 8
    ],
    'Agefield High: Rock the School': [
      '2026-09-04', '2026-09-01', 'Agefield', 'u', 7, 10, '', '', 13, 5, 0.38, 4
    ]
  },
  siteStatusBySite: {
    'Mortal Shell II': {
      lifecycleStage: 'DOMAIN_READY',
      recommendedAction: 'DOMAIN_UPGRADE',
      priority: 'P0',
      indexedCount: 10
    },
    'Agefield High: Rock the School': {
      lifecycleStage: 'INDEX_CHECK',
      recommendedAction: 'CHECK_INDEX',
      priority: 'P0',
      indexedCount: 6
    }
  },
  portfolioBySite: {
    'Mortal Shell II': { investmentTier: 'T2_WINNER', portfolioAction: 'INVEST' },
    'Agefield High: Rock the School': { investmentTier: 'T1_TRACTION', portfolioAction: 'HOLD' }
  },
  freshBySite: {},
  contentUpdates: {},
  dailyBySite: {
    'Mortal Shell II': ms2Daily,
    'Agefield High: Rock the School': ageDaily
  },
  upsert: fakeUpsert
});
assert(first.written === 2, 'writes 2');
assert(first.skipped === 1, 'skips missing site_id');
assert(first.byStatus['衰退'] === 1, 'MS2 decline');
assert(first.byStatus['稳定'] === 1, 'Agefield stable');
assert(store[0][8].indexOf('下降') === 0, 'history trend column is direction');
assert(store[1][8] === '样本不足' || store[1][10] === '稳定', 'Agefield stable/sample');

var second = sandbox.runOpsDailyReportHistory_('2026-09-04', {
  sites: sites,
  snapshotBySite: {},
  siteStatusBySite: {},
  portfolioBySite: {
    'Mortal Shell II': { investmentTier: 'T2_WINNER', portfolioAction: 'INVEST' },
    'Agefield High: Rock the School': { investmentTier: 'T1_TRACTION', portfolioAction: 'HOLD' }
  },
  freshBySite: {},
  contentUpdates: {},
  dailyBySite: {
    'Mortal Shell II': ms2Daily,
    'Agefield High: Rock the School': ageDaily
  },
  upsert: fakeUpsert
});
assert(second.updated === 2 && second.inserted === 0, 'idempotent update');
assert(store.length === 2, 'no duplicate rows');

console.log('PASS scripts/test-ops-daily-report.js');
