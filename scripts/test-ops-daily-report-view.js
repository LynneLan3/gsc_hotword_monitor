/**
 * G028 P2 — 站点经营日报 local acceptance.
 * Run: node scripts/test-ops-daily-report-view.js
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
var viewSrc = fs.readFileSync(path.join(root, 'OpsDailyView.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');
var opsSrc = fs.readFileSync(path.join(root, 'OpsDailyReport.gs'), 'utf8');

function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function ' + name);
  var next = src.indexOf('\nfunction ', start + 1);
  return next >= 0 ? src.slice(start, next) : src.slice(start);
}

assert(configSrc.indexOf("OPS_DAILY_REPORT: '站点经营日报'") >= 0, 'sheet name');
assert(configSrc.indexOf('OPS_DAILY_ACTION_LIMIT') >= 0, 'action limit');
assert(configSrc.indexOf("EXECUTE: '建议执行'") >= 0, 'judgment enum');
assert(sheetSrc.indexOf('SHEET_NAMES.OPS_DAILY_REPORT') >= 0, 'setup ensures report sheet');
assert(codeSrc.indexOf('runOpsDailyReport') >= 0, 'menu entry');
assert(/runOpsDailyPipelineSafe_/.test(extractFn(codeSrc, 'runDailyFinalizerUnlocked_')),
  'P2 reached via ops pipeline in finalizer');
assert(viewSrc.indexOf('selectOpsDailyActions_') >= 0, 'selector present');
assert(opsSrc.indexOf('computeOpsSiteTrendFromDaily_') >= 0, 'P1 trend helper untouched');
assert(opsSrc.indexOf('runOpsDailyReportHistory_') >= 0 && opsSrc.indexOf('runOpsDailyReport_') >= 0,
  'pipeline invokes P1 then P2');
var pipelineSrc = extractFn(opsSrc, 'runOpsDailyPipelineSafe_');
assert(pipelineSrc.indexOf('runOpsDailyReportHistory_') < pipelineSrc.indexOf('runOpsDailyReport_'),
  'P1 before P2 in pipeline');
assert(/OPS_DAILY_HISTORY_FAILED|OPS_DAILY_REPORT_FAILED/.test(pipelineSrc),
  'pipeline logs step failures');
assert(!/throw /.test(pipelineSrc.replace(/\/\*[\s\S]*?\*\//g, '')),
  'pipeline does not rethrow');

var sandbox = {
  OPS_STATUS: { GROWTH: '增长', STABLE: '稳定', DECLINE: '衰退', PAUSE: '暂停投入' },
  OPS_JUDGMENT: {
    EXECUTE: '建议执行',
    WATCH: '继续观察',
    NONE: '无需操作',
    PAUSE: '暂停投入'
  },
  OPS_EXECUTE_ACTION: {
    NEW_PAGE: '新增页面',
    UPDATE_PAGE: '更新页面',
    TECH_FIX: '技术修复'
  },
  OPS_DAILY_ACTION_LIMIT: 3,
  OPS_ACTION_MIN_QUERY_IMPRESSIONS: 10,
  OPS_ACTION_RANK_MIN: 4,
  OPS_ACTION_RANK_MAX: 20,
  OPS_DAILY_ACTION_HEADERS: [
    '优先级', '站点', '建议操作', '目标 Query 或页面', '为什么现在做', '核心数据证据'
  ],
  OPS_DAILY_SITE_HEADERS: [
    '站点', '游戏阶段', '经营状态', '7日趋势', '点击', '曝光', '平均排名', '主要变化', '今日判断'
  ],
  SHEET_NAMES: { OPS_DAILY_REPORT: '站点经营日报' },
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
sandbox.addDaysStr_ = addDaysStr_;
sandbox.latestDateInRows_ = latestDateInRows_;

vm.createContext(sandbox);
sandbox.OPS_TECH_EVIDENCE_MAX_AGE_DAYS = 14;
sandbox.todayStr_ = function () { return '2026-09-04'; };
vm.runInContext(
  extractFn(viewSrc, 'emptyOpsStatusCounts_') +
    extractFn(viewSrc, 'extractOpsGscCutoff_') +
    extractFn(viewSrc, 'mapOpsExecuteAction_') +
    extractFn(viewSrc, 'isOpsActionPriorityEligible_') +
    extractFn(viewSrc, 'normalizeOpsActionPriority_') +
    extractFn(viewSrc, 'opsPriorityRank_') +
    extractFn(viewSrc, 'evaluateOpsCurrentTechIssue_') +
    extractFn(viewSrc, 'findBestOpsOpportunityForSite_') +
    extractFn(viewSrc, 'findBestOpsQueryEvidence_') +
    extractFn(viewSrc, 'findBestOpsPageEvidence_') +
    extractFn(viewSrc, 'findOpsActionEvidence_') +
    extractFn(viewSrc, 'buildOpsActionWhyNow_') +
    extractFn(viewSrc, 'buildOpsActionEvidenceText_') +
    extractFn(viewSrc, 'decideOpsTodayJudgment_') +
    extractFn(viewSrc, 'selectOpsDailyActions_') +
    extractFn(viewSrc, 'runOpsDailyReport_'),
  sandbox
);

assert(sandbox.mapOpsExecuteAction_('CHECK_INDEX', '增长') === '技术修复', 'tech map');
assert(sandbox.mapOpsExecuteAction_('CONTENT_EXPAND', '衰退') === '', 'decline no new page');
assert(sandbox.mapOpsExecuteAction_('CONTENT_OPTIMIZE', '衰退') === '', 'decline no update');
assert(sandbox.mapOpsExecuteAction_('DOMAIN_UPGRADE', '增长') === '', 'domain not in allowed');
assert(sandbox.mapOpsExecuteAction_('WAIT', '稳定') === '', 'wait excluded');

assert(sandbox.decideOpsTodayJudgment_({ opsStatus: '衰退' }, false) === '无需操作', 'decline none');
assert(sandbox.decideOpsTodayJudgment_({ opsStatus: '暂停投入' }, false) === '暂停投入', 'pause');
assert(sandbox.decideOpsTodayJudgment_({ opsStatus: '增长' }, true) === '建议执行', 'selected');
assert(sandbox.decideOpsTodayJudgment_({ opsStatus: '稳定', suggestedAction: 'WAIT' }, false) === '继续观察',
  'watch');

var rules = { INDEX_RATE_WARNING: 0.5, DOMAIN_MIN_INDEXED_URLS: 2 };

// Current evidence validation (do not trust stale CHECK_INDEX label alone).
var brigTech = sandbox.evaluateOpsCurrentTechIssue_(
  {
    sitemapCount: 26,
    indexedCount: null,
    indexRate: null,
    auditDate: '',
    source: ''
  },
  rules,
  '2026-09-04'
);
assert(!brigTech.ok, 'Brigandine null indexed → no tech');
assert(brigTech.reason.indexOf('null') >= 0 || brigTech.reason.indexOf('缺失') >= 0, 'brig reason');

var pittTech = sandbox.evaluateOpsCurrentTechIssue_(
  {
    sitemapCount: 23,
    indexedCount: null,
    auditDate: '',
    source: ''
  },
  rules,
  '2026-09-04'
);
assert(!pittTech.ok, 'PITT null indexed → no tech');

var ageTech = sandbox.evaluateOpsCurrentTechIssue_(
  {
    sitemapCount: 13,
    indexedCount: 6,
    indexRate: 6 / 13,
    auditDate: '2026-09-04',
    source: 'URL索引',
    urlCount: 15
  },
  rules,
  '2026-09-04'
);
assert(ageTech.ok, 'Agefield low IndexRate still holds');
assert(ageTech.reason.indexOf('IndexRate') >= 0, 'age reason mentions rate');

var recovered = sandbox.evaluateOpsCurrentTechIssue_(
  {
    sitemapCount: 13,
    indexedCount: 10,
    indexRate: 10 / 13,
    auditDate: '2026-09-04',
    source: 'URL索引'
  },
  rules,
  '2026-09-04'
);
assert(!recovered.ok, 'recovered index → no tech');

var expired = sandbox.evaluateOpsCurrentTechIssue_(
  {
    sitemapCount: 13,
    indexedCount: 3,
    indexRate: 3 / 13,
    auditDate: '2026-08-01',
    source: 'URL索引'
  },
  rules,
  '2026-09-04'
);
assert(!expired.ok, 'expired audit → no tech');

var history = [
  {
    date: '2026-09-04',
    siteId: 'mortal-shell-ii',
    site: 'Mortal Shell II',
    gameStage: 'PUBLISHED',
    clicks: 4,
    impressions: 664,
    avgPosition: 8.4,
    trend7d: '下降 57%',
    siteStatus: 'DOMAIN_READY',
    opsStatus: '衰退',
    mainChange: '7日趋势 下降 57%；数据截止 2026-09-01',
    suggestedAction: 'DOMAIN_UPGRADE',
    priority: 'P0',
    reason: '明确持续下降'
  },
  {
    date: '2026-09-04',
    siteId: 'brigandine-abyss',
    site: 'BRIGANDINE ABYSS',
    gameStage: '',
    clicks: 48,
    impressions: 231,
    avgPosition: 6.4,
    trend7d: '上升 161%',
    siteStatus: 'INDEX_CHECK',
    opsStatus: '增长',
    mainChange: 'SEO动作 CHECK_INDEX；数据截止 2026-09-01',
    suggestedAction: 'CHECK_INDEX',
    priority: 'P0',
    reason: 'stale CHECK_INDEX'
  },
  {
    date: '2026-09-04',
    siteId: 'project-p-i-t-t',
    site: 'Project P.I.T.T.',
    gameStage: '',
    clicks: 13,
    impressions: 181,
    avgPosition: 5.9,
    trend7d: '上升 128%',
    siteStatus: 'INDEX_CHECK',
    opsStatus: '增长',
    mainChange: 'SEO动作 CHECK_INDEX；数据截止 2026-09-01',
    suggestedAction: 'CHECK_INDEX',
    priority: 'P0',
    reason: 'stale CHECK_INDEX'
  },
  {
    date: '2026-09-04',
    siteId: 'agefield-high-rock-the-school',
    site: 'Agefield High: Rock the School',
    gameStage: '',
    clicks: 5,
    impressions: 13,
    avgPosition: 4.5,
    trend7d: '样本不足',
    siteStatus: 'INDEX_CHECK',
    opsStatus: '稳定',
    mainChange: '样本不足；数据截止 2026-09-01',
    suggestedAction: 'CHECK_INDEX',
    priority: 'P0',
    reason: 'low index'
  },
  {
    date: '2026-09-04',
    siteId: 'approximately-up',
    site: 'Approximately Up',
    gameStage: '',
    clicks: 0,
    impressions: 19,
    avgPosition: 11,
    trend7d: '下降 25%',
    siteStatus: 'TRACTION',
    opsStatus: '衰退',
    mainChange: '下降',
    suggestedAction: 'CONTENT_OPTIMIZE',
    priority: 'P2',
    reason: '衰退'
  },
  {
    date: '2026-09-04',
    siteId: 'agent-64-spies-never-die',
    site: 'Agent 64: Spies Never Die',
    gameStage: '',
    clicks: 0,
    impressions: 0,
    avgPosition: 0,
    trend7d: '样本不足',
    siteStatus: 'LOW_SIGNAL',
    opsStatus: '暂停投入',
    mainChange: '',
    suggestedAction: 'ARCHIVE',
    priority: 'P3',
    reason: '冻结'
  }
];

var indexBySite = {
  'BRIGANDINE ABYSS': {
    sitemapCount: 26,
    indexedCount: null,
    auditDate: '',
    source: ''
  },
  'Project P.I.T.T.': {
    sitemapCount: 23,
    indexedCount: null,
    auditDate: '',
    source: ''
  },
  'Agefield High: Rock the School': {
    sitemapCount: 13,
    indexedCount: 6,
    indexRate: 6 / 13,
    auditDate: '2026-09-04',
    source: 'URL索引',
    urlCount: 15
  }
};

var ms2QueryRows = [];
for (var d = 0; d < 7; d++) {
  var day = addDaysStr_('2026-09-01', -d);
  ms2QueryRows.push([day, 'Mortal Shell II', 'mortal shell 2 seed', 0, 45, 0, 8]);
  ms2QueryRows.push([day, 'Mortal Shell II', 'gloombound flame', 0, 32, 0, 9]);
}

var written = null;
sandbox.writeOpsDailyReportSheet_ = function (view) {
  written = view;
};
sandbox.ensureSheet_ = function () {};

var selected = sandbox.selectOpsDailyActions_(history, {
  queryBySite: { 'Mortal Shell II': ms2QueryRows },
  pageBySite: {},
  opportunityRows: [],
  indexBySite: indexBySite,
  rules: rules,
  asOfDate: '2026-09-04'
});
assert(selected.length <= 3, 'max 3 actions');
assert(!selected.some(function (a) { return a.site === 'BRIGANDINE ABYSS'; }),
  'Brigandine stale CHECK_INDEX excluded');
assert(!selected.some(function (a) { return a.site === 'Project P.I.T.T.'; }),
  'PITT stale CHECK_INDEX excluded');
assert(selected.some(function (a) { return a.site === 'Agefield High: Rock the School'; }),
  'Agefield current low index kept');
assert(!selected.some(function (a) { return a.site === 'Mortal Shell II'; }),
  'MS2 not in execute list');
assert(selected.length === 1, 'only Agefield tech remains from fixture');
assert(selected[0].action === '技术修复', 'agefield tech fix');

var result = sandbox.runOpsDailyReport_({
  historyRows: history,
  queryBySite: { 'Mortal Shell II': ms2QueryRows },
  pageBySite: {},
  opportunityRows: [],
  indexBySite: indexBySite,
  rules: rules,
  writeSheet: true
});
assert(result.overview.activeSites === 6, 'overview active');
assert(result.overview.gscCutoff === '2026-09-01', 'gsc cutoff parsed');
assert(result.actionCount === 1, 'one verified tech action');
assert(result.ms2Judgment === '无需操作', 'MS2 judgment 无需操作');
assert(written.actions.length === 1, 'sheet actions');
assert(written.actions[0].site.indexOf('Agefield') === 0, 'sheet agefield only');

var brigRow = written.siteRows.find(function (r) { return r.site === 'BRIGANDINE ABYSS'; });
assert(brigRow.judgment === '继续观察', 'Brigandine becomes 继续观察 when not selected');

console.log('PASS scripts/test-ops-daily-report-view.js');
console.log('actions', result.actions.map(function (a) {
  return a.priority + '|' + a.site + '|' + a.action;
}));
