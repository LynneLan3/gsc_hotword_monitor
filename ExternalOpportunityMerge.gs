/**
 * Phase 7C-3B M0
 * External Discovery + GSC + Existing Content → Opportunity Candidate。
 *
 * 只负责 Opportunity Merge Owner 的纯转换和现有「内容机会」Sheet 的幂等
 * 写入。不创建页面、不调用 Decision Engine、不写今日行动，也不修改
 * Content Intervention / Development / Publishing runtime。
 */

function externalOpportunityJson_(value, fallback) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

function externalOpportunityText_(value) {
  return String(value === null || value === undefined ? '' : value)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function externalOpportunityPath_(value) {
  var path = String(value || '').trim();
  if (!path) return '';
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname || '/';
  } catch (e) {
    // Keep the supplied pathname in a test sandbox without URL support.
  }
  if (path.charAt(0) !== '/') path = '/' + path;
  return path || '/';
}

function externalOpportunityComparablePath_(value) {
  var path = externalOpportunityPath_(value);
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path || '/';
}

function externalOpportunityField_(record, names) {
  record = record || {};
  names = names || [];
  if (record.row && record.col && typeof cell_ === 'function') {
    for (var r = 0; r < names.length; r++) {
      if (record.col[names[r]] !== undefined) return cell_(record.row, record.col, names[r]);
    }
  }
  for (var i = 0; i < names.length; i++) {
    if (record[names[i]] !== undefined && record[names[i]] !== null) return record[names[i]];
  }
  return '';
}

function externalOpportunityRecordSite_(record) {
  return String(externalOpportunityField_(record, [
    'site', 'site_key', 'Site', '站点', '站点名称'
  ]) || '').trim();
}

function externalOpportunityRecordPagePath_(record) {
  return externalOpportunityPath_(externalOpportunityField_(record, [
    'page_path', 'pagePath', 'PagePath', '页面路径', 'path',
    'page_url', 'pageUrl', 'PageURL', '页面URL', '赢家页面'
  ]));
}

function externalOpportunityClusterKey_(cluster) {
  cluster = cluster || {};
  return externalOpportunityText_(externalOpportunityField_(cluster, [
    'topic_key', 'cluster_key', 'cluster_id', 'topic',
    'representative_signal', 'representative_question'
  ]));
}

function externalOpportunityClusterTopic_(cluster) {
  cluster = cluster || {};
  return String(externalOpportunityField_(cluster, [
    'topic', 'representative_signal', 'representative_question', 'topic_key'
  ]) || '').trim();
}

function externalOpportunitySourceReference_(research) {
  research = research || {};
  var path = String(research.result_path || research.resultPath || '').trim();
  var jobId = String(research.job_id || research.jobId || '').trim();
  if (path) return 'research-result:' + path;
  if (jobId) return 'research-job:' + jobId;
  if (research.sourceReference) return String(research.sourceReference);
  return 'research-callback:GAME_WIDE';
}

function externalOpportunityNormalizeResearch_(input) {
  var envelope = externalOpportunityJson_(input, {});
  var result = envelope.result && typeof envelope.result === 'object' ? envelope.result : envelope;
  var researchType = String(
    envelope.research_type || envelope.researchType || result.research_type || ''
  ).trim().toUpperCase();
  var scopeRaw = envelope.discovery_scope || envelope.discoveryScope || result.discovery_scope || '';
  var scope = scopeRaw && typeof scopeRaw === 'object' ? scopeRaw.scope : scopeRaw;
  scope = String(scope || '').trim().toUpperCase();

  if (researchType !== RESEARCH_TYPE.DEMAND_DISCOVERY) {
    return { ok: false, error: 'research_type_not_supported' };
  }
  if (scope !== 'GAME_WIDE') return { ok: false, error: 'discovery_scope_not_supported' };

  var clusters = result.clusters || result.top_clusters || envelope.clusters || envelope.top_clusters || [];
  if (Object.prototype.toString.call(clusters) !== '[object Array]') clusters = [];
  return {
    ok: true,
    researchType: researchType,
    scope: scope,
    jobId: String(envelope.job_id || envelope.jobId || result.job_id || '').trim(),
    site: String(envelope.site_key || envelope.site || result.site_key || result.site || '').trim(),
    game: String(envelope.game_name || envelope.game || result.game_name || result.game || '').trim(),
    sourceReference: externalOpportunitySourceReference_(envelope),
    clusters: clusters
  };
}

