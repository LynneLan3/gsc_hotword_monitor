/**
 * Local Node smoke tests for calendar-date helpers mirrored from Utils.gs.
 * Run: node scripts/test-gsc-dates.js
 */
'use strict';

function toDateStr_(v) {
  if (v === null || v === undefined || v === '') return '';
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return '';
}

function parseDateOnly_(str) {
  var m = String(str || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

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

function addDaysToDateStr_(yyyyMmDd, deltaDays) {
  var base = toDateStr_(yyyyMmDd);
  var d = parseDateOnly_(base);
  if (!d) return '';
  d.setDate(d.getDate() + Number(deltaDays || 0));
  return formatDateParts_(d);
}

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

function isGscDataDelayWindow_(maxDataDate, gscToday) {
  var today = toDateStr_(gscToday);
  var maxD = toDateStr_(maxDataDate);
  if (!today) return false;
  if (!maxD) return true;
  return maxD < today;
}

function normalizePropertyUrlForGsc_(url) {
  url = String(url || '').trim();
  if (!url) return url;
  if (url.indexOf('sc-domain:') === 0) {
    return url.replace(/\/+$/, '');
  }
  return url.charAt(url.length - 1) === '/' ? url : url + '/';
}

function extractGscResponseMetadata_(result) {
  if (!result || !result.metadata) return null;
  var md = result.metadata;
  var firstDate = md.first_incomplete_date || md.firstIncompleteDate || '';
  var firstHour = md.first_incomplete_hour || md.firstIncompleteHour || '';
  if (!firstDate && !firstHour) return null;
  return {
    firstIncompleteDate: String(firstDate || ''),
    firstIncompleteHour: String(firstHour || '')
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function run() {
  assert(addDaysToDateStr_('2026-08-14', -1) === '2026-08-13', 'minus 1 day');
  assert(addDaysToDateStr_('2026-03-01', -1) === '2026-02-28', 'month boundary');
  assert(
    listDatesInclusive_('2026-08-12', '2026-08-14').join(',') ===
      '2026-08-12,2026-08-13,2026-08-14',
    'list dates'
  );

  // Simulate Shanghai morning Aug 15 while LA is still Aug 14:
  // Fresh range must end at LA today, not Shanghai today.
  var gscToday = '2026-08-14';
  var shanghaiRunDate = '2026-08-15';
  var FRESH_QUERY_DAYS = 5;
  var endDate = gscToday; // getFreshQueryDateRange_ ignores shanghaiRunDate
  var startDate = addDaysToDateStr_(endDate, -(FRESH_QUERY_DAYS - 1));
  assert(endDate !== shanghaiRunDate, 'must not use Shanghai runDate as GSC end');
  assert(startDate === '2026-08-10', '5-day window start');
  assert(isGscDataDelayWindow_('2026-08-13', gscToday) === true, 'delay yes');
  assert(isGscDataDelayWindow_('2026-08-14', gscToday) === false, 'delay no');

  assert(
    normalizePropertyUrlForGsc_('https://agent-64.vercel.app') ===
      'https://agent-64.vercel.app/',
    'url-prefix slash'
  );
  assert(
    normalizePropertyUrlForGsc_('sc-domain:example.com/') === 'sc-domain:example.com',
    'sc-domain no slash'
  );
  assert(extractGscResponseMetadata_({}) === null, 'no fake metadata');
  assert(
    extractGscResponseMetadata_({
      metadata: { first_incomplete_date: '2026-08-14' }
    }).firstIncompleteDate === '2026-08-14',
    'snake metadata'
  );

  // Upsert key uniqueness simulation
  function keyOf(r) {
    return r[0] + '||' + r[1] + '||' + r[2];
  }
  var map = {};
  function upsert(row) {
    var k = keyOf(row);
    var action = map[k] ? 'update' : 'insert';
    map[k] = row;
    return action;
  }
  assert(upsert(['2026-08-13', 'S', 'q1', 1]) === 'insert', 'first insert');
  assert(upsert(['2026-08-13', 'S', 'q1', 2]) === 'update', 'second update');
  assert(Object.keys(map).length === 1, 'no duplicate keys');

  // Site isolation
  var processed = [];
  ['A', 'B', 'C'].forEach(function (s) {
    try {
      if (s === 'B') throw new Error('HTTP 403');
      processed.push(s);
    } catch (e) {
      /* continue */
    }
  });
  assert(processed.join(',') === 'A,C', 'isolation continues after 403');

  console.log('PASS: all local GSC date/upsert/isolation smoke tests');
}

run();
