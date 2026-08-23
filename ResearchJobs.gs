/**
 * Research Job 出口
 * 内容机会 → 标准 Research Job 数据。只写 Sheet，不抓取外部源、不调用 hotword-engine。
 *
 * RESEARCH_EXPAND_EXISTING：同一站点 + 同一承接页 + 同一建议动作 → 1 个 Job。
 * RESEARCH_NEW_CONTENT：仍按 normalized query 各建 1 个 Job。
 */

/**
 * Web App GET：hotword-engine 只读拉取待处理任务。
 * 不写 Sheet、不改任务状态、不执行 Research。
 * 例：?action=pendingResearchJobs
 *
 * 一次性：?action=initResearchWriteToken — 仅当 Script Property 未设置时生成并返回 token。
 */
function doGet(e) {
  var action = '';
  if (e && e.parameter && e.parameter.action) {
    action = String(e.parameter.action).trim();
  }
  if (action === 'pendingResearchJobs') {
    return jsonOutput_({ jobs: loadPendingResearchJobs_() });
  }
  if (action === 'pendingActionResearchJobs') {
    return jsonOutput_({ jobs: loadPendingActionResearchJobs_() });
  }
  if (action === 'pendingDemandDiscoveryJobs') {
    return jsonOutput_({ jobs: loadDemandDiscoveryReadyJobs_() });
  }
  if (action === 'pendingSearchDemandJobs') {
    return jsonOutput_({ jobs: loadSearchDemandReadyJobs_() });
  }
  if (action === 'pendingResearchRecommendationJobs') {
    return jsonOutput_({ jobs: loadPendingResearchRecommendationJobs_() });
  }
  if (action === 'pendingGameWideDiscoveryJobs') {
    return jsonOutput_({ jobs: loadGameWideDiscoveryReadyJobs_() });
  }
  if (action === 'initResearchWriteToken') {
    return jsonOutput_(initResearchWriteToken_());
  }
  if (action === 'researchJobRow') {
    var jobId = e && e.parameter ? String(e.parameter.job_id || '').trim() : '';
    return jsonOutput_(readResearchJobDisplay_(jobId));
  }
  return jsonOutput_({ error: 'unknown_action', jobs: [] });
}

/**
 * Web App POST：hotword-engine 回写研究结果。
 * 需携带 token（JSON body.token 或 query ?token=）；按 job_id 更新「研究任务」单行。
 * 不修改「内容机会」、不新建任务、不执行 Research。
 */
function doPost(e) {
  try {
    var body = parsePostJson_(e);
    if (!body) {
      return jsonOutput_({ ok: false, error: 'invalid_json' });
    }
    if (!checkResearchWriteToken_(e, body)) {
      return jsonOutput_({ ok: false, error: 'unauthorized' });
    }
    var researchType = String((body && body.research_type) || '').trim();
    if (researchType === RESEARCH_TYPE.DEMAND_DISCOVERY) {
      // DEMAND_DISCOVERY callback 按 scope 分流：GAME_WIDE → 独立 handler
      var cbScope = normalizeDiscoveryScopeLabel_(
        body.discovery_scope && body.discovery_scope.scope
          ? body.discovery_scope.scope
          : body.discovery_scope
      );
      if (cbScope === 'GAME_WIDE') {
        return jsonOutput_(handleGameWideDiscoveryCallback_(body));
      }
      return jsonOutput_(handleDemandDiscoveryCallback_(body));
    }
    if (researchType === RESEARCH_TYPE.SEARCH_DEMAND) {
      return jsonOutput_(handleSearchDemandCallback_(body));
    }
    return jsonOutput_(writeResearchJobResult_(body));
  } catch (err) {
    return jsonOutput_({
      ok: false,
      error: String((err && err.message) || err || 'unknown_error')
    });
  }
}

// ---------------------------------------------------------------------------
// R2C-A — DEMAND_DISCOVERY Callback Receiver
// ---------------------------------------------------------------------------

function normalizeDiscoveryScopeLabel_(v) {
  var s = String(v || '').trim().toUpperCase();
  if (s === 'ANCHOR') return 'ANCHOR';
  if (s === 'GAME_WIDE') return 'GAME_WIDE';
  return '';
}

function normalizeAllowedExternalFamilies_(familiesRaw) {
  // R2C-A contract: only COMMUNITY / VIDEO are allowed as anchor-qualified families.
  var allowed = {};
  allowed['COMMUNITY'] = true;
  allowed['VIDEO'] = true;

  var list = familiesRaw;
  if (list === null || list === undefined) list = [];
  if (Object.prototype.toString.call(list) !== '[object Array]') list = [list];

  var out = [];
  for (var i = 0; i < list.length; i++) {
    var fam = String(list[i] || '').trim().toUpperCase();
    if (!fam) continue;
    if (!allowed[fam]) {
      throw new Error('invalid_external_source_family: ' + fam);
    }
    out.push(fam);
  }
  // DemandRadar normalizeSourceFamilies_ does stable dedupe/order.
  return normalizeSourceFamilies_(out);
}

function topClustersToDiscoverySummary_(topClusters) {
  var list =
    topClusters && Object.prototype.toString.call(topClusters) === '[object Array]' ? topClusters : [];
  var signals = [];
  var questions = [];

  for (
    var i = 0;
    i < list.length && (signals.length < 3 || questions.length < 3);
    i++
  ) {
    var c = list[i] || {};
    var sig = String(c.representative_signal || '').trim();
    var q = String(c.representative_question || '').trim();
    if (sig && signals.length < 3) signals.push(sig);
    if (q && questions.length < 3) questions.push(q);
  }

  return {
    discoveryThemes: signals.join(' | '),
    representativeQuestions: questions.join(' | ')
  };
}

function validateDemandDiscoveryJobIdentity_(jobRow, jobCol, payload) {
  var radarId = String(payload.radar_id || '').trim();
  var cycleDate = normalizeDemandDiscoveryDate_(payload.discovery_cycle_date);

  var jobResearchType = String(cell_(jobRow, jobCol, '研究类型') || '').trim();
  var jobRadarId = String(cell_(jobRow, jobCol, '雷达ID') || '').trim();
  var jobCycleDate = normalizeDemandDiscoveryDate_(
    cell_(jobRow, jobCol, '发现周期日期')
  );

  if (jobResearchType !== RESEARCH_TYPE.DEMAND_DISCOVERY) {
    return { ok: false, error: 'job_research_type_mismatch' };
  }
  if (!jobRadarId || !jobCycleDate) {
    return { ok: false, error: 'job_missing_identity_fields' };
  }
  if (jobRadarId !== radarId) return { ok: false, error: 'radar_id_mismatch' };
  if (jobCycleDate !== cycleDate) {
    return { ok: false, error: 'discovery_cycle_date_mismatch' };
  }
  return { ok: true };
}

function applyDemandDiscoveryCallbackToResearchJobRow_(
  jobRow,
  jobCol,
  payload,
  completedAt
) {
  var row = (jobRow || []).slice();

  var executionStatus = String(payload.execution_status || '').trim().toUpperCase();
  if (executionStatus === 'FAILED') {
    row[jobCol['任务状态']] = RESEARCH_JOB_STATUS_LABELS[RESEARCH_JOB_STATUS.FAILED] || '失败';
    row[jobCol['错误信息']] = String(payload.error || '').trim();
    return row;
  }

  // COMPLETED
  var discoveryStatus = String(payload.discovery_status || '').trim().toUpperCase();
  var anchorCount = Number(payload.anchor_evidence_count || 0);
  if (isNaN(anchorCount)) anchorCount = 0;
  var resultPath = String(payload.result_path || '').trim();

  var nextStatus =
    discoveryStatus === 'NO_SIGNAL' ? RESEARCH_JOB_STATUS.DISCOVERY_NO_SIGNAL : RESEARCH_JOB_STATUS.DISCOVERY_DONE;

  row[jobCol['任务状态']] = RESEARCH_JOB_STATUS_LABELS[nextStatus] || '';
  if (jobCol['证据数量'] !== undefined) row[jobCol['证据数量']] = anchorCount;
  if (jobCol['结果路径'] !== undefined) row[jobCol['结果路径']] = resultPath;
  if (jobCol['完成时间'] !== undefined) row[jobCol['完成时间']] = completedAt;
  if (jobCol['错误信息'] !== undefined) row[jobCol['错误信息']] = '';
  return row;
}

function applyDemandDiscoveryCallbackToDemandRadarRow_(
  radarRow,
  radarCol,
  payload,
  completedAt
) {
  var row = (radarRow || []).slice();

  var discoveryScope = normalizeDiscoveryScopeLabel_(payload.discovery_scope);
  var discoveryStatus = String(payload.discovery_status || '').trim().toUpperCase();

  // external_source_families: only anchor-qualified families.
  var externalFamilies = normalizeAllowedExternalFamilies_(
    payload.external_source_families || []
  );

  // Update discovery summary fields (append-only columns).
  var summary = topClustersToDiscoverySummary_(payload.top_clusters || []);
  if (radarCol['发现状态'] !== undefined) row[radarCol['发现状态']] = discoveryStatus;
  if (radarCol['外部来源族'] !== undefined)
    row[radarCol['外部来源族']] = externalFamilies.length ? externalFamilies.join(',') : '';
  if (radarCol['外部证据数'] !== undefined) row[radarCol['外部证据数']] = Number(payload.anchor_evidence_count || 0) || 0;
  if (radarCol['发现主题'] !== undefined) row[radarCol['发现主题']] = summary.discoveryThemes || '';
  if (radarCol['代表问题'] !== undefined)
    row[radarCol['代表问题']] = summary.representativeQuestions || '';
  if (radarCol['研究结果路径'] !== undefined)
    row[radarCol['研究结果路径']] = String(payload.result_path || '').trim();

  // discovery_scope=GAME_WIDE: conservative.
  if (discoveryScope !== 'ANCHOR') return row;

  // Merge source families only for ANCHOR scope.
  var existingFamiliesRaw = row[radarCol['来源族']] || '';
  var mergedFamilies = normalizeSourceFamilies_([existingFamiliesRaw, externalFamilies]);

  // Recompute independent families / cross validated / opportunity confidence.
  var familyCount = mergedFamilies.length;
  var crossValidated = isCrossValidated_(mergedFamilies);
  var opportunityConfidence = crossValidated
    ? OPPORTUNITY_CONFIDENCE.CROSS_VALIDATED
    : OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY;

  row[radarCol['来源族']] = formatRadarSourceFamilies_(mergedFamilies);
  row[radarCol['独立来源族数']] = familyCount;
  row[radarCol['交叉验证']] = crossValidated;
  row[radarCol['机会置信度']] = opportunityConfidence;

  // RadarStatus transitions: VALIDATED never downgrades.
  var existingRadarStatus = String(row[radarCol['雷达状态']] || '').trim();
  if (existingRadarStatus !== RADAR_STATUS.VALIDATED) {
    if (discoveryStatus === 'NO_SIGNAL') {
      row[radarCol['雷达状态']] = RADAR_STATUS.WATCH;
    } else if (externalFamilies.length > 0) {
      row[radarCol['雷达状态']] = RADAR_STATUS.VALIDATED;
    }
  }

  row[radarCol['最近报告时间']] = completedAt;
  return row;
}

function handleDemandDiscoveryCallback_(payload) {
  payload = payload || {};
  var jobId = String(payload.job_id || '').trim();
  if (!jobId) return { ok: false, error: 'missing_job_id' };

  var radarId = String(payload.radar_id || '').trim();
  var cycleDate = String(payload.discovery_cycle_date || '').trim();
  if (!radarId) return { ok: false, error: 'missing_radar_id' };
  if (!cycleDate) return { ok: false, error: 'missing_discovery_cycle_date' };

  var executionStatus = String(payload.execution_status || '').trim().toUpperCase();
  if (executionStatus !== 'COMPLETED' && executionStatus !== 'FAILED') {
    return { ok: false, error: 'invalid_execution_status' };
  }

  var discoveryStatus = String(payload.discovery_status || '').trim().toUpperCase();
  if (executionStatus === 'COMPLETED') {
    if (['NO_SIGNAL', 'DISCOVERED', 'CROSS_VALIDATED'].indexOf(discoveryStatus) < 0) {
      return { ok: false, error: 'invalid_discovery_status' };
    }
  }

  var discoveryScope = normalizeDiscoveryScopeLabel_(payload.discovery_scope);
  if (executionStatus === 'COMPLETED' && !discoveryScope) {
    return { ok: false, error: 'invalid_discovery_scope' };
  }

  // Pre-validate external_source_families to avoid partial updates (job written but radar fails).
  if (executionStatus === 'COMPLETED') {
    normalizeAllowedExternalFamilies_(payload.external_source_families || []);
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { ok: false, error: 'no_spreadsheet' };

  var jobSheet = ss.getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!jobSheet) return { ok: false, error: 'research_jobs_missing' };
  var radarSheet = ss.getSheetByName(SHEET_NAMES.DEMAND_RADAR);
  if (!radarSheet) return { ok: false, error: 'demand_radar_missing' };

  ensureResearchJobResultColumns_(jobSheet);
  ensureDemandRadarHeader_();

  var jobLastCol = Math.max(jobSheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var jobHeader = jobSheet.getRange(1, 1, 1, jobLastCol).getValues()[0];
  var jobCol = headerIndexMap_(jobHeader);

  var found = findResearchJobRowById_(jobSheet, jobCol, jobId);
  if (!found) return { ok: false, error: 'job_not_found', job_id: jobId };

  var jobRow = jobSheet
    .getRange(found.sheetRow, 1, 1, jobLastCol)
    .getValues()[0];

  var idCheck = validateDemandDiscoveryJobIdentity_(jobRow, jobCol, payload);
  if (!idCheck.ok) return { ok: false, error: idCheck.error };

  var completedAt = new Date();

  // 1) Update research job row (幂等：覆盖，不追加）
  var nextJobRow = applyDemandDiscoveryCallbackToResearchJobRow_(
    jobRow,
    jobCol,
    payload,
    completedAt
  );
  jobSheet.getRange(found.sheetRow, 1, 1, jobLastCol).setValues([nextJobRow]);

  // 2) FAILED：只更新 research job，不改 radar
  if (executionStatus === 'FAILED') return { ok: true, job_id: jobId, status: 'FAILED' };

  // 3) COMPLETED：更新 radar（按 discovery_scope=ANCHOR only merge）
  var radarLastCol = Math.max(radarSheet.getLastColumn(), DEMAND_RADAR_HEADERS.length);
  var radarHeader = radarSheet.getRange(1, 1, 1, radarLastCol).getValues()[0];
  var radarCol = headerIndexMap_(radarHeader);

  var radarRows = radarSheet.getRange(2, 1, radarSheet.getLastRow() - 1, radarLastCol).getValues();
  for (var i = 0; i < radarRows.length; i++) {
    var r = radarRows[i];
    if (String(r[radarCol['雷达ID']] || '').trim() !== radarId) continue;

    var nextRadarRow = applyDemandDiscoveryCallbackToDemandRadarRow_(
      r,
      radarCol,
      payload,
      completedAt
    );
    radarSheet.getRange(i + 2, 1, 1, radarLastCol).setValues([nextRadarRow]);
    break;
  }

  return { ok: true, job_id: jobId, status: 'COMPLETED', discovery_status: discoveryStatus };
}

// ---------------------------------------------------------------------------
// GAME_WIDE scope — Job Creation / Loading / Callback
// ---------------------------------------------------------------------------

/**
 * M0 临时 wrapper：零参数，可在 Apps Script 编辑器直接运行。
 * 创建一个 Mortal Shell II GAME_WIDE Job。
 */
function runMs2GameWideDiscoveryM0() {
  return createGameWideDiscoveryJobForSite_(
    'Mortal Shell II',
    'Mortal Shell II',
    {
      lookbackHours: 24,
      aliases: ['Mortal Shell 2']
    }
  );
}

/**
 * 构建 GAME_WIDE scope Job 合同。不依赖 Radar 行。
 * research_type = DEMAND_DISCOVERY，scope = GAME_WIDE。
 * @param {string} siteName
 * @param {string} gameName
 * @param {Date}   createdAt
 * @param {Object} opts  { aliases: string[], lookbackHours: number }
 * @return {Object}
 */
function buildGameWideDiscoveryJobContract_(siteName, gameName, createdAt, opts) {
  opts = opts || {};
  createdAt = createdAt || new Date();
  var createdAtIso = '';
  if (typeof toIso8601_ === 'function') {
    try { createdAtIso = toIso8601_(createdAt); } catch (e) { createdAtIso = String(createdAt); }
  } else {
    createdAtIso = String(createdAt || '');
  }

  var slug = radarSiteSlug_(siteName) || slugifyResearch_(siteName) || 'site';
  var ymd = Utilities.formatDate(createdAt, Session.getScriptTimeZone() || 'Asia/Shanghai', 'yyyyMMdd');
  var cycleDate = normalizeDiscoveryCycleDate_(opts.discoveryCycleDate) ||
    Utilities.formatDate(createdAt, Session.getScriptTimeZone() || 'Asia/Shanghai', 'yyyy-MM-dd');
  var jobId = String(opts.jobId || '').trim() || ('game-wide-' + slug + '-' + ymd);

  var lookbackHours = Number(opts.lookbackHours) || DAILY_GAME_WIDE_LOOKBACK_HOURS;
  var aliases = Array.isArray(opts.aliases) ? opts.aliases : [];
  var triggerType = String(opts.triggerType || 'GAME_WIDE_LAUNCH').trim();

  return {
    job_id: jobId,
    job_type: 'GAME_WIDE_SOCIAL_DISCOVERY',
    research_type: RESEARCH_TYPE.DEMAND_DISCOVERY,
    site: String(siteName || '').trim(),
    game: String(gameName || '').trim(),
    radar_id: '',
    trigger_type: triggerType,
    anchor_page: '',
    source_signal_summary: '主动扫描 ' + gameName + ' 最近 ' + lookbackHours + 'h 社交信号',
    discovery_scope: { scope: 'GAME_WIDE', lookback_hours: lookbackHours },
    seed_terms: [gameName].concat(aliases),
    source_families_requested: DAILY_GAME_WIDE_SOURCE_FAMILIES.slice(),
    discovery_cycle_date: cycleDate,
    site_id: String(opts.siteId || '').trim(),
    created_at: createdAtIso
  };
}

/**
 * 将 GAME_WIDE 合同转为「研究任务」Sheet 行。
 */
function gameWideDiscoveryResearchJobSheetRow_(contract, site, createdAt) {
  return [
    String(contract.job_id || '').trim(),                                // 任务ID
    createdAt || new Date(),                                              // 创建时间
    site || contract.site || '',                                          // 站点
    contract.game || '',                                                  // 游戏
    '',                                                                   // 搜索词/topic
    '',                                                                   // 页面路径
    '',                                                                   // 机会等级
    '',                                                                   // 建议动作
    '',                                                                   // source_query
    opportunityLabel_(RESEARCH_JOB_STATUS_LABELS, RESEARCH_JOB_STATUS.READY_FOR_DISCOVERY_RUNNER), // 任务状态
    '',                                                                   // 关联搜索词
    '',                                                                   // 研究结果
    '',                                                                   // 证据数量
    '',                                                                   // 结果路径
    '',                                                                   // 完成时间
    '',                                                                   // 错误信息
    '', '', '', '', '',                                                   // 审核 5 列
    RESEARCH_TYPE.DEMAND_DISCOVERY,                                        // 研究类型
    // --- GAME_WIDE 元数据列 ---
    '',                                                                   // 雷达ID
    String(contract.trigger_type || '').trim(),                           // 触发类型
    '',                                                                   // 锚点页面
    JSON.stringify(contract.discovery_scope || {}),                       // 发现范围
    JSON.stringify(contract.seed_terms || []),                            // 种子词
    JSON.stringify(contract.source_families_requested || []),             // 来源族请求
    String(contract.source_signal_summary || '').trim(),                  // 信号摘要
    String(contract.discovery_cycle_date || '').trim(),                   // 发现周期日期
    String(contract.opportunity_id || '').trim(),                          // OpportunityID
    '', '', '', '',                                                        // Recommendation linkage
    '', '', '', '', '', '', '', '', '', '', '', '', ''                     // M1 action context + ContentDecision
  ];
}

/**
 * 手工创建 GAME_WIDE Job。第一版仅用于单站实验。
 * @param {string} siteName
 * @param {string} gameName
 * @param {Object} opts  { aliases: string[], lookbackHours: number }
 * @return {Object} { created: number, job_id: string }
 */
function createGameWideDiscoveryJobForSite_(siteName, gameName, opts) {
  opts = opts || {};
  ensureResearchJobSheets_();

  var jobSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!jobSheet) return { created: 0, job_id: '', error: 'sheet_missing' };

  var runDate = todayStr_();
  var createdAt = new Date();
  var nowTs = typeof radarNowTs_ === 'function' ? radarNowTs_() : '';

  // Dedupe: 同 game + 同日期不重复创建
  var lastCol = Math.max(jobSheet.getLastColumn(), 1);
  var header = jobSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  if (jobSheet.getLastRow() >= 2) {
    var existingRows = jobSheet.getRange(2, 1, jobSheet.getLastRow() - 1, lastCol).getValues();
    for (var i = 0; i < existingRows.length; i++) {
      var rt = String(cell_(existingRows[i], col, '研究类型') || '').trim();
      if (rt !== RESEARCH_TYPE.DEMAND_DISCOVERY) continue;
      var game = String(cell_(existingRows[i], col, '游戏') || '').trim();
      if (game !== gameName) continue;
      var status = String(cell_(existingRows[i], col, '任务状态') || '').trim();
      // 同 game + 同日期（从 job_id 提取）已存在 → skip
      var jid = String(cell_(existingRows[i], col, '任务ID') || '').trim();
      if (jid && jid.indexOf(runDate.replace(/-/g, '')) >= 0) {
        return { created: 0, job_id: jid, skipped: true };
      }
    }
  }

  var contract = buildGameWideDiscoveryJobContract_(siteName, gameName, createdAt, opts);
  var jobRow = gameWideDiscoveryResearchJobSheetRow_(contract, siteName, createdAt);

  var start = jobSheet.getLastRow() + 1;
  if (start < 2) start = 2;
  jobSheet.getRange(start, 1, 1, RESEARCH_JOB_HEADERS.length).setValues([jobRow]);

  return { created: 1, job_id: contract.job_id };
}

