/**
 * Research Job 出口
 * 内容机会 → 标准 Research Job 数据。只写 Sheet，不抓取外部源、不调用 hotword-engine。
 *
 * RESEARCH_EXPAND_EXISTING：同一站点 + 同一承接页 + 同一建议动作 → 1 个 Job。
 * RESEARCH_NEW_CONTENT：仍按 normalized query 各建 1 个 Job。
 */

/**
 * Web App GET：hotword-engine 只读拉取待处理任务。
 * 不写 Sheet、不改任务状态、不执行 Research。
 * 例：?action=pendingResearchJobs
 *
 * 一次性：?action=initResearchWriteToken — 仅当 Script Property 未设置时生成并返回 token。
 */
function doGet(e) {
  var action = '';
  if (e && e.parameter && e.parameter.action) {
    action = String(e.parameter.action).trim();
  }
  if (action === 'pendingResearchJobs') {
    return jsonOutput_({ jobs: loadPendingResearchJobs_() });
  }
  if (action === 'initResearchWriteToken') {
    return jsonOutput_(initResearchWriteToken_());
  }
  if (action === 'researchJobRow') {
    var jobId = e && e.parameter ? String(e.parameter.job_id || '').trim() : '';
    return jsonOutput_(readResearchJobDisplay_(jobId));
  }
  return jsonOutput_({ error: 'unknown_action', jobs: [] });
}

/**
 * Web App POST：hotword-engine 回写研究结果。
 * 需携带 token（JSON body.token 或 query ?token=）；按 job_id 更新「研究任务」单行。
 * 不修改「内容机会」、不新建任务、不执行 Research。
 */
function doPost(e) {
  try {
    var body = parsePostJson_(e);
    if (!body) {
      return jsonOutput_({ ok: false, error: 'invalid_json' });
    }
    if (!checkResearchWriteToken_(e, body)) {
      return jsonOutput_({ ok: false, error: 'unauthorized' });
    }
    return jsonOutput_(writeResearchJobResult_(body));
  } catch (err) {
    return jsonOutput_({
      ok: false,
      error: String((err && err.message) || err || 'unknown_error')
    });
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function parsePostJson_(e) {
  if (!e || !e.postData || e.postData.contents == null) return null;
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    return null;
  }
}

function checkResearchWriteToken_(e, body) {
  var expected = PropertiesService.getScriptProperties().getProperty(
    RESEARCH_JOB_WRITE_TOKEN_PROP
  );
  if (!expected) return false;
  var provided = '';
  if (body && body.token != null) provided = String(body.token).trim();
  if (!provided && e && e.parameter && e.parameter.token != null) {
    provided = String(e.parameter.token).trim();
  }
  return provided !== '' && provided === expected;
}

/**
 * 轮换 Research callback token。由 clasp run 传入，不把 token 写进仓库。
 * @param {string} token
 */
function rotateResearchWriteToken(token) {
  token = String(token || '').trim();
  if (!token) return { ok: false, error: 'empty_token' };
  PropertiesService.getScriptProperties().setProperty(
    RESEARCH_JOB_WRITE_TOKEN_PROP,
    token
  );
  return { ok: true, key: RESEARCH_JOB_WRITE_TOKEN_PROP };
}

/** 仅当未配置时生成 token，不进仓库。 */
function initResearchWriteToken_() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty(RESEARCH_JOB_WRITE_TOKEN_PROP);
  if (existing) {
    return { ok: false, error: 'already_configured' };
  }
  var token = Utilities.getUuid().replace(/-/g, '');
  props.setProperty(RESEARCH_JOB_WRITE_TOKEN_PROP, token);
  return { ok: true, token: token };
}

/**
 * 按 job_id 回写研究任务结果。不存在则 error，不新增行。
 * REVIEW + evidence：幂等写入「研究审核」，并回写审核摘要 / 审核链接。
 * WATCH：证据不足继续观察；不写「研究审核」，审核链接清空。
 * 旧 payload（无 evidence / review_summary）：仍更新状态与结果字段，不删已有审核证据。
 * FAILED：不写 Evidence 行。
 * @param {Object} body
 * @return {Object}
 */
