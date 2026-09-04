/**
 * G028 P2 — 站点经营日报（展示层）
 *
 * Reads latest 经营日报历史 rows and overwrites 站点经营日报.
 * Does not recompute P1 trend / ops status. Does not wire auto-run.
 */

/**
 * Menu / clasp entrypoint.
 */
function runOpsDailyReport() {
  assertRuntimePrerequisites_();
  return runOpsDailyReport_({});
}

/**
 * @param {Object=} options injectable loaders for tests
 * @return {{reportDate:string, activeSites:number, actionCount:number, siteRows:number, overview:Object, actions:Array, ms2Judgment:string}}
 */
function runOpsDailyReport_(options) {
  options = options || {};
  ensureSheet_(SHEET_NAMES.OPS_DAILY_REPORT, ['站点经营日报']);
  writeLog_('INFO', '', 'OPS_DAILY_REPORT_START');

  var historyRows = options.historyRows || loadOpsDailyHistoryLatestRows_();
  if (!historyRows.length) {
    writeOpsDailyReportSheet_({
      reportDate: '',
      gscCutoff: '',
      counts: emptyOpsStatusCounts_(),
      actions: [],
      siteRows: []
    });
    writeLog_('WARN', '', 'OPS_DAILY_REPORT_EMPTY | no history rows');
    return {
      reportDate: '',
      activeSites: 0,
      actionCount: 0,
      siteRows: 0,
      overview: emptyOpsStatusCounts_(),
      actions: [],
      ms2Judgment: ''
    };
  }

  var reportDate = historyRows[0].date;
  var queryBySite = options.queryBySite || loadQueryRowsBySite_();
  var pageBySite = options.pageBySite || loadPageRowsBySite_();
  var opportunityRows = options.opportunityRows || loadOpsOpportunityRows_();

  var selected = selectOpsDailyActions_(historyRows, {
    queryBySite: queryBySite,
    pageBySite: pageBySite,
    opportunityRows: opportunityRows
  });
  var selectedSites = {};
  for (var i = 0; i < selected.length; i++) {
    selectedSites[selected[i].site] = true;
  }

  var siteRows = [];
  var counts = emptyOpsStatusCounts_();
  var gscCutoff = '';
  var ms2Judgment = '';
  for (var h = 0; h < historyRows.length; h++) {
    var row = historyRows[h];
    if (counts[row.opsStatus] !== undefined) counts[row.opsStatus] += 1;
    var cutoff = extractOpsGscCutoff_(row.mainChange) || extractOpsGscCutoff_(row.reason);
    if (cutoff && cutoff > gscCutoff) gscCutoff = cutoff;
    var judgment = decideOpsTodayJudgment_(row, !!selectedSites[row.site]);
    if (row.siteId === 'mortal-shell-ii' || row.site === 'Mortal Shell II') {
      ms2Judgment = judgment;
    }
    siteRows.push({
      site: row.site,
      gameStage: row.gameStage,
      opsStatus: row.opsStatus,
      trend7d: row.trend7d,
      clicks: row.clicks,
      impressions: row.impressions,
      avgPosition: row.avgPosition,
      mainChange: row.mainChange,
      judgment: judgment
    });
  }

  var view = {
    reportDate: reportDate,
    gscCutoff: gscCutoff,
    counts: counts,
    actions: selected,
    siteRows: siteRows
  };
  if (options.writeSheet !== false) {
    writeOpsDailyReportSheet_(view);
  }

  var summary = {
    reportDate: reportDate,
    activeSites: historyRows.length,
    actionCount: selected.length,
    siteRows: siteRows.length,
    overview: {
      reportDate: reportDate,
      activeSites: historyRows.length,
      growth: counts[OPS_STATUS.GROWTH],
      stable: counts[OPS_STATUS.STABLE],
      decline: counts[OPS_STATUS.DECLINE],
      pause: counts[OPS_STATUS.PAUSE],
      actionCount: selected.length,
      gscCutoff: gscCutoff
    },
    actions: selected,
    ms2Judgment: ms2Judgment
  };
  writeLog_(
    'INFO',
    '',
    'OPS_DAILY_REPORT_DONE date=' +
      reportDate +
      ' sites=' +
      summary.activeSites +
      ' actions=' +
      summary.actionCount +
      ' ms2=' +
      ms2Judgment
  );
  Logger.log(JSON.stringify(summary.overview));
  return summary;
}