/** Stable M0 idempotency key: site identity + trigger + discovery date. */
function resolveDailyGameWideSiteId_(site) {
  var explicit = String((site && (site.siteId || site.site_id)) || '').trim();
  if (explicit) return explicit;

  // Existing GSC rows may predate the additive site_id column. Reuse only an
  // exact DEFAULT_SITES name + Property match; never generate a new identity.
  var defaults = typeof DEFAULT_SITES !== 'undefined' && Array.isArray(DEFAULT_SITES)
    ? DEFAULT_SITES
    : [];
  var name = String((site && site.name) || '').trim();
  var propertyUrl = String((site && site.propertyUrl) || '').trim();
  for (var i = 0; i < defaults.length; i++) {
    var candidate = defaults[i] || {};
    if (String(candidate.name || '').trim() !== name) continue;
    var candidateUrl = String(candidate.propertyUrl || '').trim();
    if (candidateUrl && propertyUrl && normalizePropertyUrlForGsc_(candidateUrl) !== normalizePropertyUrlForGsc_(propertyUrl)) continue;
    var known = String(candidate.siteId || candidate.site_id || '').trim();
    if (known) return known;
  }
  return '';
}

function dailyGameWideDedupeKey_(site, triggerType, discoveryDate) {
  var siteId = resolveDailyGameWideSiteId_(site);
  var identity = siteId ? 'site_id:' + siteId : getSiteIdentityKey_(site || {});
  return identity + '||' + String(triggerType || DAILY_GAME_WIDE_TRIGGER).trim() + '||' +
    normalizeDiscoveryCycleDate_(discoveryDate);
}

function buildDailyGameWideJobId_(site, discoveryDate) {
  var identity = resolveDailyGameWideSiteId_(site);
  var slug = slugifyResearch_(identity || (site && site.name) || '') || 'site';
  return 'game-wide-' + slug + '-' + discoveryCycleDateToYmd_(discoveryDate);
}

function isDailyGameWideSiteEligible_(site) {
  if (!site || !String(site.name || '').trim() || !String(site.propertyUrl || '').trim()) return false;
  if (site.enabled === false) return false;

  var explicitBooleanFields = [site.status, site.lifecycle, site.releaseStatus, site.liveStatus];
  for (var b = 0; b < explicitBooleanFields.length; b++) {
    var raw = explicitBooleanFields[b];
    if (raw === false || raw === 0 || String(raw || '').trim().toLowerCase() === 'false') return false;
  }

  var blocked = ['ARCHIVED', 'INACTIVE', 'REJECTED', 'DISABLED', 'OFFLINE', 'DRAFT', 'DELETED', 'NOT_LIVE'];
  for (var i = 0; i < explicitBooleanFields.length; i++) {
    var value = String(explicitBooleanFields[i] || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (!value) continue;
    for (var j = 0; j < blocked.length; j++) {
      if (value === blocked[j] || value.indexOf(blocked[j] + '_') === 0 || value.indexOf('_' + blocked[j]) >= 0) {
        return false;
      }
    }
  }
  return true;
}

function dailyGameWideAliasesForSite_(site) {
  var aliases = Array.isArray(site && site.aliases) ? site.aliases.slice() : [];
  var siteId = String((site && (site.siteId || site.site_id)) || '').trim();
  var name = String((site && site.name) || '').trim().toLowerCase();
  if ((siteId === 'mortal-shell-ii' || name === 'mortal shell ii') && aliases.indexOf('Mortal Shell 2') < 0) {
    aliases.push('Mortal Shell 2');
  }
  return aliases;
}

/** Pure planning layer used by the Sheet writer and local M0 tests. */
function planDailyGameWideDiscoveryJobs_(sites, existingJobs, runDate, createdAt) {
  sites = sites || [];
  existingJobs = existingJobs || [];
  runDate = normalizeDiscoveryCycleDate_(runDate || todayStr_());
  createdAt = createdAt || new Date();

  var existingKeys = {};
  var existingJobIds = {};
  for (var e = 0; e < existingJobs.length; e++) {
    var prior = existingJobs[e] || {};
    if (String(prior.trigger_type || '').trim() !== DAILY_GAME_WIDE_TRIGGER) continue;
    if (normalizeDiscoveryCycleDate_(prior.discovery_cycle_date) !== runDate) continue;
    var priorId = String(prior.job_id || '').trim();
    if (priorId) existingJobIds[priorId] = true;
    if (prior.site) existingKeys[dailyGameWideDedupeKey_(prior.site, DAILY_GAME_WIDE_TRIGGER, runDate)] = priorId || true;
  }

  var result = { created: 0, skipped: 0, excluded: 0, dedupe_hits: 0, jobs: [], contracts: [], excluded_sites: [] };
  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    if (!isDailyGameWideSiteEligible_(site)) {
      result.excluded += 1;
      result.excluded_sites.push(String(site && site.name || '').trim());
      continue;
    }
    var key = dailyGameWideDedupeKey_(site, DAILY_GAME_WIDE_TRIGGER, runDate);
    var jobId = buildDailyGameWideJobId_(site, runDate);
    if (existingKeys[key] || existingJobIds[jobId]) {
      result.skipped += 1;
      result.dedupe_hits += 1;
      result.jobs.push({ site: site.name, job_id: String(existingKeys[key] || jobId), created: false, dedupe_hit: true });
      continue;
    }
    var contract = buildGameWideDiscoveryJobContract_(site.name, site.name, createdAt, {
      aliases: dailyGameWideAliasesForSite_(site),
      lookbackHours: DAILY_GAME_WIDE_LOOKBACK_HOURS,
      triggerType: DAILY_GAME_WIDE_TRIGGER,
      discoveryCycleDate: runDate,
      jobId: jobId,
      siteId: resolveDailyGameWideSiteId_(site)
    });
    existingKeys[key] = contract.job_id;
    existingJobIds[contract.job_id] = true;
    result.created += 1;
    result.contracts.push(contract);
    result.jobs.push({ site: site.name, job_id: contract.job_id, created: true, dedupe_hit: false });
  }
  return result;
}

/**
 * Daily M0 orchestrator. It only appends READY_FOR_DISCOVERY_RUNNER jobs;
 * it does not merge external/GSC opportunities or change any decision/action.
 */
function enqueueDailyGameWideDiscovery_(sites, runDate) {
  ensureResearchJobSheets_();
  sites = sites || [];
  runDate = normalizeDiscoveryCycleDate_(runDate || todayStr_());

  var jobSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!jobSheet) return { created: 0, skipped: 0, excluded: 0, dedupe_hits: 0, jobs: [], error: 'sheet_missing' };

  var lastCol = Math.max(jobSheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = jobSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var rows = jobSheet.getLastRow() >= 2
    ? jobSheet.getRange(2, 1, jobSheet.getLastRow() - 1, lastCol).getValues()
    : [];
  var siteByName = {};
  for (var s = 0; s < sites.length; s++) siteByName[String(sites[s].name || '').trim()] = sites[s];

  var existingJobs = [];
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var trigger = String(cell_(row, col, '触发类型') || '').trim();
    var cycle = normalizeDiscoveryCycleDate_(cell_(row, col, '发现周期日期'));
    var existingSite = siteByName[String(cell_(row, col, '站点') || '').trim()];
    existingJobs.push({
      site: existingSite,
      job_id: String(cell_(row, col, '任务ID') || '').trim(),
      trigger_type: trigger,
      discovery_cycle_date: cycle
    });
  }

  var result = planDailyGameWideDiscoveryJobs_(sites, existingJobs, runDate, new Date());
  var toAppend = result.contracts.map(function (contract) {
    return gameWideDiscoveryResearchJobSheetRow_(contract, contract.site, new Date(contract.created_at || new Date()));
  });

  if (toAppend.length) {
    var start = jobSheet.getLastRow() + 1;
    if (start < 2) start = 2;
    jobSheet.getRange(start, 1, toAppend.length, RESEARCH_JOB_HEADERS.length).setValues(toAppend);
  }

  writeLog_('INFO', '', 'enqueueDailyGameWideDiscovery runDate=' + runDate +
    ' created=' + result.created + ' skipped=' + result.skipped + ' excluded=' + result.excluded);
  return result;
}

/** Manual/retry entry; the daily finalizer calls the unlocked helper directly. */
function enqueueDailyGameWideDiscovery() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return 'enqueueDailyGameWideDiscovery skipped: lock busy';
  try {
    setupSheets();
    return enqueueDailyGameWideDiscovery_(getEnabledSites(), todayStr_());
  } finally {
    lock.releaseLock();
  }
}

/**
 * 加载待执行的 GAME_WIDE scope Job（DEMAND_DISCOVERY 研究类型 + 状态过滤）。
 */
function loadGameWideDiscoveryReadyJobs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return [];
  var sheet = ss.getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var jobs = [];

  var needStatus = opportunityLabel_(RESEARCH_JOB_STATUS_LABELS, RESEARCH_JOB_STATUS.READY_FOR_DISCOVERY_RUNNER);
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var statusRaw = String(cell_(row, col, '任务状态') || '').trim();
    if (statusRaw !== needStatus && statusRaw !== RESEARCH_JOB_STATUS.READY_FOR_DISCOVERY_RUNNER) continue;

    var researchType = String(cell_(row, col, '研究类型') || '').trim();
    if (researchType !== RESEARCH_TYPE.DEMAND_DISCOVERY) continue;

    var discoveryScope = safeJsonParse_(cell_(row, col, '发现范围') || '', {});
    var scopeLabel = String((discoveryScope && discoveryScope.scope) || '').trim().toUpperCase();
    if (scopeLabel !== 'GAME_WIDE') continue;

    var job = gameWideDiscoveryRowToApi_(row, col);
    if (job && job.job_id) jobs.push(job);
  }
  return jobs;
}

/**
 * 将「研究任务」Sheet 行转为 GAME_WIDE scope API 输出。
 */
function gameWideDiscoveryRowToApi_(row, col) {
  var created = cell_(row, col, '创建时间');
  var createdAt = '';
  if (Object.prototype.toString.call(created) === '[object Date]' && !isNaN(created.getTime())) {
    createdAt = typeof toIso8601_ === 'function' ? toIso8601_(created) : String(created);
  } else {
    createdAt = String(created || '').trim();
  }

  var jobId = String(cell_(row, col, '任务ID') || '').trim();
  var discoveryScope = safeJsonParse_(cell_(row, col, '发现范围') || '', {});
  var seedTerms = safeJsonParse_(cell_(row, col, '种子词') || '', []);
  var cycleDate = normalizeDiscoveryCycleDate_(cell_(row, col, '发现周期日期')) ||
    discoveryCycleDateFromJobId_(jobId);
  var lookbackHours = Number(discoveryScope && discoveryScope.lookback_hours) || DAILY_GAME_WIDE_LOOKBACK_HOURS;

  return {
    job_id: jobId,
    job_type: 'GAME_WIDE_SOCIAL_DISCOVERY',
    research_type: RESEARCH_TYPE.DEMAND_DISCOVERY,
    site_key: String(cell_(row, col, '站点') || '').trim(),
    game_name: String(cell_(row, col, '游戏') || '').trim(),
    site: String(cell_(row, col, '站点') || '').trim(),
    game: String(cell_(row, col, '游戏') || '').trim(),
    aliases: Array.isArray(seedTerms) ? seedTerms.slice(1) : [],
    lookback_hours: lookbackHours,
    trigger_type: String(cell_(row, col, '触发类型') || '').trim(),
    radar_id: String(cell_(row, col, '雷达ID') || '').trim(),
    anchor_page: String(cell_(row, col, '锚点页面') || '').trim(),
    source_signal_summary: String(cell_(row, col, '信号摘要') || '').trim(),
    discovery_cycle_date: cycleDate,
    discovery_scope: discoveryScope && typeof discoveryScope === 'object' ? discoveryScope : {},
    seed_terms: Array.isArray(seedTerms) ? seedTerms : [],
    source_families_requested: safeJsonParse_(cell_(row, col, '来源族请求') || '', []),
    created_at: createdAt
  };
}

/**
 * DEMAND_DISCOVERY (GAME_WIDE scope) Callback Handler。
 * 第一版只更新「研究任务」行，不写「需求雷达」。
 */
function handleGameWideDiscoveryCallback_(payload) {
  payload = payload || {};
  var jobId = String(payload.job_id || '').trim();
  if (!jobId) return { ok: false, error: 'missing_job_id' };

  var executionStatus = String(payload.execution_status || '').trim().toUpperCase();
  if (executionStatus !== 'COMPLETED' && executionStatus !== 'FAILED') {
    return { ok: false, error: 'invalid_execution_status' };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { ok: false, error: 'no_spreadsheet' };

  var jobSheet = ss.getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!jobSheet) return { ok: false, error: 'research_jobs_missing' };

  ensureResearchJobResultColumns_(jobSheet);

  var lastCol = Math.max(jobSheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = jobSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);

  var found = findResearchJobRowById_(jobSheet, col, jobId);
  if (!found) return { ok: false, error: 'job_not_found', job_id: jobId };

  var jobRow = jobSheet.getRange(found.sheetRow, 1, 1, lastCol).getValues()[0];
  var completedAt = new Date();
  var row = jobRow.slice();

  if (executionStatus === 'FAILED') {
    row[col['任务状态']] = RESEARCH_JOB_STATUS_LABELS[RESEARCH_JOB_STATUS.FAILED] || '失败';
    if (col['错误信息'] !== undefined) row[col['错误信息']] = String(payload.error || '').trim();
    if (col['完成时间'] !== undefined) row[col['完成时间']] = completedAt;
  } else {
    // COMPLETED
    row[col['任务状态']] = RESEARCH_JOB_STATUS_LABELS[RESEARCH_JOB_STATUS.DISCOVERY_DONE] || '需求发现完成';
    if (col['证据数量'] !== undefined) row[col['证据数量']] = Number(payload.evidence_count || 0) || 0;
    if (col['结果路径'] !== undefined) row[col['结果路径']] = String(payload.result_path || '').trim();
    if (col['完成时间'] !== undefined) row[col['完成时间']] = completedAt;
    if (col['研究结果'] !== undefined) {
      var summary = 'clusters=' + (payload.cluster_count || 0);
      var dc = payload.decision_counts || {};
      if (dc.NEW || dc.EXPAND) summary += ' new=' + (dc.NEW || 0) + ' expand=' + (dc.EXPAND || 0);
      row[col['研究结果']] = summary;
    }
    if (col['错误信息'] !== undefined) row[col['错误信息']] = '';
  }

  jobSheet.getRange(found.sheetRow, 1, 1, lastCol).setValues([row]);
  enqueueReadyResearchRecommendationJobs_();
  var merge = null;
  if (executionStatus === 'COMPLETED' && typeof runExternalOpportunityMergeM0 === 'function') {
    try {
      merge = runExternalOpportunityMergeM0(payload);
    } catch (mergeErr) {
      merge = { ok: false, error: String(mergeErr && mergeErr.message || mergeErr) };
      writeLog_('WARN', '', 'GAME_WIDE Opportunity Merge M0 skipped: ' + merge.error);
    }
  }
  return { ok: true, job_id: jobId, status: executionStatus, opportunity_merge: merge };
}

// ---------------------------------------------------------------------------
// R3A — SEARCH_DEMAND Callback Receiver（本阶段只定义 contract / 纯函数；不制造生产 callback）
// ---------------------------------------------------------------------------

function uniqueTrimmedList_(input) {
  var list = input;
  if (list === null || list === undefined) list = [];
  if (Object.prototype.toString.call(list) !== '[object Array]') list = [list];
  var seen = {};
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var s = String(list[i] || '').trim();
    if (!s) continue;
    var key = s.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    out.push(s);
  }
  return out;
}

function allowedSearchSourceSet_() {
  var list =
    typeof SEARCH_SOURCES_REQUESTED !== 'undefined' && SEARCH_SOURCES_REQUESTED
      ? SEARCH_SOURCES_REQUESTED
      : [
          'GOOGLE_AUTOCOMPLETE',
          'GOOGLE_PAA',
          'GOOGLE_RELATED',
          'BING_AUTOCOMPLETE'
        ];
  var set = {};
  for (var i = 0; i < list.length; i++) {
    var key = String(list[i] || '').trim().toUpperCase();
    if (key) set[key] = true;
  }
  return set;
}

function allowedSearchSources_(input) {
  var allowed = allowedSearchSourceSet_();
  var raw = uniqueTrimmedList_(input);
  var out = [];
  var seen = {};
  for (var i = 0; i < raw.length; i++) {
    var s = String(raw[i] || '').trim().toUpperCase();
    if (!s || !allowed[s] || seen[s]) continue;
    seen[s] = true;
    out.push(s);
  }
  return out;
}

function normalizeSearchDemandStatusLabel_(v) {
  var s = String(v || '').trim().toUpperCase();
  if (s === SEARCH_DEMAND_STATUS.NO_SIGNAL) return SEARCH_DEMAND_STATUS.NO_SIGNAL;
  if (s === SEARCH_DEMAND_STATUS.CONFIRMED) return SEARCH_DEMAND_STATUS.CONFIRMED;
  return '';
}

function searchDemandEvidenceCount_(payload) {
  var n = Number(payload && payload.search_evidence_count);
  if (isNaN(n) || n < 0) return 0;
  return n;
}

function searchDemandResultSummary_(payload) {
  payload = payload || {};
  return {
    search_demand_status: normalizeSearchDemandStatusLabel_(payload.search_demand_status),
    discovery_scope: normalizeDiscoveryScopeLabel_(payload.discovery_scope),
    search_evidence_count: searchDemandEvidenceCount_(payload),
    search_sources: uniqueTrimmedList_(payload.search_sources),
    matched_queries: uniqueTrimmedList_(payload.matched_queries),
    top_questions: uniqueTrimmedList_(payload.top_questions)
  };
}

function canConfirmSearchDemand_(payload) {
  payload = payload || {};
  return (
    normalizeDiscoveryScopeLabel_(payload.discovery_scope) === 'ANCHOR' &&
    normalizeSearchDemandStatusLabel_(payload.search_demand_status) ===
      SEARCH_DEMAND_STATUS.CONFIRMED &&
    searchDemandEvidenceCount_(payload) > 0 &&
    allowedSearchSources_(payload.search_sources).length > 0
  );
}

function validateSearchDemandCompletedPayload_(payload) {
  payload = payload || {};
  if (!normalizeSearchDemandStatusLabel_(payload.search_demand_status)) {
    return { ok: false, error: 'invalid_search_demand_status' };
  }
  if (!normalizeDiscoveryScopeLabel_(payload.discovery_scope)) {
    return { ok: false, error: 'invalid_discovery_scope' };
  }
  if (
    normalizeSearchDemandStatusLabel_(payload.search_demand_status) ===
    SEARCH_DEMAND_STATUS.CONFIRMED
  ) {
    if (
      searchDemandEvidenceCount_(payload) <= 0 ||
      allowedSearchSources_(payload.search_sources).length === 0
    ) {
      return { ok: false, error: 'invalid_search_confirmation' };
    }
  }
  return { ok: true };
}

function validateSearchDemandJobIdentity_(jobRow, jobCol, payload) {
  var radarId = String(payload.radar_id || '').trim();
  var cycleDate = normalizeDemandDiscoveryDate_(payload.search_cycle_date);

  var jobResearchType = String(cell_(jobRow, jobCol, '研究类型') || '').trim();
  var jobRadarId = String(cell_(jobRow, jobCol, '雷达ID') || '').trim();
  var jobCycleDate = normalizeDemandDiscoveryDate_(
    cell_(jobRow, jobCol, '发现周期日期')
  );

  if (jobResearchType !== RESEARCH_TYPE.SEARCH_DEMAND) {
    return { ok: false, error: 'job_research_type_mismatch' };
  }
  if (!jobRadarId || !jobCycleDate) {
    return { ok: false, error: 'job_missing_identity_fields' };
  }
  if (jobRadarId !== radarId) return { ok: false, error: 'radar_id_mismatch' };
  if (jobCycleDate !== cycleDate) {
    return { ok: false, error: 'search_cycle_date_mismatch' };
  }
  return { ok: true };
}

