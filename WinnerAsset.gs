/**
 * Winner Asset Candidate Layer（B2-A）
 * 只读「站点经营」，把 T2 Winner Page 转成可人工判断的内容资产候选。
 * 不重新计算 GSC / Winner；不接 Research Job；不改网站。
 */

function ensureWinnerAssetHeader_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.WINNER_ASSETS);
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), WINNER_ASSET_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var actual = [];
  for (var i = 0; i < WINNER_ASSET_HEADERS.length; i++) {
    actual.push(String(header[i] || '').trim());
  }
  if (actual.join('|') === WINNER_ASSET_HEADERS.join('|')) return;
  sheet.getRange(1, 1, 1, WINNER_ASSET_HEADERS.length).setValues([WINNER_ASSET_HEADERS]);
  sheet.getRange(1, 1, 1, WINNER_ASSET_HEADERS.length).setFontWeight('bold');
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
    opts.updatedAt || ''
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
    sheet.getRange(2, 1, rows.length, WINNER_ASSET_HEADERS.length).setValues(rows);
  }
}
