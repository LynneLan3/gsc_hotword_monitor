/**
 * Winner Asset Candidate Layer（B2-A / B2-B / B2-C）
 * 只读「站点经营」生成候选；人工 Gate 后创建标准 Research Job；
 * syncWinnerAssetResearchResults 只消费现有「研究任务」终态。
 * 不重新计算 GSC / Winner；不自动改站；不改 Opportunity Research 合同。
 */

function ensureWinnerAssetHeader_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.WINNER_ASSETS);
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var have = {};
  for (var i = 0; i < header.length; i++) {
    var name = String(header[i] || '').trim();
    if (name) have[name] = true;
  }
  var toAdd = [];
  for (var n = 0; n < WINNER_ASSET_HEADERS.length; n++) {
    if (!have[WINNER_ASSET_HEADERS[n]]) toAdd.push(WINNER_ASSET_HEADERS[n]);
  }
  if (!toAdd.length) return;
  var startCol = lastCol + 1;
  if (String(header[header.length - 1] || '').trim() === '') startCol = lastCol;
  sheet.getRange(1, startCol, 1, toAdd.length).setValues([toAdd]);
  sheet.getRange(1, startCol, 1, toAdd.length).setFontWeight('bold');
}

function runWinnerAssetEngine() {
  ensureSheet_(SHEET_NAMES.WINNER_ASSETS, WINNER_ASSET_HEADERS);
  ensureWinnerAssetHeader_();

  var generatedAt = todayStr_();
  var nowTs = nowRecordedAt_();
  writeLog_('INFO', '', 'runWinnerAssetEngine 开始 generatedAt=' + generatedAt);

  var portfolio = loadPortfolioSheetForAssets_();
  var candidates = buildWinnerAssetCandidates_(
    portfolio.rows,
    generatedAt,
    nowTs,
    portfolio.headers
  );
  var existing = loadExistingWinnerAssetRows_();
  var out = mergeWinnerAssetRows_(existing, candidates);
  out = pruneStaleHomepageCandidates_(out);

  writeWinnerAssetRows_(out);
  applyWinnerAssetDecisionValidation_();

  writeLog_(
    'INFO',
    '',
    'runWinnerAssetEngine 结束 candidates=' +
      candidates.length +
      ' totalRows=' +
      out.length
  );
}

/** 只读「站点经营」表头 + 全部数据行（按实际列数，供 header-name mapping）。 */
function loadPortfolioSheetForAssets_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.PORTFOLIO);
  if (!sheet || sheet.getLastRow() < 2) {
    return { headers: PORTFOLIO_HEADERS.slice(), rows: [] };
  }
  var lastCol = Math.max(sheet.getLastColumn(), PORTFOLIO_HEADERS.length);
  return {
    headers: sheet.getRange(1, 1, 1, lastCol).getValues()[0],
    rows: sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues()
  };
}

function winnerAssetPortfolioCol_(headerRow) {
  var headers = headerRow && headerRow.length ? headerRow : PORTFOLIO_HEADERS;
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
    tier: idx_('投入档位', 2),
    winnerPage: idx_('赢家页面', 4),
    winnerIntent: idx_('赢家意图', 5),
    winnerClicks: idx_('赢家页点击7日', 6),
    winnerImpressions: idx_('赢家页曝光7日', 7),
    guideQueryCount: idx_('攻略查询数7日', 8),
    intentCategoryCount: idx_('意图类别数', 9),
    siteClicks: idx_('点击7日', 10)
  };
}

function cellAt_(row, idx) {
  if (idx === undefined || idx === null || idx < 0) return '';
  var v = row[idx];
  return v === null || v === undefined ? '' : v;
}

function loadExistingWinnerAssetRows_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.WINNER_ASSETS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, WINNER_ASSET_HEADERS.length).getValues();
}

function winnerAssetKey_(row) {
  return String(row[1] || '').trim() + '||' + String(row[2] || '').trim();
}

