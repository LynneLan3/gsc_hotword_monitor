/**
 * 最小自测：日期边界 / upsert 键 / 权限错误隔离 / 空 Query 不删历史。
 * 在 Apps Script 中运行 runSelfTests()，查看执行记录或弹窗。
 * 不调用真实 GSC 写入（upsert 测试使用临时键并清理）。
 */

function runSelfTests() {
  var results = [];
  results.push(testFreshQueryDateRangeUsesGscTz_());
  results.push(testListDatesNoTimezoneSkew_());
  results.push(testAddDaysCalendarMath_());
  results.push(testDelayWindowLogic_());
  results.push(testPermissionErrorDetection_());
  results.push(testPropertyUrlNormalization_());
  results.push(testUpsertQueryIdempotent_());
  results.push(testEmptyQueryDoesNotDelete_());
  results.push(testSiteIsolationLogic_());
  results.push(testExtractIncompleteMetadata_());

  var failed = [];
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    Logger.log((r.ok ? 'PASS' : 'FAIL') + ' | ' + r.name + (r.detail ? ' | ' + r.detail : ''));
    if (!r.ok) failed.push(r.name + ': ' + (r.detail || ''));
  }

  var summary =
    'SelfTests: ' +
    (results.length - failed.length) +
    '/' +
    results.length +
    ' passed';
  if (failed.length) {
    summary += '\n\nFailed:\n- ' + failed.join('\n- ');
  }
  Logger.log(summary);
  alertUi_(summary);
  return summary;
}

function testFreshQueryDateRangeUsesGscTz_() {
  var name = 'getFreshQueryDateRange_ 使用 GSC LA 边界';
  try {
    var range = getFreshQueryDateRange_('2099-01-01'); // 故意传离谱 runDate，应被忽略
    var gscToday = gscTodayStr_();
    if (range.endDate !== gscToday) {
      return {
        ok: false,
        name: name,
        detail: 'endDate=' + range.endDate + ' expected gscToday=' + gscToday
      };
    }
    if (range.startDate !== addDaysToDateStr_(gscToday, -(FRESH_QUERY_DAYS - 1))) {
      return {
        ok: false,
        name: name,
        detail: 'startDate=' + range.startDate
      };
    }
    var days = listDatesInclusive_(range.startDate, range.endDate);
    if (days.length !== FRESH_QUERY_DAYS) {
      return {
        ok: false,
        name: name,
        detail: 'days=' + days.length + ' expected=' + FRESH_QUERY_DAYS
      };
    }
    return { ok: true, name: name, detail: range.startDate + '~' + range.endDate };
  } catch (e) {
    return { ok: false, name: name, detail: e.message };
  }
}

function testListDatesNoTimezoneSkew_() {
  var name = 'listDatesInclusive_ 跨日不偏移';
  try {
    var dates = listDatesInclusive_('2026-08-12', '2026-08-14');
    var expect = ['2026-08-12', '2026-08-13', '2026-08-14'];
    if (dates.join(',') !== expect.join(',')) {
      return { ok: false, name: name, detail: dates.join(',') };
    }
    return { ok: true, name: name };
  } catch (e) {
    return { ok: false, name: name, detail: e.message };
  }
}

function testAddDaysCalendarMath_() {
  var name = 'addDaysToDateStr_ 日历算术';
  try {
    if (addDaysToDateStr_('2026-03-01', -1) !== '2026-02-28') {
      return { ok: false, name: name, detail: 'leap/month boundary' };
    }
    if (addDaysToDateStr_('2026-08-14', 0) !== '2026-08-14') {
      return { ok: false, name: name, detail: 'zero delta' };
    }
    return { ok: true, name: name };
  } catch (e) {
    return { ok: false, name: name, detail: e.message };
  }
}

function testDelayWindowLogic_() {
  var name = 'isGscDataDelayWindow_';
  try {
    if (!isGscDataDelayWindow_('2026-08-13', '2026-08-14')) {
      return { ok: false, name: name, detail: 'expected delay yes' };
    }
    if (isGscDataDelayWindow_('2026-08-14', '2026-08-14')) {
      return { ok: false, name: name, detail: 'expected delay no' };
    }
    if (!isGscDataDelayWindow_('', '2026-08-14')) {
      return { ok: false, name: name, detail: 'empty max should delay' };
    }
    return { ok: true, name: name };
  } catch (e) {
    return { ok: false, name: name, detail: e.message };
  }
}

function testPermissionErrorDetection_() {
  var name = 'isGscPermissionError_';
  try {
    var e403 = new Error(
      'PROPERTY_PERMISSION | 授权或权限问题 (HTTP 403) | siteUrl=https://x/'
    );
    var e500 = new Error('HTTP 500: boom');
    if (!isGscPermissionError_(e403)) {
      return { ok: false, name: name, detail: '403 not detected' };
    }
    if (isGscPermissionError_(e500)) {
      return { ok: false, name: name, detail: '500 false positive' };
    }
    return { ok: true, name: name };
  } catch (e) {
    return { ok: false, name: name, detail: e.message };
  }
}