function emptyOpsStatusCounts_() {
  var counts = {};
  counts[OPS_STATUS.GROWTH] = 0;
  counts[OPS_STATUS.STABLE] = 0;
  counts[OPS_STATUS.DECLINE] = 0;
  counts[OPS_STATUS.PAUSE] = 0;
  return counts;
}

/** Load all 经营日报历史 rows for the latest 日期. */
function loadOpsDailyHistoryLatestRows_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.OPS_DAILY_HISTORY);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var header = ensureSheetHeaders_(sheet, OPS_DAILY_HISTORY_HEADERS);
  var col = sheetHeaderIndexMap_(header);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues();
  var latest = '';
  var parsed = [];
  for (var i = 0; i < values.length; i++) {
    var date = normalizeKeyDate_(values[i][col['日期']]);
    if (!date) continue;
    if (date > latest) latest = date;
    parsed.push({
      date: date,
      siteId: String(values[i][col['Site ID']] || '').trim(),
      site: String(values[i][col['站点']] || '').trim(),
      gameStage: String(values[i][col['游戏阶段']] || '').trim(),
      clicks: values[i][col['点击']],
      impressions: values[i][col['曝光']],
      ctr: values[i][col['CTR']],
      avgPosition: values[i][col['平均排名']],
      trend7d: String(values[i][col['7日趋势']] || '').trim(),
      siteStatus: String(values[i][col['站点状态']] || '').trim(),
      opsStatus: String(values[i][col['经营状态']] || '').trim(),
      mainChange: String(values[i][col['主要变化']] || '').trim(),
      suggestedAction: String(values[i][col['建议操作']] || '').trim(),
      priority: String(values[i][col['优先级']] || '').trim(),
      reason: String(values[i][col['判断原因']] || '').trim(),
      lastModified: String(values[i][col['最近修改']] || '').trim()
    });
  }
  if (!latest) return [];
  var out = [];
  for (var j = 0; j < parsed.length; j++) {
    if (parsed[j].date === latest) out.push(parsed[j]);
  }
  return out;
}

function extractOpsGscCutoff_(text) {
  var m = String(text || '').match(/截止\s*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function loadOpsOpportunityRows_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.OPPORTUNITIES);
  var range = getSheetDataRange_(sheet, OPPORTUNITY_HEADERS.length);
  return range ? range.getValues() : [];
}

/**
 * Map SEO RecommendedAction → allowed execute label, or '' if not executable.
 * Decline sites never mint 新增页面 / 更新页面 / 技术修复 into the top-3 list.
 */
function mapOpsExecuteAction_(suggestedAction, opsStatus) {
  var action = String(suggestedAction || '').trim();
  if (!action || action === 'WAIT' || action === 'ARCHIVE' || action === 'NO_ACTION') {
    return '';
  }
  if (opsStatus === OPS_STATUS.DECLINE || opsStatus === OPS_STATUS.PAUSE) {
    return '';
  }
  if (action === 'CHECK_INDEX' || action === 'INDEX_FIX') {
    return OPS_EXECUTE_ACTION.TECH_FIX;
  }
  if (action === 'CONTENT_OPTIMIZE' || action === 'INTERNAL_LINK') {
    return OPS_EXECUTE_ACTION.UPDATE_PAGE;
  }
  if (action === 'CONTENT_EXPAND') {
    return OPS_EXECUTE_ACTION.NEW_PAGE;
  }
  return '';
}