/**
 * @param {Array<Array>} portfolioRows
 * @param {string} generatedAt
 * @param {string} nowTs
 * @param {Array=} headerRow 「站点经营」表头；缺省用 PORTFOLIO_HEADERS
 * @return {Array<Array>}
 */
function buildWinnerAssetCandidates_(portfolioRows, generatedAt, nowTs, headerRow) {
  var col = winnerAssetPortfolioCol_(headerRow);
  var out = [];
  for (var i = 0; i < (portfolioRows || []).length; i++) {
    var row = portfolioRows[i];
    var tier = String(cellAt_(row, col.tier) || '').trim();
    var winnerPage = String(cellAt_(row, col.winnerPage) || '').trim();
    if (tier !== INVESTMENT_TIER.T2_WINNER || !winnerPage) continue;
    if (isHomepageWinnerPath_(winnerPage)) continue;

    var winnerIntent = String(cellAt_(row, col.winnerIntent) || '').trim();
    var winnerPageClicks7d = Number(cellAt_(row, col.winnerClicks) || 0);
    var winnerPageImpressions7d = Number(cellAt_(row, col.winnerImpressions) || 0);
    var guideQueryCount7d = Number(cellAt_(row, col.guideQueryCount) || 0);
    var intentCategoryCount = Number(cellAt_(row, col.intentCategoryCount) || 0);
    var siteClicks7d = Number(cellAt_(row, col.siteClicks) || 0);
    if (isNaN(winnerPageClicks7d)) winnerPageClicks7d = 0;
    if (isNaN(winnerPageImpressions7d)) winnerPageImpressions7d = 0;
    if (isNaN(guideQueryCount7d)) guideQueryCount7d = 0;
    if (isNaN(intentCategoryCount)) intentCategoryCount = 0;
    if (isNaN(siteClicks7d)) siteClicks7d = 0;
    if (winnerPageClicks7d < 1) continue;

    var siteName = String(cellAt_(row, col.siteName) || '').trim();
    var assetType = suggestAssetType_(winnerIntent, {
      winnerPageClicks7d: winnerPageClicks7d,
      siteClicks7d: siteClicks7d
    });
    var assetLevel = suggestAssetLevel_(assetType);
    var evidence = suggestAssetEvidence_(winnerIntent, {
      guideQueryCount7d: guideQueryCount7d,
      intentCategoryCount: intentCategoryCount
    });
    var reason = buildAssetReason_({
      siteName: siteName,
      winnerPage: winnerPage,
      winnerIntent: winnerIntent,
      assetType: assetType,
      winnerPageClicks7d: winnerPageClicks7d,
      winnerPageImpressions7d: winnerPageImpressions7d,
      siteClicks7d: siteClicks7d,
      guideQueryCount7d: guideQueryCount7d
    });

    out.push(winnerAssetRow_({
      generatedAt: generatedAt,
      siteName: siteName,
      winnerPage: winnerPage,
      winnerIntent: winnerIntent,
      winnerPageClicks7d: winnerPageClicks7d,
      winnerPageImpressions7d: winnerPageImpressions7d,
      guideQueryCount7d: guideQueryCount7d,
      intentCategoryCount: intentCategoryCount,
      assetType: assetType,
      assetTitle: '',
      reason: reason,
      assetLevel: assetLevel,
      evidenceStatus: evidence.status,
      missingEvidence: evidence.missing,
      humanDecision: ASSET_HUMAN_DECISION.TODO,
      humanNote: '',
      status: ASSET_STATUS.CANDIDATE,
      createdAt: nowTs,
      updatedAt: nowTs
    }));
  }
  return out;
}

function suggestAssetType_(winnerIntent, metrics) {
  metrics = metrics || {};
  var intent = String(winnerIntent || '').trim();
  if (intent === 'save_progress') return ASSET_TYPE.COMPARISON_MATRIX;
  if (!intent && (metrics.winnerPageClicks7d || 0) >= 1) {
    return ASSET_TYPE.VERIFIED_GUIDE;
  }
  if (intent === 'platform') return ASSET_TYPE.VERIFIED_GUIDE;
  if (intent) return ASSET_TYPE.VERIFIED_GUIDE;
  return ASSET_TYPE.OTHER;
}

