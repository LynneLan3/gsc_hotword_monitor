/**
 * Content Opportunity Engine M0
 * 只读「Query页面明细」，按确定性规则生成「内容机会」。
 * 不请求外部 API，不修改 Decision Engine / runDaily 行为。
 */

/**
 * 独立入口：人工验收后再决定是否接入每日自动流程。
 * 幂等：按 DataDate+Site+normalizedQuery upsert；每次运行重建各站最新 DataDate 快照。
 */
function runContentOpportunityEngine() {
  ensureOpportunitySheets_();
  var generatedAt = new Date();
  writeLog_('INFO', '', 'runContentOpportunityEngine 开始');

  var sites = getEnabledSites();
  if (!sites.length) {
    replaceSheetDataRows_(SHEET_NAMES.OPPORTUNITIES, OPPORTUNITY_HEADERS, []);
    writeLog_('INFO', '', 'runContentOpportunityEngine 结束：无启用站点');
    return;
  }

  var allQueryPageRows = loadAllQueryPageRows_();
  var historyBySiteQuery = buildOpportunityQueryHistory_(allQueryPageRows);
  var rowsBySite = groupQueryPageRowsBySite_(allQueryPageRows);

  var outRows = [];
  var summaries = [];

  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    var siteRows = rowsBySite[site.name] || [];
    var latestDate = findLatestQueryPageDataDate_(siteRows);
    if (!latestDate) {
      summaries.push(site.name + '→skip(no query)');
      continue;
    }

    var latestRows = filterQueryPageRowsByDate_(siteRows, latestDate);
    var primaryByQuery = pickPrimaryQueryPageRows_(latestRows);
    var keys = Object.keys(primaryByQuery);
    var siteCount = 0;

    for (var k = 0; k < keys.length; k++) {
      var normQuery = keys[k];
      var raw = primaryByQuery[normQuery];
      var histKey = site.name + '||' + normQuery;
      var hist = historyBySiteQuery[histKey] || {
        firstSeenDate: latestDate,
        seenDays: 1
      };
      var decision = decideOpportunity_(site, raw, hist, latestDate);
      outRows.push(opportunityRow_(generatedAt, site, latestDate, raw, decision, hist));
      siteCount++;
    }

    summaries.push(site.name + '→' + siteCount + '@' + latestDate);
  }

  replaceSheetDataRows_(SHEET_NAMES.OPPORTUNITIES, OPPORTUNITY_HEADERS, outRows);
  writeLog_(
    'INFO',
    '',
    'runContentOpportunityEngine 结束 rows=' + outRows.length + ' | ' + summaries.join(' | ')
  );
}

function ensureOpportunitySheets_() {
  ensureSheet_(SHEET_NAMES.OPPORTUNITIES, OPPORTUNITY_HEADERS);
}

/**
 * @return {Array<Array>}
 */
function loadAllQueryPageRows_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.QUERY_PAGES);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow(), QUERY_PAGE_HEADERS.length).getValues();
}

function groupQueryPageRowsBySite_(rows) {
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var site = String(rows[i][1] || '').trim();
    if (!site) continue;
    if (!map[site]) map[site] = [];
    map[site].push(rows[i]);
  }
  return map;
}

function findLatestQueryPageDataDate_(siteRows) {
  var latest = '';
  for (var i = 0; i < siteRows.length; i++) {
    var d = normalizeKeyDate_(siteRows[i][0]);
    if (d && d > latest) latest = d;
  }
  return latest;
}

function filterQueryPageRowsByDate_(siteRows, dataDate) {
  var target = normalizeKeyDate_(dataDate);
  var out = [];
  for (var i = 0; i < siteRows.length; i++) {
    if (normalizeKeyDate_(siteRows[i][0]) === target) out.push(siteRows[i]);
  }
  return out;
}

/**
 * 同一 Site+DataDate+normalizedQuery 多页时，取曝光最高的主承接页。
 * @return {Object} normQuery -> { query, pageUrl, pagePath, clicks, impressions, ctr, position }
 */
