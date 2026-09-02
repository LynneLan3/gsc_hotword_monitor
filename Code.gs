/**
 * 入口：菜单、setup、每日运行、回填、Trigger、权限测试
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('热词站监控')
    .addItem('初始化表格', 'setup')
    .addItem('整理工作表视图', 'organizeSheetUi')
    .addItem('立即运行一次', 'runDaily')
    .addItem('重试每日后处理', 'runDailyFinalizer')
    .addItem('运行决策引擎', 'runDecisionEngine')
    .addItem('重建站点经营', 'runPortfolioEngine')
    .addItem('重建内容资产候选', 'runWinnerAssetEngine')
    .addItem('处理内容资产决定', 'processWinnerAssetDecisions')
    .addItem('同步内容资产研究结果', 'syncWinnerAssetResearchResults')
    .addItem('观察决策结果', 'runDecisionOutcomeObservation')
    .addItem('同步人工决策', 'syncHumanDecisions')
    .addItem('记录内容更新', 'recordContentInterventionMenu')
    .addItem('重建反馈样本', 'rebuildFeedbackSamples')
    .addItem('重建规则评分卡', 'rebuildRuleScorecard')
    .addItem('重建评价资格', 'rebuildEvaluationEligibility')
    .addItem('重建效果变化', 'rebuildOutcomeDelta')
    .addItem('重建效果评价', 'rebuildEffectEvaluation')
    .addItem('运行内容机会引擎', 'runContentOpportunityEngine')
    .addItem('刷新需求雷达', 'refreshDemandRadar')
    .addItem('运行实时Query监控', 'runFreshQueryMonitor')
    .addItem('创建需求发现任务', 'createDemandDiscoveryJobs')
    .addItem('创建每日 GAME_WIDE 发现任务', 'enqueueDailyGameWideDiscovery')
    .addItem('创建搜索需求任务', 'createSearchDemandJobs')
    .addItem('创建研究任务', 'createResearchJobs')
    .addItem('重置并创建研究任务', 'resetAndCreateResearchJobs')
    .addItem('处理研究审核决定', 'processResearchReviewDecisions')
    .addItem('创建开发任务', 'createDevelopmentTasks')
    .addItem('运行URL索引批次', 'runIndexAuditBatch')
    .addItem('回填最近14天GSC数据', 'backfill14Days')
    .addItem('补采14天Query页面明细', 'backfillQueryPageDetails14Days')
    .addItem('补采14天Page明细', 'backfillPageDetails14Days')
    .addSeparator()
    .addItem('测试GSC权限', 'testGscAccess')
    .addItem('运行自测', 'runSelfTests')
    .addItem('创建每日自动任务', 'createDailyTrigger')
    .addItem('删除每日自动任务', 'removeDailyTrigger')
    .addToUi();
}


/** 初始化全部工作表；DEFAULT_SITES 仅在「站点配置」为空时预填，不覆盖已有行 */
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
 * 采集可能分批续跑（时间预算）；全部站点采集完成后，再运行 Decision / Opportunity / Demand Radar。
 * 决策/机会/雷达失败不回滚已采集数据。
 * GSC Property URL 每次都从当前「站点配置」读取，不从历史快照或默认配置恢复。
 */
function runDaily() {
  return runDailyWithLock_(false);
}

/** 分批续跑入口：不重置当日进度，不创建新的每日 trigger。 */
function runDailyContinuation_() {
  deleteDailyContinuationTriggers_();
  return runDailyWithLock_(true);
}

function runDailyWithLock_(isContinuation) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    var skipMsg = isContinuation
      ? 'runDaily 续跑跳过：已有实例在运行（LockService）'
      : 'runDaily 跳过：已有实例在运行（LockService）';
    writeLog_('WARN', '', skipMsg);
    Logger.log(isContinuation ? 'runDaily continuation skipped: lock busy' : 'runDaily skipped: lock busy');
    if (isContinuation) {
      scheduleDailyContinuation_();
    }
    return isContinuation
      ? 'runDaily continuation skipped: lock busy'
      : 'runDaily skipped: lock busy';
  }

  try {
    return runDailyUnlocked_(!!isContinuation);
  } finally {
    lock.releaseLock();
  }
}

