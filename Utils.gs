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
  var contextHint = options.contextHint ? String(options.contextHint) + ' | ' : '';

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

    // 授权问题：不重试；保留 HTTP 状态与截断正文，便于诊断 Property 权限
    if (code === 401 || code === 403) {
      var authMsg =
        'PROPERTY_PERMISSION | 授权或权限问题 (HTTP ' +
        code +
        ') | ' +
        contextHint +
        truncate_(text, 500);
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

    throw new Error(
      contextHint + 'HTTP ' + code + ': ' + truncate_(text, 300)
    );
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

/** 脚本运营日（RunDate / Trigger）：使用项目时区 Asia/Shanghai */
function todayStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatDate_(date) {
  if (!date) return '';
  if (typeof date === 'string') return date.substring(0, 10);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** 从脚本时区「今天」往前 n 天，返回 yyyy-MM-dd（仅用于非 GSC 运营日期） */
function daysAgoStr_(n) {
  return addDaysToDateStr_(todayStr_(), -n);
}

/**
 * GSC 数据日：America/Los_Angeles 的「今天」yyyy-MM-dd
 */
function gscTodayStr_() {
  return Utilities.formatDate(new Date(), GSC_TIMEZONE, 'yyyy-MM-dd');
}

/**
 * 从 GSC「今天」往前 n 个日历日（yyyy-MM-dd 字符串算术，避免跨时区偏移）
 */
function gscDaysAgoStr_(n) {
  return addDaysToDateStr_(gscTodayStr_(), -n);
}

/**
 * 对 yyyy-MM-dd 做日历日加减，返回 yyyy-MM-dd。
 * 使用本地 Date 组件，不经 UTC 格式化，避免时区把日期写偏一天。
 */
function addDaysToDateStr_(yyyyMmDd, deltaDays) {
  var base = toDateStr_(yyyyMmDd);
  var d = parseDateOnly_(base);
  if (!d) return '';
  d.setDate(d.getDate() + Number(deltaDays || 0));
  return formatDateParts_(d);
}

/** 用 Date 本地 Y/M/D 拼 yyyy-MM-dd（不做时区换算） */
function formatDateParts_(d) {
  if (!d || isNaN(d.getTime())) return '';
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return (
    y +
    '-' +
    (m < 10 ? '0' : '') +
    m +
    '-' +
    (day < 10 ? '0' : '') +
    day
  );
}

/**
 * Fresh Query 日期范围：最近 FRESH_QUERY_DAYS 个 GSC 自然日（含 GSC 今天）。
 * 忽略 runDate 的脚本时区日历，避免亚洲上午把 LA 仍属前一天的请求写成「今天」。
 * @param {string=} _runDate 保留参数以兼容旧调用；GSC 边界一律用 LA
 * @return {{startDate:string, endDate:string, gscToday:string}}
 */
function getFreshQueryDateRange_(_runDate) {
  var endDate = gscTodayStr_();
  var startDate = addDaysToDateStr_(endDate, -(FRESH_QUERY_DAYS - 1));
  return { startDate: startDate, endDate: endDate, gscToday: endDate };
}

/**
 * 列出 startDate ~ endDate（含首尾）的全部 yyyy-MM-dd（日历日，无时区偏移）
 * @return {string[]}
 */
function listDatesInclusive_(startDate, endDate) {
  var start = parseDateOnly_(toDateStr_(startDate));
  var end = parseDateOnly_(toDateStr_(endDate));
  if (!start || !end || start.getTime() > end.getTime()) return [];

  var dates = [];
  var d = new Date(start.getTime());
  while (d.getTime() <= end.getTime()) {
    dates.push(formatDateParts_(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/**
 * 是否仍处在 GSC 常见延迟窗口：API 最大数据日 < GSC 今天。
 * @param {string} maxDataDate
 * @param {string=} gscToday
 * @return {boolean}
 */
function isGscDataDelayWindow_(maxDataDate, gscToday) {
  var today = toDateStr_(gscToday) || gscTodayStr_();
  var maxD = toDateStr_(maxDataDate);
  if (!today) return false;
  if (!maxD) return true;
  return maxD < today;
}

/**
 * 从 GSC API 响应中提取不完整数据元信息（有则返回，无则 null；不伪造）。
 * 兼容 snake_case / camelCase。
 * @param {Object=} result
 * @return {{firstIncompleteDate:string, firstIncompleteHour:string}|null}
 */
function extractGscResponseMetadata_(result) {
  if (!result || !result.metadata) return null;
  var md = result.metadata;
  var firstDate =
    md.first_incomplete_date || md.firstIncompleteDate || '';
  var firstHour =
    md.first_incomplete_hour || md.firstIncompleteHour || '';
  if (!firstDate && !firstHour) return null;
  return {
    firstIncompleteDate: String(firstDate || ''),
    firstIncompleteHour: String(firstHour || '')
  };
}

/**
 * 判断是否为 GSC 授权/Property 权限错误（401/403）。
 */
function isGscPermissionError_(err) {
  var msg = String((err && err.message) || err || '');
  return (
    msg.indexOf('HTTP 401') >= 0 ||
    msg.indexOf('HTTP 403') >= 0 ||
    msg.indexOf('授权或权限问题') >= 0 ||
    msg.indexOf('PROPERTY_PERMISSION') >= 0
  );
}

/**
 * URL-prefix Property 保留/补齐末尾 /；sc-domain: 不加斜杠。
 * 不得改成其他路径。
 */
function normalizePropertyUrlForGsc_(url) {
  url = String(url || '').trim();
  if (!url) return url;
  if (url.indexOf('sc-domain:') === 0) {
    return url.replace(/\/+$/, '');
  }
  return ensureTrailingSlash_(url);
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

/** 日志用完整错误：message + stack，避免只看到笼统的 range 文案。 */
function formatErrorWithStack_(err) {
  var msg = String((err && err.message) || err || '');
  var stack = err && err.stack ? String(err.stack) : '';
  if (!stack) return msg;
  if (stack.indexOf(msg) >= 0) return stack;
  return msg + '\n' + stack;
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

/**
 * 安全弹窗：有 UI 时 alert；无 UI（编辑器直接运行 / clasp run）时仅写 Logger。
 * 不吞掉真实业务错误——调用方应先完成逻辑再调用本函数展示结果。
 */
function alertUi_(message) {
  var text = String(message || '');
  try {
    SpreadsheetApp.getUi().alert(text);
  } catch (e) {
    Logger.log('UI alert skipped (' + e.message + '):');
    Logger.log(text);
  }
}