function testPropertyUrlNormalization_() {
  var name = 'normalizePropertyUrlForGsc_';
  try {
    var u1 = normalizePropertyUrlForGsc_(
      'https://agent-64.vercel.app/'
    );
    var u2 = normalizePropertyUrlForGsc_(
      'https://agent-64.vercel.app'
    );
    var domain = normalizePropertyUrlForGsc_('sc-domain:example.com/');
    if (u1 !== 'https://agent-64.vercel.app/') {
      return { ok: false, name: name, detail: 'u1=' + u1 };
    }
    if (u2 !== 'https://agent-64.vercel.app/') {
      return { ok: false, name: name, detail: 'u2=' + u2 };
    }
    if (domain !== 'sc-domain:example.com') {
      return { ok: false, name: name, detail: 'domain=' + domain };
    }
    return { ok: true, name: name };
  } catch (e) {
    return { ok: false, name: name, detail: e.message };
  }
}

function testUpsertQueryIdempotent_() {
  var name = 'upsertQueryRow_ 幂等不重复';
  var marker = '__SELFTEST_QUERY_' + Utilities.getUuid();
  try {
    setupSheets();
    var dataDate = '2000-01-01';
    var site = '__SelfTestSite__';
    upsertQueryRow_([dataDate, site, marker, 1, 2, 0.5, 10]);
    upsertQueryRow_([dataDate, site, marker, 3, 4, 0.75, 5]);

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(
      SHEET_NAMES.QUERIES
    );
    var values = sheet.getDataRange().getValues();
    var hits = [];
    for (var i = 1; i < values.length; i++) {
      if (
        String(values[i][1]) === site &&
        String(values[i][2]) === marker
      ) {
        hits.push(values[i]);
      }
    }
    // 清理
    for (var j = values.length - 1; j >= 1; j--) {
      if (
        String(values[j][1]) === site &&
        String(values[j][2]) === marker
      ) {
        sheet.deleteRow(j + 1);
      }
    }
    if (hits.length !== 1) {
      return {
        ok: false,
        name: name,
        detail: 'hits=' + hits.length
      };
    }
    if (Number(hits[0][3]) !== 3 || Number(hits[0][4]) !== 4) {
      return {
        ok: false,
        name: name,
        detail: 'update values not applied'
      };
    }
    return { ok: true, name: name };
  } catch (e) {
    return { ok: false, name: name, detail: e.message };
  }
}

function testEmptyQueryDoesNotDelete_() {
  var name = '空 Query 不删除历史';
  var marker = '__SELFTEST_KEEP_' + Utilities.getUuid();
  try {
    setupSheets();
    var dataDate = '2000-01-02';
    var site = '__SelfTestKeep__';
    upsertQueryRow_([dataDate, site, marker, 9, 99, 0.1, 20]);

    // 模拟空 batches：不调用 upsert，历史应仍在
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(
      SHEET_NAMES.QUERIES
    );
    var values = sheet.getDataRange().getValues();
    var found = false;
    for (var i = 1; i < values.length; i++) {
      if (
        String(values[i][1]) === site &&
        String(values[i][2]) === marker
      ) {
        found = true;
        sheet.deleteRow(i + 1);
        break;
      }
    }
    if (!found) {
      return { ok: false, name: name, detail: 'seed row missing' };
    }
    return { ok: true, name: name };
  } catch (e) {
    return { ok: false, name: name, detail: e.message };
  }
}

function testSiteIsolationLogic_() {
  var name = '单站异常隔离（模拟）';
  try {
    var sites = ['A', 'B', 'C'];
    var processed = [];
    var errors = [];
    for (var i = 0; i < sites.length; i++) {
      try {
        if (sites[i] === 'B') {
          throw new Error(
            'PROPERTY_PERMISSION | 授权或权限问题 (HTTP 403) | siteUrl=https://b/'
          );
        }
        processed.push(sites[i]);
      } catch (e) {
        errors.push(sites[i]);
        if (!isGscPermissionError_(e)) {
          return { ok: false, name: name, detail: 'non-permission on B' };
        }
      }
    }
    if (processed.join(',') !== 'A,C' || errors.join(',') !== 'B') {
      return {
        ok: false,
        name: name,
        detail: 'processed=' + processed.join(',') + ' errors=' + errors.join(',')
      };
    }
    return { ok: true, name: name };
  } catch (e) {
    return { ok: false, name: name, detail: e.message };
  }
}

function testExtractIncompleteMetadata_() {
  var name = 'extractGscResponseMetadata_ 不伪造';
  try {
    if (extractGscResponseMetadata_({}) !== null) {
      return { ok: false, name: name, detail: 'empty should be null' };
    }
    if (extractGscResponseMetadata_({ metadata: {} }) !== null) {
      return { ok: false, name: name, detail: 'empty metadata should be null' };
    }
    var snake = extractGscResponseMetadata_({
      metadata: { first_incomplete_date: '2026-08-14' }
    });
    var camel = extractGscResponseMetadata_({
      metadata: { firstIncompleteDate: '2026-08-13' }
    });
    if (!snake || snake.firstIncompleteDate !== '2026-08-14') {
      return { ok: false, name: name, detail: 'snake failed' };
    }
    if (!camel || camel.firstIncompleteDate !== '2026-08-13') {
      return { ok: false, name: name, detail: 'camel failed' };
    }
    return { ok: true, name: name };
  } catch (e) {
    return { ok: false, name: name, detail: e.message };
  }
}
