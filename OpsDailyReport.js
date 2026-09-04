/**
 * G028 P1 — 经营日报历史
 *
 * Reuses existing snapshot / site status / realtime monitor / content-update /
 * portfolio facts. Does not call GSC APIs or rebuild the collection layer.
 * Upsert key: 日期 + Site ID. Steam gaps must not block writes.
 */

function ensureOpsDailyHistorySheet_() {
  ensureSheet_(SHEET_NAMES.OPS_DAILY_HISTORY, OPS_DAILY_HISTORY_HEADERS);
}

/**
 * Menu / clasp entrypoint. Writes one history row per Enabled site for today.
 * @return {{date:string, written:number, inserted:number, updated:number, skipped:number, byStatus:Object, samples:Array}}
 */
function runOpsDailyReportHistory() {
  assertRuntimePrerequisites_();
  return runOpsDailyReportHistory_(todayStr_(), {});
}

/**
 * @param {string} reportDate YYYY-MM-DD
 * @param {Object=} options injectable loaders for local tests
 * @return {{date:string, written:number, inserted:number, updated:number, skipped:number, byStatus:Object, samples:Array}}
 */
function runOpsDailyReportHistory_(reportDate, options) {
  options = options || {};
  ensureOpsDailyHistorySheet_();
  var dateStr = normalizeKeyDate_(reportDate) || todayStr_();
  writeLog_('INFO', '', 'OPS_DAILY_HISTORY_START date=' + dateStr);

  var sites = options.sites || getEnabledSites();
  var snapshotBySite = options.snapshotBySite || loadLatestSnapshotBySite_();
  var siteStatusBySite = options.siteStatusBySite || loadOpsSiteStatusBySite_();
  var portfolioBySite = options.portfolioBySite || loadOpsPortfolioBySite_();
  var freshBySite = options.freshBySite || loadOpsFreshSiteMonitorBySite_();
  var contentUpdates =
    options.contentUpdates || loadOpsContentUpdatesBySite_();
  var dailyBySite = options.dailyBySite || loadDailyRowsBySite_();
  var upsert =
    options.upsert ||
    function (row) {
      return upsertOpsDailyHistoryRow_(row);
    };

  var summary = {
    date: dateStr,
    written: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    byStatus: {},
    samples: [],
    details: []
  };
  summary.byStatus[OPS_STATUS.GROWTH] = 0;
  summary.byStatus[OPS_STATUS.STABLE] = 0;
  summary.byStatus[OPS_STATUS.DECLINE] = 0;
  summary.byStatus[OPS_STATUS.PAUSE] = 0;

  for (var i = 0; i < (sites || []).length; i++) {
    var site = sites[i];
    var siteId = String((site && site.siteId) || '').trim();
    if (!siteId) {
      writeLog_(
        'WARN',
        (site && site.name) || '',
        'OPS_DAILY_HISTORY_SKIP | missing site_id'
      );
      summary.skipped += 1;
      summary.details.push({
        site: (site && site.name) || '',
        status: 'SKIPPED',
        reason: 'MISSING_SITE_ID'
      });
      continue;
    }

    var record = buildOpsDailyRecord_({
      reportDate: dateStr,
      site: site,
      snapshot: snapshotBySite[site.name] || null,
      siteStatus: siteStatusBySite[site.name] || null,
      portfolio: portfolioBySite[site.name] || null,
      fresh: freshBySite[site.name] || null,
      lastContentUpdate: contentUpdates[site.name] || null,
      dailyRows: dailyBySite[site.name] || []
    });
    var row = opsDailyHistoryRow_(record);
    var result = upsert(row);
    summary.written += 1;
    if (result && result.action === 'update') summary.updated += 1;
    else summary.inserted += 1;
    if (summary.byStatus[record.opsStatus] !== undefined) {
      summary.byStatus[record.opsStatus] += 1;
    }
    summary.details.push({
      site_id: siteId,
      site: site.name,
      opsStatus: record.opsStatus,
      action: (result && result.action) || 'upsert'
    });
    if (summary.samples.length < 2) {
      summary.samples.push({
        date: record.date,
        site_id: record.siteId,
        site: record.siteName,
        opsStatus: record.opsStatus,
        trend7d: record.trend7d,
        clicks: record.clicks,
        impressions: record.impressions,
        reason: record.reason
      });
    }
  }

  var msg =
    'OPS_DAILY_HISTORY_DONE date=' +
    dateStr +
    ' written=' +
    summary.written +
    ' inserted=' +
    summary.inserted +
    ' updated=' +
    summary.updated +
    ' skipped=' +
    summary.skipped +
    ' 增长=' +
    summary.byStatus[OPS_STATUS.GROWTH] +
    ' 稳定=' +
    summary.byStatus[OPS_STATUS.STABLE] +
    ' 衰退=' +
    summary.byStatus[OPS_STATUS.DECLINE] +
    ' 暂停投入=' +
    summary.byStatus[OPS_STATUS.PAUSE];
  writeLog_('INFO', '', msg);
  Logger.log(msg);
  return summary;
}

