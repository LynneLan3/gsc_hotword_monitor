/**
 * M2-2 Decision Outcome Observation
 * 只读已有 GSC Sheet + 决策历史，在 D7/D14/D30 成熟后 append「决策结果」。
 * 不请求 GSC API，不修改 Decision Engine 规则 / DomainScore / 阈值。
 */

/**
 * 独立入口：人工菜单执行；本轮不接入 runDaily。
 */
function runDecisionOutcomeObservation() {
  ensureSheet_(SHEET_NAMES.DECISION_OUTCOMES, DECISION_OUTCOME_HEADERS);
  ensureSheet_(SHEET_NAMES.DECISION_HISTORY, DECISION_HISTORY_HEADERS);

  var decisions = loadDecisionHistoryRecords_();
  if (!decisions.length) {
    writeLog_('INFO', '', 'runDecisionOutcomeObservation：决策历史为空，跳过');
    return { pending: 0, appended: 0, skippedExisting: 0 };
  }

  var dailyBySite = loadDailyRowsBySite_();
  var queryBySite = loadQueryRowsBySite_();
  var existingKeys = loadDecisionOutcomeKeySet_();
  var siteObjs = {};
  var enabled = getEnabledSites();
  for (var i = 0; i < enabled.length; i++) {
    siteObjs[enabled[i].name] = enabled[i];
  }

  var latestBySite = {};
  var sites = Object.keys(dailyBySite);
  for (var s = 0; s < sites.length; s++) {
    latestBySite[sites[s]] = latestDateInRows_(dailyBySite[sites[s]], 0);
  }

  var plan = planDecisionOutcomeRows_({
    decisions: decisions,
    existingKeys: existingKeys,
    latestBySite: latestBySite,
    dailyBySite: dailyBySite,
    queryBySite: queryBySite,
    siteObjs: siteObjs,
    urlIndexRows: loadUrlIndexRowsForOutcomes_(),
    observedAt: nowRecordedAt_()
  });

  var appended = appendDecisionOutcomeRows_(plan.toAppend);
  writeLog_(
    'INFO',
    '',
    'runDecisionOutcomeObservation 结束 appended=' +
      appended +
      ' pending=' +
      plan.pending +
      ' skippedExisting=' +
      plan.skippedExisting
  );
  return {
    pending: plan.pending,
    appended: appended,
    skippedExisting: plan.skippedExisting
  };
}

function outcomeHorizonDefs_() {
  return DECISION_OUTCOME_HORIZONS.slice();
}

function computeOutcomeTargetDate_(decisionDataDate, days) {
  var base = normalizeKeyDate_(decisionDataDate);
  if (!base) return '';
  return addDaysStr_(base, Number(days || 0));
}

/**
 * Outcome 7d 窗口：TargetDate−6 … TargetDate（含）。
 */
function computeOutcomeWindow_(targetDate) {
  var end = normalizeKeyDate_(targetDate);
  if (!end) return { start: '', end: '' };
  return { start: addDaysStr_(end, -6), end: end };
}

function isOutcomeDataMature_(latestGscDataDate, targetDate) {
  var latest = normalizeKeyDate_(latestGscDataDate);
  var target = normalizeKeyDate_(targetDate);
  if (!latest || !target) return false;
  return latest >= target;
}

function buildOutcomeKey_(decisionId, horizon) {
  return String(decisionId || '').trim() + '||' + String(horizon || '').trim();
}

/**
 * 纯函数：为决策列表规划应 append 的 Outcome 行。
 * PENDING 不落表；同 DecisionID+Horizon 已存在则跳过。
 */
