/**
 * B2-C 本地自测：Winner Asset Research Result Sync（不依赖 SpreadsheetApp）。
 * 运行：node scripts/test-winner-asset-research-sync.js
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

var ASSET_EVIDENCE_STATUS = { UNKNOWN: 'UNKNOWN', PARTIAL: 'PARTIAL', READY: 'READY' };
var ASSET_STATUS = {
  CANDIDATE: 'CANDIDATE',
  RESEARCH: 'RESEARCH',
  READY: 'READY',
  DONE: 'DONE',
  ARCHIVED: 'ARCHIVED'
};
var RESEARCH_JOB_STATUS = {
  PENDING: 'PENDING',
  REVIEW: 'REVIEW',
  WATCH: 'WATCH',
  FAILED: 'FAILED',
  APPROVED: 'APPROVED',
  ARCHIVED: 'ARCHIVED'
};
var RESEARCH_JOB_STATUS_LABELS = {
  PENDING: '待处理',
  REVIEW: '待审核',
  WATCH: '继续观察',
  FAILED: '失败',
  APPROVED: '已批准',
  ARCHIVED: '已归档'
};
var RESEARCH_REVIEW_DECISION = {
  APPROVE: 'APPROVE',
  WATCH: 'WATCH',
  NO_ACTION: 'NO_ACTION'
};
var RESEARCH_REVIEW_DECISION_LABELS = {
  APPROVE: '批准开发',
  WATCH: '继续观察',
  NO_ACTION: '无需处理'
};
var RESEARCH_RESULT_RECOMMENDATIONS = {
  EXPAND_EXISTING: 'EXPAND_EXISTING',
  NEW_CONTENT: 'NEW_CONTENT'
};
var RESEARCH_RESULT_RECOMMENDATION_LABELS = {
  EXPAND_EXISTING: '扩充现有页面',
  NEW_CONTENT: '新内容',
  WATCH: '继续观察'
};
var OPPORTUNITY_LEVELS = { HIGH: 'HIGH', MEDIUM: 'MEDIUM' };
var OPPORTUNITY_LEVEL_LABELS = { HIGH: '高', MEDIUM: '中' };
var DEVELOPMENT_GOAL_LABELS = {
  EXPAND_EXISTING: '扩充现有页面',
  NEW_PAGE: '新建页面',
  UPDATE_EXISTING: '更新现有页面'
};
var DEVELOPMENT_PRIORITY_LABELS = { HIGH: '高', MEDIUM: '中', LOW: '低' };
var DEVELOPMENT_TASK_STATUS_LABELS = { TODO: '待开发' };

var NOW_TS = '2026-08-17 19:00:00';
var OLD_TS = '2026-08-17 10:00:00';

function cellAt_(row, idx) {
  if (idx === undefined || idx === null || idx < 0) return '';
  var v = row[idx];
  return v === null || v === undefined ? '' : v;
}

function enumFromLabel_(labelMap, value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  if (labelMap[raw]) return raw;
  var keys = Object.keys(labelMap);
  for (var i = 0; i < keys.length; i++) {
    if (labelMap[keys[i]] === raw) return keys[i];
  }
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
    assetTitle: idx_('资产候选标题', 9),
    assetLevel: idx_('当前资产级别', 11),
    evidenceStatus: idx_('证据状态', 12),
    missingEvidence: idx_('缺失证据', 13),
    humanDecision: idx_('人工决定', 14),
    humanNote: idx_('人工备注', 15),
    status: idx_('状态', 16),
    updatedAt: idx_('更新时间', 18),
    researchJobId: idx_('研究任务ID', 19),
    researchRequestedAt: idx_('研究请求时间', 20)
  };
}

function emptyWinnerAssetResearchSyncSummary_() {
  return {
    scanned: 0,
    ready: 0,
    archived: 0,
    pending: 0,
    awaitingReview: 0,
    watch: 0,
    failed: 0,
    missingJob: 0,
    skippedInvalidBinding: 0,
    skippedLocked: 0
  };
}

function researchJobSyncCol_(headerRow) {
  var headers = headerRow && headerRow.length ? headerRow : RESEARCH_JOB_HEADERS;
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i] || '').trim();
    if (name && map[name] === undefined) map[name] = i;
  }
  function idx_(name, fallback) {
    return map[name] !== undefined ? map[name] : fallback;
  }
  return {
    jobId: idx_('任务ID', 0),
    status: idx_('任务状态', 9),
    reviewDecision: idx_('审核决定', 18)
  };
}

function indexResearchJobsById_(jobRows, jobHeaders) {
  var col = researchJobSyncCol_(jobHeaders);
  var map = {};
  for (var i = 0; i < (jobRows || []).length; i++) {
    var jobId = String(cellAt_(jobRows[i], col.jobId) || '').trim();
    if (jobId && !map[jobId]) map[jobId] = jobRows[i];
  }
  return map;
}

function isWinnerAssetResearchJobId_(jobId) {
  return /^asset-/.test(String(jobId || '').trim());
}

function padWinnerAssetRow_(row) {
  var out = (row || []).slice();
  while (out.length < WINNER_ASSET_HEADERS.length) out.push('');
  return out;
}

function researchJobStatusEnum_(value) {
  return enumFromLabel_(RESEARCH_JOB_STATUS_LABELS, String(value || '').trim());
}

function researchReviewDecisionEnum_(value) {
  return enumFromLabel_(RESEARCH_REVIEW_DECISION_LABELS, String(value || '').trim());
}

function isWinnerAssetResearchApprovedForReady_(statusEnum, decisionEnum) {
  return (
    statusEnum === RESEARCH_JOB_STATUS.APPROVED &&
    decisionEnum === RESEARCH_REVIEW_DECISION.APPROVE
  );
}

function syncWinnerAssetResearchRows_(assetRows, researchRows, opts) {
  opts = opts || {};
  var nowTs = opts.nowTs || '';
  var col = winnerAssetDecisionCol_(opts.assetHeaders);
  var jobCol = researchJobSyncCol_(opts.researchHeaders);
  var jobsById = indexResearchJobsById_(researchRows, opts.researchHeaders);
  var summary = emptyWinnerAssetResearchSyncSummary_();
  var warnings = [];
  var outAssets = [];
  var changed = false;

  for (var i = 0; i < (assetRows || []).length; i++) {
    var row = padWinnerAssetRow_(assetRows[i]);
    outAssets.push(row);

    var status = String(cellAt_(row, col.status) || '').trim() || ASSET_STATUS.CANDIDATE;
    if (
      status === ASSET_STATUS.READY ||
      status === ASSET_STATUS.ARCHIVED ||
      status === ASSET_STATUS.DONE
    ) {
      summary.skippedLocked += 1;
      continue;
    }
    if (status !== ASSET_STATUS.RESEARCH) continue;

    var jobId = String(cellAt_(row, col.researchJobId) || '').trim();
    if (!jobId) continue;

    summary.scanned += 1;
    var siteName = String(cellAt_(row, col.siteName) || '').trim();
    var winnerPage = String(cellAt_(row, col.winnerPage) || '').trim();
    var assetKey = siteName + '||' + winnerPage;

    if (!isWinnerAssetResearchJobId_(jobId)) {
      summary.skippedInvalidBinding += 1;
      warnings.push(
        '内容资产绑定非 Winner Asset 研究任务 asset=' + assetKey + ' job_id=' + jobId
      );
      continue;
    }

    var jobRow = jobsById[jobId];
    if (!jobRow) {
      summary.missingJob += 1;
      warnings.push(
        '内容资产绑定研究任务不存在 asset=' + assetKey + ' job_id=' + jobId
      );
      continue;
    }

    var jobStatusEnum = researchJobStatusEnum_(cellAt_(jobRow, jobCol.status));
    var decisionEnum = researchReviewDecisionEnum_(cellAt_(jobRow, jobCol.reviewDecision));

    if (jobStatusEnum === RESEARCH_JOB_STATUS.PENDING) {
      summary.pending += 1;
      continue;
    }
    if (jobStatusEnum === RESEARCH_JOB_STATUS.REVIEW) {
      summary.awaitingReview += 1;
      continue;
    }
    if (jobStatusEnum === RESEARCH_JOB_STATUS.WATCH) {
      summary.watch += 1;
      continue;
    }
    if (jobStatusEnum === RESEARCH_JOB_STATUS.FAILED) {
      summary.failed += 1;
      continue;
    }
    if (jobStatusEnum === RESEARCH_JOB_STATUS.ARCHIVED) {
      row[col.status] = ASSET_STATUS.ARCHIVED;
      row[col.updatedAt] = nowTs;
      summary.archived += 1;
      changed = true;
      continue;
    }
    if (isWinnerAssetResearchApprovedForReady_(jobStatusEnum, decisionEnum)) {
      row[col.status] = ASSET_STATUS.READY;
      row[col.evidenceStatus] = ASSET_EVIDENCE_STATUS.READY;
      row[col.missingEvidence] = '';
      row[col.updatedAt] = nowTs;
      summary.ready += 1;
      changed = true;
      continue;
    }
    if (jobStatusEnum === RESEARCH_JOB_STATUS.APPROVED) {
      summary.awaitingReview += 1;
    }
  }

  return {
    assets: outAssets,
    changed: changed,
    summary: summary,
    warnings: warnings
  };
}

function assetRow_(opts) {
  opts = opts || {};
  return [
    '2026-08-17',
    opts.siteName || 'Agefield High: Rock the School',
    opts.winnerPage || '/classes/',
    opts.winnerIntent === undefined ? '' : opts.winnerIntent,
    26,
    230,
    8,
    3,
    'VERIFIED_GUIDE',
    opts.assetTitle || 'Classes evidence',
    'candidate reason',
    'NORMAL_PAGE',
    opts.evidenceStatus === undefined ? ASSET_EVIDENCE_STATUS.PARTIAL : opts.evidenceStatus,
    opts.missingEvidence === undefined ? 'need first-hand answers' : opts.missingEvidence,
    opts.humanDecision || 'APPROVE',
    opts.humanNote || 'keep this note',
    opts.status || ASSET_STATUS.RESEARCH,
    OLD_TS,
    opts.updatedAt || OLD_TS,
    opts.researchJobId === undefined ? 'asset-agefield-classes' : opts.researchJobId,
    opts.researchRequestedAt || OLD_TS
  ];
}

function jobRow_(opts) {
  opts = opts || {};
  var row = [];
  for (var i = 0; i < RESEARCH_JOB_HEADERS.length; i++) row.push('');
  row[0] = opts.jobId || 'asset-agefield-classes';
  row[2] = opts.siteName || 'Agefield High: Rock the School';
  row[3] = opts.siteName || 'Agefield High: Rock the School';
  row[4] = opts.topic || 'verified guide evidence';
  row[5] = opts.pagePath || '/classes/';
  row[6] = opts.level || '高';
  row[7] = '研究并扩充现有页面';
  row[8] = opts.topic || 'verified guide evidence';
  row[9] = opts.status || RESEARCH_JOB_STATUS_LABELS.PENDING;
  row[11] = opts.result || '扩充现有页面';
  row[17] = opts.evidenceLink || 'https://example.test/review/asset-agefield-classes';
  row[18] = opts.decision === undefined ? '' : opts.decision;
  return row;
}

function sync_(assets, jobs) {
  return syncWinnerAssetResearchRows_(assets, jobs, {
    nowTs: NOW_TS,
    assetHeaders: WINNER_ASSET_HEADERS,
    researchHeaders: RESEARCH_JOB_HEADERS
  });
}

function headerIndexMap_(header) {
  var map = {};
  for (var i = 0; i < header.length; i++) {
    var name = String(header[i] || '').trim();
    if (name && map[name] === undefined) map[name] = i;
  }
  return map;
}

function cell_(row, col, name) {
  var idx = col[name];
  if (idx === undefined) return '';
  return row[idx];
}

function isResearchJobReadyForDevelopment_(status, decision) {
  var statusRaw = String(status || '').trim();
  var decisionRaw = String(decision || '').trim();
  if (!statusRaw || !decisionRaw) return false;
  var statusEnum = statusRaw;
  if (statusRaw === RESEARCH_JOB_STATUS_LABELS.APPROVED) {
    statusEnum = RESEARCH_JOB_STATUS.APPROVED;
  } else if (statusRaw !== RESEARCH_JOB_STATUS.APPROVED) {
    statusEnum = enumFromLabel_(RESEARCH_JOB_STATUS_LABELS, statusRaw);
  }
  var decisionEnum = decisionRaw;
  if (decisionRaw === RESEARCH_REVIEW_DECISION_LABELS.APPROVE) {
    decisionEnum = RESEARCH_REVIEW_DECISION.APPROVE;
  } else if (decisionRaw !== RESEARCH_REVIEW_DECISION.APPROVE) {
    decisionEnum = enumFromLabel_(RESEARCH_REVIEW_DECISION_LABELS, decisionRaw);
  }
  return (
    statusEnum === RESEARCH_JOB_STATUS.APPROVED &&
    decisionEnum === RESEARCH_REVIEW_DECISION.APPROVE
  );
}

function developmentGoalFromResearchResult_(resultLabel) {
  var raw = String(resultLabel || '').trim();
  if (!raw) return DEVELOPMENT_GOAL_LABELS.UPDATE_EXISTING;
  var recEnum = enumFromLabel_(RESEARCH_RESULT_RECOMMENDATION_LABELS, raw);
  if (recEnum === RESEARCH_RESULT_RECOMMENDATIONS.EXPAND_EXISTING) {
    return DEVELOPMENT_GOAL_LABELS.EXPAND_EXISTING;
  }
  if (recEnum === RESEARCH_RESULT_RECOMMENDATIONS.NEW_CONTENT) {
    return DEVELOPMENT_GOAL_LABELS.NEW_PAGE;
  }
  if (raw === DEVELOPMENT_GOAL_LABELS.EXPAND_EXISTING) return DEVELOPMENT_GOAL_LABELS.EXPAND_EXISTING;
  if (raw === DEVELOPMENT_GOAL_LABELS.NEW_PAGE || raw === '新内容') {
    return DEVELOPMENT_GOAL_LABELS.NEW_PAGE;
  }
  if (raw === DEVELOPMENT_GOAL_LABELS.UPDATE_EXISTING || raw.indexOf('更新') >= 0) {
    return DEVELOPMENT_GOAL_LABELS.UPDATE_EXISTING;
  }
  return DEVELOPMENT_GOAL_LABELS.UPDATE_EXISTING;
}

function developmentPriorityFromLevel_(levelLabel) {
  var raw = String(levelLabel || '').trim();
  var levelEnum = enumFromLabel_(OPPORTUNITY_LEVEL_LABELS, raw);
  if (levelEnum === OPPORTUNITY_LEVELS.HIGH || raw === '高') return DEVELOPMENT_PRIORITY_LABELS.HIGH;
  if (levelEnum === OPPORTUNITY_LEVELS.MEDIUM || raw === '中') {
    return DEVELOPMENT_PRIORITY_LABELS.MEDIUM;
  }
  return DEVELOPMENT_PRIORITY_LABELS.LOW;
}

function developmentTaskIdFromSource_(sourceJobId) {
  return 'dev-' + String(sourceJobId || '').trim();
}

function buildDevelopmentTaskFromResearchRow_(row, col, createdAt) {
  var sourceId = String(cell_(row, col, '任务ID') || '').trim();
  return {
    development_task_id: developmentTaskIdFromSource_(sourceId),
    created_at: createdAt || new Date(),
    source_job_id: sourceId,
    site: String(cell_(row, col, '站点') || '').trim(),
    game: String(cell_(row, col, '游戏') || '').trim(),
    page_path: String(cell_(row, col, '页面路径') || '').trim(),
    goal: developmentGoalFromResearchResult_(String(cell_(row, col, '研究结果') || '').trim()),
    evidence_link: String(cell_(row, col, '审核链接') || '').trim(),
    priority: developmentPriorityFromLevel_(String(cell_(row, col, '机会等级') || '').trim()),
    status: DEVELOPMENT_TASK_STATUS_LABELS.TODO,
    completed_at: '',
    note: ''
  };
}

// 1. RESEARCH + PENDING → RESEARCH
var pending = sync_(
  [assetRow_()],
  [jobRow_({ status: RESEARCH_JOB_STATUS.PENDING })]
);
assert(pending.assets[0][16] === ASSET_STATUS.RESEARCH, '1 stays RESEARCH');
assert(pending.assets[0][18] === OLD_TS, '1 does not refresh 更新时间');
assert(pending.changed === false, '1 no sheet change');
assert(pending.summary.pending === 1, '1 pending counted');

// 2. RESEARCH + REVIEW → RESEARCH
var review = sync_(
  [assetRow_()],
  [jobRow_({ status: RESEARCH_JOB_STATUS.REVIEW, decision: '批准开发' })]
);
assert(review.assets[0][16] === ASSET_STATUS.RESEARCH, '2 REVIEW stays RESEARCH');
assert(review.assets[0][18] === OLD_TS, '2 REVIEW does not refresh time');
assert(review.summary.awaitingReview === 1, '2 awaitingReview');

// 3. RESEARCH + APPROVED + APPROVE → READY
var approved = sync_(
  [assetRow_()],
  [jobRow_({ status: RESEARCH_JOB_STATUS.APPROVED, decision: RESEARCH_REVIEW_DECISION.APPROVE })]
);
assert(approved.assets[0][16] === ASSET_STATUS.READY, '3 READY');
assert(approved.summary.ready === 1, '3 ready counted');
assert(approved.changed === true, '3 changed');

// 4. RESEARCH + APPROVED + 批准开发中文 → READY
var zhReady = sync_(
  [assetRow_()],
  [jobRow_({ status: '已批准', decision: '批准开发' })]
);
assert(zhReady.assets[0][16] === ASSET_STATUS.READY, '4 中文批准开发 → READY');

// 5–7. Evidence / missing / human fields
assert(zhReady.assets[0][12] === ASSET_EVIDENCE_STATUS.READY, '5 EvidenceStatus READY');
assert(zhReady.assets[0][13] === '', '6 MissingEvidence cleared');
assert(zhReady.assets[0][9] === 'Classes evidence', '7 asset title preserved');
assert(zhReady.assets[0][15] === 'keep this note', '7 human note preserved');
assert(zhReady.assets[0][14] === 'APPROVE', '7 human decision preserved');
assert(zhReady.assets[0][11] === 'NORMAL_PAGE', '7 asset level preserved');
assert(zhReady.assets[0][10] === 'candidate reason', '7 reason preserved');
assert(zhReady.assets[0][19] === 'asset-agefield-classes', '7 research job id preserved');
assert(zhReady.assets[0][20] === OLD_TS, '7 research requested at preserved');
assert(zhReady.assets[0][4] === 26, '7 GSC clicks preserved');
assert(zhReady.assets[0][18] === NOW_TS, '7 更新时间 only on READY');

// 8. APPROVED 但无审核决定 → 不 READY
var approvedNoDecision = sync_(
  [assetRow_()],
  [jobRow_({ status: RESEARCH_JOB_STATUS.APPROVED, decision: '' })]
);
assert(approvedNoDecision.assets[0][16] === ASSET_STATUS.RESEARCH, '8 no decision stays RESEARCH');
assert(approvedNoDecision.changed === false, '8 no change');

// 9. APPROVED + WATCH 决定 → 不 READY
var approvedWatch = sync_(
  [assetRow_()],
  [jobRow_({ status: RESEARCH_JOB_STATUS.APPROVED, decision: RESEARCH_REVIEW_DECISION.WATCH })]
);
assert(approvedWatch.assets[0][16] === ASSET_STATUS.RESEARCH, '9 APPROVED+WATCH stays RESEARCH');

// 10. WATCH → RESEARCH
var watch = sync_(
  [assetRow_()],
  [jobRow_({ status: RESEARCH_JOB_STATUS.WATCH })]
);
assert(watch.assets[0][16] === ASSET_STATUS.RESEARCH, '10 WATCH stays RESEARCH');
assert(watch.assets[0][14] === 'APPROVE', '10 does not rewrite human decision');
assert(watch.summary.watch === 1, '10 watch counted');

// 11. FAILED → RESEARCH
var failed = sync_(
  [assetRow_()],
  [jobRow_({ status: RESEARCH_JOB_STATUS.FAILED })]
);
assert(failed.assets[0][16] === ASSET_STATUS.RESEARCH, '11 FAILED stays RESEARCH');
assert(failed.summary.failed === 1, '11 failed counted');

// 12. ARCHIVED → Asset ARCHIVED
var archived = sync_(
  [assetRow_({ evidenceStatus: ASSET_EVIDENCE_STATUS.PARTIAL, missingEvidence: 'still missing' })],
  [jobRow_({ status: RESEARCH_JOB_STATUS.ARCHIVED })]
);
assert(archived.assets[0][16] === ASSET_STATUS.ARCHIVED, '12 Asset ARCHIVED');
assert(archived.assets[0][12] === ASSET_EVIDENCE_STATUS.PARTIAL, '12 evidence kept');
assert(archived.assets[0][13] === 'still missing', '12 missing evidence kept');
assert(archived.assets[0][15] === 'keep this note', '12 note kept');
assert(archived.assets[0][19] === 'asset-agefield-classes', '12 job id kept');
assert(archived.summary.archived === 1, '12 archived counted');

// 13. Job 不存在 → 不改
var missing = sync_([assetRow_({ researchJobId: 'asset-agefield-classes' })], []);
assert(missing.assets[0][16] === ASSET_STATUS.RESEARCH, '13 missing job no change');
assert(missing.summary.missingJob === 1, '13 missingJob counted');
assert(
  missing.warnings[0].indexOf('内容资产绑定研究任务不存在') >= 0 &&
    missing.warnings[0].indexOf('asset-agefield-classes') >= 0,
  '13 WARN text'
);

// 14. 非 asset-* 绑定 → 不改
var invalid = sync_(
  [assetRow_({ researchJobId: 'ms2-beta-progress-carry-over-20260817' })],
  [jobRow_({ jobId: 'ms2-beta-progress-carry-over-20260817', status: '已批准', decision: '批准开发' })]
);
assert(invalid.assets[0][16] === ASSET_STATUS.RESEARCH, '14 opportunity job not synced');
assert(invalid.summary.skippedInvalidBinding === 1, '14 skippedInvalidBinding');
assert(invalid.warnings[0].indexOf('ms2-beta-progress-carry-over-20260817') >= 0, '14 WARN job id');

// 15. Asset 已 READY → 不处理
var alreadyReady = sync_(
  [assetRow_({ status: ASSET_STATUS.READY, updatedAt: OLD_TS })],
  [jobRow_({ status: '已批准', decision: '批准开发' })]
);
assert(alreadyReady.assets[0][16] === ASSET_STATUS.READY, '15 stays READY');
assert(alreadyReady.assets[0][18] === OLD_TS, '15 READY does not refresh time');
assert(alreadyReady.summary.skippedLocked === 1, '15 skippedLocked');
assert(alreadyReady.summary.scanned === 0, '15 not scanned');

// 16. Asset 已 ARCHIVED → 不处理
var alreadyArchived = sync_(
  [assetRow_({ status: ASSET_STATUS.ARCHIVED, updatedAt: OLD_TS })],
  [jobRow_({ status: '已归档' })]
);
assert(alreadyArchived.assets[0][16] === ASSET_STATUS.ARCHIVED, '16 stays ARCHIVED');
assert(alreadyArchived.assets[0][18] === OLD_TS, '16 ARCHIVED does not refresh time');
assert(alreadyArchived.summary.skippedLocked === 1, '16 skippedLocked');

// 17. 第二次同步 APPROVED 不更新时间
var firstReady = sync_(
  [assetRow_()],
  [jobRow_({ status: '已批准', decision: '批准开发' })]
);
var secondReady = sync_(
  [firstReady.assets[0]],
  [jobRow_({ status: '已批准', decision: '批准开发' })]
);
assert(secondReady.assets[0][16] === ASSET_STATUS.READY, '17 stays READY');
assert(secondReady.assets[0][18] === NOW_TS, '17 keeps first READY timestamp');
assert(secondReady.changed === false, '17 second run no change');

// 18. REVIEW 连续同步不更新时间
var review1 = sync_(
  [assetRow_()],
  [jobRow_({ status: '待审核' })]
);
var review2 = sync_(
  [review1.assets[0]],
  [jobRow_({ status: '待审核' })]
);
assert(review1.assets[0][18] === OLD_TS && review2.assets[0][18] === OLD_TS, '18 REVIEW no time bump');
assert(review2.changed === false, '18 second REVIEW no change');

// 19–21. enum / 中文
assert(researchJobStatusEnum_('APPROVED') === 'APPROVED', '19 APPROVED enum');
assert(researchJobStatusEnum_('已批准') === 'APPROVED', '19 已批准');
assert(researchReviewDecisionEnum_('APPROVE') === 'APPROVE', '20 APPROVE enum');
assert(researchReviewDecisionEnum_('批准开发') === 'APPROVE', '20 批准开发');
assert(researchJobStatusEnum_('ARCHIVED') === 'ARCHIVED', '21 ARCHIVED enum');
assert(researchJobStatusEnum_('已归档') === 'ARCHIVED', '21 已归档');

var zhArchived = sync_([assetRow_()], [jobRow_({ status: '已归档' })]);
assert(zhArchived.assets[0][16] === ASSET_STATUS.ARCHIVED, '21 已归档 → Asset ARCHIVED');

// 22. asset-* Research Job 可被现有 Development Task 消费
var approvedJob = jobRow_({
  jobId: 'asset-agefield-classes',
  status: '已批准',
  decision: '批准开发',
  result: '扩充现有页面',
  evidenceLink: 'https://example.test/review/asset-agefield-classes',
  pagePath: '/classes/'
});
assert(
  isResearchJobReadyForDevelopment_(approvedJob[9], approvedJob[18]) === true,
  '22 asset job is ready for development'
);
var mockCol = headerIndexMap_(RESEARCH_JOB_HEADERS);
var task = buildDevelopmentTaskFromResearchRow_(approvedJob, mockCol, NOW_TS);
assert(task.development_task_id === 'dev-asset-agefield-classes', '22 dev-asset-agefield-classes');
assert(task.source_job_id === 'asset-agefield-classes', '22 source_job_id');
assert(task.goal === '扩充现有页面', '22 goal');
assert(task.evidence_link === 'https://example.test/review/asset-agefield-classes', '22 evidence_link');
assert(task.page_path === '/classes/', '22 page_path');
assert(task.status === '待开发', '22 initial 待开发');

// Source wiring
var winnerSrc = fs.readFileSync(path.join(__dirname, '..', 'WinnerAsset.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
var configSrc = fs.readFileSync(path.join(__dirname, '..', 'Config.gs'), 'utf8');
var researchSrc = fs.readFileSync(path.join(__dirname, '..', 'ResearchJobs.gs'), 'utf8');
var dailySrc = codeSrc.slice(
  codeSrc.indexOf('function runDaily'),
  codeSrc.indexOf('function runDailyUnlocked_')
);
var reviewFn = researchSrc.slice(
  researchSrc.indexOf('function processResearchReviewDecisions'),
  researchSrc.indexOf('function requireResearchReviewGateColumns_')
);

assert(winnerSrc.indexOf('function syncWinnerAssetResearchResults()') >= 0, 'sync entry exists');
assert(winnerSrc.indexOf('function syncWinnerAssetResearchRows_(') >= 0, 'pure helper exists');
assert(
  codeSrc.indexOf("addItem('同步内容资产研究结果', 'syncWinnerAssetResearchResults')") >= 0,
  'menu item'
);
assert(dailySrc.indexOf('syncWinnerAssetResearchResults') < 0, 'runDaily must not call sync');
assert(
  reviewFn.indexOf('syncWinnerAssetResearchResults') < 0,
  'processResearchReviewDecisions must not tail-call sync'
);
assert(
  winnerSrc.indexOf('createDevelopmentTasks(') < 0,
  'WinnerAsset must not call createDevelopmentTasks'
);
assert(
  /'审核决定',\s*'审核备注',\s*'审核时间',\s*'研究类型'/.test(configSrc),
  'RESEARCH_JOB_HEADERS keeps 研究类型 after 审核时间'
);
assert(/var RESEARCH_TYPE/.test(configSrc), 'defines RESEARCH_TYPE for ASSET_RESEARCH');
assert(WINNER_ASSET_HEADERS.length === 21, 'no new winner asset columns');
assert(WINNER_ASSET_HEADERS[19] === '研究任务ID', 'binding stays 研究任务ID');

console.log('PASS scripts/test-winner-asset-research-sync.js');