function pickPrimaryQueryPageRows_(latestRows) {
  var map = {};
  for (var i = 0; i < latestRows.length; i++) {
    var row = latestRows[i];
    var query = String(row[2] || '').trim();
    if (!query) continue;
    var norm = normalizeOpportunityQuery_(query);
    if (!norm) continue;

    var candidate = {
      query: query,
      pageUrl: String(row[3] || '').trim(),
      pagePath: resolveOpportunityPagePath_(row[3], row[4]),
      clicks: Number(row[5] || 0),
      impressions: Number(row[6] || 0),
      ctr: Number(row[7] || 0),
      position: Number(row[8] || 0)
    };

    var prev = map[norm];
    if (!prev || opportunityRowRank_(candidate) > opportunityRowRank_(prev)) {
      map[norm] = candidate;
    }
  }
  return map;
}

/** 越高越优先：impressions → clicks → 更好排名（position 越小越好） */
function opportunityRowRank_(r) {
  var posScore = r.position > 0 ? 1 / r.position : 0;
  return r.impressions * 1e6 + r.clicks * 1e3 + posScore;
}

/**
 * Site + normalized Query → { firstSeenDate, seenDays, dates }
 */
function buildOpportunityQueryHistory_(allRows) {
  var map = {};
  for (var i = 0; i < allRows.length; i++) {
    var site = String(allRows[i][1] || '').trim();
    var query = String(allRows[i][2] || '').trim();
    var d = normalizeKeyDate_(allRows[i][0]);
    if (!site || !query || !d) continue;
    var norm = normalizeOpportunityQuery_(query);
    if (!norm) continue;
    var key = site + '||' + norm;
    if (!map[key]) {
      map[key] = { firstSeenDate: d, seenDays: 0, dates: {} };
    }
    if (!map[key].dates[d]) {
      map[key].dates[d] = true;
      map[key].seenDays += 1;
    }
    if (d < map[key].firstSeenDate) map[key].firstSeenDate = d;
  }
  return map;
}

/**
 * 始终输出真实 pathname。完整 http(s) URL 只保留 pathname，绝不把整段 URL 再加 `/`。
 */
