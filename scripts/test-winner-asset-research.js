/**
 * B2-B 本地自测：Winner Asset Human Gate → 标准 Research Job。
 * 运行：node scripts/test-winner-asset-research.js
 */

var fs = require('fs');
var path = require('path');

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
  '审核时间'
];

var ASSET_TYPE = { VERIFIED_GUIDE: 'VERIFIED_GUIDE', COMPARISON_MATRIX: 'COMPARISON_MATRIX' };
var ASSET_EVIDENCE_STATUS = { UNKNOWN: 'UNKNOWN', PARTIAL: 'PARTIAL', READY: 'READY' };
var ASSET_HUMAN_DECISION = { TODO: 'TODO', APPROVE: 'APPROVE', HOLD: 'HOLD', SKIP: 'SKIP' };
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

function cellAt_(row, idx) {
  if (idx === undefined || idx === null || idx < 0) return '';
  var v = row[idx];
  return v === null || v === undefined ? '' : v;
}

function opportunityLabel_(map, key) {
  return (map && map[key]) || key || '';
}

function slugifyResearch_(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function winnerAssetPathname_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  var m = /^https?:\/\/[^\/?#]+(\/[^?#]*)?/i.exec(raw);
  if (m) return m[1] || '/';
  return raw;
}

function winnerAssetDecisionCol_(headerRow) {
  var headers = headerRow && headerRow.length ? headerRow : WINNER_ASSET_HEADERS;
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i] || '').trim();
    if (name && map[name] === undefined) map[name] = i;
  }
  function idx_(name, fallback) {
    return map[name] !== undefined ? map[name] : fallback;
  }
  return {
    siteName: idx_('站点', 1),
    winnerPage: idx_('赢家页面', 2),
    winnerIntent: idx_('赢家意图', 3),
    assetType: idx_('资产候选类型', 8),
    assetTitle: idx_('资产候选标题', 9),
    evidenceStatus: idx_('证据状态', 12),
    humanDecision: idx_('人工决定', 14),
    humanNote: idx_('人工备注', 15),
    status: idx_('状态', 16),
    updatedAt: idx_('更新时间', 18),
    researchJobId: idx_('研究任务ID', 19),
    researchRequestedAt: idx_('研究请求时间', 20)
  };
}

function emptyWinnerAssetDecisionSummary_() {
  return {
    processed: 0,
    researchCreated: 0,
    researchExisting: 0,
    ready: 0,
    archived: 0,
    held: 0,
    skipped: 0
  };
}

function normalizeAssetHumanDecision_(value) {
  var raw = String(value || '').trim();
  if (!raw) return ASSET_HUMAN_DECISION.TODO;
  if (ASSET_HUMAN_DECISION_LABELS[raw]) return raw;
  var keys = Object.keys(ASSET_HUMAN_DECISION_LABELS);
  for (var i = 0; i < keys.length; i++) {
    if (ASSET_HUMAN_DECISION_LABELS[keys[i]] === raw) return keys[i];
  }
  return raw;
}

function makeWinnerAssetResearchJobId_(siteName, winnerPage) {
  var prefix = RESEARCH_GAME_SLUGS[siteName] || slugifyResearch_(siteName);
  var pathName = winnerAssetPathname_(winnerPage);
  var slug = '';
  if (pathName && pathName !== '/') {
    var segments = String(pathName).split('/').filter(function (s) {
      return !!s;
    });
    if (segments.length) slug = slugifyResearch_(segments[segments.length - 1]);
  }
  if (!slug) slug = 'page';
  if (slug.length > 40) slug = slug.substring(0, 40).replace(/-+$/, '');
  return ('asset-' + prefix + '-' + slug).replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function buildWinnerAssetResearchTopic_(opts) {
  opts = opts || {};
  var title = String(opts.assetTitle || '').trim();
  if (title) return title;
  var intent = String(opts.winnerIntent || '').trim();
  if (intent === 'save_progress') return 'save progress / carry over / reset / rewards';
  if (intent === 'platform') return 'platform availability / console / PC';
  if (intent) return intent.replace(/_/g, ' ');
  var assetType = String(opts.assetType || '').trim();
  if (assetType === ASSET_TYPE.VERIFIED_GUIDE) return 'verified guide evidence';
  if (assetType) return assetType.replace(/_/g, ' ').toLowerCase();
  return 'winner page evidence';
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
    ''
  ];
}

