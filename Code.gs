/**
 * 入口：菜单、setup、每日运行、回填、Trigger、权限测试
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('热词站监控')
    .addItem('初始化表格', 'setup')
    .addItem('立即运行一次', 'runDaily')
    .addItem('运行决策引擎', 'runDecisionEngine')
    .addItem('运行URL索引批次', 'runIndexAuditBatch')
    .addItem('回填最近14天GSC数据', 'backfill14Days')
    .addSeparator()
    .addItem('创建每日自动任务', 'createDailyTrigger')
    .addItem('删除每日自动任务', 'removeDailyTrigger')
    .addToUi();
}

/** 初始化全部工作表并预填 7 个站点 */
function setup() {
  setupSheets();
  SpreadsheetApp.getUi().alert('初始化完成。请在「站点配置」填写各站 Day0（可选），然后运行 testGscAccess / runDaily。');
}

/**
 * 一次性：把监控历史表重排为「最新在前」。
 * 不调 GSC、不写新数据、不改 Status / Trigger / Filter。
 */
function sortMonitoringSheetsNewestFirst() {
  sortMonitoringSheetsNewestFirst_();
  Logger.log('sortMonitoringSheetsNewestFirst done');
}

/**
 * 每日主流程：逐站执行 Performance / 快照，单站失败不影响其他站。
 * 不做全量 URL Inspection（由 runIndexAuditBatch 分批负责）。
 * IndexedURLCount 使用「URL索引」历史最新 Verdict 去重统计。
 * GSC 采集与排序全部成功后，再运行 Decision Engine；决策失败不回滚已采集数据。
 */
function runDaily() {
  setupSheets(); // 确保表存在，不覆盖已有数据
  var sites = getEnabledSites();
  var runDate = todayStr_();
  writeLog_('INFO', '', 'runDaily 开始，站点数量=' + sites.length);

  if (!sites.length) {
    writeLog_('INFO', '', 'runDaily 采集结束：无启用站点');
  } else {
    for (var i = 0; i < sites.length; i++) {
      try {
        processSiteDaily_(sites[i], runDate);
      } catch (e) {
        writeLog_('ERROR', sites[i].name, e.message);
        appendSnapshotRow_([
          runDate, '', sites[i].name, sites[i].propertyUrl, '',
          '', '', '', '', '', '', '', '', '',
          '', '', '', '🔴 需要检查', e.message
        ]);
      }
    }
    writeLog_('INFO', '', 'runDaily 采集结束');
  }

  // 全部 GSC 写入完成后再排序，再跑决策；决策失败不得回滚已采集数据
  sortMonitoringSheetsNewestFirst_();
  try {
    runDecisionEngine();
  } catch (e) {
    writeLog_('ERROR', '', 'Decision Engine 失败: ' + e.message);
    Logger.log('DECISION_ENGINE_FAILED | ' + e.message);
  }
  sortSheetsNewestFirst_([SHEET_NAMES.LOG]);
}

/**
 * URL Inspection 批次：每天可多次触发。
 * 同一天内按 INDEX_AUDIT_CURSOR 推进，每批最多 INDEX_AUDIT_BATCH_SIZE 个站。
 * 同一站同一天最多完整 Inspection 一次；全部完成后再次调用直接 return。
 */