/** runDaily 主体（已持锁） */
function runDailyUnlocked_(isContinuation) {
  var startedAt = Date.now();
  isContinuation = !!isContinuation;
  assertRuntimePrerequisites_();

  var sites = getEnabledSites();
  var runDate = todayStr_();
  ensureDailyRunDay_(runDate, isContinuation);

  var phase = getDailyRunPhase_();
  var doneNames = getDailyDoneSiteNames_();
  var pending = nextDailyPendingSites_(sites, doneNames);

  writeLog_(
    'INFO',
    '',
    'runDaily 开始，站点数量=' +
      sites.length +
      ' runDate=' +
      runDate +
      ' gscToday=' +
      gscTodayStr_() +
      ' (' +
      GSC_TIMEZONE +
      ')' +
      ' phase=' +
      phase +
      ' continuation=' +
      (isContinuation ? 'yes' : 'no') +
      ' done=' +
      doneNames.length +
      ' pending=' +
      pending.length +
      ' sites=' +
      formatDailySiteList_(sites)
  );

  var processedThisRun = 0;

  if (phase === 'collect') {
    if (!sites.length) {
      writeLog_('INFO', '', 'runDaily 采集结束：无启用站点');
      setDailyRunPhase_('engines');
      phase = 'engines';
    } else {
      for (var i = 0; i < sites.length; i++) {
        var site = sites[i];
        if (doneNames.indexOf(site.name) >= 0) continue;
        if (shouldPauseDailyRun_(processedThisRun, startedAt)) {
          scheduleDailyContinuation_();
          var pauseMsg =
            'runDaily 分批暂停 ' +
            doneNames.length +
            '/' +
            sites.length +
            ' 待续=' +
            formatDailySiteList_(nextDailyPendingSites_(sites, doneNames));
          writeLog_('INFO', '', pauseMsg);
          Logger.log(pauseMsg);
          return pauseMsg;
        }
        try {
          processSiteDaily_(site, runDate);
        } catch (e) {
          var errMsg = String(e.message || e);
          writeLog_('ERROR', site.name, errMsg);
          appendSnapshotRow_([
            runDate, '', site.name, site.propertyUrl, '',
            '', '', '', '', '', '', '', '', '',
            '', '', '', '🔴 需要检查', errMsg
          ]);
        }
        markDailySiteDone_(site.name);
        doneNames.push(site.name);
        processedThisRun += 1;
      }
      writeLog_('INFO', '', 'runDaily 采集结束');
      setDailyRunPhase_('engines');
      phase = 'engines';
    }
  }

  if (phase === 'engines') {
    if (shouldPauseDailyRun_(processedThisRun, startedAt)) {
      scheduleDailyContinuation_();
      var enginePause = 'runDaily 分批暂停，待跑 Decision/Opportunity 引擎';
      writeLog_('INFO', '', enginePause);
      Logger.log(enginePause);
      return enginePause;
    }
    return runDailyFinalizerUnlocked_(sites, runDate);
  }

  var summary =
    'runDaily done sites=' + sites.length + ' runDate=' + runDate;
  Logger.log(summary);
  return summary;
}

/**
 * 单独重试采集之后的排序 / Decision / Opportunity / Demand Radar。
 * 不重置分批采集进度，不重跑已完成站点。
 */
function runDailyFinalizer() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    writeLog_('WARN', '', 'runDailyFinalizer 跳过：已有实例在运行（LockService）');
    Logger.log('runDailyFinalizer skipped: lock busy');
    return 'runDailyFinalizer skipped: lock busy';
  }
  try {
    assertRuntimePrerequisites_();
    var sites = getEnabledSites();
    var runDate = todayStr_();
    return runDailyFinalizerUnlocked_(sites, runDate);
  } finally {
    lock.releaseLock();
  }
}

function runDailyFinalizerUnlocked_(sites, runDate) {
  try {
    sortMonitoringSheetsNewestFirst_();
    runDecisionEngine();
    runContentOpportunityEngine();
    refreshDemandRadar_(sites, runDate);
    enqueueDailyGameWideDiscovery_(sites, runDate);
    refreshUnifiedActionQueue_(runDate);
    syncDevelopmentTasksFromApprovedDecisions();
    refreshImplementationHandoffs_();
    try {
      maintainExperimentLedger_();
      // Receipt observations run after all GSC collection and reuse this
      // daily lock; no second daily trigger is created.
      runInterventionObservationsUnlocked_();
    } catch (ledgerError) {
      var ledgerDetail = formatErrorWithStack_(ledgerError);
      writeLog_('WARN', '', 'EXPERIMENT_LEDGER_MAINTENANCE_FAILED | ' + ledgerDetail);
      Logger.log('EXPERIMENT_LEDGER_MAINTENANCE_FAILED | ' + ledgerDetail);
    }
    sortSheetsNewestFirst_([SHEET_NAMES.LOG]);
    setDailyRunPhase_('done');
    deleteDailyContinuationTriggers_();
    var summary =
      'runDaily done sites=' + (sites ? sites.length : 0) + ' runDate=' + runDate;
    writeLog_('INFO', '', summary);
    Logger.log(summary);
    return summary;
  } catch (e) {
    var detail = formatErrorWithStack_(e);
    writeLog_('ERROR', '', 'DAILY_FINALIZER_FAILED | ' + detail);
    Logger.log('DAILY_FINALIZER_FAILED | ' + detail);
    Logger.log('DECISION_ENGINE_FAILED | ' + detail);
    throw e;
  }
}

function nextDailyPendingSites_(sites, doneNames) {
  var pending = [];
  var done = doneNames || [];
  for (var i = 0; i < (sites || []).length; i++) {
    if (done.indexOf(sites[i].name) < 0) pending.push(sites[i]);
  }
  return pending;
}

function formatDailySiteList_(sites) {
  var parts = [];
  for (var i = 0; i < (sites || []).length; i++) {
    parts.push(sites[i].name + '|' + sites[i].propertyUrl);
  }
  return parts.join(', ');
}

function shouldPauseDailyRun_(processedThisRun, startedAt, nowMs, maxMs) {
  var now = nowMs == null ? Date.now() : nowMs;
  var limit = maxMs == null ? DAILY_RUN_MAX_MS : maxMs;
  return processedThisRun > 0 && now - startedAt > limit;
}

function ensureDailyRunDay_(today, isContinuation) {
  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty(DAILY_RUN_DATE_PROP);
  if (stored !== today) {
    props.setProperty(DAILY_RUN_DATE_PROP, today);
    props.setProperty(DAILY_DONE_SITES_PROP, '[]');
    props.setProperty(DAILY_RUN_PHASE_PROP, 'collect');
    return;
  }
  if (!isContinuation && getDailyRunPhase_() === 'done') {
    props.setProperty(DAILY_DONE_SITES_PROP, '[]');
    props.setProperty(DAILY_RUN_PHASE_PROP, 'collect');
  }
}