function buildWinnerAssetResearchJob_(asset, createdAt) {
  var topic = buildWinnerAssetResearchTopic_(asset);
  var job = {
    job_id: makeWinnerAssetResearchJobId_(asset.siteName, asset.winnerPage),
    game: asset.siteName,
    topic: topic,
    existing_page: String(asset.winnerPage || '').trim(),
    opportunity_level: OPPORTUNITY_LEVELS.HIGH,
    recommended_action: OPPORTUNITY_ACTIONS.RESEARCH_EXPAND_EXISTING,
    source_query: topic,
    related_queries: '',
    created_at: createdAt
  };
  return { job: job, row: researchJobSheetRow_(job, asset.siteName, createdAt) };
}

function padWinnerAssetRow_(row) {
  var out = (row || []).slice();
  while (out.length < WINNER_ASSET_HEADERS.length) out.push('');
  return out;
}

function processWinnerAssetDecisionRows_(assetRows, opts) {
  opts = opts || {};
  var nowTs = opts.nowTs || '';
  var col = winnerAssetDecisionCol_(opts.assetHeaders);
  var existingJobIds = opts.existingJobIds || {};
  var summary = emptyWinnerAssetDecisionSummary_();
  var jobsToCreate = [];
  var claimedIds = {};
  var outAssets = [];
  var changed = false;

  for (var i = 0; i < (assetRows || []).length; i++) {
    var row = padWinnerAssetRow_(assetRows[i]);
    outAssets.push(row);
    var status = String(cellAt_(row, col.status) || '').trim() || ASSET_STATUS.CANDIDATE;
    var decision = normalizeAssetHumanDecision_(cellAt_(row, col.humanDecision));
    var note = String(cellAt_(row, col.humanNote) || '');
    var title = String(cellAt_(row, col.assetTitle) || '');

    if (ASSET_LOCKED_STATUSES[status]) {
      summary.skipped += 1;
      continue;
    }
    if (status !== ASSET_STATUS.CANDIDATE) {
      summary.skipped += 1;
      continue;
    }

    summary.processed += 1;

    if (decision === ASSET_HUMAN_DECISION.TODO) {
      summary.skipped += 1;
      continue;
    }
    if (decision === ASSET_HUMAN_DECISION.HOLD) {
      summary.held += 1;
      continue;
    }
    if (decision === ASSET_HUMAN_DECISION.SKIP) {
      row[col.status] = ASSET_STATUS.ARCHIVED;
      row[col.updatedAt] = nowTs;
      row[col.humanNote] = note;
      row[col.assetTitle] = title;
      summary.archived += 1;
      changed = true;
      continue;
    }
    if (decision !== ASSET_HUMAN_DECISION.APPROVE) {
      summary.skipped += 1;
      continue;
    }

    var evidence = String(cellAt_(row, col.evidenceStatus) || '').trim();
    if (evidence === ASSET_EVIDENCE_STATUS.READY) {
      row[col.status] = ASSET_STATUS.READY;
      row[col.updatedAt] = nowTs;
      row[col.humanNote] = note;
      row[col.assetTitle] = title;
      summary.ready += 1;
      changed = true;
      continue;
    }

    var siteName = String(cellAt_(row, col.siteName) || '').trim();
    var winnerPage = String(cellAt_(row, col.winnerPage) || '').trim();
    var stableId = makeWinnerAssetResearchJobId_(siteName, winnerPage);
    var existingId = String(cellAt_(row, col.researchJobId) || '').trim();
    var alreadyInSheet = !!(existingJobIds[stableId] || claimedIds[stableId]);

    if (existingId || alreadyInSheet) {
      var reuseId = existingId || stableId;
      row[col.researchJobId] = reuseId;
      if (!String(cellAt_(row, col.researchRequestedAt) || '').trim()) {
        row[col.researchRequestedAt] = nowTs;
      }
      row[col.status] = ASSET_STATUS.RESEARCH;
      row[col.updatedAt] = nowTs;
      row[col.humanNote] = note;
      row[col.assetTitle] = title;
      summary.researchExisting += 1;
      changed = true;
      continue;
    }

    var built = buildWinnerAssetResearchJob_(
      {
        siteName: siteName,
        winnerPage: winnerPage,
        winnerIntent: String(cellAt_(row, col.winnerIntent) || '').trim(),
        assetType: String(cellAt_(row, col.assetType) || '').trim(),
        assetTitle: title
      },
      nowTs
    );
    jobsToCreate.push(built);
    claimedIds[stableId] = true;
    row[col.researchJobId] = built.job.job_id;
    row[col.researchRequestedAt] = nowTs;
    row[col.status] = ASSET_STATUS.RESEARCH;
    row[col.updatedAt] = nowTs;
    row[col.humanNote] = note;
    row[col.assetTitle] = title;
    summary.researchCreated += 1;
    changed = true;
  }

  return {
    assets: outAssets,
    jobsToCreate: jobsToCreate,
    summary: summary,
    changed: changed
  };
}