function runIndexAuditBatch() {
  setupSheets();
  var sites = getEnabledSites();
  var runDate = todayStr_();
  var total = sites.length;

  if (!total) {
    writeLog_('INFO', '', 'runIndexAuditBatch 结束：无启用站点');
    sortSheetsNewestFirst_([SHEET_NAMES.URL_INDEX, SHEET_NAMES.LOG]);
    return;
  }

  ensureIndexAuditDay_(runDate);
  var cursor = getIndexAuditCursor_();

  if (cursor >= total) {
    writeLog_('INFO', '', '今日URL索引轮询已全部完成 ' + total + '/' + total);
    sortSheetsNewestFirst_([SHEET_NAMES.URL_INDEX, SHEET_NAMES.LOG]);
    return;
  }

  writeLog_(
    'INFO',
    '',
    'runIndexAuditBatch 开始 cursor=' + cursor + '/' + total +
      ' batchSize=' + INDEX_AUDIT_BATCH_SIZE
  );

  var processed = 0;
  while (processed < INDEX_AUDIT_BATCH_SIZE && cursor < total) {
    var site = sites[cursor];
    try {
      processSiteUrlInspection_(site, runDate);
      cursor += 1;
      setIndexAuditCursor_(cursor);
      processed += 1;
      writeLog_('INFO', '', 'URL索引进度 ' + cursor + '/' + total);
    } catch (e) {
      writeLog_('ERROR', site.name, 'URL索引批次失败（未推进cursor）: ' + e.message);
      // 成功完成一个站后才推进 cursor；失败则下次同站重试
      sortSheetsNewestFirst_([SHEET_NAMES.URL_INDEX, SHEET_NAMES.LOG]);
      return;
    }
  }

  if (cursor >= total) {
    writeLog_('INFO', '', '今日URL索引轮询已全部完成 ' + total + '/' + total);
  } else {
    writeLog_('INFO', '', 'runIndexAuditBatch 结束，今日进度 ' + cursor + '/' + total);
  }
  sortSheetsNewestFirst_([SHEET_NAMES.URL_INDEX, SHEET_NAMES.LOG]);
}

function ensureIndexAuditDay_(today) {
  var props = PropertiesService.getScriptProperties();
  var auditDate = props.getProperty('INDEX_AUDIT_DATE');
  if (auditDate !== today) {
    props.setProperty('INDEX_AUDIT_DATE', today);
    props.setProperty('INDEX_AUDIT_CURSOR', '0');
  }
}

function getIndexAuditCursor_() {
  var raw = PropertiesService.getScriptProperties().getProperty('INDEX_AUDIT_CURSOR');
  var n = parseInt(raw, 10);
  if (isNaN(n) || n < 0) return 0;
  return n;
}

function setIndexAuditCursor_(n) {
  PropertiesService.getScriptProperties().setProperty('INDEX_AUDIT_CURSOR', String(n));
}

/**
 * 单站完整 sitemap URL Inspection；写入「URL索引」历史。
 * @param {Object} site
 * @param {string} runDate
 */
function processSiteUrlInspection_(site, runDate) {
  var propertyUrl = site.propertyUrl;
  var siteName = site.name;
  var sitemapUrls = fetchSitemapUrls(site.sitemapUrl);
  var indexedCount = 0;
  var errors = [];

  for (var u = 0; u < sitemapUrls.length; u++) {
    var pageUrl = sitemapUrls[u];
    var insp = inspectUrl(pageUrl, propertyUrl);
    if (!insp.ok) {
      appendUrlIndexRow_([
        runDate, siteName, pageUrl, '', '', '', '', '', '', '', '', '', insp.error
      ]);
      errors.push('Inspection ' + pageUrl + ': ' + insp.error);
      continue;
    }
    var st = extractIndexStatus_(insp.data);
    if (st.verdict === 'PASS') indexedCount++;
    appendUrlIndexRow_([
      runDate, siteName, pageUrl,
      st.verdict, st.coverageState, st.robotsTxtState, st.indexingState,
      st.lastCrawlTime, st.pageFetchState, st.googleCanonical, st.userCanonical,
      st.crawledAs, ''
    ]);
  }

  writeLog_(
    errors.length ? 'WARN' : 'INFO',
    siteName,
    'URL索引轮询完成：\n' +
      siteName +
      '\n' +
      sitemapUrls.length +
      ' URLs\nindexed=' +
      indexedCount +
      (errors.length ? '\npartialErrors=' + errors.length : '')
  );
}

/**
 * @param {Object} site
 * @param {string} runDate
 */