function suggestAssetLevel_(assetType) {
  if (assetType === ASSET_TYPE.COMPARISON_MATRIX) return ASSET_LEVEL.EVIDENCE_PAGE;
  if (assetType === ASSET_TYPE.ANSWER_DATABASE) return ASSET_LEVEL.LINKABLE_ASSET;
  return ASSET_LEVEL.NORMAL_PAGE;
}

function suggestAssetEvidence_(winnerIntent, metrics) {
  metrics = metrics || {};
  var intent = String(winnerIntent || '').trim();
  var guideCount = metrics.guideQueryCount7d || 0;

  if (intent === 'save_progress') {
    if (guideCount >= 3) {
      return {
        status: ASSET_EVIDENCE_STATUS.PARTIAL,
        missing: '需要官方/第一手 Carry Over、Reset、Reward 对照证据'
      };
    }
    return {
      status: ASSET_EVIDENCE_STATUS.PARTIAL,
      missing: '需要官方/第一手 Carry Over、Reset、Reward 对照证据'
    };
  }

  if (!intent) {
    return {
      status: ASSET_EVIDENCE_STATUS.UNKNOWN,
      missing: '需要第一手证据与结构化答案；当前 Query intent 解释不足'
    };
  }

  if (guideCount >= 3) {
    return {
      status: ASSET_EVIDENCE_STATUS.PARTIAL,
      missing: '需要补充可引用的一手证据与页面内结构化答案'
    };
  }

  return {
    status: ASSET_EVIDENCE_STATUS.UNKNOWN,
    missing: '需要补充可引用的一手证据'
  };
}

function buildAssetReason_(opts) {
  opts = opts || {};
  var intent = String(opts.winnerIntent || '').trim();
  var clicks = opts.winnerPageClicks7d || 0;
  var impressions = opts.winnerPageImpressions7d || 0;
  var siteClicks = opts.siteClicks7d || 0;

  if (intent === 'save_progress') {
    return (
      '该页面已承接明确 save/progress 搜索需求，7日获得 ' +
      clicks +
      ' 次点击 / ' +
      impressions +
      ' 次曝光，可进一步升级为带证据的 Carry Over / Reset / Reward 对照资产。'
    );
  }

  if (!intent) {
    return (
      '该页面已成为站点主要搜索入口，7日获得 ' +
      clicks +
      '/' +
      siteClicks +
      ' 站点点击。当前 Query intent 解释不足，适合先补第一手证据和结构化答案，再判断是否升级为 Answer Database。'
    );
  }

  return (
    '该 Winner Page 在 7 日窗口获得 ' +
    clicks +
    ' 次点击 / ' +
    impressions +
    ' 次曝光，意图信号为 ' +
    intent +
    '，适合评估是否升级为 ' +
    (opts.assetType || ASSET_TYPE.VERIFIED_GUIDE) +
    '。'
  );
}

/**
 * Winner Asset 专用 pathname。解析失败不得把完整 URL 当作 path 交回，
 * 否则根路径 URL 会逃过 homepage gate。
 * 覆盖：https://example.com、https://example.com/、?query、#hash；
 * 不误判 /classes/。
 */
function winnerAssetPathname_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';

  var m = /^https?:\/\/[^\/?#]+(\/[^?#]*)?/i.exec(raw);
  if (m) return m[1] || '/';

  try {
    if (typeof URL === 'function') {
      var u = new URL(raw);
      if (u && u.pathname) return u.pathname;
    }
  } catch (e) {}

  var cut = raw.length;
  var q = raw.indexOf('?');
  var h = raw.indexOf('#');
  if (q >= 0 && q < cut) cut = q;
  if (h >= 0 && h < cut) cut = h;
  return raw.substring(0, cut);
}

