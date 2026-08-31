/**
 * M3：已批准 → 开发任务队列。
 * 扫描「研究任务」，仅为「已批准 + 批准开发」创建「开发任务」。
 * 不调用 Codex、不改游戏网站、不改研究任务状态。
 */

/**
 * 从「研究任务」创建开发任务。幂等：同一来源任务ID 仅一条。
 * @return {string}
 */
function createDevelopmentTasks() {
  ensureDevelopmentTaskSheets_();
  var researchSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  var devSheet = ensureSheet_(SHEET_NAMES.DEVELOPMENT_TASKS, DEVELOPMENT_TASK_HEADERS);
  if (!researchSheet || researchSheet.getLastRow() < 2) {
    var emptyMsg =
      'createDevelopmentTasks 结束 created=0 skippedExisting=0（研究任务为空）';
    writeLog_('INFO', '', emptyMsg);
    Logger.log(emptyMsg);
    return emptyMsg;
  }

  var existing = loadExistingDevelopmentSourceIds_(devSheet);
  var lastCol = Math.max(researchSheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = researchSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var n = researchSheet.getLastRow() - 1;
  var rows = researchSheet.getRange(2, 1, n, lastCol).getValues();

  var createdRows = [];
  var created = 0;
  var skippedExisting = 0;
  var now = new Date();

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var sourceId = String(cell_(row, col, '任务ID') || '').trim();
    if (!sourceId) continue;

    var status = String(cell_(row, col, '任务状态') || '').trim();
    var decision = String(cell_(row, col, '审核决定') || '').trim();
    if (!isResearchJobReadyForDevelopment_(status, decision)) continue;

    if (existing[sourceId]) {
      skippedExisting++;
      continue;
    }

    var task = buildDevelopmentTaskFromResearchRow_(row, col, now);
    createdRows.push(developmentTaskSheetRow_(task));
    existing[sourceId] = true;
    created++;
  }

  if (createdRows.length) {
    var start = devSheet.getLastRow() + 1;
    if (start < 2) start = 2;
    devSheet
      .getRange(start, 1, createdRows.length, DEVELOPMENT_TASK_HEADERS.length)
      .setValues(createdRows);
  }

  var summary =
    'createDevelopmentTasks 结束 created=' +
    created +
    ' skippedExisting=' +
    skippedExisting;
  writeLog_('INFO', '', summary);
  Logger.log(summary);
  return summary;
}

function ensureDevelopmentTaskSheets_() {
  ensureSheet_(SHEET_NAMES.DEVELOPMENT_TASKS, DEVELOPMENT_TASK_HEADERS);
  ensureDevelopmentTaskHeader_();
}

function ensureDevelopmentTaskHeader_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DEVELOPMENT_TASKS);
  if (!sheet) return;
  ensureDevelopmentTaskColumns_(sheet);
}

/** 仅追加「开发任务」缺失列；不改已有数据。 */
function ensureDevelopmentTaskColumns_(sheet) {
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var have = {};
  for (var i = 0; i < header.length; i++) {
    var name = String(header[i] || '').trim();
    if (name) have[name] = true;
  }
  var toAdd = [];
  for (var n = 0; n < DEVELOPMENT_TASK_HEADERS.length; n++) {
    if (!have[DEVELOPMENT_TASK_HEADERS[n]]) toAdd.push(DEVELOPMENT_TASK_HEADERS[n]);
  }
  if (!toAdd.length) return;

  var startCol = lastCol + 1;
  if (String(header[header.length - 1] || '').trim() === '') {
    startCol = lastCol;
  }
  sheet.getRange(1, startCol, 1, toAdd.length).setValues([toAdd]);
  sheet.getRange(1, startCol, 1, toAdd.length).setFontWeight('bold');
}

/**
 * @return {Object<string, boolean>} source_job_id → true
 */
function loadExistingDevelopmentSourceIds_(sheet) {
  var map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var srcIdx = col['来源任务ID'];
  if (srcIdx === undefined) return map;
  var n = sheet.getLastRow() - 1;
  var values = sheet.getRange(2, srcIdx + 1, n, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var id = String(values[i][0] || '').trim();
    if (id) map[id] = true;
  }
  return map;
}

/**
 * 仅：任务状态=已批准 且 审核决定=批准开发。
 */
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

function buildDevelopmentTaskFromResearchRow_(row, col, createdAt) {
  var sourceId = String(cell_(row, col, '任务ID') || '').trim();
  return {
    development_task_id: developmentTaskIdFromSource_(sourceId),
    created_at: createdAt || new Date(),
    source_job_id: sourceId,
    site: String(cell_(row, col, '站点') || '').trim(),
    game: String(cell_(row, col, '游戏') || '').trim(),
    page_path: String(cell_(row, col, '页面路径') || '').trim(),
    goal: developmentGoalFromResearchResult_(
      String(cell_(row, col, '研究结果') || '').trim()
    ),
    evidence_link: String(cell_(row, col, '审核链接') || '').trim(),
    priority: developmentPriorityFromLevel_(
      String(cell_(row, col, '机会等级') || '').trim()
    ),
    status: DEVELOPMENT_TASK_STATUS_LABELS.TODO,
    completed_at: '',
    note: ''
  };
}