function processSiteDaily_(site, runDate) {
  var errors = [];
  var propertyUrl = site.propertyUrl;
  var siteName = site.name;

  // 1) 最新有数据日期
  var latestDate = '';
  try {
    latestDate = findLatestGscDataDate(propertyUrl, LOOKBACK_DAYS_FOR_LATEST);
  } catch (e) {
    errors.push('GSC最新日期: ' + e.message);
  }

  // 2) Sitemap 计数（不在此做 URL Inspection）
  var sitemapCount = 0;
  try {
    var sitemapUrls = fetchSitemapUrls(site.sitemapUrl);
    sitemapCount = sitemapUrls.length;
  } catch (e) {
    errors.push('Sitemap: ' + e.message);
    writeLog_('ERROR', siteName, 'Sitemap 失败: ' + e.message);
  }

  // 3) IndexedURLCount：按 URL 最新 Verdict 去重统计（来自历史「URL索引」）
  var indexedCount = '';
  var indexRate = '';
  var known = getLatestKnownIndexStats_(siteName);
  if (known) {
    indexedCount = known.indexedCount;
    indexRate = sitemapCount > 0 ? percent_(indexedCount, sitemapCount) : '';
  }

  // 4) Search Analytics（依赖 latestDate）
  var totals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  var queryRows = [];
  var pageRows = [];
  var topQueries = '';
  var topPages = '';
  var returnedQueryCount = 0;
  var newQueriesText = '';

  if (latestDate) {
    try {
      totals = fetchSiteTotals(propertyUrl, latestDate);
    } catch (e) {
      errors.push('Totals: ' + e.message);
    }

    try {
      queryRows = fetchQueries(propertyUrl, latestDate, QUERY_ROW_LIMIT);
      returnedQueryCount = queryRows.length;
      topQueries = formatTopList_(queryRows, 'query', TOP_N);
    } catch (e) {
      errors.push('Queries: ' + e.message);
    }

    try {
      pageRows = fetchPages(propertyUrl, latestDate, QUERY_ROW_LIMIT);
      topPages = formatTopList_(pageRows, 'page', TOP_N);
    } catch (e) {
      errors.push('Pages: ' + e.message);
    }

    // 写入 GSC日数据（finalized 口径，幂等）
    try {
      upsertDailyRow_([
        latestDate, siteName,
        totals.clicks, totals.impressions, totals.ctr, totals.position,
        returnedQueryCount, topQueries, topPages
      ]);
    } catch (e) {
      errors.push('写GSC日数据: ' + e.message);
    }

    // NewQueries：对比前一个有数据日期
    try {
      newQueriesText = computeNewQueries_(siteName, latestDate, queryRows);
    } catch (e) {
      errors.push('NewQueries: ' + e.message);
    }
  }
  // latestDate 为空：API 成功但近期无 Performance 数据，属正常等待状态，不计入 error

  // 4b) Fresh Query明细（dataState=all，独立于 finalized 日数据）
  try {
    syncFreshQueryDetails_(siteName, propertyUrl, runDate);
  } catch (e) {
    errors.push('FreshQueries: ' + e.message);
  }

  // 4c) Fresh Query×Page → Query页面明细（增强层；失败不阻断主流程 / Status）
  try {
    syncFreshQueryPageDetails_(siteName, propertyUrl, runDate);
  } catch (e) {
    writeLog_('WARN', siteName, 'QUERY_PAGE_FAILED | ' + e.message);
  }

  // 5) FirstImpressionDate
  var firstImpression = getKnownFirstImpressionDate_(siteName);
  if (!firstImpression && site.day0 && latestDate && site.day0 <= latestDate) {
    try {
      firstImpression = findFirstImpressionDate(propertyUrl, site.day0, latestDate);
    } catch (e) {
      errors.push('FirstImpression: ' + e.message);
    }
  }

  var dayNum = calcDayNumber_(site.day0, latestDate || runDate);
  var status = computeStatus_({
    sitemapCount: sitemapCount,
    indexedCount: indexedCount,
    impressions: totals.impressions || 0,
    newQueries: newQueriesText,
    hasError: errors.length > 0
  });

  appendSnapshotRow_([
    runDate,
    latestDate || '',
    siteName,
    propertyUrl,
    dayNum === '' ? '' : dayNum,
    sitemapCount,
    indexedCount === '' ? '' : indexedCount,
    indexRate === '' ? '' : indexRate,
    totals.impressions || 0,
    totals.clicks || 0,
    totals.ctr || 0,
    totals.position || 0,
    returnedQueryCount,
    firstImpression || '',
    topQueries,
    topPages,
    newQueriesText,
    status,
    errors.join(' | ')
  ]);

  writeLog_(
    errors.length ? 'WARN' : 'INFO',
    siteName,
    '完成 latest=' + (latestDate || '无') +
      ' sitemap=' + sitemapCount +
      ' indexed=' + (indexedCount === '' ? '无历史' : indexedCount) +
      (errors.length ? ' errors=' + errors.length : '')
  );
}

