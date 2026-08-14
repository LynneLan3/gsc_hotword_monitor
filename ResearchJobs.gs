/**
 * Research Job 出口
 * 内容机会 → 标准 Research Job 数据。只写 Sheet，不抓取外部源、不调用 hotword-engine。
 *
 * RESEARCH_EXPAND_EXISTING：同一站点 + 同一承接页 + 同一建议动作 → 1 个 Job。
 * RESEARCH_NEW_CONTENT：仍按 normalized query 各建 1 个 Job。
 */

/**
 * 独立入口：从当前「内容机会」筛选高优先级研究项，写入「研究任务」。
 * 幂等：同一聚合键已有 Job 时不重复创建。
 * @return {Object} { created, skipped, mortal }
 */
function createResearchJobs() {
  ensureResearchJobSheets_();
  var createdAt = new Date();
  writeLog_('INFO', '', 'createResearchJobs 开始');

  var oppSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.OPPORTUNITIES);
  if (!oppSheet || oppSheet.getLastRow() < 2) {
    writeLog_('INFO', '', 'createResearchJobs 结束：内容机会为空');
    return { created: 0, skipped: 0, mortal: [] };
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
      skipped
  );
  return { created: createdRows.length, skipped: skipped, mortal: mortal };
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
}

function ensureResearchJobHeader_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var actual = [];
  for (var i = 0; i < RESEARCH_JOB_HEADERS.length; i++) {
    actual.push(String(header[i] || '').trim());
  }
  if (actual.join('|') === RESEARCH_JOB_HEADERS.join('|')) return;
  sheet.getRange(1, 1, 1, RESEARCH_JOB_HEADERS.length).setValues([RESEARCH_JOB_HEADERS]);
  sheet.getRange(1, 1, 1, RESEARCH_JOB_HEADERS.length).setFontWeight('bold');
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
    job.related_queries || ''
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

  var msg;
  if (fails.length) {
    msg = 'FAIL (' + fails.length + '):\n' + fails.join('\n');
  } else {
    msg = 'PASS: Research Jobs self-check';
  }
  Logger.log(msg);
  return msg;
}
