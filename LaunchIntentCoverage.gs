/**
 * Launch Intent Coverage: Query facts -> deterministic intent clusters ->
 * ownership/gap -> RoutingDecision. Uses the existing Intent机会 sheet.
 * Competitor input is optional and comes from the existing hotword-engine HTTP
 * boundary; missing external evidence is deliberately HOLD.
 */
function runLaunchIntentCoverage_() {
  var sheet = ensureSheet_(SHEET_NAMES.INTENT_OPPORTUNITIES, LAUNCH_INTENT_COVERAGE_HEADERS);
  ensureSheetHeaders_(sheet, LAUNCH_INTENT_COVERAGE_HEADERS);
  var sites = getEnabledSites();
  var queryRows = loadAllQueryPageRows_();
  var fresh = loadLaunchFreshQueryRows_();
  var rows = [];
  for (var i = 0; i < sites.length; i++) {
    var siteRows = queryRows.filter(function (r) { return String(r[1] || '').trim() === sites[i].name; });
    var freshRows = fresh.filter(function (r) { return String(r[1] || '').trim() === sites[i].name; });
    rows = rows.concat(buildLaunchIntentRows_(sites[i], siteRows, freshRows));
  }
  replaceSheetDataRows_(SHEET_NAMES.INTENT_OPPORTUNITIES, LAUNCH_INTENT_COVERAGE_HEADERS, rows);
  return 'runLaunchIntentCoverage rows=' + rows.length;
}

function loadLaunchFreshQueryRows_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.FRESH_QUERY_MONITOR);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var width = Math.max(sheet.getLastColumn(), FRESH_QUERY_MONITOR_HEADERS.length);
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
}

function buildLaunchIntentRows_(site, queryRows, freshRows) {
  var byKey = {}, order = [];
  function add(q, page, clicks, impressions, position, date, growth, source) {
    q = String(q || '').trim();
    if (!q) return;
    var c = launchIntentCluster_(q, site);
    if (!c) return;
    var key = site.name + '||' + c.key;
    if (!byKey[key]) {
      byKey[key] = { key: c.key, label: c.label, task: c.task, queries: [], pages: {},
        clicks: 0, impressions: 0, positionWeight: 0, previous: 0, cutoff: '', growth: 0 };
      order.push(key);
    }
    var x = byKey[key];
    if (x.queries.indexOf(q) < 0) x.queries.push(q);
    clicks = Number(clicks || 0) || 0; impressions = Number(impressions || 0) || 0;
    x.clicks += clicks; x.impressions += impressions;
    x.positionWeight += (Number(position || 0) || 0) * impressions;
    if (page) x.pages[page] = (x.pages[page] || 0) + impressions;
    if (date && (!x.cutoff || date > x.cutoff)) x.cutoff = date;
    if (Number(growth) > x.growth) x.growth = Number(growth);
    if (source === 'fresh' && impressions > x.previous) x.previous = impressions;
  }
  for (var i = 0; i < queryRows.length; i++) {
    var r = queryRows[i];
    add(r[2], r[3], r[5], r[6], r[8], normalizeKeyDate_(r[0]), 0, 'gsc');
  }
  for (var j = 0; j < freshRows.length; j++) {
    var f = freshRows[j];
    add(f[2], f[3], f[4], f[5], f[7], normalizeKeyDate_(f[18]) || normalizeKeyDate_(f[0]), f[11], 'fresh');
  }
  var competitors = loadCompetitorIntentSignals_(site);
  var competitorKeys = Object.keys(competitors);
  for (var ci = 0; ci < competitorKeys.length; ci++) {
    var ck = competitorKeys[ci];
    if (byKey[site.name + '||' + ck]) continue;
    var cc = launchIntentCluster_(ck, site) || { key: ck, label: ck, task: ck };
    byKey[site.name + '||' + ck] = { key: cc.key, label: cc.label, task: cc.task, queries: [], pages: {},
      clicks: 0, impressions: 0, positionWeight: 0, previous: 0, cutoff: '', growth: 0 };
    order.push(site.name + '||' + ck);
  }
  var out = [];
  for (var k = 0; k < order.length; k++) {
    var c = byKey[order[k]], pages = Object.keys(c.pages);
    pages.sort(function (a, b) { return c.pages[b] - c.pages[a]; });
    var owner = pages[0] || '';
    var ownerShare = c.impressions ? c.pages[owner] / c.impressions : 0;
    var competitor = competitors[c.key] || { status: 'NONE', urls: [] };
    var demand = c.impressions >= 20 || c.clicks > 0 || c.growth >= 0.5;
    var launch = isLaunchSite_(site);
    var strongOwner = !!owner && ownerShare >= 0.6 && !isLaunchAnswerGap_(c, owner);
    var gap = !owner ? 'NO_LOCAL_OWNER' : (strongOwner ? '' : 'ANSWER_OR_COVERAGE_GAP');
    var decision = routeLaunchIntent_(c, { owner: owner, strongOwner: strongOwner, gap: gap,
      competitor: competitor, demand: demand, launch: launch });
    out.push(launchIntentRow_(site, c, owner, ownerShare, competitor, gap, decision, launch));
  }
  return out;
}