function assetRow_(opts) {
  opts = opts || {};
  return [
    '2026-08-17',
    opts.siteName || 'Mortal Shell II',
    opts.winnerPage || '/mortal-shell-ii/beta-progress-carry-over/',
    opts.winnerIntent === undefined ? 'save_progress' : opts.winnerIntent,
    4,
    817,
    17,
    2,
    opts.assetType || ASSET_TYPE.COMPARISON_MATRIX,
    opts.assetTitle || '',
    'candidate reason',
    'EVIDENCE_PAGE',
    opts.evidenceStatus === undefined ? ASSET_EVIDENCE_STATUS.PARTIAL : opts.evidenceStatus,
    'missing evidence',
    opts.humanDecision === undefined ? ASSET_HUMAN_DECISION.TODO : opts.humanDecision,
    opts.humanNote || '',
    opts.status || ASSET_STATUS.CANDIDATE,
    '2026-08-17 10:00:00',
    opts.updatedAt || '2026-08-17 10:00:00',
    opts.researchJobId || '',
    opts.researchRequestedAt || ''
  ];
}

function run_(rows, existingJobIds) {
  return processWinnerAssetDecisionRows_(rows, {
    nowTs: NOW_TS,
    existingJobIds: existingJobIds || {}
  });
}

// 1. TODO → 无动作
var todo = run_([assetRow_({ humanDecision: ASSET_HUMAN_DECISION.TODO })]);
assert(todo.jobsToCreate.length === 0, '1 TODO must not create job');
assert(todo.assets[0][16] === ASSET_STATUS.CANDIDATE, '1 TODO stays CANDIDATE');
assert(todo.summary.skipped === 1, '1 TODO counted as skipped');

var emptyDecision = run_([assetRow_({ humanDecision: '' })]);
assert(emptyDecision.jobsToCreate.length === 0, '1 empty decision must not create job');
assert(emptyDecision.assets[0][16] === ASSET_STATUS.CANDIDATE, '1 empty decision stays CANDIDATE');

// 2. HOLD → 无 Job，CANDIDATE
var hold = run_([assetRow_({ humanDecision: ASSET_HUMAN_DECISION.HOLD })]);
assert(hold.jobsToCreate.length === 0, '2 HOLD must not create job');
assert(hold.assets[0][16] === ASSET_STATUS.CANDIDATE, '2 HOLD stays CANDIDATE');
assert(hold.assets[0][14] === ASSET_HUMAN_DECISION.HOLD, '2 HOLD decision not rewritten');
assert(hold.summary.held === 1, '2 HOLD counted');

// 3. SKIP → ARCHIVED，无 Job
var skip = run_([
  assetRow_({
    humanDecision: ASSET_HUMAN_DECISION.SKIP,
    humanNote: 'skip this page',
    assetTitle: 'Keep title'
  })
]);
assert(skip.jobsToCreate.length === 0, '3 SKIP must not create job');
assert(skip.assets[0][16] === ASSET_STATUS.ARCHIVED, '3 SKIP → ARCHIVED');
assert(skip.assets[0][15] === 'skip this page', '3 SKIP keeps human note');
assert(skip.assets[0][9] === 'Keep title', '3 SKIP keeps asset title');
assert(skip.assets[0][18] === NOW_TS, '3 SKIP updates 更新时间');
assert(skip.summary.archived === 1, '3 SKIP counted');