function isHomepageWinnerPath_(pagePath) {
  var raw = String(pagePath || '').trim();
  if (!raw) return true;

  var p = String(winnerAssetPathname_(raw) || '').trim();
  if (!p || p === '/') return true;
  if (p.length > 1 && p.charAt(p.length - 1) === '/') {
    p = p.substring(0, p.length - 1);
  }
  return p === '';
}

/** 已不再符合生成条件的 homepage 自动候选；有人工作业时保留历史。 */
function shouldRemoveStaleHomepageCandidate_(row) {
  row = row || [];
  if (!isHomepageWinnerPath_(String(row[2] || '').trim())) return false;

  var status = String(row[16] || '').trim();
  var humanDecision = String(row[14] || '').trim();
  var humanNote = String(row[15] || '').trim();
  var assetTitle = String(row[9] || '').trim();

  if (status !== ASSET_STATUS.CANDIDATE) return false;
  if (humanDecision && humanDecision !== ASSET_HUMAN_DECISION.TODO) return false;
  if (humanNote) return false;
  if (assetTitle) return false;
  return true;
}

function pruneStaleHomepageCandidates_(rows) {
  var out = [];
  for (var i = 0; i < (rows || []).length; i++) {
    if (!shouldRemoveStaleHomepageCandidate_(rows[i])) {
      out.push(rows[i]);
    }
  }
  return out;
}

function winnerAssetRow_(opts) {
  opts = opts || {};
  return [
    opts.generatedAt || '',
    opts.siteName || '',
    opts.winnerPage || '',
    opts.winnerIntent || '',
    opts.winnerPageClicks7d || 0,
    opts.winnerPageImpressions7d || 0,
    opts.guideQueryCount7d || 0,
    opts.intentCategoryCount || 0,
    opts.assetType || '',
    opts.assetTitle || '',
    opts.reason || '',
    opts.assetLevel || '',
    opts.evidenceStatus || '',
    opts.missingEvidence || '',
    opts.humanDecision || ASSET_HUMAN_DECISION.TODO,
    opts.humanNote || '',
    opts.status || ASSET_STATUS.CANDIDATE,
    opts.createdAt || '',
    opts.updatedAt || '',
    opts.researchJobId || '',
    opts.researchRequestedAt || ''
  ];
}

function winnerAssetHasManualEdits_(row) {
  row = row || [];
  var humanDecision = String(row[14] || '').trim();
  var humanNote = String(row[15] || '').trim();
  var status = String(row[16] || '').trim();
  var assetTitle = String(row[9] || '').trim();
  if (humanDecision && humanDecision !== ASSET_HUMAN_DECISION.TODO) return true;
  if (humanNote) return true;
  if (assetTitle) return true;
  if (status && status !== ASSET_STATUS.CANDIDATE) return true;
  return false;
}

function mergeWinnerAssetRow_(existingRow, candidateRow) {
  existingRow = existingRow || [];
  candidateRow = candidateRow || [];
  var lockedStatus = ASSET_LOCKED_STATUSES[String(existingRow[16] || '').trim()];
  var manual = winnerAssetHasManualEdits_(existingRow);

  var merged = existingRow.slice();
  merged[0] = candidateRow[0];
  merged[3] = candidateRow[3];
  merged[4] = candidateRow[4];
  merged[5] = candidateRow[5];
  merged[6] = candidateRow[6];
  merged[7] = candidateRow[7];
  merged[10] = lockedStatus ? existingRow[10] : candidateRow[10];
  merged[12] = lockedStatus ? existingRow[12] : candidateRow[12];
  merged[13] = lockedStatus ? existingRow[13] : candidateRow[13];
  merged[18] = candidateRow[18];
  while (merged.length < WINNER_ASSET_HEADERS.length) merged.push('');
  if (!String(merged[19] || '').trim()) merged[19] = existingRow[19] || '';
  if (!String(merged[20] || '').trim()) merged[20] = existingRow[20] || '';

  if (!manual) {
    merged[8] = candidateRow[8];
    merged[11] = candidateRow[11];
  } else {
    if (!String(merged[8] || '').trim()) merged[8] = candidateRow[8];
    if (!String(merged[11] || '').trim()) merged[11] = candidateRow[11];
  }

  if (!String(merged[9] || '').trim()) merged[9] = candidateRow[9];
  if (!String(merged[14] || '').trim()) merged[14] = ASSET_HUMAN_DECISION.TODO;
  if (!String(merged[15] || '').trim()) merged[15] = '';
  if (!lockedStatus) {
    if (!String(merged[16] || '').trim()) merged[16] = ASSET_STATUS.CANDIDATE;
  }

  if (!String(merged[17] || '').trim()) merged[17] = candidateRow[17];
  return merged;
}