function getDailyRunPhase_() {
  var raw = PropertiesService.getScriptProperties().getProperty(DAILY_RUN_PHASE_PROP);
  if (raw === 'engines' || raw === 'done' || raw === 'collect') return raw;
  return 'collect';
}

function setDailyRunPhase_(phase) {
  PropertiesService.getScriptProperties().setProperty(DAILY_RUN_PHASE_PROP, phase);
}

function getDailyDoneSiteNames_() {
  var raw = PropertiesService.getScriptProperties().getProperty(DAILY_DONE_SITES_PROP);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    if (!parsed || !parsed.length) return [];
    var names = [];
    for (var i = 0; i < parsed.length; i++) {
      var name = String(parsed[i] || '').trim();
      if (name) names.push(name);
    }
    return names;
  } catch (e) {
    return [];
  }
}

function markDailySiteDone_(siteName) {
  var names = getDailyDoneSiteNames_();
  if (names.indexOf(siteName) >= 0) return;
  names.push(siteName);
  PropertiesService.getScriptProperties().setProperty(
    DAILY_DONE_SITES_PROP,
    JSON.stringify(names)
  );
}

function scheduleDailyContinuation_() {
  deleteDailyContinuationTriggers_();
  ScriptApp.newTrigger(DAILY_CONTINUE_HANDLER)
    .timeBased()
    .after(DAILY_CONTINUE_AFTER_MS)
    .create();
  writeLog_(
    'INFO',
    '',
    '已安排 runDaily 续跑 afterMs=' + DAILY_CONTINUE_AFTER_MS
  );
}

function deleteDailyContinuationTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === DAILY_CONTINUE_HANDLER) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * URL Inspection 批次：每天可多次触发。
 * 同一天内按 INDEX_AUDIT_CURSOR 推进，每批最多 INDEX_AUDIT_BATCH_SIZE 个站。
 * 同一站同一天最多完整 Inspection 一次；全部完成后再次调用直接 return。
 */