function resolveOpportunityPagePath_(pageUrl, pagePathCell) {
  function pathnameOnly_(value) {
    var s = String(value || '').trim();
    if (!s) return '';
    var m = /^https?:\/\/[^\/?#]+(\/[^?#]*)?/i.exec(s);
    if (!m) return '';
    return m[1] || '/';
  }

  var fromUrl = pathnameOnly_(pageUrl);
  if (fromUrl) return fromUrl;

  var fromCell = pathnameOnly_(pagePathCell);
  if (fromCell) return fromCell;

  var cell = String(pagePathCell || '').trim();
  if (!cell) return '/';
  if (cell.charAt(0) === '/') return cell;
  return '/' + cell;
}

/**
 * 仅 trim + lowercase + 连续空格归一。保留原始 Query 在 raw.query。
 */
function normalizeOpportunityQuery_(query) {
  return String(query || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * @param {Object} site
 * @param {Object} raw pickPrimary 结果
 * @param {{firstSeenDate:string,seenDays:number}} hist
 * @param {string} latestDate
 */
function decideOpportunity_(site, raw, hist, latestDate) {
  var intent = classifyOpportunityIntent_(raw.query, site);
  var specificity = classifyOpportunitySpecificity_(intent);
  var level = classifyOpportunityLevel_(raw, specificity, hist);
  var action = classifyOpportunityAction_(site, raw, intent, specificity, level);
  var reason = buildOpportunityReason_(raw, intent, specificity, level, action);
  var isNew = hist.firstSeenDate === latestDate;

  return {
    intent: intent,
    specificity: specificity,
    level: level,
    action: action,
    reason: reason,
    firstSeenDate: hist.firstSeenDate,
    seenDays: hist.seenDays,
    isNewQuery: isNew
  };
}

function classifyOpportunityIntent_(query, site) {
  var q = normalizeOpportunityQuery_(query);
  if (!q) return OPPORTUNITY_INTENT.OTHER;
  if (isPureBrandQuery_(q, site)) return OPPORTUNITY_INTENT.BRAND;

  for (var i = 0; i < OPPORTUNITY_INTENT_RULES.length; i++) {
    var rule = OPPORTUNITY_INTENT_RULES[i];
    if (queryHasIntentTerms_(q, rule.terms)) return rule.intent;
  }
  return OPPORTUNITY_INTENT.OTHER;
}

function classifyOpportunitySpecificity_(intent) {
  if (intent === OPPORTUNITY_INTENT.BRAND) return OPPORTUNITY_SPECIFICITY.BRAND_ONLY;
  if (intent === OPPORTUNITY_INTENT.OTHER) return OPPORTUNITY_SPECIFICITY.AMBIGUOUS;
  return OPPORTUNITY_SPECIFICITY.SPECIFIC_INTENT;
}

function classifyOpportunityLevel_(raw, specificity, hist) {
  var t = OPPORTUNITY_THRESHOLDS;
  var clicks = Number(raw.clicks || 0);
  var impressions = Number(raw.impressions || 0);
  var position = Number(raw.position || 0);
  var inHighBand =
    position >= t.HIGH_POS_MIN &&
    position <= t.HIGH_POS_MAX &&
    impressions >= t.HIGH_MIN_IMPRESSIONS;
  var hasClick = clicks >= t.HIGH_MIN_CLICKS;
  var hasSignal = impressions >= t.MEDIUM_MIN_IMPRESSIONS;
  var far = position > t.WATCH_POS_FAR;

  if (specificity === OPPORTUNITY_SPECIFICITY.BRAND_ONLY) {
    return OPPORTUNITY_LEVELS.WATCH;
  }

  if (specificity === OPPORTUNITY_SPECIFICITY.SPECIFIC_INTENT) {
    if (hasClick) return OPPORTUNITY_LEVELS.HIGH;
    if (inHighBand) return OPPORTUNITY_LEVELS.HIGH;
    if (hasSignal && !far) return OPPORTUNITY_LEVELS.MEDIUM;
    if (hasSignal && far) return OPPORTUNITY_LEVELS.WATCH;
    return OPPORTUNITY_LEVELS.WATCH;
  }

  // AMBIGUOUS
  if (hasClick && hasSignal && !far) return OPPORTUNITY_LEVELS.MEDIUM;
  return OPPORTUNITY_LEVELS.WATCH;
}

function classifyOpportunityAction_(site, raw, intent, specificity, level) {
  if (specificity === OPPORTUNITY_SPECIFICITY.BRAND_ONLY) {
    return OPPORTUNITY_ACTIONS.IGNORE_BRAND;
  }

  var pagePath = resolveOpportunityPagePath_(raw.pageUrl, raw.pagePath);
  var isHub = isOpportunityHubPath_(pagePath, site);
  var isRelatedGuide = isOpportunityRelatedGuidePage_(raw.query, pagePath, site);

  if (specificity === OPPORTUNITY_SPECIFICITY.SPECIFIC_INTENT) {
    if (!isHub && isRelatedGuide) {
      return OPPORTUNITY_ACTIONS.RESEARCH_EXPAND_EXISTING;
    }
    if (isHub) {
      return OPPORTUNITY_ACTIONS.RESEARCH_NEW_CONTENT;
    }
    // 非 hub 但路径与 query 关联弱：仍建议扩写已有页，避免为弱相关 query 新开页候选
    if (!isHub) {
      return OPPORTUNITY_ACTIONS.RESEARCH_EXPAND_EXISTING;
    }
  }

  if (level === OPPORTUNITY_LEVELS.WATCH) {
    return OPPORTUNITY_ACTIONS.WATCH;
  }
  return OPPORTUNITY_ACTIONS.WATCH;
}

/**
 * Hub / 泛承接：首页、站点品牌单段 slug、或已知 hub slug。
 * 其它单段攻略 path（如 /beta-progress-carry-over/、/platforms/）不是 Hub。
 */
function isOpportunityHubPath_(pagePath, site) {
  var path = normalizeOpportunityPath_(pagePath);
  if (!path || path === '/') return true;

  var segments = path.split('/').filter(function (s) {
    return !!s;
  });
  if (!segments.length) return true;
  if (segments.length === 1) {
    var slug = segments[0].toLowerCase();
    if (OPPORTUNITY_HUB_SLUGS[slug]) return true;
    var brandSlug = opportunityBrandSlug_(site);
    if (brandSlug && slug === brandSlug) return true;
    return false;
  }
  return false;
}

function normalizeOpportunityPath_(pagePath) {
  var p = String(pagePath || '').trim();
  if (!p) return '';
  try {
    if (/^https?:\/\//i.test(p)) p = pagePathFromUrl_(p);
  } catch (e) {
    // keep raw
  }
  if (p.charAt(0) !== '/') p = '/' + p;
  if (p.length > 1 && p.charAt(p.length - 1) === '/') {
    p = p.substring(0, p.length - 1);
  }
  return p || '/';
}

function opportunityBrandSlug_(site) {
  if (!site || !site.propertyUrl) return '';
  try {
    var host = new URL(site.propertyUrl).hostname || '';
    return String(host.split('.')[0] || '').toLowerCase();
  } catch (e) {
    return '';
  }
}

/**
 * 非首页攻略页且 path token 与 query 残差 token 有交集 → 明显相关。
 */
function isOpportunityRelatedGuidePage_(query, pagePath, site) {
  if (isOpportunityHubPath_(pagePath, site)) return false;

  var path = normalizeOpportunityPath_(pagePath);
  var pathTokens = tokenizeBrand_(path.replace(/[\/\-_]+/g, ' '));
  if (!pathTokens.length) return false;

  var q = normalizeOpportunityQuery_(query);
  var qTokens = tokenizeBrand_(q);
  var brand = getBrandTokenSet_(site);
  var residual = [];
  for (var i = 0; i < qTokens.length; i++) {
    if (!brand[qTokens[i]]) residual.push(qTokens[i]);
  }
  // 无残差时：品牌+意图词可能被 tokenize 掉数字等；用 path 是否含意图相关片段
  if (!residual.length) {
    return pathTokens.length >= 2;
  }

  var pathSet = {};
  for (var p = 0; p < pathTokens.length; p++) pathSet[pathTokens[p]] = true;

  var overlap = 0;
  for (var r = 0; r < residual.length; r++) {
    if (pathSet[residual[r]]) overlap++;
  }
  return overlap >= 1;
}

function buildOpportunityReason_(raw, intent, specificity, level, action) {
  var impressions = Number(raw.impressions || 0);
  var clicks = Number(raw.clicks || 0);
  var position = Number(raw.position || 0);
  var posText = position ? String(Math.round(position * 10) / 10) : 'n/a';
  var path = resolveOpportunityPagePath_(raw.pageUrl, raw.pagePath) || '/';

  if (action === OPPORTUNITY_ACTIONS.IGNORE_BRAND) {
    return (
      'Brand-only query with ' +
      impressions +
      ' impressions; keep watching brand demand without social research priority.'
    );
  }

  if (action === OPPORTUNITY_ACTIONS.RESEARCH_EXPAND_EXISTING) {
    return (
      'Specific ' +
      intent.toLowerCase().replace(/_/g, ' ') +
      ' query with ' +
      impressions +
      ' impressions and avg position ' +
      posText +
      ' already ranking on a matching page (' +
      path +
      ').'
    );
  }

  if (action === OPPORTUNITY_ACTIONS.RESEARCH_NEW_CONTENT) {
    return (
      intent.replace(/_/g, ' ') +
      '-oriented query is receiving ' +
      impressions +
      ' impressions on the game hub (' +
      path +
      ') and may deserve deeper content research.'
    );
  }

  if (specificity === OPPORTUNITY_SPECIFICITY.AMBIGUOUS) {
    return (
      'Ambiguous query with weak or unclear intent (' +
      impressions +
      ' impressions, position ' +
      posText +
      '); watch before researching.'
    );
  }

  return (
    'Low-confidence opportunity (' +
    level +
    ') with ' +
    impressions +
    ' impressions / ' +
    clicks +
    ' clicks at position ' +
    posText +
    '; watch for stronger repeat signals.'
  );
}

function opportunityRow_(generatedAt, site, dataDate, raw, decision, hist) {
  return [
    generatedAt,
    dataDate,
    site.name,
    site.propertyUrl || '',
    raw.query,
    raw.pageUrl || '',
    resolveOpportunityPagePath_(raw.pageUrl, raw.pagePath),
    raw.clicks || 0,
    raw.impressions || 0,
    raw.ctr || 0,
    raw.position || 0,
    decision.intent,
    decision.specificity,
    decision.level,
    decision.action,
    decision.reason,
    decision.firstSeenDate || hist.firstSeenDate || dataDate,
    decision.seenDays || hist.seenDays || 1,
    decision.isNewQuery ? true : false,
    '',
    ''
  ];
}

/**
 * 不写 Sheet、不联网的纯规则自检。可在 Apps Script 编辑器单独运行。
 * @return {string} PASS/FAIL 摘要
 */
function debugOpportunityEngineSelfCheck() {
  var fails = [];
  function assert(cond, msg) {
    if (!cond) fails.push(msg);
  }

  var approx = {
    name: 'Approximately Up',
    propertyUrl: 'https://approximately-up.vercel.app/'
  };
  var mortal = {
    name: 'Mortal Shell II',
    propertyUrl: 'https://mortal-shell-ii.vercel.app/'
  };
  var sovereign = {
    name: 'Sovereign Tower',
    propertyUrl: 'https://sovereign-tower.vercel.app/'
  };

  // Approximately Up
  assert(
    classifyOpportunityIntent_('approximately up', approx) === OPPORTUNITY_INTENT.BRAND,
    'approximately up → BRAND'
  );
  assert(
    classifyOpportunitySpecificity_(OPPORTUNITY_INTENT.BRAND) ===
      OPPORTUNITY_SPECIFICITY.BRAND_ONLY,
    'approximately up → BRAND_ONLY'
  );
  assert(
    classifyOpportunityAction_(
      approx,
      { query: 'approximately up', pagePath: '/', clicks: 0, impressions: 2, position: 12 },
      OPPORTUNITY_INTENT.BRAND,
      OPPORTUNITY_SPECIFICITY.BRAND_ONLY,
      OPPORTUNITY_LEVELS.WATCH
    ) === OPPORTUNITY_ACTIONS.IGNORE_BRAND,
    'approximately up → IGNORE_BRAND'
  );

  var approxCases = [
    ['approximately up ps5', OPPORTUNITY_INTENT.PLATFORM],
    ['approximately up mobile', OPPORTUNITY_INTENT.PLATFORM],
    ['approximately up gameplay', OPPORTUNITY_INTENT.GAMEPLAY],
    ['approximately up tutorial', OPPORTUNITY_INTENT.GUIDE],
    ['approximately up first mission', OPPORTUNITY_INTENT.MISSION],
    ['approximately up wiki', OPPORTUNITY_INTENT.GUIDE]
  ];
  for (var a = 0; a < approxCases.length; a++) {
    var intentA = classifyOpportunityIntent_(approxCases[a][0], approx);
    assert(intentA === approxCases[a][1], approxCases[a][0] + ' → ' + approxCases[a][1]);
    assert(
      classifyOpportunitySpecificity_(intentA) === OPPORTUNITY_SPECIFICITY.SPECIFIC_INTENT,
      approxCases[a][0] + ' → SPECIFIC_INTENT'
    );
  }

  // Mortal Shell II → expand existing on matching beta page
  var betaPath = '/mortal-shell-ii/beta-progress-carry-over/';
  var mortalQueries = [
    'mortal shell 2 beta rewards',
    'mortal shell 2 beta carry over',
    'mortal shell 2 beta progress carry over',
    'does mortal shell 2 beta progress carry over',
    'mortal shell 2 beta save',
    'mortal shell 2 beta save file'
  ];
  for (var m = 0; m < mortalQueries.length; m++) {
    var q = mortalQueries[m];
    var intentM = classifyOpportunityIntent_(q, mortal);
    var specM = classifyOpportunitySpecificity_(intentM);
    assert(specM === OPPORTUNITY_SPECIFICITY.SPECIFIC_INTENT, q + ' should be SPECIFIC_INTENT');
    assert(
      isOpportunityRelatedGuidePage_(q, betaPath, mortal) === true,
      q + ' should match beta carry-over page'
    );
    var actionM = classifyOpportunityAction_(
      mortal,
      { query: q, pagePath: betaPath, clicks: 0, impressions: 9, position: 8.6 },
      intentM,
      specM,
      OPPORTUNITY_LEVELS.HIGH
    );
    assert(
      actionM === OPPORTUNITY_ACTIONS.RESEARCH_EXPAND_EXISTING,
      q + ' → RESEARCH_EXPAND_EXISTING'
    );
  }

  // Sovereign Tower
  assert(
    classifyOpportunityIntent_('sovereign tower guide', sovereign) === OPPORTUNITY_INTENT.GUIDE,
    'sovereign tower guide → GUIDE'
  );
  assert(
    classifyOpportunityIntent_('sovereign tower download', sovereign) ===
      OPPORTUNITY_INTENT.DOWNLOAD,
    'sovereign tower download → DOWNLOAD'
  );

  // Empty site behavior (pure): no rows → no opportunities
  var emptyLatest = findLatestQueryPageDataDate_([]);
  assert(emptyLatest === '', 'empty site latest DataDate should be empty');

  // Hub vs guide path
  assert(isOpportunityHubPath_('/', approx) === true, '/ is hub');
  assert(isOpportunityHubPath_('/approximately-up/', approx) === true, 'game slug is hub');
  assert(isOpportunityHubPath_('/mortal-shell-ii/', mortal) === true, 'mortal hub slug is hub');
  assert(
    isOpportunityHubPath_('/mortal-shell-ii/beta-progress-carry-over/', mortal) === false,
    'deep guide path is not hub'
  );
  assert(
    isOpportunityHubPath_('/beta-progress-carry-over/', mortal) === false,
    'flat guide path is not hub'
  );
  assert(isOpportunityHubPath_('/platforms/', approx) === false, '/platforms/ is not hub');
  assert(isOpportunityHubPath_('/first-mission/', approx) === false, '/first-mission/ is not hub');

  // Flat guide URL + specific query → expand existing
  var flatRewardsAction = classifyOpportunityAction_(
    mortal,
    {
      query: 'mortal shell 2 beta rewards',
      pagePath: '/beta-progress-carry-over/',
      clicks: 0,
      impressions: 9,
      position: 8.6
    },
    OPPORTUNITY_INTENT.REWARD,
    OPPORTUNITY_SPECIFICITY.SPECIFIC_INTENT,
    OPPORTUNITY_LEVELS.HIGH
  );
  assert(
    flatRewardsAction === OPPORTUNITY_ACTIONS.RESEARCH_EXPAND_EXISTING,
    'flat beta rewards → RESEARCH_EXPAND_EXISTING'
  );

  // PagePath must be pathname, not full URL
  assert(
    resolveOpportunityPagePath_('https://approximately-up.vercel.app/', '') === '/',
    'homepage URL → /'
  );
  assert(
    resolveOpportunityPagePath_(
      'https://approximately-up.vercel.app/approximately-up/console/',
      'https://approximately-up.vercel.app/approximately-up/console/'
    ) === '/approximately-up/console/',
    'console URL → pathname'
  );

  var leafy = {
    name: 'Leafy Corner',
    propertyUrl: 'https://leafy-corner.vercel.app/'
  };
  var homeNewCases = [
    [approx, 'approximately up mobile', OPPORTUNITY_INTENT.PLATFORM],
    [approx, 'approximately up gameplay', OPPORTUNITY_INTENT.GAMEPLAY],
    [leafy, 'leafy corner ps5', OPPORTUNITY_INTENT.PLATFORM]
  ];
  for (var h = 0; h < homeNewCases.length; h++) {
    var siteH = homeNewCases[h][0];
    var queryH = homeNewCases[h][1];
    var intentH = homeNewCases[h][2];
    var actionH = classifyOpportunityAction_(
      siteH,
      {
        query: queryH,
        pageUrl: siteH.propertyUrl,
        pagePath: siteH.propertyUrl,
        clicks: 0,
        impressions: 5,
        position: 10
      },
      intentH,
      OPPORTUNITY_SPECIFICITY.SPECIFIC_INTENT,
      OPPORTUNITY_LEVELS.HIGH
    );
    assert(
      actionH === OPPORTUNITY_ACTIONS.RESEARCH_NEW_CONTENT,
      queryH + ' + homepage → RESEARCH_NEW_CONTENT'
    );
  }

  assert(
    classifyOpportunityAction_(
      mortal,
      {
        query: 'mortal shell 2 beta rewards',
        pageUrl: 'https://mortal-shell-ii.vercel.app/mortal-shell-ii/beta-progress-carry-over/',
        pagePath: 'https://mortal-shell-ii.vercel.app/mortal-shell-ii/beta-progress-carry-over/',
        clicks: 0,
        impressions: 9,
        position: 8.6
      },
      OPPORTUNITY_INTENT.REWARD,
      OPPORTUNITY_SPECIFICITY.SPECIFIC_INTENT,
      OPPORTUNITY_LEVELS.HIGH
    ) === OPPORTUNITY_ACTIONS.RESEARCH_EXPAND_EXISTING,
    'beta + nested guide (full URL path cell) → EXPAND'
  );

  // HIGH tightened: no SeenDays-only boost
  assert(
    classifyOpportunityLevel_(
      { clicks: 0, impressions: 9, position: 8.6 },
      OPPORTUNITY_SPECIFICITY.SPECIFIC_INTENT,
      { seenDays: 1 }
    ) === OPPORTUNITY_LEVELS.HIGH,
    '9 imp / 8.6 → HIGH'
  );
  assert(
    classifyOpportunityLevel_(
      { clicks: 0, impressions: 5, position: 6.4 },
      OPPORTUNITY_SPECIFICITY.SPECIFIC_INTENT,
      { seenDays: 1 }
    ) === OPPORTUNITY_LEVELS.HIGH,
    '5 imp / 6.4 → HIGH'
  );
  assert(
    classifyOpportunityLevel_(
      { clicks: 0, impressions: 1, position: 11 },
      OPPORTUNITY_SPECIFICITY.SPECIFIC_INTENT,
      { seenDays: 3 }
    ) === OPPORTUNITY_LEVELS.MEDIUM,
    '1 imp / 11 even SeenDays=3 → MEDIUM'
  );
  assert(
    classifyOpportunityLevel_(
      { clicks: 0, impressions: 1, position: 29 },
      OPPORTUNITY_SPECIFICITY.SPECIFIC_INTENT,
      { seenDays: 2 }
    ) === OPPORTUNITY_LEVELS.MEDIUM,
    '1 imp / 29 → MEDIUM'
  );

  // Normalization
  assert(
    normalizeOpportunityQuery_('  Foo   BAR ') === 'foo bar',
    'normalize trim/lower/spaces'
  );

  var msg;
  if (fails.length) {
    msg = 'FAIL (' + fails.length + '):\n' + fails.join('\n');
  } else {
    msg = 'PASS: Opportunity Engine M0 self-check';
  }
  Logger.log(msg);
  return msg;
}