function launchIntentCluster_(query, site) {
  var q = normalizeOpportunityQuery_(query);
  var brand = getBrandTokenSet_(site), t = q.split(/[^a-z0-9]+/), keep = [];
  var aliases = { detain: 'arrest', detained: 'arrest', arresting: 'arrest', voip: 'voice chat',
    maps: 'map', bots: 'bot', challenges: 'challenge', chapters: 'chapter' };
  for (var i = 0; i < t.length; i++) {
    var w = aliases[t[i]] || t[i];
    if (!w || brand[w] || /^(the|a|an|can|you|how|to|do|does|is|are|many|what|of|in|on|for|with)$/.test(w)) continue;
    if (keep.indexOf(w) < 0) keep.push(w);
  }
  if (!keep.length) return null;
  var text = keep.join(' '), key = text, label = text, task = text;
  if (/\b(arrest|detain)\b/.test(text) && /michael/.test(q)) { key = 'ARREST_MICHAEL'; label = 'Arrest or detain Michael'; task = 'Arrest / detain Michael'; }
  else if (/offline.*bot|bot.*offline|network.*offline/.test(text)) { key = 'OFFLINE_BOTS'; label = 'Offline bots'; task = 'Play with offline bots'; }
  else if (/evil.*presence|presence.*evil/.test(text)) { key = 'EVIL_PRESENCE'; label = 'Evil Presence'; task = 'Understand Evil Presence'; }
  else if (/voice.*chat|chat.*voice/.test(text)) { key = 'VOICE_CHAT'; label = 'Voice chat / VOIP'; task = 'Use voice chat / VOIP'; }
  else if (/chapter.*challenge|challenge.*chapter/.test(text)) { key = 'CHAPTER_CHALLENGES'; label = 'Chapter challenges'; task = 'Complete chapter challenges'; }
  else if (/steam.*deck|deck.*steam/.test(text)) { key = 'STEAM_DECK'; label = 'Steam Deck'; task = 'Play on Steam Deck'; }
  else if (/how.*many.*map|map.*how.*many|map/.test(text)) { key = 'MAP_COUNT'; label = 'How many maps'; task = 'Know the map count'; }
  return { key: key, label: label, task: task };
}

function loadCompetitorIntentSignals_(site) {
  var out = {}, url = PropertiesService.getScriptProperties().getProperty('HOTWORD_ENGINE_INTENT_GAP_URL');
  if (!url) return out;
  try {
    var endpoint = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'game=' + encodeURIComponent(site.name);
    var data = JSON.parse(UrlFetchApp.fetch(endpoint, { muteHttpExceptions: true }).getContentText() || '{}');
    var list = data.signals || data.intents || [];
    for (var i = 0; i < list.length; i++) {
      var x = list[i] || {}, key = String(x.clusterKey || x.intentKey || '').trim();
      if (key) out[key] = { status: 'COMPETITOR_OWNED', urls: x.urls || (x.url ? [x.url] : []) };
    }
  } catch (e) { writeLog_('WARN', site.name, 'competitor intent signal unavailable: ' + e.message); }
  return out;
}

