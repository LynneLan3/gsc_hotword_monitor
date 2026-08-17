/**
 * B2-A 本地自测：Winner Asset Candidate Layer（不依赖 SpreadsheetApp）。
 * 运行：node scripts/test-winner-asset.js
 */

var fs = require('fs');
var path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var INVESTMENT_TIER = { T0_TEST: 'T0_TEST', T1_TRACTION: 'T1_TRACTION', T2_WINNER: 'T2_WINNER' };
var ASSET_TYPE = {
  VERIFIED_GUIDE: 'VERIFIED_GUIDE',
  COMPARISON_MATRIX: 'COMPARISON_MATRIX',
  OTHER: 'OTHER'
};
var ASSET_LEVEL = {
  NORMAL_PAGE: 'NORMAL_PAGE',
  EVIDENCE_PAGE: 'EVIDENCE_PAGE',
  LINKABLE_ASSET: 'LINKABLE_ASSET'
};
var ASSET_EVIDENCE_STATUS = { UNKNOWN: 'UNKNOWN', PARTIAL: 'PARTIAL', READY: 'READY' };
var ASSET_HUMAN_DECISION = { TODO: 'TODO', APPROVE: 'APPROVE', HOLD: 'HOLD', SKIP: 'SKIP' };
var ASSET_STATUS = {
  CANDIDATE: 'CANDIDATE',
  RESEARCH: 'RESEARCH',
  READY: 'READY',
  DONE: 'DONE',
  ARCHIVED: 'ARCHIVED'
};
var ASSET_LOCKED_STATUSES = { RESEARCH: true, READY: true, DONE: true, ARCHIVED: true };

var PORTFOLIO_HEADERS = [
  '运行日期',
  '站点',
  '投入档位',
  '经营动作',
  '赢家页面',
  '赢家意图',
  '赢家页点击7日',
  '赢家页曝光7日',
  '攻略查询数7日',
  '意图类别数',
  '点击7日',
  '曝光7日',
  'Top20查询数',
  'DomainScore',
  '最近内容更新',
  '人工经营决定',
  '人工原因',
  '下次复盘日期'
];

function portfolioRow_(opts) {
  opts = opts || {};
  return [
    opts.runDate || '2026-08-17',
    opts.siteName || 'sample-site',
    opts.tier || INVESTMENT_TIER.T2_WINNER,
    opts.portfolioAction || 'HOLD',
    opts.winnerPage || '/sample/guide/',
    opts.winnerIntent || '',
    opts.winnerClicks || 1,
    opts.winnerImpressions || 10,
    opts.guideQueryCount || 0,
    opts.intentCategoryCount || 0,
    opts.siteClicks || 1,
    opts.impressions7d || 10,
    opts.top20 || 1,
    opts.domainScore || 0,
    '',
    '',
    '',
    ''
  ];
}

/** 完整 18 列「站点经营」真实行（含 Sheets Date / number 类型）。 */
function productionPortfolioRow_(opts) {
  opts = opts || {};
  return [
    opts.runDate || new Date(2026, 7, 17),
    opts.siteName,
    opts.tier || INVESTMENT_TIER.T2_WINNER,
    opts.portfolioAction || 'INVEST',
    opts.winnerPage,
    opts.winnerIntent || '',
    opts.winnerClicks,
    opts.winnerImpressions || 0,
    opts.guideQueryCount || 0,
    opts.intentCategoryCount || 0,
    opts.siteClicks || opts.winnerClicks || 0,
    opts.impressions7d || 0,
    opts.top20 || 0,
    opts.domainScore || 0,
    opts.lastIntervention || '',
    opts.manualDecision || '',
    opts.manualReason || '',
    opts.nextReviewDate || new Date(2026, 7, 24)
  ];
}

function pagePathFromUrl_(pageUrl) {
  var raw = String(pageUrl || '').trim();
  if (!raw) return '';
  try {
    var u = new URL(raw);
    return u.pathname || '/';
  } catch (e) {
    return raw;
  }
}

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