function runIndexAuditBatch() {
  assertRuntimePrerequisites_();
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
  var permissionBlocked = false;
  writeLog_('INFO', siteName, '开始采集 propertyUrl=' + propertyUrl);

  // 1) 最新有数据日期（GSC / America/Los_Angeles）
  var latestDate = '';
  try {
    latestDate = findLatestGscDataDate(propertyUrl, LOOKBACK_DAYS_FOR_LATEST);
  } catch (e) {
    if (isGscPermissionError_(e)) {
      permissionBlocked = true;
      errors.push(
        'PROPERTY_PERMISSION | siteUrl=' + propertyUrl + ' | ' + e.message
      );
      writeLog_(
        'ERROR',
        siteName,
        'PROPERTY_PERMISSION | siteUrl=' + propertyUrl + ' | ' + e.message
      );
    } else {
      errors.push('GSC最新日期: ' + e.message);
    }
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

  // 4) Search Analytics（依赖 latestDate；权限异常时跳过，保留历史）
  var totals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  var queryRows = [];
  var pageRows = [];
  var topQueries = '';
  var topPages = '';
  var returnedQueryCount = 0;
  var newQueriesText = '';

  if (latestDate && !permissionBlocked) {
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

  // 4b) Fresh Query明细（dataState=all；权限异常时跳过，绝不空写覆盖历史）
  if (!permissionBlocked) {
    try {
      syncFreshQueryDetails_(siteName, propertyUrl, runDate);
    } catch (e) {
      if (isGscPermissionError_(e)) {
        permissionBlocked = true;
        var permMsg =
          'PROPERTY_PERMISSION | siteUrl=' +
          propertyUrl +
          ' | ' +
          String(e.message || e);
        errors.push(permMsg);
        writeLog_('ERROR', siteName, permMsg);
      } else {
        errors.push('FreshQueries: ' + e.message);
      }
    }
  }

  // 4c) Fresh Query×Page → Query页面明细（增强层；失败不阻断主流程 / Status）
  if (!permissionBlocked) {
    try {
      syncFreshQueryPageDetails_(siteName, propertyUrl, runDate);
    } catch (e) {
      if (isGscPermissionError_(e)) {
        writeLog_(
          'ERROR',
          siteName,
          'QUERY_PAGE_PERMISSION | siteUrl=' + propertyUrl + ' | ' + e.message
        );
      } else {
        writeLog_('WARN', siteName, 'QUERY_PAGE_FAILED | ' + e.message);
      }
    }
  }

  // 4d) Fresh Page-only → Page明细（Winner Page 事实源；失败不阻断主流程 / Status）
  if (!permissionBlocked) {
    try {
      syncFreshPageDetails_(siteName, propertyUrl, runDate);
    } catch (e) {
      if (isGscPermissionError_(e)) {
        writeLog_(
          'ERROR',
          siteName,
          'PAGE_PERMISSION | siteUrl=' + propertyUrl + ' | ' + e.message
        );
      } else {
        writeLog_('WARN', siteName, 'PAGE_FAILED | ' + e.message);
      }
    }
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
    errors.join(' | '),
    site.siteId || ''
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
 * 写入/更新近 FRESH_QUERY_DAYS 个 GSC 日的 Fresh Query 明细（upsert：DataDate+Site+Query）。
 * - 以 API 返回有数据的日期写入，不伪造当天空数据
 * - 某日 API 返回 0 行：保留历史，不删不覆盖
 * - 重复运行幂等更新同一键
 */
function syncFreshQueryDetails_(siteName, propertyUrl, runDate) {
  var range = getFreshQueryDateRange_(runDate);
  var coverage = fetchFreshDateCoverage_(
    propertyUrl,
    range.startDate,
    range.endDate
  );
  var batches = fetchFreshQueriesForRange(
    propertyUrl,
    range.startDate,
    range.endDate,
    QUERY_ROW_LIMIT
  );

  var inserted = 0;
  var updated = 0;
  var apiRowCount = 0;
  var maxWrittenDate = '';
  var daysWithRows = 0;

  for (var bi = 0; bi < batches.length; bi++) {
    var dataDate = batches[bi].dataDate;
    var rows = batches[bi].rows || [];
    if (!rows.length) {
      // 空结果：保留历史，不写假数据
      continue;
    }
    daysWithRows++;
    for (var qi = 0; qi < rows.length; qi++) {
      var qr = rows[qi];
      var qName = (qr.keys && qr.keys[0]) || '';
      if (!qName) continue;
      apiRowCount++;
      var result = upsertQueryRow_([
        dataDate, siteName, qName,
        qr.clicks || 0, qr.impressions || 0, qr.ctr || 0, qr.position || 0
      ]);
      if (result && result.action === 'update') updated++;
      else inserted++;
      if (!maxWrittenDate || dataDate > maxWrittenDate) maxWrittenDate = dataDate;
    }
  }

  var maxDataDate = coverage.maxDataDate || maxWrittenDate;
  var inDelay = isGscDataDelayWindow_(maxDataDate, range.gscToday);
  var meta = coverage.metadata;
  var metaPart = '';
  if (meta) {
    if (meta.firstIncompleteDate) {
      metaPart += ' first_incomplete_date=' + meta.firstIncompleteDate;
    }
    if (meta.firstIncompleteHour) {
      metaPart += ' first_incomplete_hour=' + meta.firstIncompleteHour;
    }
  }

  writeLog_(
    'INFO',
    siteName,
    'Fresh Query明细 | range=' +
      range.startDate +
      '~' +
      range.endDate +
      ' | gscToday=' +
      range.gscToday +
      ' | apiMaxDataDate=' +
      (maxDataDate || '无') +
      ' | apiRows=' +
      apiRowCount +
      ' | daysWithRows=' +
      daysWithRows +
      ' | inserted=' +
      inserted +
      ' | updated=' +
      updated +
      ' | delayWindow=' +
      (inDelay ? 'yes' : 'no') +
      ' | dataState=all' +
      (metaPart || ' | incompleteMeta=none')
  );
}

/**
 * 单日 Fresh Query×Page upsert（DataDate+Site+Query+PageURL）。
 * 0 rows 为正常：不写、不删其它日期历史。
 * @return {{inserted:number, updated:number, apiRowCount:number}}
 */
function upsertQueryPageDetailsForDate_(siteName, propertyUrl, dataDate) {
  var rows = fetchFreshQueryPages(propertyUrl, dataDate, QUERY_ROW_LIMIT);
  var inserted = 0;
  var updated = 0;
  var apiRowCount = 0;
  for (var qi = 0; qi < rows.length; qi++) {
    var qr = rows[qi];
    if (!qr || !qr.query || !qr.page) continue;
    apiRowCount++;
    var result = upsertQueryPageRow_([
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
    if (result && result.action === 'update') updated++;
    else inserted++;
  }
  return { inserted: inserted, updated: updated, apiRowCount: apiRowCount };
}

/**
 * 单日 Fresh Page-only upsert（DataDate+Site+PageURL）。
 * 0 rows 为正常：不写、不删其它日期历史。
 * @return {{inserted:number, updated:number, apiRowCount:number}}
 */
function upsertPageDetailsForDate_(siteName, propertyUrl, dataDate) {
  var rows = fetchFreshPages(propertyUrl, dataDate, QUERY_ROW_LIMIT);
  var inserted = 0;
  var updated = 0;
  var apiRowCount = 0;
  for (var pi = 0; pi < rows.length; pi++) {
    var pr = rows[pi];
    if (!pr || !pr.page) continue;
    apiRowCount++;
    var result = upsertPageRow_([
      dataDate,
      siteName,
      pr.page,
      pagePathFromUrl_(pr.page),
      pr.clicks || 0,
      pr.impressions || 0,
      pr.ctr || 0,
      pr.position || 0
    ]);
    if (result && result.action === 'update') updated++;
    else inserted++;
  }
  return { inserted: inserted, updated: updated, apiRowCount: apiRowCount };
}

/**
 * 写入/更新近 FRESH_QUERY_DAYS 个 GSC 日的 Fresh Query×Page（upsert：DataDate+Site+Query+PageURL）。
 * 0 rows 为正常状态（该日暂无联合维度数据），不记 ERROR、不删历史。
 * 使用 QUERY_ROW_LIMIT=1000：Query×Page 行数可能多于 Query 单维，小站阶段够用，不保证长期完整。
 */
function syncFreshQueryPageDetails_(siteName, propertyUrl, runDate) {
  var range = getFreshQueryDateRange_(runDate);
  var dates = listDatesInclusive_(range.startDate, range.endDate);
  var inserted = 0;
  var updated = 0;
  var apiRowCount = 0;
  var maxWrittenDate = '';

  for (var di = 0; di < dates.length; di++) {
    var dataDate = dates[di];
    var dayResult = upsertQueryPageDetailsForDate_(siteName, propertyUrl, dataDate);
    inserted += dayResult.inserted;
    updated += dayResult.updated;
    apiRowCount += dayResult.apiRowCount;
    if (dayResult.apiRowCount > 0 && (!maxWrittenDate || dataDate > maxWrittenDate)) {
      maxWrittenDate = dataDate;
    }
  }

  writeLog_(
    'INFO',
    siteName,
    'Fresh Query页面明细 | range=' +
      range.startDate +
      '~' +
      range.endDate +
      ' | apiMaxDataDate=' +
      (maxWrittenDate || '无') +
      ' | apiRows=' +
      apiRowCount +
      ' | inserted=' +
      inserted +
      ' | updated=' +
      updated +
      ' | dataState=all | rowLimit=' +
      QUERY_ROW_LIMIT
  );
}

/**
 * 写入/更新近 FRESH_QUERY_DAYS 个 GSC 日的 Fresh Page-only（upsert：DataDate+Site+PageURL）。
 * 0 rows 为正常状态，不记 ERROR、不删历史。
 */
function syncFreshPageDetails_(siteName, propertyUrl, runDate) {
  var range = getFreshQueryDateRange_(runDate);
  var dates = listDatesInclusive_(range.startDate, range.endDate);
  var inserted = 0;
  var updated = 0;
  var apiRowCount = 0;
  var maxWrittenDate = '';

  for (var di = 0; di < dates.length; di++) {
    var dataDate = dates[di];
    var dayResult = upsertPageDetailsForDate_(siteName, propertyUrl, dataDate);
    inserted += dayResult.inserted;
    updated += dayResult.updated;
    apiRowCount += dayResult.apiRowCount;
    if (dayResult.apiRowCount > 0 && (!maxWrittenDate || dataDate > maxWrittenDate)) {
      maxWrittenDate = dataDate;
    }
  }

  writeLog_(
    'INFO',
    siteName,
    'Fresh Page明细 | range=' +
      range.startDate +
      '~' +
      range.endDate +
      ' | apiMaxDataDate=' +
      (maxWrittenDate || '无') +
      ' | apiRows=' +
      apiRowCount +
      ' | inserted=' +
      inserted +
      ' | updated=' +
      updated +
      ' | dataState=all | rowLimit=' +
      QUERY_ROW_LIMIT
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
 * 回填最近 14 天：写入 GSC日数据 + Query明细 + Query页面明细（幂等）
 * 不做 sitemap / URL Inspection，不跑 Decision / Portfolio
 */
function backfill14Days() {
  setupSheets();
  var sites = getEnabledSites();
  var endDate = gscTodayStr_();
  var startDate = gscDaysAgoStr_(BACKFILL_DAYS - 1);
  writeLog_(
    'INFO',
    '',
    'backfill14Days 开始 ' +
      startDate +
      ' ~ ' +
      endDate +
      ' (' +
      GSC_TIMEZONE +
      ')'
  );

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
  SpreadsheetApp.getUi().alert(
    '回填完成。请查看「GSC日数据」「Query明细」「Page明细」和「Query页面明细」。'
  );
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

  try {
    backfillQueryPageDetailsForSite_(site, startDate, endDate);
  } catch (e) {
    writeLog_('WARN', site.name, '回填 Query页面明细失败: ' + e.message);
  }

  try {
    backfillPageDetailsForSite_(site, startDate, endDate);
  } catch (e) {
    writeLog_('WARN', site.name, '回填 Page明细失败: ' + e.message);
  }
}

/**
 * 只补采 Query页面明细（最近 BACKFILL_DAYS 个 GSC 日）。
 * 不写 GSC日数据 / Query明细，不跑 Decision / Portfolio。
 */
function backfillQueryPageDetails14Days() {
  setupSheets();
  var sites = getEnabledSites();
  var endDate = gscTodayStr_();
  var startDate = gscDaysAgoStr_(BACKFILL_DAYS - 1);
  writeLog_(
    'INFO',
    '',
    'backfillQueryPageDetails14Days 开始 ' +
      startDate +
      ' ~ ' +
      endDate +
      ' (' +
      GSC_TIMEZONE +
      ')'
  );

  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    try {
      backfillQueryPageDetailsForSite_(site, startDate, endDate);
    } catch (e) {
      writeLog_('ERROR', site.name, 'Query页面明细回填失败: ' + e.message);
    }
  }

  writeLog_('INFO', '', 'backfillQueryPageDetails14Days 结束');
  sortMonitoringSheetsNewestFirst_();
  alertUi_('Query页面明细补采完成。请查看「Query页面明细」。');
}

/**
 * 在 startDate~endDate 内，按 GSC 已有数据日补采 Query×Page。
 * 单日失败记 WARN 并继续；空结果不删历史。
 */
function backfillQueryPageDetailsForSite_(site, startDate, endDate) {
  var dateRows = fetchDateRows(site.propertyUrl, startDate, endDate);
  writeLog_('INFO', site.name, 'Query页面明细回填可用日期数=' + dateRows.length);

  var inserted = 0;
  var updated = 0;
  var apiRowCount = 0;

  for (var i = 0; i < dateRows.length; i++) {
    var dataDate = dateRows[i].keys && dateRows[i].keys[0];
    if (!dataDate) continue;
    try {
      var dayResult = upsertQueryPageDetailsForDate_(
        site.name,
        site.propertyUrl,
        dataDate
      );
      inserted += dayResult.inserted;
      updated += dayResult.updated;
      apiRowCount += dayResult.apiRowCount;
    } catch (e) {
      writeLog_('WARN', site.name, dataDate + ' Query页面明细失败: ' + e.message);
    }
  }

  writeLog_(
    'INFO',
    site.name,
    'Query页面明细回填 | range=' +
      startDate +
      '~' +
      endDate +
      ' | apiRows=' +
      apiRowCount +
      ' | inserted=' +
      inserted +
      ' | updated=' +
      updated +
      ' | dataState=all | rowLimit=' +
      QUERY_ROW_LIMIT
  );
}

/**
 * 只补采 Page明细（最近 BACKFILL_DAYS 个 GSC 日）。
 * 不写 GSC日数据 / Query明细 / Query页面明细，不跑 Decision / Portfolio。
 */
function backfillPageDetails14Days() {
  setupSheets();
  var sites = getEnabledSites();
  var endDate = gscTodayStr_();
  var startDate = gscDaysAgoStr_(BACKFILL_DAYS - 1);
  writeLog_(
    'INFO',
    '',
    'backfillPageDetails14Days 开始 ' +
      startDate +
      ' ~ ' +
      endDate +
      ' (' +
      GSC_TIMEZONE +
      ')'
  );

  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    try {
      backfillPageDetailsForSite_(site, startDate, endDate);
    } catch (e) {
      writeLog_('ERROR', site.name, 'Page明细回填失败: ' + e.message);
    }
  }

  writeLog_('INFO', '', 'backfillPageDetails14Days 结束');
  sortMonitoringSheetsNewestFirst_();
  alertUi_('Page明细补采完成。请查看「Page明细」。');
}

/**
 * 在 startDate~endDate 内，按 GSC 已有数据日补采 Page-only。
 * 单日失败记 WARN 并继续；空结果不删历史。
 */
function backfillPageDetailsForSite_(site, startDate, endDate) {
  var dateRows = fetchDateRows(site.propertyUrl, startDate, endDate);
  writeLog_('INFO', site.name, 'Page明细回填可用日期数=' + dateRows.length);

  var inserted = 0;
  var updated = 0;
  var apiRowCount = 0;

  for (var i = 0; i < dateRows.length; i++) {
    var dataDate = dateRows[i].keys && dateRows[i].keys[0];
    if (!dataDate) continue;
    try {
      var dayResult = upsertPageDetailsForDate_(
        site.name,
        site.propertyUrl,
        dataDate
      );
      inserted += dayResult.inserted;
      updated += dayResult.updated;
      apiRowCount += dayResult.apiRowCount;
    } catch (e) {
      writeLog_('WARN', site.name, dataDate + ' Page明细失败: ' + e.message);
    }
  }

  writeLog_(
    'INFO',
    site.name,
    'Page明细回填 | range=' +
      startDate +
      '~' +
      endDate +
      ' | apiRows=' +
      apiRowCount +
      ' | inserted=' +
      inserted +
      ' | updated=' +
      updated +
      ' | dataState=all | rowLimit=' +
      QUERY_ROW_LIMIT
  );
}

/**
 * 幂等创建自动任务：
 * - runDaily：每天 1 个（约早上 8 点）
 * - runIndexAuditBatch：每天 4 个（上午/中午/下午/晚上）
 * 重复执行不会重复创建。
 * 不创建 runFreshQueryMonitor：该 trigger helper 独立，需确认后再启用。
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

/** 删除 runDaily、续跑与 runIndexAuditBatch 的全部 trigger */
function removeDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var removedDaily = 0;
  var removedAudit = 0;
  var removedContinue = 0;
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'runDaily') {
      ScriptApp.deleteTrigger(triggers[i]);
      removedDaily++;
    } else if (fn === DAILY_CONTINUE_HANDLER) {
      ScriptApp.deleteTrigger(triggers[i]);
      removedContinue++;
    } else if (fn === 'runIndexAuditBatch') {
      ScriptApp.deleteTrigger(triggers[i]);
      removedAudit++;
    }
  }
  if (!removedDaily && !removedAudit && !removedContinue) {
    SpreadsheetApp.getUi().alert('没有找到相关自动任务。');
    return;
  }
  SpreadsheetApp.getUi().alert(
    '已删除：runDaily×' +
      removedDaily +
      '，续跑×' +
      removedContinue +
      '，runIndexAuditBatch×' +
      removedAudit
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
 * 测试当前账号对 Search Console 的访问权限。
 * 对照「站点配置」中 Enabled=TRUE 的 Property（含 Agent 64 等新增站），不只对照 DEFAULT_SITES。
 * 只读 Sites.list，不修改任何数据。
 */
function testGscAccess() {
  setupSheets();
  var enabled = getEnabledSites();
  var expected = enabled.map(function (s) {
    return s.propertyUrl;
  });
  if (!expected.length) {
    expected = DEFAULT_SITES.map(function (s) {
      return normalizePropertyUrlForGsc_(s.propertyUrl);
    });
  }

  var accessible;
  try {
    accessible = listGscSites();
  } catch (e) {
    Logger.log('FAIL: 无法调用 Sites.list');
    Logger.log(e.message);
    alertUi_('测试失败：' + e.message + '\n请查看「执行记录 / Logger」。');
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
  var missingNames = [];
  for (var e = 0; e < expected.length; e++) {
    var want = expected[e];
    var wantNoSlash =
      want.charAt(want.length - 1) === '/'
        ? want.substring(0, want.length - 1)
        : want;
    if (!accessSet[want] && !accessSet[wantNoSlash]) {
      missing.push(want);
      if (enabled[e]) missingNames.push(enabled[e].name);
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
    Logger.log('Missing（需在 Search Console 为运行脚本的 Google 账号添加权限）:');
    for (var m = 0; m < missing.length; m++) {
      Logger.log(
        (missingNames[m] ? missingNames[m] + ' → ' : '') + missing[m]
      );
    }
  }

  var summary =
    (missing.length === 0 ? 'PASS: ' : 'FAIL: ') +
    okCount +
    '/' +
    expected.length +
    ' GSC properties accessible' +
    (missing.length
      ? '\n\nMissing:\n' +
        missing
          .map(function (u, idx) {
            return (missingNames[idx] ? missingNames[idx] + '\n' : '') + u;
          })
          .join('\n\n')
      : '') +
    '\n\n详情见「执行」→「执行记录」中的日志。';
  alertUi_(summary);
  return summary;
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

/**
 * 一次性：按站点名称定位「站点配置」行，将 Agent 64 纠正为短域名正式配置。
 * 不改历史快照 / Query / 表结构。可用 clasp run 或编辑器直接运行。
 */
function updateAgent64CanonicalDomainConfig() {
  var SPREADSHEET_ID = '15GJGvPnJlXTSbO4aM_Yxvf0GxCgXrmZr0M5b9uZGIJU';
  var TARGET_NAME = 'Agent 64: Spies Never Die';
  var PROPERTY_URL = 'https://agent-64.vercel.app/';
  var SITEMAP_URL = 'https://agent-64.vercel.app/sitemap-index.xml';
  var DAY0 = '2026-08-14';

  // Container-bound / webapp only — spreadsheets.currentonly cannot openById.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('No active spreadsheet. Open the bound Sheet and run from editor/webapp.');
  }
  if (ss.getId() !== SPREADSHEET_ID) {
    throw new Error(
      'Active spreadsheet mismatch. expected=' +
        SPREADSHEET_ID +
        ' actual=' +
        ss.getId()
    );
  }
  var sheet = ss.getSheetByName(SHEET_NAMES.SITES);
  if (!sheet) {
    throw new Error('找不到工作表：' + SHEET_NAMES.SITES);
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw new Error('站点配置为空');
  }

  var values = sheet.getRange(2, 1, lastRow, SITE_HEADERS.length).getValues();
  var rowIndex = -1;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === TARGET_NAME) {
      rowIndex = i + 2;
      break;
    }
  }

  if (rowIndex < 0) {
    // 不存在则追加一行，避免静默失败
    rowIndex = lastRow + 1;
    sheet.getRange(rowIndex, 1, rowIndex, SITE_HEADERS.length).setValues([
      [TARGET_NAME, PROPERTY_URL, SITEMAP_URL, DAY0, true, 'agent-64-spies-never-die']
    ]);
    sheet.getRange(rowIndex, 5).insertCheckboxes();
    Logger.log('APPEND row=' + rowIndex + ' name=' + TARGET_NAME);
  } else {
    sheet.getRange(rowIndex, 2).setValue(PROPERTY_URL);
    sheet.getRange(rowIndex, 3).setValue(SITEMAP_URL);
    sheet.getRange(rowIndex, 4).setValue(DAY0);
    sheet.getRange(rowIndex, 5).setValue(true);
    Logger.log('UPDATE row=' + rowIndex + ' name=' + TARGET_NAME);
  }

  var readBack = sheet.getRange(rowIndex, 1, rowIndex, SITE_HEADERS.length).getValues()[0];
  var summary =
    'Agent 64 站点配置已更新\n' +
    'row=' +
    rowIndex +
    '\n站点名称=' +
    readBack[0] +
    '\nProperty URL=' +
    readBack[1] +
    '\nSitemap URL=' +
    readBack[2] +
    '\nDay0=' +
    toDateStr_(readBack[3]) +
    '\nEnabled=' +
    readBack[4];
  Logger.log(summary);
  alertUi_(summary);
  return summary;
}

/**
 * 一次性：注册 Sucker for Love: Crush Landing 到「站点配置」并回读核对。
 * 以 site_id 为稳定键，重复执行只更新同一行，不追加重复站点。
 */
function registerSuckerForLoveCrushLandingSite() {
  var SITE_ID = 'sucker-for-love-crush-landing';
  var SITE_NAME = 'Sucker for Love: Crush Landing Guide';
  var PROPERTY_URL = 'https://crushlanding.wiki/';
  var SITEMAP_URL = 'https://crushlanding.wiki/sitemap-index.xml';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No active spreadsheet. Open the bound Sheet and run from editor/webapp.');
  var sheet = ss.getSheetByName(SHEET_NAMES.SITES);
  if (!sheet) throw new Error('找不到工作表：' + SHEET_NAMES.SITES);

  var lastRow = sheet.getLastRow();
  var values = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, SITE_HEADERS.length).getValues()
    : [];
  var rowIndex = -1;
  for (var i = 0; i < values.length; i++) {
    var existingId = String(values[i][5] || '').trim();
    var existingName = String(values[i][0] || '').trim();
    var existingProperty = String(values[i][1] || '').trim().replace(/\/+$/, '');
    if (existingId === SITE_ID || existingName === SITE_NAME || existingProperty === PROPERTY_URL.replace(/\/+$/, '')) {
      rowIndex = i + 2;
      break;
    }
  }

  var row = [SITE_NAME, PROPERTY_URL, SITEMAP_URL, '', true, SITE_ID];
  if (rowIndex < 0) {
    rowIndex = Math.max(lastRow + 1, 2);
    sheet.getRange(rowIndex, 1, 1, SITE_HEADERS.length).setValues([row]);
    sheet.getRange(rowIndex, 5).insertCheckboxes();
  } else {
    sheet.getRange(rowIndex, 1, 1, SITE_HEADERS.length).setValues([row]);
    sheet.getRange(rowIndex, 5).insertCheckboxes();
  }
  SpreadsheetApp.flush();
  var readBack = sheet.getRange(rowIndex, 1, 1, SITE_HEADERS.length).getValues()[0];
  var result = {
    action: values.length && rowIndex <= lastRow ? 'UPDATE_OR_REPAIR' : 'APPEND',
    row: rowIndex,
    siteName: String(readBack[0] || ''),
    propertyUrl: String(readBack[1] || ''),
    sitemapUrl: String(readBack[2] || ''),
    day0: toDateStr_(readBack[3]),
    enabled: readBack[4],
    siteId: String(readBack[5] || '')
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * 回读 Agent 64 短域名配置、近期日志，以及今日 Query 行数（用于幂等核对）。
 * 只读：不改「站点配置」、不改写 2026-08-14 长域名历史快照。
 */
function readAgent64ShortDomainStatus_() {
  var TARGET_NAME = 'Agent 64: Spies Never Die';
  var SHORT = 'https://agent-64.vercel.app/';
  var LONG_HOST = 'agent-64-spies-never-die';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No active spreadsheet');

  var sites = ss.getSheetByName(SHEET_NAMES.SITES);
  var siteRow = null;
  if (sites && sites.getLastRow() >= 2) {
    var values = sites.getRange(2, 1, sites.getLastRow(), SITE_HEADERS.length).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === TARGET_NAME) {
        siteRow = {
          row: i + 2,
          name: values[i][0],
          propertyUrl: values[i][1],
          sitemapUrl: values[i][2],
          day0: toDateStr_(values[i][3]),
          enabled: values[i][4],
          siteId: String(values[i][5] || '').trim()
        };
        break;
      }
    }
  }

  var logHits = [];
  var longDomainLogHits = [];
  var logSheet = ss.getSheetByName(SHEET_NAMES.LOG);
  if (logSheet && logSheet.getLastRow() >= 2) {
    var logLast = logSheet.getLastRow();
    var end = Math.min(logLast, 2 + 400);
    var logs = logSheet.getRange(2, 1, end, Math.min(6, logSheet.getLastColumn())).getValues();
    for (var l = 0; l < logs.length; l++) {
      var line = logs[l].join(' | ');
      if (line.indexOf(LONG_HOST) >= 0) {
        longDomainLogHits.push(line);
      }
      if (
        logHits.length < 20 &&
        (line.indexOf('Agent 64') >= 0 ||
          line.indexOf('agent-64') >= 0 ||
          line.indexOf('runDaily') >= 0 ||
          line.indexOf('站点数量') >= 0 ||
          line.indexOf('采集结束') >= 0 ||
          line.indexOf('分批暂停') >= 0)
      ) {
        logHits.push(line);
      }
    }
  }

  var snapshotHits = [];
  var latestAgent64Snapshot = null;
  var historicalLongSnapshots = [];
  var snap = ss.getSheetByName(SHEET_NAMES.SNAPSHOT);
  if (snap && snap.getLastRow() >= 2) {
    var colCount = Math.min(6, snap.getLastColumn());
    var snaps = snap.getRange(2, 1, snap.getLastRow(), colCount).getValues();
    for (var s = 0; s < snaps.length; s++) {
      var site = String(snaps[s][2] || '');
      var prop = String(snaps[s][3] || '');
      if (site.indexOf('Agent 64') < 0 && prop.indexOf('agent-64') < 0) continue;
      var runD = toDateStr_(snaps[s][0]);
      if (!latestAgent64Snapshot) {
        latestAgent64Snapshot = {
          runDate: runD,
          propertyUrl: prop,
          sitemapUrlCount: snaps[s][5]
        };
      }
      if (snapshotHits.length < 5) {
        snapshotHits.push(snaps[s].slice(0, 6).join(' | '));
      }
      if (runD === '2026-08-14' && String(prop).indexOf(LONG_HOST) >= 0) {
        historicalLongSnapshots.push(snaps[s].slice(0, 6).join(' | '));
      }
    }
  }

  var queryCountToday = 0;
  var queryDupCheck = {};
  var qSheet = ss.getSheetByName(SHEET_NAMES.QUERIES);
  var runDate = todayStr_();
  if (qSheet && qSheet.getLastRow() >= 2) {
    var qVals = qSheet
      .getRange(2, 1, qSheet.getLastRow(), Math.min(7, qSheet.getLastColumn()))
      .getValues();
    for (var q = 0; q < qVals.length; q++) {
      var siteName = String(qVals[q][1] || '');
      var dateVal = toDateStr_(qVals[q][0]);
      var queryText = String(qVals[q][2] || '');
      if (dateVal === runDate && siteName.indexOf('Agent 64') >= 0) {
        queryCountToday++;
        var key = dateVal + '|' + siteName + '|' + queryText;
        queryDupCheck[key] = (queryDupCheck[key] || 0) + 1;
      }
    }
  }
  var dupKeys = 0;
  for (var dk in queryDupCheck) {
    if (queryDupCheck[dk] > 1) dupKeys++;
  }

  return {
    siteRow: siteRow,
    shortDomainConfigured:
      siteRow &&
      String(siteRow.propertyUrl).indexOf(SHORT) === 0 &&
      String(siteRow.sitemapUrl).indexOf('https://agent-64.vercel.app/sitemap-index.xml') === 0,
    recentLogs: logHits,
    longDomainLogHits: longDomainLogHits,
    recentSnapshots: snapshotHits,
    latestAgent64Snapshot: latestAgent64Snapshot,
    historicalLongSnapshots: historicalLongSnapshots,
    historicalLongSnapshotKept: historicalLongSnapshots.length > 0,
    queryCountToday: queryCountToday,
    queryDuplicateKeysToday: dupKeys,
    runDate: runDate
  };
}