var skipAgain = run_([skip.assets[0]]);
assert(skipAgain.jobsToCreate.length === 0, '3 SKIP rerun must be idempotent');
assert(skipAgain.assets[0][16] === ASSET_STATUS.ARCHIVED, '3 SKIP rerun stays ARCHIVED');

// 4. APPROVE + PARTIAL → Job + RESEARCH
var approvePartial = run_([
  assetRow_({
    humanDecision: ASSET_HUMAN_DECISION.APPROVE,
    evidenceStatus: ASSET_EVIDENCE_STATUS.PARTIAL,
    humanNote: 'go research',
    assetTitle: ''
  })
]);
assert(approvePartial.jobsToCreate.length === 1, '4 PARTIAL creates 1 job');
assert(approvePartial.assets[0][16] === ASSET_STATUS.RESEARCH, '4 PARTIAL → RESEARCH');
assert(approvePartial.assets[0][19] === 'asset-ms2-beta-progress-carry-over', '4 writes stable job id');
assert(approvePartial.assets[0][20] === NOW_TS, '4 writes 研究请求时间');
assert(approvePartial.assets[0][15] === 'go research', '4 keeps human note');
assert(approvePartial.summary.researchCreated === 1, '4 researchCreated');

// 5. APPROVE + UNKNOWN → Job + RESEARCH
var approveUnknown = run_([
  assetRow_({
    siteName: 'Agefield High: Rock the School',
    winnerPage: '/classes/',
    winnerIntent: '',
    assetType: ASSET_TYPE.VERIFIED_GUIDE,
    humanDecision: ASSET_HUMAN_DECISION.APPROVE,
    evidenceStatus: ASSET_EVIDENCE_STATUS.UNKNOWN
  })
]);
assert(approveUnknown.jobsToCreate.length === 1, '5 UNKNOWN creates 1 job');
assert(approveUnknown.assets[0][16] === ASSET_STATUS.RESEARCH, '5 UNKNOWN → RESEARCH');

var approveEmptyEvidence = run_([
  assetRow_({
    siteName: 'Agefield High: Rock the School',
    winnerPage: '/classes/',
    humanDecision: ASSET_HUMAN_DECISION.APPROVE,
    evidenceStatus: ''
  })
]);
assert(approveEmptyEvidence.jobsToCreate.length === 1, '5 empty evidence creates job');

// 6. APPROVE + READY → READY，无 Job
var approveReady = run_([
  assetRow_({
    humanDecision: ASSET_HUMAN_DECISION.APPROVE,
    evidenceStatus: ASSET_EVIDENCE_STATUS.READY,
    humanNote: 'enough evidence'
  })
]);
assert(approveReady.jobsToCreate.length === 0, '6 READY evidence must not create job');
assert(approveReady.assets[0][16] === ASSET_STATUS.READY, '6 → READY');
assert(approveReady.assets[0][15] === 'enough evidence', '6 keeps note');
assert(approveReady.summary.ready === 1, '6 ready counted');

// 7. RESEARCH 再跑 → 不重复
var researchRerun = run_([
  assetRow_({
    humanDecision: ASSET_HUMAN_DECISION.APPROVE,
    status: ASSET_STATUS.RESEARCH,
    researchJobId: 'asset-ms2-beta-progress-carry-over'
  })
]);
assert(researchRerun.jobsToCreate.length === 0, '7 RESEARCH rerun must not create job');
assert(researchRerun.assets[0][16] === ASSET_STATUS.RESEARCH, '7 stays RESEARCH');

// 8. READY / DONE / ARCHIVED 再跑 → 不重复
['READY', 'DONE', 'ARCHIVED'].forEach(function (st) {
  var locked = run_([
    assetRow_({
      humanDecision: ASSET_HUMAN_DECISION.APPROVE,
      status: st
    })
  ]);
  assert(locked.jobsToCreate.length === 0, '8 ' + st + ' must not create job');
  assert(locked.assets[0][16] === st, '8 ' + st + ' stays locked');
});