function writeResearchJobResult_(body) {
  var jobId = String((body && body.job_id) || '').trim();
  if (!jobId) return { ok: false, error: 'missing_job_id' };

  var statusEnum = String((body && body.status) || '').trim();
  if (
    statusEnum !== RESEARCH_JOB_STATUS.REVIEW &&
    statusEnum !== RESEARCH_JOB_STATUS.WATCH &&
    statusEnum !== RESEARCH_JOB_STATUS.FAILED
  ) {
    return { ok: false, error: 'invalid_status' };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { ok: false, error: 'no_spreadsheet' };
  var sheet = ss.getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet) return { ok: false, error: 'sheet_missing' };

  ensureResearchJobResultColumns_(sheet);
  SpreadsheetApp.flush();

  var lastCol = Math.max(sheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  if (col['任务ID'] === undefined) return { ok: false, error: 'missing_job_id_column' };

  var found = findResearchJobRowById_(sheet, col, jobId);
  if (!found) return { ok: false, error: 'job_not_found', job_id: jobId };

  var completedAt = new Date();
  var statusLabel = opportunityLabel_(RESEARCH_JOB_STATUS_LABELS, statusEnum);
  var recEnum = '';
  var recLabel = '';
  var evidenceCount = '';
  var resultPath = '';
  var errorMsg = '';
  var reviewSummary = '';
  var reviewLink = '';
  var wroteEvidence = false;
  var evidenceRowsWritten = 0;

  if (statusEnum === RESEARCH_JOB_STATUS.FAILED) {
    errorMsg = String((body && body.error) || '').trim();
  } else if (statusEnum === RESEARCH_JOB_STATUS.WATCH) {
    // 证据不足：更新任务行，绝不写入「研究审核」。
    recEnum = String((body && body.recommendation) || 'WATCH').trim() || 'WATCH';
    if (!RESEARCH_RESULT_RECOMMENDATION_LABELS[recEnum]) {
      return { ok: false, error: 'invalid_recommendation' };
    }
    recLabel = opportunityLabel_(RESEARCH_RESULT_RECOMMENDATION_LABELS, recEnum);
    if (body && body.evidence_count != null && body.evidence_count !== '') {
      evidenceCount = Number(body.evidence_count);
      if (isNaN(evidenceCount)) return { ok: false, error: 'invalid_evidence_count' };
    } else {
      evidenceCount = 0;
    }
    resultPath = String((body && body.result_path) || '').trim();
    if (body && body.review_summary != null) {
      reviewSummary = String(body.review_summary || '').trim();
    }
    reviewLink = '';
  } else {
    recEnum = String((body && body.recommendation) || '').trim();
    if (recEnum && !RESEARCH_RESULT_RECOMMENDATION_LABELS[recEnum]) {
      return { ok: false, error: 'invalid_recommendation' };
    }
    recLabel = recEnum
      ? opportunityLabel_(RESEARCH_RESULT_RECOMMENDATION_LABELS, recEnum)
      : '';
    if (body && body.evidence_count != null && body.evidence_count !== '') {
      evidenceCount = Number(body.evidence_count);
      if (isNaN(evidenceCount)) return { ok: false, error: 'invalid_evidence_count' };
    }
    resultPath = String((body && body.result_path) || '').trim();
    if (body && body.review_summary != null) {
      reviewSummary = String(body.review_summary || '').trim();
    }

    if (body && Object.prototype.toString.call(body.evidence) === '[object Array]') {
      var jobRow = sheet.getRange(found.sheetRow, 1, 1, lastCol).getValues()[0];
      var reviewResult = writeResearchReviewEvidence_(ss, {
        jobId: jobId,
        site: String(cell_(jobRow, col, '站点') || '').trim(),
        game: String(cell_(jobRow, col, '游戏') || cell_(jobRow, col, '站点') || '').trim(),
        topic: String(cell_(jobRow, col, '搜索词 / topic') || '').trim(),
        pagePath: String(cell_(jobRow, col, '页面路径') || '').trim(),
        evidence: body.evidence,
        researchedAt: completedAt
      });
      wroteEvidence = true;
      evidenceRowsWritten = reviewResult.rows;
      reviewLink = reviewResult.link || '';
    }
  }

  setCellIf_(sheet, found.sheetRow, col, '任务状态', statusLabel);
  setCellIf_(sheet, found.sheetRow, col, '研究结果', recLabel);
  setCellIf_(sheet, found.sheetRow, col, '证据数量', evidenceCount);
  setCellIf_(sheet, found.sheetRow, col, '结果路径', resultPath);
  setCellIf_(sheet, found.sheetRow, col, '完成时间', completedAt);
  setCellIf_(sheet, found.sheetRow, col, '错误信息', errorMsg);
  if (statusEnum === RESEARCH_JOB_STATUS.REVIEW) {
    if (body && body.review_summary != null) {
      setCellIf_(sheet, found.sheetRow, col, '审核摘要', reviewSummary);
    }
    if (wroteEvidence) {
      setCellIf_(sheet, found.sheetRow, col, '审核链接', reviewLink);
    }
  } else if (statusEnum === RESEARCH_JOB_STATUS.WATCH) {
    if (body && body.review_summary != null) {
      setCellIf_(sheet, found.sheetRow, col, '审核摘要', reviewSummary);
    }
    setCellIf_(sheet, found.sheetRow, col, '审核链接', '');
  }
  SpreadsheetApp.flush();

  return {
    ok: true,
    job_id: jobId,
    status: statusEnum,
    recommendation: recEnum || null,
    evidence_count: evidenceCount === '' ? null : evidenceCount,
    result_path: resultPath || null,
    review_summary: reviewSummary || null,
    evidence_rows: wroteEvidence ? evidenceRowsWritten : null,
    review_link: wroteEvidence ? reviewLink || null : null,
    completed_at: toIso8601_(completedAt),
    display: {
      任务状态: statusLabel,
      研究结果: recLabel,
      证据数量: evidenceCount === '' ? '' : evidenceCount,
      结果路径: resultPath,
      完成时间: toIso8601_(completedAt),
      错误信息: errorMsg,
      审核摘要: reviewSummary,
      审核链接: reviewLink
    }
  };
}

/**
 * 幂等写入「研究审核」：先删同 job_id 旧行，再追加本批 evidence。
 * @param {Spreadsheet} ss
 * @param {Object} opts
 * @return {{rows:number, link:string, startRow:number, endRow:number}}
 */
function writeResearchReviewEvidence_(ss, opts) {
  var reviewSheet = ensureResearchReviewSheet_();
  ensureResearchReviewHeader_(reviewSheet);
  SpreadsheetApp.flush();

  var lastCol = Math.max(reviewSheet.getLastColumn(), RESEARCH_REVIEW_HEADERS.length);
  var header = reviewSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  if (col['任务ID'] === undefined) {
    throw new Error('研究审核缺少列: 任务ID');
  }

  deleteResearchReviewRowsForJob_(reviewSheet, col, opts.jobId);

  var rows = [];
  var list = opts.evidence || [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i] || {};
    var relevance = '';
    if (item.relevance != null && item.relevance !== '') {
      var relNum = Number(item.relevance);
      relevance = isNaN(relNum) ? String(item.relevance) : relNum;
    }
    rows.push([
      opts.jobId,
      opts.site || '',
      opts.game || '',
      opts.topic || '',
      opts.pagePath || '',
      formatResearchEvidenceSource_(item.source),
      String(item.discovered_topic || '').trim(),
      String(item.player_question || '').trim(),
      truncateResearchEvidenceExcerpt_(item.evidence),
      String(item.url || '').trim(),
      relevance,
      opts.researchedAt || new Date()
    ]);
  }

  if (!rows.length) {
    return { rows: 0, link: '', startRow: 0, endRow: 0 };
  }

  var startRow = reviewSheet.getLastRow() + 1;
  if (startRow < 2) startRow = 2;
  reviewSheet
    .getRange(startRow, 1, rows.length, RESEARCH_REVIEW_HEADERS.length)
    .setValues(rows);
  var endRow = startRow + rows.length - 1;
  var link = buildResearchReviewLink_(ss, reviewSheet, startRow, endRow);
  return { rows: rows.length, link: link, startRow: startRow, endRow: endRow };
}

/** 自底向上删除同 job_id 行，避免行号错位。 */
function deleteResearchReviewRowsForJob_(sheet, col, jobId) {
  if (!sheet || sheet.getLastRow() < 2) return;
  var idCol = col['任务ID'];
  if (idCol === undefined) return;
  var n = sheet.getLastRow() - 1;
  var values = sheet.getRange(2, idCol + 1, n, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0] || '').trim() === jobId) {
      sheet.deleteRow(i + 2);
    }
  }
}

function formatResearchEvidenceSource_(source) {
  var raw = String(source || '').trim();
  if (!raw) return '';
  var key = raw.toLowerCase();
  if (RESEARCH_EVIDENCE_SOURCE_LABELS[key]) {
    return RESEARCH_EVIDENCE_SOURCE_LABELS[key];
  }
  return raw;
}

function truncateResearchEvidenceExcerpt_(text) {
  var s = String(text == null ? '' : text).trim();
  var max = RESEARCH_EVIDENCE_EXCERPT_MAX || 800;
  if (s.length <= max) return s;
  if (max <= 1) return '…';
  return s.substring(0, max - 1) + '…';
}

/**
 * Spreadsheet URL + gid + A1 range → 运营可点的内部审核链接。
 */