function isLaunchSite_(site) {
  var phase = String(site.lifecyclePhase || site.lifecycle || '').toUpperCase();
  if (phase) return phase === 'LAUNCH';
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.SITE_STATUS);
  if (!sheet || sheet.getLastRow() < 2) return false;
  var h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0], c = headerIndexMap_(h);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, h.length).getValues();
  for (var i = rows.length - 1; i >= 0; i--) if (String(cell_(rows[i], c, 'Site') || cell_(rows[i], c, '站点') || '') === site.name) {
    return String(cell_(rows[i], c, 'LifecycleStage') || '').toUpperCase() === 'LAUNCH';
  }
  return false;
}

function isLaunchAnswerGap_(cluster, owner) { return !owner || cluster.pages[owner] / Math.max(1, cluster.impressions) < 0.6; }

function routeLaunchIntent_(c, x) {
  if (!x.demand && x.competitor.status !== 'COMPETITOR_OWNED') return 'HOLD';
  if (x.strongOwner && !x.gap) return 'KEEP_EXISTING';
  if (x.owner) return 'EXPAND_EXISTING';
  if (x.demand) return 'CREATE_NEW_PAGE';
  return 'HOLD';
}

/** Bridge only qualifying Intent rows into the existing 研究任务 sheet. */
function createLaunchIntentResearchJobs_() {
  ensureResearchJobSheets_();
  var intentSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.INTENT_OPPORTUNITIES);
  if (!intentSheet || intentSheet.getLastRow() < 2) return { created: 0, skipped: 0 };
  var jobSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS);
  var header = intentSheet.getRange(1, 1, 1, intentSheet.getLastColumn()).getValues()[0], col = headerIndexMap_(header);
  var values = intentSheet.getRange(2, 1, intentSheet.getLastRow() - 1, header.length).getValues();
  var existing = loadExistingResearchJobs_(jobSheet), rows = [], created = 0, skipped = 0;
  var now = new Date();
  for (var i = 0; i < values.length; i++) {
    var r = values[i], route = String(cell_(r, col, 'RoutingDecision') || '').trim();
    var impressions = Number(cell_(r, col, 'ClusterImpressions') || 0) || 0;
    if ((route !== 'EXPAND_EXISTING' && route !== 'CREATE_NEW_PAGE') || impressions < 20) continue;
    var site = String(cell_(r, col, 'Site') || '').trim(), topic = String(cell_(r, col, 'PlayerTask') || cell_(r, col, 'ClusterLabel') || '').trim();
    var owner = String(cell_(r, col, 'LocalOwnerURL') || '').trim(), query = String(cell_(r, col, 'TopQuery') || '').trim();
    if (!site || !topic || !query) continue;
    var action = route === 'EXPAND_EXISTING' ? OPPORTUNITY_ACTIONS.RESEARCH_EXPAND_EXISTING : OPPORTUNITY_ACTIONS.RESEARCH_NEW_CONTENT;
    var fake = { site: site, siteUrl: '', pagePath: owner, query: query, actionEnum: action, impressions: impressions };
    var key = researchJobClusterKey_(fake);
    if (existing.byClusterKey[key]) { skipped++; continue; }
    var job = buildResearchJobFromCluster_([fake], now);
    rows.push(researchJobSheetRow_(job, site, now));
    existing.byClusterKey[key] = job.job_id; created++;
  }
  if (rows.length) jobSheet.getRange(jobSheet.getLastRow() + 1, 1, rows.length, RESEARCH_JOB_HEADERS.length).setValues(rows);
  return { created: created, skipped: skipped };
}