function isOpsActionPriorityEligible_(priority) {
  var p = String(priority || '').trim().toUpperCase();
  return p === 'P0' || p === 'P1' || p === 'P2';
}

/**
 * Pick 0–3 actionable recommendations. Simple tier order, no score system.
 */
function selectOpsDailyActions_(historyRows, ctx) {
  ctx = ctx || {};
  var queryBySite = ctx.queryBySite || {};
  var pageBySite = ctx.pageBySite || {};
  var opportunityRows = ctx.opportunityRows || [];
  var limit = OPS_DAILY_ACTION_LIMIT || 3;

  var candidates = [];
  for (var i = 0; i < (historyRows || []).length; i++) {
    var row = historyRows[i];
    if (row.opsStatus === OPS_STATUS.PAUSE) continue;
    if (row.opsStatus === OPS_STATUS.DECLINE) continue;
    if (!isOpsActionPriorityEligible_(row.priority)) continue;

    var executeAction = mapOpsExecuteAction_(row.suggestedAction, row.opsStatus);
    if (!executeAction) continue;

    var evidence = findOpsActionEvidence_(row, {
      queryRows: queryBySite[row.site] || [],
      pageRows: pageBySite[row.site] || [],
      opportunityRows: opportunityRows
    });

    if (
      (executeAction === OPS_EXECUTE_ACTION.NEW_PAGE ||
        executeAction === OPS_EXECUTE_ACTION.UPDATE_PAGE) &&
      !evidence.target
    ) {
      continue;
    }
    if (executeAction === OPS_EXECUTE_ACTION.TECH_FIX && !evidence.techOk) {
      continue;
    }

    var tier = 99;
    if (
      row.opsStatus === OPS_STATUS.GROWTH &&
      (executeAction === OPS_EXECUTE_ACTION.UPDATE_PAGE ||
        executeAction === OPS_EXECUTE_ACTION.NEW_PAGE)
    ) {
      tier = 1;
    } else if (
      executeAction === OPS_EXECUTE_ACTION.UPDATE_PAGE ||
      executeAction === OPS_EXECUTE_ACTION.NEW_PAGE
    ) {
      tier = 2;
    } else if (executeAction === OPS_EXECUTE_ACTION.TECH_FIX) {
      tier = 3;
    }

    candidates.push({
      tier: tier,
      priority: normalizeOpsActionPriority_(row.priority),
      site: row.site,
      siteId: row.siteId,
      action: executeAction,
      target: evidence.target || '',
      whyNow: evidence.whyNow || buildOpsActionWhyNow_(row, executeAction),
      evidence: evidence.evidenceText || buildOpsActionEvidenceText_(row, evidence),
      impressions: Number(row.impressions) || 0
    });
  }

  candidates.sort(function (a, b) {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.priority !== b.priority) {
      return opsPriorityRank_(a.priority) - opsPriorityRank_(b.priority);
    }
    return b.impressions - a.impressions;
  });

  var selected = [];
  var seenSites = {};
  for (var c = 0; c < candidates.length && selected.length < limit; c++) {
    if (seenSites[candidates[c].site]) continue;
    seenSites[candidates[c].site] = true;
    selected.push({
      priority: candidates[c].priority,
      site: candidates[c].site,
      action: candidates[c].action,
      target: candidates[c].target,
      whyNow: candidates[c].whyNow,
      evidence: candidates[c].evidence
    });
  }
  return selected;
}

function normalizeOpsActionPriority_(priority) {
  var p = String(priority || '').trim().toUpperCase();
  if (p === 'P0') return 'P1';
  if (p === 'P1' || p === 'P2') return p;
  return 'P2';
}

function opsPriorityRank_(priority) {
  var p = String(priority || '').toUpperCase();
  if (p === 'P1' || p === 'P0') return 1;
  if (p === 'P2') return 2;
  return 9;
}