function buildResearchReviewLink_(ss, reviewSheet, startRow, endRow) {
  if (!ss || !reviewSheet || !startRow || !endRow || endRow < startRow) return '';
  var base = String(ss.getUrl() || '').replace(/#.*$/, '');
  if (!base) return '';
  var colCount = RESEARCH_REVIEW_HEADERS.length;
  var rangeA1 =
    'A' + startRow + ':' + columnIndexToLetter_(colCount) + endRow;
  return base + '#gid=' + reviewSheet.getSheetId() + '&range=' + rangeA1;
}

function columnIndexToLetter_(colIndex) {
  var n = Number(colIndex) || 0;
  if (n < 1) return 'A';
  var s = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function ensureResearchReviewSheet_() {
  return ensureSheet_(SHEET_NAMES.RESEARCH_REVIEW, RESEARCH_REVIEW_HEADERS);
}

/** 已存在的「研究审核」仅补齐缺失表头列。 */
function ensureResearchReviewHeader_(sheet) {
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var have = {};
  for (var i = 0; i < header.length; i++) {
    var name = String(header[i] || '').trim();
    if (name) have[name] = true;
  }
  var toAdd = [];
  for (var n = 0; n < RESEARCH_REVIEW_HEADERS.length; n++) {
    if (!have[RESEARCH_REVIEW_HEADERS[n]]) toAdd.push(RESEARCH_REVIEW_HEADERS[n]);
  }
  if (!toAdd.length) return;

  var startCol = lastCol + 1;
  if (String(header[header.length - 1] || '').trim() === '') {
    startCol = lastCol;
  }
  sheet.getRange(1, startCol, 1, toAdd.length).setValues([toAdd]);
  sheet.getRange(1, startCol, 1, toAdd.length).setFontWeight('bold');
}

function setCellIf_(sheet, sheetRow, col, name, value) {
  if (col[name] === undefined) return;
  sheet.getRange(sheetRow, col[name] + 1).setValue(value);
}

function findResearchJobRowById_(sheet, col, jobId) {
  if (!sheet || sheet.getLastRow() < 2) return null;
  var idCol = col['任务ID'];
  if (idCol === undefined) return null;
  var n = sheet.getLastRow() - 1;
  var values = sheet.getRange(2, idCol + 1, n, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === jobId) {
      return { sheetRow: i + 2 };
    }
  }
  return null;
}

/** 只读回读某 job 的显示层字段（验证用）。 */
function readResearchJobDisplay_(jobId) {
  jobId = String(jobId || '').trim();
  if (!jobId) return { ok: false, error: 'missing_job_id' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { ok: false, error: 'no_spreadsheet' };
  var sheet = ss.getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'sheet_empty' };
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var found = findResearchJobRowById_(sheet, col, jobId);
  if (!found) return { ok: false, error: 'job_not_found', job_id: jobId };
  var row = sheet.getRange(found.sheetRow, 1, 1, lastCol).getValues()[0];
  var completed = cell_(row, col, '完成时间');
  var completedAt = '';
  if (Object.prototype.toString.call(completed) === '[object Date]' && !isNaN(completed.getTime())) {
    completedAt = toIso8601_(completed);
  } else {
    completedAt = String(completed || '').trim();
  }
  return {
    ok: true,
    job_id: jobId,
    display: {
      任务状态: String(cell_(row, col, '任务状态') || '').trim(),
      研究结果: String(cell_(row, col, '研究结果') || '').trim(),
      证据数量: cell_(row, col, '证据数量'),
      结果路径: String(cell_(row, col, '结果路径') || '').trim(),
      完成时间: completedAt,
      错误信息: String(cell_(row, col, '错误信息') || '').trim(),
      审核摘要: String(cell_(row, col, '审核摘要') || '').trim(),
      审核链接: String(cell_(row, col, '审核链接') || '').trim(),
      审核决定: String(cell_(row, col, '审核决定') || '').trim(),
      审核备注: String(cell_(row, col, '审核备注') || '').trim(),
      审核时间: formatResearchReviewTime_(cell_(row, col, '审核时间'))
    }
  };
}

/**
 * 只读「研究任务」中 PENDING / 待处理 行。不 ensure、不写日志、不改单元格。
 * @return {Array<Object>}
 */
function loadPendingResearchJobs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return [];
  var sheet = ss.getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var jobs = [];
  for (var i = 0; i < rows.length; i++) {
    if (!isResearchJobPending_(String(cell_(rows[i], col, '任务状态') || '').trim())) {
      continue;
    }
    var job = researchJobRowToApi_(rows[i], col);
    if (job && job.job_id) jobs.push(job);
  }
  return jobs;
}

function isResearchJobPending_(status) {
  var s = String(status || '').trim();
  if (!s) return false;
  if (s === RESEARCH_JOB_STATUS.PENDING) return true;
  if (s === RESEARCH_JOB_STATUS_LABELS.PENDING) return true;
  return enumFromLabel_(RESEARCH_JOB_STATUS_LABELS, s) === RESEARCH_JOB_STATUS.PENDING;
}

function researchJobRowToApi_(row, col) {
  var created = cell_(row, col, '创建时间');
  var createdAt = '';
  if (Object.prototype.toString.call(created) === '[object Date]' && !isNaN(created.getTime())) {
    createdAt = toIso8601_(created);
  } else {
    createdAt = String(created || '').trim();
  }
  var related = [];
  var relatedRaw = String(cell_(row, col, '关联搜索词') || '').trim();
  if (relatedRaw) {
    var parts = relatedRaw.split('|');
    for (var i = 0; i < parts.length; i++) {
      var q = String(parts[i] || '').trim();
      if (q) related.push(q);
    }
  }
  return {
    job_id: String(cell_(row, col, '任务ID') || '').trim(),
    game: String(cell_(row, col, '游戏') || cell_(row, col, '站点') || '').trim(),
    topic: String(cell_(row, col, '搜索词 / topic') || '').trim(),
    existing_page: String(cell_(row, col, '页面路径') || '').trim(),
    opportunity_level: enumFromLabel_(OPPORTUNITY_LEVEL_LABELS, String(cell_(row, col, '机会等级') || '').trim()),
    recommended_action: enumFromLabel_(OPPORTUNITY_ACTION_LABELS, String(cell_(row, col, '建议动作') || '').trim()),
    source_query: String(cell_(row, col, 'source_query') || '').trim(),
    related_queries: related,
    created_at: createdAt
    // 有意不输出 research_type：当前 fetch_pending_jobs / runner 不消费该字段。
    // Sheet 仍保存「研究类型」；B2-B2 若需区分 ASSET_RESEARCH 再做 passthrough。
  };
}

/**
 * 独立入口：从当前「内容机会」筛选高优先级研究项，写入「研究任务」。
 * 幂等：同一聚合键已有 Job 时不重复创建。
 * @return {Object} { created, skipped, mortal }
 */
function createResearchJobs() {
  ensureResearchJobSheets_();
  ensureSheet_(SHEET_NAMES.CONTENT_UPDATES, CONTENT_UPDATE_HEADERS);
  var createdAt = new Date();
  var asOfDate = todayStr_();
  var rules = getDecisionRules_();
  var contentUpdateRows = loadContentUpdateRows_();
  writeLog_('INFO', '', 'createResearchJobs 开始');

  var oppSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.OPPORTUNITIES);
  if (!oppSheet || oppSheet.getLastRow() < 2) {
    writeLog_('INFO', '', 'createResearchJobs 结束：内容机会为空');
    return { created: 0, skipped: 0, skippedCooldown: 0, mortal: [] };
  }

  ensureOpportunityResearchColumns_(oppSheet);
  SpreadsheetApp.flush();
  var lastCol = Math.max(oppSheet.getLastColumn(), 1);
  var header = oppSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  requireHeaders_(col, ['站点', '搜索词', '机会等级', '建议动作', '研究状态', '研究任务ID', '研究请求时间']);

  var jobSheet = ensureSheet_(SHEET_NAMES.RESEARCH_JOBS, RESEARCH_JOB_HEADERS);
  ensureResearchJobHeader_();
  var existingJobs = loadExistingResearchJobs_(jobSheet);
  var createdRows = [];
  var oppUpdates = [];
  var mortal = [];
  var skipped = 0;
  var skippedCooldown = 0;
  var clusters = {};
  var clusterOrder = [];

  var values = oppSheet.getRange(2, 1, oppSheet.getLastRow() - 1, lastCol).getValues();
  for (var i = 0; i < values.length; i++) {
    var parsed = parseOpportunityRowForJob_(values[i], col);
    if (!parsed.eligible) continue;
    if (String(parsed.jobId || '').trim()) {
      skipped += 1;
      continue;
    }
    var clusterKey = researchJobClusterKey_(parsed);
    if (!clusters[clusterKey]) {
      clusters[clusterKey] = [];
      clusterOrder.push(clusterKey);
    }
    parsed.sheetRow = i + 2;
    clusters[clusterKey].push(parsed);
  }

  for (var c = 0; c < clusterOrder.length; c++) {
    var key = clusterOrder[c];
    var members = clusters[key];
    var existingId = existingJobs.byClusterKey[key];
    if (!existingId) {
      for (var m = 0; m < members.length; m++) {
        var qKey = researchOpportunityKey_(members[m].site, members[m].query);
        if (existingJobs.byOppKey[qKey]) {
          existingId = existingJobs.byOppKey[qKey];
          break;
        }
      }
    }
    if (existingId) {
      skipped += members.length;
      for (var e = 0; e < members.length; e++) {
        oppUpdates.push({
          sheetRow: members[e].sheetRow,
          status: RESEARCH_STATUS_LABELS.TODO,
          jobId: existingId,
          requestedAt: members[e].requestedAt || createdAt
        });
      }
      continue;
    }

    var contentCooldown = findContentUpdateCooldownFromRows_(
      contentUpdateRows,
      members[0].site,
      members[0].pagePath,
      asOfDate,
      rules
    );
    if (contentCooldown) {
      skippedCooldown += members.length;
      continue;
    }

    var job = buildResearchJobFromCluster_(members, createdAt);
    if (existingJobs.byJobId[job.job_id]) {
      job.job_id = uniquifyResearchJobId_(job.job_id, job.topic || members[0].query);
    }
    createdRows.push(researchJobSheetRow_(job, members[0].site, createdAt));
    existingJobs.byClusterKey[key] = job.job_id;
    existingJobs.byJobId[job.job_id] = true;
    for (var w = 0; w < members.length; w++) {
      existingJobs.byOppKey[researchOpportunityKey_(members[w].site, members[w].query)] = job.job_id;
      oppUpdates.push({
        sheetRow: members[w].sheetRow,
        status: RESEARCH_STATUS_LABELS.TODO,
        jobId: job.job_id,
        requestedAt: createdAt
      });
    }
    if (members[0].site === 'Mortal Shell II') {
      mortal.push({
        job_id: job.job_id,
        topic: job.topic,
        source_query: job.source_query,
        related_queries: job.related_queries,
        existing_page: job.existing_page
      });
    }
  }

  if (createdRows.length) {
    var start = jobSheet.getLastRow() + 1;
    if (start < 2) start = 2;
    jobSheet.getRange(start, 1, createdRows.length, RESEARCH_JOB_HEADERS.length).setValues(createdRows);
  }
  writeOpportunityResearchFields_(oppSheet, col, oppUpdates);

  writeLog_(
    'INFO',
    '',
    'createResearchJobs 结束 created=' +
      createdRows.length +
      ' skippedDup=' +
      skipped +
      ' skippedCooldown=' +
      skippedCooldown
  );
  return {
    created: createdRows.length,
    skipped: skipped,
    skippedCooldown: skippedCooldown,
    mortal: mortal
  };
}