function applySearchDemandCallbackToResearchJobRow_(
  jobRow,
  jobCol,
  payload,
  completedAt
) {
  var row = (jobRow || []).slice();

  var executionStatus = String(payload.execution_status || '').trim().toUpperCase();
  if (executionStatus === 'FAILED') {
    row[jobCol['任务状态']] = RESEARCH_JOB_STATUS_LABELS[RESEARCH_JOB_STATUS.FAILED] || '失败';
    row[jobCol['错误信息']] = String(payload.error || '').trim();
    return row;
  }

  var searchStatus = normalizeSearchDemandStatusLabel_(payload.search_demand_status);
  var nextStatus = RESEARCH_JOB_STATUS.SEARCH_CONFIRMED;
  if (searchStatus === SEARCH_DEMAND_STATUS.NO_SIGNAL) {
    nextStatus = RESEARCH_JOB_STATUS.SEARCH_NO_SIGNAL;
  }
  var summary = searchDemandResultSummary_(payload);

  row[jobCol['任务状态']] = RESEARCH_JOB_STATUS_LABELS[nextStatus] || '';
  if (jobCol['证据数量'] !== undefined) row[jobCol['证据数量']] = summary.search_evidence_count;
  if (jobCol['结果路径'] !== undefined) row[jobCol['结果路径']] = String(payload.result_path || '').trim();
  if (jobCol['研究结果'] !== undefined) row[jobCol['研究结果']] = JSON.stringify(summary);
  if (jobCol['完成时间'] !== undefined) row[jobCol['完成时间']] = completedAt;
  if (jobCol['错误信息'] !== undefined) row[jobCol['错误信息']] = '';
  return row;
}

function applySearchDemandCallbackToDemandRadarRow_(
  radarRow,
  radarCol,
  payload,
  completedAt
) {
  var row = (radarRow || []).slice();
  while (row.length < DEMAND_RADAR_HEADERS.length) row.push('');

  if (String(payload.execution_status || '').trim().toUpperCase() === 'FAILED') return row;

  var discoveryScope = normalizeDiscoveryScopeLabel_(payload.discovery_scope);
  // GAME_WIDE：只允许 Job 保存 summary，不得加入 SEARCH / 不得 Search CONFIRMED。
  if (discoveryScope !== 'ANCHOR') return row;

  var existingSerp = radarCol['SERP缺口状态'] !== undefined ? row[radarCol['SERP缺口状态']] : '';
  var existingFamilies = row[radarCol['来源族']] || '';
  var existingCross = row[radarCol['交叉验证']];
  var existingConfidence = String(row[radarCol['机会置信度']] || '').trim();
  var existingRadarStatus = String(row[radarCol['雷达状态']] || '').trim();

  if (canConfirmSearchDemand_(payload)) {
    var mergedFamilies = normalizeSourceFamilies_([existingFamilies, SOURCE_FAMILY.SEARCH]);
    var familyCount = mergedFamilies.length;
    var crossValidated = isCrossValidated_(mergedFamilies);
    row[radarCol['来源族']] = formatRadarSourceFamilies_(mergedFamilies);
    row[radarCol['独立来源族数']] = familyCount;
    row[radarCol['交叉验证']] = existingCross === true || radarBool_(existingCross) || crossValidated;
    row[radarCol['搜索需求状态']] = SEARCH_DEMAND_STATUS.CONFIRMED;
    row[radarCol['机会置信度']] = maxOpportunityConfidence_(
      existingConfidence,
      OPPORTUNITY_CONFIDENCE.SEARCH_CONFIRMED
    );
    row[radarCol['雷达状态']] = RADAR_STATUS.VALIDATED;
  } else if (
    normalizeSearchDemandStatusLabel_(payload.search_demand_status) ===
    SEARCH_DEMAND_STATUS.NO_SIGNAL
  ) {
    row[radarCol['搜索需求状态']] = SEARCH_DEMAND_STATUS.NO_SIGNAL;
    if (existingRadarStatus !== RADAR_STATUS.VALIDATED) {
      var hasHigher =
        opportunityConfidenceRank_(existingConfidence) >=
        opportunityConfidenceRank_(OPPORTUNITY_CONFIDENCE.CROSS_VALIDATED);
      if (!hasHigher) row[radarCol['雷达状态']] = RADAR_STATUS.WATCH;
    }
  }

  if (radarCol['最近搜索需求时间'] !== undefined) {
    row[radarCol['最近搜索需求时间']] = completedAt;
  }
  if (radarCol['SERP缺口状态'] !== undefined) {
    row[radarCol['SERP缺口状态']] = existingSerp;
  }
  return row;
}

function handleSearchDemandCallback_(payload) {
  payload = payload || {};
  var jobId = String(payload.job_id || '').trim();
  if (!jobId) return { ok: false, error: 'missing_job_id' };

  var radarId = String(payload.radar_id || '').trim();
  var cycleDate = String(payload.search_cycle_date || '').trim();
  if (!radarId) return { ok: false, error: 'missing_radar_id' };
  if (!cycleDate) return { ok: false, error: 'missing_search_cycle_date' };

  var executionStatus = String(payload.execution_status || '').trim().toUpperCase();
  if (executionStatus !== 'COMPLETED' && executionStatus !== 'FAILED') {
    return { ok: false, error: 'invalid_execution_status' };
  }

  if (executionStatus === 'COMPLETED') {
    var completedCheck = validateSearchDemandCompletedPayload_(payload);
    if (!completedCheck.ok) return { ok: false, error: completedCheck.error };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { ok: false, error: 'no_spreadsheet' };

  var jobSheet = ss.getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!jobSheet) return { ok: false, error: 'research_jobs_missing' };
  var radarSheet = ss.getSheetByName(SHEET_NAMES.DEMAND_RADAR);
  if (!radarSheet) return { ok: false, error: 'demand_radar_missing' };

  ensureResearchJobResultColumns_(jobSheet);
  ensureDemandRadarHeader_();

  var jobLastCol = Math.max(jobSheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var jobHeader = jobSheet.getRange(1, 1, 1, jobLastCol).getValues()[0];
  var jobCol = headerIndexMap_(jobHeader);

  var found = findResearchJobRowById_(jobSheet, jobCol, jobId);
  if (!found) return { ok: false, error: 'job_not_found', job_id: jobId };

  var jobRow = jobSheet
    .getRange(found.sheetRow, 1, 1, jobLastCol)
    .getValues()[0];

  var idCheck = validateSearchDemandJobIdentity_(jobRow, jobCol, payload);
  if (!idCheck.ok) return { ok: false, error: idCheck.error };

  var completedAt = new Date();

  var nextJobRow = applySearchDemandCallbackToResearchJobRow_(
    jobRow,
    jobCol,
    payload,
    completedAt
  );
  jobSheet.getRange(found.sheetRow, 1, 1, jobLastCol).setValues([nextJobRow]);

  if (executionStatus === 'FAILED') {
    enqueueReadyResearchRecommendationJobs_();
    return { ok: true, job_id: jobId, status: 'FAILED' };
  }

  var radarLastCol = Math.max(radarSheet.getLastColumn(), DEMAND_RADAR_HEADERS.length);
  var radarHeader = radarSheet.getRange(1, 1, 1, radarLastCol).getValues()[0];
  var radarCol = headerIndexMap_(radarHeader);

  var radarRows = radarSheet.getRange(2, 1, radarSheet.getLastRow() - 1, radarLastCol).getValues();
  for (var i = 0; i < radarRows.length; i++) {
    var r = radarRows[i];
    if (String(r[radarCol['雷达ID']] || '').trim() !== radarId) continue;

    var nextRadarRow = applySearchDemandCallbackToDemandRadarRow_(
      r,
      radarCol,
      payload,
      completedAt
    );
    radarSheet.getRange(i + 2, 1, 1, radarLastCol).setValues([nextRadarRow]);
    break;
  }

  enqueueReadyResearchRecommendationJobs_();

  return {
    ok: true,
    job_id: jobId,
    status: 'COMPLETED',
    search_demand_status: normalizeSearchDemandStatusLabel_(payload.search_demand_status)
  };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function parsePostJson_(e) {
  if (!e || !e.postData || e.postData.contents == null) return null;
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    return null;
  }
}

function checkResearchWriteToken_(e, body) {
  var expected = PropertiesService.getScriptProperties().getProperty(
    RESEARCH_JOB_WRITE_TOKEN_PROP
  );
  if (!expected) return false;
  var provided = '';
  if (body && body.token != null) provided = String(body.token).trim();
  if (!provided && e && e.parameter && e.parameter.token != null) {
    provided = String(e.parameter.token).trim();
  }
  return provided !== '' && provided === expected;
}

/**
 * 轮换 Research callback token。由 clasp run 传入，不把 token 写进仓库。
 * @param {string} token
 */
function rotateResearchWriteToken(token) {
  token = String(token || '').trim();
  if (!token) return { ok: false, error: 'empty_token' };
  PropertiesService.getScriptProperties().setProperty(
    RESEARCH_JOB_WRITE_TOKEN_PROP,
    token
  );
  return { ok: true, key: RESEARCH_JOB_WRITE_TOKEN_PROP };
}

/** 仅当未配置时生成 token，不进仓库。 */
function initResearchWriteToken_() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty(RESEARCH_JOB_WRITE_TOKEN_PROP);
  if (existing) {
    return { ok: false, error: 'already_configured' };
  }
  var token = Utilities.getUuid().replace(/-/g, '');
  props.setProperty(RESEARCH_JOB_WRITE_TOKEN_PROP, token);
  return { ok: true, token: token };
}

/**
 * 按 job_id 回写研究任务结果。不存在则 error，不新增行。
 * REVIEW + evidence：幂等写入「研究审核」，并回写审核摘要 / 审核链接。
 * WATCH：证据不足继续观察；不写「研究审核」，审核链接清空。
 * 旧 payload（无 evidence / review_summary）：仍更新状态与结果字段，不删已有审核证据。
 * FAILED：不写 Evidence 行。
 * @param {Object} body
 * @return {Object}
 */
function writeResearchJobResult_(body) {
  var jobId = String((body && body.job_id) || '').trim();
  if (!jobId) return { ok: false, error: 'missing_job_id' };

  var statusEnum = String((body && body.status) || '').trim();
  if (
    statusEnum !== RESEARCH_JOB_STATUS.REVIEW &&
    statusEnum !== RESEARCH_JOB_STATUS.WATCH &&
    statusEnum !== RESEARCH_JOB_STATUS.FAILED
  ) {
    return { ok: false, error: 'invalid_status' };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { ok: false, error: 'no_spreadsheet' };
  var sheet = ss.getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet) return { ok: false, error: 'sheet_missing' };

  ensureResearchJobResultColumns_(sheet);
  SpreadsheetApp.flush();

  var lastCol = Math.max(sheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  if (col['任务ID'] === undefined) return { ok: false, error: 'missing_job_id_column' };

  var found = findResearchJobRowById_(sheet, col, jobId);
  if (!found) return { ok: false, error: 'job_not_found', job_id: jobId };
  var jobRow = sheet.getRange(found.sheetRow, 1, 1, lastCol).getValues()[0];

  var completedAt = new Date();
  var statusLabel = opportunityLabel_(RESEARCH_JOB_STATUS_LABELS, statusEnum);
  var recEnum = '';
  var recLabel = '';
  var evidenceCount = '';
  var resultPath = '';
  var errorMsg = '';
  var reviewSummary = '';
  var reviewLink = '';
  var wroteEvidence = false;
  var evidenceRowsWritten = 0;

  if (statusEnum === RESEARCH_JOB_STATUS.FAILED) {
    errorMsg = String((body && body.error) || '').trim();
  } else if (statusEnum === RESEARCH_JOB_STATUS.WATCH) {
    // 证据不足：更新任务行，绝不写入「研究审核」。
    recEnum = String((body && body.recommendation) || 'WATCH').trim() || 'WATCH';
    if (!RESEARCH_RESULT_RECOMMENDATION_LABELS[recEnum]) {
      return { ok: false, error: 'invalid_recommendation' };
    }
    recLabel = opportunityLabel_(RESEARCH_RESULT_RECOMMENDATION_LABELS, recEnum);
    if (body && body.evidence_count != null && body.evidence_count !== '') {
      evidenceCount = Number(body.evidence_count);
      if (isNaN(evidenceCount)) return { ok: false, error: 'invalid_evidence_count' };
    } else {
      evidenceCount = 0;
    }
    resultPath = String((body && body.result_path) || '').trim();
    if (body && body.review_summary != null) {
      reviewSummary = String(body.review_summary || '').trim();
    }
    reviewLink = '';
  } else {
    recEnum = String((body && body.recommendation) || '').trim();
    if (recEnum && !RESEARCH_RESULT_RECOMMENDATION_LABELS[recEnum]) {
      return { ok: false, error: 'invalid_recommendation' };
    }
    recLabel = recEnum
      ? opportunityLabel_(RESEARCH_RESULT_RECOMMENDATION_LABELS, recEnum)
      : '';
    if (body && body.evidence_count != null && body.evidence_count !== '') {
      evidenceCount = Number(body.evidence_count);
      if (isNaN(evidenceCount)) return { ok: false, error: 'invalid_evidence_count' };
    }
    resultPath = String((body && body.result_path) || '').trim();
    if (body && body.review_summary != null) {
      reviewSummary = String(body.review_summary || '').trim();
    }

    if (body && Object.prototype.toString.call(body.evidence) === '[object Array]') {
      var reviewResult = writeResearchReviewEvidence_(ss, {
        jobId: jobId,
        site: String(cell_(jobRow, col, '站点') || '').trim(),
        game: String(cell_(jobRow, col, '游戏') || cell_(jobRow, col, '站点') || '').trim(),
        topic: String(cell_(jobRow, col, '搜索词 / topic') || '').trim(),
        pagePath: String(cell_(jobRow, col, '页面路径') || '').trim(),
        evidence: body.evidence,
        researchedAt: completedAt
      });
      wroteEvidence = true;
      evidenceRowsWritten = reviewResult.rows;
      reviewLink = reviewResult.link || '';
    }
  }

  setCellIf_(sheet, found.sheetRow, col, '任务状态', statusLabel);
  setCellIf_(sheet, found.sheetRow, col, '研究结果', recLabel);
  setCellIf_(sheet, found.sheetRow, col, '证据数量', evidenceCount);
  setCellIf_(sheet, found.sheetRow, col, '结果路径', resultPath);
  setCellIf_(sheet, found.sheetRow, col, '完成时间', completedAt);
  setCellIf_(sheet, found.sheetRow, col, '错误信息', errorMsg);
  if (statusEnum === RESEARCH_JOB_STATUS.REVIEW) {
    if (body && body.review_summary != null) {
      setCellIf_(sheet, found.sheetRow, col, '审核摘要', reviewSummary);
    }
    if (wroteEvidence) {
      setCellIf_(sheet, found.sheetRow, col, '审核链接', reviewLink);
    }
  } else if (statusEnum === RESEARCH_JOB_STATUS.WATCH) {
    if (body && body.review_summary != null) {
      setCellIf_(sheet, found.sheetRow, col, '审核摘要', reviewSummary);
    }
    setCellIf_(sheet, found.sheetRow, col, '审核链接', '');
  }
  var contentDecision = null;
  if (statusEnum !== RESEARCH_JOB_STATUS.FAILED) {
    contentDecision = buildContentDecisionFromResearchPayload_(
      jobRow,
      col,
      body || {},
      statusEnum,
      recEnum,
      evidenceCount,
      reviewSummary,
      completedAt
    );
    if (contentDecision) {
      writeContentDecisionToResearchJobRow_(sheet, found.sheetRow, col, contentDecision);
    }
  }
  SpreadsheetApp.flush();

  var developmentTask = null;
  if (contentDecision && typeof createDevelopmentTaskFromContentDecision_ === 'function') {
    developmentTask = createDevelopmentTaskFromContentDecision_(jobRow, col, contentDecision, completedAt);
  }

  return {
    ok: true,
    job_id: jobId,
    status: statusEnum,
    recommendation: recEnum || null,
    evidence_count: evidenceCount === '' ? null : evidenceCount,
    result_path: resultPath || null,
    review_summary: reviewSummary || null,
    evidence_rows: wroteEvidence ? evidenceRowsWritten : null,
    review_link: wroteEvidence ? reviewLink || null : null,
    content_decision: contentDecision,
    development_task: developmentTask,
    completed_at: toIso8601_(completedAt),
    display: {
      任务状态: statusLabel,
      研究结果: recLabel,
      证据数量: evidenceCount === '' ? '' : evidenceCount,
      结果路径: resultPath,
      完成时间: toIso8601_(completedAt),
      错误信息: errorMsg,
      审核摘要: reviewSummary,
      审核链接: reviewLink,
      DecisionID: contentDecision ? contentDecision.decisionId : '',
      PrimaryDecision: contentDecision ? contentDecision.primaryDecision : '',
      Confidence: contentDecision ? contentDecision.confidence : ''
    }
  };
}

function buildContentDecisionFromResearchPayload_(jobRow, col, body, statusEnum, recEnum, evidenceCount, reviewSummary, createdAt) {
  var researchType = String(cell_(jobRow, col, '研究类型') || '').trim();
  if (!ACTION_RESEARCH_TYPES[researchType]) return null;
  var context = safeJsonParse_(cell_(jobRow, col, 'ActionContext'), {});
  var raw = body.content_decision || body.contentDecision || {};
  var primary = String(raw.primary_decision || raw.primaryDecision || '').trim().toUpperCase();
  if (!contentDecisionPrimaryAllowed_(researchType, primary)) {
    primary = fallbackContentDecisionPrimary_(researchType, recEnum, statusEnum);
  }
  var secondary = normalizeContentDecisionList_(raw.secondary_actions || raw.secondaryActions);
  var targetQueries = normalizeContentDecisionList_(raw.target_queries || raw.targetQueries);
  if (!targetQueries.length) targetQueries = context.clusterQueries || [];
  var sections = normalizeContentDecisionList_(raw.recommended_sections || raw.recommendedSections);
  var confidence = String(raw.confidence || '').trim().toUpperCase();
  if (confidence !== 'HIGH' && confidence !== 'MEDIUM' && confidence !== 'LOW') {
    confidence = Number(evidenceCount || 0) >= 5 ? 'HIGH' : Number(evidenceCount || 0) >= 2 ? 'MEDIUM' : 'LOW';
  }
  var decisionId = String(raw.decision_id || raw.decisionId || '').trim();
  if (!decisionId) decisionId = contentDecisionIdFromJob_(String(cell_(jobRow, col, '任务ID') || '').trim());
  return {
    decisionId: decisionId,
    site: String(cell_(jobRow, col, '站点') || '').trim(),
    sourceAction: String(cell_(jobRow, col, 'SourceAction') || '').trim(),
    researchType: researchType,
    clusterKey: String(context.clusterKey || '').trim(),
    pagePath: String(context.pagePath || cell_(jobRow, col, '页面路径') || '').trim(),
    primaryDecision: primary,
    secondaryActions: secondary,
    decisionReason: String(raw.decision_reason || raw.decisionReason || reviewSummary || '').trim(),
    evidenceSummary: String(raw.evidence_summary || raw.evidenceSummary || reviewSummary || '').trim(),
    evidenceCount: Number(evidenceCount || raw.evidence_count || 0),
    targetQueries: targetQueries,
    recommendedSections: sections,
    recommendedTitleChange: String(raw.recommended_title_change || raw.recommendedTitleChange || '').trim(),
    recommendedInternalLinks: normalizeContentDecisionList_(raw.recommended_internal_links || raw.recommendedInternalLinks),
    confidence: confidence,
    createdAt: createdAt || new Date()
  };
}

function contentDecisionPrimaryAllowed_(researchType, primary) {
  if (!primary) return false;
  if (researchType === RESEARCH_TYPE.NEW_INTENT_RESEARCH) {
    return primary === CONTENT_DECISION_PRIMARY_ACTIONS.CREATE_NEW_PAGE ||
      primary === CONTENT_DECISION_PRIMARY_ACTIONS.EXPAND_EXISTING ||
      primary === CONTENT_DECISION_PRIMARY_ACTIONS.MERGE_WITH_EXISTING ||
      primary === CONTENT_DECISION_PRIMARY_ACTIONS.WATCH ||
      primary === CONTENT_DECISION_PRIMARY_ACTIONS.REJECT_NOISE;
  }
  if (researchType === RESEARCH_TYPE.PAGE_OPTIMIZATION_RESEARCH) {
    return primary === CONTENT_DECISION_PRIMARY_ACTIONS.EXPAND_EXISTING ||
      primary === CONTENT_DECISION_PRIMARY_ACTIONS.REWRITE_SECTION ||
      primary === CONTENT_DECISION_PRIMARY_ACTIONS.IMPROVE_TITLE_SNIPPET ||
      primary === CONTENT_DECISION_PRIMARY_ACTIONS.ADD_FAQ ||
      primary === CONTENT_DECISION_PRIMARY_ACTIONS.ADD_ENTITY_SECTION ||
      primary === CONTENT_DECISION_PRIMARY_ACTIONS.ADD_COMPARISON ||
      primary === CONTENT_DECISION_PRIMARY_ACTIONS.ADD_STEPS ||
      primary === CONTENT_DECISION_PRIMARY_ACTIONS.NO_CHANGE ||
      primary === CONTENT_DECISION_PRIMARY_ACTIONS.WATCH;
  }
  return primary === CONTENT_DECISION_PRIMARY_ACTIONS.KEEP_BOTH ||
    primary === CONTENT_DECISION_PRIMARY_ACTIONS.CONSOLIDATE ||
    primary === CONTENT_DECISION_PRIMARY_ACTIONS.REDIRECT_SECONDARY ||
    primary === CONTENT_DECISION_PRIMARY_ACTIONS.REFOCUS_SECONDARY ||
    primary === CONTENT_DECISION_PRIMARY_ACTIONS.FIX_INTERNAL_LINKING ||
    primary === CONTENT_DECISION_PRIMARY_ACTIONS.WATCH;
}

function fallbackContentDecisionPrimary_(researchType, recommendation, statusEnum) {
  if (statusEnum === RESEARCH_JOB_STATUS.WATCH || recommendation === RESEARCH_RESULT_RECOMMENDATIONS.WATCH) {
    return CONTENT_DECISION_PRIMARY_ACTIONS.WATCH;
  }
  if (researchType === RESEARCH_TYPE.NEW_INTENT_RESEARCH) {
    return recommendation === RESEARCH_RESULT_RECOMMENDATIONS.NEW_CONTENT
      ? CONTENT_DECISION_PRIMARY_ACTIONS.CREATE_NEW_PAGE
      : CONTENT_DECISION_PRIMARY_ACTIONS.EXPAND_EXISTING;
  }
  if (researchType === RESEARCH_TYPE.PAGE_OPTIMIZATION_RESEARCH) {
    return CONTENT_DECISION_PRIMARY_ACTIONS.EXPAND_EXISTING;
  }
  return CONTENT_DECISION_PRIMARY_ACTIONS.KEEP_BOTH;
}

function normalizeContentDecisionList_(value) {
  var list = value;
  if (list === null || list === undefined || list === '') return [];
  if (Object.prototype.toString.call(list) !== '[object Array]') list = [list];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (item && typeof item === 'object') item = item.query || item.question || item.title || item.text || '';
    item = String(item || '').trim();
    if (item && out.indexOf(item) < 0) out.push(item);
  }
  return out;
}