function findOpsActionEvidence_(row, ctx) {
  ctx = ctx || {};
  var out = {
    target: '',
    techOk: false,
    whyNow: '',
    evidenceText: '',
    queryImpressions: 0,
    position: ''
  };
  var seo = String(row.suggestedAction || '').trim();

  if (seo === 'CHECK_INDEX' || seo === 'INDEX_FIX') {
    out.techOk =
      row.siteStatus === 'INDEX_CHECK' ||
      seo === 'CHECK_INDEX' ||
      seo === 'INDEX_FIX';
    if (out.techOk) {
      out.whyNow = '站点存在明确索引/技术问题，需优先修复可见性基础';
      out.evidenceText =
        '经营状态 ' +
        row.opsStatus +
        '；SEO动作 ' +
        seo +
        '；曝光 ' +
        row.impressions +
        '；' +
        (row.reason || row.mainChange || '');
    }
    return out;
  }

  var opp = findBestOpsOpportunityForSite_(row.site, ctx.opportunityRows || []);
  if (opp) {
    out.target = opp.query || opp.pagePath || opp.pageUrl || '';
    out.queryImpressions = opp.impressions;
    out.position = opp.position;
    out.whyNow =
      row.opsStatus === OPS_STATUS.GROWTH
        ? '站点明确增长，且已有可操作的搜索词/页面机会'
        : '存在较高曝光且排名接近可提升区间的具体 Query/Page 机会';
    out.evidenceText =
      '搜索词/页面 ' +
      out.target +
      '；展现 ' +
      opp.impressions +
      '；排名 ' +
      opp.position +
      '；站级点击 ' +
      row.clicks +
      ' / 曝光 ' +
      row.impressions +
      '；趋势 ' +
      row.trend7d;
    return out;
  }

  var queryHit = findBestOpsQueryEvidence_(ctx.queryRows || []);
  if (queryHit) {
    out.target = queryHit.query;
    out.queryImpressions = queryHit.impressions;
    out.position = queryHit.position;
    out.whyNow =
      row.opsStatus === OPS_STATUS.GROWTH
        ? '站点明确增长，且 Query 明细出现可操作搜索信号'
        : 'Query 明细显示具体词有曝光且排名接近可提升区间';
    out.evidenceText =
      'Query ' +
      queryHit.query +
      '；展现 ' +
      queryHit.impressions +
      '；排名 ' +
      queryHit.position +
      '；站级曝光 ' +
      row.impressions +
      '；趋势 ' +
      row.trend7d;
    return out;
  }

  var pageHit = findBestOpsPageEvidence_(ctx.pageRows || []);
  if (pageHit) {
    out.target = pageHit.pagePath || pageHit.pageUrl;
    out.queryImpressions = pageHit.impressions;
    out.position = pageHit.position;
    out.whyNow = 'Page 明细显示具体页面有曝光且排名接近可提升区间';
    out.evidenceText =
      '页面 ' +
      out.target +
      '；展现 ' +
      pageHit.impressions +
      '；排名 ' +
      pageHit.position +
      '；站级曝光 ' +
      row.impressions;
    return out;
  }

  return out;
}

function findBestOpsOpportunityForSite_(siteName, rows) {
  var best = null;
  for (var i = 0; i < (rows || []).length; i++) {
    if (String(rows[i][2] || '').trim() !== siteName) continue;
    var query = String(rows[i][4] || '').trim();
    var pageUrl = String(rows[i][5] || '').trim();
    var pagePath = String(rows[i][6] || '').trim();
    var impressions = Number(rows[i][8] || 0);
    var position = Number(rows[i][10] || 0);
    if (isNaN(impressions)) impressions = 0;
    if (isNaN(position)) position = 0;
    if (impressions < OPS_ACTION_MIN_QUERY_IMPRESSIONS) continue;
    if (position > 0 && (position < OPS_ACTION_RANK_MIN || position > OPS_ACTION_RANK_MAX)) {
      continue;
    }
    if (!query && !pagePath && !pageUrl) continue;
    if (!best || impressions > best.impressions) {
      best = {
        query: query,
        pageUrl: pageUrl,
        pagePath: pagePath,
        impressions: impressions,
        position: position
      };
    }
  }
  return best;
}