/**
 * 清理当前测试用研究任务，并清空「内容机会」研究回写字段，然后按新聚合规则重建。
 * @return {Object}
 */
function resetAndCreateResearchJobs() {
  resetResearchJobs_();
  return createResearchJobs();
}

function resetResearchJobs_() {
  ensureResearchJobSheets_();
  var jobSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (jobSheet && jobSheet.getLastRow() > 1) {
    var jobCols = Math.max(jobSheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
    jobSheet.getRange(2, 1, jobSheet.getLastRow() - 1, jobCols).clearContent();
  }

  var oppSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.OPPORTUNITIES);
  if (!oppSheet || oppSheet.getLastRow() < 2) return;
  ensureOpportunityResearchColumns_(oppSheet);
  SpreadsheetApp.flush();
  var lastCol = Math.max(oppSheet.getLastColumn(), 1);
  var header = oppSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var n = oppSheet.getLastRow() - 1;
  var names = ['研究状态', '研究任务ID', '研究请求时间'];
  for (var i = 0; i < names.length; i++) {
    if (col[names[i]] === undefined) continue;
    oppSheet.getRange(2, col[names[i]] + 1, n, 1).clearContent();
  }
}

function ensureResearchJobSheets_() {
  ensureSheet_(SHEET_NAMES.OPPORTUNITIES, OPPORTUNITY_HEADERS);
  ensureOpportunityHeader_();
  var oppSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.OPPORTUNITIES);
  if (oppSheet) ensureOpportunityResearchColumns_(oppSheet);
  ensureSheet_(SHEET_NAMES.RESEARCH_JOBS, RESEARCH_JOB_HEADERS);
  ensureResearchJobHeader_();
  ensureResearchReviewSheet_();
}

function ensureResearchJobHeader_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet) return;
  ensureResearchJobResultColumns_(sheet);
  applyResearchReviewDecisionValidation_();
}

/**
 * 「审核决定」列中文下拉：批准开发 / 继续观察 / 无需处理。
 * 仅约束该列；不改已有单元格内容。
 */
function applyResearchReviewDecisionValidation_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet) return;
  ensureResearchJobResultColumns_(sheet);
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var idx = col['审核决定'];
  if (idx === undefined) return;
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(RESEARCH_REVIEW_DECISION_OPTIONS, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, idx + 1, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
  sheet.getRange(1, idx + 1).setNumberFormat('@');
  var timeIdx = col['审核时间'];
  if (timeIdx !== undefined) {
    sheet.getRange(2, timeIdx + 1, sheet.getMaxRows() - 1, 1).setNumberFormat(
      'yyyy-mm-dd hh:mm:ss'
    );
  }
}

/**
 * 仅追加「研究任务」缺失列；不重复、不改已有数据行。
 */
function ensureResearchJobResultColumns_(sheet) {
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var have = {};
  for (var i = 0; i < header.length; i++) {
    var name = String(header[i] || '').trim();
    if (name) have[name] = true;
  }
  var toAdd = [];
  for (var n = 0; n < RESEARCH_JOB_HEADERS.length; n++) {
    if (!have[RESEARCH_JOB_HEADERS[n]]) toAdd.push(RESEARCH_JOB_HEADERS[n]);
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
 * Human Review Gate M2：扫描「研究任务」中尚未处理的审核决定并落状态。
 * 仅处理：任务状态=待审核/REVIEW，且已填审核决定、尚无审核时间。
 * 不创建开发任务、不改网站、不删 Evidence / 审核摘要 / 审核链接。
 * @return {string}
 */
function processResearchReviewDecisions() {
  ensureResearchJobSheets_();
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet || sheet.getLastRow() < 2) {
    var emptyMsg = 'processResearchReviewDecisions：研究任务为空';
    writeLog_('INFO', '', emptyMsg);
    Logger.log(emptyMsg);
    return emptyMsg;
  }

  var lastCol = Math.max(sheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  requireResearchReviewGateColumns_(col);

  var n = sheet.getLastRow() - 1;
  var rows = sheet.getRange(2, 1, n, lastCol).getValues();
  var processed = 0;
  var skippedProcessed = 0;
  var skippedNotReview = 0;
  var skippedUnknown = 0;
  var now = new Date();

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var jobId = String(cell_(row, col, '任务ID') || '').trim();
    if (!jobId) continue;

    var decisionLabel = String(cell_(row, col, '审核决定') || '').trim();
    if (!decisionLabel) continue;

    if (hasResearchReviewProcessed_(cell_(row, col, '审核时间'))) {
      skippedProcessed++;
      continue;
    }

    var statusRaw = String(cell_(row, col, '任务状态') || '').trim();
    if (!isResearchJobAwaitingReview_(statusRaw)) {
      skippedNotReview++;
      continue;
    }

    var nextStatus = statusAfterResearchReviewDecision_(decisionLabel);
    if (!nextStatus) {
      skippedUnknown++;
      writeLog_(
        'WARN',
        '',
        '未知审核决定 job_id=' + jobId + ' decision=' + decisionLabel
      );
      continue;
    }

    var sheetRow = i + 2;
    setCellIf_(sheet, sheetRow, col, '任务状态', nextStatus);
    setCellIf_(sheet, sheetRow, col, '审核时间', now);
    processed++;
    writeLog_(
      'INFO',
      String(cell_(row, col, '站点') || '').trim(),
      '研究审核已处理 job_id=' +
        jobId +
        ' 决定=' +
        decisionLabel +
        ' → 状态=' +
        nextStatus
    );
  }

  var summary =
    'processResearchReviewDecisions 完成 processed=' +
    processed +
    ' skippedAlreadyProcessed=' +
    skippedProcessed +
    ' skippedNotReview=' +
    skippedNotReview +
    ' skippedUnknown=' +
    skippedUnknown;
  writeLog_('INFO', '', summary);
  Logger.log(summary);
  return summary;
}

function requireResearchReviewGateColumns_(col) {
  var needed = ['任务ID', '任务状态', '审核决定', '审核备注', '审核时间'];
  var missing = [];
  for (var i = 0; i < needed.length; i++) {
    if (col[needed[i]] === undefined) missing.push(needed[i]);
  }
  if (missing.length) {
    throw new Error('研究任务缺少列: ' + missing.join(', '));
  }
}

/** 已有审核时间 → 已处理，防重复。 */
function hasResearchReviewProcessed_(value) {
  if (value === null || value === undefined || value === '') return false;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return !isNaN(value.getTime());
  }
  return String(value).trim() !== '';
}

