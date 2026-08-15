/**
 * Post-launch Decision Engine
 * 只读现有 GSC Sheet 数据，计算站点状态并生成「今日行动」。
 * 不请求 GSC API，不修改 GSC 历史表。
 */

/**
 * 独立入口：可在采集完成后调用，也可单独重复运行。
 */
function runDecisionEngine() {
  ensureDecisionSheets_();
  var runDate = todayStr_();
  writeLog_('INFO', '', 'runDecisionEngine 开始 runDate=' + runDate);

  var rules = getDecisionRules_();
  var sites = getEnabledSites();
  if (!sites.length) {
    replaceSheetDataRows_(SHEET_NAMES.SITE_STATUS, SITE_STATUS_HEADERS, []);
    writeLog_('INFO', '', 'runDecisionEngine 结束：无启用站点');
    return;
  }

  var dailyBySite = loadDailyRowsBySite_();
  var queryBySite = loadQueryRowsBySite_();
  var queryPageBySite = loadQueryPageRowsBySite_();
  var snapshotBySite = loadLatestSnapshotBySite_();
  var actionHistory = loadTodayActionHistory_();
  var contentUpdateRows = loadContentUpdateRows_();

  var statusRows = [];
  var actionRows = [];
  var historyRows = [];
  var summaries = [];

  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    var metrics = buildSiteMetrics_(
      site,
      runDate,
      rules,
      dailyBySite[site.name] || [],
      queryBySite[site.name] || [],
      queryPageBySite[site.name] || [],
      snapshotBySite[site.name] || null
    );
    var scores = computeDomainScores_(metrics, rules);
    var decision = decideRecommendedAction_(metrics, scores, rules);
    var reason = appendDataThrough_(
      buildDecisionReason_(metrics, scores, decision, rules),
      metrics.decisionDataDate
    );
    var cooldown = findActionCooldown_(
      actionHistory,
      site.name,
      decision.action,
      runDate,
      rules
    );
    if (cooldown) {
      reason = reason + '；' + formatActionCooldownReason_(decision.action, cooldown);
    }

    var contentCooldown = null;
    if (decision.action === 'CONTENT_OPTIMIZE') {
      contentCooldown = findContentUpdateCooldownFromRows_(
        contentUpdateRows,
        site.name,
        '',
        runDate,
        rules
      );
      if (contentCooldown) {
        reason =
          reason + '；' + formatContentUpdateCooldownReason_(contentCooldown);
        decision = {
          action: 'WAIT',
          stage: decision.stage,
          priority: 'P3',
          fastTrack: !!decision.fastTrack
        };
      }
    }

    statusRows.push(siteStatusRow_(runDate, site.name, metrics, scores, decision, reason));

    if (shouldWriteTodayAction_(decision.action, cooldown)) {
      var decisionId = buildDecisionId_(
        runDate,
        site.name,
        decision.action,
        DECISION_RULE_VERSION
      );
      actionRows.push({
        date: runDate,
        priority: decision.priority,
        site: site.name,
        lifecycleStage: decision.stage,
        recommendedAction: decision.action,
        domainScore: scores.domainScore,
        reason: reason,
        status: 'TODO',
        note: '',
        decisionId: decisionId
      });
      var baseline = buildDecisionBaseline7D_({
        decisionDataDate: metrics.decisionDataDate,
        dailyRows: dailyBySite[site.name] || [],
        queryRows: queryBySite[site.name] || [],
        site: site,
        siteName: site.name
      });
      historyRows.push(
        buildDecisionHistoryRow_(
          runDate,
          site.name,
          metrics,
          scores,
          decision,
          reason,
          DECISION_RULE_VERSION,
          nowRecordedAt_(),
          decisionId,
          baseline
        )
      );
    }

    summaries.push(site.name + '→' + decision.action + '(' + decision.priority + ')');
  }

  replaceSheetDataRows_(SHEET_NAMES.SITE_STATUS, SITE_STATUS_HEADERS, statusRows);
  refreshTodayActions_(runDate, actionRows);
  appendDecisionHistoryRows_(historyRows);
  applyTodayActionValidation_();

  writeLog_('INFO', '', 'runDecisionEngine 结束 ' + summaries.join(' | '));
}

function ensureDecisionSheets_() {
  ensureSheet_(SHEET_NAMES.RULES, RULE_HEADERS);
  seedMissingDecisionRules_();
  ensureSheet_(SHEET_NAMES.SITE_STATUS, SITE_STATUS_HEADERS);
  ensureSiteStatusHeader_();
  ensureSheet_(SHEET_NAMES.TODAY_ACTIONS, TODAY_ACTION_HEADERS);
  ensureTodayActionHeader_();
  ensureSheet_(SHEET_NAMES.CONTENT_UPDATES, CONTENT_UPDATE_HEADERS);
  ensureContentUpdateHeader_();
  ensureSheet_(SHEET_NAMES.DECISION_HISTORY, DECISION_HISTORY_HEADERS);
  ensureDecisionHistoryHeader_();
  applyTodayActionValidation_();
}

/** 已有「决策历史」时补齐 Baseline 等表头，不碰已有 Snapshot 数据行。 */
function ensureDecisionHistoryHeader_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DECISION_HISTORY);
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), DECISION_HISTORY_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var actual = [];
  for (var i = 0; i < DECISION_HISTORY_HEADERS.length; i++) {
    actual.push(String(header[i] || '').trim());
  }
  if (actual.join('|') === DECISION_HISTORY_HEADERS.join('|')) return;
  sheet.getRange(1, 1, 1, DECISION_HISTORY_HEADERS.length).setValues([DECISION_HISTORY_HEADERS]);
  sheet.getRange(1, 1, 1, DECISION_HISTORY_HEADERS.length).setFontWeight('bold');
}

/** 已有「今日行动」时补齐 DecisionID 表头，不碰旧行业务值。 */
function ensureTodayActionHeader_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.TODAY_ACTIONS);
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), TODAY_ACTION_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var actual = [];
  for (var i = 0; i < TODAY_ACTION_HEADERS.length; i++) {
    actual.push(String(header[i] || '').trim());
  }
  if (actual.join('|') === TODAY_ACTION_HEADERS.join('|')) return;
  sheet.getRange(1, 1, 1, TODAY_ACTION_HEADERS.length).setValues([TODAY_ACTION_HEADERS]);
  sheet.getRange(1, 1, 1, TODAY_ACTION_HEADERS.length).setFontWeight('bold');
}

/** 已有「站点状态」时补齐 DecisionDataDate 表头，不碰 GSC 历史表。 */
function ensureSiteStatusHeader_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.SITE_STATUS);
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), SITE_STATUS_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var actual = [];
  for (var i = 0; i < SITE_STATUS_HEADERS.length; i++) {
    actual.push(String(header[i] || '').trim());
  }
  if (actual.join('|') === SITE_STATUS_HEADERS.join('|')) return;
  sheet.getRange(1, 1, 1, SITE_STATUS_HEADERS.length).setValues([SITE_STATUS_HEADERS]);
  sheet.getRange(1, 1, 1, SITE_STATUS_HEADERS.length).setFontWeight('bold');
}

function seedMissingDecisionRules_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RULES);
  if (!sheet) return;

  var existing = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, RULE_HEADERS.length).getValues();
    for (var i = 0; i < values.length; i++) {
      var key = String(values[i][0] || '').trim();
      if (key) existing[key] = true;
    }
  }

  var toAdd = [];
  for (var j = 0; j < DEFAULT_DECISION_RULES.length; j++) {
    var rule = DEFAULT_DECISION_RULES[j];
    if (!existing[rule[0]]) toAdd.push(rule.slice());
  }
  if (!toAdd.length) return;
  sheet.getRange(lastRow + 1, 1, toAdd.length, RULE_HEADERS.length).setValues(toAdd);
}

/**
 * 优先读「规则配置」当前值；无效时回退默认值并打 WARN。
 */
function getDecisionRules_() {
  ensureDecisionSheets_();
  var defaults = {};
  for (var i = 0; i < DEFAULT_DECISION_RULES.length; i++) {
    defaults[DEFAULT_DECISION_RULES[i][0]] = Number(DEFAULT_DECISION_RULES[i][1]);
  }

  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RULES);
  var current = {};
  if (sheet && sheet.getLastRow() >= 2) {
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, RULE_HEADERS.length).getValues();
    for (var r = 0; r < values.length; r++) {
      var key = String(values[r][0] || '').trim();
      if (!key) continue;
      current[key] = values[r][1];
    }
  }

  var rules = {};
  var keys = Object.keys(defaults);
  for (var k = 0; k < keys.length; k++) {
    var name = keys[k];
    rules[name] = coerceRuleNumber_(name, current[name], defaults[name]);
  }
  return rules;
}

function coerceRuleNumber_(key, raw, fallback) {
  if (raw === '' || raw === null || raw === undefined) return fallback;
  var n = Number(raw);
  if (isNaN(n)) {
    writeLog_('WARN', '', '规则 ' + key + ' 无效（' + raw + '），使用默认值 ' + fallback);
    return fallback;
  }
  return n;
}

function loadDailyRowsBySite_() {
  return groupSheetRowsBySite_(SHEET_NAMES.DAILY, DAILY_HEADERS, 1);
}

function loadQueryRowsBySite_() {
  return groupSheetRowsBySite_(SHEET_NAMES.QUERIES, QUERY_HEADERS, 1);
}