function upsertOpsDailyHistoryRow_(row) {
  return upsertRow_(SHEET_NAMES.OPS_DAILY_HISTORY, OPS_DAILY_HISTORY_HEADERS, row, function (r) {
    return normalizeKeyDate_(r[0]) + '||' + String(r[1] || '').trim();
  });
}

function opsDailyHistoryRow_(record) {
  return [
    record.date,
    record.siteId,
    record.siteName,
    record.gameStage,
    record.clicks,
    record.impressions,
    record.ctr,
    record.avgPosition,
    record.trend7d,
    record.siteStatus,
    record.opsStatus,
    record.mainChange,
    record.suggestedAction,
    record.priority,
    record.reason,
    record.lastModified
  ];
}

/**
 * Pure record builder from already-loaded facts.
 * Trend / ops status use GSC日数据 recent windows — never stale Growth3D.
 * @param {Object} ctx
 * @return {Object}
 */
function buildOpsDailyRecord_(ctx) {
  ctx = ctx || {};
  var site = ctx.site || {};
  var snap = ctx.snapshot || null;
  var status = ctx.siteStatus || {};
  var portfolio = ctx.portfolio || {};
  var fresh = ctx.fresh || {};
  var lastUpdate = ctx.lastContentUpdate || null;

  var clicks = snap ? blankableNumber_(snap[9]) : '';
  var impressions = snap ? blankableNumber_(snap[8]) : '';
  var ctr = snap ? blankableNumber_(snap[10]) : '';
  var avgPosition = snap ? blankableNumber_(snap[11]) : '';

  var trend = ctx.trend || computeOpsSiteTrendFromDaily_(ctx.dailyRows || []);
  var trend7d = formatOpsTrend7d_(trend);
  var siteStatusLabel = String(status.lifecycleStage || '').trim();
  var recommendedAction = String(status.recommendedAction || '').trim();
  var priority = String(status.priority || '').trim();
  var indexedCount = status.indexedCount;
  var indexKnown = isOpsIndexAuditKnown_(indexedCount);
  var realtimeIncomplete = isOpsRealtimeIncomplete_(fresh);

  var classification = classifyOpsStatus_({
    investmentTier: portfolio.investmentTier,
    portfolioAction: portfolio.portfolioAction,
    recommendedAction: recommendedAction,
    trend: trend,
    realtimeIncomplete: realtimeIncomplete
  });

  var gameStage = '';
  if (lastUpdate && lastUpdate.lifecyclePhase) {
    gameStage = String(lastUpdate.lifecyclePhase).trim();
  }

  var lastModified = lastUpdate && lastUpdate.date ? lastUpdate.date : '';
  var mainChange = buildOpsMainChange_({
    trend: trend,
    trend7d: trend7d,
    recommendedAction: recommendedAction,
    lastModified: lastModified,
    indexKnown: indexKnown,
    realtimeIncomplete: realtimeIncomplete
  });

  return {
    date: normalizeKeyDate_(ctx.reportDate) || '',
    siteId: String(site.siteId || '').trim(),
    siteName: String(site.name || '').trim(),
    gameStage: gameStage,
    clicks: clicks,
    impressions: impressions,
    ctr: ctr,
    avgPosition: avgPosition,
    trend7d: trend7d,
    siteStatus: siteStatusLabel,
    opsStatus: classification.status,
    mainChange: mainChange,
    suggestedAction: recommendedAction || classification.suggestedAction || '',
    priority: priority || classification.priority || '',
    reason: classification.reason,
    lastModified: lastModified
  };
}