function isResearchJobAwaitingReview_(status) {
  var s = String(status || '').trim();
  if (!s) return false;
  if (s === RESEARCH_JOB_STATUS.REVIEW) return true;
  if (s === RESEARCH_JOB_STATUS_LABELS.REVIEW) return true;
  return enumFromLabel_(RESEARCH_JOB_STATUS_LABELS, s) === RESEARCH_JOB_STATUS.REVIEW;
}

/**
 * 审核决定（中文或内部 enum）→ 新任务状态中文标签。
 * @return {string} 空字符串表示无法识别
 */
function statusAfterResearchReviewDecision_(decisionLabel) {
  var decisionEnum = enumFromLabel_(
    RESEARCH_REVIEW_DECISION_LABELS,
    String(decisionLabel || '').trim()
  );
  if (decisionEnum === RESEARCH_REVIEW_DECISION.APPROVE) {
    return RESEARCH_JOB_STATUS_LABELS.APPROVED;
  }
  if (decisionEnum === RESEARCH_REVIEW_DECISION.WATCH) {
    return RESEARCH_JOB_STATUS_LABELS.WATCH;
  }
  if (decisionEnum === RESEARCH_REVIEW_DECISION.NO_ACTION) {
    return RESEARCH_JOB_STATUS_LABELS.ARCHIVED;
  }
  return '';
}

function formatResearchReviewTime_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return toIso8601_(value);
  }
  return String(value).trim();
}

/**
 * 一次性：为 MS2 beta 任务写入「无需处理」审核决定并执行处理。
 * 不改 AU、不改网站、不删 Evidence。
 * @return {Object}
 */
function applyMs2HumanReviewNoAction() {
  var JOB_ID = 'ms2-beta-progress-carry-over-20260814';
  var DECISION = RESEARCH_REVIEW_DECISION_LABELS.NO_ACTION;
  var NOTE = '已于 2026-08-14 根据社媒信息完成内容更新';

  ensureResearchJobSheets_();
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error('研究任务为空');
  }
  var lastCol = Math.max(sheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  requireResearchReviewGateColumns_(col);

  var found = findResearchJobRowById_(sheet, col, JOB_ID);
  if (!found) {
    throw new Error('找不到研究任务: ' + JOB_ID);
  }

  var row = sheet.getRange(found.sheetRow, 1, 1, lastCol).getValues()[0];
  var beforeStatus = String(cell_(row, col, '任务状态') || '').trim();
  var beforeLink = String(cell_(row, col, '审核链接') || '').trim();
  var evidenceBefore = countResearchReviewEvidence_(JOB_ID);

  if (!hasResearchReviewProcessed_(cell_(row, col, '审核时间'))) {
    setCellIf_(sheet, found.sheetRow, col, '审核决定', DECISION);
    setCellIf_(sheet, found.sheetRow, col, '审核备注', NOTE);
  }

  var processSummary = processResearchReviewDecisions();
  var after = readResearchJobDisplay_(JOB_ID);
  var evidenceAfter = countResearchReviewEvidence_(JOB_ID);

  var result = {
    ok: !!(after && after.ok),
    job_id: JOB_ID,
    before_status: beforeStatus,
    process: processSummary,
    display: after && after.display ? after.display : null,
    evidence_count_before: evidenceBefore,
    evidence_count_after: evidenceAfter,
    review_link_before: beforeLink,
    review_link_after:
      after && after.display ? String(after.display['审核链接'] || '') : ''
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/** 统计「研究审核」中某 job_id 的 Evidence 行数。 */
function countResearchReviewEvidence_(jobId) {
  jobId = String(jobId || '').trim();
  if (!jobId) return 0;
  var reviewSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_REVIEW);
  if (!reviewSheet || reviewSheet.getLastRow() < 2) return 0;
  var lastCol = Math.max(reviewSheet.getLastColumn(), 1);
  var header = reviewSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var idCol = col['任务ID'];
  if (idCol === undefined) return 0;
  var values = reviewSheet.getRange(2, idCol + 1, reviewSheet.getLastRow() - 1, 1).getValues();
  var count = 0;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === jobId) count++;
  }
  return count;
}

/**
 * 复用已有「研究状态」；仅在缺失时追加「研究任务ID」「研究请求时间」。
 * 不重复新增同名列。
 */
function ensureOpportunityResearchColumns_(sheet) {
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var have = {};
  for (var i = 0; i < header.length; i++) {
    var name = String(header[i] || '').trim();
    if (name) have[name] = true;
  }
  var needed = ['研究状态', '研究任务ID', '研究请求时间'];
  var toAdd = [];
  for (var n = 0; n < needed.length; n++) {
    if (!have[needed[n]]) toAdd.push(needed[n]);
  }
  if (!toAdd.length) return;

  var startCol = lastCol + 1;
  if (String(header[header.length - 1] || '').trim() === '') {
    startCol = lastCol;
  }
  sheet.getRange(1, startCol, 1, toAdd.length).setValues([toAdd]);
  sheet.getRange(1, startCol, 1, toAdd.length).setFontWeight('bold');
}

function headerIndexMap_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var name = String(headerRow[i] || '').trim();
    if (name && map[name] === undefined) map[name] = i;
  }
  return map;
}

function requireHeaders_(col, names) {
  var missing = [];
  for (var i = 0; i < names.length; i++) {
    if (col[names[i]] === undefined) missing.push(names[i]);
  }
  if (missing.length) {
    throw new Error('内容机会缺少列: ' + missing.join(', '));
  }
}

function cell_(row, col, name) {
  var idx = col[name];
  if (idx === undefined) return '';
  return row[idx];
}

/**
 * @return {{eligible:boolean, skipReason:string, site:string, query:string, pagePath:string,
 *   siteUrl:string, actionEnum:string, jobId:string, requestedAt:*, status:string, impressions:number}}
 */