function loadQueryPageRowsBySite_() {
  return groupSheetRowsBySite_(SHEET_NAMES.QUERY_PAGES, QUERY_PAGE_HEADERS, 1);
}

function groupSheetRowsBySite_(sheetName, headers, siteCol) {
  var map = {};
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return map;

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var site = String(values[i][siteCol] || '').trim();
    if (!site) continue;
    if (!map[site]) map[site] = [];
    map[site].push(values[i]);
  }
  return map;
}

function loadLatestSnapshotBySite_() {
  var map = {};
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.SNAPSHOT);
  if (!sheet || sheet.getLastRow() < 2) return map;

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, SNAPSHOT_HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var site = String(values[i][2] || '').trim();
    if (!site) continue;
    var runDate = normalizeKeyDate_(values[i][0]);
    var prev = map[site];
    if (!prev || runDate > prev.runDate) {
      map[site] = { runDate: runDate, row: values[i] };
    }
  }

  var out = {};
  var sites = Object.keys(map);
  for (var s = 0; s < sites.length; s++) {
    out[sites[s]] = map[sites[s]].row;
  }
  return out;
}

/**
 * 统一截止日期：两边都有记录时取较早的 latest。
 * 任一数据源完全缺失时返回空，避免混用不同时间截面。
 */
function resolveDecisionDataDate_(dailyRows, queryRows) {
  var latestDaily = latestDateInRows_(dailyRows, 0);
  var latestQuery = latestDateInRows_(queryRows, 0);
  if (!latestDaily || !latestQuery) return '';
  return latestDaily < latestQuery ? latestDaily : latestQuery;
}

function computeAlignedMetrics_(dailyRows, queryRows, queryPageRows, site, decisionDataDate) {
  var empty = {
    impressions24h: 0,
    impressions7d: 0,
    previous3d: 0,
    latest3d: 0,
    growth3d: 0,
    hasGrowth: false,
    clicks7d: 0,
    queryCount7d: 0,
    guideQueryCount7d: 0,
    top50QueryCount: 0,
    top30QueryCount: 0,
    top20QueryCount: 0,
    intentCategoryCount: 0,
    canExpandContent: false,
    dailyDateCount7d: 0
  };
  if (!decisionDataDate) return empty;

  var windowStart = addDaysStr_(decisionDataDate, -6);
  var latest3Start = addDaysStr_(decisionDataDate, -2);
  var previous3End = addDaysStr_(decisionDataDate, -3);
  var previous3Start = addDaysStr_(decisionDataDate, -5);

  var impressions24h = 0;
  var impressions7d = 0;
  var latest3d = 0;
  var previous3d = 0;
  var clicks7d = 0;
  var dailyDates7d = {};

  for (var i = 0; i < dailyRows.length; i++) {
    var dataDate = normalizeKeyDate_(dailyRows[i][0]);
    if (!dataDate) continue;
    var impressions = Number(dailyRows[i][3] || 0);
    var clicks = Number(dailyRows[i][2] || 0);
    if (isNaN(impressions)) impressions = 0;
    if (isNaN(clicks)) clicks = 0;

    if (dataDate === decisionDataDate) impressions24h += impressions;
    if (dataDate >= windowStart && dataDate <= decisionDataDate) {
      impressions7d += impressions;
      clicks7d += clicks;
      dailyDates7d[dataDate] = true;
    }
    if (dataDate >= latest3Start && dataDate <= decisionDataDate) latest3d += impressions;
    if (previous3Start && previous3End && dataDate >= previous3Start && dataDate <= previous3End) {
      previous3d += impressions;
    }
  }

  var growth = safeGrowth_(latest3d, previous3d);
  var queryAgg = aggregateQueryMetrics_(queryRows, windowStart, decisionDataDate, site);
  var expand = evaluateContentExpand_(
    queryPageRows,
    windowStart,
    decisionDataDate,
    site,
    queryAgg.intentCategoryCount,
    queryAgg.guideQueryCount
  );

  return {
    impressions24h: impressions24h,
    impressions7d: impressions7d,
    previous3d: previous3d,
    latest3d: latest3d,
    growth3d: growth.value,
    hasGrowth: growth.ok,
    clicks7d: clicks7d,
    queryCount7d: queryAgg.queryCount,
    guideQueryCount7d: queryAgg.guideQueryCount,
    top50QueryCount: queryAgg.top50,
    top30QueryCount: queryAgg.top30,
    top20QueryCount: queryAgg.top20,
    intentCategoryCount: queryAgg.intentCategoryCount,
    canExpandContent: expand,
    dailyDateCount7d: Object.keys(dailyDates7d).length
  };
}

function buildSiteMetrics_(site, runDate, rules, dailyRows, queryRows, queryPageRows, snapshotRow) {
  var decisionDataDate = resolveDecisionDataDate_(dailyRows, queryRows);
  var aligned = computeAlignedMetrics_(
    dailyRows,
    queryRows,
    queryPageRows,
    site,
    decisionDataDate
  );

  var dayNum = calcDayNumber_(site.day0, decisionDataDate || runDate);
  if (snapshotRow && snapshotRow[4] !== '' && snapshotRow[4] !== null && snapshotRow[4] !== undefined) {
    var snapDay = Number(snapshotRow[4]);
    if (!isNaN(snapDay)) dayNum = snapDay;
  }

  var sitemapCount = snapshotRow ? Number(snapshotRow[5] || 0) : 0;
  if (isNaN(sitemapCount)) sitemapCount = 0;

  var indexedCount = '';
  try {
    var knownIndex = getLatestKnownIndexStats_(site.name);
    if (knownIndex) {
      indexedCount = knownIndex.indexedCount;
    } else if (snapshotRow && snapshotRow[6] !== '' && snapshotRow[6] !== null && snapshotRow[6] !== undefined) {
      var snapIndexed = Number(snapshotRow[6]);
      if (!isNaN(snapIndexed)) indexedCount = snapIndexed;
    }
  } catch (e) {
    if (snapshotRow && snapshotRow[6] !== '' && snapshotRow[6] !== null && snapshotRow[6] !== undefined) {
      var snapIndexed2 = Number(snapshotRow[6]);
      if (!isNaN(snapIndexed2)) indexedCount = snapIndexed2;
    }
  }

  var indexRate = '';
  if (indexedCount !== '' && sitemapCount > 0) {
    indexRate = percent_(indexedCount, sitemapCount);
  }

  return {
    decisionDataDate: decisionDataDate,
    day: dayNum,
    sitemapCount: sitemapCount,
    indexedCount: indexedCount,
    indexRate: indexRate,
    impressions24h: aligned.impressions24h,
    impressions7d: aligned.impressions7d,
    previous3d: aligned.previous3d,
    latest3d: aligned.latest3d,
    growth3d: aligned.growth3d,
    hasGrowth: aligned.hasGrowth,
    queryCount7d: aligned.queryCount7d,
    guideQueryCount7d: aligned.guideQueryCount7d,
    top50QueryCount: aligned.top50QueryCount,
    top30QueryCount: aligned.top30QueryCount,
    top20QueryCount: aligned.top20QueryCount,
    clicks7d: aligned.clicks7d,
    intentCategoryCount: aligned.intentCategoryCount,
    canExpandContent: aligned.canExpandContent,
    dailyDateCount7d: aligned.dailyDateCount7d
  };
}

function latestDateInRows_(rows, dateCol) {
  var latest = '';
  for (var i = 0; i < rows.length; i++) {
    var d = normalizeKeyDate_(rows[i][dateCol]);
    if (d && d > latest) latest = d;
  }
  return latest;
}

function aggregateQueryMetrics_(queryRows, startDate, endDate, site) {
  var byQuery = {};
  if (!startDate || !endDate) {
    return {
      queryCount: 0,
      guideQueryCount: 0,
      top50: 0,
      top30: 0,
      top20: 0,
      intentCategoryCount: 0
    };
  }
  for (var i = 0; i < queryRows.length; i++) {
    var dataDate = normalizeKeyDate_(queryRows[i][0]);
    if (!dataDate || dataDate < startDate || dataDate > endDate) continue;
    var q = String(queryRows[i][2] || '').trim();
    if (!q) continue;
    var position = Number(queryRows[i][6] || 0);
    if (isNaN(position)) position = 0;
    if (!byQuery[q]) {
      byQuery[q] = { bestPosition: position > 0 ? position : 0 };
    } else if (position > 0 && (byQuery[q].bestPosition === 0 || position < byQuery[q].bestPosition)) {
      byQuery[q].bestPosition = position;
    }
  }

  var names = Object.keys(byQuery);
  var guideCount = 0;
  var top50 = 0;
  var top30 = 0;
  var top20 = 0;
  var intentSet = {};

  for (var n = 0; n < names.length; n++) {
    var query = names[n];
    var pos = byQuery[query].bestPosition;
    if (pos > 0 && pos <= 50) top50++;
    if (pos > 0 && pos <= 30) top30++;
    if (pos > 0 && pos <= 20) top20++;

    var intents = matchGuideIntentCategories_(query, site);
    if (intents.length) {
      guideCount++;
      for (var t = 0; t < intents.length; t++) intentSet[intents[t]] = true;
    }
  }

  return {
    queryCount: names.length,
    guideQueryCount: guideCount,
    top50: top50,
    top30: top30,
    top20: top20,
    intentCategoryCount: Object.keys(intentSet).length
  };
}