function externalOpportunityClusterText_(cluster, game) {
  var questions = cluster.representative_questions || cluster.representativeQuestions || [];
  if (Object.prototype.toString.call(questions) !== '[object Array]') questions = [questions];
  return externalOpportunityText_([
    externalOpportunityField_(cluster, ['topic_key', 'cluster_key', 'cluster_id']),
    externalOpportunityField_(cluster, ['topic', 'representative_signal']),
    externalOpportunityField_(cluster, ['representative_question']),
    questions.join(' '),
    game || ''
  ].join(' '));
}

function externalOpportunityQueryMatchesCluster_(query, cluster, game) {
  var q = externalOpportunityText_(query);
  var text = externalOpportunityClusterText_(cluster, game);
  if (!q || !text) return false;
  if (text.indexOf(q) >= 0 || q.indexOf(text) >= 0) return true;

  // Deterministic token containment fallback. This is matching, not a score.
  var tokens = q.split(/[^a-z0-9]+/).filter(function (token) { return token.length >= 3; });
  if (!tokens.length) return false;
  for (var i = 0; i < tokens.length; i++) {
    if (text.indexOf(tokens[i]) < 0) return false;
  }
  return true;
}

function externalOpportunityGscEvidenceForCluster_(cluster, gsc, game, site) {
  gsc = gsc || {};
  var rows = (gsc.queryPages || gsc.queryPageRows || []).concat(
    gsc.queries || gsc.queryRows || []
  );
  var out = [];
  var seen = {};
  for (var i = 0; i < rows.length; i++) {
    var rowSite = externalOpportunityRecordSite_(rows[i]);
    if (site && rowSite && rowSite !== site) continue;
    var query = String(externalOpportunityField_(rows[i], ['query', 'Query', '搜索词']) || '').trim();
    if (!externalOpportunityQueryMatchesCluster_(query, cluster, game)) continue;
    var pagePath = externalOpportunityRecordPagePath_(rows[i]);
    var key = externalOpportunityText_(query) + '||' + pagePath;
    if (seen[key]) continue;
    seen[key] = true;
    out.push({
      site: rowSite || site || '',
      query: query,
      pageUrl: String(externalOpportunityField_(rows[i], [
        'page_url', 'pageUrl', 'PageURL', '页面URL'
      ]) || '').trim(),
      pagePath: pagePath,
      dataDate: String(externalOpportunityField_(rows[i], [
        'data_date', 'dataDate', 'DataDate', '数据日期'
      ]) || '').trim(),
      clicks: Number(externalOpportunityField_(rows[i], ['clicks', 'Clicks', '点击']) || 0) || 0,
      impressions: Number(externalOpportunityField_(rows[i], [
        'impressions', 'Impressions', '展现'
      ]) || 0) || 0,
      sourceReference: String(externalOpportunityField_(rows[i], [
        'sourceReference', 'source_reference', 'SourceReference'
      ]) || '').trim() || 'gsc:Query页面明细'
    });
  }
  return out;
}

function externalOpportunityAssetMatchesCluster_(asset, cluster, gscEvidence, game) {
  var assetPath = externalOpportunityRecordPagePath_(asset);
  if (!assetPath) return false;
  for (var i = 0; i < gscEvidence.length; i++) {
    if (externalOpportunityComparablePath_(assetPath) ===
        externalOpportunityComparablePath_(gscEvidence[i].pagePath)) return true;
  }
  var title = externalOpportunityText_(externalOpportunityField_(asset, [
    'title', 'page_title', '页面标题', '赢家意图', '资产候选标题'
  ]));
  return !!title && externalOpportunityClusterText_(cluster, game).indexOf(title) >= 0;
}

function externalOpportunityAssetEvidenceForCluster_(cluster, assets, gscEvidence, game, site) {
  assets = assets || [];
  for (var i = 0; i < assets.length; i++) {
    var rowSite = externalOpportunityRecordSite_(assets[i]);
    if (site && rowSite && rowSite !== site) continue;
    if (!externalOpportunityAssetMatchesCluster_(assets[i], cluster, gscEvidence, game)) continue;
    return {
      site: rowSite || site || '',
      pagePath: externalOpportunityRecordPagePath_(assets[i]),
      title: String(externalOpportunityField_(assets[i], [
        'title', 'page_title', '页面标题', '赢家意图', '资产候选标题'
      ]) || '').trim(),
      sourceReference: String(externalOpportunityField_(assets[i], [
        'sourceReference', 'source_reference', 'SourceReference'
      ]) || '').trim() || 'gsc:内容资产'
    };
  }
  return null;
}