function parseOpportunityRowForJob_(row, col) {
  var site = String(cell_(row, col, '站点') || '').trim();
  var query = String(cell_(row, col, '搜索词') || '').trim();
  var siteUrl = String(cell_(row, col, '站点URL') || '').trim();
  var pagePath = String(cell_(row, col, '页面路径') || '').trim();
  var levelLabel = String(cell_(row, col, '机会等级') || '').trim();
  var actionLabel = String(cell_(row, col, '建议动作') || '').trim();
  var intentLabel = String(cell_(row, col, '搜索意图') || '').trim();
  var specLabel = String(cell_(row, col, '意图明确度') || '').trim();
  var status = String(cell_(row, col, '研究状态') || '').trim();
  var jobId = String(cell_(row, col, '研究任务ID') || '').trim();
  var requestedAt = cell_(row, col, '研究请求时间');
  var impressions = Number(cell_(row, col, '展现') || 0);
  if (isNaN(impressions)) impressions = 0;

  var empty = {
    eligible: false,
    skipReason: '',
    site: site,
    query: query,
    pagePath: pagePath,
    siteUrl: siteUrl,
    actionEnum: '',
    jobId: jobId,
    requestedAt: requestedAt,
    status: status,
    impressions: impressions
  };

  if (!site || !query) return empty;

  var levelEnum = enumFromLabel_(OPPORTUNITY_LEVEL_LABELS, levelLabel);
  var actionEnum = enumFromLabel_(OPPORTUNITY_ACTION_LABELS, actionLabel);
  var intentEnum = enumFromLabel_(OPPORTUNITY_INTENT_LABELS, intentLabel);
  var specEnum = enumFromLabel_(OPPORTUNITY_SPECIFICITY_LABELS, specLabel);

  if (levelEnum !== OPPORTUNITY_LEVELS.HIGH) return empty;
  if (!RESEARCH_JOB_ELIGIBLE_ACTIONS[actionEnum]) return empty;
  if (!isResearchStatusOpen_(status)) return empty;

  if (
    actionEnum === OPPORTUNITY_ACTIONS.IGNORE_BRAND ||
    intentEnum === OPPORTUNITY_INTENT.BRAND ||
    specEnum === OPPORTUNITY_SPECIFICITY.BRAND_ONLY ||
    isPureBrandQuery_(normalizeOpportunityQuery_(query), { name: site, propertyUrl: siteUrl })
  ) {
    return empty;
  }

  empty.eligible = true;
  empty.actionEnum = actionEnum;
  return empty;
}