/**
 * 写入/更新近 FRESH_QUERY_DAYS 天的 Fresh Query 明细（upsert：Site+DataDate+Query）
 */
function syncFreshQueryDetails_(siteName, propertyUrl, runDate) {
  var range = getFreshQueryDateRange_(runDate);
  var batches = fetchFreshQueriesForRange(
    propertyUrl,
    range.startDate,
    range.endDate,
    QUERY_ROW_LIMIT
  );

  var written = 0;
  for (var bi = 0; bi < batches.length; bi++) {
    var dataDate = batches[bi].dataDate;
    var rows = batches[bi].rows || [];
    for (var qi = 0; qi < rows.length; qi++) {
      var qr = rows[qi];
      var qName = (qr.keys && qr.keys[0]) || '';
      if (!qName) continue;
      upsertQueryRow_([
        dataDate, siteName, qName,
        qr.clicks || 0, qr.impressions || 0, qr.ctr || 0, qr.position || 0
      ]);
      written++;
    }
  }

  writeLog_(
    'INFO',
    siteName,
    'Fresh Query明细 upsert ' + written + ' 条（' + range.startDate + '~' + range.endDate + ', dataState=all）'
  );
}

/**
 * 写入/更新近 FRESH_QUERY_DAYS 天的 Fresh Query×Page（upsert：DataDate+Site+Query+PageURL）。
 * 0 rows 为正常状态（该日暂无联合维度数据），不记 ERROR。
 * 使用 QUERY_ROW_LIMIT=1000：Query×Page 行数可能多于 Query 单维，小站阶段够用，不保证长期完整。
 */
function syncFreshQueryPageDetails_(siteName, propertyUrl, runDate) {
  var range = getFreshQueryDateRange_(runDate);
  var dates = listDatesInclusive_(range.startDate, range.endDate);
  var written = 0;

  for (var di = 0; di < dates.length; di++) {
    var dataDate = dates[di];
    var rows = fetchFreshQueryPages(propertyUrl, dataDate, QUERY_ROW_LIMIT);
    // Rows=0：正常结束该日，不写错误
    for (var qi = 0; qi < rows.length; qi++) {
      var qr = rows[qi];
      if (!qr || !qr.query || !qr.page) continue;
      upsertQueryPageRow_([
        dataDate,
        siteName,
        qr.query,
        qr.page,
        pagePathFromUrl_(qr.page),
        qr.clicks || 0,
        qr.impressions || 0,
        qr.ctr || 0,
        qr.position || 0
      ]);
      written++;
    }
  }

  writeLog_(
    'INFO',
    siteName,
    'Fresh Query页面明细 upsert ' + written + ' 条（' +
      range.startDate + '~' + range.endDate +
      ', dataState=all, rowLimit=' + QUERY_ROW_LIMIT + '）'
  );
}

function computeNewQueries_(siteName, latestDate, queryRows) {
  var prevDate = getPreviousDataDate_(siteName, latestDate);
  if (!prevDate) return '';

  var prevMap = getSavedQueriesForDate_(siteName, prevDate);
  // 若历史尚未写入 prevDate 的 query（例如刚回填 totals 但还没 query），则无法对比
  var hasPrev = false;
  for (var k in prevMap) {
    if (prevMap.hasOwnProperty(k)) {
      hasPrev = true;
      break;
    }
  }
  if (!hasPrev) return '';

  var news = [];
  for (var i = 0; i < queryRows.length; i++) {
    var q = (queryRows[i].keys && queryRows[i].keys[0]) || '';
    if (!q) continue;
    if (!prevMap[q]) news.push(q);
    if (news.length >= NEW_QUERIES_MAX) break;
  }
  return news.join(' | ');
}