function externalOpportunityId_(game, cluster) {
  var explicit = String(externalOpportunityField_(cluster, [
    'OpportunityID', 'opportunity_id', 'opportunityId'
  ]) || '').trim();
  if (explicit) return explicit;
  var gameIdentity = String(externalOpportunityField_(cluster, ['game_id', 'gameId']) || game || '').trim();
  var clusterKey = externalOpportunityClusterKey_(cluster);
  if (!gameIdentity || !clusterKey || typeof buildOpportunityIdFromRadarId_ !== 'function') return '';
  // Reuse the existing RadarID → OpportunityID builder with the same pipe key.
  return buildOpportunityIdFromRadarId_(gameIdentity + '|' + clusterKey);
}

function externalOpportunityEvidence_(cluster, sourceReference) {
  var questions = cluster.representative_questions || cluster.representativeQuestions || [];
  if (Object.prototype.toString.call(questions) !== '[object Array]') questions = [questions];
  return {
    clusterKey: externalOpportunityClusterKey_(cluster),
    topic: externalOpportunityClusterTopic_(cluster),
    representativeQuestions: questions,
    evidenceCount: Number(cluster.evidence_count || cluster.evidenceCount || 0) || 0,
    sourceFamilies: cluster.source_families || cluster.sourceFamilies || [],
    providers: cluster.providers || [],
    exampleUrls: cluster.example_urls || cluster.exampleUrls || [],
    sourceReference: sourceReference
  };
}

function buildExternalOpportunityCandidateM0_(research, cluster, gsc, assets) {
  var external = externalOpportunityEvidence_(cluster, research.sourceReference);
  var gscEvidence = externalOpportunityGscEvidenceForCluster_(
    cluster, gsc, research.game, research.site
  );
  var existingAsset = externalOpportunityAssetEvidenceForCluster_(
    cluster, assets, gscEvidence, research.game, research.site
  );
  var type = EXTERNAL_OPPORTUNITY_TYPES.WATCH;
  var confidence = EXTERNAL_OPPORTUNITY_CONFIDENCE.LOW;
  if (gscEvidence.length && existingAsset) {
    type = EXTERNAL_OPPORTUNITY_TYPES.EXPAND_EXISTING;
    confidence = EXTERNAL_OPPORTUNITY_CONFIDENCE.HIGH;
  } else if (gscEvidence.length) {
    type = EXTERNAL_OPPORTUNITY_TYPES.NEW_PAGE_CANDIDATE;
    confidence = EXTERNAL_OPPORTUNITY_CONFIDENCE.MEDIUM;
  }
  return {
    OpportunityID: externalOpportunityId_(research.game, cluster),
    Site: research.site,
    Game: research.game,
    OpportunityType: type,
    ExternalEvidence: external,
    GSCEvidence: gscEvidence,
    ExistingAsset: existingAsset,
    Confidence: confidence,
    RecommendedAction: type,
    SourceReference: research.sourceReference
  };
}

function externalOpportunityMergeEvidence_(left, right) {
  left = left || {};
  right = right || {};
  var out = {};
  Object.keys(left).forEach(function (key) { out[key] = left[key]; });
  Object.keys(right).forEach(function (key) {
    if (out[key] === undefined || out[key] === null || out[key] === '') out[key] = right[key];
  });
  return out;
}

function mergeGameWideOpportunityCandidatesM0_(researchInput, gsc, assets) {
  var research = externalOpportunityNormalizeResearch_(researchInput);
  if (!research.ok) return research;
  gsc = gsc || {};
  assets = assets || [];
  var byId = {};
  var order = [];
  for (var i = 0; i < research.clusters.length; i++) {
    var candidate = buildExternalOpportunityCandidateM0_(research, research.clusters[i], gsc, assets);
    if (!candidate.OpportunityID) continue;
    if (!byId[candidate.OpportunityID]) {
      byId[candidate.OpportunityID] = candidate;
      order.push(candidate.OpportunityID);
      continue;
    }
    var prior = byId[candidate.OpportunityID];
    prior.ExternalEvidence = externalOpportunityMergeEvidence_(
      prior.ExternalEvidence, candidate.ExternalEvidence
    );
    prior.GSCEvidence = (prior.GSCEvidence || []).concat(candidate.GSCEvidence || []);
    if (!prior.ExistingAsset && candidate.ExistingAsset) prior.ExistingAsset = candidate.ExistingAsset;
    if (prior.Confidence === EXTERNAL_OPPORTUNITY_CONFIDENCE.LOW &&
        candidate.Confidence !== EXTERNAL_OPPORTUNITY_CONFIDENCE.LOW) {
      prior.Confidence = candidate.Confidence;
      prior.OpportunityType = candidate.OpportunityType;
      prior.RecommendedAction = candidate.RecommendedAction;
    }
  }
  var candidates = [];
  for (var o = 0; o < order.length; o++) candidates.push(byId[order[o]]);
  return {
    ok: true,
    researchType: research.researchType,
    scope: research.scope,
    jobId: research.jobId,
    site: research.site,
    game: research.game,
    candidates: candidates
  };
}