function developmentTaskIdFromSource_(sourceJobId) {
  return 'dev-' + String(sourceJobId || '').trim();
}

/**
 * 研究结果 → 短中文开发目标。
 * EXPAND_EXISTING → 扩充现有页面；NEW_CONTENT → 新建页面；其余 → 更新现有页面。
 */
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
  if (raw === DEVELOPMENT_GOAL_LABELS.EXPAND_EXISTING) {
    return DEVELOPMENT_GOAL_LABELS.EXPAND_EXISTING;
  }
  if (raw === DEVELOPMENT_GOAL_LABELS.NEW_PAGE || raw === '新内容') {
    return DEVELOPMENT_GOAL_LABELS.NEW_PAGE;
  }
  if (raw === DEVELOPMENT_GOAL_LABELS.UPDATE_EXISTING || raw.indexOf('更新') >= 0) {
    return DEVELOPMENT_GOAL_LABELS.UPDATE_EXISTING;
  }
  return DEVELOPMENT_GOAL_LABELS.UPDATE_EXISTING;
}

/** 机会等级 → 高 / 中 / 低 */
function developmentPriorityFromLevel_(levelLabel) {
  var raw = String(levelLabel || '').trim();
  var levelEnum = enumFromLabel_(OPPORTUNITY_LEVEL_LABELS, raw);
  if (levelEnum === OPPORTUNITY_LEVELS.HIGH || raw === '高') {
    return DEVELOPMENT_PRIORITY_LABELS.HIGH;
  }
  if (levelEnum === OPPORTUNITY_LEVELS.MEDIUM || raw === '中') {
    return DEVELOPMENT_PRIORITY_LABELS.MEDIUM;
  }
  return DEVELOPMENT_PRIORITY_LABELS.LOW;
}

function developmentTaskSheetRow_(task) {
  return [
    task.development_task_id,
    task.created_at || new Date(),
    task.source_job_id,
    task.site,
    task.game,
    task.page_path,
    task.goal,
    task.evidence_link,
    task.priority,
    task.status || DEVELOPMENT_TASK_STATUS_LABELS.TODO,
    task.completed_at || '',
    task.note || ''
  ];
}

/**
 * 纯逻辑自测（不写 Sheet、不碰生产研究任务）。
 * 覆盖：已批准创建、防重复、已归档/继续观察/待审核不创建。
 * @return {string}
 */