function computeStatus_(opts) {
  if (opts.hasError) return '🔴 需要检查';
  if (opts.newQueries) return '🔥 出现新Query';
  if (opts.impressions > 0) return '🟢 已有曝光';
  if (opts.indexedCount > 0 && opts.impressions === 0) return '🟡 已索引/等待曝光';
  if (opts.sitemapCount > 0 && opts.indexedCount === 0) return '⚪ 等待索引';
  return '⚪ 等待索引';
}

/**
 * 回填最近 14 天：写入 GSC日数据 + Query明细（幂等）
 * 不做 sitemap / URL Inspection
 */
function backfill14Days() {
  setupSheets();
  var sites = getEnabledSites();
  var endDate = todayStr_();
  var startDate = daysAgoStr_(BACKFILL_DAYS - 1);
  writeLog_('INFO', '', 'backfill14Days 开始 ' + startDate + ' ~ ' + endDate);

  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    try {
      backfillSite_(site, startDate, endDate);
    } catch (e) {
      writeLog_('ERROR', site.name, '回填失败: ' + e.message);
    }
  }

  writeLog_('INFO', '', 'backfill14Days 结束');
  sortMonitoringSheetsNewestFirst_();
  SpreadsheetApp.getUi().alert('回填完成。请查看「GSC日数据」和「Query明细」。');
}

function backfillSite_(site, startDate, endDate) {
  var dateRows = fetchDateRows(site.propertyUrl, startDate, endDate);
  writeLog_('INFO', site.name, '回填可用日期数=' + dateRows.length);

  var freshStart = getFreshQueryDateRange_(endDate).startDate;

  for (var i = 0; i < dateRows.length; i++) {
    var dataDate = dateRows[i].keys && dateRows[i].keys[0];
    if (!dataDate) continue;

    var totals;
    try {
      totals = fetchSiteTotals(site.propertyUrl, dataDate);
    } catch (e) {
      writeLog_('WARN', site.name, dataDate + ' totals失败: ' + e.message);
      continue;
    }

    var queryRows = [];
    var pageRows = [];
    try {
      queryRows = fetchQueries(site.propertyUrl, dataDate, QUERY_ROW_LIMIT);
    } catch (e) {
      writeLog_('WARN', site.name, dataDate + ' queries失败: ' + e.message);
    }
    try {
      pageRows = fetchPages(site.propertyUrl, dataDate, QUERY_ROW_LIMIT);
    } catch (e) {
      writeLog_('WARN', site.name, dataDate + ' pages失败: ' + e.message);
    }

    var topQueries = formatTopList_(queryRows, 'query', TOP_N);
    var topPages = formatTopList_(pageRows, 'page', TOP_N);

    upsertDailyRow_([
      dataDate, site.name,
      totals.clicks, totals.impressions, totals.ctr, totals.position,
      queryRows.length, topQueries, topPages
    ]);

    // 近 FRESH_QUERY_DAYS 天由 syncFreshQueryDetails_ 写入；更早日期用 finalized
    if (dataDate < freshStart) {
      for (var qi = 0; qi < queryRows.length; qi++) {
        var qr = queryRows[qi];
        upsertQueryRow_([
          dataDate, site.name, (qr.keys && qr.keys[0]) || '',
          qr.clicks || 0, qr.impressions || 0, qr.ctr || 0, qr.position || 0
        ]);
      }
    }
  }

  try {
    syncFreshQueryDetails_(site.name, site.propertyUrl, endDate);
  } catch (e) {
    writeLog_('WARN', site.name, '回填 Fresh Query 失败: ' + e.message);
  }
}

/**
 * 幂等创建自动任务：
 * - runDaily：每天 1 个（约早上 8 点）
 * - runIndexAuditBatch：每天 4 个（上午/中午/下午/晚上）
 * 重复执行不会重复创建。
 */
function createDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var runDailyTriggers = [];
  var indexAuditTriggers = [];

  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'runDaily') runDailyTriggers.push(triggers[i]);
    if (fn === 'runIndexAuditBatch') indexAuditTriggers.push(triggers[i]);
  }

  var messages = [];

  // 保证恰好 1 个 runDaily
  if (runDailyTriggers.length === 0) {
    ScriptApp.newTrigger('runDaily')
      .timeBased()
      .atHour(8)
      .everyDays(1)
      .inTimezone('Asia/Shanghai')
      .create();
    messages.push('已创建 runDaily（约早上 8 点）');
  } else {
    for (var d = 1; d < runDailyTriggers.length; d++) {
      ScriptApp.deleteTrigger(runDailyTriggers[d]);
    }
    messages.push('runDaily 已存在，未重复创建');
  }

  // 保证恰好 4 个 runIndexAuditBatch
  if (indexAuditTriggers.length === INDEX_AUDIT_TRIGGER_HOURS.length) {
    messages.push('runIndexAuditBatch×4 已存在，未重复创建');
  } else {
    for (var a = 0; a < indexAuditTriggers.length; a++) {
      ScriptApp.deleteTrigger(indexAuditTriggers[a]);
    }
    for (var h = 0; h < INDEX_AUDIT_TRIGGER_HOURS.length; h++) {
      ScriptApp.newTrigger('runIndexAuditBatch')
        .timeBased()
        .atHour(INDEX_AUDIT_TRIGGER_HOURS[h])
        .everyDays(1)
        .inTimezone('Asia/Shanghai')
        .create();
    }
    messages.push(
      '已创建 runIndexAuditBatch×4（约 ' +
        INDEX_AUDIT_TRIGGER_HOURS.join('/') +
        ' 点）'
    );
  }

  SpreadsheetApp.getUi().alert(messages.join('\n') + '\n时区 Asia/Shanghai');
}

/** 删除 runDaily 与 runIndexAuditBatch 的全部 trigger */
function removeDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var removedDaily = 0;
  var removedAudit = 0;
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'runDaily') {
      ScriptApp.deleteTrigger(triggers[i]);
      removedDaily++;
    } else if (fn === 'runIndexAuditBatch') {
      ScriptApp.deleteTrigger(triggers[i]);
      removedAudit++;
    }
  }
  if (!removedDaily && !removedAudit) {
    SpreadsheetApp.getUi().alert('没有找到相关自动任务。');
    return;
  }
  SpreadsheetApp.getUi().alert(
    '已删除：runDaily×' + removedDaily + '，runIndexAuditBatch×' + removedAudit
  );
}

/**
 * Phase 1 探测：只读拉取 Leafy Corner 近 FRESH_QUERY_DAYS 天的 Fresh Query×Page。
 * 不写 Sheet、不调 runDaily、不做 URL Inspection。
 * 结果仅 Logger.log，请在 Apps Script「执行记录」中查看。
 */
function debugLeafyCornerQueryPages() {
  var sites = getEnabledSites();
  var site = null;
  for (var i = 0; i < sites.length; i++) {
    if (sites[i].name === 'Leafy Corner') {
      site = sites[i];
      break;
    }
  }
  if (!site) {
    throw new Error('Leafy Corner not found in enabled sites');
  }

  var range = getFreshQueryDateRange_(todayStr_());
  var dates = listDatesInclusive_(range.startDate, range.endDate);
  var logLimit = 50;

  Logger.log(
    'QUERY_PAGE_DEBUG start Site=' +
      site.name +
      ' PropertyURL=' +
      site.propertyUrl +
      ' FreshRange=' +
      range.startDate +
      '~' +
      range.endDate +
      ' days=' +
      dates.length
  );

  for (var d = 0; d < dates.length; d++) {
    var dataDate = dates[d];
    var rows = fetchFreshQueryPages(site.propertyUrl, dataDate, QUERY_ROW_LIMIT);
    var sorted = rows.slice().sort(function (a, b) {
      var impDiff = (b.impressions || 0) - (a.impressions || 0);
      if (impDiff !== 0) return impDiff;
      var clickDiff = (b.clicks || 0) - (a.clicks || 0);
      if (clickDiff !== 0) return clickDiff;
      return (a.position || 0) - (b.position || 0);
    });

    var logged = Math.min(logLimit, sorted.length);
    Logger.log(
      'QUERY_PAGE_DEBUG Site=' +
        site.name +
        ' DataDate=' +
        dataDate +
        ' Rows=' +
        rows.length +
        ' Logged=' +
        logged
    );

    for (var r = 0; r < logged; r++) {
      var row = sorted[r];
      Logger.log(
        'QUERY_PAGE_ROW | ' +
          dataDate +
          ' | ' +
          site.name +
          ' | ' +
          row.query +
          ' | ' +
          row.page +
          ' | clicks=' +
          row.clicks +
          ' | impressions=' +
          row.impressions +
          ' | ctr=' +
          row.ctr +
          ' | position=' +
          row.position
      );
    }
  }

  Logger.log('QUERY_PAGE_DEBUG end Site=' + site.name);
}

