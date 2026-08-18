/**
 * Search Console API 与 Sitemap / URL Inspection
 */

/**
 * 列出当前账号可访问的全部 property
 * @return {Array<string>} siteUrl 列表
 */
function listGscSites() {
  var data = gscFetch(GSC_API_BASE + '/sites');
  var entries = (data && data.siteEntry) || [];
  return entries.map(function (e) {
    return e.siteUrl;
  });
}

/**
 * Search Analytics query
 * @param {string} siteUrl Property URL（须与 GSC Property 完全一致）
 * @param {Object} body 请求体
 * @return {Object}
 */
function searchAnalyticsQuery(siteUrl, body) {
  var encoded = encodeURIComponent(siteUrl);
  var url = GSC_API_BASE + '/sites/' + encoded + '/searchAnalytics/query';
  try {
    return gscFetch(url, {
      method: 'post',
      payload: body,
      contextHint: 'siteUrl=' + siteUrl
    });
  } catch (e) {
    // 确保上层日志一定带上未改写的 Property URL
    var msg = String(e.message || e);
    if (msg.indexOf('siteUrl=') === -1) {
      throw new Error('siteUrl=' + siteUrl + ' | ' + msg);
    }
    throw e;
  }
}

/**
 * 在最近 lookbackDays 个 GSC 日（America/Los_Angeles）内找出最新有数据的日期
 * @return {string} yyyy-MM-dd 或 ''
 */
function findLatestGscDataDate(siteUrl, lookbackDays) {
  lookbackDays = lookbackDays || LOOKBACK_DAYS_FOR_LATEST;
  var endDate = gscTodayStr_();
  var startDate = gscDaysAgoStr_(lookbackDays - 1);

  var result = searchAnalyticsQuery(siteUrl, {
    startDate: startDate,
    endDate: endDate,
    dimensions: ['date'],
    rowLimit: lookbackDays + 5
  });

  var rows = (result && result.rows) || [];
  if (!rows.length) return '';

  var latest = '';
  for (var i = 0; i < rows.length; i++) {
    var d = rows[i].keys && rows[i].keys[0];
    if (d && d > latest) latest = d;
  }
  return latest;
}

/**
 * 网站总体指标（无 dimension）
 */
function fetchSiteTotals(siteUrl, dataDate) {
  var result = searchAnalyticsQuery(siteUrl, {
    startDate: dataDate,
    endDate: dataDate,
    rowLimit: 1
  });
  var rows = (result && result.rows) || [];
  if (!rows.length) {
    return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  }
  var r = rows[0];
  return {
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctr: r.ctr || 0,
    position: r.position || 0
  };
}

/**
 * Query 明细（finalized，用于 GSC日数据 TopQueries / ReturnedQueryCount）
 */
function fetchQueries(siteUrl, dataDate, rowLimit) {
  rowLimit = rowLimit || QUERY_ROW_LIMIT;
  var result = searchAnalyticsQuery(siteUrl, {
    startDate: dataDate,
    endDate: dataDate,
    dimensions: ['query'],
    rowLimit: rowLimit
  });
  return (result && result.rows) || [];
}

/**
 * Fresh Query 明细（含 preliminary 数据，用于 Query明细 / PAGE_OPPORTUNITIES）
 * @param {string} siteUrl
 * @param {string} dataDate yyyy-MM-dd（GSC / America/Los_Angeles 日历日）
 * @param {number=} rowLimit
 * @return {Array}
 */
function fetchFreshQueries(siteUrl, dataDate, rowLimit) {
  return fetchFreshQueriesResult_(siteUrl, dataDate, rowLimit).rows;
}

/**
 * Fresh Query 单日完整响应（rows + 可选 metadata）
 * @return {{rows:Array, metadata:Object|null, result:Object}}
 */
function fetchFreshQueriesResult_(siteUrl, dataDate, rowLimit) {
  rowLimit = rowLimit || QUERY_ROW_LIMIT;
  var result = searchAnalyticsQuery(siteUrl, {
    startDate: dataDate,
    endDate: dataDate,
    dimensions: ['query'],
    dataState: 'all',
    rowLimit: rowLimit
  });
  return {
    rows: (result && result.rows) || [],
    metadata: extractGscResponseMetadata_(result),
    result: result || {}
  };
}

/**
 * 按 date 维度探测 Fresh 范围的最大数据日与 first_incomplete_date（若 API 返回）。
 * Query 单维请求通常不含该 metadata，故单独探测；失败时返回空结果，不抛错阻断。
 * @return {{maxDataDate:string, rowCount:number, metadata:Object|null}}
 */