function planDecisionOutcomeRows_(ctx) {
  ctx = ctx || {};
  var decisions = ctx.decisions || [];
  var existingKeys = ctx.existingKeys || {};
  var latestBySite = ctx.latestBySite || {};
  var dailyBySite = ctx.dailyBySite || {};
  var queryBySite = ctx.queryBySite || {};
  var siteObjs = ctx.siteObjs || {};
  var urlIndexRows = ctx.urlIndexRows || [];
  var observedAt = ctx.observedAt || '';

  var toAppend = [];
  var pending = 0;
  var skippedExisting = 0;
  var seen = {};
  var horizons = outcomeHorizonDefs_();

  for (var i = 0; i < decisions.length; i++) {
    var d = decisions[i];
    if (!d || !d.decisionId) continue;
    var siteName = d.site;
    var decisionDataDate = normalizeKeyDate_(d.decisionDataDate);
    if (!decisionDataDate) continue;

    var latest = latestBySite[siteName] || '';
    var site = siteObjs[siteName] || { name: siteName };

    for (var h = 0; h < horizons.length; h++) {
      var hz = horizons[h];
      var key = buildOutcomeKey_(d.decisionId, hz.name);
      if (existingKeys[key] || seen[key]) {
        skippedExisting++;
        continue;
      }

      var targetDate = computeOutcomeTargetDate_(decisionDataDate, hz.days);
      if (!targetDate) continue;

      if (!isOutcomeDataMature_(latest, targetDate)) {
        pending++;
        continue;
      }

      var metrics = computeOutcomeWindowMetrics_({
        dailyRows: dailyBySite[siteName] || [],
        queryRows: queryBySite[siteName] || [],
        site: site,
        targetDate: targetDate,
        urlIndexRows: urlIndexRows,
        siteName: siteName
      });

      var row = buildDecisionOutcomeRow_({
        decisionId: d.decisionId,
        site: siteName,
        ruleVersion: d.ruleVersion || '',
        recommendedAction: d.recommendedAction || '',
        decisionDataDate: decisionDataDate,
        horizon: hz.name,
        targetDate: targetDate,
        observedDataDate: targetDate,
        status: OBSERVATION_STATUS.OBSERVED,
        metrics: metrics,
        observedAt: observedAt
      });
      toAppend.push(row);
      seen[key] = true;
    }
  }

  return {
    toAppend: toAppend,
    pending: pending,
    skippedExisting: skippedExisting
  };
}

function buildDecisionOutcomeRow_(opts) {
  opts = opts || {};
  var m = opts.metrics || {};
  return [
    opts.decisionId || '',
    opts.site || '',
    opts.ruleVersion || '',
    opts.recommendedAction || '',
    opts.decisionDataDate || '',
    opts.horizon || '',
    opts.targetDate || '',
    opts.observedDataDate || '',
    opts.status || OBSERVATION_STATUS.OBSERVED,
    m.impressionsWindow === undefined || m.impressionsWindow === null ? 0 : m.impressionsWindow,
    m.clicksWindow === undefined || m.clicksWindow === null ? 0 : m.clicksWindow,
    m.queryCount === undefined || m.queryCount === null ? 0 : m.queryCount,
    m.guideQueryCount === undefined || m.guideQueryCount === null ? 0 : m.guideQueryCount,
    m.top50QueryCount === undefined || m.top50QueryCount === null ? 0 : m.top50QueryCount,
    m.top20QueryCount === undefined || m.top20QueryCount === null ? 0 : m.top20QueryCount,
    m.bestPosition === '' || m.bestPosition === null || m.bestPosition === undefined
      ? ''
      : m.bestPosition,
    m.indexedURLCount === '' || m.indexedURLCount === null || m.indexedURLCount === undefined
      ? ''
      : m.indexedURLCount,
    m.indexRate === '' || m.indexRate === null || m.indexRate === undefined ? '' : m.indexRate,
    opts.observedAt || ''
  ];
}

/**
 * 从已有 Daily / Query / URL索引计算 Outcome 窗口指标。
 * 不含 DomainScore / TractionScore 等内部模型字段。
 */