/**
 * Recent site-level trend from GSC日数据.
 * endDate = latest DataDate present for the site.
 * recent = [end-2, end]; prior = [end-5, end-3]; also sum full 7d [end-6, end].
 * Does not use 站点状态.Growth3D (aligned to possibly stale DecisionDataDate).
 *
 * @param {Array<Array>} dailyRows rows: DataDate, Site, Clicks, Impressions, ...
 * @return {{ok:boolean, endDate:string, recent3d:number, prior3d:number, impressions7d:number, pctChange:number|null, direction:string, label:string, reason:string}}
 */
function computeOpsSiteTrendFromDaily_(dailyRows) {
  var empty = {
    ok: false,
    endDate: '',
    recent3d: 0,
    prior3d: 0,
    impressions7d: 0,
    pctChange: null,
    direction: 'insufficient',
    label: '样本不足',
    reason: 'GSC日数据不足，无法判断近期趋势'
  };
  var endDate = latestDateInRows_(dailyRows || [], 0);
  if (!endDate) return empty;

  var recentStart = addDaysStr_(endDate, -2);
  var priorEnd = addDaysStr_(endDate, -3);
  var priorStart = addDaysStr_(endDate, -5);
  var window7Start = addDaysStr_(endDate, -6);
  if (!recentStart || !priorEnd || !priorStart || !window7Start) return empty;

  var recent3d = 0;
  var prior3d = 0;
  var impressions7d = 0;
  var recentDays = {};
  var priorDays = {};

  for (var i = 0; i < dailyRows.length; i++) {
    var dataDate = normalizeKeyDate_(dailyRows[i][0]);
    if (!dataDate) continue;
    var impressions = Number(dailyRows[i][3] || 0);
    if (isNaN(impressions)) impressions = 0;
    if (dataDate >= window7Start && dataDate <= endDate) {
      impressions7d += impressions;
    }
    if (dataDate >= recentStart && dataDate <= endDate) {
      recent3d += impressions;
      recentDays[dataDate] = true;
    }
    if (dataDate >= priorStart && dataDate <= priorEnd) {
      prior3d += impressions;
      priorDays[dataDate] = true;
    }
  }

  var recentDayCount = Object.keys(recentDays).length;
  var priorDayCount = Object.keys(priorDays).length;
  if (recentDayCount < 2 || priorDayCount < 2) {
    return {
      ok: false,
      endDate: endDate,
      recent3d: recent3d,
      prior3d: prior3d,
      impressions7d: impressions7d,
      pctChange: null,
      direction: 'insufficient',
      label: '样本不足',
      reason: '近期日数据天数不足（截止 ' + endDate + '）'
    };
  }

  if (
    impressions7d < OPS_TREND_MIN_7D_IMPRESSIONS ||
    recent3d < OPS_TREND_MIN_WINDOW_IMPRESSIONS ||
    prior3d < OPS_TREND_MIN_WINDOW_IMPRESSIONS
  ) {
    return {
      ok: false,
      endDate: endDate,
      recent3d: recent3d,
      prior3d: prior3d,
      impressions7d: impressions7d,
      pctChange: null,
      direction: 'insufficient',
      label: '样本不足',
      reason:
        '小样本（近3日 ' +
        recent3d +
        ' / 前3日 ' +
        prior3d +
        ' / 7日 ' +
        impressions7d +
        '，截止 ' +
        endDate +
        '）'
    };
  }

  if (prior3d <= 0) {
    return {
      ok: false,
      endDate: endDate,
      recent3d: recent3d,
      prior3d: prior3d,
      impressions7d: impressions7d,
      pctChange: null,
      direction: 'insufficient',
      label: '样本不足',
      reason: '前3日曝光为 0，无法计算可比变化（截止 ' + endDate + '）'
    };
  }

  var pctChange = ((recent3d - prior3d) / prior3d) * 100;
  var rounded = Math.round(pctChange);
  var direction = 'flat';
  var label = '持平';
  if (rounded > 0) {
    direction = 'up';
    label = '上升 ' + Math.abs(rounded) + '%';
  } else if (rounded < 0) {
    direction = 'down';
    label = '下降 ' + Math.abs(rounded) + '%';
  }

  return {
    ok: true,
    endDate: endDate,
    recent3d: recent3d,
    prior3d: prior3d,
    impressions7d: impressions7d,
    pctChange: pctChange,
    direction: direction,
    label: label,
    reason:
      '近3日曝光 ' +
      recent3d +
      ' vs 前3日 ' +
      prior3d +
      '（截止 ' +
      endDate +
      '）→ ' +
      label
  };
}