/**
 * 测试当前账号对 Search Console 的访问权限
 * 只读 Sites.list，不修改任何数据
 */
function testGscAccess() {
  var expected = DEFAULT_SITES.map(function (s) {
    return ensureTrailingSlash_(s.propertyUrl);
  });

  var accessible;
  try {
    accessible = listGscSites();
  } catch (e) {
    Logger.log('FAIL: 无法调用 Sites.list');
    Logger.log(e.message);
    SpreadsheetApp.getUi().alert('测试失败：' + e.message + '\n请查看「执行记录 / Logger」。');
    return;
  }

  Logger.log('=== 当前账号可访问的 GSC Property ===');
  for (var i = 0; i < accessible.length; i++) {
    Logger.log('- ' + accessible[i]);
  }

  // 归一化比较：去掉末尾斜杠再比，也接受带斜杠版本
  var accessSet = {};
  for (var a = 0; a < accessible.length; a++) {
    var u = String(accessible[a] || '');
    accessSet[u] = true;
    accessSet[ensureTrailingSlash_(u)] = true;
    if (u.charAt(u.length - 1) === '/') {
      accessSet[u.substring(0, u.length - 1)] = true;
    }
  }

  var missing = [];
  for (var e = 0; e < expected.length; e++) {
    var want = expected[e];
    var wantNoSlash = want.charAt(want.length - 1) === '/' ? want.substring(0, want.length - 1) : want;
    if (!accessSet[want] && !accessSet[wantNoSlash]) {
      missing.push(want);
    }
  }

  var okCount = expected.length - missing.length;
  Logger.log('');
  if (missing.length === 0) {
    Logger.log('PASS:');
    Logger.log(okCount + '/' + expected.length + ' GSC properties accessible');
  } else {
    Logger.log('FAIL:');
    Logger.log(okCount + '/' + expected.length);
    Logger.log('Missing:');
    for (var m = 0; m < missing.length; m++) {
      Logger.log(missing[m]);
    }
  }

  SpreadsheetApp.getUi().alert(
    (missing.length === 0 ? 'PASS: ' : 'FAIL: ') +
      okCount + '/' + expected.length +
      ' GSC properties accessible' +
      (missing.length ? '\n\nMissing:\n' + missing.join('\n') : '') +
      '\n\n详情见「执行」→「执行记录」中的日志。'
  );
}

/** 一次性诊断/修复：重置 active sheet 上下文，排查 Sheet 0 not found */
function repairSpreadsheetContext() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheets = ss.getSheets();
  if (!sheets || sheets.length === 0) {
    throw new Error('Spreadsheet has no sheets');
  }

  Logger.log(
    '当前Sheets: ' +
      sheets
        .map(function (s) {
          return s.getName() + ' [gid=' + s.getSheetId() + ']';
        })
        .join(' | ')
  );

  // 强制把一个真实存在的Sheet设为active，
  // 避免之前删除默认Sheet1后残留无效active-sheet上下文
  ss.setActiveSheet(sheets[0]);
  sheets[0].getRange('A1').activate();
  SpreadsheetApp.flush();

  Logger.log(
    '修复后Active Sheet: ' +
      ss.getActiveSheet().getName() +
      ' [gid=' +
      ss.getActiveSheet().getSheetId() +
      ']'
  );

  var testSheet = ss.getSheetByName('站点配置');

  Logger.log(
    'getSheetByName测试: ' + (testSheet ? testSheet.getName() : 'null')
  );
}