function fetchFreshDateCoverage_(siteUrl, startDate, endDate) {
  var empty = { maxDataDate: '', rowCount: 0, metadata: null };
  try {
    var result = searchAnalyticsQuery(siteUrl, {
      startDate: startDate,
      endDate: endDate,
      dimensions: ['date'],
      dataState: 'all',
      rowLimit: 50
    });
    var rows = (result && result.rows) || [];
    var maxDataDate = '';
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i].keys && rows[i].keys[0];
      if (d && d > maxDataDate) maxDataDate = d;
    }
    return {
      maxDataDate: maxDataDate,
      rowCount: rows.length,
      metadata: extractGscResponseMetadata_(result)
    };
  } catch (e) {
    if (isGscPermissionError_(e)) throw e;
    writeLog_('WARN', '', 'Fresh date coverage 探测失败: ' + e.message);
    return empty;
  }
}

/**
 * 近 N 天逐日拉取 Fresh Query（避免多日合并超出 rowLimit）
 * dataDate 使用请求的 GSC 日历日；空结果不写入、不删历史。
 * @return {Array<{dataDate:string, rows:Array, metadata:Object|null}>}
 */
function fetchFreshQueriesForRange(siteUrl, startDate, endDate, rowLimit) {
  var out = [];
  var dates = listDatesInclusive_(startDate, endDate);
  for (var i = 0; i < dates.length; i++) {
    var packed = fetchFreshQueriesResult_(siteUrl, dates[i], rowLimit);
    out.push({
      dataDate: dates[i],
      rows: packed.rows,
      metadata: packed.metadata
    });
  }
  return out;
}

/**
 * Page 明细（finalized，用于 GSC日数据 TopPages）
 */
function fetchPages(siteUrl, dataDate, rowLimit) {
  rowLimit = rowLimit || QUERY_ROW_LIMIT;
  var result = searchAnalyticsQuery(siteUrl, {
    startDate: dataDate,
    endDate: dataDate,
    dimensions: ['page'],
    rowLimit: rowLimit
  });
  return (result && result.rows) || [];
}

/**
 * 将 Search Analytics page-only 行标准化。
 * 约定 keys[0]=page；缺键则跳过，不造假值。
 * @param {Array=} rows
 * @return {Array<{page:string,clicks:number,impressions:number,ctr:number,position:number}>}
 */
function normalizePageRows_(rows) {
  var out = [];
  if (!rows || !rows.length) return out;

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var keys = r && r.keys;
    if (!keys || !keys.length) continue;
    var page = keys[0];
    if (!page) continue;
    out.push({
      page: String(page),
      clicks: r.clicks || 0,
      impressions: r.impressions || 0,
      ctr: r.ctr || 0,
      position: r.position || 0
    });
  }
  return out;
}

/**
 * Fresh Page 明细（dataState=all，与 fetchFreshQueries / Page明细同口径）
 * 不要带 query 维度。本轮无 pagination。
 * @param {string} siteUrl
 * @param {string} dataDate yyyy-MM-dd
 * @param {number=} rowLimit
 * @return {Array<{page:string,clicks:number,impressions:number,ctr:number,position:number}>}
 */
function fetchFreshPages(siteUrl, dataDate, rowLimit) {
  rowLimit = rowLimit || QUERY_ROW_LIMIT;
  var result = searchAnalyticsQuery(siteUrl, {
    startDate: dataDate,
    endDate: dataDate,
    dimensions: ['page'],
    dataState: 'all',
    rowLimit: rowLimit
  });
  return normalizePageRows_((result && result.rows) || []);
}

/**
 * 将 Search Analytics query+page 行标准化。
 * 约定 keys[0]=query, keys[1]=page；缺键则跳过，不造假值。
 * @param {Array=} rows
 * @return {Array<{query:string,page:string,clicks:number,impressions:number,ctr:number,position:number}>}
 */
function normalizeQueryPageRows_(rows) {
  var out = [];
  if (!rows || !rows.length) return out;

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var keys = r && r.keys;
    if (!keys || keys.length < 2) continue;
    var query = keys[0];
    var page = keys[1];
    if (!query || !page) continue;
    out.push({
      query: String(query),
      page: String(page),
      clicks: r.clicks || 0,
      impressions: r.impressions || 0,
      ctr: r.ctr || 0,
      position: r.position || 0
    });
  }
  return out;
}

/**
 * Query × Page（finalized，与 fetchQueries / fetchPages 同口径）
 * @param {string} siteUrl
 * @param {string} dataDate yyyy-MM-dd
 * @param {number=} rowLimit
 * @return {Array<{query:string,page:string,clicks:number,impressions:number,ctr:number,position:number}>}
 */