function contentDecisionIdFromJob_(jobId) {
  var slug = String(jobId || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return 'content-decision-' + (slug || 'unknown-job');
}

function writeContentDecisionToResearchJobRow_(sheet, sheetRow, col, decision) {
  setCellIf_(sheet, sheetRow, col, 'DecisionID', decision.decisionId);
  setCellIf_(sheet, sheetRow, col, 'PrimaryDecision', decision.primaryDecision);
  setCellIf_(sheet, sheetRow, col, 'SecondaryActions', JSON.stringify(decision.secondaryActions || []));
  setCellIf_(sheet, sheetRow, col, 'DecisionReason', decision.decisionReason);
  setCellIf_(sheet, sheetRow, col, 'EvidenceSummary', decision.evidenceSummary);
  setCellIf_(sheet, sheetRow, col, 'TargetQueries', JSON.stringify(decision.targetQueries || []));
  setCellIf_(sheet, sheetRow, col, 'RecommendedSections', JSON.stringify(decision.recommendedSections || []));
  setCellIf_(sheet, sheetRow, col, 'RecommendedTitleChange', decision.recommendedTitleChange);
  setCellIf_(sheet, sheetRow, col, 'RecommendedInternalLinks', JSON.stringify(decision.recommendedInternalLinks || []));
  setCellIf_(sheet, sheetRow, col, 'Confidence', decision.confidence);
  setCellIf_(sheet, sheetRow, col, 'DecisionCreatedAt', decision.createdAt);
}

/**
 * 幂等写入「研究审核」：先删同 job_id 旧行，再追加本批 evidence。
 * @param {Spreadsheet} ss
 * @param {Object} opts
 * @return {{rows:number, link:string, startRow:number, endRow:number}}
 */
function writeResearchReviewEvidence_(ss, opts) {
  var reviewSheet = ensureResearchReviewSheet_();
  ensureResearchReviewHeader_(reviewSheet);
  SpreadsheetApp.flush();

  var lastCol = Math.max(reviewSheet.getLastColumn(), RESEARCH_REVIEW_HEADERS.length);
  var header = reviewSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  if (col['任务ID'] === undefined) {
    throw new Error('研究审核缺少列: 任务ID');
  }

  deleteResearchReviewRowsForJob_(reviewSheet, col, opts.jobId);

  var rows = [];
  var list = opts.evidence || [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i] || {};
    var relevance = '';
    if (item.relevance != null && item.relevance !== '') {
      var relNum = Number(item.relevance);
      relevance = isNaN(relNum) ? String(item.relevance) : relNum;
    }
    rows.push([
      opts.jobId,
      opts.site || '',
      opts.game || '',
      opts.topic || '',
      opts.pagePath || '',
      formatResearchEvidenceSource_(item.source),
      String(item.discovered_topic || '').trim(),
      String(item.player_question || '').trim(),
      truncateResearchEvidenceExcerpt_(item.evidence),
      String(item.url || '').trim(),
      relevance,
      opts.researchedAt || new Date()
    ]);
  }

  if (!rows.length) {
    return { rows: 0, link: '', startRow: 0, endRow: 0 };
  }

  var startRow = reviewSheet.getLastRow() + 1;
  if (startRow < 2) startRow = 2;
  reviewSheet
    .getRange(startRow, 1, rows.length, RESEARCH_REVIEW_HEADERS.length)
    .setValues(rows);
  var endRow = startRow + rows.length - 1;
  var link = buildResearchReviewLink_(ss, reviewSheet, startRow, endRow);
  return { rows: rows.length, link: link, startRow: startRow, endRow: endRow };
}

/** 自底向上删除同 job_id 行，避免行号错位。 */
function deleteResearchReviewRowsForJob_(sheet, col, jobId) {
  if (!sheet || sheet.getLastRow() < 2) return;
  var idCol = col['任务ID'];
  if (idCol === undefined) return;
  var n = sheet.getLastRow() - 1;
  var values = sheet.getRange(2, idCol + 1, n, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0] || '').trim() === jobId) {
      sheet.deleteRow(i + 2);
    }
  }
}

function formatResearchEvidenceSource_(source) {
  var raw = String(source || '').trim();
  if (!raw) return '';
  var key = raw.toLowerCase();
  if (RESEARCH_EVIDENCE_SOURCE_LABELS[key]) {
    return RESEARCH_EVIDENCE_SOURCE_LABELS[key];
  }
  return raw;
}

function truncateResearchEvidenceExcerpt_(text) {
  var s = String(text == null ? '' : text).trim();
  var max = RESEARCH_EVIDENCE_EXCERPT_MAX || 800;
  if (s.length <= max) return s;
  if (max <= 1) return '…';
  return s.substring(0, max - 1) + '…';
}

/**
 * Spreadsheet URL + gid + A1 range → 运营可点的内部审核链接。
 */
function buildResearchReviewLink_(ss, reviewSheet, startRow, endRow) {
  if (!ss || !reviewSheet || !startRow || !endRow || endRow < startRow) return '';
  var base = String(ss.getUrl() || '').replace(/#.*$/, '');
  if (!base) return '';
  var colCount = RESEARCH_REVIEW_HEADERS.length;
  var rangeA1 =
    'A' + startRow + ':' + columnIndexToLetter_(colCount) + endRow;
  return base + '#gid=' + reviewSheet.getSheetId() + '&range=' + rangeA1;
}

function columnIndexToLetter_(colIndex) {
  var n = Number(colIndex) || 0;
  if (n < 1) return 'A';
  var s = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function ensureResearchReviewSheet_() {
  return ensureSheet_(SHEET_NAMES.RESEARCH_REVIEW, RESEARCH_REVIEW_HEADERS);
}

/** 已存在的「研究审核」仅补齐缺失表头列。 */
function ensureResearchReviewHeader_(sheet) {
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var have = {};
  for (var i = 0; i < header.length; i++) {
    var name = String(header[i] || '').trim();
    if (name) have[name] = true;
  }
  var toAdd = [];
  for (var n = 0; n < RESEARCH_REVIEW_HEADERS.length; n++) {
    if (!have[RESEARCH_REVIEW_HEADERS[n]]) toAdd.push(RESEARCH_REVIEW_HEADERS[n]);
  }
  if (!toAdd.length) return;

  var startCol = lastCol + 1;
  if (String(header[header.length - 1] || '').trim() === '') {
    startCol = lastCol;
  }
  ensureSheetGrid_(sheet, 1, startCol + toAdd.length - 1);
  sheet.getRange(1, startCol, 1, toAdd.length).setValues([toAdd]);
  sheet.getRange(1, startCol, 1, toAdd.length).setFontWeight('bold');
}

function setCellIf_(sheet, sheetRow, col, name, value) {
  if (col[name] === undefined) return;
  sheet.getRange(sheetRow, col[name] + 1).setValue(value);
}

function findResearchJobRowById_(sheet, col, jobId) {
  if (!sheet || sheet.getLastRow() < 2) return null;
  var idCol = col['任务ID'];
  if (idCol === undefined) return null;
  var n = sheet.getLastRow() - 1;
  var values = sheet.getRange(2, idCol + 1, n, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === jobId) {
      return { sheetRow: i + 2 };
    }
  }
  return null;
}

/** 只读回读某 job 的显示层字段（验证用）。 */
function readResearchJobDisplay_(jobId) {
  jobId = String(jobId || '').trim();
  if (!jobId) return { ok: false, error: 'missing_job_id' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { ok: false, error: 'no_spreadsheet' };
  var sheet = ss.getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'sheet_empty' };
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var found = findResearchJobRowById_(sheet, col, jobId);
  if (!found) return { ok: false, error: 'job_not_found', job_id: jobId };
  var row = sheet.getRange(found.sheetRow, 1, 1, lastCol).getValues()[0];
  var completed = cell_(row, col, '完成时间');
  var completedAt = '';
  if (Object.prototype.toString.call(completed) === '[object Date]' && !isNaN(completed.getTime())) {
    completedAt = toIso8601_(completed);
  } else {
    completedAt = String(completed || '').trim();
  }
  return {
    ok: true,
    job_id: jobId,
    display: {
      任务状态: String(cell_(row, col, '任务状态') || '').trim(),
      研究结果: String(cell_(row, col, '研究结果') || '').trim(),
      证据数量: cell_(row, col, '证据数量'),
      结果路径: String(cell_(row, col, '结果路径') || '').trim(),
      完成时间: completedAt,
      错误信息: String(cell_(row, col, '错误信息') || '').trim(),
      审核摘要: String(cell_(row, col, '审核摘要') || '').trim(),
      审核链接: String(cell_(row, col, '审核链接') || '').trim(),
      审核决定: String(cell_(row, col, '审核决定') || '').trim(),
      审核备注: String(cell_(row, col, '审核备注') || '').trim(),
      审核时间: formatResearchReviewTime_(cell_(row, col, '审核时间'))
    }
  };
}

/**
 * 只读「研究任务」中 PENDING / 待处理 行。不 ensure、不写日志、不改单元格。
 * @return {Array<Object>}
 */
function loadPendingResearchJobs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return [];
  var sheet = ss.getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var jobs = [];
  for (var i = 0; i < rows.length; i++) {
    if (String(cell_(rows[i], col, '研究类型') || '').trim() === RESEARCH_TYPE.RESEARCH_RECOMMENDATION) {
      continue;
    }
    if (!isResearchJobPending_(String(cell_(rows[i], col, '任务状态') || '').trim())) {
      continue;
    }
    var job = researchJobRowToApi_(rows[i], col);
    if (job && job.job_id) jobs.push(job);
  }
  return jobs;
}

/** M1 Action research queue; kept separate from the legacy content queue. */
function loadPendingActionResearchJobs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return [];
  var sheet = ss.getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var lastCol = Math.max(sheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var jobs = [];
  for (var i = 0; i < rows.length; i++) {
    var researchType = String(cell_(rows[i], col, '研究类型') || '').trim();
    if (!ACTION_RESEARCH_TYPES[researchType]) continue;
    if (!isResearchJobPending_(String(cell_(rows[i], col, '任务状态') || '').trim())) continue;
    var job = researchJobActionRowToApi_(rows[i], col);
    if (job && job.job_id) jobs.push(job);
  }
  return jobs;
}

function isResearchJobPending_(status) {
  var s = String(status || '').trim();
  if (!s) return false;
  if (s === RESEARCH_JOB_STATUS.PENDING) return true;
  if (s === RESEARCH_JOB_STATUS_LABELS.PENDING) return true;
  return enumFromLabel_(RESEARCH_JOB_STATUS_LABELS, s) === RESEARCH_JOB_STATUS.PENDING;
}

function researchJobRowToApi_(row, col) {
  var created = cell_(row, col, '创建时间');
  var createdAt = '';
  if (Object.prototype.toString.call(created) === '[object Date]' && !isNaN(created.getTime())) {
    createdAt = toIso8601_(created);
  } else {
    createdAt = String(created || '').trim();
  }
  var related = [];
  var relatedRaw = String(cell_(row, col, '关联搜索词') || '').trim();
  if (relatedRaw) {
    var parts = relatedRaw.split('|');
    for (var i = 0; i < parts.length; i++) {
      var q = String(parts[i] || '').trim();
      if (q) related.push(q);
    }
  }
  return {
    job_id: String(cell_(row, col, '任务ID') || '').trim(),
    game: String(cell_(row, col, '游戏') || cell_(row, col, '站点') || '').trim(),
    topic: String(cell_(row, col, '搜索词 / topic') || '').trim(),
    existing_page: String(cell_(row, col, '页面路径') || '').trim(),
    opportunity_level: enumFromLabel_(OPPORTUNITY_LEVEL_LABELS, String(cell_(row, col, '机会等级') || '').trim()),
    recommended_action: enumFromLabel_(OPPORTUNITY_ACTION_LABELS, String(cell_(row, col, '建议动作') || '').trim()),
    source_query: String(cell_(row, col, 'source_query') || '').trim(),
    related_queries: related,
    created_at: createdAt
  };
}

function researchJobActionRowToApi_(row, col) {
  var job = researchJobRowToApi_(row, col);
  job.research_type = String(cell_(row, col, '研究类型') || RESEARCH_TYPE.CONTENT_RESEARCH).trim();
  job.source_action = String(cell_(row, col, 'SourceAction') || '').trim();
  job.action_context = safeJsonParse_(cell_(row, col, 'ActionContext'), {});
  return job;
}

function safeJsonParse_(text, fallback) {
  if (text === null || text === undefined) return fallback;
  var raw = String(text || '').trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function parseDemandDiscoveryPageTopicFromAnchorPage_(anchorPage) {
  var p = String(anchorPage || '').trim();
  if (!p) return '';
  if (p.charAt(0) !== '/') p = '/' + p;
  if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.substring(0, p.length - 1);
  var seg = p.split('/').filter(function (s) {
    return !!s;
  });
  if (!seg.length) return '';
  var last = seg[seg.length - 1] || '';
  // 保守：只做“路径最后一段 + '-'→空格”
  last = last.split('?')[0];
  last = last.replace(/-/g, ' ').trim();
  return last || '';
}

function buildDemandDiscoverySeedTerms_(game, pageTopic) {
  var g = String(game || '').trim();
  var t = String(pageTopic || '').trim();
  if (!g) return [];
  var out = [g];
  if (t) out.push(g + ' ' + t);
  // 去重 + 限制 <=5（V1 只会是 1~2 个）
  var seen = {};
  var uniq = [];
  for (var i = 0; i < out.length; i++) {
    var x = String(out[i] || '').trim();
    if (!x) continue;
    if (seen[x]) continue;
    seen[x] = true;
    uniq.push(x);
  }
  return uniq.slice(0, 5);
}

function normalizeDiscoveryCycleDate_(value) {
  var s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  var compact = s.replace(/-/g, '');
  if (/^\d{8}$/.test(compact)) {
    return (
      compact.substring(0, 4) +
      '-' +
      compact.substring(4, 6) +
      '-' +
      compact.substring(6, 8)
    );
  }
  return '';
}

function normalizeDemandDiscoveryDate_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (
    Object.prototype.toString.call(value) === '[object Date]' &&
    !isNaN(value.getTime())
  ) {
    try {
      return Utilities.formatDate(
        value,
        Session.getScriptTimeZone(),
        'yyyy-MM-dd'
      );
    } catch (e) {
      return normalizeDiscoveryCycleDate_(value.toISOString());
    }
  }

  var s = String(value || '').trim();
  if (!s) return '';
  var direct = normalizeDiscoveryCycleDate_(s);
  if (direct) return direct;

  var parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    try {
      return Utilities.formatDate(
        parsed,
        Session.getScriptTimeZone(),
        'yyyy-MM-dd'
      );
    } catch (e2) {
      return normalizeDiscoveryCycleDate_(parsed.toISOString());
    }
  }
  return '';
}

function discoveryCycleDateToYmd_(cycleDate) {
  return normalizeDiscoveryCycleDate_(cycleDate).replace(/-/g, '');
}

/** Stable dedupe: ResearchType + RadarID + DiscoveryCycleDate */
function demandDiscoveryDedupeKey_(radarId, cycleDate) {
  return (
    RESEARCH_TYPE.DEMAND_DISCOVERY +
    '||' +
    String(radarId || '').trim() +
    '||' +
    normalizeDiscoveryCycleDate_(cycleDate)
  );
}

function buildDemandDiscoveryJobId_(radarId, cycleDate) {
  var radar = String(radarId || '').trim();
  var slug = slugifyResearch_(radar);
  if (!slug) slug = 'unknown';
  if (slug.length > 40) slug = slug.substring(0, 40).replace(/-+$/, '');
  var ymd = discoveryCycleDateToYmd_(cycleDate);
  if (!ymd) return 'demand-' + slug;
  return 'demand-' + slug + '-' + ymd;
}

function buildDemandDiscoveryJobContract_(radar, createdAt, cycleDate) {
  // radar：纯对象（用于测试/构建合同）；生产中由 DemandRadar 行解析而来
  radar = radar || {};
  createdAt = createdAt || new Date();

  // created_at：尽量走 toIso8601_（Apps Script）；node 环境没有 toIso8601_ 时回退 String(date)
  var createdAtIso = '';
  if (typeof toIso8601_ === 'function') {
    try {
      createdAtIso = toIso8601_(createdAt);
    } catch (e) {
      createdAtIso = String(createdAt || '').trim();
    }
  } else {
    createdAtIso = String(createdAt || '').trim();
  }

  var discoveryCycleDate = normalizeDiscoveryCycleDate_(
    cycleDate ||
      radar.discovery_cycle_date ||
      radar.discoveryCycleDate ||
      radar.runDate
  );
  var pageTopic = parseDemandDiscoveryPageTopicFromAnchorPage_(radar.anchor_page || radar.anchorPage);
  var seedTerms = buildDemandDiscoverySeedTerms_(radar.game || radar.gameName, pageTopic);

  return {
    job_id:
      String(radar.job_id || radar.jobId || '').trim() ||
      buildDemandDiscoveryJobId_(radar.radar_id || radar.radarId, discoveryCycleDate),
    research_type: RESEARCH_TYPE.DEMAND_DISCOVERY,
    site: String(radar.site || '').trim(),
    game: String(radar.game || radar.gameName || '').trim(),
    radar_id: String(radar.radar_id || radar.radarId || '').trim(),
    opportunity_id:
      String(radar.opportunity_id || radar.opportunityId || '').trim() ||
      buildOpportunityIdFromRadarId_(radar.radar_id || radar.radarId),
    trigger_type: String(radar.trigger_type || radar.triggerType || '').trim(),
    anchor_page: String(radar.anchor_page || radar.anchorPage || '').trim(),
    source_signal_summary: String(
      radar.source_signal_summary || radar.trigger_reason || radar.triggerReason || ''
    ).trim(),
    discovery_scope: {
      page_topic: pageTopic
    },
    seed_terms: seedTerms,
    source_families_requested: ['COMMUNITY', 'VIDEO'],
    discovery_cycle_date: discoveryCycleDate,
    created_at: createdAtIso
  };
}

function isDemandDiscoveryEligible_(radar, opts) {
  opts = opts || {};
  var runDate = opts.runDate || '';
  var recentFoundRaw = radar.recent_found || radar.recentFound || radar.runDate || '';
  var runDateDate = normalizeDemandDiscoveryDate_(runDate);
  var recentFoundDate = normalizeDemandDiscoveryDate_(recentFoundRaw);
  if (runDateDate && recentFoundDate && recentFoundDate !== runDateDate) return false;

  if (String(radar.trigger_type || radar.triggerType || '') !== QUERY_BLIND_SPOT_TRIGGER) return false;
  if (String(radar.signal_status || radar.signalStatus || '') !== RADAR_SIGNAL_STATUS.ACTIVE) return false;
  if (String(radar.radar_status || radar.radarStatus || '') !== RADAR_STATUS.DISCOVERED) return false;
  if (String(radar.opportunity_confidence || radar.opportunityConfidence || '') !== OPPORTUNITY_CONFIDENCE.DISCOVERY_ONLY) return false;
  var crossRaw =
    radar.cross_validated !== undefined ? radar.cross_validated : radar.crossValidated;
  var crossValidated =
    crossRaw === true ||
    String(crossRaw || '').trim().toLowerCase() === 'true' ||
    crossRaw === 1;
  if (crossValidated) return false;

  if (String(radar.research_job_id || radar.researchJobId || '').trim()) return false;
  return true;
}

function chooseBestDemandDiscoveryRadarForSite_(radars) {
  if (!radars || !radars.length) return null;
  var best = null;
  var bestClicks = -1;
  var bestImpr = -1;
  for (var i = 0; i < radars.length; i++) {
    var r = radars[i];
    var c = Number(r.page_clicks7d || r.pageClicks7D || r.pageClicks7d || r.pageClicks || 0);
    var im = Number(r.page_impressions7d || r.pageImpressions7D || r.pageImpressions7d || r.pageImpressions || 0);
    if (isNaN(c)) c = 0;
    if (isNaN(im)) im = 0;
    if (!best) {
      best = r;
      bestClicks = c;
      bestImpr = im;
      continue;
    }
    if (c > bestClicks) {
      best = r;
      bestClicks = c;
      bestImpr = im;
      continue;
    }
    if (c === bestClicks && im > bestImpr) {
      best = r;
      bestClicks = c;
      bestImpr = im;
      continue;
    }
  }
  return best;
}