function evaluateContentExpand_(queryPageRows, startDate, endDate, site, intentCategoryCount, guideQueryCount) {
  if (intentCategoryCount < 5 || guideQueryCount < 3) return false;
  if (!startDate || !endDate) return false;
  if (!queryPageRows || !queryPageRows.length) return false;

  var hasAny = false;
  var pageSet = {};
  for (var i = 0; i < queryPageRows.length; i++) {
    var dataDate = normalizeKeyDate_(queryPageRows[i][0]);
    if (!dataDate || dataDate < startDate || dataDate > endDate) continue;
    hasAny = true;
    var query = String(queryPageRows[i][2] || '').trim();
    if (!query) continue;
    if (!matchGuideIntentCategories_(query, site).length) continue;
    var pagePath = String(queryPageRows[i][4] || queryPageRows[i][3] || '').trim();
    if (pagePath) pageSet[pagePath] = true;
  }

  if (!hasAny) return false;
  var landingCount = Object.keys(pageSet).length;
  if (landingCount === 0) return false;
  return landingCount <= 2;
}

function computeDomainScores_(metrics, rules) {
  var traction = scoreTraction_(metrics.impressions7d, metrics.top50QueryCount, metrics.top30QueryCount, metrics.top20QueryCount);
  var queryScore = scoreQuery_(metrics.guideQueryCount7d);
  var momentum = scoreMomentum_(metrics.hasGrowth, metrics.growth3d);
  var expansion = scoreExpansion_(metrics.intentCategoryCount);
  var risk = scoreRisk_(metrics, rules);
  var domainScore = traction + queryScore + momentum + expansion + risk;
  return {
    tractionScore: traction,
    queryScore: queryScore,
    momentumScore: momentum,
    expansionScore: expansion,
    riskScore: risk,
    domainScore: domainScore
  };
}

function scoreTraction_(impressions7d, top50, top30, top20) {
  var base = 0;
  if (impressions7d >= 1000) base = 25;
  else if (impressions7d >= 300) base = 20;
  else if (impressions7d >= 100) base = 12;
  else if (impressions7d >= 30) base = 5;

  var bonus = 0;
  if (top20 > 0) bonus = 10;
  else if (top30 > 0) bonus = 6;
  else if (top50 > 0) bonus = 3;

  var total = base + bonus;
  return total > 35 ? 35 : total;
}

function scoreQuery_(guideCount) {
  if (guideCount >= 10) return 25;
  if (guideCount >= 5) return 17;
  if (guideCount >= 3) return 10;
  if (guideCount >= 1) return 5;
  return 0;
}

function scoreMomentum_(hasGrowth, growth3d) {
  if (!hasGrowth) return 0;
  if (growth3d > 2) return 15;
  if (growth3d >= 1.5) return 10;
  if (growth3d >= 1.2) return 6;
  if (growth3d >= 0.8) return 3;
  return 0;
}

function scoreExpansion_(intentCount) {
  if (intentCount >= 8) return 15;
  if (intentCount >= 5) return 10;
  if (intentCount >= 3) return 5;
  return 0;
}

function scoreRisk_(metrics, rules) {
  var score = 0;
  var indexedOk = metrics.indexedCount !== '' && metrics.indexedCount >= rules.DOMAIN_MIN_INDEXED_URLS;
  var rateOk = metrics.indexRate === '' || metrics.indexRate >= rules.INDEX_RATE_WARNING;
  if (indexedOk && rateOk) score += 2;
  if (metrics.clicks7d > 0) score += 2;
  if (metrics.top30QueryCount > 0) score += 2;
  if (metrics.guideQueryCount7d >= 5) score += 2;
  if (metrics.hasGrowth && metrics.growth3d > 1.2) score += 2;
  return score > 10 ? 10 : score;
}

/**
 * 决策顺序（先到先得）：
 * 1. CHECK_INDEX（未达到 ARCHIVE 条件时）
 * 2. Fast Track → DOMAIN_UPGRADE
 * 3. DOMAIN_UPGRADE
 * 4. DOMAIN_PREPARE
 * 5. ARCHIVE
 * 6. CONTENT_EXPAND（仅在页面覆盖可可靠判断时）
 * 7. CONTENT_OPTIMIZE（Content Action Gate）
 * 8. WAIT
 * 永不输出 PROMOTED（当前无正式域名识别）。
 */
function decideRecommendedAction_(metrics, scores, rules) {
  var dayNum = metrics.day === '' || metrics.day === null || metrics.day === undefined
    ? null
    : Number(metrics.day);
  if (dayNum !== null && isNaN(dayNum)) dayNum = null;

  var archiveReady = isArchiveCandidate_(dayNum, metrics, rules);
  if (shouldCheckIndex_(dayNum, metrics, rules) && !archiveReady) {
    return { action: 'CHECK_INDEX', stage: 'INDEX_CHECK', priority: 'P0', fastTrack: false };
  }

  if (
    metrics.impressions24h >= rules.FAST_TRACK_24H_IMPRESSIONS &&
    metrics.guideQueryCount7d >= rules.FAST_TRACK_GUIDE_QUERIES
  ) {
    return { action: 'DOMAIN_UPGRADE', stage: 'DOMAIN_READY', priority: 'P0', fastTrack: true };
  }

  var gate = countDomainGate_(metrics, rules) >= 2;
  var dayOk = dayNum === null || dayNum >= rules.DOMAIN_MIN_DAY;

  if (gate && dayOk && scores.domainScore >= rules.DOMAIN_SCORE_PROMOTE) {
    return { action: 'DOMAIN_UPGRADE', stage: 'DOMAIN_READY', priority: 'P0', fastTrack: false };
  }

  if (
    gate &&
    dayOk &&
    scores.domainScore >= rules.DOMAIN_SCORE_PREPARE &&
    scores.domainScore < rules.DOMAIN_SCORE_PROMOTE
  ) {
    return { action: 'DOMAIN_PREPARE', stage: 'DOMAIN_READY', priority: 'P1', fastTrack: false };
  }

  if (archiveReady) {
    return { action: 'ARCHIVE', stage: 'LOW_SIGNAL', priority: 'P3', fastTrack: false };
  }

  if (metrics.canExpandContent) {
    return { action: 'CONTENT_EXPAND', stage: 'TRACTION', priority: 'P1', fastTrack: false };
  }

  if (passesContentOptimizeGate_(metrics, rules)) {
    return { action: 'CONTENT_OPTIMIZE', stage: 'TRACTION', priority: 'P2', fastTrack: false };
  }

  var noSignal = metrics.impressions7d === 0 && metrics.queryCount7d === 0;
  var unindexed = metrics.indexedCount === '' || metrics.indexedCount === 0;
  return {
    action: 'WAIT',
    stage: unindexed && noSignal ? 'VERCEL_TEST' : 'TRACTION',
    priority: 'P3',
    fastTrack: false
  };
}

function passesContentOptimizeGate_(metrics, rules) {
  var minImp = rules.CONTENT_OPTIMIZE_MIN_7D_IMPRESSIONS;
  var minGuide = rules.CONTENT_OPTIMIZE_MIN_GUIDE_QUERIES;
  var minClicks = rules.CONTENT_OPTIMIZE_MIN_CLICKS;
  if (minImp === undefined) minImp = 30;
  if (minGuide === undefined) minGuide = 2;
  if (minClicks === undefined) minClicks = 1;
  if ((metrics.impressions7d || 0) < minImp) return false;
  if ((metrics.top50QueryCount || 0) <= 0) return false;
  var guideOk = (metrics.guideQueryCount7d || 0) >= minGuide;
  var clickOk = (metrics.clicks7d || 0) >= minClicks;
  return guideOk || clickOk;
}

function shouldCheckIndex_(dayNum, metrics, rules) {
  if (dayNum === null || dayNum < rules.INDEX_CHECK_DAY) return false;
  var indexUnknown = metrics.indexedCount === '' || metrics.indexedCount === null;
  if (indexUnknown) return true;
  if (metrics.indexedCount < rules.DOMAIN_MIN_INDEXED_URLS) return true;
  if (
    metrics.sitemapCount > 0 &&
    metrics.indexRate !== '' &&
    metrics.indexRate < rules.INDEX_RATE_WARNING
  ) {
    return true;
  }
  return false;
}

function isArchiveCandidate_(dayNum, metrics, rules) {
  if (dayNum === null || dayNum < rules.ARCHIVE_MIN_DAY) return false;
  if (metrics.impressions7d > rules.ARCHIVE_MAX_7D_IMPRESSIONS) return false;
  return metrics.guideQueryCount7d === 0;
}

function countDomainGate_(metrics, rules) {
  rules = rules || {};
  var minIndexed = rules.DOMAIN_MIN_INDEXED_URLS;
  var minImp = rules.DOMAIN_MIN_7D_IMPRESSIONS;
  var minGuide = rules.DOMAIN_MIN_GUIDE_QUERIES;
  if (minIndexed === undefined) minIndexed = 2;
  if (minImp === undefined) minImp = 30;
  if (minGuide === undefined) minGuide = 2;

  var n = 0;
  if (metrics.indexedCount !== '' && metrics.indexedCount >= minIndexed) n++;
  if (metrics.impressions7d >= minImp) n++;
  if (metrics.guideQueryCount7d >= minGuide) n++;
  if (metrics.top50QueryCount > 0) n++;
  return n;
}

