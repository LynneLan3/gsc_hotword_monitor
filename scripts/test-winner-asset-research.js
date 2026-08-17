/**
 * B2-B1 本地自测：Winner Asset APPROVE → ASSET_RESEARCH Job。
 * 运行：node scripts/test-winner-asset-research.js
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var WINNER_ASSET_HEADERS = [
  '生成时间',
  '站点',
  '赢家页面',
  '赢家意图',
  '赢家页点击7日',
  '赢家页曝光7日',
  '攻略查询数7日',
  '意图类别数',
  '资产候选类型',
  '资产候选标题',
  '候选理由',
  '当前资产级别',
  '证据状态',
  '缺失证据',
  '人工决定',
  '人工备注',
  '状态',
  '创建时间',
  '更新时间',
  '研究任务ID',
  '研究请求时间'
];

var RESEARCH_JOB_HEADERS = [
  '任务ID',
  '创建时间',
  '站点',
  '游戏',
  '搜索词 / topic',
  '页面路径',
  '机会等级',
  '建议动作',
  'source_query',
  '任务状态',
  '关联搜索词',
  '研究结果',
  '证据数量',
  '结果路径',
  '完成时间',
  '错误信息',
  '审核摘要',
  '审核链接',
  '审核决定',
  '审核备注',
  '审核时间',
  '研究类型'
];

var RESEARCH_TYPE = {
  CONTENT_RESEARCH: 'CONTENT_RESEARCH',
  ASSET_RESEARCH: 'ASSET_RESEARCH'
};
var ASSET_TYPE = {
  VERIFIED_GUIDE: 'VERIFIED_GUIDE',
  COMPARISON_MATRIX: 'COMPARISON_MATRIX'
};
var ASSET_LEVEL = { NORMAL_PAGE: 'NORMAL_PAGE', EVIDENCE_PAGE: 'EVIDENCE_PAGE' };
var ASSET_EVIDENCE_STATUS = { UNKNOWN: 'UNKNOWN', PARTIAL: 'PARTIAL', READY: 'READY' };
var ASSET_HUMAN_DECISION = {
  TODO: 'TODO',
  APPROVE: 'APPROVE',
  HOLD: 'HOLD',
  SKIP: 'SKIP'
};
var ASSET_HUMAN_DECISION_LABELS = {
  TODO: '待处理',
  APPROVE: '批准研究',
  HOLD: '暂缓',
  SKIP: '跳过'
};
var ASSET_STATUS = {
  CANDIDATE: 'CANDIDATE',
  RESEARCH: 'RESEARCH',
  READY: 'READY',
  DONE: 'DONE',
  ARCHIVED: 'ARCHIVED'
};
var ASSET_LOCKED_STATUSES = { RESEARCH: true, READY: true, DONE: true, ARCHIVED: true };
var RESEARCH_GAME_SLUGS = {
  'Mortal Shell II': 'ms2',
  'Agefield High: Rock the School': 'agefield'
};
var OPPORTUNITY_LEVELS = { HIGH: 'HIGH' };
var OPPORTUNITY_ACTIONS = { RESEARCH_EXPAND_EXISTING: 'RESEARCH_EXPAND_EXISTING' };
var RESEARCH_JOB_STATUS = { PENDING: 'PENDING' };
var OPPORTUNITY_LEVEL_LABELS = { HIGH: '高' };
var OPPORTUNITY_ACTION_LABELS = { RESEARCH_EXPAND_EXISTING: '研究并扩充现有页面' };
var RESEARCH_JOB_STATUS_LABELS = { PENDING: '待处理' };

var NOW_TS = '2026-08-17 18:00:00';
var CONTRACT_FIELDS = [
  'job_id',
  'game',
  'topic',
  'existing_page',
  'opportunity_level',
  'recommended_action',
  'source_query',
  'created_at'
];

function opportunityLabel_(map, key) {
  return (map && map[key]) || key || '';
}

function slugifyResearch_(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function researchJobSheetRow_(job, site, createdAt) {
  return [
    job.job_id,
    createdAt || new Date(),
    site || job.game,
    job.game,
    job.topic,
    job.existing_page,
    opportunityLabel_(OPPORTUNITY_LEVEL_LABELS, job.opportunity_level),
    opportunityLabel_(OPPORTUNITY_ACTION_LABELS, job.recommended_action),
    job.source_query,
    opportunityLabel_(RESEARCH_JOB_STATUS_LABELS, RESEARCH_JOB_STATUS.PENDING),
    job.related_queries || '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    job.research_type || RESEARCH_TYPE.CONTENT_RESEARCH
  ];
}

var sandbox = {
  WINNER_ASSET_HEADERS: WINNER_ASSET_HEADERS,
  RESEARCH_JOB_HEADERS: RESEARCH_JOB_HEADERS,
  RESEARCH_TYPE: RESEARCH_TYPE,
  ASSET_TYPE: ASSET_TYPE,
  ASSET_LEVEL: ASSET_LEVEL,
  ASSET_EVIDENCE_STATUS: ASSET_EVIDENCE_STATUS,
  ASSET_HUMAN_DECISION: ASSET_HUMAN_DECISION,
  ASSET_HUMAN_DECISION_LABELS: ASSET_HUMAN_DECISION_LABELS,
  ASSET_HUMAN_DECISION_OPTIONS: [
    ASSET_HUMAN_DECISION_LABELS.TODO,
    ASSET_HUMAN_DECISION_LABELS.APPROVE,
    ASSET_HUMAN_DECISION_LABELS.HOLD,
    ASSET_HUMAN_DECISION_LABELS.SKIP
  ],
  ASSET_STATUS: ASSET_STATUS,
  ASSET_LOCKED_STATUSES: ASSET_LOCKED_STATUSES,
  RESEARCH_GAME_SLUGS: RESEARCH_GAME_SLUGS,
  OPPORTUNITY_LEVELS: OPPORTUNITY_LEVELS,
  OPPORTUNITY_ACTIONS: OPPORTUNITY_ACTIONS,
  RESEARCH_JOB_STATUS: RESEARCH_JOB_STATUS,
  OPPORTUNITY_LEVEL_LABELS: OPPORTUNITY_LEVEL_LABELS,
  OPPORTUNITY_ACTION_LABELS: OPPORTUNITY_ACTION_LABELS,
  RESEARCH_JOB_STATUS_LABELS: RESEARCH_JOB_STATUS_LABELS,
  PORTFOLIO_HEADERS: [],
  SHEET_NAMES: {},
  opportunityLabel_: opportunityLabel_,
  slugifyResearch_: slugifyResearch_,
  researchJobSheetRow_: researchJobSheetRow_,
  enumFromLabel_: function (map, raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (map && map[s]) return s;
    var keys = Object.keys(map || {});
    for (var i = 0; i < keys.length; i++) {
      if (map[keys[i]] === s) return keys[i];
    }
    return s;
  },
  RESEARCH_REVIEW_DECISION: { APPROVE: 'APPROVE' },
  RESEARCH_REVIEW_DECISION_LABELS: { APPROVE: '批准开发' }
};

vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'WinnerAsset.gs'), 'utf8'),
  sandbox
);

function assetRow_(opts) {
  opts = opts || {};
  return [
    '2026-08-17',
    opts.siteName || 'Mortal Shell II',
    opts.winnerPage ||
      'https://mortal-shell-ii.vercel.app/mortal-shell-ii/beta-progress-carry-over/',
    opts.winnerIntent === undefined ? 'save_progress' : opts.winnerIntent,
    4,
    817,
    17,
    2,
    opts.assetType || ASSET_TYPE.COMPARISON_MATRIX,
    opts.assetTitle === undefined ? '' : opts.assetTitle,
    'candidate reason',
    opts.assetLevel || ASSET_LEVEL.EVIDENCE_PAGE,
    opts.evidenceStatus === undefined ? ASSET_EVIDENCE_STATUS.PARTIAL : opts.evidenceStatus,
    opts.missingEvidence === undefined
      ? 'carry-over / reset / reward 对照未齐'
      : opts.missingEvidence,
    opts.humanDecision === undefined ? ASSET_HUMAN_DECISION.TODO : opts.humanDecision,
    opts.humanNote === undefined ? '' : opts.humanNote,
    opts.status || ASSET_STATUS.CANDIDATE,
    '2026-08-17 10:00:00',
    opts.updatedAt || '2026-08-17 10:00:00',
    opts.researchJobId || '',
    opts.researchRequestedAt || ''
  ];
}

function agefieldRow_(opts) {
  opts = opts || {};
  return assetRow_({
    siteName: 'Agefield High: Rock the School',
    winnerPage:
      'https://agefield-high-rock-the-school.vercel.app/agefield-high-rock-the-school/classes/',
    winnerIntent: '',
    assetType: ASSET_TYPE.VERIFIED_GUIDE,
    assetLevel: ASSET_LEVEL.NORMAL_PAGE,
    evidenceStatus: ASSET_EVIDENCE_STATUS.UNKNOWN,
    missingEvidence: 'classes / answers / structured data 未齐',
    humanDecision: opts.humanDecision,
    humanNote: opts.humanNote,
    status: opts.status,
    assetTitle: opts.assetTitle
  });
}

function jobRow_(opts) {
  opts = opts || {};
  var row = [];
  for (var i = 0; i < RESEARCH_JOB_HEADERS.length; i++) row.push('');
  row[0] = opts.jobId || 'asset-ms2-beta-progress-carry-over-20260816';
  row[2] = opts.site || 'Mortal Shell II';
  row[3] = opts.site || 'Mortal Shell II';
  row[4] = opts.topic || 'existing';
  row[5] = opts.page || '/mortal-shell-ii/beta-progress-carry-over/';
  row[9] = opts.status || '待处理';
  row[21] = opts.researchType === undefined ? RESEARCH_TYPE.ASSET_RESEARCH : opts.researchType;
  return row;
}

function run_(assetRows, jobRows, writeJobs) {
  return sandbox.runWinnerAssetDecisionPipeline_(assetRows, jobRows || [], {
    nowTs: NOW_TS,
    assetHeaders: WINNER_ASSET_HEADERS,
    jobHeaders: RESEARCH_JOB_HEADERS,
    writeJobs: writeJobs
  });
}

function assertContract_(job) {
  for (var i = 0; i < CONTRACT_FIELDS.length; i++) {
    var key = CONTRACT_FIELDS[i];
    assert(String(job[key] || '').trim(), 'hotword contract missing ' + key);
  }
}

var approve = run_([
  assetRow_({
    humanDecision: ASSET_HUMAN_DECISION.APPROVE,
    humanNote: 'go research',
    assetTitle: 'Keep title'
  })
]);
assert(approve.created === 1, '1 creates 1 job');
assert(approve.assets[0][16] === ASSET_STATUS.RESEARCH, '1 Status=RESEARCH');
assert(approve.assets[0][14] === ASSET_HUMAN_DECISION.APPROVE, '1 HumanDecision stays APPROVE');
assert(approve.assets[0][15] === 'go research', '1 keeps human note');
assert(approve.assets[0][9] === 'Keep title', '1 keeps asset title');
assert(approve.assets[0][8] === ASSET_TYPE.COMPARISON_MATRIX, '1 does not change AssetType');
assert(approve.assets[0][11] === ASSET_LEVEL.EVIDENCE_PAGE, '1 does not change AssetLevel');
assert(approve.assets[0][12] === ASSET_EVIDENCE_STATUS.PARTIAL, '1 does not change EvidenceStatus');
assert(approve.jobsToCreate[0].job.research_type === RESEARCH_TYPE.ASSET_RESEARCH, '1 research_type');
assert(approve.jobsToCreate[0].row[21] === RESEARCH_TYPE.ASSET_RESEARCH, '1 sheet 研究类型');
assertContract_(approve.jobsToCreate[0].job);

var todo = run_([assetRow_({ humanDecision: ASSET_HUMAN_DECISION.TODO })]);
assert(todo.created === 0 && todo.assets[0][16] === ASSET_STATUS.CANDIDATE, '2 TODO');

var hold = run_([assetRow_({ humanDecision: ASSET_HUMAN_DECISION.HOLD })]);
assert(hold.created === 0 && hold.assets[0][16] === ASSET_STATUS.CANDIDATE, '3 HOLD');
assert(hold.assets[0][14] === ASSET_HUMAN_DECISION.HOLD, '3 HOLD decision kept');

var skip = run_([
  assetRow_({
    humanDecision: ASSET_HUMAN_DECISION.SKIP,
    humanNote: 'skip this page',
    assetTitle: 'Keep title'
  })
]);
assert(skip.created === 0, '4 SKIP no job');
assert(skip.assets[0][16] === ASSET_STATUS.CANDIDATE, '4 SKIP stays CANDIDATE');
assert(skip.assets[0][14] === ASSET_HUMAN_DECISION.SKIP, '4 SKIP decision kept');

var pendingExisting = run_(
  [assetRow_({ humanDecision: ASSET_HUMAN_DECISION.APPROVE })],
  [jobRow_({ status: '待处理', researchType: RESEARCH_TYPE.ASSET_RESEARCH })]
);
assert(pendingExisting.created === 0, '5 PENDING no recreate');
assert(pendingExisting.assets[0][16] === ASSET_STATUS.RESEARCH, '5 heals RESEARCH');

['RUNNING', '待审核', 'REVIEW'].forEach(function (st) {
  var blocked = run_(
    [assetRow_({ humanDecision: ASSET_HUMAN_DECISION.APPROVE })],
    [jobRow_({ status: st, researchType: RESEARCH_TYPE.ASSET_RESEARCH })]
  );
  assert(blocked.created === 0, '6 ' + st + ' no recreate');
});
['已归档', 'ARCHIVED', 'DONE'].forEach(function (st) {
  var closed = run_(
    [assetRow_({ humanDecision: ASSET_HUMAN_DECISION.APPROVE })],
    [jobRow_({ status: st, researchType: RESEARCH_TYPE.ASSET_RESEARCH })]
  );
  assert(closed.created === 0, '6 ' + st + ' no reopen');
});

var contentSamePage = run_(
  [assetRow_({ humanDecision: ASSET_HUMAN_DECISION.APPROVE })],
  [
    jobRow_({
      jobId: 'ms2-beta-progress-carry-over-20260814',
      researchType: RESEARCH_TYPE.CONTENT_RESEARCH
    })
  ]
);
assert(contentSamePage.created === 1, 'CONTENT_RESEARCH same page does not block');

var failed = run_(
  [assetRow_({ humanDecision: ASSET_HUMAN_DECISION.APPROVE })],
  [],
  function () {
    throw new Error('write_failed');
  }
);
assert(failed.created === 0 && failed.assets[0][16] === ASSET_STATUS.CANDIDATE, '7 fail stays CANDIDATE');

var emptyIntent = run_([agefieldRow_({ humanDecision: ASSET_HUMAN_DECISION.APPROVE })]);
assert(emptyIntent.created === 1, '8 empty WinnerIntent still creates');
assert(emptyIntent.jobsToCreate[0].job.topic.indexOf('WinnerIntent=(empty)') >= 0, '8 empty intent in topic');

var ageTopic = emptyIntent.jobsToCreate[0].job.topic;
assert(ageTopic.indexOf('ResearchType=ASSET_RESEARCH') >= 0, '9 ResearchType');
assert(ageTopic.indexOf('/agefield-high-rock-the-school/classes/') >= 0, '9 path');
assert(/classes/i.test(ageTopic) && /subjects/i.test(ageTopic), '9 classes/subjects');
assert(/observed answers|正确答案/.test(ageTopic), '9 answers');
assert(/reward|money|score/.test(ageTopic), '9 reward');
assert(/Answer Database|结构化/.test(ageTopic), '9 structured');
assert(
  emptyIntent.jobsToCreate[0].job.existing_page === '/agefield-high-rock-the-school/classes/',
  '9 pathname'
);
assert(emptyIntent.jobsToCreate[0].job.job_id === 'asset-agefield-classes-20260817', '9 job id');

var ageQuery = String(emptyIntent.jobsToCreate[0].job.source_query || '').trim();
assert(!!ageQuery, 'Agefield source_query non-empty');
assert(ageQuery.indexOf('/') < 0, 'Agefield source_query is not a pathname');
assert(ageQuery.charAt(0) !== '/', 'Agefield source_query does not start with /');
assert(/agefield/i.test(ageQuery) && /classes/i.test(ageQuery), 'Agefield source_query has agefield + classes');
assert(/answer/i.test(ageQuery), 'Agefield source_query has answers semantics');

var msTopic = approve.jobsToCreate[0].job.topic;
assert(/Carry Over|carry over/i.test(msTopic) && /reset/i.test(msTopic), '10 carry/reset');
assert(/Flayed Harbinger/.test(msTopic) && /Marrow Keep/.test(msTopic), '10 names');
assert(/COMPARISON_MATRIX/.test(msTopic), '10 matrix');
assert(
  approve.jobsToCreate[0].job.existing_page === '/mortal-shell-ii/beta-progress-carry-over/',
  '10 pathname'
);
assert(
  approve.jobsToCreate[0].job.job_id === 'asset-ms2-beta-progress-carry-over-20260817',
  '10 job id'
);

var msQuery = String(approve.jobsToCreate[0].job.source_query || '').trim();
assert(!!msQuery, 'MS2 source_query non-empty');
assert(msQuery.indexOf('/') < 0, 'MS2 source_query is not a pathname');
assert(msQuery.charAt(0) !== '/', 'MS2 source_query does not start with /');
assert(/mortal shell/i.test(msQuery), 'MS2 source_query has mortal shell');
assert(/carry|progress/i.test(msQuery), 'MS2 source_query has carry/progress');
assert(/reward/i.test(msQuery), 'MS2 source_query has reward semantics');
assert(ageTopic.indexOf('ResearchType=ASSET_RESEARCH') >= 0, 'topic remains full brief');
assert(msTopic.indexOf('ResearchType=ASSET_RESEARCH') >= 0, 'MS2 topic remains full brief');
assert(
  String(approve.jobsToCreate[0].job.related_queries || '').indexOf('Flayed Harbinger') >= 0,
  'related_queries kept'
);

assert(approve.assets[0][2].indexOf('/beta-progress-carry-over/') >= 0, '11 WinnerPage unchanged');
var winnerSrc = fs.readFileSync(path.join(__dirname, '..', 'WinnerAsset.gs'), 'utf8');
assert(
  !/PORTFOLIO_ACTION|经营动作|RecommendedAction|DomainScore/.test(winnerSrc),
  '11 no PortfolioAction/DomainScore'
);

var zhApprove = run_([assetRow_({ humanDecision: '批准研究' })]);
assert(zhApprove.created === 1 && zhApprove.assets[0][14] === '批准研究', '中文批准研究');

var configSrc = fs.readFileSync(path.join(__dirname, '..', 'Config.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
var dailyStart = codeSrc.indexOf('function runDailyUnlocked_');
var dailyEnd = codeSrc.indexOf('\nfunction ', dailyStart + 1);
var dailySrc = codeSrc.slice(dailyStart, dailyEnd === -1 ? undefined : dailyEnd);
assert(codeSrc.indexOf("addItem('处理内容资产决定', 'processWinnerAssetDecisions')") >= 0, 'menu');
assert(dailySrc.indexOf('processWinnerAssetDecisions') < 0, 'not on runDaily');
assert(configSrc.indexOf("'研究类型'") >= 0 && configSrc.indexOf('RESEARCH_TYPE') >= 0, '研究类型 field');
var researchSrc = fs.readFileSync(path.join(__dirname, '..', 'ResearchJobs.gs'), 'utf8');
assert(researchSrc.indexOf("cell_(row, col, '研究类型')") < 0, 'API payload does not pass research_type yet');
assert(winnerSrc.indexOf('function buildAssetResearchSourceQuery_') >= 0, 'source_query helper exists');

console.log(
  JSON.stringify(
    {
      agefieldJobId: emptyIntent.jobsToCreate[0].job.job_id,
      ms2JobId: approve.jobsToCreate[0].job.job_id,
      agefieldPage: emptyIntent.jobsToCreate[0].job.existing_page,
      ms2Page: approve.jobsToCreate[0].job.existing_page,
      agefieldSourceQuery: ageQuery,
      ms2SourceQuery: msQuery
    },
    null,
    2
  )
);
console.log('PASS scripts/test-winner-asset-research.js');