function discoveryCycleDateFromJobId_(jobId) {
  var m = /-(\d{8})$/.exec(String(jobId || '').trim());
  if (!m) return '';
  return normalizeDiscoveryCycleDate_(m[1]);
}

/** pendingDemandDiscoveryJobs payload（纯转换，便于测试）。 */
function demandDiscoveryRowToApi_(row, col) {
  var created = cell_(row, col, '创建时间');
  var createdAt = '';
  if (Object.prototype.toString.call(created) === '[object Date]' && !isNaN(created.getTime())) {
    createdAt = typeof toIso8601_ === 'function' ? toIso8601_(created) : String(created);
  } else {
    createdAt = String(created || '').trim();
  }

  var jobId = String(cell_(row, col, '任务ID') || '').trim();
  var cycleDate =
    normalizeDiscoveryCycleDate_(cell_(row, col, '发现周期日期')) ||
    discoveryCycleDateFromJobId_(jobId);

  var discoveryScope = safeJsonParse_(cell_(row, col, '发现范围') || '', {});
  var seedTerms = safeJsonParse_(cell_(row, col, '种子词') || '', []);
  var sourceFamiliesRequested = safeJsonParse_(cell_(row, col, '来源族请求') || '', []);

  return {
    job_id: jobId,
    research_type: RESEARCH_TYPE.DEMAND_DISCOVERY,
    site: String(cell_(row, col, '站点') || cell_(row, col, '游戏') || '').trim(),
    game: String(cell_(row, col, '游戏') || '').trim(),
    radar_id: String(cell_(row, col, '雷达ID') || '').trim(),
    opportunity_id: String(cell_(row, col, 'OpportunityID') || '').trim() ||
      buildOpportunityIdFromRadarId_(cell_(row, col, '雷达ID')),
    trigger_type: String(cell_(row, col, '触发类型') || '').trim(),
    anchor_page: String(cell_(row, col, '锚点页面') || '').trim(),
    source_signal_summary: String(cell_(row, col, '信号摘要') || '').trim(),
    discovery_scope: discoveryScope && typeof discoveryScope === 'object' ? discoveryScope : {},
    seed_terms: Array.isArray(seedTerms) ? seedTerms : [],
    source_families_requested: Array.isArray(sourceFamiliesRequested)
      ? sourceFamiliesRequested
      : [],
    discovery_cycle_date: cycleDate,
    created_at: createdAt
  };
}

/**
 * 只读 DEMAND_DISCOVERY：任务状态=READY_FOR_DISCOVERY_RUNNER
 * 该 action 供未来 DEMAND_DISCOVERY runner 使用；旧 runner 只消费 pendingResearchJobs。
 */
function loadDemandDiscoveryReadyJobs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return [];
  var sheet = ss.getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var jobs = [];

  var needStatus = opportunityLabel_(
    RESEARCH_JOB_STATUS_LABELS,
    RESEARCH_JOB_STATUS.READY_FOR_DISCOVERY_RUNNER
  );
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var statusRaw = String(cell_(row, col, '任务状态') || '').trim();
    if (statusRaw !== needStatus && statusRaw !== RESEARCH_JOB_STATUS.READY_FOR_DISCOVERY_RUNNER) {
      continue;
    }

    var researchType = String(cell_(row, col, '研究类型') || '').trim();
    if (researchType !== RESEARCH_TYPE.DEMAND_DISCOVERY) continue;

    var job = demandDiscoveryRowToApi_(row, col);
    if (job && job.job_id) jobs.push(job);
  }
  return jobs;
}

/**
 * DEMAND_DISCOVERY Job 创建：写 Sheet「研究任务」并绑定「需求雷达」。
 * 规则门控：仅 QUERY_BLIND_SPOT + ACTIVE + DISCOVERED + DISCOVERY_ONLY + !CrossValidated + RadarStatus&ResearchJobID 条件。
 */
function createDemandDiscoveryJobs_(opts) {
  opts = opts || {};
  var runDate = opts.runDate || todayStr_();
  ensureResearchJobSheets_();

  var radarRows = loadDemandRadarRows_();
  if (!radarRows || !radarRows.length) {
    return { created: 0, skipped: 0 };
  }

  var radarCol = headerIndexMap_(DEMAND_RADAR_HEADERS);
  var jobSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!jobSheet) return { created: 0, skipped: 0 };

  var lastJobCol = Math.max(jobSheet.getLastColumn(), 1);
  var jobHeader = jobSheet.getRange(1, 1, 1, lastJobCol).getValues()[0];
  var jobCol = headerIndexMap_(jobHeader);
  var jobRows = [];
  if (jobSheet.getLastRow() >= 2) {
    jobRows = jobSheet.getRange(2, 1, jobSheet.getLastRow() - 1, lastJobCol).getValues();
  }

  // 同 ResearchType + RadarID + DiscoveryCycleDate 已存在 → 不重复（含 FAILED，R2A 不自动重试）
  var existingJobIds = {};
  var existingDedupe = {};
  for (var i = 0; i < jobRows.length; i++) {
    var jrow = jobRows[i];
    var jt = String(cell_(jrow, jobCol, '研究类型') || '').trim();
    if (jt !== RESEARCH_TYPE.DEMAND_DISCOVERY) continue;
    var jobId = String(cell_(jrow, jobCol, '任务ID') || '').trim();
    var radarIdExisting = String(cell_(jrow, jobCol, '雷达ID') || '').trim();
    var cycleExisting =
      normalizeDiscoveryCycleDate_(cell_(jrow, jobCol, '发现周期日期')) ||
      discoveryCycleDateFromJobId_(jobId);
    if (jobId) existingJobIds[jobId] = true;
    if (radarIdExisting && cycleExisting) {
      existingDedupe[demandDiscoveryDedupeKey_(radarIdExisting, cycleExisting)] = jobId;
    }
  }

  var eligible = [];
  for (var r = 0; r < radarRows.length; r++) {
    var row = radarRows[r];
    var radarId = String(row[radarCol['雷达ID']] || '').trim();
    if (!radarId) continue;

    var radarObj = {
      radar_id: radarId,
      site: String(row[radarCol['站点']] || '').trim(),
      game: String(row[radarCol['游戏']] || '').trim(),
      anchor_page: String(row[radarCol['锚点页面']] || '').trim(),
      trigger_type: String(row[radarCol['触发类型']] || '').trim(),
      trigger_reason: String(row[radarCol['触发原因']] || '').trim(),
      page_clicks7d: Number(row[radarCol['页面点击7日']] || 0),
      page_impressions7d: Number(row[radarCol['页面曝光7日']] || 0),
      opportunity_confidence: String(row[radarCol['机会置信度']] || '').trim(),
      cross_validated: row[radarCol['交叉验证']],
      signal_status: String(row[radarCol['信号状态']] || '').trim(),
      radar_status: String(row[radarCol['雷达状态']] || '').trim(),
      research_job_id: String(row[radarCol['研究任务ID']] || '').trim(),
      recent_found: String(row[radarCol['最近发现']] || '').trim()
    };

    // 冷却控制/去噪由下面的“每站每日最多 1 个 + 选最大 clicks/impr”承担
    if (!isDemandDiscoveryEligible_(radarObj, { runDate: runDate })) continue;
    eligible.push(radarObj);
  }

  // 每站每日最多 1 个：按 eligibility 后再选 best
  var bySite = {};
  for (var e = 0; e < eligible.length; e++) {
    var s = String(eligible[e].site || '').trim();
    if (!s) continue;
    if (!bySite[s]) bySite[s] = [];
    bySite[s].push(eligible[e]);
  }

  var created = 0;
  var skipped = 0;
  var createdAt = new Date();
  var nowTs = typeof radarNowTs_ === 'function' ? radarNowTs_() : '';

  var toAppend = [];

  for (var siteName in bySite) {
    if (!bySite.hasOwnProperty(siteName)) continue;
    var best = chooseBestDemandDiscoveryRadarForSite_(bySite[siteName]);
    if (!best) continue;

    var radarId = best.radar_id;
    var cycleDate = normalizeDiscoveryCycleDate_(runDate);
    var jobId = buildDemandDiscoveryJobId_(radarId, cycleDate);
    var dedupeKey = demandDiscoveryDedupeKey_(radarId, cycleDate);
    var existingId = existingJobIds[jobId] ? jobId : existingDedupe[dedupeKey];
    if (existingId) {
      // 同 cycle 幂等：若雷达还没绑定 job_id，则补绑定当前 cycle 的 Job，不创建新行
      for (var rr = 0; rr < radarRows.length; rr++) {
        var rrow = radarRows[rr];
        var rid = String(rrow[radarCol['雷达ID']] || '').trim();
        if (rid !== radarId) continue;
        if (!String(rrow[radarCol['研究任务ID']] || '').trim()) {
          rrow[radarCol['雷达状态']] = RADAR_STATUS.RESEARCH;
          rrow[radarCol['研究任务ID']] = existingId;
          rrow[radarCol['最近报告时间']] = nowTs;
        }
        break;
      }
      skipped += 1;
      continue;
    }

    var contract = buildDemandDiscoveryJobContract_(best, createdAt, cycleDate);
    jobId = contract.job_id;
    var jobRow = demandDiscoveryResearchJobSheetRow_(contract, best.site, createdAt);
    toAppend.push(jobRow);

    // 更新 radar row
    for (var r2 = 0; r2 < radarRows.length; r2++) {
      var rrow2 = radarRows[r2];
      var rid2 = String(rrow2[radarCol['雷达ID']] || '').trim();
      if (rid2 !== radarId) continue;
      rrow2[radarCol['雷达状态']] = RADAR_STATUS.RESEARCH;
      rrow2[radarCol['研究任务ID']] = jobId;
      rrow2[radarCol['最近报告时间']] = nowTs;
      break;
    }

    created += 1;
    existingJobIds[jobId] = true;
    existingDedupe[dedupeKey] = jobId;
  }

  if (toAppend.length) {
    var start = jobSheet.getLastRow() + 1;
    if (start < 2) start = 2;
    jobSheet.getRange(start, 1, toAppend.length, RESEARCH_JOB_HEADERS.length).setValues(toAppend);
  }

  replaceSheetDataRows_(SHEET_NAMES.DEMAND_RADAR, DEMAND_RADAR_HEADERS, radarRows);
  return { created: created, skipped: skipped };
}

function demandDiscoveryResearchJobSheetRow_(contract, site, createdAt) {
  // Sheet 写入：禁止伪造 content opportunity 字段（机会等级/建议动作/source_query）
  // 通过新增 DEMAND_DISCOVERY 元数据列提供完整合同字段。
  return [
    String(contract.job_id || '').trim(),
    createdAt || new Date(),
    site || contract.site || '',
    contract.game || '',
    String(contract.discovery_scope && contract.discovery_scope.page_topic ? contract.discovery_scope.page_topic : '') || '',
    String(contract.anchor_page || '') || '',
    '', // 机会等级
    '', // 建议动作
    '', // source_query（禁止伪造）
    opportunityLabel_(
      RESEARCH_JOB_STATUS_LABELS,
      RESEARCH_JOB_STATUS.READY_FOR_DISCOVERY_RUNNER
    ),
    '', // 关联搜索词
    '', // 研究结果
    '', // 证据数量
    '', // 结果路径
    '', // 完成时间
    '', // 错误信息
    '', // 审核摘要
    '', // 审核链接
    '', // 审核决定
    '', // 审核备注
    '', // 审核时间
    RESEARCH_TYPE.DEMAND_DISCOVERY,
    // DEMAND_DISCOVERY 元数据列
    String(contract.radar_id || '').trim(),
    String(contract.trigger_type || '').trim(),
    String(contract.anchor_page || '').trim(),
    JSON.stringify(contract.discovery_scope || {}),
    JSON.stringify(contract.seed_terms || []),
    JSON.stringify(contract.source_families_requested || []),
    String(contract.source_signal_summary || '').trim(),
    String(contract.discovery_cycle_date || '').trim(),
    String(contract.opportunity_id || '').trim(),
    '', '', '', '', // Recommendation linkage
    '', '', '', '', '', '', '', '', '', '', '', '', '' // M1 action context + ContentDecision
  ];
}

function createDemandDiscoveryJobs() {
  // 菜单/调试入口：默认按今天最近发现 runDate 创建
  return createDemandDiscoveryJobs_({ runDate: todayStr_() });
}

// ---------------------------------------------------------------------------
// R3A — SEARCH_DEMAND Job Contract / Eligibility / Create / Pending Queue
// ---------------------------------------------------------------------------

function searchDemandDedupeKey_(radarId, cycleDate) {
  return (
    RESEARCH_TYPE.SEARCH_DEMAND +
    '||' +
    String(radarId || '').trim() +
    '||' +
    normalizeDemandDiscoveryDate_(cycleDate)
  );
}

function buildSearchDemandJobId_(radarId, cycleDate) {
  var radar = String(radarId || '').trim();
  var slug = slugifyResearch_(radar);
  if (!slug) slug = 'unknown';
  if (slug.length > 40) slug = slug.substring(0, 40).replace(/-+$/, '');
  var ymd = normalizeDemandDiscoveryDate_(cycleDate).replace(/-/g, '');
  if (!ymd) return 'search-' + slug;
  return 'search-' + slug + '-' + ymd;
}

function searchSourcesRequested_() {
  if (typeof SEARCH_SOURCES_REQUESTED !== 'undefined' && SEARCH_SOURCES_REQUESTED) {
    return SEARCH_SOURCES_REQUESTED.slice();
  }
  return [
    'GOOGLE_AUTOCOMPLETE',
    'GOOGLE_PAA',
    'GOOGLE_RELATED',
    'BING_AUTOCOMPLETE'
  ];
}

function isSearchDemandRadarStatusAllowed_(radarStatus) {
  var s = String(radarStatus || '').trim();
  return (
    s === RADAR_STATUS.DISCOVERED ||
    s === RADAR_STATUS.RESEARCH ||
    s === RADAR_STATUS.WATCH ||
    s === RADAR_STATUS.VALIDATED
  );
}

function isValidSearchDemandRadar_(radar) {
  radar = radar || {};
  var radarId = String(radar.radar_id || radar.radarId || '').trim();
  var site = String(radar.site || '').trim();
  var radarStatus = String(radar.radar_status || radar.radarStatus || '').trim();
  if (!radarId || !site) return false;
  if (radarStatus === RADAR_STATUS.ARCHIVED) return false;
  return true;
}

/**
 * SEARCH_DEMAND 独立 eligibility。
 * 不要求 ResearchJobID 为空：R2 DEMAND_DISCOVERY 历史 Job 不得阻止 SEARCH。
 */
function isSearchDemandEligible_(radar, opts) {
  opts = opts || {};
  radar = radar || {};
  var runDate = opts.runDate || '';
  var recentFoundRaw = radar.recent_found || radar.recentFound || radar.runDate || '';
  var runDateDate = normalizeDemandDiscoveryDate_(runDate);
  var recentFoundDate = normalizeDemandDiscoveryDate_(recentFoundRaw);
  if (runDateDate && recentFoundDate && recentFoundDate !== runDateDate) return false;

  if (!isValidSearchDemandRadar_(radar)) return false;
  if (String(radar.trigger_type || radar.triggerType || '') !== QUERY_BLIND_SPOT_TRIGGER) {
    return false;
  }
  if (String(radar.signal_status || radar.signalStatus || '') !== RADAR_SIGNAL_STATUS.ACTIVE) {
    return false;
  }
  if (!isSearchDemandRadarStatusAllowed_(radar.radar_status || radar.radarStatus)) {
    return false;
  }

  var searchStatus = String(
    radar.search_demand_status || radar.searchDemandStatus || SEARCH_DEMAND_STATUS.UNKNOWN
  ).trim();
  if (!searchStatus) searchStatus = SEARCH_DEMAND_STATUS.UNKNOWN;
  if (searchStatus === SEARCH_DEMAND_STATUS.CONFIRMED) return false;
  if (searchStatus !== SEARCH_DEMAND_STATUS.UNKNOWN) return false;

  if (String(radar.search_demand_job_id || radar.searchDemandJobId || '').trim()) return false;
  return true;
}

function chooseBestSearchDemandRadarForSite_(radars) {
  return chooseBestDemandDiscoveryRadarForSite_(radars);
}

function buildSearchDemandJobContract_(radar, createdAt, cycleDate) {
  radar = radar || {};
  createdAt = createdAt || new Date();

  var createdAtIso = '';
  if (typeof toIso8601_ === 'function') {
    try {
      createdAtIso = toIso8601_(createdAt);
    } catch (e) {
      createdAtIso = String(createdAt || '').trim();
    }
  } else {
    createdAtIso = String(createdAt || '').trim();
  }

  var searchCycleDate = normalizeDemandDiscoveryDate_(
    cycleDate || radar.search_cycle_date || radar.searchCycleDate || radar.runDate
  );
  var pageTopic = parseDemandDiscoveryPageTopicFromAnchorPage_(
    radar.anchor_page || radar.anchorPage
  );
  var seedTerms = buildDemandDiscoverySeedTerms_(radar.game || radar.gameName, pageTopic);

  return {
    job_id:
      String(radar.job_id || radar.jobId || '').trim() ||
      buildSearchDemandJobId_(radar.radar_id || radar.radarId, searchCycleDate),
    research_type: RESEARCH_TYPE.SEARCH_DEMAND,
    site: String(radar.site || '').trim(),
    game: String(radar.game || radar.gameName || '').trim(),
    radar_id: String(radar.radar_id || radar.radarId || '').trim(),
    opportunity_id:
      String(radar.opportunity_id || radar.opportunityId || '').trim() ||
      buildOpportunityIdFromRadarId_(radar.radar_id || radar.radarId),
    trigger_type: String(radar.trigger_type || radar.triggerType || '').trim(),
    anchor_page: String(radar.anchor_page || radar.anchorPage || '').trim(),
    discovery_scope: {
      page_topic: pageTopic
    },
    seed_terms: seedTerms,
    search_sources_requested: searchSourcesRequested_(),
    source_signal_summary: String(
      radar.source_signal_summary || radar.trigger_reason || radar.triggerReason || ''
    ).trim(),
    search_cycle_date: searchCycleDate,
    created_at: createdAtIso
  };
}

function searchDemandResearchJobSheetRow_(contract, site, createdAt) {
  return [
    String(contract.job_id || '').trim(),
    createdAt || new Date(),
    site || contract.site || '',
    contract.game || '',
    String(
      contract.discovery_scope && contract.discovery_scope.page_topic
        ? contract.discovery_scope.page_topic
        : ''
    ) || '',
    String(contract.anchor_page || '') || '',
    '', // 机会等级
    '', // 建议动作
    '', // source_query（禁止伪造）
    opportunityLabel_(
      RESEARCH_JOB_STATUS_LABELS,
      RESEARCH_JOB_STATUS.READY_FOR_SEARCH_RUNNER
    ),
    '', // 关联搜索词
    '', // 研究结果
    '', // 证据数量
    '', // 结果路径
    '', // 完成时间
    '', // 错误信息
    '', // 审核摘要
    '', // 审核链接
    '', // 审核决定
    '', // 审核备注
    '', // 审核时间
    RESEARCH_TYPE.SEARCH_DEMAND,
    String(contract.radar_id || '').trim(),
    String(contract.trigger_type || '').trim(),
    String(contract.anchor_page || '').trim(),
    JSON.stringify(contract.discovery_scope || {}),
    JSON.stringify(contract.seed_terms || []),
    JSON.stringify(contract.search_sources_requested || []),
    String(contract.source_signal_summary || '').trim(),
    String(contract.search_cycle_date || '').trim(),
    String(contract.opportunity_id || '').trim(),
    '', '', '', '', // Recommendation linkage
    '', '', '', '', '', '', '', '', '', '', '', '', '' // M1 action context + ContentDecision
  ];
}

function searchDemandRowToApi_(row, col) {
  var created = cell_(row, col, '创建时间');
  var createdAt = '';
  if (Object.prototype.toString.call(created) === '[object Date]' && !isNaN(created.getTime())) {
    createdAt = typeof toIso8601_ === 'function' ? toIso8601_(created) : String(created);
  } else {
    createdAt = String(created || '').trim();
  }

  var jobId = String(cell_(row, col, '任务ID') || '').trim();
  var cycleDate =
    normalizeDemandDiscoveryDate_(cell_(row, col, '发现周期日期')) ||
    (function () {
      var m = /-(\d{8})$/.exec(jobId);
      return m ? normalizeDemandDiscoveryDate_(m[1]) : '';
    })();

  var discoveryScope = safeJsonParse_(cell_(row, col, '发现范围') || '', {});
  var seedTerms = safeJsonParse_(cell_(row, col, '种子词') || '', []);
  var searchSourcesRequested = safeJsonParse_(cell_(row, col, '来源族请求') || '', []);

  return {
    job_id: jobId,
    research_type: RESEARCH_TYPE.SEARCH_DEMAND,
    site: String(cell_(row, col, '站点') || cell_(row, col, '游戏') || '').trim(),
    game: String(cell_(row, col, '游戏') || '').trim(),
    radar_id: String(cell_(row, col, '雷达ID') || '').trim(),
    opportunity_id: String(cell_(row, col, 'OpportunityID') || '').trim() ||
      buildOpportunityIdFromRadarId_(cell_(row, col, '雷达ID')),
    trigger_type: String(cell_(row, col, '触发类型') || '').trim(),
    anchor_page: String(cell_(row, col, '锚点页面') || '').trim(),
    discovery_scope: discoveryScope && typeof discoveryScope === 'object' ? discoveryScope : {},
    seed_terms: Array.isArray(seedTerms) ? seedTerms : [],
    search_sources_requested: Array.isArray(searchSourcesRequested)
      ? searchSourcesRequested
      : [],
    source_signal_summary: String(cell_(row, col, '信号摘要') || '').trim(),
    search_cycle_date: cycleDate,
    created_at: createdAt
  };
}