function suggestAssetType_(winnerIntent, metrics) {
  metrics = metrics || {};
  var intent = String(winnerIntent || '').trim();
  if (intent === 'save_progress') return ASSET_TYPE.COMPARISON_MATRIX;
  if (!intent && (metrics.winnerPageClicks7d || 0) >= 1) return ASSET_TYPE.VERIFIED_GUIDE;
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
  return { status: ASSET_EVIDENCE_STATUS.UNKNOWN, missing: '需要补充可引用的一手证据' };
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
    if (winnerPageClicks7d < 1) continue;

    var siteName = String(cellAt_(row, col.siteName) || '').trim();
    var assetType = suggestAssetType_(winnerIntent, {
      winnerPageClicks7d: winnerPageClicks7d,
      siteClicks7d: siteClicks7d
    });
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

    out.push([
      generatedAt,
      siteName,
      winnerPage,
      winnerIntent,
      winnerPageClicks7d,
      winnerPageImpressions7d,
      guideQueryCount7d,
      intentCategoryCount,
      assetType,
      '',
      reason,
      suggestAssetLevel_(assetType),
      evidence.status,
      evidence.missing,
      ASSET_HUMAN_DECISION.TODO,
      '',
      ASSET_STATUS.CANDIDATE,
      nowTs,
      nowTs,
      '',
      ''
    ]);
  }
  return out;
}

function winnerAssetKey_(row) {
  return String(row[1] || '').trim() + '||' + String(row[2] || '').trim();
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
  while (merged.length < 21) merged.push('');
  if (!String(merged[19] || '').trim()) merged[19] = existingRow[19] || '';
  if (!String(merged[20] || '').trim()) merged[20] = existingRow[20] || '';
  return merged;
}