function buildDecisionReason_(metrics, scores, decision, rules) {
  if (decision.fastTrack) {
    return (
      'Fast Track：24h impressions ' + metrics.impressions24h +
      '；Guide Queries ' + metrics.guideQueryCount7d +
      '；Domain Score ' + scores.domainScore
    );
  }

  if (decision.action === 'CHECK_INDEX') {
    var indexedLabel = metrics.indexedCount === '' ? '无历史' : String(metrics.indexedCount);
    var sitemapLabel = metrics.sitemapCount || 0;
    var rateLabel = metrics.indexRate === ''
      ? 'n/a'
      : Math.round(metrics.indexRate * 100) + '%';
    return (
      'Day ' + (metrics.day === '' || metrics.day === null ? '?' : metrics.day) +
      '；Indexed ' + indexedLabel + '/' + sitemapLabel +
      '；Index Rate ' + rateLabel +
      '，低于 ' + Math.round(rules.INDEX_RATE_WARNING * 100) + '%'
    );
  }

  if (decision.action === 'ARCHIVE') {
    return (
      'Day ' + metrics.day +
      '；7d impressions ' + metrics.impressions7d +
      '；Guide Queries 0；Domain Score ' + scores.domainScore
    );
  }

  var growthText = metrics.hasGrowth ? (formatGrowth_(metrics.growth3d) + 'x') : 'n/a（数据不足）';
  return (
    '7d impressions ' + metrics.impressions7d +
    '；3d growth ' + growthText +
    '；Guide Queries ' + metrics.guideQueryCount7d +
    '；Top20 Queries ' + metrics.top20QueryCount +
    '；Domain Score ' + scores.domainScore
  );
}

function appendDataThrough_(reason, decisionDataDate) {
  var tag = decisionDataDate ? ('Data through ' + decisionDataDate) : 'Data through n/a';
  if (!reason) return tag;
  return reason + '；' + tag;
}

function siteStatusRow_(runDate, siteName, metrics, scores, decision, reason) {
  return [
    runDate,
    siteName,
    metrics.decisionDataDate || '',
    metrics.day === '' || metrics.day === null ? '' : metrics.day,
    metrics.indexedCount === '' || metrics.indexedCount === null ? '' : metrics.indexedCount,
    metrics.indexRate === '' || metrics.indexRate === null ? '' : metrics.indexRate,
    metrics.impressions24h,
    metrics.impressions7d,
    metrics.previous3d,
    metrics.latest3d,
    metrics.hasGrowth ? metrics.growth3d : '',
    metrics.queryCount7d,
    metrics.guideQueryCount7d,
    metrics.top50QueryCount,
    metrics.top30QueryCount,
    metrics.top20QueryCount,
    metrics.clicks7d,
    scores.tractionScore,
    scores.queryScore,
    scores.momentumScore,
    scores.expansionScore,
    scores.riskScore,
    scores.domainScore,
    decision.stage,
    decision.action,
    decision.priority,
    reason
  ];
}

function loadTodayActionHistory_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.TODAY_ACTIONS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, TODAY_ACTION_HEADERS.length).getValues();
}

function shouldWriteTodayAction_(action, cooldown) {
  if (!action || TODAY_ACTION_EXCLUDED[action]) return false;
  if (cooldown) return false;
  return true;
}

/**
 * 稳定 DecisionID：同 RunDate + Site + RecommendedAction + RuleVersion 唯一。
 * 不含随机分量，重复运行可幂等去重。
 */
function buildDecisionId_(runDate, siteName, recommendedAction, ruleVersion) {
  return [
    String(runDate || '').trim(),
    String(siteName || '').trim(),
    String(recommendedAction || '').trim(),
    String(ruleVersion || '').trim()
  ].join('|');
}

function nowRecordedAt_() {
  return Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm:ss'
  );
}

/**
 * 用与当前 Recommendation 同一份 metrics / scores / decision / reason 冻结 Snapshot。
 * Baseline 与 Outcome 同口径，写入后冻结；重跑同 DecisionID 不覆盖。
 * @return {Array}
 */
function buildDecisionHistoryRow_(
  runDate,
  siteName,
  metrics,
  scores,
  decision,
  reason,
  ruleVersion,
  recordedAt,
  decisionId,
  baseline
) {
  ruleVersion = ruleVersion || DECISION_RULE_VERSION;
  var action = decision && decision.action ? decision.action : '';
  var id = String(decisionId || '').trim();
  if (!id) id = buildDecisionId_(runDate, siteName, action, ruleVersion);
  baseline = baseline || {};
  return [
    id,
    runDate,
    metrics.decisionDataDate || '',
    siteName,
    ruleVersion,
    metrics.day === '' || metrics.day === null || metrics.day === undefined ? '' : metrics.day,
    metrics.indexedCount === '' || metrics.indexedCount === null || metrics.indexedCount === undefined
      ? ''
      : metrics.indexedCount,
    metrics.indexRate === '' || metrics.indexRate === null || metrics.indexRate === undefined
      ? ''
      : metrics.indexRate,
    metrics.impressions24h,
    metrics.impressions7d,
    metrics.previous3d,
    metrics.latest3d,
    metrics.hasGrowth ? metrics.growth3d : '',
    metrics.queryCount7d,
    metrics.guideQueryCount7d,
    metrics.top50QueryCount,
    metrics.top30QueryCount,
    metrics.top20QueryCount,
    metrics.clicks7d,
    metrics.intentCategoryCount === undefined || metrics.intentCategoryCount === null
      ? 0
      : metrics.intentCategoryCount,
    scores.tractionScore,
    scores.queryScore,
    scores.momentumScore,
    scores.expansionScore,
    scores.riskScore,
    scores.domainScore,
    decision.stage,
    decision.action,
    decision.priority,
    reason,
    '',
    '',
    recordedAt || '',
    String(baseline.start || ''),
    String(baseline.end || ''),
    baseline.impressions === undefined || baseline.impressions === null ? 0 : baseline.impressions,
    baseline.clicks === undefined || baseline.clicks === null ? 0 : baseline.clicks,
    baseline.queryCount === undefined || baseline.queryCount === null ? 0 : baseline.queryCount,
    baseline.guideQueryCount === undefined || baseline.guideQueryCount === null
      ? 0
      : baseline.guideQueryCount,
    baseline.top50QueryCount === undefined || baseline.top50QueryCount === null
      ? 0
      : baseline.top50QueryCount,
    baseline.top20QueryCount === undefined || baseline.top20QueryCount === null
      ? 0
      : baseline.top20QueryCount,
    baseline.bestPosition === '' ||
    baseline.bestPosition === null ||
    baseline.bestPosition === undefined
      ? ''
      : baseline.bestPosition
  ];
}

/**
 * 纯函数：按 DecisionID 去重，只返回尚未存在的 Snapshot 行。
 * @param {Object} existingIdSet DecisionID -> true
 * @param {Array<Array>} candidateRows
 * @return {Array<Array>}
 */
function selectDecisionHistoryAppends_(existingIdSet, candidateRows) {
  var out = [];
  var seen = {};
  var keys = existingIdSet || {};
  var rows = candidateRows || [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row || !row.length) continue;
    var id = String(row[0] || '').trim();
    if (!id) continue;
    if (keys[id] || seen[id]) continue;
    seen[id] = true;
    out.push(row);
  }
  return out;
}

function loadDecisionHistoryIdSet_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DECISION_HISTORY);
  var set = {};
  if (!sheet || sheet.getLastRow() < 2) return set;
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i][0] || '').trim();
    if (id) set[id] = true;
  }
  return set;
}

/**
 * Append-only 写入决策历史；同 DecisionID 不重复。
 * 不改站点状态 / 今日行动主流程结果。
 */
function appendDecisionHistoryRows_(candidateRows) {
  if (!candidateRows || !candidateRows.length) return 0;
  ensureSheet_(SHEET_NAMES.DECISION_HISTORY, DECISION_HISTORY_HEADERS);
  ensureDecisionHistoryHeader_();
  var existing = loadDecisionHistoryIdSet_();
  var toAppend = selectDecisionHistoryAppends_(existing, candidateRows);
  if (!toAppend.length) return 0;
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DECISION_HISTORY);
  var start = sheet.getLastRow() + 1;
  sheet
    .getRange(start, 1, toAppend.length, DECISION_HISTORY_HEADERS.length)
    .setValues(toAppend);
  return toAppend.length;
}

/**
 * 同 Site + RecommendedAction 最近一次 DONE/SKIP 若距 RunDate 不足冷却天数，则压制今日行动。
 * TODO 不冷却。CHECK_INDEX / DOMAIN_UPGRADE / ARCHIVE 不冷却。
 */
function findActionCooldown_(history, site, action, runDate, rules) {
  if (!ACTION_COOLDOWN_ACTIONS[action]) return null;
  var cooldownDays = Number(rules && rules.ACTION_COOLDOWN_DAYS);
  if (isNaN(cooldownDays) || cooldownDays <= 0) cooldownDays = 3;

  var latest = '';
  var latestStatus = '';
  var rows = history || [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (String(row[2] || '').trim() !== site) continue;
    if (String(row[4] || '').trim() !== action) continue;
    var status = normalizeTodayStatus_(row[7]);
    if (status !== 'DONE' && status !== 'SKIP') continue;
    var date = normalizeKeyDate_(row[0]);
    if (!date) continue;
    if (!latest || date > latest) {
      latest = date;
      latestStatus = status;
    }
  }
  if (!latest) return null;

  var elapsed = daysBetweenStr_(latest, runDate);
  if (elapsed === null || elapsed < 0) return null;
  if (elapsed >= cooldownDays) return null;
  return {
    doneDate: latest,
    status: latestStatus,
    untilDate: addDaysStr_(latest, cooldownDays),
    days: cooldownDays
  };
}