function mergeWinnerAssetRows_(existingRows, candidateRows) {
  var out = (existingRows || []).slice();
  var indexByKey = {};
  for (var i = 0; i < out.length; i++) {
    indexByKey[winnerAssetKey_(out[i])] = i;
  }

  for (var c = 0; c < (candidateRows || []).length; c++) {
    var cand = candidateRows[c];
    var key = winnerAssetKey_(cand);
    if (indexByKey.hasOwnProperty(key)) {
      out[indexByKey[key]] = mergeWinnerAssetRow_(out[indexByKey[key]], cand);
    } else {
      indexByKey[key] = out.length;
      out.push(cand);
    }
  }
  return out;
}

function writeWinnerAssetRows_(rows) {
  var sheet = ensureSheet_(SHEET_NAMES.WINNER_ASSETS, WINNER_ASSET_HEADERS);
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), WINNER_ASSET_HEADERS.length);
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }
  if (rows && rows.length) {
    var padded = [];
    for (var r = 0; r < rows.length; r++) padded.push(padWinnerAssetRow_(rows[r]));
    sheet.getRange(2, 1, padded.length, WINNER_ASSET_HEADERS.length).setValues(padded);
  }
}

/**
 * 人工菜单：处理「内容资产」Human Gate。
 * 不挂 runDaily；不改 Opportunity Research。
 */
function processWinnerAssetDecisions() {
  ensureSheet_(SHEET_NAMES.WINNER_ASSETS, WINNER_ASSET_HEADERS);
  ensureWinnerAssetHeader_();
  applyWinnerAssetDecisionValidation_();
  ensureResearchJobSheets_();

  var nowTs = nowRecordedAt_();
  writeLog_('INFO', '', 'processWinnerAssetDecisions 开始');

  var assetSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.WINNER_ASSETS);
  var jobSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  var emptySummary = emptyWinnerAssetDecisionSummary_();
  if (!assetSheet || assetSheet.getLastRow() < 2) {
    writeLog_('INFO', '', formatWinnerAssetDecisionSummary_(emptySummary));
    return emptySummary;
  }

  var assetLastCol = Math.max(assetSheet.getLastColumn(), WINNER_ASSET_HEADERS.length);
  var assetHeaders = assetSheet.getRange(1, 1, 1, assetLastCol).getValues()[0];
  var assetRows = assetSheet.getRange(2, 1, assetSheet.getLastRow() - 1, assetLastCol).getValues();

  var jobHeaders = RESEARCH_JOB_HEADERS;
  var jobRows = [];
  if (jobSheet && jobSheet.getLastRow() >= 2) {
    var jobLastCol = Math.max(jobSheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
    jobHeaders = jobSheet.getRange(1, 1, 1, jobLastCol).getValues()[0];
    jobRows = jobSheet.getRange(2, 1, jobSheet.getLastRow() - 1, jobLastCol).getValues();
  }

  var existingIds = loadExistingWinnerAssetJobIds_(jobRows, jobHeaders);
  var result = processWinnerAssetDecisionRows_(assetRows, {
    nowTs: nowTs,
    assetHeaders: assetHeaders,
    existingJobIds: existingIds
  });

  if (result.jobsToCreate && result.jobsToCreate.length) {
    try {
      if (!jobSheet) throw new Error('missing_research_job_sheet');
      var rows = [];
      for (var i = 0; i < result.jobsToCreate.length; i++) {
        rows.push(result.jobsToCreate[i].row);
      }
      var start = jobSheet.getLastRow() + 1;
      if (start < 2) start = 2;
      jobSheet.getRange(start, 1, rows.length, RESEARCH_JOB_HEADERS.length).setValues(rows);
    } catch (e) {
      writeLog_('ERROR', '', 'processWinnerAssetDecisions Job 写入失败，新建任务对应行保持 CANDIDATE');
      result = revertCreatedWinnerAssetJobs_(assetRows, result, assetHeaders);
      result.summary.error = String((e && e.message) || e || 'write_failed');
    }
  }

  if (result.changed) {
    assetSheet
      .getRange(2, 1, result.assets.length, WINNER_ASSET_HEADERS.length)
      .setValues(result.assets);
  }

  writeLog_('INFO', '', formatWinnerAssetDecisionSummary_(result.summary));
  return result.summary;
}