// 9. 已有 task id + CANDIDATE → 不新建，校正 RESEARCH
var existingId = run_([
  assetRow_({
    humanDecision: ASSET_HUMAN_DECISION.APPROVE,
    evidenceStatus: ASSET_EVIDENCE_STATUS.PARTIAL,
    researchJobId: 'asset-ms2-beta-progress-carry-over'
  })
]);
assert(existingId.jobsToCreate.length === 0, '9 existing task id must not create');
assert(existingId.assets[0][16] === ASSET_STATUS.RESEARCH, '9 CANDIDATE + id → RESEARCH');
assert(existingId.assets[0][19] === 'asset-ms2-beta-progress-carry-over', '9 keeps task id');
assert(existingId.summary.researchExisting === 1, '9 researchExisting');

// 10. Job Sheet 已有稳定 ID 但 asset 未回写 → 不重复创建
var orphanJob = run_(
  [
    assetRow_({
      humanDecision: ASSET_HUMAN_DECISION.APPROVE,
      evidenceStatus: ASSET_EVIDENCE_STATUS.PARTIAL
    })
  ],
  { 'asset-ms2-beta-progress-carry-over': true }
);
assert(orphanJob.jobsToCreate.length === 0, '10 existing job sheet id must not append');
assert(orphanJob.assets[0][16] === ASSET_STATUS.RESEARCH, '10 backfills RESEARCH');
assert(orphanJob.assets[0][19] === 'asset-ms2-beta-progress-carry-over', '10 backfills job id');
assert(orphanJob.assets[0][20] === NOW_TS, '10 backfills requested at');
assert(orphanJob.summary.researchExisting === 1, '10 researchExisting');

// 11. 同 site + page 跨不同日期生成同一 asset job id
var idA = makeWinnerAssetResearchJobId_(
  'Mortal Shell II',
  '/mortal-shell-ii/beta-progress-carry-over/'
);
var idB = makeWinnerAssetResearchJobId_(
  'Mortal Shell II',
  'https://mortal-shell-ii.vercel.app/mortal-shell-ii/beta-progress-carry-over/'
);
var idC = makeWinnerAssetResearchJobId_(
  'Agefield High: Rock the School',
  '/classes/'
);
assert(idA === 'asset-ms2-beta-progress-carry-over', '11 ms2 stable id');
assert(idA === idB, '11 same site+page across URL forms / dates');
assert(idC === 'asset-agefield-classes', '11 agefield stable id');
assert(!/20\d{6}/.test(idA), '11 job id must not include yyyymmdd');

// 12. topic：save_progress
assert(
  buildWinnerAssetResearchTopic_({ winnerIntent: 'save_progress' }) ===
    'save progress / carry over / reset / rewards',
  '12 save_progress topic'
);
assert(
  buildWinnerAssetResearchTopic_({ winnerIntent: 'platform' }) ===
    'platform availability / console / PC',
  '12 platform topic'
);
assert(
  buildWinnerAssetResearchTopic_({ winnerIntent: 'class_answers' }) === 'class answers',
  '12 snake_case topic'
);

// 13. topic：assetTitle 优先
assert(
  buildWinnerAssetResearchTopic_({
    assetTitle: 'Beta progress carry-over matrix',
    winnerIntent: 'save_progress'
  }) === 'Beta progress carry-over matrix',
  '13 assetTitle wins over intent'
);
assert(
  buildWinnerAssetResearchTopic_({ assetType: ASSET_TYPE.VERIFIED_GUIDE }) ===
    'verified guide evidence',
  '13 VERIFIED_GUIDE fallback topic'
);