function formatActionCooldownReason_(action, cooldown) {
  return (
    'Action cooldown: ' + action +
    ' was ' + cooldown.status +
    ' on ' + cooldown.doneDate +
    '; suppressed until ' + cooldown.untilDate
  );
}

function daysBetweenStr_(fromDate, toDate) {
  var a = parseDateOnly_(fromDate);
  var b = parseDateOnly_(toDate);
  if (!a || !b) return null;
  return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * 追加一条内容更新记录。页面路径为空 = 整站更新。
 * 更新时间默认今天（yyyy-MM-dd），不写具体小时。
 * 兼容入口：不绑 DecisionID；实际改站绑定请用 recordContentIntervention。
 * @param {string} site
 * @param {string=} pagePath
 * @param {string=} source
 * @param {string=} note
 * @return {{updateDate:string, site:string, pagePath:string, source:string, note:string, updateType:string, decisionId:string, warning:string}}
 */
function recordContentUpdate(site, pagePath, source, note) {
  return recordContentInterventionAt_(todayStr_(), site, pagePath, source, note, '', '');
}

/**
 * @param {string} updateDate yyyy-MM-dd
 * @param {string} site
 * @param {string=} pagePath
 * @param {string=} source
 * @param {string=} note
 * @return {{updateDate:string, site:string, pagePath:string, source:string, note:string, updateType:string, decisionId:string, warning:string}}
 */
function recordContentUpdateAt_(updateDate, site, pagePath, source, note) {
  return recordContentInterventionAt_(updateDate, site, pagePath, source, note, '', '');
}

/**
 * 查询某站点 / 页面最近一次内容更新。
 * 页面路径为空：只匹配整站更新记录（页面路径为空）。
 * 页面路径非空：整站更新或同规范化路径的页面更新均可命中。
 * @param {string} site
 * @param {string=} pagePath
 * @return {{updateDate:string, site:string, pagePath:string, source:string, note:string}|null}
 */
function getLatestContentUpdate(site, pagePath) {
  return getLatestContentUpdate_(site, pagePath, loadContentUpdateRows_());
}

/**
 * 查询 cooldown 是否仍有效（相对 asOfDate，默认今天）。
 * @param {string} site
 * @param {string=} pagePath
 * @param {string=} asOfDate
 * @param {Object=} rules
 * @return {{active:boolean, latest:Object|null, cooldown:Object|null}}
 */
function getContentUpdateCooldownStatus(site, pagePath, asOfDate, rules) {
  var when = normalizeKeyDate_(asOfDate) || todayStr_();
  var resolvedRules = rules || getDecisionRules_();
  var cooldown = findContentUpdateCooldown_(site, pagePath, when, resolvedRules);
  var latest = getLatestContentUpdate_(site, pagePath, loadContentUpdateRows_());
  return {
    active: !!cooldown,
    latest: latest,
    cooldown: cooldown
  };
}

function loadContentUpdateRows_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.CONTENT_UPDATES);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet
    .getRange(2, 1, sheet.getLastRow() - 1, CONTENT_UPDATE_HEADERS.length)
    .getValues();
}

function getLatestContentUpdate_(site, pagePath, rows) {
  var siteName = String(site || '').trim();
  if (!siteName) return null;
  var latest = null;
  var list = rows || [];
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    if (String(row[1] || '').trim() !== siteName) continue;
    if (!contentUpdateRecordMatches_(row[2], pagePath)) continue;
    var date = normalizeKeyDate_(row[0]);
    if (!date) continue;
    if (!latest || date > latest.updateDate) {
      latest = {
        updateDate: date,
        site: siteName,
        pagePath: String(row[2] || '').trim(),
        source: String(row[3] || '').trim(),
        note: String(row[4] || '').trim(),
        updateType: String(row[5] || '').trim(),
        decisionId: String(row[6] || '').trim()
      };
    }
  }
  return latest;
}

/**
 * 内容更新记录匹配：
 * - 记录页面路径为空 → 整站 cooldown，匹配任意查询路径
 * - 记录有页面路径 → 只匹配相同规范化路径
 */
function contentUpdateRecordMatches_(recordPagePath, queryPagePath) {
  var rec = String(recordPagePath || '').trim();
  if (!rec) return true;
  var query = String(queryPagePath || '').trim();
  if (!query) return false;
  return normalizeOpportunityPath_(rec) === normalizeOpportunityPath_(query);
}

/**
 * 同站点（及可选页面）最近内容更新若距 asOfDate 不足冷却天数，则返回冷却信息。
 * @return {{updateDate:string, untilDate:string, days:number, pagePath:string}|null}
 */
function findContentUpdateCooldown_(site, pagePath, asOfDate, rules) {
  var cooldownDays = Number(rules && rules.CONTENT_UPDATE_COOLDOWN_DAYS);
  if (isNaN(cooldownDays) || cooldownDays <= 0) cooldownDays = 3;

  var latest = getLatestContentUpdate_(site, pagePath, loadContentUpdateRows_());
  if (!latest) return null;

  var elapsed = daysBetweenStr_(latest.updateDate, asOfDate);
  if (elapsed === null || elapsed < 0) return null;
  if (elapsed >= cooldownDays) return null;
  return {
    updateDate: latest.updateDate,
    untilDate: addDaysStr_(latest.updateDate, cooldownDays),
    days: cooldownDays,
    pagePath: latest.pagePath
  };
}

/**
 * 纯逻辑版：供自测传入内存 rows，不读 Sheet。
 */
function findContentUpdateCooldownFromRows_(rows, site, pagePath, asOfDate, rules) {
  var cooldownDays = Number(rules && rules.CONTENT_UPDATE_COOLDOWN_DAYS);
  if (isNaN(cooldownDays) || cooldownDays <= 0) cooldownDays = 3;
  var latest = getLatestContentUpdate_(site, pagePath, rows);
  if (!latest) return null;
  var elapsed = daysBetweenStr_(latest.updateDate, asOfDate);
  if (elapsed === null || elapsed < 0) return null;
  if (elapsed >= cooldownDays) return null;
  return {
    updateDate: latest.updateDate,
    untilDate: addDaysStr_(latest.updateDate, cooldownDays),
    days: cooldownDays,
    pagePath: latest.pagePath
  };
}

function formatContentUpdateCooldownReason_(cooldown) {
  return (
    '该站于 ' +
    cooldown.updateDate +
    ' 完成内容更新，当前处于 ' +
    cooldown.days +
    ' 天观察期；原始建议为内容优化，先等待新 GSC 数据验证效果。'
  );
}

function refreshTodayActions_(runDate, actionRows) {
  var sheet = ensureSheet_(SHEET_NAMES.TODAY_ACTIONS, TODAY_ACTION_HEADERS);
  ensureTodayActionHeader_();
  var existing = [];
  if (sheet.getLastRow() >= 2) {
    existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, TODAY_ACTION_HEADERS.length).getValues();
  }
  var merged = mergeTodayActionRows_(runDate, existing, actionRows);
  replaceSheetDataRows_(SHEET_NAMES.TODAY_ACTIONS, TODAY_ACTION_HEADERS, merged);
}

/**
 * 刷新今日行动：保留历史行；同一 Date+Site+RecommendedAction 若已是 DONE/SKIP，
 * 不恢复成 TODO，并保留人工备注与 DecisionID。当天过期 TODO 会被新建议替换掉。
 */
function mergeTodayActionRows_(runDate, existing, actionRows) {
  var preserved = [];
  var protectedKeys = {};
  var todoNotes = {};

  for (var i = 0; i < existing.length; i++) {
    var row = padTodayActionRow_(existing[i]);
    var date = normalizeKeyDate_(row[0]);
    var site = String(row[2] || '').trim();
    var action = String(row[4] || '').trim();
    var status = normalizeTodayStatus_(row[7]);
    var note = row[8] === null || row[8] === undefined ? '' : String(row[8]);
    var key = todayActionKey_(date, site, action);

    if (date !== runDate) {
      preserved.push(row);
      continue;
    }
    if (status === 'DONE' || status === 'SKIP') {
      preserved.push(row);
      protectedKeys[key] = true;
      continue;
    }
    todoNotes[key] = note;
  }

  var incoming = (actionRows || []).slice().sort(compareTodayAction_);
  for (var a = 0; a < incoming.length; a++) {
    var item = incoming[a];
    if (TODAY_ACTION_EXCLUDED[item.recommendedAction]) continue;
    var itemKey = todayActionKey_(item.date, item.site, item.recommendedAction);
    if (protectedKeys[itemKey]) continue;
    preserved.push(
      padTodayActionRow_([
        item.date,
        item.priority,
        item.site,
        item.lifecycleStage,
        item.recommendedAction,
        item.domainScore,
        item.reason,
        'TODO',
        todoNotes[itemKey] || item.note || '',
        item.decisionId || ''
      ])
    );
  }

  preserved.sort(function (left, right) {
    var dateCmp = String(normalizeKeyDate_(right[0])).localeCompare(String(normalizeKeyDate_(left[0])));
    if (dateCmp !== 0) return dateCmp;
    var pCmp = todayPriorityRank_(left[1]) - todayPriorityRank_(right[1]);
    if (pCmp !== 0) return pCmp;
    return String(left[2] || '').localeCompare(String(right[2] || ''));
  });
  return preserved;
}

