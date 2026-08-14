/**
 * 通用工具：日期、HTTP、重试、日志
 * Token 仅在内存中短暂使用，绝不写入 Sheet / Logger。
 */

/**
 * 统一 GSC / Google API 请求
 * @param {string} url
 * @param {Object=} options UrlFetchApp 选项（method/payload/contentType 等）
 * @return {Object|null} 解析后的 JSON；无 body 时返回 {}
 */
function gscFetch(url, options) {
  options = options || {};
  var method = (options.method || 'get').toUpperCase();
  var token = ScriptApp.getOAuthToken();
  var headers = Object.assign({}, options.headers || {}, {
    Authorization: 'Bearer ' + token
  });

  var fetchOpts = {
    method: method,
    headers: headers,
    muteHttpExceptions: true,
    followRedirects: true
  };

  if (options.payload !== undefined && options.payload !== null) {
    fetchOpts.payload =
      typeof options.payload === 'string'
        ? options.payload
        : JSON.stringify(options.payload);
    fetchOpts.contentType = options.contentType || 'application/json';
  }

  var attempt = 0;
  var lastError = null;

  while (attempt < MAX_RETRIES) {
    attempt++;
    var response = UrlFetchApp.fetch(url, fetchOpts);
    var code = response.getResponseCode();
    var text = response.getContentText() || '';

    if (code >= 200 && code < 300) {
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error('JSON 解析失败: ' + e.message);
      }
    }

    // 授权问题：不重试
    if (code === 401 || code === 403) {
      var authMsg = '授权或权限问题 (HTTP ' + code + '): ' + truncate_(text, 300);
      throw new Error(authMsg);
    }

    // 可重试
    if (code === 429 || code === 500 || code === 502 || code === 503) {
      lastError = 'HTTP ' + code + ': ' + truncate_(text, 200);
      if (attempt >= MAX_RETRIES) break;
      var waitMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
      Utilities.sleep(waitMs);
      continue;
    }

    throw new Error('HTTP ' + code + ': ' + truncate_(text, 300));
  }

  throw new Error('重试 ' + MAX_RETRIES + ' 次后仍失败: ' + lastError);
}

/**
 * 普通 HTTP GET（sitemap 等，不带 OAuth）
 */
function httpGet_(url) {
  var attempt = 0;
  var lastError = null;

  while (attempt < MAX_RETRIES) {
    attempt++;
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true
    });
    var code = response.getResponseCode();
    var text = response.getContentText() || '';

    if (code >= 200 && code < 300) {
      return text;
    }

    if (code === 429 || code === 500 || code === 502 || code === 503) {
      lastError = 'HTTP ' + code;
      if (attempt >= MAX_RETRIES) break;
      Utilities.sleep(Math.pow(2, attempt - 1) * 1000);
      continue;
    }

    throw new Error('请求失败 HTTP ' + code + ': ' + truncate_(text, 200));
  }

  throw new Error('重试后仍失败: ' + lastError);
}

function todayStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatDate_(date) {
  if (!date) return '';
  if (typeof date === 'string') return date.substring(0, 10);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** 从今天往前 n 天（含今天），返回 yyyy-MM-dd */
function daysAgoStr_(n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  return formatDate_(d);
}

/**
 * Fresh Query 日期范围：最近 FRESH_QUERY_DAYS 个自然日（含 runDate）
 * @return {{startDate:string, endDate:string}}
 */
function getFreshQueryDateRange_(runDate) {
  var endDate = toDateStr_(runDate) || todayStr_();
  var startDate = daysAgoStr_(FRESH_QUERY_DAYS - 1);
  return { startDate: startDate, endDate: endDate };
}

/**
 * 列出 startDate ~ endDate（含首尾）的全部 yyyy-MM-dd
 * @return {string[]}
 */
function listDatesInclusive_(startDate, endDate) {
  var start = parseDateOnly_(toDateStr_(startDate));
  var end = parseDateOnly_(toDateStr_(endDate));
  if (!start || !end || start.getTime() > end.getTime()) return [];

  var dates = [];
  var d = new Date(start.getTime());
  while (d.getTime() <= end.getTime()) {
    dates.push(formatDate_(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/**
 * 统一把 Date / yyyy-MM-dd 字符串转为 yyyy-MM-dd。
 * 不要对 Date 直接 String() 后再做 yyyy-MM-dd 正则。
 */
function toDateStr_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return '';
}

/**
 * 计算 Day 数：endDate - Day0 + 1
 * endDate 优先 LatestGSCDataDate；为空时用 RunDate。
 */
function calcDayNumber_(day0, endDate) {
  var s0 = toDateStr_(day0);
  var s1 = toDateStr_(endDate);
  if (!s0 || !s1) return '';
  var d0 = parseDateOnly_(s0);
  var d1 = parseDateOnly_(s1);
  if (!d0 || !d1) return '';
  var diff = Math.floor((d1.getTime() - d0.getTime()) / (24 * 60 * 60 * 1000));
  return diff + 1;
}

function parseDateOnly_(str) {
  var m = String(str || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function truncate_(text, max) {
  text = String(text || '');
  return text.length <= max ? text : text.substring(0, max) + '...';
}

function percent_(num, den) {
  if (!den || den === 0) return 0;
  return num / den;
}

function formatTopList_(rows, nameKey, limit) {
  limit = limit || TOP_N;
  if (!rows || !rows.length) return '';
  var sorted = rows.slice().sort(function (a, b) {
    return (b.impressions || 0) - (a.impressions || 0);
  });
  var parts = [];
  for (var i = 0; i < Math.min(limit, sorted.length); i++) {
    var r = sorted[i];
    var name = (r.keys && r.keys[0]) || r[nameKey] || '';
    parts.push(name + ' (' + (r.impressions || 0) + ')');
  }
  return parts.join(' | ');
}

function writeLog_(level, site, message) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.LOG);
    if (!sheet) return;
    sheet.appendRow([
      new Date(),
      level || 'INFO',
      site || '',
      String(message || '')
    ]);
  } catch (e) {
    // 日志失败不影响主流程
  }
}

function ensureTrailingSlash_(url) {
  url = String(url || '').trim();
  if (!url) return url;
  return url.charAt(url.length - 1) === '/' ? url : url + '/';
}

/**
 * 从完整 PageURL 解析 pathname（不依赖 PropertyURL 字符串替换）。
 * 解析失败时 fallback 为原始 PageURL，不丢弃数据行。
 * @param {string} pageUrl
 * @return {string}
 */
function pagePathFromUrl_(pageUrl) {
  var raw = String(pageUrl || '').trim();
  if (!raw) return '';
  try {
    var u = new URL(raw);
    return u.pathname || '/';
  } catch (e) {
    return raw;
  }
}

function defaultSitemapUrl_(propertyUrl) {
  return ensureTrailingSlash_(propertyUrl) + 'sitemap.xml';
}