function debugDevelopmentTasksSelfCheck() {
  var fails = [];
  function assert(cond, msg) {
    if (!cond) fails.push(msg);
  }

  assert(
    DEVELOPMENT_TASK_HEADERS.length === 12 &&
      DEVELOPMENT_TASK_HEADERS[0] === '开发任务ID' &&
      DEVELOPMENT_TASK_HEADERS[2] === '来源任务ID' &&
      DEVELOPMENT_TASK_HEADERS[9] === '任务状态',
    '开发任务 headers'
  );
  assert(
    DEVELOPMENT_TASK_STATUS_LABELS.TODO === '待开发',
    '初始状态 待开发'
  );

  assert(
    isResearchJobReadyForDevelopment_('已批准', '批准开发') === true,
    'A: 已批准+批准开发 → ready'
  );
  assert(
    isResearchJobReadyForDevelopment_('APPROVED', 'APPROVE') === true,
    'A: enum 也 ready'
  );

  assert(
    isResearchJobReadyForDevelopment_('已归档', '无需处理') === false,
    'C: 已归档 不创建'
  );
  assert(
    isResearchJobReadyForDevelopment_('继续观察', '') === false,
    'D: 继续观察 不创建'
  );
  assert(
    isResearchJobReadyForDevelopment_('继续观察', '继续观察') === false,
    'D: WATCH+继续观察 不创建'
  );
  assert(
    isResearchJobReadyForDevelopment_('待审核', '') === false,
    'E: 待审核无决定 不创建'
  );
  assert(
    isResearchJobReadyForDevelopment_('待审核', '批准开发') === false,
    'E: 待审核即使填了批准开发也不创建（须已批准）'
  );
  assert(
    isResearchJobReadyForDevelopment_('已批准', '') === false,
    '已批准但无审核决定 不创建'
  );

  var mockCol = headerIndexMap_(RESEARCH_JOB_HEADERS);
  function mockResearchRow(over) {
    var row = [];
    for (var i = 0; i < RESEARCH_JOB_HEADERS.length; i++) row.push('');
    row[mockCol['任务ID']] = 'mock-approved-expand-20260815';
    row[mockCol['站点']] = 'Mock Site';
    row[mockCol['游戏']] = 'Mock Game';
    row[mockCol['页面路径']] = '/mock/page/';
    row[mockCol['机会等级']] = '高';
    row[mockCol['任务状态']] = '已批准';
    row[mockCol['研究结果']] = '扩充现有页面';
    row[mockCol['审核链接']] = 'https://example.com/review#mock';
    row[mockCol['审核决定']] = '批准开发';
    var keys = Object.keys(over || {});
    for (var k = 0; k < keys.length; k++) {
      row[mockCol[keys[k]]] = over[keys[k]];
    }
    return row;
  }

  var createdAt = new Date('2026-08-15T15:00:00+08:00');
  var task = buildDevelopmentTaskFromResearchRow_(mockResearchRow({}), mockCol, createdAt);
  assert(task.development_task_id === 'dev-mock-approved-expand-20260815', 'dev- prefix');
  assert(task.source_job_id === 'mock-approved-expand-20260815', 'source id');
  assert(task.goal === '扩充现有页面', 'goal expand');
  assert(task.priority === '高', 'priority 高');
  assert(task.status === '待开发', 'status 待开发');
  assert(task.completed_at === '', '完成时间 empty');
  assert(task.evidence_link === 'https://example.com/review#mock', 'Evidence 链接复用');

  var sheetRow = developmentTaskSheetRow_(task);
  assert(sheetRow.length === DEVELOPMENT_TASK_HEADERS.length, 'row length');
  assert(sheetRow[9] === '待开发', 'sheet 任务状态');

  assert(
    developmentGoalFromResearchResult_('新内容') === '新建页面',
    '新内容 → 新建页面'
  );
  assert(
    developmentGoalFromResearchResult_('NEW_CONTENT') === '新建页面',
    'NEW_CONTENT → 新建页面'
  );
  assert(
    developmentPriorityFromLevel_('观察') === '低',
    '观察 → 低'
  );

  // B: 防重复 — 同一来源已存在则跳过
  var existing = { 'mock-approved-expand-20260815': true };
  var candidates = [
    mockResearchRow({}),
    mockResearchRow({
      任务ID: 'mock-archived-20260815',
      任务状态: '已归档',
      审核决定: '无需处理'
    }),
    mockResearchRow({
      任务ID: 'mock-watch-20260815',
      任务状态: '继续观察',
      审核决定: ''
    }),
    mockResearchRow({
      任务ID: 'mock-review-20260815',
      任务状态: '待审核',
      审核决定: ''
    }),
    mockResearchRow({
      任务ID: 'mock-approved-new-20260815',
      任务状态: '已批准',
      审核决定: '批准开发',
      研究结果: '新内容',
      机会等级: '中'
    })
  ];

  var created = 0;
  var skippedExisting = 0;
  var built = [];
  for (var c = 0; c < candidates.length; c++) {
    var r = candidates[c];
    var sid = String(cell_(r, mockCol, '任务ID') || '').trim();
    var st = String(cell_(r, mockCol, '任务状态') || '').trim();
    var dec = String(cell_(r, mockCol, '审核决定') || '').trim();
    if (!isResearchJobReadyForDevelopment_(st, dec)) continue;
    if (existing[sid]) {
      skippedExisting++;
      continue;
    }
    var t = buildDevelopmentTaskFromResearchRow_(r, mockCol, createdAt);
    built.push(t);
    existing[sid] = true;
    created++;
  }

  assert(created === 1, 'B/A: 5 mock 中仅 1 条新建（另一条已存在跳过）');
  assert(skippedExisting === 1, 'B: skippedExisting=1');
  assert(
    built[0] && built[0].development_task_id === 'dev-mock-approved-new-20260815',
    '新建的是 mock-approved-new'
  );
  assert(built[0].goal === '新建页面', '新内容目标');
  assert(built[0].priority === '中', '中优先级');

  // 再次扫描：全部跳过
  var created2 = 0;
  var skipped2 = 0;
  for (var c2 = 0; c2 < candidates.length; c2++) {
    var r2 = candidates[c2];
    var sid2 = String(cell_(r2, mockCol, '任务ID') || '').trim();
    var st2 = String(cell_(r2, mockCol, '任务状态') || '').trim();
    var dec2 = String(cell_(r2, mockCol, '审核决定') || '').trim();
    if (!isResearchJobReadyForDevelopment_(st2, dec2)) continue;
    if (existing[sid2]) {
      skipped2++;
      continue;
    }
    created2++;
    existing[sid2] = true;
  }
  assert(created2 === 0 && skipped2 === 2, 'B: 再次运行不重复 created=0 skipped=2');

  var msg;
  if (fails.length) {
    msg = 'FAIL (' + fails.length + '):\n' + fails.join('\n');
  } else {
    msg = 'PASS: Development Tasks self-check';
  }
  Logger.log(msg);
  return msg;
}