// 14. page / site / HIGH / RESEARCH_EXPAND_EXISTING / PENDING
var jobBuilt = approvePartial.jobsToCreate[0];
assert(jobBuilt.job.game === 'Mortal Shell II', '14 game = site');
assert(
  jobBuilt.job.existing_page === '/mortal-shell-ii/beta-progress-carry-over/',
  '14 page = winner page'
);
assert(jobBuilt.job.opportunity_level === 'HIGH', '14 HIGH');
assert(jobBuilt.job.recommended_action === 'RESEARCH_EXPAND_EXISTING', '14 RESEARCH_EXPAND_EXISTING');
assert(jobBuilt.job.source_query === jobBuilt.job.topic, '14 source_query = topic');
assert(jobBuilt.job.related_queries === '', '14 related_queries empty');
assert(jobBuilt.row[2] === 'Mortal Shell II', '14 sheet 站点');
assert(jobBuilt.row[3] === 'Mortal Shell II', '14 sheet 游戏');
assert(jobBuilt.row[5] === '/mortal-shell-ii/beta-progress-carry-over/', '14 sheet 页面路径');
assert(jobBuilt.row[6] === '高', '14 sheet 机会等级 高');
assert(jobBuilt.row[7] === '研究并扩充现有页面', '14 sheet 建议动作');
assert(jobBuilt.row[9] === '待处理', '14 sheet 任务状态 PENDING');
assert(jobBuilt.row.length === RESEARCH_JOB_HEADERS.length, '14 job row matches 21-col contract');
assert(jobBuilt.row[10] === '', '14 sheet 关联搜索词 empty');

// 15. human note / asset title 不被覆盖
var preserved = run_([
  assetRow_({
    humanDecision: ASSET_HUMAN_DECISION.APPROVE,
    evidenceStatus: ASSET_EVIDENCE_STATUS.PARTIAL,
    humanNote: 'keep this note',
    assetTitle: 'Keep this title'
  })
]);
assert(preserved.assets[0][9] === 'Keep this title', '15 asset title preserved');
assert(preserved.assets[0][15] === 'keep this note', '15 human note preserved');
assert(
  preserved.jobsToCreate[0].job.topic === 'Keep this title',
  '15 job topic uses asset title'
);

// Chinese dropdown maps to enum
var zhApprove = run_([assetRow_({ humanDecision: '批准研究' })]);
assert(zhApprove.jobsToCreate.length === 1, '中文 批准研究 → APPROVE');
var zhHold = run_([assetRow_({ humanDecision: '暂缓' })]);
assert(zhHold.summary.held === 1 && zhHold.assets[0][16] === ASSET_STATUS.CANDIDATE, '中文 暂缓 → HOLD');
var zhSkip = run_([assetRow_({ humanDecision: '跳过' })]);
assert(zhSkip.assets[0][16] === ASSET_STATUS.ARCHIVED, '中文 跳过 → SKIP');
var zhTodo = run_([assetRow_({ humanDecision: '待处理' })]);
assert(zhTodo.jobsToCreate.length === 0, '中文 待处理 → TODO');

// Source wiring
var winnerSrc = fs.readFileSync(path.join(__dirname, '..', 'WinnerAsset.gs'), 'utf8');
var configSrc = fs.readFileSync(path.join(__dirname, '..', 'Config.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
var researchSrc = fs.readFileSync(path.join(__dirname, '..', 'ResearchJobs.gs'), 'utf8');
var dailySrc = codeSrc.slice(codeSrc.indexOf('function runDaily'), codeSrc.indexOf('function runDailyUnlocked_'));

assert(winnerSrc.indexOf('function processWinnerAssetDecisions()') >= 0, 'processWinnerAssetDecisions exists');
assert(winnerSrc.indexOf('function buildWinnerAssetResearchTopic_(') >= 0, 'topic helper exists');
assert(winnerSrc.indexOf('researchJobSheetRow_') >= 0, 'reuses researchJobSheetRow_');
assert(codeSrc.indexOf("addItem('处理内容资产决定', 'processWinnerAssetDecisions')") >= 0, 'menu item');
assert(dailySrc.indexOf('processWinnerAssetDecisions') < 0, 'runDaily must not call processWinnerAssetDecisions');
assert(configSrc.indexOf("'审核时间'") >= 0, 'research job headers keep 审核时间');
assert(!/RESEARCH_TYPE/.test(configSrc), 'must not add RESEARCH_TYPE contract field');
assert(
  /var RESEARCH_JOB_HEADERS = \[[\s\S]*?'审核时间'\s*\];/.test(configSrc),
  'RESEARCH_JOB_HEADERS still ends at 审核时间'
);
assert(researchSrc.indexOf("jobId && /^asset-/.test(jobId)") >= 0, 'opportunity cluster skips asset- jobs');
assert(
  winnerSrc.indexOf('function createResearchJobs') < 0,
  'WinnerAsset must not redefine createResearchJobs'
);

console.log('PASS scripts/test-winner-asset-research.js');