function mergeWinnerAssetRows_(existingRows, candidateRows) {
  var out = (existingRows || []).slice();
  var indexByKey = {};
  for (var i = 0; i < out.length; i++) indexByKey[winnerAssetKey_(out[i])] = i;
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

// --- tests ---

var generatedAt = '2026-08-17';
var nowTs = '2026-08-17 18:00:00';

// 1. T2 Winner + non-homepage → candidate
var t2Rows = buildWinnerAssetCandidates_(
  [portfolioRow_({ winnerPage: '/game-a/classes/', winnerClicks: 26, siteClicks: 26 })],
  generatedAt,
  nowTs
);
assert(t2Rows.length === 1, 'T2 non-homepage should create 1 candidate');
assert(t2Rows[0].length === 21, 'candidate row should have 21 columns');

// 2. T1/T0 → skip
var tierRows = buildWinnerAssetCandidates_(
  [
    portfolioRow_({ tier: INVESTMENT_TIER.T1_TRACTION, winnerPage: '/game-b/guide/' }),
    portfolioRow_({ tier: INVESTMENT_TIER.T0_TEST, winnerPage: '/game-c/guide/' })
  ],
  generatedAt,
  nowTs
);
assert(tierRows.length === 0, 'T1/T0 must not create candidates');

// 3. homepage variants → skip
assert(isHomepageWinnerPath_('/'), "WinnerPage='/' → skip");
assert(isHomepageWinnerPath_(''), "WinnerPage='' → skip");
assert(isHomepageWinnerPath_('https://example.com/'), "WinnerPage full URL with slash → skip");
assert(isHomepageWinnerPath_('https://example.com'), "WinnerPage full URL no slash → skip");
assert(
  isHomepageWinnerPath_('https://approximately-up.vercel.app/'),
  'production homepage URL must skip'
);
assert(!isHomepageWinnerPath_('https://example.com/classes/'), 'non-homepage path → not skip');
assert(!isHomepageWinnerPath_('https://example.com/game/guide/'), 'nested path → not skip');

var homeRows = buildWinnerAssetCandidates_(
  [
    portfolioRow_({ winnerPage: '/', winnerIntent: 'platform', winnerClicks: 5, siteClicks: 5 }),
    portfolioRow_({
      siteName: 'homepage-url-site',
      winnerPage: 'https://example.com/',
      winnerIntent: 'platform',
      winnerClicks: 5,
      siteClicks: 5
    })
  ],
  generatedAt,
  nowTs
);
assert(homeRows.length === 0, 'homepage winner must skip candidate');

var nonHomeUrlRows = buildWinnerAssetCandidates_(
  [portfolioRow_({ winnerPage: 'https://example.com/classes/', winnerClicks: 3, siteClicks: 3 })],
  generatedAt,
  nowTs
);
assert(nonHomeUrlRows.length === 1, 'non-homepage full URL should create candidate');

// 4. save_progress → COMPARISON_MATRIX
var saveRows = buildWinnerAssetCandidates_(
  [
    portfolioRow_({
      winnerPage: '/game-d/beta-progress-carry-over/',
      winnerIntent: 'save_progress',
      winnerClicks: 4,
      winnerImpressions: 817,
      guideQueryCount: 17,
      intentCategoryCount: 2
    })
  ],
  generatedAt,
  nowTs
);
assert(saveRows.length === 1, 'save_progress winner should create candidate');
assert(saveRows[0][8] === ASSET_TYPE.COMPARISON_MATRIX, 'save_progress → COMPARISON_MATRIX');
assert(saveRows[0][11] === ASSET_LEVEL.EVIDENCE_PAGE, 'COMPARISON_MATRIX → EVIDENCE_PAGE');

// 5. intent 空 + clicks → VERIFIED_GUIDE
var emptyIntentRows = buildWinnerAssetCandidates_(
  [
    portfolioRow_({
      winnerPage: '/game-e/classes/',
      winnerIntent: '',
      winnerClicks: 26,
      winnerImpressions: 230,
      siteClicks: 26
    })
  ],
  generatedAt,
  nowTs
);
assert(emptyIntentRows.length === 1, 'empty intent with clicks should create candidate');
assert(emptyIntentRows[0][8] === ASSET_TYPE.VERIFIED_GUIDE, 'empty intent → VERIFIED_GUIDE');
assert(emptyIntentRows[0][11] === ASSET_LEVEL.NORMAL_PAGE, 'VERIFIED_GUIDE → NORMAL_PAGE');
assert(
  emptyIntentRows[0][12] === ASSET_EVIDENCE_STATUS.UNKNOWN,
  'empty intent evidence should be UNKNOWN'
);

// 6. repeat run no duplicate
var first = buildWinnerAssetCandidates_(
  [portfolioRow_({ siteName: 'site-x', winnerPage: '/site-x/guide/' })],
  generatedAt,
  nowTs
);
var mergedOnce = mergeWinnerAssetRows_([], first);
var second = buildWinnerAssetCandidates_(
  [portfolioRow_({ siteName: 'site-x', winnerPage: '/site-x/guide/', winnerClicks: 2 })],
  '2026-08-18',
  '2026-08-18 09:00:00'
);
var mergedTwice = mergeWinnerAssetRows_(mergedOnce, second);
assert(mergedTwice.length === 1, 'repeat run must not duplicate rows');

// 7. metrics update but manual fields preserved
var manualRow = mergedOnce[0].slice();
manualRow[8] = ASSET_TYPE.OTHER;
manualRow[9] = '人工标题';
manualRow[14] = ASSET_HUMAN_DECISION.APPROVE;
manualRow[15] = '人工备注';
manualRow[16] = ASSET_STATUS.RESEARCH;
var mergedManual = mergeWinnerAssetRows_([manualRow], second)[0];
assert(mergedManual[4] === 2, 'winner clicks metric should update');
assert(mergedManual[8] === ASSET_TYPE.OTHER, 'manual asset type preserved');
assert(mergedManual[9] === '人工标题', 'manual title preserved');
assert(mergedManual[14] === ASSET_HUMAN_DECISION.APPROVE, 'human decision preserved');
assert(mergedManual[15] === '人工备注', 'human note preserved');
assert(mergedManual[16] === ASSET_STATUS.RESEARCH, 'locked status preserved');

manualRow[19] = 'asset-site-x-guide';
manualRow[20] = '2026-08-17 11:00:00';
var mergedJobId = mergeWinnerAssetRows_([manualRow], second)[0];
assert(mergedJobId[19] === 'asset-site-x-guide', 'research job id preserved on rebuild');
assert(mergedJobId[20] === '2026-08-17 11:00:00', 'research requested at preserved on rebuild');

// 8. winner page change → new row, old kept
var oldWinner = buildWinnerAssetCandidates_(
  [portfolioRow_({ siteName: 'site-y', winnerPage: '/site-y/old-page/' })],
  generatedAt,
  nowTs
);
var newWinner = buildWinnerAssetCandidates_(
  [portfolioRow_({ siteName: 'site-y', winnerPage: '/site-y/new-page/' })],
  generatedAt,
  nowTs
);
var both = mergeWinnerAssetRows_(oldWinner, newWinner);
assert(both.length === 2, 'winner page change should add new candidate without deleting old');

// stale homepage auto candidate → prune on rebuild
function staleHomepageRow_(opts) {
  opts = opts || {};
  return [
    generatedAt,
    opts.siteName || 'homepage-site',
    opts.winnerPage || 'https://example.com/',
    opts.winnerIntent || 'platform',
    5,
    100,
    0,
    0,
    ASSET_TYPE.VERIFIED_GUIDE,
    opts.assetTitle || '',
    'stale homepage candidate',
    ASSET_LEVEL.NORMAL_PAGE,
    ASSET_EVIDENCE_STATUS.UNKNOWN,
    '',
    opts.humanDecision || ASSET_HUMAN_DECISION.TODO,
    opts.humanNote || '',
    opts.status || ASSET_STATUS.CANDIDATE,
    nowTs,
    nowTs,
    '',
    ''
  ];
}

var keepRow = buildWinnerAssetCandidates_(
  [portfolioRow_({ siteName: 'site-keep', winnerPage: '/site-keep/guide/' })],
  generatedAt,
  nowTs
)[0];
var prunedAuto = pruneStaleHomepageCandidates_([
  keepRow,
  staleHomepageRow_({ siteName: 'Approximately Up', winnerPage: 'https://approximately-up.vercel.app/' })
]);
assert(prunedAuto.length === 1, 'auto homepage CANDIDATE/TODO/no note should be removed');
assert(prunedAuto[0][1] === 'site-keep', 'valid candidate should remain after prune');

var prunedHold = pruneStaleHomepageCandidates_([
  staleHomepageRow_({ humanDecision: ASSET_HUMAN_DECISION.HOLD })
]);
assert(prunedHold.length === 1, 'homepage with HumanDecision=HOLD must be kept');

var prunedResearch = pruneStaleHomepageCandidates_([
  staleHomepageRow_({ status: ASSET_STATUS.RESEARCH })
]);
assert(prunedResearch.length === 1, 'homepage with Status=RESEARCH must be kept');

// 9. does not read RecommendedAction (portfolio col 3)
var actionIgnored = buildWinnerAssetCandidates_(
  [
    portfolioRow_({
      portfolioAction: 'INVEST',
      winnerPage: '/site-z/guide/',
      winnerClicks: 3
    }),
    portfolioRow_({
      portfolioAction: 'FREEZE',
      winnerPage: '/site-z/other/',
      winnerClicks: 99
    })
  ],
  generatedAt,
  nowTs
);
assert(actionIgnored.length === 2, 'portfolio action must not gate candidate generation');

// 10. does not modify PortfolioAction — engine source is read-only
var winnerAssetGs = fs.readFileSync(path.join(__dirname, '..', 'WinnerAsset.gs'), 'utf8');
assert(
  !/PORTFOLIO_ACTION|经营动作|RecommendedAction/.test(winnerAssetGs),
  'WinnerAsset.gs must not reference PortfolioAction/RecommendedAction'
);
assert(!/setValues\(\).*PORTFOLIO/.test(winnerAssetGs), 'WinnerAsset.gs must not write portfolio sheet');
assert(winnerAssetGs.indexOf("'赢家页面'") >= 0, 'WinnerAsset must map 赢家页面 by header name');
assert(
  !/pagePathFromUrl_/.test(winnerAssetGs),
  'WinnerAsset homepage gate must not depend on global pagePathFromUrl_'
);

// Agefield-like fixture (generic metrics, no hardcoded site name)
var agefieldLike = buildWinnerAssetCandidates_(
  [
    portfolioRow_({
      siteName: 'agefield-high-rock-the-school',
      winnerPage: '/agefield-high-rock-the-school/classes/',
      winnerIntent: '',
      winnerClicks: 26,
      winnerImpressions: 230,
      siteClicks: 26
    })
  ],
  generatedAt,
  nowTs
);
assert(agefieldLike.length === 1, 'Agefield-like T2 winner should create 1 candidate');
assert(agefieldLike[0][8] === ASSET_TYPE.VERIFIED_GUIDE, 'Agefield-like → VERIFIED_GUIDE');
assert(agefieldLike[0][11] === ASSET_LEVEL.NORMAL_PAGE, 'Agefield-like level NORMAL_PAGE');
assert(agefieldLike[0][14] === ASSET_HUMAN_DECISION.TODO, 'Agefield-like human decision TODO');
assert(agefieldLike[0][16] === ASSET_STATUS.CANDIDATE, 'Agefield-like status CANDIDATE');
assert(
  agefieldLike[0][10].indexOf('26/26') >= 0,
  'Agefield-like reason should mention click concentration'
);

// MS2-like fixture
var ms2Like = buildWinnerAssetCandidates_(
  [
    portfolioRow_({
      siteName: 'mortal-shell-ii',
      winnerPage: '/mortal-shell-ii/beta-progress-carry-over/',
      winnerIntent: 'save_progress',
      winnerClicks: 4,
      winnerImpressions: 817,
      guideQueryCount: 17,
      intentCategoryCount: 2
    })
  ],
  generatedAt,
  nowTs
);
assert(ms2Like.length === 1, 'MS2-like should create 1 candidate');
assert(ms2Like[0][8] === ASSET_TYPE.COMPARISON_MATRIX, 'MS2-like → COMPARISON_MATRIX');
assert(ms2Like[0][12] === ASSET_EVIDENCE_STATUS.PARTIAL, 'MS2-like evidence PARTIAL');
assert(ms2Like[0][10].indexOf('save/progress') >= 0, 'MS2-like reason mentions save/progress');

// Config / Sheet wiring smoke checks
var configGs = fs.readFileSync(path.join(__dirname, '..', 'Config.gs'), 'utf8');
assert(configGs.indexOf("WINNER_ASSETS: '内容资产'") >= 0, 'Config must define WINNER_ASSETS sheet');
assert(configGs.indexOf('WINNER_ASSET_HEADERS') >= 0, 'Config must define WINNER_ASSET_HEADERS');
assert(configGs.indexOf("'研究任务ID'") >= 0, 'WINNER_ASSET_HEADERS must append 研究任务ID');
assert(configGs.indexOf("'研究请求时间'") >= 0, 'WINNER_ASSET_HEADERS must append 研究请求时间');
assert(
  /'更新时间',\s*'研究任务ID',\s*'研究请求时间'/.test(configGs),
  'research columns must be appended after 更新时间'
);

var codeGs = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
assert(codeGs.indexOf('runWinnerAssetEngine') >= 0, 'Code.gs menu must call runWinnerAssetEngine');

assert(
  pagePathFromUrl_('https://approximately-up.vercel.app/') === '/',
  'pagePathFromUrl_ of production homepage URL should be /'
);

// A. helper 单测（homepage true / false）
assert(isHomepageWinnerPath_(''), "helper '' → homepage");
assert(isHomepageWinnerPath_('/'), "helper '/' → homepage");
assert(isHomepageWinnerPath_('https://example.com/'), 'helper https://example.com/ → homepage');
assert(isHomepageWinnerPath_('https://example.com'), 'helper https://example.com → homepage');
assert(!isHomepageWinnerPath_('https://example.com/classes/'), 'helper /classes/ → not homepage');
assert(
  isHomepageWinnerPath_('https://example.com/?x=1'),
  'helper query-only URL still homepage'
);
assert(
  isHomepageWinnerPath_('https://example.com/#foo'),
  'helper hash-only URL still homepage'
);

// B. 完整 18 列 Approximately Up 生产行 → 必须走 buildWinnerAssetCandidates_
var auProductionRow = productionPortfolioRow_({
  siteName: 'Approximately Up',
  portfolioAction: 'INVEST',
  winnerPage: 'https://approximately-up.vercel.app/',
  winnerIntent: 'platform',
  winnerClicks: 3,
  winnerImpressions: 443,
  guideQueryCount: 6,
  intentCategoryCount: 3,
  siteClicks: 4,
  impressions7d: 546,
  top20: 19,
  domainScore: 68
});
assert(auProductionRow.length === 18, 'AU production row must be 18 columns');
assert(auProductionRow[2] === INVESTMENT_TIER.T2_WINNER, 'AU col2 投入档位');
assert(auProductionRow[3] === 'INVEST', 'AU col3 经营动作 not WinnerPage');
assert(
  auProductionRow[4] === 'https://approximately-up.vercel.app/',
  'AU col4 赢家页面'
);
assert(auProductionRow[5] === 'platform', 'AU col5 赢家意图');
assert(auProductionRow[6] === 3, 'AU col6 赢家页点击7日');
assert(auProductionRow[7] === 443, 'AU col7 赢家页曝光7日');
assert(auProductionRow[9] === 3, 'AU col9 意图类别数');

var auCandidates = buildWinnerAssetCandidates_(
  [auProductionRow],
  generatedAt,
  nowTs,
  PORTFOLIO_HEADERS
);
assert(
  auCandidates.length === 0,
  'Approximately Up production row must yield 0 candidates, got ' + auCandidates.length
);

// C. Agefield / MS2 完整 URL 对照 + 三行一起
var agefieldProductionRow = productionPortfolioRow_({
  siteName: 'Agefield High: Rock the School',
  portfolioAction: 'HOLD',
  winnerPage:
    'https://agefield-high-rock-the-school.vercel.app/agefield-high-rock-the-school/classes/',
  winnerIntent: '',
  winnerClicks: 26,
  winnerImpressions: 230,
  siteClicks: 26,
  impressions7d: 283
});
var ms2ProductionRow = productionPortfolioRow_({
  siteName: 'Mortal Shell II',
  portfolioAction: 'HOLD',
  winnerPage: 'https://mortal-shell-ii.vercel.app/mortal-shell-ii/beta-progress-carry-over/',
  winnerIntent: 'save_progress',
  winnerClicks: 4,
  winnerImpressions: 817,
  guideQueryCount: 17,
  intentCategoryCount: 2
});

var agefieldOnly = buildWinnerAssetCandidates_(
  [agefieldProductionRow],
  generatedAt,
  nowTs,
  PORTFOLIO_HEADERS
);
assert(agefieldOnly.length === 1, 'Agefield production row should create 1 candidate');
assert(
  agefieldOnly[0][8] === ASSET_TYPE.VERIFIED_GUIDE,
  'Agefield production → VERIFIED_GUIDE'
);

var ms2Only = buildWinnerAssetCandidates_(
  [ms2ProductionRow],
  generatedAt,
  nowTs,
  PORTFOLIO_HEADERS
);
assert(ms2Only.length === 1, 'MS2 production row should create 1 candidate');
assert(
  ms2Only[0][8] === ASSET_TYPE.COMPARISON_MATRIX,
  'MS2 production → COMPARISON_MATRIX'
);

var threeTogether = buildWinnerAssetCandidates_(
  [auProductionRow, agefieldProductionRow, ms2ProductionRow],
  generatedAt,
  nowTs,
  PORTFOLIO_HEADERS
);
assert(
  threeTogether.length === 2,
  'three production rows together must yield exactly 2 candidates, got ' +
    threeTogether.length
);
assert(threeTogether[0][1] === 'Agefield High: Rock the School', 'first remaining is Agefield');
assert(threeTogether[1][1] === 'Mortal Shell II', 'second remaining is MS2');

// header-name mapping：前插一列后，硬编码 col4 会读到经营动作；必须仍读「赢家页面」
var shiftedHeaders = ['额外列'].concat(PORTFOLIO_HEADERS);
var shiftedAu = [''].concat(auProductionRow);
var shiftedAgefield = [''].concat(agefieldProductionRow);
var shiftedMs2 = [''].concat(ms2ProductionRow);
var shiftedTogether = buildWinnerAssetCandidates_(
  [shiftedAu, shiftedAgefield, shiftedMs2],
  generatedAt,
  nowTs,
  shiftedHeaders
);
assert(
  shiftedTogether.length === 2,
  'shifted headers must still yield 2 candidates, got ' + shiftedTogether.length
);

console.log('PASS scripts/test-winner-asset.js');