function launchIntentRow_(site, c, owner, share, competitor, gap, decision, launch) {
  var row = [], h = LAUNCH_INTENT_COVERAGE_HEADERS, values = {};
  values.Site = site.name; values.ClusterKey = c.key; values.ClusterLabel = c.label;
  values.ClusterQueries = c.queries.join(' | '); values.QueryCount = c.queries.length;
  values.ClusterClicks = c.clicks; values.ClusterImpressions = c.impressions;
  values.ClusterCTR = c.impressions ? c.clicks / c.impressions : 0;
  values.ClusterPosition = c.impressions ? c.positionWeight / c.impressions : 0;
  values.ClusterGrowthRate = c.growth; values.TopQuery = c.queries[0] || ''; values.TopPage = owner;
  values.TopPageImpressions = owner ? c.pages[owner] : 0; values.TopPageShare = share;
  values.HasExistingPage = owner ? '是' : '否'; values.Action = decision === 'KEEP_EXISTING' ? 'NO_ACTION' : decision;
  values.DataCutoff = c.cutoff; values.IntentType = c.key; values.IntentFamily = c.key;
  values.OpportunityStage = launch ? 'LAUNCH' : 'ONGOING'; values.AbsoluteSignal = c.impressions >= 20 ? 'PASS' : 'HOLD';
  values.AbsoluteSignalReason = 'demand=' + c.impressions + ', clicks=' + c.clicks;
  values.RoutingDecision = decision; values.AdjacentCaptureCandidates = competitor.urls.join(' | ');
  values.AdjacentCaptureReason = competitor.status === 'COMPETITOR_OWNED' ? 'COMPETITOR_OWNED' : '';
  values.PlayerTask = c.task; values.LocalOwnerURL = owner; values.AnswerGap = gap;
  values.CompetitorIntentStatus = competitor.status; values.CompetitorIntentURLs = competitor.urls.join(' | ');
  values.SignalScore = (c.impressions >= 20 ? 1 : 0) + (c.growth >= 0.5 ? 1 : 0) + (competitor.status === 'COMPETITOR_OWNED' ? 1 : 0) + (launch ? 1 : 0);
  values.SignalReason = (launch ? 'LAUNCH_WEIGHTED;' : '') + (competitor.status === 'COMPETITOR_OWNED' ? 'COMPETITOR_OWNED;' : '') + (gap || 'LOCAL_OWNER');
  for (var i = 0; i < h.length; i++) row.push(values[h[i]] === undefined ? '' : values[h[i]]);
  return row;
}

function debugLaunchIntentCoverageSelfCheck() {
  var site = { name: 'Halloween The Game', propertyUrl: 'https://halloween-the-game.vercel.app/' };
  var keys = ['how to arrest michael', 'can you arrest michael', 'detain michael'].map(function (q) { return launchIntentCluster_(q, site).key; });
  if (keys[0] !== 'ARREST_MICHAEL' || keys[1] !== keys[0] || keys[2] !== keys[0]) throw new Error('arrest aliases did not cluster');
  if (routeLaunchIntent_({}, { owner: '/maps/', strongOwner: true, gap: '', competitor: { status: 'NONE' }, demand: true }) !== 'KEEP_EXISTING') throw new Error('strong owner route failed');
  if (routeLaunchIntent_({}, { owner: '', strongOwner: false, gap: 'NO_LOCAL_OWNER', competitor: { status: 'NONE' }, demand: false }) !== 'HOLD') throw new Error('hold route failed');
  return 'PASS debugLaunchIntentCoverageSelfCheck';
}

/** Authorized runtime smoke entry: rebuilds the existing sheet and returns named Halloween rows. */
function runLaunchIntentCoverage() {
  runLaunchIntentCoverage_();
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.INTENT_OPPORTUNITIES);
  if (!sheet || sheet.getLastRow() < 2) return { rows: 0, halloween: [] };
  var h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0], c = headerIndexMap_(h);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, h.length).getValues(), out = [];
  for (var i = 0; i < values.length; i++) {
    if (String(cell_(values[i], c, 'Site') || '') !== 'Halloween The Game') continue;
    out.push({ intent: cell_(values[i], c, 'ClusterKey'), owner: cell_(values[i], c, 'LocalOwnerURL'),
      gap: cell_(values[i], c, 'AnswerGap'), route: cell_(values[i], c, 'RoutingDecision'),
      cutoff: cell_(values[i], c, 'DataCutoff'), competitor: cell_(values[i], c, 'CompetitorIntentStatus') });
  }
  return { rows: sheet.getLastRow() - 1, halloween: out };
}