/**
 * Simple ops status from recent GSC日数据 trend.
 * Incomplete realtime never drives 衰退. Prefer 稳定 when sample is weak.
 * 暂停投入 only from explicit FROZEN/FREEZE/ARCHIVE evidence.
 */
function classifyOpsStatus_(input) {
  input = input || {};
  var tier = String(input.investmentTier || '').trim();
  var portfolioAction = String(input.portfolioAction || '').trim();
  var recommendedAction = String(input.recommendedAction || '').trim();
  var trend = input.trend || {};

  if (
    tier === INVESTMENT_TIER.FROZEN ||
    portfolioAction === PORTFOLIO_ACTION.FREEZE ||
    recommendedAction === 'ARCHIVE'
  ) {
    return {
      status: OPS_STATUS.PAUSE,
      reason: '已有经营层明确冻结/归档依据，建议暂停投入',
      suggestedAction: recommendedAction || PORTFOLIO_ACTION.FREEZE,
      priority: 'P3'
    };
  }

  // Incomplete realtime must not be used as decline evidence.
  if (input.realtimeIncomplete) {
    // Ignore realtime rates; continue with formal daily trend only.
  }

  if (!trend.ok) {
    return {
      status: OPS_STATUS.STABLE,
      reason: (trend.reason || '近期证据不足') + '；默认稳定，不因 realtime 短期波动判定衰退',
      suggestedAction: recommendedAction || 'WAIT',
      priority: 'P3'
    };
  }

  var pct = Number(trend.pctChange);
  if (!isNaN(pct) && pct >= OPS_TREND_GROWTH_PCT_MIN) {
    return {
      status: OPS_STATUS.GROWTH,
      reason: '明确增长：' + (trend.reason || trend.label),
      suggestedAction: recommendedAction || 'WAIT',
      priority: 'P2'
    };
  }
  if (!isNaN(pct) && pct <= OPS_TREND_DECLINE_PCT_MAX) {
    return {
      status: OPS_STATUS.DECLINE,
      reason:
        '明确持续下降：' +
        (trend.reason || trend.label) +
        '（未用未完整 realtime）',
      suggestedAction: recommendedAction || 'WAIT',
      priority: 'P2'
    };
  }
  return {
    status: OPS_STATUS.STABLE,
    reason: '波动不足：' + (trend.reason || trend.label),
    suggestedAction: recommendedAction || 'WAIT',
    priority: 'P3'
  };
}

function formatOpsTrend7d_(trend) {
  trend = trend || {};
  if (trend.label) return String(trend.label);
  return '样本不足';
}

function isOpsIndexAuditKnown_(indexedCount) {
  return indexedCount !== '' && indexedCount !== null && indexedCount !== undefined;
}

function isOpsRealtimeIncomplete_(fresh) {
  if (!fresh) return false;
  var raw = fresh.dataIncomplete;
  if (raw === true || raw === 1) return true;
  var text = String(raw == null ? '' : raw).trim().toUpperCase();
  return text === 'TRUE' || text === 'YES' || text === '1' || text === '未完全' || text === 'Y';
}

function buildOpsMainChange_(ctx) {
  ctx = ctx || {};
  var parts = [];
  var trend = ctx.trend || {};
  if (ctx.trend7d) {
    parts.push('7日趋势 ' + ctx.trend7d);
  } else if (trend.label) {
    parts.push('7日趋势 ' + trend.label);
  } else {
    parts.push('近期趋势样本不足');
  }
  if (trend.endDate) {
    parts.push('数据截止 ' + trend.endDate);
  }
  if (ctx.realtimeIncomplete) {
    parts.push('realtime 未完整（未用于衰退判定）');
  }
  if (ctx.lastModified) {
    parts.push('最近内容更新 ' + ctx.lastModified);
  }
  if (ctx.recommendedAction) {
    parts.push('SEO动作 ' + ctx.recommendedAction);
  }
  // Explicitly avoid inventing a low-index anomaly when audit is unknown.
  if (!ctx.indexKnown) {
    parts.push('索引审计暂缺（不触发低索引异常）');
  }
  return parts.join('；');
}