function fetchQueryPages(siteUrl, dataDate, rowLimit) {
  rowLimit = rowLimit || QUERY_ROW_LIMIT;
  var result = searchAnalyticsQuery(siteUrl, {
    startDate: dataDate,
    endDate: dataDate,
    dimensions: ['query', 'page'],
    rowLimit: rowLimit
  });
  return normalizeQueryPageRows_((result && result.rows) || []);
}

/**
 * Fresh Query × Page（dataState=all，与 fetchFreshQueries / Query明细同口径）
 * @param {string} siteUrl
 * @param {string} dataDate yyyy-MM-dd
 * @param {number=} rowLimit
 * @return {Array<{query:string,page:string,clicks:number,impressions:number,ctr:number,position:number}>}
 */
function fetchFreshQueryPages(siteUrl, dataDate, rowLimit) {
  rowLimit = rowLimit || QUERY_ROW_LIMIT;
  var result = searchAnalyticsQuery(siteUrl, {
    startDate: dataDate,
    endDate: dataDate,
    dimensions: ['query', 'page'],
    dataState: 'all',
    rowLimit: rowLimit
  });
  return normalizeQueryPageRows_((result && result.rows) || []);
}

/**
 * 分页拉取 Search Analytics 全部行。不改现有单页 fetch* 函数。
 * 复用 searchAnalyticsQuery / extractGscResponseMetadata_。
 * @param {string} siteUrl
 * @param {Object} body 请求体（含 rowLimit）
 * @return {{rows:Array, metadata:Object|null, result:Object}}
 */
function searchAnalyticsQueryAllRows_(siteUrl, body) {
  body = body || {};
  var allRows = [];
  var startRow = 0;
  var limit = body.rowLimit || FRESH_HOURLY_ROW_LIMIT;
  var metadata = null;
  var lastResult = {};
  var guard = 0;

  while (guard < 20) {
    guard++;
    var pageBody = Object.assign({}, body, {
      rowLimit: limit,
      startRow: startRow
    });
    var result = searchAnalyticsQuery(siteUrl, pageBody);
    lastResult = result || {};
    var md = extractGscResponseMetadata_(result);
    if (md) metadata = md;
    var rows = (result && result.rows) || [];
    for (var i = 0; i < rows.length; i++) allRows.push(rows[i]);
    if (rows.length < limit) break;
    startRow += rows.length;
  }

  return {
    rows: allRows,
    metadata: metadata,
    result: lastResult
  };
}

/**
 * 将 hour+query+page 行标准化。约定 keys[0]=hour, keys[1]=query, keys[2]=page。
 * 缺键或 hour 无法解析则跳过，不造假值。
 * @param {Array=} rows
 * @return {Array<{hour:string,hourMs:number,query:string,page:string,clicks:number,impressions:number,position:number}>}
 */
function normalizeHourlyQueryPageRows_(rows) {
  var out = [];
  if (!rows || !rows.length) return out;

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var keys = r && r.keys;
    if (!keys || keys.length < 3) continue;
    var hour = keys[0];
    var query = keys[1];
    var page = keys[2];
    if (!hour || !query || !page) continue;
    var hourMs = parseGscHourMs_(hour);
    if (hourMs === null) continue;
    out.push({
      hour: String(hour),
      hourMs: hourMs,
      query: String(query),
      page: String(page),
      clicks: r.clicks || 0,
      impressions: r.impressions || 0,
      position: r.position || 0
    });
  }
  return out;
}

/**
 * Fresh hourly Query × Page（dataState=hourly_all）。
 * 只供实时 Query 监控旁路使用，不要写入 GSC日数据 / Query明细 / Decision。
 * @param {string} siteUrl
 * @param {string} startDate yyyy-MM-dd
 * @param {string} endDate yyyy-MM-dd
 * @param {number=} rowLimit
 * @return {{rows:Array, metadata:Object|null, result:Object}}
 */
function fetchHourlyQueryPagesResult_(siteUrl, startDate, endDate, rowLimit) {
  rowLimit = rowLimit || FRESH_HOURLY_ROW_LIMIT;
  var packed = searchAnalyticsQueryAllRows_(siteUrl, {
    startDate: startDate,
    endDate: endDate,
    dimensions: ['hour', 'query', 'page'],
    dataState: 'hourly_all',
    rowLimit: rowLimit
  });
  return {
    rows: normalizeHourlyQueryPageRows_(packed.rows),
    metadata: packed.metadata,
    result: packed.result || {}
  };
}

/**
 * 找出 Day0 ~ endDate 之间最早 impressions > 0 的日期
 */