function computeOutcomeWindowMetrics_(opts) {
  opts = opts || {};
  var targetDate = normalizeKeyDate_(opts.targetDate);
  var win = computeOutcomeWindow_(targetDate);
  var dailyRows = opts.dailyRows || [];
  var queryRows = opts.queryRows || [];
  var site = opts.site || { name: opts.siteName || '' };

  var impressions = 0;
  var clicks = 0;
  if (win.start && win.end) {
    for (var i = 0; i < dailyRows.length; i++) {
      var dataDate = normalizeKeyDate_(dailyRows[i][0]);
      if (!dataDate || dataDate < win.start || dataDate > win.end) continue;
      var c = Number(dailyRows[i][2] || 0);
      var imp = Number(dailyRows[i][3] || 0);
      if (!isNaN(c)) clicks += c;
      if (!isNaN(imp)) impressions += imp;
    }
  }

  var qStats = computeOutcomeQueryStats_(queryRows, win.start, win.end, site);
  var indexed = getIndexedUrlCountAsOf_(opts.urlIndexRows || [], opts.siteName || site.name, targetDate);

  return {
    impressionsWindow: impressions,
    clicksWindow: clicks,
    queryCount: qStats.queryCount,
    guideQueryCount: qStats.guideQueryCount,
    top50QueryCount: qStats.top50,
    top20QueryCount: qStats.top20,
    bestPosition: qStats.bestPosition,
    indexedURLCount: indexed === null ? '' : indexed,
    // Sitemap 无可靠历史 as-of，IndexRate 留空，避免用“今天 sitemap”伪造过去比率
    indexRate: ''
  };
}

/**
 * M3-3：Decision Baseline 7D。
 * 窗口 = DecisionDataDate−6 … DecisionDataDate，与 Outcome 共用同一统计 helper。
 * 不请求 GSC；不写 Outcome；不计算 Delta。
 */
function buildDecisionBaseline7D_(opts) {
  opts = opts || {};
  var end = normalizeKeyDate_(opts.decisionDataDate);
  var empty = {
    start: '',
    end: '',
    impressions: 0,
    clicks: 0,
    queryCount: 0,
    guideQueryCount: 0,
    top50QueryCount: 0,
    top20QueryCount: 0,
    bestPosition: ''
  };
  if (!end) return empty;

  var win = computeOutcomeWindow_(end);
  var metrics = computeOutcomeWindowMetrics_({
    dailyRows: opts.dailyRows || [],
    queryRows: opts.queryRows || [],
    site: opts.site || { name: opts.siteName || '' },
    targetDate: end,
    urlIndexRows: opts.urlIndexRows || [],
    siteName: opts.siteName || (opts.site && opts.site.name) || ''
  });

  return {
    start: win.start,
    end: win.end,
    impressions: metrics.impressionsWindow,
    clicks: metrics.clicksWindow,
    queryCount: metrics.queryCount,
    guideQueryCount: metrics.guideQueryCount,
    top50QueryCount: metrics.top50QueryCount,
    top20QueryCount: metrics.top20QueryCount,
    bestPosition: metrics.bestPosition
  };
}

/**
 * Query 窗口统计；复用 Guide Intent 词表，另算 BestPosition。
 */