function blankableNumber_(value) {
  if (value === '' || value === null || value === undefined) return '';
  var n = Number(value);
  return isNaN(n) ? '' : n;
}

function loadOpsSiteStatusBySite_() {
  var out = {};
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.SITE_STATUS);
  if (!sheet || sheet.getLastRow() < 2) return out;
  var header = ensureSheetHeaders_(sheet, SITE_STATUS_HEADERS);
  var col = sheetHeaderIndexMap_(header);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var name = String(values[i][col.Site] || '').trim();
    if (!name) continue;
    out[name] = {
      lifecycleStage: String(values[i][col.LifecycleStage] || '').trim(),
      recommendedAction: String(values[i][col.RecommendedAction] || '').trim(),
      priority: String(values[i][col.Priority] || '').trim(),
      indexedCount:
        values[i][col.IndexedURLCount] === '' ||
        values[i][col.IndexedURLCount] === null ||
        values[i][col.IndexedURLCount] === undefined
          ? null
          : values[i][col.IndexedURLCount]
    };
  }
  return out;
}

function loadOpsPortfolioBySite_() {
  var out = {};
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.PORTFOLIO);
  if (!sheet || sheet.getLastRow() < 2) return out;
  var header = ensureSheetHeaders_(sheet, PORTFOLIO_HEADERS);
  var col = sheetHeaderIndexMap_(header);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var name = String(values[i][col['站点']] || '').trim();
    if (!name) continue;
    out[name] = {
      investmentTier: String(values[i][col['投入档位']] || '').trim(),
      portfolioAction: String(values[i][col['经营动作']] || '').trim()
    };
  }
  return out;
}

function loadOpsFreshSiteMonitorBySite_() {
  var out = {};
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.FRESH_SITE_MONITOR);
  if (!sheet || sheet.getLastRow() < 2) return out;
  var header = ensureSheetHeaders_(sheet, FRESH_SITE_MONITOR_HEADERS);
  var col = sheetHeaderIndexMap_(header);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues();
  // First row per site is newest when sheet is sorted newest-first; keep first seen.
  for (var i = 0; i < values.length; i++) {
    var name = String(values[i][col['站点']] || '').trim();
    if (!name || out[name]) continue;
    out[name] = {
      dataIncomplete: values[i][col['数据是否未完全']],
      clickGrowthRate: values[i][col['点击增长率']],
      impressionGrowthRate: values[i][col['展现增长率']]
    };
  }
  return out;
}

/**
 * Header-addressed latest content update per site.
 * Production 「内容更新记录」column order may differ from CONTENT_UPDATE_HEADERS;
 * never hard-code LifecyclePhase by numeric index.
 */
function loadOpsContentUpdatesBySite_() {
  var out = {};
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.CONTENT_UPDATES);
  if (!sheet || sheet.getLastRow() < 2) return out;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = sheetHeaderIndexMap_(header);
  var dateCol = col['更新时间'];
  var siteCol = col['站点'];
  if (dateCol === undefined || siteCol === undefined) return out;
  var phaseCol = col.LifecyclePhase;
  var pathCol = col['页面路径'];
  var sourceCol = col['来源'];
  var noteCol = col['更新说明'];
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  for (var i = 0; i < values.length; i++) {
    var name = String(values[i][siteCol] || '').trim();
    if (!name) continue;
    var d = normalizeKeyDate_(values[i][dateCol]);
    if (!d) continue;
    var prev = out[name];
    if (prev && prev.date >= d) continue;
    var phase =
      phaseCol === undefined ? '' : String(values[i][phaseCol] || '').trim();
    // Only keep values that look like a lifecycle label, not timestamps.
    if (phase && (/^\d{4}-\d{2}-\d{2}/.test(phase) || /T\d{2}:\d{2}/.test(phase))) {
      phase = '';
    }
    out[name] = {
      date: d,
      pagePath: pathCol === undefined ? '' : String(values[i][pathCol] || '').trim(),
      source: sourceCol === undefined ? '' : String(values[i][sourceCol] || '').trim(),
      note: noteCol === undefined ? '' : String(values[i][noteCol] || '').trim(),
      lifecyclePhase: phase
    };
  }
  return out;
}