function findFirstImpressionDate(siteUrl, day0, endDate) {
  if (!day0 || !endDate) return '';
  var result = searchAnalyticsQuery(siteUrl, {
    startDate: day0,
    endDate: endDate,
    dimensions: ['date'],
    rowLimit: 25000
  });
  var rows = (result && result.rows) || [];
  var earliest = '';
  for (var i = 0; i < rows.length; i++) {
    var impressions = rows[i].impressions || 0;
    if (impressions <= 0) continue;
    var d = rows[i].keys && rows[i].keys[0];
    if (!d) continue;
    if (!earliest || d < earliest) earliest = d;
  }
  return earliest;
}

/**
 * 回填用：获取一段日期范围内按日汇总
 */
function fetchDateRows(siteUrl, startDate, endDate) {
  var result = searchAnalyticsQuery(siteUrl, {
    startDate: startDate,
    endDate: endDate,
    dimensions: ['date'],
    rowLimit: 100
  });
  return (result && result.rows) || [];
}

/**
 * 拉取并解析 sitemap，支持 urlset 与简单 sitemapindex
 * @return {string[]} 去重后的 URL 列表
 */
function fetchSitemapUrls(sitemapUrl) {
  var xmlText = httpGet_(sitemapUrl);
  return parseSitemapXml_(xmlText, 0);
}

function parseSitemapXml_(xmlText, depth) {
  depth = depth || 0;
  if (depth > 2) return []; // 防止过深嵌套

  var doc;
  try {
    doc = XmlService.parse(xmlText);
  } catch (e) {
    throw new Error('Sitemap XML 解析失败: ' + e.message);
  }

  var root = doc.getRootElement();
  var rootName = root.getName();
  var urls = [];

  if (rootName === 'sitemapindex') {
    var sitemaps = root.getChildren('sitemap', root.getNamespace());
    for (var i = 0; i < sitemaps.length; i++) {
      var locEl = sitemaps[i].getChild('loc', root.getNamespace());
      if (!locEl) continue;
      var childUrl = locEl.getText().trim();
      if (!childUrl) continue;
      try {
        var childXml = httpGet_(childUrl);
        var childUrls = parseSitemapXml_(childXml, depth + 1);
        urls = urls.concat(childUrls);
      } catch (err) {
        writeLog_('WARN', '', '子 sitemap 失败: ' + childUrl + ' — ' + err.message);
      }
    }
  } else if (rootName === 'urlset') {
    var urlEls = root.getChildren('url', root.getNamespace());
    for (var j = 0; j < urlEls.length; j++) {
      var loc = urlEls[j].getChild('loc', root.getNamespace());
      if (loc) {
        var u = loc.getText().trim();
        if (u) urls.push(u);
      }
    }
  } else {
    // 兜底：用正则抓 loc
    var matches = String(xmlText).match(/<loc>\s*([^<]+)\s*<\/loc>/gi) || [];
    for (var k = 0; k < matches.length; k++) {
      var m = matches[k].replace(/<\/?loc>/gi, '').trim();
      if (m) urls.push(m);
    }
  }

  return uniqueStrings_(urls);
}

function uniqueStrings_(arr) {
  var seen = {};
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var v = String(arr[i] || '').trim();
    if (!v || seen[v]) continue;
    seen[v] = true;
    out.push(v);
  }
  return out;
}

/**
 * URL Inspection
 * @return {Object} { ok, data|error }
 */
function inspectUrl(inspectionUrl, siteUrl) {
  try {
    var data = gscFetch(URL_INSPECTION_API, {
      method: 'post',
      payload: {
        inspectionUrl: inspectionUrl,
        siteUrl: siteUrl,
        languageCode: 'en-US'
      }
    });
    return { ok: true, data: data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function extractIndexStatus_(inspectionResponse) {
  var empty = {
    verdict: '',
    coverageState: '',
    robotsTxtState: '',
    indexingState: '',
    lastCrawlTime: '',
    pageFetchState: '',
    googleCanonical: '',
    userCanonical: '',
    crawledAs: ''
  };
  if (!inspectionResponse || !inspectionResponse.inspectionResult) return empty;
  var status = inspectionResponse.inspectionResult.indexStatusResult || {};
  return {
    verdict: status.verdict || '',
    coverageState: status.coverageState || '',
    robotsTxtState: status.robotsTxtState || '',
    indexingState: status.indexingState || '',
    lastCrawlTime: status.lastCrawlTime || '',
    pageFetchState: status.pageFetchState || '',
    googleCanonical: status.googleCanonical || '',
    userCanonical: status.userCanonical || '',
    crawledAs: status.crawledAs || ''
  };
}