// ---------------------------------------------------------------------------
// M6A — RESEARCH_RECOMMENDATION enqueue / pending GET
// ---------------------------------------------------------------------------

/**
 * Resolve the pairing identity already present on a Research Job row.
 * site_id is consumed when an existing/legacy header exposes it; otherwise
 * the exact existing site field is the compatibility fallback. No identity
 * is generated or inferred here.
 */
function researchRecommendationSiteIdentity_(row, col) {
  var siteId = '';
  if (col['site_id'] !== undefined) siteId = String(row[col['site_id']] || '').trim();
  if (!siteId && col['SiteID'] !== undefined) siteId = String(row[col['SiteID']] || '').trim();
  if (siteId) {
    return typeof getSiteIdentityKey_ === 'function'
      ? getSiteIdentityKey_({ siteId: siteId })
      : 'site_id:' + siteId;
  }

  var siteName = String(cell_(row, col, '站点') || '').trim();
  if (!siteName) return '';
  return typeof getSiteIdentityKey_ === 'function'
    ? getSiteIdentityKey_({ name: siteName })
    : 'site_name:' + siteName;
}

function researchRecommendationCycleDate_(row, col) {
  var cycle = normalizeDemandDiscoveryDate_(cell_(row, col, '发现周期日期'));
  if (cycle) return cycle;
  return discoveryCycleDateFromJobId_(String(cell_(row, col, '任务ID') || '').trim());
}

function researchRecommendationGameMatches_(leftRow, rightRow, col) {
  var left = String(cell_(leftRow, col, '游戏') || '').trim().toLowerCase();
  var right = String(cell_(rightRow, col, '游戏') || '').trim().toLowerCase();
  return !left || !right || left === right;
}

function researchRecommendationStatusIs_(row, col, key) {
  var value = String(cell_(row, col, '任务状态') || '').trim();
  return value === RESEARCH_JOB_STATUS[key] || value === RESEARCH_JOB_STATUS_LABELS[key];
}

function isResearchRecommendationSearchCompleted_(row, col) {
  var status = String(cell_(row, col, '任务状态') || '').trim().toUpperCase();
  return (
    researchRecommendationStatusIs_(row, col, 'SEARCH_CONFIRMED') ||
    researchRecommendationStatusIs_(row, col, 'SEARCH_NO_SIGNAL') ||
    status === 'COMPLETED' ||
    status === '已完成'
  );
}

function isResearchRecommendationGameWideCompleted_(row, col) {
  var status = String(cell_(row, col, '任务状态') || '').trim().toUpperCase();
  return (
    researchRecommendationStatusIs_(row, col, 'DISCOVERY_DONE') ||
    researchRecommendationStatusIs_(row, col, 'DISCOVERY_NO_SIGNAL') ||
    status === 'COMPLETED' ||
    status === '已完成'
  );
}

function isResearchRecommendationFailed_(row, col) {
  var status = String(cell_(row, col, '任务状态') || '').trim();
  return status === RESEARCH_JOB_STATUS.FAILED ||
    status === RESEARCH_JOB_STATUS_LABELS.FAILED ||
    status.toUpperCase() === 'FAILED' ||
    status === '失败';
}

function isResearchRecommendationPendingOrRunning_(row, col) {
  var raw = String(cell_(row, col, '任务状态') || '').trim();
  var upper = raw.toUpperCase();
  return (
    isResearchJobPending_(raw) ||
    researchRecommendationStatusIs_(row, col, 'READY_FOR_DISCOVERY_RUNNER') ||
    upper === 'RUNNING' ||
    upper === 'IN_PROGRESS' ||
    raw === '执行中' ||
    raw === '进行中'
  );
}

function buildResearchRecommendationJobId_(siteIdentity, cycleDate, searchJobId) {
  var siteSlug = slugifyResearch_(siteIdentity) || 'site';
  var searchSlug = slugifyResearch_(searchJobId) || 'search';
  if (siteSlug.length > 40) siteSlug = siteSlug.substring(0, 40).replace(/-+$/, '');
  if (searchSlug.length > 40) searchSlug = searchSlug.substring(searchSlug.length - 40);
  var ymd = discoveryCycleDateToYmd_(cycleDate);
  return 'recommend-' + siteSlug + (ymd ? '-' + ymd : '') + '-' + searchSlug;
}

function researchRecommendationSheetRow_(searchRow, socialRow, col, createdAt) {
  var row = [];
  for (var i = 0; i < RESEARCH_JOB_HEADERS.length; i++) row.push('');

  var searchJobId = String(cell_(searchRow, col, '任务ID') || '').trim();
  var socialJobId = socialRow ? String(cell_(socialRow, col, '任务ID') || '').trim() : '';
  var site = String(cell_(searchRow, col, '站点') || '').trim();
  var game = String(cell_(searchRow, col, '游戏') || '').trim();
  var siteIdentity = researchRecommendationSiteIdentity_(searchRow, col);
  var cycleDate = researchRecommendationCycleDate_(searchRow, col);

  row[col['任务ID']] = buildResearchRecommendationJobId_(siteIdentity, cycleDate, searchJobId);
  row[col['创建时间']] = createdAt || new Date();
  row[col['站点']] = site;
  row[col['游戏']] = game;
  row[col['任务状态']] = opportunityLabel_(
    RESEARCH_JOB_STATUS_LABELS,
    RESEARCH_JOB_STATUS.PENDING
  );
  row[col['研究类型']] = RESEARCH_TYPE.RESEARCH_RECOMMENDATION;
  row[col['雷达ID']] = String(cell_(searchRow, col, '雷达ID') || '').trim();
  row[col['发现周期日期']] = cycleDate;
  row[col['OpportunityID']] = String(cell_(searchRow, col, 'OpportunityID') || '').trim();
  row[col['Search任务ID']] = searchJobId;
  row[col['Social任务ID']] = socialJobId;
  row[col['Search结果路径']] = String(cell_(searchRow, col, '结果路径') || '').trim();
  row[col['Social结果路径']] = socialRow
    ? String(cell_(socialRow, col, '结果路径') || '').trim()
    : '';
  return row;
}

/**
 * Pure planner for M6A. Search is the required source. GAME_WIDE only gates
 * while pending/running and contributes optional evidence when terminal.
 */
function planResearchRecommendationJobs_(jobRows, opts) {
  opts = opts || {};
  var createdAt = opts.createdAt || new Date();
  var col = headerIndexMap_(RESEARCH_JOB_HEADERS);
  var socialByPair = {};
  var existingPairs = {};

  for (var i = 0; i < (jobRows || []).length; i++) {
    var row = jobRows[i] || [];
    var researchType = String(cell_(row, col, '研究类型') || '').trim();
    var siteIdentity = researchRecommendationSiteIdentity_(row, col);
    var cycleDate = researchRecommendationCycleDate_(row, col);
    if (researchType === RESEARCH_TYPE.RESEARCH_RECOMMENDATION) {
      var existingSearchId = String(cell_(row, col, 'Search任务ID') || '').trim();
      if (siteIdentity && cycleDate && existingSearchId) {
        existingPairs[siteIdentity + '||' + cycleDate + '||' + existingSearchId] = true;
      }
      continue;
    }
    if (researchType !== RESEARCH_TYPE.DEMAND_DISCOVERY) continue;

    var scope = safeJsonParse_(cell_(row, col, '发现范围') || '', {});
    if (String((scope && scope.scope) || '').trim().toUpperCase() !== 'GAME_WIDE') continue;
    if (!siteIdentity || !cycleDate) continue;
    var pairKey = siteIdentity + '||' + cycleDate;
    if (!socialByPair[pairKey]) socialByPair[pairKey] = [];
    socialByPair[pairKey].push(row);
  }

  var toAppend = [];
  var recommendations = [];
  var skipped = 0;

  for (var s = 0; s < (jobRows || []).length; s++) {
    var searchRow = jobRows[s] || [];
    if (String(cell_(searchRow, col, '研究类型') || '').trim() !== RESEARCH_TYPE.SEARCH_DEMAND) continue;
    if (!isResearchRecommendationSearchCompleted_(searchRow, col)) continue;

    var searchPath = String(cell_(searchRow, col, '结果路径') || '').trim();
    if (!searchPath) continue;
    var searchSite = researchRecommendationSiteIdentity_(searchRow, col);
    var searchCycle = researchRecommendationCycleDate_(searchRow, col);
    var searchId = String(cell_(searchRow, col, '任务ID') || '').trim();
    if (!searchSite || !searchCycle || !searchId) continue;

    var pairKey = searchSite + '||' + searchCycle;
    var socialCandidates = socialByPair[pairKey] || [];
    var matchingSocial = [];
    for (var c = 0; c < socialCandidates.length; c++) {
      if (researchRecommendationGameMatches_(searchRow, socialCandidates[c], col)) {
        matchingSocial.push(socialCandidates[c]);
      }
    }

    var socialRow = null;
    var socialBlocked = false;
    for (var m = 0; m < matchingSocial.length; m++) {
      if (isResearchRecommendationPendingOrRunning_(matchingSocial[m], col)) {
        socialBlocked = true;
        break;
      }
    }
    if (socialBlocked) {
      skipped += 1;
      continue;
    }

    for (var x = 0; x < matchingSocial.length; x++) {
      if (isResearchRecommendationGameWideCompleted_(matchingSocial[x], col)) {
        socialRow = matchingSocial[x];
        break;
      }
      if (!socialRow && isResearchRecommendationFailed_(matchingSocial[x], col)) {
        socialRow = matchingSocial[x];
      }
    }

    var dedupeKey = searchSite + '||' + searchCycle + '||' + searchId;
    if (existingPairs[dedupeKey]) {
      skipped += 1;
      continue;
    }

    var recommendationRow = researchRecommendationSheetRow_(searchRow, socialRow, col, createdAt);
    toAppend.push(recommendationRow);
    recommendations.push(recommendationRow);
    existingPairs[dedupeKey] = true;
  }

  return {
    created: toAppend.length,
    skipped: skipped,
    jobRowsToAppend: toAppend,
    recommendations: recommendations
  };
}

/** Write-side helper invoked after either source callback reaches terminal state. */
function enqueueReadyResearchRecommendationJobs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { created: 0, skipped: 0 };
  var sheet = ss.getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet) return { created: 0, skipped: 0, error: 'research_jobs_missing' };

  ensureResearchJobResultColumns_(sheet);
  var lastCol = Math.max(sheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var rows = sheet.getLastRow() >= 2
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues()
    : [];
  var plan = planResearchRecommendationJobs_(rows, { createdAt: new Date() });
  if (plan.jobRowsToAppend.length) {
    var start = sheet.getLastRow() + 1;
    if (start < 2) start = 2;
    sheet.getRange(start, 1, plan.jobRowsToAppend.length, RESEARCH_JOB_HEADERS.length)
      .setValues(plan.jobRowsToAppend);
  }
  return { created: plan.created, skipped: plan.skipped };
}

function isResearchRecommendationPending_(status) {
  var s = String(status || '').trim();
  return isResearchJobPending_(s) ||
    s === 'READY_FOR_RECOMMENDATION_RUNNER' ||
    s === '待推荐执行';
}

/** Read-only M5 adapter. It never ensures headers, appends rows, or changes state. */
function loadPendingResearchRecommendationJobs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return [];
  var sheet = ss.getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var jobs = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (String(cell_(row, col, '研究类型') || '').trim() !== RESEARCH_TYPE.RESEARCH_RECOMMENDATION) continue;
    if (!isResearchRecommendationPending_(cell_(row, col, '任务状态'))) continue;
    var jobId = String(cell_(row, col, '任务ID') || '').trim();
    var searchPath = String(cell_(row, col, 'Search结果路径') || '').trim();
    if (!jobId || !searchPath) continue;

    var created = cell_(row, col, '创建时间');
    var createdAt = '';
    if (Object.prototype.toString.call(created) === '[object Date]' && !isNaN(created.getTime())) {
      createdAt = typeof toIso8601_ === 'function' ? toIso8601_(created) : String(created);
    } else {
      createdAt = String(created || '').trim();
    }
    jobs.push({
      job_id: jobId,
      job_type: 'RESEARCH_RECOMMENDATION',
      site_key: String(cell_(row, col, '站点') || '').trim(),
      game_name: String(cell_(row, col, '游戏') || '').trim(),
      search_result_path: searchPath,
      social_result_path: String(cell_(row, col, 'Social结果路径') || '').trim(),
      created_at: createdAt
    });
  }
  return jobs;
}

function isSearchDemandReadyJob_(row, col) {
  var statusRaw = String(cell_(row, col, '任务状态') || '').trim();
  var needStatus = opportunityLabel_(
    RESEARCH_JOB_STATUS_LABELS,
    RESEARCH_JOB_STATUS.READY_FOR_SEARCH_RUNNER
  );
  if (statusRaw !== needStatus && statusRaw !== RESEARCH_JOB_STATUS.READY_FOR_SEARCH_RUNNER) {
    return false;
  }
  return String(cell_(row, col, '研究类型') || '').trim() === RESEARCH_TYPE.SEARCH_DEMAND;
}

function loadSearchDemandReadyJobs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return [];
  var sheet = ss.getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  var jobs = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!isSearchDemandReadyJob_(row, col)) continue;

    var job = searchDemandRowToApi_(row, col);
    if (job && job.job_id) jobs.push(job);
  }
  return jobs;
}

function parseRadarRowForSearchDemand_(row, radarCol) {
  radarCol = radarCol || headerIndexMap_(DEMAND_RADAR_HEADERS);
  row = row || [];
  return {
    radar_id: String(row[radarCol['雷达ID']] || '').trim(),
    opportunity_id:
      String(
        radarCol['OpportunityID'] !== undefined ? row[radarCol['OpportunityID']] || '' : ''
      ).trim() || buildOpportunityIdFromRadarId_(row[radarCol['雷达ID']]),
    site: String(row[radarCol['站点']] || '').trim(),
    game: String(row[radarCol['游戏']] || '').trim(),
    anchor_page: String(row[radarCol['锚点页面']] || '').trim(),
    trigger_type: String(row[radarCol['触发类型']] || '').trim(),
    trigger_reason: String(row[radarCol['触发原因']] || '').trim(),
    page_clicks7d: Number(row[radarCol['页面点击7日']] || 0),
    page_impressions7d: Number(row[radarCol['页面曝光7日']] || 0),
    signal_status: String(row[radarCol['信号状态']] || '').trim(),
    radar_status: String(row[radarCol['雷达状态']] || '').trim(),
    search_demand_status: String(row[radarCol['搜索需求状态']] || '').trim(),
    search_demand_job_id: String(
      radarCol['搜索需求任务ID'] !== undefined ? row[radarCol['搜索需求任务ID']] || '' : ''
    ).trim(),
    research_job_id: String(row[radarCol['研究任务ID']] || '').trim(),
    recent_found: row[radarCol['最近发现']],
    source_families: String(row[radarCol['来源族']] || '').trim(),
    family_count: row[radarCol['独立来源族数']],
    cross_validated: row[radarCol['交叉验证']],
    opportunity_confidence: String(row[radarCol['机会置信度']] || '').trim(),
    serp_gap_status: String(row[radarCol['SERP缺口状态']] || '').trim()
  };
}

function bindSearchDemandJobToRadarRow_(row, radarCol, jobId, nowTs) {
  var next = (row || []).slice();
  while (next.length < DEMAND_RADAR_HEADERS.length) next.push('');
  var currentStatus = String(next[radarCol['雷达状态']] || '').trim();
  if (currentStatus !== RADAR_STATUS.VALIDATED) {
    next[radarCol['雷达状态']] = RADAR_STATUS.RESEARCH;
  }
  if (radarCol['搜索需求任务ID'] !== undefined) next[radarCol['搜索需求任务ID']] = jobId;
  if (radarCol['最近搜索需求时间'] !== undefined) next[radarCol['最近搜索需求时间']] = nowTs;
  return next;
}

/**
 * 纯函数：选出本 cycle 要创建的 SEARCH_DEMAND Job，并回写雷达绑定列。
 * 每 site / runDate 最多 1 个；同一 Radar + SearchCycleDate 不重复。
 */
function planSearchDemandJobs_(radarRows, jobRows, opts) {
  opts = opts || {};
  var runDate = opts.runDate || '';
  var createdAt = opts.createdAt || new Date();
  var nowTs = opts.nowTs || createdAt;
  var cycleDate = normalizeDemandDiscoveryDate_(runDate);
  var radarCol = headerIndexMap_(DEMAND_RADAR_HEADERS);
  var jobCol = headerIndexMap_(RESEARCH_JOB_HEADERS);

  var existingJobIds = {};
  var existingDedupe = {};
  for (var i = 0; i < (jobRows || []).length; i++) {
    var jrow = jobRows[i];
    var jt = String(cell_(jrow, jobCol, '研究类型') || '').trim();
    if (jt !== RESEARCH_TYPE.SEARCH_DEMAND) continue;
    var jobId = String(cell_(jrow, jobCol, '任务ID') || '').trim();
    var radarIdExisting = String(cell_(jrow, jobCol, '雷达ID') || '').trim();
    var cycleExisting = normalizeDemandDiscoveryDate_(cell_(jrow, jobCol, '发现周期日期'));
    if (jobId) existingJobIds[jobId] = true;
    if (radarIdExisting && cycleExisting) {
      existingDedupe[searchDemandDedupeKey_(radarIdExisting, cycleExisting)] = jobId;
    }
  }

  var nextRadarRows = [];
  var byIdIndex = {};
  for (var r = 0; r < (radarRows || []).length; r++) {
    var copied = (radarRows[r] || []).slice();
    while (copied.length < DEMAND_RADAR_HEADERS.length) copied.push('');
    nextRadarRows.push(copied);
    var rid = String(copied[radarCol['雷达ID']] || '').trim();
    if (rid) byIdIndex[rid] = r;
  }

  var eligible = [];
  for (var e = 0; e < nextRadarRows.length; e++) {
    var radarObj = parseRadarRowForSearchDemand_(nextRadarRows[e], radarCol);
    if (!isSearchDemandEligible_(radarObj, { runDate: runDate })) continue;
    eligible.push(radarObj);
  }

  var bySite = {};
  for (var s = 0; s < eligible.length; s++) {
    var siteName = String(eligible[s].site || '').trim();
    if (!siteName) continue;
    if (!bySite[siteName]) bySite[siteName] = [];
    bySite[siteName].push(eligible[s]);
  }

  var created = 0;
  var skipped = 0;
  var toAppend = [];

  for (var siteKey in bySite) {
    if (!bySite.hasOwnProperty(siteKey)) continue;
    var best = chooseBestSearchDemandRadarForSite_(bySite[siteKey]);
    if (!best) continue;

    var radarId = best.radar_id;
    var jobId = buildSearchDemandJobId_(radarId, cycleDate);
    var dedupeKey = searchDemandDedupeKey_(radarId, cycleDate);
    var existingId = existingJobIds[jobId] ? jobId : existingDedupe[dedupeKey];
    var radarIdx = byIdIndex[radarId];
    if (existingId) {
      if (radarIdx !== undefined) {
        var bound = nextRadarRows[radarIdx];
        if (!String(bound[radarCol['搜索需求任务ID']] || '').trim()) {
          nextRadarRows[radarIdx] = bindSearchDemandJobToRadarRow_(
            bound,
            radarCol,
            existingId,
            nowTs
          );
        }
      }
      skipped += 1;
      continue;
    }

    var contract = buildSearchDemandJobContract_(best, createdAt, cycleDate);
    jobId = contract.job_id;
    toAppend.push(searchDemandResearchJobSheetRow_(contract, best.site, createdAt));
    if (radarIdx !== undefined) {
      nextRadarRows[radarIdx] = bindSearchDemandJobToRadarRow_(
        nextRadarRows[radarIdx],
        radarCol,
        jobId,
        nowTs
      );
    }
    created += 1;
    existingJobIds[jobId] = true;
    existingDedupe[dedupeKey] = jobId;
  }

  return {
    created: created,
    skipped: skipped,
    jobRowsToAppend: toAppend,
    radarRows: nextRadarRows
  };
}

function createSearchDemandJobs_(opts) {
  opts = opts || {};
  var runDate = opts.runDate || todayStr_();
  ensureResearchJobSheets_();
  ensureDemandRadarHeader_();

  var radarRows = loadDemandRadarRows_();
  if (!radarRows || !radarRows.length) {
    return { created: 0, skipped: 0 };
  }

  var jobSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!jobSheet) return { created: 0, skipped: 0 };

  var lastJobCol = Math.max(jobSheet.getLastColumn(), 1);
  var jobRows = [];
  if (jobSheet.getLastRow() >= 2) {
    jobRows = jobSheet.getRange(2, 1, jobSheet.getLastRow() - 1, lastJobCol).getValues();
  }

  var nowTs = typeof radarNowTs_ === 'function' ? radarNowTs_() : '';
  var plan = planSearchDemandJobs_(radarRows, jobRows, {
    runDate: runDate,
    createdAt: new Date(),
    nowTs: nowTs
  });

  if (plan.jobRowsToAppend.length) {
    var start = jobSheet.getLastRow() + 1;
    if (start < 2) start = 2;
    jobSheet
      .getRange(start, 1, plan.jobRowsToAppend.length, RESEARCH_JOB_HEADERS.length)
      .setValues(plan.jobRowsToAppend);
  }

  replaceSheetDataRows_(SHEET_NAMES.DEMAND_RADAR, DEMAND_RADAR_HEADERS, plan.radarRows);
  return { created: plan.created, skipped: plan.skipped };
}