function findBestOpsQueryEvidence_(queryRows) {
  var byQuery = {};
  var latest = latestDateInRows_(queryRows || [], 0);
  if (!latest) return null;
  var start = addDaysStr_(latest, -6);
  for (var i = 0; i < (queryRows || []).length; i++) {
    var d = normalizeKeyDate_(queryRows[i][0]);
    if (!d || d < start || d > latest) continue;
    var q = String(queryRows[i][2] || '').trim();
    if (!q) continue;
    var impressions = Number(queryRows[i][4] || 0);
    var position = Number(queryRows[i][6] || 0);
    if (isNaN(impressions)) impressions = 0;
    if (isNaN(position)) position = 0;
    if (!byQuery[q]) {
      byQuery[q] = { query: q, impressions: 0, bestPosition: 0 };
    }
    byQuery[q].impressions += impressions;
    if (
      position > 0 &&
      (byQuery[q].bestPosition === 0 || position < byQuery[q].bestPosition)
    ) {
      byQuery[q].bestPosition = position;
    }
  }
  var best = null;
  var names = Object.keys(byQuery);
  for (var n = 0; n < names.length; n++) {
    var item = byQuery[names[n]];
    if (item.impressions < OPS_ACTION_MIN_QUERY_IMPRESSIONS) continue;
    if (
      item.bestPosition <= 0 ||
      item.bestPosition < OPS_ACTION_RANK_MIN ||
      item.bestPosition > OPS_ACTION_RANK_MAX
    ) {
      continue;
    }
    if (!best || item.impressions > best.impressions) {
      best = {
        query: item.query,
        impressions: item.impressions,
        position: item.bestPosition
      };
    }
  }
  return best;
}

function findBestOpsPageEvidence_(pageRows) {
  var byPage = {};
  var latest = latestDateInRows_(pageRows || [], 0);
  if (!latest) return null;
  var start = addDaysStr_(latest, -6);
  for (var i = 0; i < (pageRows || []).length; i++) {
    var d = normalizeKeyDate_(pageRows[i][0]);
    if (!d || d < start || d > latest) continue;
    var pageUrl = String(pageRows[i][2] || '').trim();
    var pagePath = String(pageRows[i][3] || '').trim();
    var key = pagePath || pageUrl;
    if (!key) continue;
    var impressions = Number(pageRows[i][5] || 0);
    var position = Number(pageRows[i][7] || 0);
    if (isNaN(impressions)) impressions = 0;
    if (isNaN(position)) position = 0;
    if (!byPage[key]) {
      byPage[key] = {
        pageUrl: pageUrl,
        pagePath: pagePath || key,
        impressions: 0,
        bestPosition: 0
      };
    }
    byPage[key].impressions += impressions;
    if (
      position > 0 &&
      (byPage[key].bestPosition === 0 || position < byPage[key].bestPosition)
    ) {
      byPage[key].bestPosition = position;
    }
  }
  var best = null;
  var keys = Object.keys(byPage);
  for (var k = 0; k < keys.length; k++) {
    var item = byPage[keys[k]];
    if (item.impressions < OPS_ACTION_MIN_QUERY_IMPRESSIONS) continue;
    if (
      item.bestPosition <= 0 ||
      item.bestPosition < OPS_ACTION_RANK_MIN ||
      item.bestPosition > OPS_ACTION_RANK_MAX
    ) {
      continue;
    }
    if (!best || item.impressions > best.impressions) {
      best = {
        pageUrl: item.pageUrl,
        pagePath: item.pagePath,
        impressions: item.impressions,
        position: item.bestPosition
      };
    }
  }
  return best;
}