function padTodayActionRow_(row) {
  var out = [];
  var src = row || [];
  for (var i = 0; i < TODAY_ACTION_HEADERS.length; i++) {
    out.push(src[i] === undefined || src[i] === null ? '' : src[i]);
  }
  return out;
}

function todayActionKey_(date, site, action) {
  return normalizeKeyDate_(date) + '||' + String(site || '') + '||' + String(action || '');
}

function normalizeTodayStatus_(v) {
  return String(v || '').trim().toUpperCase();
}

function todayPriorityRank_(p) {
  var s = String(p || '').toUpperCase();
  if (s === 'P0') return 0;
  if (s === 'P1') return 1;
  if (s === 'P2') return 2;
  if (s === 'P3') return 3;
  return 9;
}

function compareTodayAction_(a, b) {
  var p = todayPriorityRank_(a.priority) - todayPriorityRank_(b.priority);
  if (p !== 0) return p;
  return String(a.site || '').localeCompare(String(b.site || ''));
}

function applyTodayActionValidation_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.TODAY_ACTIONS);
  if (!sheet) return;
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(TODAY_ACTION_STATUSES, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange('H2:H').setDataValidation(rule);
}

function replaceSheetDataRows_(sheetName, headers, rows) {
  var sheet = ensureSheet_(sheetName, headers);
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), headers.length);
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }
  if (rows && rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function safeGrowth_(latest3d, previous3d) {
  if (!previous3d || previous3d <= 0) {
    return { ok: false, value: 0 };
  }
  return { ok: true, value: latest3d / previous3d };
}

function formatGrowth_(n) {
  if (n === '' || n === null || n === undefined || isNaN(n)) return 'n/a';
  return String(Math.round(n * 100) / 100);
}

function addDaysStr_(dateStr, delta) {
  var d = parseDateOnly_(dateStr);
  if (!d) return '';
  d.setDate(d.getDate() + delta);
  return formatDate_(d);
}

/**
 * 纯品牌词（无攻略意图）不计入 Guide Query。
 * 品牌词 + guide/wiki 等意图仍计为 Guide Query。
 */
function matchGuideIntentCategories_(query, site) {
  var q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  if (isPureBrandQuery_(q, site)) return [];

  var matched = [];
  for (var i = 0; i < GUIDE_INTENT_CATEGORIES.length; i++) {
    var cat = GUIDE_INTENT_CATEGORIES[i];
    if (queryHasIntentTerms_(q, cat.terms)) matched.push(cat.key);
  }
  return matched;
}

function queryHasIntentTerms_(queryLower, terms) {
  for (var i = 0; i < terms.length; i++) {
    var term = String(terms[i] || '').toLowerCase();
    if (!term) continue;
    if (term.indexOf(' ') >= 0) {
      if (queryLower.indexOf(term) >= 0) return true;
    } else if (intentWordRe_(term).test(queryLower)) {
      return true;
    }
  }
  return false;
}

function intentWordRe_(term) {
  return new RegExp('(?:^|[^a-z0-9])' + escapeRe_(term) + '(?:$|[^a-z0-9])', 'i');
}

function escapeRe_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPureBrandQuery_(queryLower, site) {
  var tokens = tokenizeBrand_(queryLower);
  if (!tokens.length) return false;
  var brand = getBrandTokenSet_(site);
  if (!Object.keys(brand).length) return false;

  for (var i = 0; i < tokens.length; i++) {
    if (!brand[tokens[i]]) return false;
  }
  return true;
}

function getBrandTokenSet_(site) {
  var set = {};
  var chunks = [];
  if (site && site.name) chunks.push(site.name);
  if (site && site.propertyUrl) {
    try {
      var host = new URL(site.propertyUrl).hostname || '';
      chunks.push(host.split('.')[0] || '');
    } catch (e) {
      // ignore malformed url
    }
  }
  for (var i = 0; i < chunks.length; i++) {
    var toks = tokenizeBrand_(chunks[i]);
    for (var t = 0; t < toks.length; t++) set[toks[t]] = true;
  }
  return set;
}

function tokenizeBrand_(text) {
  var raw = String(text || '').toLowerCase().split(/[^a-z0-9]+/);
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var tok = raw[i];
    if (!tok || tok.length < 2) continue;
    if (BRAND_TOKEN_STOPWORDS[tok]) continue;
    if (/^\d+$/.test(tok)) continue;
    out.push(tok);
  }
  return out;
}

/**
 * 不写 Sheet 的纯逻辑自检。可在 Apps Script 中单独运行。
 */