function createSearchDemandJobs() {
  return createSearchDemandJobs_({ runDate: todayStr_() });
}

/**
 * 独立入口：从当前「内容机会」筛选高优先级研究项，写入「研究任务」。
 * 幂等：同一聚合键已有 Job 时不重复创建。
 * @return {Object} { created, skipped, mortal }
 */
function createResearchJobs() {
  ensureResearchJobSheets_();
  ensureSheet_(SHEET_NAMES.CONTENT_UPDATES, CONTENT_UPDATE_HEADERS);
  var createdAt = new Date();
  var asOfDate = todayStr_();
  var rules = getDecisionRules_();
  var contentUpdateRows = loadContentUpdateRows_();
  writeLog_('INFO', '', 'createResearchJobs 开始');

  var oppSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.OPPORTUNITIES);
  if (!oppSheet || oppSheet.getLastRow() < 2) {
    writeLog_('INFO', '', 'createResearchJobs 结束：内容机会为空');
    return { created: 0, skipped: 0, skippedCooldown: 0, mortal: [] };
  }

  ensureOpportunityResearchColumns_(oppSheet);
  SpreadsheetApp.flush();
  var lastCol = Math.max(oppSheet.getLastColumn(), 1);
  var header = oppSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  requireHeaders_(col, ['站点', '搜索词', '机会等级', '建议动作', '研究状态', '研究任务ID', '研究请求时间']);

  var jobSheet = ensureSheet_(SHEET_NAMES.RESEARCH_JOBS, RESEARCH_JOB_HEADERS);
  ensureResearchJobHeader_();
  var existingJobs = loadExistingResearchJobs_(jobSheet);
  var createdRows = [];
  var oppUpdates = [];
  var mortal = [];
  var skipped = 0;
  var skippedCooldown = 0;
  var clusters = {};
  var clusterOrder = [];

  var values = oppSheet.getRange(2, 1, oppSheet.getLastRow() - 1, lastCol).getValues();
  for (var i = 0; i < values.length; i++) {
    var parsed = parseOpportunityRowForJob_(values[i], col);
    if (!parsed.eligible) continue;
    if (String(parsed.jobId || '').trim()) {
      skipped += 1;
      continue;
    }
    var clusterKey = researchJobClusterKey_(parsed);
    if (!clusters[clusterKey]) {
      clusters[clusterKey] = [];
      clusterOrder.push(clusterKey);
    }
    parsed.sheetRow = i + 2;
    clusters[clusterKey].push(parsed);
  }

  for (var c = 0; c < clusterOrder.length; c++) {
    var key = clusterOrder[c];
    var members = clusters[key];
    var existingId = existingJobs.byClusterKey[key];
    if (!existingId) {
      for (var m = 0; m < members.length; m++) {
        var qKey = researchOpportunityKey_(members[m].site, members[m].query);
        if (existingJobs.byOppKey[qKey]) {
          existingId = existingJobs.byOppKey[qKey];
          break;
        }
      }
    }
    if (existingId) {
      skipped += members.length;
      for (var e = 0; e < members.length; e++) {
        oppUpdates.push({
          sheetRow: members[e].sheetRow,
          status: RESEARCH_STATUS_LABELS.TODO,
          jobId: existingId,
          requestedAt: members[e].requestedAt || createdAt
        });
      }
      continue;
    }

    var contentCooldown = findContentUpdateCooldownFromRows_(
      contentUpdateRows,
      members[0].site,
      members[0].pagePath,
      asOfDate,
      rules
    );
    if (contentCooldown) {
      skippedCooldown += members.length;
      continue;
    }

    var job = buildResearchJobFromCluster_(members, createdAt);
    if (existingJobs.byJobId[job.job_id]) {
      job.job_id = uniquifyResearchJobId_(job.job_id, job.topic || members[0].query);
    }
    createdRows.push(researchJobSheetRow_(job, members[0].site, createdAt));
    existingJobs.byClusterKey[key] = job.job_id;
    existingJobs.byJobId[job.job_id] = true;
    for (var w = 0; w < members.length; w++) {
      existingJobs.byOppKey[researchOpportunityKey_(members[w].site, members[w].query)] = job.job_id;
      oppUpdates.push({
        sheetRow: members[w].sheetRow,
        status: RESEARCH_STATUS_LABELS.TODO,
        jobId: job.job_id,
        requestedAt: createdAt
      });
    }
    if (members[0].site === 'Mortal Shell II') {
      mortal.push({
        job_id: job.job_id,
        topic: job.topic,
        source_query: job.source_query,
        related_queries: job.related_queries,
        existing_page: job.existing_page
      });
    }
  }

  if (createdRows.length) {
    var start = jobSheet.getLastRow() + 1;
    if (start < 2) start = 2;
    jobSheet.getRange(start, 1, createdRows.length, RESEARCH_JOB_HEADERS.length).setValues(createdRows);
  }
  writeOpportunityResearchFields_(oppSheet, col, oppUpdates);

  writeLog_(
    'INFO',
    '',
    'createResearchJobs 结束 created=' +
      createdRows.length +
      ' skippedDup=' +
      skipped +
      ' skippedCooldown=' +
      skippedCooldown
  );
  return {
    created: createdRows.length,
    skipped: skipped,
    skippedCooldown: skippedCooldown,
    mortal: mortal
  };
}

/**
 * 清理当前测试用研究任务，并清空「内容机会」研究回写字段，然后按新聚合规则重建。
 * @return {Object}
 */
function resetAndCreateResearchJobs() {
  resetResearchJobs_();
  return createResearchJobs();
}

function resetResearchJobs_() {
  ensureResearchJobSheets_();
  var jobSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (jobSheet && jobSheet.getLastRow() > 1) {
    var jobCols = Math.max(jobSheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
    jobSheet.getRange(2, 1, jobSheet.getLastRow() - 1, jobCols).clearContent();
  }

  var oppSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.OPPORTUNITIES);
  if (!oppSheet || oppSheet.getLastRow() < 2) return;
  ensureOpportunityResearchColumns_(oppSheet);
  SpreadsheetApp.flush();
  var lastCol = Math.max(oppSheet.getLastColumn(), 1);
  var header = oppSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var n = oppSheet.getLastRow() - 1;
  var names = ['研究状态', '研究任务ID', '研究请求时间'];
  for (var i = 0; i < names.length; i++) {
    if (col[names[i]] === undefined) continue;
    oppSheet.getRange(2, col[names[i]] + 1, n, 1).clearContent();
  }
}

function ensureResearchJobSheets_() {
  ensureSheet_(SHEET_NAMES.OPPORTUNITIES, OPPORTUNITY_HEADERS);
  ensureOpportunityHeader_();
  var oppSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.OPPORTUNITIES);
  if (oppSheet) ensureOpportunityResearchColumns_(oppSheet);
  ensureSheet_(SHEET_NAMES.RESEARCH_JOBS, RESEARCH_JOB_HEADERS);
  ensureResearchJobHeader_();
  ensureResearchReviewSheet_();
}

function ensureResearchJobHeader_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet) return;
  ensureResearchJobResultColumns_(sheet);
  applyResearchReviewDecisionValidation_();
}

/**
 * 「审核决定」列中文下拉：批准开发 / 继续观察 / 无需处理。
 * 仅约束该列；不改已有单元格内容。
 */
function applyResearchReviewDecisionValidation_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet) return;
  ensureResearchJobResultColumns_(sheet);
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var idx = col['审核决定'];
  if (idx === undefined) return;
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(RESEARCH_REVIEW_DECISION_OPTIONS, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, idx + 1, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
  sheet.getRange(1, idx + 1).setNumberFormat('@');
  var timeIdx = col['审核时间'];
  if (timeIdx !== undefined) {
    sheet.getRange(2, timeIdx + 1, sheet.getMaxRows() - 1, 1).setNumberFormat(
      'yyyy-mm-dd hh:mm:ss'
    );
  }
}

/**
 * 仅追加「研究任务」缺失列；不重复、不改已有数据行。
 */
function ensureResearchJobResultColumns_(sheet) {
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var have = {};
  for (var i = 0; i < header.length; i++) {
    var name = String(header[i] || '').trim();
    if (name) have[name] = true;
  }
  var toAdd = [];
  for (var n = 0; n < RESEARCH_JOB_HEADERS.length; n++) {
    if (!have[RESEARCH_JOB_HEADERS[n]]) toAdd.push(RESEARCH_JOB_HEADERS[n]);
  }
  if (!toAdd.length) return;

  var startCol = lastCol + 1;
  if (String(header[header.length - 1] || '').trim() === '') {
    startCol = lastCol;
  }
  ensureSheetGrid_(sheet, 1, startCol + toAdd.length - 1);
  sheet.getRange(1, startCol, 1, toAdd.length).setValues([toAdd]);
  sheet.getRange(1, startCol, 1, toAdd.length).setFontWeight('bold');
}

/**
 * Human Review Gate M2：扫描「研究任务」中尚未处理的审核决定并落状态。
 * 仅处理：任务状态=待审核/REVIEW，且已填审核决定、尚无审核时间。
 * 不创建开发任务、不改网站、不删 Evidence / 审核摘要 / 审核链接。
 * @return {string}
 */
function processResearchReviewDecisions() {
  ensureResearchJobSheets_();
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet || sheet.getLastRow() < 2) {
    var emptyMsg = 'processResearchReviewDecisions：研究任务为空';
    writeLog_('INFO', '', emptyMsg);
    Logger.log(emptyMsg);
    return emptyMsg;
  }

  var lastCol = Math.max(sheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  requireResearchReviewGateColumns_(col);

  var n = sheet.getLastRow() - 1;
  var rows = sheet.getRange(2, 1, n, lastCol).getValues();
  var processed = 0;
  var skippedProcessed = 0;
  var skippedNotReview = 0;
  var skippedUnknown = 0;
  var now = new Date();

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var jobId = String(cell_(row, col, '任务ID') || '').trim();
    if (!jobId) continue;

    var decisionLabel = String(cell_(row, col, '审核决定') || '').trim();
    if (!decisionLabel) continue;

    if (hasResearchReviewProcessed_(cell_(row, col, '审核时间'))) {
      skippedProcessed++;
      continue;
    }

    var statusRaw = String(cell_(row, col, '任务状态') || '').trim();
    if (!isResearchJobAwaitingReview_(statusRaw)) {
      skippedNotReview++;
      continue;
    }

    var nextStatus = statusAfterResearchReviewDecision_(decisionLabel);
    if (!nextStatus) {
      skippedUnknown++;
      writeLog_(
        'WARN',
        '',
        '未知审核决定 job_id=' + jobId + ' decision=' + decisionLabel
      );
      continue;
    }

    var sheetRow = i + 2;
    setCellIf_(sheet, sheetRow, col, '任务状态', nextStatus);
    setCellIf_(sheet, sheetRow, col, '审核时间', now);
    processed++;
    writeLog_(
      'INFO',
      String(cell_(row, col, '站点') || '').trim(),
      '研究审核已处理 job_id=' +
        jobId +
        ' 决定=' +
        decisionLabel +
        ' → 状态=' +
        nextStatus
    );
  }

  var summary =
    'processResearchReviewDecisions 完成 processed=' +
    processed +
    ' skippedAlreadyProcessed=' +
    skippedProcessed +
    ' skippedNotReview=' +
    skippedNotReview +
    ' skippedUnknown=' +
    skippedUnknown;
  writeLog_('INFO', '', summary);
  Logger.log(summary);
  return summary;
}

function requireResearchReviewGateColumns_(col) {
  var needed = ['任务ID', '任务状态', '审核决定', '审核备注', '审核时间'];
  var missing = [];
  for (var i = 0; i < needed.length; i++) {
    if (col[needed[i]] === undefined) missing.push(needed[i]);
  }
  if (missing.length) {
    throw new Error('研究任务缺少列: ' + missing.join(', '));
  }
}

/** 已有审核时间 → 已处理，防重复。 */
function hasResearchReviewProcessed_(value) {
  if (value === null || value === undefined || value === '') return false;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return !isNaN(value.getTime());
  }
  return String(value).trim() !== '';
}

function isResearchJobAwaitingReview_(status) {
  var s = String(status || '').trim();
  if (!s) return false;
  if (s === RESEARCH_JOB_STATUS.REVIEW) return true;
  if (s === RESEARCH_JOB_STATUS_LABELS.REVIEW) return true;
  return enumFromLabel_(RESEARCH_JOB_STATUS_LABELS, s) === RESEARCH_JOB_STATUS.REVIEW;
}

/**
 * 审核决定（中文或内部 enum）→ 新任务状态中文标签。
 * @return {string} 空字符串表示无法识别
 */
function statusAfterResearchReviewDecision_(decisionLabel) {
  var decisionEnum = enumFromLabel_(
    RESEARCH_REVIEW_DECISION_LABELS,
    String(decisionLabel || '').trim()
  );
  if (decisionEnum === RESEARCH_REVIEW_DECISION.APPROVE) {
    return RESEARCH_JOB_STATUS_LABELS.APPROVED;
  }
  if (decisionEnum === RESEARCH_REVIEW_DECISION.WATCH) {
    return RESEARCH_JOB_STATUS_LABELS.WATCH;
  }
  if (decisionEnum === RESEARCH_REVIEW_DECISION.NO_ACTION) {
    return RESEARCH_JOB_STATUS_LABELS.ARCHIVED;
  }
  return '';
}

function formatResearchReviewTime_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return toIso8601_(value);
  }
  return String(value).trim();
}

/**
 * 一次性：为 MS2 beta 任务写入「无需处理」审核决定并执行处理。
 * 不改 AU、不改网站、不删 Evidence。
 * @return {Object}
 */
function applyMs2HumanReviewNoAction() {
  var JOB_ID = 'ms2-beta-progress-carry-over-20260814';
  var DECISION = RESEARCH_REVIEW_DECISION_LABELS.NO_ACTION;
  var NOTE = '已于 2026-08-14 根据社媒信息完成内容更新';

  ensureResearchJobSheets_();
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error('研究任务为空');
  }
  var lastCol = Math.max(sheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  requireResearchReviewGateColumns_(col);

  var found = findResearchJobRowById_(sheet, col, JOB_ID);
  if (!found) {
    throw new Error('找不到研究任务: ' + JOB_ID);
  }

  var row = sheet.getRange(found.sheetRow, 1, 1, lastCol).getValues()[0];
  var beforeStatus = String(cell_(row, col, '任务状态') || '').trim();
  var beforeLink = String(cell_(row, col, '审核链接') || '').trim();
  var evidenceBefore = countResearchReviewEvidence_(JOB_ID);

  if (!hasResearchReviewProcessed_(cell_(row, col, '审核时间'))) {
    setCellIf_(sheet, found.sheetRow, col, '审核决定', DECISION);
    setCellIf_(sheet, found.sheetRow, col, '审核备注', NOTE);
  }

  var processSummary = processResearchReviewDecisions();
  var after = readResearchJobDisplay_(JOB_ID);
  var evidenceAfter = countResearchReviewEvidence_(JOB_ID);

  var result = {
    ok: !!(after && after.ok),
    job_id: JOB_ID,
    before_status: beforeStatus,
    process: processSummary,
    display: after && after.display ? after.display : null,
    evidence_count_before: evidenceBefore,
    evidence_count_after: evidenceAfter,
    review_link_before: beforeLink,
    review_link_after:
      after && after.display ? String(after.display['审核链接'] || '') : ''
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/** 统计「研究审核」中某 job_id 的 Evidence 行数。 */
function countResearchReviewEvidence_(jobId) {
  jobId = String(jobId || '').trim();
  if (!jobId) return 0;
  var reviewSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_REVIEW);
  if (!reviewSheet || reviewSheet.getLastRow() < 2) return 0;
  var lastCol = Math.max(reviewSheet.getLastColumn(), 1);
  var header = reviewSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var idCol = col['任务ID'];
  if (idCol === undefined) return 0;
  var values = reviewSheet.getRange(2, idCol + 1, reviewSheet.getLastRow() - 1, 1).getValues();
  var count = 0;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === jobId) count++;
  }
  return count;
}

/**
 * 复用已有「研究状态」；仅在缺失时追加「研究任务ID」「研究请求时间」。
 * 不重复新增同名列。
 */
function ensureOpportunityResearchColumns_(sheet) {
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var have = {};
  for (var i = 0; i < header.length; i++) {
    var name = String(header[i] || '').trim();
    if (name) have[name] = true;
  }
  var needed = ['研究状态', '研究任务ID', '研究请求时间'];
  var toAdd = [];
  for (var n = 0; n < needed.length; n++) {
    if (!have[needed[n]]) toAdd.push(needed[n]);
  }
  if (!toAdd.length) return;

  var startCol = lastCol + 1;
  if (String(header[header.length - 1] || '').trim() === '') {
    startCol = lastCol;
  }
  ensureSheetGrid_(sheet, 1, startCol + toAdd.length - 1);
  sheet.getRange(1, startCol, 1, toAdd.length).setValues([toAdd]);
  sheet.getRange(1, startCol, 1, toAdd.length).setFontWeight('bold');
}

function headerIndexMap_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var name = String(headerRow[i] || '').trim();
    if (name && map[name] === undefined) map[name] = i;
  }
  return map;
}

function requireHeaders_(col, names) {
  var missing = [];
  for (var i = 0; i < names.length; i++) {
    if (col[names[i]] === undefined) missing.push(names[i]);
  }
  if (missing.length) {
    throw new Error('内容机会缺少列: ' + missing.join(', '));
  }
}

function cell_(row, col, name) {
  var idx = col[name];
  if (idx === undefined) return '';
  return row[idx];
}

/**
 * @return {{eligible:boolean, skipReason:string, site:string, query:string, pagePath:string,
 *   siteUrl:string, actionEnum:string, jobId:string, requestedAt:*, status:string, impressions:number}}
 */
function parseOpportunityRowForJob_(row, col) {
  var site = String(cell_(row, col, '站点') || '').trim();
  var query = String(cell_(row, col, '搜索词') || '').trim();
  var siteUrl = String(cell_(row, col, '站点URL') || '').trim();
  var pagePath = String(cell_(row, col, '页面路径') || '').trim();
  var levelLabel = String(cell_(row, col, '机会等级') || '').trim();
  var actionLabel = String(cell_(row, col, '建议动作') || '').trim();
  var intentLabel = String(cell_(row, col, '搜索意图') || '').trim();
  var specLabel = String(cell_(row, col, '意图明确度') || '').trim();
  var status = String(cell_(row, col, '研究状态') || '').trim();
  var jobId = String(cell_(row, col, '研究任务ID') || '').trim();
  var requestedAt = cell_(row, col, '研究请求时间');
  var impressions = Number(cell_(row, col, '展现') || 0);
  if (isNaN(impressions)) impressions = 0;

  var empty = {
    eligible: false,
    skipReason: '',
    site: site,
    query: query,
    pagePath: pagePath,
    siteUrl: siteUrl,
    actionEnum: '',
    jobId: jobId,
    requestedAt: requestedAt,
    status: status,
    impressions: impressions
  };

  if (!site || !query) return empty;

  var levelEnum = enumFromLabel_(OPPORTUNITY_LEVEL_LABELS, levelLabel);
  var actionEnum = enumFromLabel_(OPPORTUNITY_ACTION_LABELS, actionLabel);
  var intentEnum = enumFromLabel_(OPPORTUNITY_INTENT_LABELS, intentLabel);
  var specEnum = enumFromLabel_(OPPORTUNITY_SPECIFICITY_LABELS, specLabel);

  if (levelEnum !== OPPORTUNITY_LEVELS.HIGH) return empty;
  if (!RESEARCH_JOB_ELIGIBLE_ACTIONS[actionEnum]) return empty;
  if (!isResearchStatusOpen_(status)) return empty;

  if (
    actionEnum === OPPORTUNITY_ACTIONS.IGNORE_BRAND ||
    intentEnum === OPPORTUNITY_INTENT.BRAND ||
    specEnum === OPPORTUNITY_SPECIFICITY.BRAND_ONLY ||
    isPureBrandQuery_(normalizeOpportunityQuery_(query), { name: site, propertyUrl: siteUrl })
  ) {
    return empty;
  }

  empty.eligible = true;
  empty.actionEnum = actionEnum;
  return empty;
}

function isResearchStatusOpen_(status) {
  var s = String(status || '').trim();
  if (!s) return true;
  return s === RESEARCH_STATUS_LABELS.TODO;
}

function enumFromLabel_(labelMap, value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  if (labelMap[raw]) return raw;
  var keys = Object.keys(labelMap);
  for (var i = 0; i < keys.length; i++) {
    if (labelMap[keys[i]] === raw) return keys[i];
  }
  return raw;
}

function researchOpportunityKey_(site, query) {
  return String(site || '').trim() + '||' + normalizeOpportunityQuery_(query);
}

/**
 * EXPAND + 具体承接页：站点 + 路径 + 动作。
 * NEW_CONTENT（及无具体页的 EXPAND）：站点 + 动作 + normalized query。
 */