function buildOpsActionWhyNow_(row, executeAction) {
  if (executeAction === OPS_EXECUTE_ACTION.TECH_FIX) {
    return '存在明确技术问题，需要先修复再谈增长';
  }
  if (row.opsStatus === OPS_STATUS.GROWTH) {
    return '站点明确增长，应跟进可操作搜索信号';
  }
  return '有具体可执行动作且优先级足够';
}

function buildOpsActionEvidenceText_(row, evidence) {
  evidence = evidence || {};
  var parts = [
    '经营状态 ' + row.opsStatus,
    '趋势 ' + row.trend7d,
    '点击 ' + row.clicks,
    '曝光 ' + row.impressions
  ];
  if (evidence.target) parts.push('目标 ' + evidence.target);
  if (row.reason) parts.push(row.reason);
  return parts.join('；');
}

function decideOpsTodayJudgment_(row, isSelected) {
  if (isSelected) return OPS_JUDGMENT.EXECUTE;
  if (row.opsStatus === OPS_STATUS.PAUSE) return OPS_JUDGMENT.PAUSE;
  if (row.opsStatus === OPS_STATUS.DECLINE) return OPS_JUDGMENT.NONE;
  var seo = String(row.suggestedAction || '').trim();
  if (seo === 'ARCHIVE') return OPS_JUDGMENT.PAUSE;
  return OPS_JUDGMENT.WATCH;
}

/** Overwrite 站点经营日报 with the three readable sections. */
function writeOpsDailyReportSheet_(view) {
  view = view || {};
  var sheet = ensureSheet_(SHEET_NAMES.OPS_DAILY_REPORT, ['站点经营日报']);
  sheet.clearContents();

  var counts = view.counts || emptyOpsStatusCounts_();
  var actions = view.actions || [];
  var siteRows = view.siteRows || [];
  var values = [];

  values.push(['站点经营日报']);
  values.push([]);
  values.push(['【今日概况】']);
  values.push(['报告日期', view.reportDate || '']);
  values.push(['Active 站点数', siteRows.length]);
  values.push(['增长站数量', counts[OPS_STATUS.GROWTH] || 0]);
  values.push(['稳定站数量', counts[OPS_STATUS.STABLE] || 0]);
  values.push(['衰退站数量', counts[OPS_STATUS.DECLINE] || 0]);
  values.push(['暂停投入数量', counts[OPS_STATUS.PAUSE] || 0]);
  values.push(['今日建议执行数量', actions.length]);
  values.push(['GSC 数据截止日期', view.gscCutoff || '']);
  values.push([]);
  values.push(['【今日建议执行】']);
  values.push(OPS_DAILY_ACTION_HEADERS.slice());
  if (!actions.length) {
    values.push(['—', '—', '今日无建议执行', '—', '证据不足或不需要立即动作', '—']);
  } else {
    for (var a = 0; a < actions.length; a++) {
      values.push([
        actions[a].priority,
        actions[a].site,
        actions[a].action,
        actions[a].target,
        actions[a].whyNow,
        actions[a].evidence
      ]);
    }
  }
  values.push([]);
  values.push(['【全站概况】']);
  values.push(OPS_DAILY_SITE_HEADERS.slice());
  for (var s = 0; s < siteRows.length; s++) {
    values.push([
      siteRows[s].site,
      siteRows[s].gameStage,
      siteRows[s].opsStatus,
      siteRows[s].trend7d,
      siteRows[s].clicks,
      siteRows[s].impressions,
      siteRows[s].avgPosition,
      siteRows[s].mainChange,
      siteRows[s].judgment
    ]);
  }

  var width = 1;
  for (var r = 0; r < values.length; r++) {
    if (values[r].length > width) width = values[r].length;
  }
  for (var p = 0; p < values.length; p++) {
    while (values[p].length < width) values[p].push('');
  }

  ensureSheetGrid_(sheet, values.length, width);
  sheet.getRange(1, 1, values.length, width).setValues(values);
  sheet.getRange(1, 1).setFontWeight('bold');
}