function isResearchStatusOpen_(status) {
  var s = String(status || '').trim();
  if (!s) return true;
  return s === RESEARCH_STATUS_LABELS.TODO;
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

function researchOpportunityKey_(site, query) {
  return String(site || '').trim() + '||' + normalizeOpportunityQuery_(query);
}

/**
 * EXPAND + 具体承接页：站点 + 路径 + 动作。
 * NEW_CONTENT（及无具体页的 EXPAND）：站点 + 动作 + normalized query。
 */
function researchJobClusterKey_(parsed) {
  var site = String(parsed.site || '').trim();
  var action = parsed.actionEnum || '';
  if (canAggregateByPage_(parsed)) {
    return site + '||' + normalizeOpportunityPath_(parsed.pagePath) + '||' + action;
  }
  return site + '||' + action + '||query||' + normalizeOpportunityQuery_(parsed.query);
}

function canAggregateByPage_(parsed) {
  if (!parsed || parsed.actionEnum !== OPPORTUNITY_ACTIONS.RESEARCH_EXPAND_EXISTING) {
    return false;
  }
  var path = normalizeOpportunityPath_(parsed.pagePath);
  if (!path || path === '/') return false;
  var site = { name: parsed.site, propertyUrl: parsed.siteUrl };
  if (isOpportunityHubPath_(path, site)) return false;
  return true;
}

function loadExistingResearchJobs_(sheet) {
  var byOppKey = {};
  var byJobId = {};
  var byClusterKey = {};
  if (!sheet || sheet.getLastRow() < 2) {
    return { byOppKey: byOppKey, byJobId: byJobId, byClusterKey: byClusterKey };
  }
  var lastCol = Math.max(sheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  for (var i = 0; i < rows.length; i++) {
    var jobId = String(cell_(rows[i], col, '任务ID') || '').trim();
    var site = String(cell_(rows[i], col, '站点') || '').trim();
    var pagePath = String(cell_(rows[i], col, '页面路径') || '').trim();
    var actionLabel = String(cell_(rows[i], col, '建议动作') || '').trim();
    var actionEnum = enumFromLabel_(OPPORTUNITY_ACTION_LABELS, actionLabel);
    var sourceQuery = String(cell_(rows[i], col, 'source_query') || '').trim();
    var related = String(cell_(rows[i], col, '关联搜索词') || '').trim();
    if (jobId) byJobId[jobId] = true;
    if (jobId && /^asset-/.test(jobId)) continue;
    if (site && actionEnum) {
      var fake = {
        site: site,
        siteUrl: '',
        pagePath: pagePath,
        actionEnum: actionEnum,
        query: sourceQuery
      };
      byClusterKey[researchJobClusterKey_(fake)] = jobId;
    }
    if (site && sourceQuery) {
      var srcKey = researchOpportunityKey_(site, sourceQuery);
      if (!byOppKey[srcKey]) byOppKey[srcKey] = jobId;
    }
    if (site && related) {
      var parts = related.split('|');
      for (var p = 0; p < parts.length; p++) {
        var rel = String(parts[p] || '').trim();
        if (!rel) continue;
        var relKey = researchOpportunityKey_(site, rel);
        if (!byOppKey[relKey]) byOppKey[relKey] = jobId;
      }
    }
  }
  return { byOppKey: byOppKey, byJobId: byJobId, byClusterKey: byClusterKey };
}

function buildResearchJobFromCluster_(members, createdAt) {
  var first = members[0];
  var site = { name: first.site, propertyUrl: first.siteUrl };
  var residuals = [];
  var seenResidual = {};
  for (var i = 0; i < members.length; i++) {
    var residual = researchJobResidual_(members[i].query, site);
    if (!residual) residual = normalizeOpportunityQuery_(members[i].query);
    if (seenResidual[residual]) continue;
    seenResidual[residual] = true;
    residuals.push(residual);
  }
  var topic = members.length > 1
    ? researchJobTopicFromResiduals_(residuals)
    : residuals[0] || researchJobResidual_(first.query, site);
  var sourceQuery = pickResearchSourceQuery_(members, site);
  var pagePath = canAggregateByPage_(first)
    ? first.pagePath
    : first.pagePath || '';
  return {
    job_id: makeResearchJobId_(first.site, pagePath, topic, sourceQuery, createdAt),
    game: first.site,
    topic: topic,
    existing_page: pagePath,
    opportunity_level: OPPORTUNITY_LEVELS.HIGH,
    recommended_action: first.actionEnum,
    source_query: sourceQuery,
    related_queries: residuals.join(' | '),
    created_at: toIso8601_(createdAt)
  };
}

function researchJobResidual_(query, site) {
  var q = normalizeOpportunityQuery_(query);
  if (!q) return '';
  var tokens = tokenizeBrand_(q);
  var brand = getBrandTokenSet_(site);
  var residual = [];
  for (var i = 0; i < tokens.length; i++) {
    if (!brand[tokens[i]]) residual.push(tokens[i]);
  }
  if (!residual.length) return q;
  return residual.join(' ');
}

function researchJobTopicFromResiduals_(residuals) {
  var text = residuals.join(' ').toLowerCase();
  var hasBeta = /\bbeta\b/.test(text);
  var parts = [];
  if (/\bsave(?:\s+file)?\b/.test(text)) {
    parts.push(hasBeta ? 'beta save' : 'save');
  }
  if (/\brewards?\b|\bbonus\b/.test(text)) {
    parts.push(hasBeta ? 'beta rewards' : 'rewards');
  }
  if (/\bcarry[\s-]*over\b|\bcarryover\b|\bprogress\b/.test(text)) {
    parts.push('progress carry-over');
  }
  if (parts.length) return parts.join(' / ');

  var unique = [];
  var seen = {};
  for (var i = 0; i < residuals.length; i++) {
    var r = String(residuals[i] || '').trim();
    if (!r || seen[r]) continue;
    seen[r] = true;
    unique.push(r);
  }
  return unique.join(' / ');
}

function pickResearchSourceQuery_(members, site) {
  var best = members[0];
  var bestScore = -1;
  for (var i = 0; i < members.length; i++) {
    var q = normalizeOpportunityQuery_(members[i].query);
    var residual = researchJobResidual_(members[i].query, site);
    var interrogative = /^(does|do|did|will|would|can|could|how|what|is|are|why|when|where)\b/.test(q);
    var score =
      (Number(members[i].impressions) || 0) * 1000 +
      residual.length * 10 +
      (interrogative ? 0 : 50);
    if (score > bestScore) {
      bestScore = score;
      best = members[i];
    }
  }
  return best.query;
}

function makeResearchJobId_(game, pagePath, topic, query, createdAt) {
  var prefix = RESEARCH_GAME_SLUGS[game] || slugifyResearch_(game);
  var path = normalizeOpportunityPath_(pagePath);
  var slug = '';
  if (path && path !== '/') {
    var segments = path.split('/').filter(function (s) {
      return !!s;
    });
    if (segments.length) slug = slugifyResearch_(segments[segments.length - 1]);
  }
  if (!slug) slug = slugifyResearch_(topic);
  if (!slug) slug = slugifyResearch_(query);
  if (slug.length > 40) slug = slug.substring(0, 40).replace(/-+$/, '');
  var ymd = Utilities.formatDate(createdAt, Session.getScriptTimeZone(), 'yyyyMMdd');
  var id = prefix + '-' + slug + '-' + ymd;
  return id.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function slugifyResearch_(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniquifyResearchJobId_(jobId, query) {
  var extra = slugifyResearch_(query);
  if (extra.length > 12) extra = extra.substring(extra.length - 12);
  if (!extra) extra = 'dup';
  if (jobId.indexOf('-') < 0) return jobId + '-' + extra;
  return jobId.replace(/-(\d{8})$/, '-' + extra + '-$1');
}

function toIso8601_(date) {
  var tz = Session.getScriptTimeZone() || 'Asia/Shanghai';
  var base = Utilities.formatDate(date, tz, "yyyy-MM-dd'T'HH:mm:ss");
  var offset = Utilities.formatDate(date, tz, 'Z');
  if (offset === 'Z') return base + '+00:00';
  if (/^[+-]\d{4}$/.test(offset)) {
    return base + offset.substring(0, 3) + ':' + offset.substring(3);
  }
  return base + '+08:00';
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

function writeOpportunityResearchFields_(sheet, col, updates) {
  if (!updates || !updates.length) return;
  var statusIdx = col['研究状态'];
  var jobIdx = col['研究任务ID'];
  var timeIdx = col['研究请求时间'];
  if (statusIdx === undefined || jobIdx === undefined || timeIdx === undefined) {
    throw new Error('内容机会缺少研究回写列');
  }
  for (var i = 0; i < updates.length; i++) {
    var u = updates[i];
    sheet.getRange(u.sheetRow, statusIdx + 1).setValue(u.status);
    sheet.getRange(u.sheetRow, jobIdx + 1).setValue(u.jobId);
    sheet.getRange(u.sheetRow, timeIdx + 1).setValue(u.requestedAt);
  }
}

/**
 * 不写 Sheet、不联网的纯转换自检。
 * @return {string}
 */
function debugResearchJobsSelfCheck() {
  var fails = [];
  function assert(cond, msg) {
    if (!cond) fails.push(msg);
  }

  var mortal = { name: 'Mortal Shell II', propertyUrl: 'https://mortal-shell-ii.vercel.app/' };
  var col = headerIndexMap_(OPPORTUNITY_HEADERS);
  function fakeRow(over) {
    var row = [];
    for (var i = 0; i < OPPORTUNITY_HEADERS.length; i++) row.push('');
    row[col['站点']] = 'Mortal Shell II';
    row[col['站点URL']] = mortal.propertyUrl;
    row[col['搜索词']] = 'mortal shell 2 beta progress carry over';
    row[col['页面路径']] = '/mortal-shell-ii/beta-progress-carry-over/';
    row[col['机会等级']] = '高';
    row[col['建议动作']] = '研究并扩充现有页面';
    row[col['搜索意图']] = '存档进度';
    row[col['意图明确度']] = '明确意图';
    row[col['研究状态']] = '';
    var keys = Object.keys(over || {});
    for (var k = 0; k < keys.length; k++) row[col[keys[k]]] = over[keys[k]];
    return row;
  }

  var ok = parseOpportunityRowForJob_(fakeRow({}), col);
  assert(ok.eligible === true, 'HIGH + expand + empty status should be eligible');
  assert(ok.actionEnum === 'RESEARCH_EXPAND_EXISTING', 'action enum');
  assert(canAggregateByPage_(ok) === true, 'beta page should aggregate');

  var brand = parseOpportunityRowForJob_(
    fakeRow({
      搜索词: 'mortal shell 2',
      搜索意图: '品牌词',
      意图明确度: '仅品牌',
      建议动作: '忽略品牌词',
      机会等级: '观察'
    }),
    col
  );
  assert(brand.eligible === false, 'pure brand should be skipped');

  var watch = parseOpportunityRowForJob_(fakeRow({ 机会等级: '中', 建议动作: '继续观察' }), col);
  assert(watch.eligible === false, 'medium/watch should be skipped');

  var todoOpen = parseOpportunityRowForJob_(fakeRow({ 研究状态: '待研究' }), col);
  assert(todoOpen.eligible === true, '待研究 without job id remains open');

  var queries = [
    'mortal shell 2 beta rewards',
    'mortal shell 2 beta carry over',
    'mortal shell 2 beta progress carry over',
    'does mortal shell 2 beta progress carry over',
    'mortal shell 2 beta save',
    'mortal shell 2 beta save file',
    'mortal shell 2 beta reward',
    'mortal shell 2 open beta rewards'
  ];
  var members = [];
  for (var q = 0; q < queries.length; q++) {
    var parsed = parseOpportunityRowForJob_(fakeRow({ 搜索词: queries[q], 展现: 9 - q }), col);
    assert(parsed.eligible === true, queries[q] + ' eligible');
    members.push(parsed);
  }
  var keys = {};
  for (var k = 0; k < members.length; k++) {
    keys[researchJobClusterKey_(members[k])] = true;
  }
  assert(Object.keys(keys).length === 1, '8 beta queries should share one cluster key');

  var createdAt = new Date('2026-08-14T15:04:00+08:00');
  var job = buildResearchJobFromCluster_(members, createdAt);
  assert(job.job_id === 'ms2-beta-progress-carry-over-20260814', 'page-based job_id');
  assert(job.game === 'Mortal Shell II', 'game');
  assert(job.opportunity_level === 'HIGH', 'HIGH enum');
  assert(job.recommended_action === 'RESEARCH_EXPAND_EXISTING', 'action enum in job');
  assert(job.existing_page === '/mortal-shell-ii/beta-progress-carry-over/', 'existing_page');
  assert(job.topic === 'beta save / beta rewards / progress carry-over', 'compact topic');
  assert(job.related_queries.indexOf('beta rewards') >= 0, 'related contains beta rewards');
  assert(job.related_queries.indexOf('beta save file') >= 0, 'related contains beta save file');
  assert(job.related_queries.indexOf('open beta rewards') >= 0, 'related contains open beta rewards');
  assert(job.related_queries.split(' | ').length === 8, '8 related residual queries');
  assert(job.source_query.indexOf('mortal shell') >= 0, 'source_query keeps a real GSC query');

  var auPs5 = parseOpportunityRowForJob_(
    fakeRow({
      站点: 'Approximately Up',
      站点URL: 'https://approximately-up.vercel.app/',
      搜索词: 'approximately up ps5',
      页面路径: '/',
      机会等级: '高',
      建议动作: '研究新内容',
      搜索意图: '平台',
      意图明确度: '明确意图'
    }),
    col
  );
  assert(auPs5.eligible === true && auPs5.actionEnum === 'RESEARCH_NEW_CONTENT', 'AU ps5 new content');
  assert(canAggregateByPage_(auPs5) === false, 'NEW_CONTENT does not page-aggregate');
  var auJob = buildResearchJobFromCluster_([auPs5], createdAt);
  assert(auJob.recommended_action === 'RESEARCH_NEW_CONTENT', 'RESEARCH_NEW_CONTENT enum');
  assert(auJob.job_id.indexOf('au-') === 0, 'au job_id prefix');
  assert(
    researchJobClusterKey_(auPs5) !== researchJobClusterKey_(ok),
    'AU and Mortal Shell II clusters stay independent'
  );

  var auConsole = parseOpportunityRowForJob_(
    fakeRow({
      站点: 'Approximately Up',
      站点URL: 'https://approximately-up.vercel.app/',
      搜索词: 'approximately up ps5',
      页面路径: '/approximately-up/console/',
      机会等级: '高',
      建议动作: '研究并扩充现有页面',
      搜索意图: '平台',
      意图明确度: '明确意图'
    }),
    col
  );
  assert(canAggregateByPage_(auConsole) === true, 'AU console page can aggregate');
  assert(
    researchJobClusterKey_(auConsole) !== researchJobClusterKey_(ok),
    '/console/ must not merge with Mortal Shell II'
  );

  var sheetRow = researchJobSheetRow_(job, 'Mortal Shell II', createdAt);
  assert(sheetRow[6] === '高', 'level display 高');
  assert(sheetRow[7] === '研究并扩充现有页面', 'action display zh');
  assert(sheetRow[9] === '待处理', 'PENDING display 待处理');
  assert(sheetRow[10] === job.related_queries, '关联搜索词 column');
  assert(sheetRow.length === RESEARCH_JOB_HEADERS.length, 'sheet row matches headers');
  assert(sheetRow[11] === '', '研究结果 empty on create');
  assert(sheetRow[16] === '', '审核摘要 empty on create');
  assert(sheetRow[17] === '', '审核链接 empty on create');
  assert(sheetRow[18] === '', '审核决定 empty on create');
  assert(sheetRow[19] === '', '审核备注 empty on create');
  assert(sheetRow[20] === '', '审核时间 empty on create');
  assert(sheetRow[21] === RESEARCH_TYPE.CONTENT_RESEARCH, '内容机会 Job 研究类型 CONTENT_RESEARCH');
  assert(
    opportunityLabel_(RESEARCH_JOB_STATUS_LABELS, 'REVIEW') === '待审核',
    'REVIEW → 待审核'
  );
  assert(
    opportunityLabel_(RESEARCH_JOB_STATUS_LABELS, 'WATCH') === '继续观察',
    'WATCH → 继续观察'
  );
  assert(
    opportunityLabel_(RESEARCH_JOB_STATUS_LABELS, 'APPROVED') === '已批准',
    'APPROVED → 已批准'
  );
  assert(
    opportunityLabel_(RESEARCH_JOB_STATUS_LABELS, 'ARCHIVED') === '已归档',
    'ARCHIVED → 已归档'
  );
  assert(
    RESEARCH_JOB_STATUS.WATCH === 'WATCH',
    'WATCH job status exists'
  );
  assert(
    statusAfterResearchReviewDecision_('批准开发') === '已批准',
    '批准开发 → 已批准'
  );
  assert(
    statusAfterResearchReviewDecision_('继续观察') === '继续观察',
    '审核继续观察 → 继续观察'
  );
  assert(
    statusAfterResearchReviewDecision_('无需处理') === '已归档',
    '无需处理 → 已归档'
  );
  assert(isResearchJobAwaitingReview_('待审核') === true, '待审核 awaits review');
  assert(isResearchJobAwaitingReview_('继续观察') === false, 'WATCH not awaiting review');
  assert(hasResearchReviewProcessed_('') === false, 'empty 审核时间 not processed');
  assert(hasResearchReviewProcessed_(new Date()) === true, 'Date 审核时间 processed');
  assert(
    RESEARCH_REVIEW_DECISION_OPTIONS.join('|') ===
      '批准开发|继续观察|无需处理',
    '审核决定下拉中文三项'
  );
  assert(
    opportunityLabel_(RESEARCH_RESULT_RECOMMENDATION_LABELS, 'EXPAND_EXISTING') ===
      '扩充现有页面',
    'EXPAND_EXISTING → 扩充现有页面'
  );
  assert(formatResearchEvidenceSource_('steam') === 'Steam', 'steam → Steam');
  assert(formatResearchEvidenceSource_('YouTube') === 'YouTube', 'YouTube label');
  assert(formatResearchEvidenceSource_('reddit') === 'Reddit', 'reddit → Reddit');
  assert(
    truncateResearchEvidenceExcerpt_('abc') === 'abc',
    'short evidence unchanged'
  );
  assert(
    truncateResearchEvidenceExcerpt_(new Array(900 + 1).join('x')).length ===
      RESEARCH_EVIDENCE_EXCERPT_MAX,
    'long evidence truncated to max'
  );
  assert(
    RESEARCH_REVIEW_HEADERS.length === 12 &&
      RESEARCH_REVIEW_HEADERS[0] === '任务ID' &&
      RESEARCH_REVIEW_HEADERS[8] === '证据摘录',
    '研究审核 headers'
  );
  assert(columnIndexToLetter_(12) === 'L', 'col 12 → L');
  assert(
    RESEARCH_JOB_HEADERS.indexOf('审核摘要') >= 0 &&
      RESEARCH_JOB_HEADERS.indexOf('审核链接') >= 0 &&
      RESEARCH_JOB_HEADERS.indexOf('审核决定') >= 0 &&
      RESEARCH_JOB_HEADERS.indexOf('审核备注') >= 0 &&
      RESEARCH_JOB_HEADERS.indexOf('审核时间') >= 0,
    '研究任务 has review gate columns'
  );
  assert(
    RESEARCH_JOB_HEADERS[RESEARCH_JOB_HEADERS.length - 4] === '审核决定' &&
      RESEARCH_JOB_HEADERS[RESEARCH_JOB_HEADERS.length - 3] === '审核备注' &&
      RESEARCH_JOB_HEADERS[RESEARCH_JOB_HEADERS.length - 2] === '审核时间' &&
      RESEARCH_JOB_HEADERS[RESEARCH_JOB_HEADERS.length - 1] === '研究类型',
    '研究类型追加在末尾，不移动审核字段'
  );

  var apiJob = researchJobRowToApi_(sheetRow, headerIndexMap_(RESEARCH_JOB_HEADERS));
  assert(apiJob.opportunity_level === 'HIGH', 'API level enum HIGH');
  assert(apiJob.recommended_action === 'RESEARCH_EXPAND_EXISTING', 'API action enum');
  assert(apiJob.related_queries.length === 8, 'API related_queries array');
  assert(isResearchJobPending_('待处理') === true, '待处理 is PENDING');
  assert(isResearchJobPending_('PENDING') === true, 'PENDING enum');
  assert(isResearchJobPending_('DONE') === false, 'DONE not pending');

  var msg;
  if (fails.length) {
    msg = 'FAIL (' + fails.length + '):\n' + fails.join('\n');
  } else {
    msg = 'PASS: Research Jobs self-check';
  }
  Logger.log(msg);
  return msg;
}