function researchJobClusterKey_(parsed) {
  var site = String(parsed.site || '').trim();
  var action = parsed.actionEnum || '';
  if (canAggregateByPage_(parsed)) {
    return site + '||' + normalizeOpportunityPath_(parsed.pagePath) + '||' + action;
  }
  return site + '||' + action + '||query||' + normalizeOpportunityQuery_(parsed.query);
}

function canAggregateByPage_(parsed) {
  if (!parsed || parsed.actionEnum !== OPPORTUNITY_ACTIONS.RESEARCH_EXPAND_EXISTING) {
    return false;
  }
  var path = normalizeOpportunityPath_(parsed.pagePath);
  if (!path || path === '/') return false;
  var site = { name: parsed.site, propertyUrl: parsed.siteUrl };
  if (isOpportunityHubPath_(path, site)) return false;
  return true;
}

function loadExistingResearchJobs_(sheet) {
  var byOppKey = {};
  var byJobId = {};
  var byClusterKey = {};
  if (!sheet || sheet.getLastRow() < 2) {
    return { byOppKey: byOppKey, byJobId: byJobId, byClusterKey: byClusterKey };
  }
  var lastCol = Math.max(sheet.getLastColumn(), RESEARCH_JOB_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headerIndexMap_(header);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  for (var i = 0; i < rows.length; i++) {
    var jobId = String(cell_(rows[i], col, '任务ID') || '').trim();
    var site = String(cell_(rows[i], col, '站点') || '').trim();
    var pagePath = String(cell_(rows[i], col, '页面路径') || '').trim();
    var actionLabel = String(cell_(rows[i], col, '建议动作') || '').trim();
    var actionEnum = enumFromLabel_(OPPORTUNITY_ACTION_LABELS, actionLabel);
    var sourceQuery = String(cell_(rows[i], col, 'source_query') || '').trim();
    var related = String(cell_(rows[i], col, '关联搜索词') || '').trim();
    if (jobId) byJobId[jobId] = true;
    if (jobId && /^asset-/.test(jobId)) continue;
    if (site && actionEnum) {
      var fake = {
        site: site,
        siteUrl: '',
        pagePath: pagePath,
        actionEnum: actionEnum,
        query: sourceQuery
      };
      byClusterKey[researchJobClusterKey_(fake)] = jobId;
    }
    if (site && sourceQuery) {
      var srcKey = researchOpportunityKey_(site, sourceQuery);
      if (!byOppKey[srcKey]) byOppKey[srcKey] = jobId;
    }
    if (site && related) {
      var parts = related.split('|');
      for (var p = 0; p < parts.length; p++) {
        var rel = String(parts[p] || '').trim();
        if (!rel) continue;
        var relKey = researchOpportunityKey_(site, rel);
        if (!byOppKey[relKey]) byOppKey[relKey] = jobId;
      }
    }
  }
  return { byOppKey: byOppKey, byJobId: byJobId, byClusterKey: byClusterKey };
}

function buildResearchJobFromCluster_(members, createdAt) {
  var first = members[0];
  var site = { name: first.site, propertyUrl: first.siteUrl };
  var residuals = [];
  var seenResidual = {};
  for (var i = 0; i < members.length; i++) {
    var residual = researchJobResidual_(members[i].query, site);
    if (!residual) residual = normalizeOpportunityQuery_(members[i].query);
    if (seenResidual[residual]) continue;
    seenResidual[residual] = true;
    residuals.push(residual);
  }
  var topic = members.length > 1
    ? researchJobTopicFromResiduals_(residuals)
    : residuals[0] || researchJobResidual_(first.query, site);
  var sourceQuery = pickResearchSourceQuery_(members, site);
  var pagePath = canAggregateByPage_(first)
    ? first.pagePath
    : first.pagePath || '';
  return {
    job_id: makeResearchJobId_(first.site, pagePath, topic, sourceQuery, createdAt),
    game: first.site,
    topic: topic,
    existing_page: pagePath,
    opportunity_level: OPPORTUNITY_LEVELS.HIGH,
    recommended_action: first.actionEnum,
    source_query: sourceQuery,
    related_queries: residuals.join(' | '),
    created_at: toIso8601_(createdAt)
  };
}

function researchJobResidual_(query, site) {
  var q = normalizeOpportunityQuery_(query);
  if (!q) return '';
  var tokens = tokenizeBrand_(q);
  var brand = getBrandTokenSet_(site);
  var residual = [];
  for (var i = 0; i < tokens.length; i++) {
    if (!brand[tokens[i]]) residual.push(tokens[i]);
  }
  if (!residual.length) return q;
  return residual.join(' ');
}

function researchJobTopicFromResiduals_(residuals) {
  var text = residuals.join(' ').toLowerCase();
  var hasBeta = /\bbeta\b/.test(text);
  var parts = [];
  if (/\bsave(?:\s+file)?\b/.test(text)) {
    parts.push(hasBeta ? 'beta save' : 'save');
  }
  if (/\brewards?\b|\bbonus\b/.test(text)) {
    parts.push(hasBeta ? 'beta rewards' : 'rewards');
  }
  if (/\bcarry[\s-]*over\b|\bcarryover\b|\bprogress\b/.test(text)) {
    parts.push('progress carry-over');
  }
  if (parts.length) return parts.join(' / ');

  var unique = [];
  var seen = {};
  for (var i = 0; i < residuals.length; i++) {
    var r = String(residuals[i] || '').trim();
    if (!r || seen[r]) continue;
    seen[r] = true;
    unique.push(r);
  }
  return unique.join(' / ');
}

function pickResearchSourceQuery_(members, site) {
  var best = members[0];
  var bestScore = -1;
  for (var i = 0; i < members.length; i++) {
    var q = normalizeOpportunityQuery_(members[i].query);
    var residual = researchJobResidual_(members[i].query, site);
    var interrogative = /^(does|do|did|will|would|can|could|how|what|is|are|why|when|where)\b/.test(q);
    var score =
      (Number(members[i].impressions) || 0) * 1000 +
      residual.length * 10 +
      (interrogative ? 0 : 50);
    if (score > bestScore) {
      bestScore = score;
      best = members[i];
    }
  }
  return best.query;
}

function makeResearchJobId_(game, pagePath, topic, query, createdAt) {
  var prefix = RESEARCH_GAME_SLUGS[game] || slugifyResearch_(game);
  var path = normalizeOpportunityPath_(pagePath);
  var slug = '';
  if (path && path !== '/') {
    var segments = path.split('/').filter(function (s) {
      return !!s;
    });
    if (segments.length) slug = slugifyResearch_(segments[segments.length - 1]);
  }
  if (!slug) slug = slugifyResearch_(topic);
  if (!slug) slug = slugifyResearch_(query);
  if (slug.length > 40) slug = slug.substring(0, 40).replace(/-+$/, '');
  var ymd = Utilities.formatDate(createdAt, Session.getScriptTimeZone(), 'yyyyMMdd');
  var id = prefix + '-' + slug + '-' + ymd;
  return id.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function slugifyResearch_(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniquifyResearchJobId_(jobId, query) {
  var extra = slugifyResearch_(query);
  if (extra.length > 12) extra = extra.substring(extra.length - 12);
  if (!extra) extra = 'dup';
  if (jobId.indexOf('-') < 0) return jobId + '-' + extra;
  return jobId.replace(/-(\d{8})$/, '-' + extra + '-$1');
}

function toIso8601_(date) {
  var tz = Session.getScriptTimeZone() || 'Asia/Shanghai';
  var base = Utilities.formatDate(date, tz, "yyyy-MM-dd'T'HH:mm:ss");
  var offset = Utilities.formatDate(date, tz, 'Z');
  if (offset === 'Z') return base + '+00:00';
  if (/^[+-]\d{4}$/.test(offset)) {
    return base + offset.substring(0, 3) + ':' + offset.substring(3);
  }
  return base + '+08:00';
}

function researchJobSheetRow_(job, site, createdAt) {
  return [
    job.job_id,
    createdAt || new Date(),
    site || job.game,
    job.game,
    job.topic,
    job.existing_page,
    opportunityLabel_(OPPORTUNITY_LEVEL_LABELS, job.opportunity_level),
    opportunityLabel_(OPPORTUNITY_ACTION_LABELS, job.recommended_action),
    job.source_query,
    opportunityLabel_(RESEARCH_JOB_STATUS_LABELS, RESEARCH_JOB_STATUS.PENDING),
    job.related_queries || '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    job.research_type || RESEARCH_TYPE.CONTENT_RESEARCH,
    // DEMAND_DISCOVERY 额外元数据列（此类 job 默认空）
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '', // OpportunityID（CONTENT_RESEARCH 不绑定 GSC Opportunity）
    '', '', '', '', // Recommendation linkage
    job.source_action || '',
    job.action_context ? JSON.stringify(job.action_context) : '',
    '', '', '', '', '', '', '', '', '', ''
  ];
}

function writeOpportunityResearchFields_(sheet, col, updates) {
  if (!updates || !updates.length) return;
  var statusIdx = col['研究状态'];
  var jobIdx = col['研究任务ID'];
  var timeIdx = col['研究请求时间'];
  if (statusIdx === undefined || jobIdx === undefined || timeIdx === undefined) {
    throw new Error('内容机会缺少研究回写列');
  }
  for (var i = 0; i < updates.length; i++) {
    var u = updates[i];
    sheet.getRange(u.sheetRow, statusIdx + 1).setValue(u.status);
    sheet.getRange(u.sheetRow, jobIdx + 1).setValue(u.jobId);
    sheet.getRange(u.sheetRow, timeIdx + 1).setValue(u.requestedAt);
  }
}

/**
 * 不写 Sheet、不联网的纯转换自检。
 * @return {string}
 */
function debugResearchJobsSelfCheck() {
  var fails = [];
  function assert(cond, msg) {
    if (!cond) fails.push(msg);
  }

  var mortal = { name: 'Mortal Shell II', propertyUrl: 'https://mortal-shell-ii.vercel.app/' };
  var col = headerIndexMap_(OPPORTUNITY_HEADERS);
  function fakeRow(over) {
    var row = [];
    for (var i = 0; i < OPPORTUNITY_HEADERS.length; i++) row.push('');
    row[col['站点']] = 'Mortal Shell II';
    row[col['站点URL']] = mortal.propertyUrl;
    row[col['搜索词']] = 'mortal shell 2 beta progress carry over';
    row[col['页面路径']] = '/mortal-shell-ii/beta-progress-carry-over/';
    row[col['机会等级']] = '高';
    row[col['建议动作']] = '研究并扩充现有页面';
    row[col['搜索意图']] = '存档进度';
    row[col['意图明确度']] = '明确意图';
    row[col['研究状态']] = '';
    var keys = Object.keys(over || {});
    for (var k = 0; k < keys.length; k++) row[col[keys[k]]] = over[keys[k]];
    return row;
  }

  var ok = parseOpportunityRowForJob_(fakeRow({}), col);
  assert(ok.eligible === true, 'HIGH + expand + empty status should be eligible');
  assert(ok.actionEnum === 'RESEARCH_EXPAND_EXISTING', 'action enum');
  assert(canAggregateByPage_(ok) === true, 'beta page should aggregate');

  var brand = parseOpportunityRowForJob_(
    fakeRow({
      搜索词: 'mortal shell 2',
      搜索意图: '品牌词',
      意图明确度: '仅品牌',
      建议动作: '忽略品牌词',
      机会等级: '观察'
    }),
    col
  );
  assert(brand.eligible === false, 'pure brand should be skipped');

  var watch = parseOpportunityRowForJob_(fakeRow({ 机会等级: '中', 建议动作: '继续观察' }), col);
  assert(watch.eligible === false, 'medium/watch should be skipped');

  var todoOpen = parseOpportunityRowForJob_(fakeRow({ 研究状态: '待研究' }), col);
  assert(todoOpen.eligible === true, '待研究 without job id remains open');

  var queries = [
    'mortal shell 2 beta rewards',
    'mortal shell 2 beta carry over',
    'mortal shell 2 beta progress carry over',
    'does mortal shell 2 beta progress carry over',
    'mortal shell 2 beta save',
    'mortal shell 2 beta save file',
    'mortal shell 2 beta reward',
    'mortal shell 2 open beta rewards'
  ];
  var members = [];
  for (var q = 0; q < queries.length; q++) {
    var parsed = parseOpportunityRowForJob_(fakeRow({ 搜索词: queries[q], 展现: 9 - q }), col);
    assert(parsed.eligible === true, queries[q] + ' eligible');
    members.push(parsed);
  }
  var keys = {};
  for (var k = 0; k < members.length; k++) {
    keys[researchJobClusterKey_(members[k])] = true;
  }
  assert(Object.keys(keys).length === 1, '8 beta queries should share one cluster key');

  var createdAt = new Date('2026-08-14T15:04:00+08:00');
  var job = buildResearchJobFromCluster_(members, createdAt);
  assert(job.job_id === 'ms2-beta-progress-carry-over-20260814', 'page-based job_id');
  assert(job.game === 'Mortal Shell II', 'game');
  assert(job.opportunity_level === 'HIGH', 'HIGH enum');
  assert(job.recommended_action === 'RESEARCH_EXPAND_EXISTING', 'action enum in job');
  assert(job.existing_page === '/mortal-shell-ii/beta-progress-carry-over/', 'existing_page');
  assert(job.topic === 'beta save / beta rewards / progress carry-over', 'compact topic');
  assert(job.related_queries.indexOf('beta rewards') >= 0, 'related contains beta rewards');
  assert(job.related_queries.indexOf('beta save file') >= 0, 'related contains beta save file');
  assert(job.related_queries.indexOf('open beta rewards') >= 0, 'related contains open beta rewards');
  assert(job.related_queries.split(' | ').length === 8, '8 related residual queries');
  assert(job.source_query.indexOf('mortal shell') >= 0, 'source_query keeps a real GSC query');

  var auPs5 = parseOpportunityRowForJob_(
    fakeRow({
      站点: 'Approximately Up',
      站点URL: 'https://approximately-up.vercel.app/',
      搜索词: 'approximately up ps5',
      页面路径: '/',
      机会等级: '高',
      建议动作: '研究新内容',
      搜索意图: '平台',
      意图明确度: '明确意图'
    }),
    col
  );
  assert(auPs5.eligible === true && auPs5.actionEnum === 'RESEARCH_NEW_CONTENT', 'AU ps5 new content');
  assert(canAggregateByPage_(auPs5) === false, 'NEW_CONTENT does not page-aggregate');
  var auJob = buildResearchJobFromCluster_([auPs5], createdAt);
  assert(auJob.recommended_action === 'RESEARCH_NEW_CONTENT', 'RESEARCH_NEW_CONTENT enum');
  assert(auJob.job_id.indexOf('au-') === 0, 'au job_id prefix');
  assert(
    researchJobClusterKey_(auPs5) !== researchJobClusterKey_(ok),
    'AU and Mortal Shell II clusters stay independent'
  );

  var auConsole = parseOpportunityRowForJob_(
    fakeRow({
      站点: 'Approximately Up',
      站点URL: 'https://approximately-up.vercel.app/',
      搜索词: 'approximately up ps5',
      页面路径: '/approximately-up/console/',
      机会等级: '高',
      建议动作: '研究并扩充现有页面',
      搜索意图: '平台',
      意图明确度: '明确意图'
    }),
    col
  );
  assert(canAggregateByPage_(auConsole) === true, 'AU console page can aggregate');
  assert(
    researchJobClusterKey_(auConsole) !== researchJobClusterKey_(ok),
    '/console/ must not merge with Mortal Shell II'
  );

  var sheetRow = researchJobSheetRow_(job, 'Mortal Shell II', createdAt);
  assert(sheetRow[6] === '高', 'level display 高');
  assert(sheetRow[7] === '研究并扩充现有页面', 'action display zh');
  assert(sheetRow[9] === '待处理', 'PENDING display 待处理');
  assert(sheetRow[10] === job.related_queries, '关联搜索词 column');
  assert(sheetRow.length === RESEARCH_JOB_HEADERS.length, 'sheet row matches headers');
  assert(sheetRow[11] === '', '研究结果 empty on create');
  assert(sheetRow[16] === '', '审核摘要 empty on create');
  assert(sheetRow[17] === '', '审核链接 empty on create');
  assert(sheetRow[18] === '', '审核决定 empty on create');
  assert(sheetRow[19] === '', '审核备注 empty on create');
  assert(sheetRow[20] === '', '审核时间 empty on create');
  assert(sheetRow[21] === RESEARCH_TYPE.CONTENT_RESEARCH, '内容机会 Job 研究类型 CONTENT_RESEARCH');
  assert(
    opportunityLabel_(RESEARCH_JOB_STATUS_LABELS, 'REVIEW') === '待审核',
    'REVIEW → 待审核'
  );
  assert(
    opportunityLabel_(RESEARCH_JOB_STATUS_LABELS, 'WATCH') === '继续观察',
    'WATCH → 继续观察'
  );
  assert(
    opportunityLabel_(RESEARCH_JOB_STATUS_LABELS, 'APPROVED') === '已批准',
    'APPROVED → 已批准'
  );
  assert(
    opportunityLabel_(RESEARCH_JOB_STATUS_LABELS, 'ARCHIVED') === '已归档',
    'ARCHIVED → 已归档'
  );
  assert(
    RESEARCH_JOB_STATUS.WATCH === 'WATCH',
    'WATCH job status exists'
  );
  assert(
    statusAfterResearchReviewDecision_('批准开发') === '已批准',
    '批准开发 → 已批准'
  );
  assert(
    statusAfterResearchReviewDecision_('继续观察') === '继续观察',
    '审核继续观察 → 继续观察'
  );
  assert(
    statusAfterResearchReviewDecision_('无需处理') === '已归档',
    '无需处理 → 已归档'
  );
  assert(isResearchJobAwaitingReview_('待审核') === true, '待审核 awaits review');
  assert(isResearchJobAwaitingReview_('继续观察') === false, 'WATCH not awaiting review');
  assert(hasResearchReviewProcessed_('') === false, 'empty 审核时间 not processed');
  assert(hasResearchReviewProcessed_(new Date()) === true, 'Date 审核时间 processed');
  assert(
    RESEARCH_REVIEW_DECISION_OPTIONS.join('|') ===
      '批准开发|继续观察|无需处理',
    '审核决定下拉中文三项'
  );
  assert(
    opportunityLabel_(RESEARCH_RESULT_RECOMMENDATION_LABELS, 'EXPAND_EXISTING') ===
      '扩充现有页面',
    'EXPAND_EXISTING → 扩充现有页面'
  );
  assert(formatResearchEvidenceSource_('steam') === 'Steam', 'steam → Steam');
  assert(formatResearchEvidenceSource_('YouTube') === 'YouTube', 'YouTube label');
  assert(formatResearchEvidenceSource_('reddit') === 'Reddit', 'reddit → Reddit');
  assert(
    truncateResearchEvidenceExcerpt_('abc') === 'abc',
    'short evidence unchanged'
  );
  assert(
    truncateResearchEvidenceExcerpt_(new Array(900 + 1).join('x')).length ===
      RESEARCH_EVIDENCE_EXCERPT_MAX,
    'long evidence truncated to max'
  );
  assert(
    RESEARCH_REVIEW_HEADERS.length === 12 &&
      RESEARCH_REVIEW_HEADERS[0] === '任务ID' &&
      RESEARCH_REVIEW_HEADERS[8] === '证据摘录',
    '研究审核 headers'
  );
  assert(columnIndexToLetter_(12) === 'L', 'col 12 → L');
  assert(
    RESEARCH_JOB_HEADERS.indexOf('审核摘要') >= 0 &&
      RESEARCH_JOB_HEADERS.indexOf('审核链接') >= 0 &&
      RESEARCH_JOB_HEADERS.indexOf('审核决定') >= 0 &&
      RESEARCH_JOB_HEADERS.indexOf('审核备注') >= 0 &&
      RESEARCH_JOB_HEADERS.indexOf('审核时间') >= 0,
    '研究任务 has review gate columns'
  );
  assert(
    RESEARCH_JOB_HEADERS.indexOf('审核决定') < RESEARCH_JOB_HEADERS.indexOf('审核备注') &&
      RESEARCH_JOB_HEADERS.indexOf('审核备注') < RESEARCH_JOB_HEADERS.indexOf('审核时间') &&
      RESEARCH_JOB_HEADERS.indexOf('审核时间') + 1 === RESEARCH_JOB_HEADERS.indexOf('研究类型'),
    '研究类型紧跟审核时间，不移动审核字段'
  );
  assert(
    RESEARCH_JOB_HEADERS.indexOf('发现周期日期') > RESEARCH_JOB_HEADERS.indexOf('研究类型'),
    '发现周期日期追加在研究类型之后'
  );

  var apiJob = researchJobRowToApi_(sheetRow, headerIndexMap_(RESEARCH_JOB_HEADERS));
  assert(apiJob.opportunity_level === 'HIGH', 'API level enum HIGH');
  assert(apiJob.recommended_action === 'RESEARCH_EXPAND_EXISTING', 'API action enum');
  assert(apiJob.related_queries.length === 8, 'API related_queries array');
  assert(isResearchJobPending_('待处理') === true, '待处理 is PENDING');
  assert(isResearchJobPending_('PENDING') === true, 'PENDING enum');
  assert(isResearchJobPending_('DONE') === false, 'DONE not pending');

  var msg;
  if (fails.length) {
    msg = 'FAIL (' + fails.length + '):\n' + fails.join('\n');
  } else {
    msg = 'PASS: Research Jobs self-check';
  }
  Logger.log(msg);
  return msg;
}