function externalOpportunitySheetRecords_(sheetName) {
  if (typeof getSpreadsheet_ !== 'function') return [];
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = typeof headerIndexMap_ === 'function' ? headerIndexMap_(headers) : {};
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  return values.map(function (row) { return { row: row, col: col }; });
}

function loadExternalOpportunityGscInput_() {
  return {
    queries: externalOpportunitySheetRecords_(SHEET_NAMES.QUERIES),
    queryPages: externalOpportunitySheetRecords_(SHEET_NAMES.QUERY_PAGES)
  };
}

function loadExternalOpportunityAssets_() {
  return externalOpportunitySheetRecords_(SHEET_NAMES.WINNER_ASSETS);
}

function ensureExternalOpportunityHeaders_() {
  if (typeof getSpreadsheet_ !== 'function' || typeof ensureSheet_ !== 'function') return;
  var sheet = ensureSheet_(SHEET_NAMES.OPPORTUNITIES, OPPORTUNITY_HEADERS);
  var lastCol = Math.max(sheet.getLastColumn(), OPPORTUNITY_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var missing = [];
  for (var i = 0; i < EXTERNAL_OPPORTUNITY_HEADERS.length; i++) {
    if (header.indexOf(EXTERNAL_OPPORTUNITY_HEADERS[i]) < 0) missing.push(EXTERNAL_OPPORTUNITY_HEADERS[i]);
  }
  if (!missing.length) return;
  ensureSheetGrid_(sheet, 1, lastCol + missing.length);
  sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  sheet.getRange(1, 1, 1, lastCol + missing.length).setFontWeight('bold');
}

function externalOpportunityAllHeaders_() {
  return OPPORTUNITY_HEADERS.concat(EXTERNAL_OPPORTUNITY_HEADERS);
}

function externalOpportunityCandidateRow_(candidate) {
  var headers = externalOpportunityAllHeaders_();
  var row = [];
  for (var i = 0; i < headers.length; i++) row.push('');
  row[headers.indexOf('生成时间')] = new Date();
  row[headers.indexOf('搜索词')] = candidate.ExternalEvidence.topic || candidate.OpportunityID;
  row[headers.indexOf('页面路径')] = candidate.ExistingAsset
    ? candidate.ExistingAsset.pagePath
    : (candidate.GSCEvidence[0] && candidate.GSCEvidence[0].pagePath) || '';
  row[headers.indexOf('数据日期')] = candidate.GSCEvidence[0]
    ? candidate.GSCEvidence[0].dataDate || '' : '';
  row[headers.indexOf('页面URL')] = candidate.GSCEvidence[0]
    ? candidate.GSCEvidence[0].pageUrl || '' : '';
  row[headers.indexOf('点击')] = candidate.GSCEvidence[0]
    ? candidate.GSCEvidence[0].clicks || 0 : 0;
  row[headers.indexOf('展现')] = candidate.GSCEvidence[0]
    ? candidate.GSCEvidence[0].impressions || 0 : 0;
  row[headers.indexOf('OpportunityID')] = candidate.OpportunityID;
  row[headers.indexOf('Game')] = candidate.Game;
  row[headers.indexOf('OpportunityType')] = candidate.OpportunityType;
  row[headers.indexOf('ExternalEvidence')] = JSON.stringify(candidate.ExternalEvidence || {});
  row[headers.indexOf('GSCEvidence')] = JSON.stringify(candidate.GSCEvidence || []);
  row[headers.indexOf('ExistingAsset')] = JSON.stringify(candidate.ExistingAsset || null);
  row[headers.indexOf('Confidence')] = candidate.Confidence;
  row[headers.indexOf('RecommendedAction')] = candidate.RecommendedAction;
  row[headers.indexOf('SourceReference')] = candidate.SourceReference;
  return row;
}

function externalOpportunityRowsForPreservation_() {
  var records = externalOpportunitySheetRecords_(SHEET_NAMES.OPPORTUNITIES);
  var rows = [];
  for (var i = 0; i < records.length; i++) {
    if (String(externalOpportunityField_(records[i], ['OpportunityID']) || '').trim()) rows.push(records[i].row);
  }
  return rows;
}

/** Preserve M0 rows when the legacy GSC-only engine rebuilds its snapshot. */
function mergeExternalOpportunityRowsIntoLegacyOutput_(legacyRows) {
  var externalRows = externalOpportunityRowsForPreservation_();
  if (!externalRows.length) return legacyRows || [];
  var seen = {};
  for (var i = 0; i < externalRows.length; i++) {
    seen[externalOpportunityText_(externalRows[i][2]) + '||' + externalOpportunityText_(externalRows[i][4])] = true;
  }
  var filtered = [];
  for (var j = 0; j < (legacyRows || []).length; j++) {
    var key = externalOpportunityText_(legacyRows[j][2]) + '||' + externalOpportunityText_(legacyRows[j][4]);
    if (!seen[key]) filtered.push(legacyRows[j]);
  }
  return filtered.concat(externalRows);
}

function externalOpportunityOutputRows_(rows) {
  var width = externalOpportunityAllHeaders_().length;
  return (rows || []).map(function (source) {
    var row = (source || []).slice(0, width);
    while (row.length < width) row.push('');
    return row;
  });
}

function writeExternalOpportunityCandidatesM0_(candidates) {
  ensureExternalOpportunityHeaders_();
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.OPPORTUNITIES);
  var headers = externalOpportunityAllHeaders_();
  var lastCol = Math.max(sheet.getLastColumn(), headers.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idCol = header.indexOf('OpportunityID');
  var existing = sheet.getLastRow() >= 2
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues() : [];
  var byId = {};
  for (var i = 0; i < existing.length; i++) {
    var id = String(existing[i][idCol] || '').trim();
    if (id && byId[id] === undefined) byId[id] = i;
  }
  var written = 0;
  for (var c = 0; c < candidates.length; c++) {
    var candidate = candidates[c];
    var row = externalOpportunityCandidateRow_(candidate);
    var index = byId[candidate.OpportunityID];
    if (index !== undefined) {
      sheet.getRange(index + 2, 1, 1, headers.length).setValues([row]);
    } else {
      var target = sheet.getLastRow() + 1;
      ensureSheetGrid_(sheet, target, headers.length);
      sheet.getRange(target, 1, 1, headers.length).setValues([row]);
      byId[candidate.OpportunityID] = target - 2;
    }
    written++;
  }
  return written;
}

/**
 * M0 merge entry. Pass a GAME_WIDE callback payload or wrapped result:
 * runExternalOpportunityMergeM0({ research_type, discovery_scope, clusters })
 *
 * The input is explicit; this entry never guesses a research type or scope.
 */
function runExternalOpportunityMergeM0(researchInput, options) {
  options = options || {};
  var normalized = externalOpportunityNormalizeResearch_(researchInput);
  if (!normalized.ok) return normalized;

  // Callback bodies omit site/game; resolve both from the existing Research Job.
  if ((!normalized.site || !normalized.game) && normalized.jobId) {
    var jobRecords = externalOpportunitySheetRecords_(SHEET_NAMES.RESEARCH_JOBS);
    for (var i = 0; i < jobRecords.length; i++) {
      var id = String(externalOpportunityField_(jobRecords[i], ['任务ID']) || '').trim();
      if (id !== normalized.jobId) continue;
      normalized.site = normalized.site || String(externalOpportunityField_(jobRecords[i], ['站点']) || '').trim();
      normalized.game = normalized.game || String(externalOpportunityField_(jobRecords[i], ['游戏']) || '').trim();
      break;
    }
  }
  if (!normalized.game) return { ok: false, error: 'game_missing' };
  var gsc = options.gsc || loadExternalOpportunityGscInput_();
  var assets = options.assets || options.contentAssets || loadExternalOpportunityAssets_();
  var merged = mergeGameWideOpportunityCandidatesM0_(normalized, gsc, assets);
  if (!merged.ok) return merged;
  if (typeof writeExternalOpportunityCandidatesM0_ === 'function' && typeof getSpreadsheet_ === 'function') {
    merged.written = writeExternalOpportunityCandidatesM0_(merged.candidates);
  }
  return merged;
}

/** Alias used by callback/manual acceptance scripts. */
function mergeGameWideResearchResultM0_(researchInput, options) {
  return runExternalOpportunityMergeM0(researchInput, options);
}