function debugDecisionEngineSelfCheck() {
  var fails = [];
  function assert(cond, msg) {
    if (!cond) fails.push(msg);
  }

  var g0 = safeGrowth_(10, 0);
  assert(g0.ok === false && g0.value === 0, 'Growth 分母 0 应标记数据不足');
  var g1 = safeGrowth_(18, 10);
  assert(g1.ok === true && g1.value === 1.8, 'Growth 18/10 应为 1.8');

  assert(scoreTraction_(0, 0, 0, 0) === 0, '0 impression Traction 应为 0');
  assert(scoreTraction_(326, 1, 1, 2) === 30, '326 imp + Top20 应为 30');
  assert(scoreTraction_(50, 1, 0, 0) === 8, '50 imp + Top50 应为 8');
  assert(scoreQuery_(0) === 0, '0 Guide Query 应为 0');
  assert(scoreQuery_(7) === 17, '7 Guide Query 应为 17');
  assert(scoreMomentum_(false, 9) === 0, '数据不足 Momentum 应为 0，不处罚');
  assert(scoreMomentum_(true, 1.82) === 10, 'growth 1.82 Momentum 应为 10');
  assert(scoreExpansion_(2) === 0 && scoreExpansion_(5) === 10, 'Expansion 档位');

  var site = { name: 'Leafy Corner', propertyUrl: 'https://leafy-corner.vercel.app/' };
  assert(matchGuideIntentCategories_('leafy corner', site).length === 0, '纯品牌词不是 Guide Query');
  assert(matchGuideIntentCategories_('leafy corner walkthrough', site).indexOf('guide') >= 0, '品牌+walkthrough 是 Guide Query');
  assert(matchGuideIntentCategories_('best weapon build', site).indexOf('weapon') >= 0, 'best weapon build 应命中 weapon');

  var windowSite = { name: 'Grain Rot', propertyUrl: 'https://grainrot.vercel.app/' };
  var queryWindow = aggregateQueryMetrics_(
    [
      ['2026-08-12', 'Grain Rot', 'grain rot wiki', 0, 10, 0, 12],
      ['2026-08-06', 'Grain Rot', 'grain rot walkthrough', 0, 8, 0, 18],
      ['2026-07-20', 'Grain Rot', 'grain rot boss', 0, 99, 0, 5]
    ],
    '2026-08-06',
    '2026-08-12',
    windowSite
  );
  assert(queryWindow.queryCount === 2, 'Query 7D 只统计窗口内日期，不含全部历史');
  assert(queryWindow.guideQueryCount === 2, '窗口内 Guide Query 应为 2');
  assert(queryWindow.top20 === 2 && queryWindow.top50 === 2, '窗口内排名只看窗口内 Query');
  var emptyWindow = aggregateQueryMetrics_(
    [['2026-07-20', 'Grain Rot', 'grain rot boss', 0, 99, 0, 5]],
    '',
    '',
    windowSite
  );
  assert(emptyWindow.queryCount === 0, '无 GSC 数据日时 Query 窗口应为空，不能扫全表');

  var rules = {};
  for (var i = 0; i < DEFAULT_DECISION_RULES.length; i++) {
    rules[DEFAULT_DECISION_RULES[i][0]] = Number(DEFAULT_DECISION_RULES[i][1]);
  }

  var grainSite = { name: 'Grain Rot', propertyUrl: 'https://grainrot.vercel.app/' };
  var caseADaily = [
    ['2026-08-11', 'Grain Rot', 0, 12, 0, 10, 2, '', '']
  ];
  var caseAQueries = [
    ['2026-08-11', 'Grain Rot', 'grain rot wiki', 0, 4, 0, 12],
    ['2026-08-12', 'Grain Rot', 'grain rot walkthrough', 0, 8, 0, 9],
    ['2026-08-13', 'Grain Rot', 'grain rot boss', 0, 6, 0, 7]
  ];
  var caseADate = resolveDecisionDataDate_(caseADaily, caseAQueries);
  var caseA = computeAlignedMetrics_(caseADaily, caseAQueries, [], grainSite, caseADate);
  assert(caseADate === '2026-08-11', 'Case A DecisionDataDate 应为 2026-08-11');
  assert(caseA.queryCount7d === 1, 'Case A 不得计入 8/12、8/13 Query');
  assert(caseA.top20QueryCount === 1, 'Case A Top20 只含截止日及之前');
  assert(caseA.impressions24h === 12 && caseA.impressions7d === 12, 'Case A Impression 截止 8/11');
  assert(appendDataThrough_('x', caseADate).indexOf('Data through 2026-08-11') >= 0, 'Case A Reason 应含 Data through 2026-08-11');

  var caseBDaily = [
    ['2026-08-11', 'Grain Rot', 0, 12, 0, 10, 2, '', ''],
    ['2026-08-13', 'Grain Rot', 1, 20, 0, 9, 3, '', '']
  ];
  var caseBQueries = [
    ['2026-08-11', 'Grain Rot', 'grain rot wiki', 0, 4, 0, 12],
    ['2026-08-13', 'Grain Rot', 'grain rot walkthrough', 0, 8, 0, 9]
  ];
  var caseBDate = resolveDecisionDataDate_(caseBDaily, caseBQueries);
  var caseB = computeAlignedMetrics_(caseBDaily, caseBQueries, [], grainSite, caseBDate);
  assert(caseBDate === '2026-08-13', 'Case B DecisionDataDate 应为 2026-08-13');
  assert(caseB.queryCount7d === 2, 'Case B Query 统计至 8/13');
  assert(caseB.impressions24h === 20 && caseB.impressions7d === 32, 'Case B Impression 统计至 8/13');
  assert(caseB.top20QueryCount === 2, 'Case B 两边 Query 都计入 Top20');

  var caseCDaily = [
    ['2026-08-11', 'New Site', 0, 5, 0, 20, 0, '', '']
  ];
  var caseCSite = { name: 'New Site', propertyUrl: 'https://example.vercel.app/' };
  var caseCDate = resolveDecisionDataDate_(caseCDaily, []);
  var caseC = computeAlignedMetrics_(caseCDaily, [], [], caseCSite, caseCDate);
  assert(caseCDate === '', 'Case C 缺 Query 数据时 DecisionDataDate 为空');
  assert(caseC.impressions7d === 0 && caseC.queryCount7d === 0, 'Case C 不得混用单边数据源');
  var caseCDecision = decideRecommendedAction_(
    {
      day: 2,
      indexedCount: '',
      indexRate: '',
      sitemapCount: 3,
      impressions24h: caseC.impressions24h,
      impressions7d: caseC.impressions7d,
      guideQueryCount7d: caseC.guideQueryCount7d,
      queryCount7d: caseC.queryCount7d,
      top50QueryCount: caseC.top50QueryCount,
      top30QueryCount: 0,
      top20QueryCount: caseC.top20QueryCount,
      clicks7d: caseC.clicks7d,
      hasGrowth: caseC.hasGrowth,
      growth3d: caseC.growth3d,
      canExpandContent: caseC.canExpandContent,
      intentCategoryCount: 0
    },
    computeDomainScores_({
      impressions7d: 0,
      top50QueryCount: 0,
      top30QueryCount: 0,
      top20QueryCount: 0,
      guideQueryCount7d: 0,
      hasGrowth: false,
      growth3d: 0,
      intentCategoryCount: 0,
      indexedCount: '',
      indexRate: '',
      clicks7d: 0
    }, rules),
    rules
  );
  assert(caseCDecision.action !== 'CONTENT_OPTIMIZE', 'Case C 不得虚假 CONTENT_OPTIMIZE');
  assert(caseCDecision.action === 'WAIT', 'Case C 新站缺 Query 应为 WAIT');
  var caseCReason = appendDataThrough_('7d impressions 0', caseCDate);
  assert(caseCReason.indexOf('Data through n/a') >= 0, 'Case C Reason 应标明 Data through n/a');

  var waitMetrics = {
    day: 2,
    indexedCount: '',
    indexRate: '',
    sitemapCount: 4,
    impressions24h: 0,
    impressions7d: 0,
    guideQueryCount7d: 0,
    queryCount7d: 0,
    top50QueryCount: 0,
    top30QueryCount: 0,
    top20QueryCount: 0,
    clicks7d: 0,
    hasGrowth: false,
    growth3d: 0,
    canExpandContent: false,
    intentCategoryCount: 0
  };
  var waitDecision = decideRecommendedAction_(waitMetrics, computeDomainScores_(waitMetrics, rules), rules);
  assert(waitDecision.action === 'WAIT', '新站 0 impression 应为 WAIT');
  assert(!!TODAY_ACTION_EXCLUDED[waitDecision.action], 'WAIT 不应进入今日行动');

  var indexMetrics = {
    day: 8,
    indexedCount: 1,
    indexRate: 1 / 6,
    sitemapCount: 6,
    impressions24h: 20,
    impressions7d: 40,
    guideQueryCount7d: 1,
    queryCount7d: 3,
    top50QueryCount: 1,
    top30QueryCount: 0,
    top20QueryCount: 0,
    clicks7d: 0,
    hasGrowth: true,
    growth3d: 1.1,
    canExpandContent: false,
    intentCategoryCount: 1
  };
  var indexDecision = decideRecommendedAction_(indexMetrics, computeDomainScores_(indexMetrics, rules), rules);
  assert(indexDecision.action === 'CHECK_INDEX', 'Day8 低索引率应为 CHECK_INDEX');

  var archiveMetrics = {
    day: 16,
    indexedCount: 0,
    indexRate: 0,
    sitemapCount: 6,
    impressions24h: 0,
    impressions7d: 4,
    guideQueryCount7d: 0,
    queryCount7d: 0,
    top50QueryCount: 0,
    top30QueryCount: 0,
    top20QueryCount: 0,
    clicks7d: 0,
    hasGrowth: false,
    growth3d: 0,
    canExpandContent: false,
    intentCategoryCount: 0
  };
  var archiveDecision = decideRecommendedAction_(archiveMetrics, computeDomainScores_(archiveMetrics, rules), rules);
  assert(archiveDecision.action === 'ARCHIVE', 'Day16 低信号应为 ARCHIVE');

  var fastMetrics = {
    day: 4,
    indexedCount: 3,
    indexRate: 0.8,
    sitemapCount: 4,
    impressions24h: 350,
    impressions7d: 900,
    guideQueryCount7d: 6,
    queryCount7d: 20,
    top50QueryCount: 4,
    top30QueryCount: 2,
    top20QueryCount: 1,
    clicks7d: 5,
    hasGrowth: true,
    growth3d: 1.9,
    canExpandContent: false,
    intentCategoryCount: 6
  };
  var fastDecision = decideRecommendedAction_(fastMetrics, computeDomainScores_(fastMetrics, rules), rules);
  assert(fastDecision.action === 'DOMAIN_UPGRADE' && fastDecision.fastTrack === true, 'Fast Track 应为 DOMAIN_UPGRADE');

  var noActionExcluded = !TODAY_ACTION_EXCLUDED.CONTENT_OPTIMIZE && TODAY_ACTION_EXCLUDED.NO_ACTION;
  assert(noActionExcluded, 'NO_ACTION 排除、CONTENT_OPTIMIZE 写入');

  function contentGateMetrics_(over) {
    var m = {
      day: 5,
      indexedCount: 3,
      indexRate: 0.8,
      sitemapCount: 4,
      impressions24h: 20,
      impressions7d: 0,
      guideQueryCount7d: 0,
      queryCount7d: 5,
      top50QueryCount: 1,
      top30QueryCount: 0,
      top20QueryCount: 11,
      clicks7d: 0,
      hasGrowth: false,
      growth3d: 0,
      canExpandContent: false,
      intentCategoryCount: 1
    };
    var keys = Object.keys(over || {});
    for (var k = 0; k < keys.length; k++) m[keys[k]] = over[keys[k]];
    return m;
  }

  var case1 = contentGateMetrics_({
    impressions7d: 232,
    guideQueryCount7d: 4,
    clicks7d: 2,
    top50QueryCount: 11,
    top20QueryCount: 11
  });
  assert(
    decideRecommendedAction_(case1, computeDomainScores_(case1, rules), rules).action === 'CONTENT_OPTIMIZE',
    'Case 1 Approximately Up 应为 CONTENT_OPTIMIZE'
  );

  var case2 = contentGateMetrics_({
    impressions7d: 31,
    guideQueryCount7d: 1,
    clicks7d: 0,
    top50QueryCount: 1,
    top20QueryCount: 0
  });
  assert(
    decideRecommendedAction_(case2, computeDomainScores_(case2, rules), rules).action === 'WAIT',
    'Case 2 Leafy Corner 应为 WAIT'
  );

  var case3 = contentGateMetrics_({
    impressions7d: 18,
    guideQueryCount7d: 3,
    clicks7d: 0,
    top50QueryCount: 1
  });
  assert(
    decideRecommendedAction_(case3, computeDomainScores_(case3, rules), rules).action === 'WAIT',
    'Case 3 Sovereign Tower 应为 WAIT'
  );

  var case4 = contentGateMetrics_({
    impressions7d: 2,
    guideQueryCount7d: 0,
    clicks7d: 0,
    top50QueryCount: 1
  });
  assert(
    decideRecommendedAction_(case4, computeDomainScores_(case4, rules), rules).action === 'WAIT',
    'Case 4 BeastLink 应为 WAIT'
  );

  var case5History = [
    ['2026-08-14', 'P2', 'Approximately Up', 'TRACTION', 'CONTENT_OPTIMIZE', 38, 'old', 'DONE', '']
  ];
  var case5Cooldown = findActionCooldown_(
    case5History,
    'Approximately Up',
    'CONTENT_OPTIMIZE',
    '2026-08-15',
    rules
  );
  assert(!!case5Cooldown, 'Case 5 应命中 cooldown');
  assert(
    decideRecommendedAction_(case1, computeDomainScores_(case1, rules), rules).action === 'CONTENT_OPTIMIZE',
    'Case 5 站点状态仍为 CONTENT_OPTIMIZE'
  );
  assert(
    shouldWriteTodayAction_('CONTENT_OPTIMIZE', case5Cooldown) === false,
    'Case 5 冷却期内不写入今日行动'
  );
  assert(
    formatActionCooldownReason_('CONTENT_OPTIMIZE', case5Cooldown).indexOf('2026-08-14') >= 0,
    'Case 5 Reason 应写明 DONE 日期'
  );

  var case6Cooldown = findActionCooldown_(
    [['2026-08-11', 'P2', 'Approximately Up', 'TRACTION', 'CONTENT_OPTIMIZE', 38, 'old', 'DONE', '']],
    'Approximately Up',
    'CONTENT_OPTIMIZE',
    '2026-08-15',
    rules
  );
  assert(!case6Cooldown, 'Case 6 冷却到期后应解除');
  assert(
    shouldWriteTodayAction_('CONTENT_OPTIMIZE', case6Cooldown) === true,
    'Case 6 应重新进入今日行动'
  );

  var case7Cooldown = findActionCooldown_(
    [['2026-08-14', 'P2', 'Approximately Up', 'TRACTION', 'CONTENT_OPTIMIZE', 38, 'old', 'DONE', '']],
    'Approximately Up',
    'DOMAIN_UPGRADE',
    '2026-08-15',
    rules
  );
  assert(!case7Cooldown, 'Case 7 CONTENT_OPTIMIZE cooldown 不得阻止 DOMAIN_UPGRADE');
  assert(
    shouldWriteTodayAction_('DOMAIN_UPGRADE', case7Cooldown) === true,
    'Case 7 DOMAIN_UPGRADE 应进入今日行动'
  );

  var skipCooldown = findActionCooldown_(
    [['2026-08-14', 'P2', 'Leafy Corner', 'TRACTION', 'CONTENT_OPTIMIZE', 20, 'skip', 'SKIP', '']],
    'Leafy Corner',
    'CONTENT_OPTIMIZE',
    '2026-08-15',
    rules
  );
  assert(!!skipCooldown && skipCooldown.status === 'SKIP', 'SKIP 也应进入短冷却');
  var todoCooldown = findActionCooldown_(
    [['2026-08-14', 'P2', 'Leafy Corner', 'TRACTION', 'CONTENT_OPTIMIZE', 20, 'todo', 'TODO', '']],
    'Leafy Corner',
    'CONTENT_OPTIMIZE',
    '2026-08-15',
    rules
  );
  assert(!todoCooldown, 'TODO 不产生 cooldown');

  // --- Content Update Cooldown ---
  var agefieldRows = [
    ['2026-08-14', 'Agefield High: Rock the School', '', '社媒研究', '根据最新社媒玩家信息完成内容更新']
  ];
  var agefieldRaw = decideRecommendedAction_(
    case1,
    computeDomainScores_(case1, rules),
    rules
  );
  assert(agefieldRaw.action === 'CONTENT_OPTIMIZE' && agefieldRaw.priority === 'P2', 'Agefield 原始应为 CONTENT_OPTIMIZE(P2)');
  var agefieldCd = findContentUpdateCooldownFromRows_(
    agefieldRows,
    'Agefield High: Rock the School',
    '',
    '2026-08-15',
    rules
  );
  assert(!!agefieldCd, 'Agefield 内容更新冷却应命中');
  var agefieldReason =
    'score reason' + '；' + formatContentUpdateCooldownReason_(agefieldCd);
  assert(agefieldReason.indexOf('观察期') >= 0, 'Agefield Reason 应含观察期');
  assert(agefieldReason.indexOf('2026-08-14') >= 0, 'Agefield Reason 应含更新日');
  assert(agefieldReason.indexOf('score reason') >= 0, 'Agefield 不得删除原评分 Reason');
  var agefieldFinal = {
    action: 'WAIT',
    stage: agefieldRaw.stage,
    priority: 'P3',
    fastTrack: !!agefieldRaw.fastTrack
  };
  assert(agefieldFinal.action === 'WAIT' && agefieldFinal.priority === 'P3', 'Agefield 最终应为 WAIT(P3)');
  assert(
    shouldWriteTodayAction_(agefieldFinal.action, null) === false,
    'Agefield WAIT 不进入今日行动'
  );

  var agefieldExpired = findContentUpdateCooldownFromRows_(
    agefieldRows,
    'Agefield High: Rock the School',
    '',
    '2026-08-17',
    rules
  );
  assert(!agefieldExpired, '冷却满 3 天后应解除，恢复原始 Decision Engine 判断');

  var ms2Rows = [
    ['2026-08-14', 'Mortal Shell II', '', '社媒研究', '根据最新社媒玩家信息完成内容更新']
  ];
  var ms2SiteCd = findContentUpdateCooldownFromRows_(
    ms2Rows,
    'Mortal Shell II',
    '/mortal-shell-ii/beta-progress-carry-over/',
    '2026-08-15',
    rules
  );
  assert(!!ms2SiteCd, '整站更新应对任意页面路径生效（Research Job 跳过）');
  var ms2PageOnly = findContentUpdateCooldownFromRows_(
    [['2026-08-14', 'Mortal Shell II', '/mortal-shell-ii/guides/weapons/', 'x', 'y']],
    'Mortal Shell II',
    '/mortal-shell-ii/beta-progress-carry-over/',
    '2026-08-15',
    rules
  );
  assert(!ms2PageOnly, '不同页面路径不得误伤');
  var ms2SiteQuery = findContentUpdateCooldownFromRows_(
    [['2026-08-14', 'Mortal Shell II', '/mortal-shell-ii/guides/weapons/', 'x', 'y']],
    'Mortal Shell II',
    '',
    '2026-08-15',
    rules
  );
  assert(!ms2SiteQuery, '页面级更新不得当作整站 Decision Engine 冷却');

  assert(
    contentUpdateRecordMatches_('', '/any/path') === true,
    '空页面路径记录 = 整站匹配'
  );
  assert(
    contentUpdateRecordMatches_('/a/', '/a') === true,
    '同规范化路径应匹配'
  );

  var runDate = '2026-08-14';
  var merged = mergeTodayActionRows_(
    runDate,
    [
      ['2026-08-13', 'P2', 'BeastLink', 'TRACTION', 'CONTENT_OPTIMIZE', 40, 'old', 'TODO', '昨天备注'],
      [runDate, 'P0', 'Grain Rot', 'DOMAIN_READY', 'DOMAIN_UPGRADE', 80, 'fast', 'DONE', '已买域'],
      [runDate, 'P2', 'Leafy Corner', 'TRACTION', 'CONTENT_OPTIMIZE', 41, 'old reason', 'TODO', '保留备注'],
      [runDate, 'P3', 'Approximately Up', 'LOW_SIGNAL', 'ARCHIVE', 5, 'dead', 'SKIP', '先观察']
    ],
    [
      { date: runDate, priority: 'P0', site: 'Grain Rot', lifecycleStage: 'DOMAIN_READY', recommendedAction: 'DOMAIN_UPGRADE', domainScore: 82, reason: 'Fast Track', status: 'TODO', note: '' },
      { date: runDate, priority: 'P2', site: 'Leafy Corner', lifecycleStage: 'TRACTION', recommendedAction: 'CONTENT_OPTIMIZE', domainScore: 44, reason: 'new reason', status: 'TODO', note: '' },
      { date: runDate, priority: 'P3', site: 'Wait Site', lifecycleStage: 'VERCEL_TEST', recommendedAction: 'WAIT', domainScore: 0, reason: 'waiting', status: 'TODO', note: '' }
    ]
  );
  var grain = merged.filter(function (r) { return r[2] === 'Grain Rot'; })[0];
  var leafy = merged.filter(function (r) { return r[2] === 'Leafy Corner'; })[0];
  var skipRow = merged.filter(function (r) { return r[2] === 'Approximately Up'; })[0];
  var waitRow = merged.filter(function (r) { return r[2] === 'Wait Site'; })[0];
  var yesterday = merged.filter(function (r) { return String(r[0]) === '2026-08-13'; })[0];
  assert(grain && grain[7] === 'DONE' && grain[8] === '已买域', 'DONE 与人工备注不可被刷新覆盖');
  assert(leafy && leafy[7] === 'TODO' && leafy[8] === '保留备注' && leafy[6] === 'new reason', 'TODO 可更新 Reason 但保留备注');
  assert(skipRow && skipRow[7] === 'SKIP', 'SKIP 不可恢复成 TODO');
  assert(!waitRow, 'WAIT 不进入今日行动');
  assert(yesterday && yesterday[8] === '昨天备注', '历史行动行应保留');

  if (fails.length) {
    var msg = 'FAIL debugDecisionEngineSelfCheck:\n' + fails.join('\n');
    Logger.log(msg);
    writeLog_('ERROR', '', msg);
    throw new Error(msg);
  }

  Logger.log('PASS debugDecisionEngineSelfCheck');
  writeLog_('INFO', '', 'PASS debugDecisionEngineSelfCheck');
}