function computeOutcomeQueryStats_(queryRows, startDate, endDate, site) {
  var empty = {
    queryCount: 0,
    guideQueryCount: 0,
    top50: 0,
    top20: 0,
    bestPosition: ''
  };
  if (!startDate || !endDate) return empty;

  var byQuery = {};
  for (var i = 0; i < (queryRows || []).length; i++) {
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
  var top20 = 0;
  var best = '';

  for (var n = 0; n < names.length; n++) {
    var query = names[n];
    var pos = byQuery[query].bestPosition;
    if (pos > 0 && pos <= 50) top50++;
    if (pos > 0 && pos <= 20) top20++;
    if (pos > 0 && (best === '' || pos < best)) best = pos;

    if (typeof matchGuideIntentCategories_ === 'function') {
      if (matchGuideIntentCategories_(query, site).length) guideCount++;
    }
  }

  return {
    queryCount: names.length,
    guideQueryCount: guideCount,
    top50: top50,
    top20: top20,
    bestPosition: best
  };
}

/**
 * 截至 asOfDate（含）的 URL Inspection 历史：按 URL 取最新 Verdict，PASS 计数。
 * 无可用记录返回 null（调用方写空，不写 0 冒充）。
 */
function getIndexedUrlCountAsOf_(urlIndexRows, siteName, asOfDate) {
  var asOf = normalizeKeyDate_(asOfDate);
  if (!asOf || !siteName) return null;
  var byUrl = {};
  var rows = urlIndexRows || [];
  var found = false;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][1] || '') !== siteName) continue;
    var url = String(rows[i][2] || '').trim();
    if (!url) continue;
    var d = normalizeKeyDate_(rows[i][0]);
    if (!d || d > asOf) continue;
    found = true;
    var prev = byUrl[url];
    if (!prev || d > prev.date || (d === prev.date && i > prev.rowIndex)) {
      byUrl[url] = { date: d, verdict: String(rows[i][3] || ''), rowIndex: i };
    }
  }
  if (!found) return null;
  var urls = Object.keys(byUrl);
  if (!urls.length) return null;
  var indexed = 0;
  for (var k = 0; k < urls.length; k++) {
    if (byUrl[urls[k]].verdict === 'PASS') indexed++;
  }
  return indexed;
}

function selectOutcomeAppends_(existingKeySet, candidateRows) {
  var out = [];
  var seen = {};
  var keys = existingKeySet || {};
  var rows = candidateRows || [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row || !row.length) continue;
    var key = buildOutcomeKey_(row[0], row[5]);
    if (!String(row[0] || '').trim() || !String(row[5] || '').trim()) continue;
    if (keys[key] || seen[key]) continue;
    seen[key] = true;
    out.push(row);
  }
  return out;
}

function loadDecisionHistoryRecords_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DECISION_HISTORY);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, DECISION_HISTORY_HEADERS.length)
    .getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var id = String(values[i][0] || '').trim();
    if (!id) continue;
    out.push({
      decisionId: id,
      runDate: normalizeKeyDate_(values[i][1]),
      decisionDataDate: normalizeKeyDate_(values[i][2]),
      site: String(values[i][3] || '').trim(),
      ruleVersion: String(values[i][4] || '').trim(),
      recommendedAction: String(values[i][27] || '').trim()
    });
  }
  return out;
}

function loadDecisionOutcomeKeySet_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DECISION_OUTCOMES);
  var set = {};
  if (!sheet || sheet.getLastRow() < 2) return set;
  var values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, DECISION_OUTCOME_HEADERS.length)
    .getValues();
  for (var i = 0; i < values.length; i++) {
    var key = buildOutcomeKey_(values[i][0], values[i][5]);
    if (String(values[i][0] || '').trim()) set[key] = true;
  }
  return set;
}

function loadUrlIndexRowsForOutcomes_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.URL_INDEX);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, URL_INDEX_HEADERS.length).getValues();
}

function appendDecisionOutcomeRows_(candidateRows) {
  if (!candidateRows || !candidateRows.length) return 0;
  ensureSheet_(SHEET_NAMES.DECISION_OUTCOMES, DECISION_OUTCOME_HEADERS);
  var existing = loadDecisionOutcomeKeySet_();
  var toAppend = selectOutcomeAppends_(existing, candidateRows);
  if (!toAppend.length) return 0;
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DECISION_OUTCOMES);
  var start = sheet.getLastRow() + 1;
  sheet
    .getRange(start, 1, toAppend.length, DECISION_OUTCOME_HEADERS.length)
    .setValues(toAppend);
  return toAppend.length;
}