function applyWinnerAssetDecisionValidation_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.WINNER_ASSETS);
  if (!sheet) return;
  ensureWinnerAssetHeader_();
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = winnerAssetDecisionCol_(header);
  if (col.humanDecision === undefined) return;
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(ASSET_HUMAN_DECISION_OPTIONS, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(2, col.humanDecision + 1, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
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

function formatWinnerAssetDecisionSummary_(summary) {
  summary = summary || emptyWinnerAssetDecisionSummary_();
  return (
    'processWinnerAssetDecisions 结束 processed=' +
    summary.processed +
    ' researchCreated=' +
    summary.researchCreated +
    ' researchExisting=' +
    summary.researchExisting +
    ' ready=' +
    summary.ready +
    ' archived=' +
    summary.archived +
    ' held=' +
    summary.held +
    ' skipped=' +
    summary.skipped
  );
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

function isWinnerAssetResearchJobId_(jobId) {
  return /^asset-/.test(String(jobId || '').trim());
}

function makeWinnerAssetResearchJobId_(siteName, winnerPage) {
  var prefix = RESEARCH_GAME_SLUGS[siteName] || slugifyResearch_(siteName);
  var path = winnerAssetPathname_(winnerPage);
  var slug = '';
  if (path && path !== '/') {
    var segments = String(path).split('/').filter(function (s) {
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
  return {
    job: job,
    row: researchJobSheetRow_(job, asset.siteName, createdAt)
  };
}

function loadExistingWinnerAssetJobIds_(jobRows, jobHeaders) {
  var headers = jobHeaders && jobHeaders.length ? jobHeaders : RESEARCH_JOB_HEADERS;
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i] || '').trim();
    if (name && map[name] === undefined) map[name] = i;
  }
  var idIdx = map['任务ID'] !== undefined ? map['任务ID'] : 0;
  var ids = {};
  for (var r = 0; r < (jobRows || []).length; r++) {
    var jobId = String(cellAt_(jobRows[r], idIdx) || '').trim();
    if (jobId) ids[jobId] = true;
  }
  return ids;
}

function padWinnerAssetRow_(row) {
  var out = (row || []).slice();
  while (out.length < WINNER_ASSET_HEADERS.length) out.push('');
  return out;
}

function revertCreatedWinnerAssetJobs_(originalRows, result, assetHeaders) {
  var createdIds = {};
  var jobs = (result && result.jobsToCreate) || [];
  for (var i = 0; i < jobs.length; i++) {
    var jobId = jobs[i] && jobs[i].job && jobs[i].job.job_id;
    if (jobId) createdIds[jobId] = true;
  }
  var col = winnerAssetDecisionCol_(assetHeaders);
  var assets = [];
  var changed = false;
  for (var r = 0; r < ((result && result.assets) || []).length; r++) {
    var row = padWinnerAssetRow_(result.assets[r]);
    var id = String(cellAt_(row, col.researchJobId) || '').trim();
    if (createdIds[id]) {
      assets.push(padWinnerAssetRow_(originalRows[r]));
      changed = true;
      continue;
    }
    assets.push(row);
    if (
      originalRows[r] &&
      String(originalRows[r][col.status] || '') !== String(row[col.status] || '')
    ) {
      changed = true;
    }
  }
  var summary = result.summary || emptyWinnerAssetDecisionSummary_();
  summary.researchCreated = 0;
  return {
    assets: assets,
    jobsToCreate: [],
    summary: summary,
    changed: changed || !!(result && result.changed)
  };
}

/**
 * 纯函数：Human Gate → 标准 Research Job。
 * 只处理 CANDIDATE；LOCKED 状态不重跑。
 */
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

/**
 * 人工菜单：把「研究任务」终态同步回「内容资产」。
 * 不挂 runDaily；不调用研究审核处理或开发任务创建。
 */
function syncWinnerAssetResearchResults() {
  ensureSheet_(SHEET_NAMES.WINNER_ASSETS, WINNER_ASSET_HEADERS);
  ensureWinnerAssetHeader_();
  ensureResearchJobSheets_();

  var nowTs = nowRecordedAt_();
  writeLog_('INFO', '', 'syncWinnerAssetResearchResults 开始');

  var assetSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.WINNER_ASSETS);
  var emptySummary = emptyWinnerAssetResearchSyncSummary_();
  if (!assetSheet || assetSheet.getLastRow() < 2) {
    writeLog_('INFO', '', formatWinnerAssetResearchSyncSummary_(emptySummary));
    return emptySummary;
  }

  var assetLastCol = Math.max(assetSheet.getLastColumn(), WINNER_ASSET_HEADERS.length);
  var assetHeaders = assetSheet.getRange(1, 1, 1, assetLastCol).getValues()[0];
  var assetRows = assetSheet.getRange(2, 1, assetSheet.getLastRow() - 1, assetLastCol).getValues();

  var jobSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  var jobHeaders = RESEARCH_JOB_HEADERS;
  var jobRows = [];
  if (jobSheet && jobSheet.getLastRow() >= 2) {
    var jobLastCol = Math.max(jobSheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
    jobHeaders = jobSheet.getRange(1, 1, 1, jobLastCol).getValues()[0];
    jobRows = jobSheet.getRange(2, 1, jobSheet.getLastRow() - 1, jobLastCol).getValues();
  }

  var result = syncWinnerAssetResearchRows_(assetRows, jobRows, {
    nowTs: nowTs,
    assetHeaders: assetHeaders,
    researchHeaders: jobHeaders
  });

  var warnings = result.warnings || [];
  for (var w = 0; w < warnings.length; w++) {
    writeLog_('WARN', '', warnings[w]);
  }

  if (result.changed) {
    assetSheet
      .getRange(2, 1, result.assets.length, WINNER_ASSET_HEADERS.length)
      .setValues(result.assets);
  }

  writeLog_('INFO', '', formatWinnerAssetResearchSyncSummary_(result.summary));
  return result.summary;
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

function formatWinnerAssetResearchSyncSummary_(summary) {
  summary = summary || emptyWinnerAssetResearchSyncSummary_();
  return (
    'syncWinnerAssetResearchResults 结束 scanned=' +
    summary.scanned +
    ' ready=' +
    summary.ready +
    ' archived=' +
    summary.archived +
    ' pending=' +
    summary.pending +
    ' awaitingReview=' +
    summary.awaitingReview +
    ' watch=' +
    summary.watch +
    ' failed=' +
    summary.failed +
    ' missingJob=' +
    summary.missingJob +
    ' skippedInvalidBinding=' +
    summary.skippedInvalidBinding +
    ' skippedLocked=' +
    summary.skippedLocked
  );
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

/**
 * 纯函数：按「研究任务ID」把 Research Job 终态同步回内容资产。
 * 只改 RESEARCH 行；只有 RESEARCH→READY / RESEARCH→ARCHIVED 才更新时间。
 */
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
    if (status === ASSET_STATUS.READY || status === ASSET_STATUS.ARCHIVED || status === ASSET_STATUS.DONE) {
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
