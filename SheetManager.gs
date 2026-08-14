/**
 * Google Sheet 读写与格式
 */

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * 若 sheet 不存在则创建并设置表头与基础格式；已存在则不改动数据。
 */
function ensureSheet_(name, headers) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Invalid sheetName: ' + String(name));
  }

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.getRange(1, 1, 1, headers.length).createFilter();
  applyColumnWidths_(sheet, name);
  applyNumberFormats_(sheet, name);
  return sheet;
}

function applyColumnWidths_(sheet, name) {
  var widths = {};
  if (name === SHEET_NAMES.SITES) {
    widths = { 1: 220, 2: 360, 3: 360, 4: 110, 5: 80 };
  } else if (name === SHEET_NAMES.SNAPSHOT) {
    widths = {
      1: 100, 2: 130, 3: 180, 4: 280, 5: 50,
      6: 110, 7: 110, 8: 90, 9: 100, 10: 70,
      11: 70, 12: 110, 13: 120, 14: 130,
      15: 280, 16: 280, 17: 200, 18: 140, 19: 220
    };
  } else if (name === SHEET_NAMES.DAILY) {
    widths = {
      1: 100, 2: 180, 3: 70, 4: 100, 5: 70,
      6: 110, 7: 120, 8: 280, 9: 280
    };
  } else if (name === SHEET_NAMES.QUERIES) {
    widths = {
      1: 100, 2: 180, 3: 260, 4: 70, 5: 100, 6: 70, 7: 110
    };
  } else if (name === SHEET_NAMES.QUERY_PAGES) {
    widths = {
      1: 100, 2: 180, 3: 220, 4: 320, 5: 220,
      6: 70, 7: 100, 8: 70, 9: 110
    };
  } else if (name === SHEET_NAMES.URL_INDEX) {
    widths = {
      1: 100, 2: 160, 3: 320, 4: 80, 5: 140, 6: 120,
      7: 120, 8: 140, 9: 120, 10: 220, 11: 220, 12: 90, 13: 200
    };
  } else if (name === SHEET_NAMES.LOG) {
    widths = { 1: 160, 2: 70, 3: 160, 4: 480 };
  } else if (name === SHEET_NAMES.RULES) {
    widths = { 1: 240, 2: 90, 3: 420 };
  } else if (name === SHEET_NAMES.SITE_STATUS) {
    widths = {
      1: 100, 2: 180, 3: 110, 4: 50, 5: 120,
      6: 90, 7: 110, 8: 110, 9: 140, 10: 130,
      11: 90, 12: 110, 13: 140, 14: 120, 15: 120,
      16: 120, 17: 80, 18: 100, 19: 90, 20: 110,
      21: 110, 22: 80, 23: 100, 24: 120, 25: 150, 26: 70, 27: 360
    };
  } else if (name === SHEET_NAMES.TODAY_ACTIONS) {
    widths = {
      1: 100, 2: 70, 3: 180, 4: 120, 5: 150,
      6: 100, 7: 360, 8: 80, 9: 180
    };
  } else if (name === SHEET_NAMES.OPPORTUNITIES) {
    widths = {
      1: 150, 2: 100, 3: 160, 4: 260, 5: 240,
      6: 280, 7: 220, 8: 70, 9: 100, 10: 70,
      11: 110, 12: 120, 13: 120, 14: 90, 15: 180,
      16: 360, 17: 110, 18: 80, 19: 90, 20: 110, 21: 160,
      22: 220, 23: 160
    };
  } else if (name === SHEET_NAMES.RESEARCH_JOBS) {
    widths = {
      1: 260, 2: 160, 3: 160, 4: 160,
      5: 280, 6: 240, 7: 90, 8: 180, 9: 280, 10: 90, 11: 420
    };
  }

  Object.keys(widths).forEach(function (col) {
    sheet.setColumnWidth(Number(col), widths[col]);
  });
}

function applyNumberFormats_(sheet, name) {
  // 对整列设置格式，便于后续写入
  if (name === SHEET_NAMES.SITES) {
    sheet.getRange('D:D').setNumberFormat('yyyy-mm-dd');
  } else if (name === SHEET_NAMES.SNAPSHOT) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('H:H').setNumberFormat('0.00%');
    sheet.getRange('K:K').setNumberFormat('0.00%');
    sheet.getRange('L:L').setNumberFormat('0.0');
    sheet.getRange('N:N').setNumberFormat('yyyy-mm-dd');
  } else if (name === SHEET_NAMES.DAILY) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('E:E').setNumberFormat('0.00%');
    sheet.getRange('F:F').setNumberFormat('0.0');
  } else if (name === SHEET_NAMES.QUERIES) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('F:F').setNumberFormat('0.00%');
    sheet.getRange('G:G').setNumberFormat('0.0');
  } else if (name === SHEET_NAMES.QUERY_PAGES) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('H:H').setNumberFormat('0.00%');
    sheet.getRange('I:I').setNumberFormat('0.0');
  } else if (name === SHEET_NAMES.URL_INDEX) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
  } else if (name === SHEET_NAMES.LOG) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  } else if (name === SHEET_NAMES.SITE_STATUS) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('C:C').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('F:F').setNumberFormat('0.00%');
    sheet.getRange('K:K').setNumberFormat('0.00');
  } else if (name === SHEET_NAMES.TODAY_ACTIONS) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
  } else if (name === SHEET_NAMES.OPPORTUNITIES) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('J:J').setNumberFormat('0.00%');
    sheet.getRange('K:K').setNumberFormat('0.0');
    sheet.getRange('Q:Q').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('W:W').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  } else if (name === SHEET_NAMES.RESEARCH_JOBS) {
    sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }
}

/**
 * 创建全部工作表；预填站点配置（仅当站点配置为空时）
 */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error('No active spreadsheet');
  }

  var sheets = ss.getSheets();

  if (!sheets || sheets.length === 0) {
    throw new Error('Spreadsheet has no sheets');
  }

  // 每次新的 Apps Script execution 都先明确设置一个真实存在的 Sheet 为 active。
  // 当前 Spreadsheet 曾删除默认 Sheet1，单独运行 repairSpreadsheetContext 只对当次 execution 有效，
  // 下一次 execution 仍可能出现 Sheet 0 not found。
  ss.setActiveSheet(sheets[0]);
  SpreadsheetApp.flush();

  Logger.log(
    'setupSheets context: ' +
      sheets[0].getName() +
      ' [gid=' +
      sheets[0].getSheetId() +
      ']'
  );

  Logger.log(
    'setupSheets 将初始化: ' +
      JSON.stringify([
        SHEET_NAMES.SITES,
        SHEET_NAMES.SNAPSHOT,
        SHEET_NAMES.DAILY,
        SHEET_NAMES.QUERIES,
        SHEET_NAMES.QUERY_PAGES,
        SHEET_NAMES.URL_INDEX,
        SHEET_NAMES.LOG,
        SHEET_NAMES.RULES,
        SHEET_NAMES.SITE_STATUS,
        SHEET_NAMES.TODAY_ACTIONS,
        SHEET_NAMES.OPPORTUNITIES,
        SHEET_NAMES.RESEARCH_JOBS
      ])
  );

  ensureSheet_(SHEET_NAMES.SITES, SITE_HEADERS);
  ensureSheet_(SHEET_NAMES.SNAPSHOT, SNAPSHOT_HEADERS);
  ensureSheet_(SHEET_NAMES.DAILY, DAILY_HEADERS);
  ensureSheet_(SHEET_NAMES.QUERIES, QUERY_HEADERS);
  ensureSheet_(SHEET_NAMES.QUERY_PAGES, QUERY_PAGE_HEADERS);
  ensureSheet_(SHEET_NAMES.URL_INDEX, URL_INDEX_HEADERS);
  ensureSheet_(SHEET_NAMES.LOG, LOG_HEADERS);
  ensureSheet_(SHEET_NAMES.RULES, RULE_HEADERS);
  ensureSheet_(SHEET_NAMES.SITE_STATUS, SITE_STATUS_HEADERS);
  ensureSheet_(SHEET_NAMES.TODAY_ACTIONS, TODAY_ACTION_HEADERS);
  ensureSheet_(SHEET_NAMES.OPPORTUNITIES, OPPORTUNITY_HEADERS);
  ensureSheet_(SHEET_NAMES.RESEARCH_JOBS, RESEARCH_JOB_HEADERS);

  seedSitesIfEmpty_();
  seedMissingDecisionRules_();
  applyTodayActionValidation_();

  writeLog_('INFO', '', 'setup 完成：工作表已就绪');
}

function seedSitesIfEmpty_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.SITES);
  if (!sheet) return;
  if (sheet.getLastRow() > 1) return; // 已有数据，不覆盖

  var rows = DEFAULT_SITES.map(function (s) {
    return [
      s.name,
      ensureTrailingSlash_(s.propertyUrl),
      defaultSitemapUrl_(s.propertyUrl),
      '', // Day0 留空
      true
    ];
  });
  if (rows.length === 0) return;

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(2, 5, rows.length, 1).insertCheckboxes();
}

/**
 * 读取启用的站点配置
 * @return {Array<Object>}
 */
function getEnabledSites() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.SITES);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var values = sheet.getRange(2, 1, sheet.getLastRow(), SITE_HEADERS.length).getValues();
  var sites = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var name = String(row[0] || '').trim();
    var propertyUrl = String(row[1] || '').trim();
    if (!name || !propertyUrl) continue;

    var enabled = row[4];
    if (enabled === false || enabled === 'FALSE' || enabled === 'false' || enabled === 0) {
      continue;
    }

    var day0 = row[3];
    var day0Str = toDateStr_(day0);

    var sitemapUrl = String(row[2] || '').trim() || defaultSitemapUrl_(propertyUrl);

    sites.push({
      name: name,
      propertyUrl: ensureTrailingSlash_(propertyUrl),
      sitemapUrl: sitemapUrl,
      day0: day0Str,
      rowIndex: i + 2
    });
  }
  return sites;
}

/**
 * 按唯一键 upsert：keyFn(rowValues) -> string
 * headers 对应列顺序；row 为与 headers 对齐的数组
 */
function upsertRow_(sheetName, headers, row, keyFn) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) {
    sheet = ensureSheet_(sheetName, headers);
  }

  var lastRow = sheet.getLastRow();
  var key = keyFn(row);

  if (lastRow >= 2) {
    var existing = sheet.getRange(2, 1, lastRow, headers.length).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (keyFn(existing[i]) === key) {
        sheet.getRange(i + 2, 1, 1, headers.length).setValues([row]);
        return i + 2;
      }
    }
  }

  sheet.appendRow(row);
  return sheet.getLastRow();
}

function upsertDailyRow_(row) {
  return upsertRow_(SHEET_NAMES.DAILY, DAILY_HEADERS, row, function (r) {
    return normalizeKeyDate_(r[0]) + '||' + String(r[1] || '');
  });
}

function upsertQueryRow_(row) {
  return upsertRow_(SHEET_NAMES.QUERIES, QUERY_HEADERS, row, function (r) {
    return normalizeKeyDate_(r[0]) + '||' + String(r[1] || '') + '||' + String(r[2] || '');
  });
}

/** 唯一键：DataDate + Site + Query + PageURL */
function upsertQueryPageRow_(row) {
  return upsertRow_(SHEET_NAMES.QUERY_PAGES, QUERY_PAGE_HEADERS, row, function (r) {
    return (
      normalizeKeyDate_(r[0]) +
      '||' +
      String(r[1] || '') +
      '||' +
      String(r[2] || '') +
      '||' +
      String(r[3] || '')
    );
  });
}

function appendSnapshotRow_(row) {
  // RunDate + Site 唯一：已存在则更新，不重复 append
  upsertRow_(SHEET_NAMES.SNAPSHOT, SNAPSHOT_HEADERS, row, function (r) {
    return normalizeKeyDate_(r[0]) + '||' + String(r[2] || '');
  });
}

function appendUrlIndexRow_(row) {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.URL_INDEX);
  if (!sheet) sheet = ensureSheet_(SHEET_NAMES.URL_INDEX, URL_INDEX_HEADERS);
  sheet.appendRow(row);
}

/**
 * 从「URL索引」读取某站当前 IndexedURLCount。
 * 按 URL 去重，每个 URL 只取最新一条记录；Verdict === PASS 才计入。
 * 无历史时返回 null（调用方应留空，不要写成 0）。
 * IndexRate 由调用方用 IndexedURLCount / SitemapURLCount 重算。
 * @return {{indexedCount:number, urlCount:number}|null}
 */
function getLatestKnownIndexStats_(siteName) {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.URL_INDEX);
  if (!sheet || sheet.getLastRow() < 2) return null;

  var rows = sheet.getRange(2, 1, sheet.getLastRow(), URL_INDEX_HEADERS.length).getValues();
  // url -> { date, verdict, rowIndex }
  var byUrl = {};
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][1]) !== siteName) continue;
    var url = String(rows[i][2] || '').trim();
    if (!url) continue;
    var d = normalizeKeyDate_(rows[i][0]);
    if (!d) continue;
    var prev = byUrl[url];
    if (!prev || d > prev.date || (d === prev.date && i > prev.rowIndex)) {
      byUrl[url] = {
        date: d,
        verdict: String(rows[i][3] || ''),
        rowIndex: i
      };
    }
  }

  var urls = Object.keys(byUrl);
  if (!urls.length) return null;

  var indexedCount = 0;
  for (var k = 0; k < urls.length; k++) {
    if (byUrl[urls[k]].verdict === 'PASS') indexedCount++;
  }

  return {
    indexedCount: indexedCount,
    urlCount: urls.length
  };
}

function normalizeKeyDate_(v) {
  if (v instanceof Date) return formatDate_(v);
  return String(v || '').trim().substring(0, 10);
}

/**
 * 从历史「每日快照」或「GSC日数据」读取已知 FirstImpressionDate
 */
function getKnownFirstImpressionDate_(siteName) {
  var ss = getSpreadsheet_();

  // 优先从每日快照倒序找非空值
  var snap = ss.getSheetByName(SHEET_NAMES.SNAPSHOT);
  if (snap && snap.getLastRow() >= 2) {
    var data = snap.getRange(2, 1, snap.getLastRow(), SNAPSHOT_HEADERS.length).getValues();
    for (var i = data.length - 1; i >= 0; i--) {
      if (String(data[i][2]) === siteName) {
        var fid = data[i][13];
        if (fid instanceof Date) return formatDate_(fid);
        if (fid) return String(fid).trim().substring(0, 10);
      }
    }
  }

  // 从 GSC日数据找最早 Impressions > 0
  var daily = ss.getSheetByName(SHEET_NAMES.DAILY);
  if (daily && daily.getLastRow() >= 2) {
    var rows = daily.getRange(2, 1, daily.getLastRow(), DAILY_HEADERS.length).getValues();
    var earliest = null;
    for (var j = 0; j < rows.length; j++) {
      if (String(rows[j][1]) !== siteName) continue;
      var impressions = Number(rows[j][3] || 0);
      if (impressions <= 0) continue;
      var d = normalizeKeyDate_(rows[j][0]);
      if (!earliest || d < earliest) earliest = d;
    }
    if (earliest) return earliest;
  }

  return '';
}

/**
 * 获取某站在某个数据日期之前，最近一个有 GSC 日数据的日期
 */
function getPreviousDataDate_(siteName, currentDataDate) {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DAILY);
  if (!sheet || sheet.getLastRow() < 2) return '';

  var rows = sheet.getRange(2, 1, sheet.getLastRow(), DAILY_HEADERS.length).getValues();
  var prev = '';
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][1]) !== siteName) continue;
    var d = normalizeKeyDate_(rows[i][0]);
    if (d && d < currentDataDate && d > prev) prev = d;
  }
  return prev;
}

/**
 * 读取某站某日已保存的 Query 集合
 * @return {Object} query -> true
 */
function getSavedQueriesForDate_(siteName, dataDate) {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.QUERIES);
  var map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;

  var rows = sheet.getRange(2, 1, sheet.getLastRow(), QUERY_HEADERS.length).getValues();
  var target = normalizeKeyDate_(dataDate);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][1]) !== siteName) continue;
    if (normalizeKeyDate_(rows[i][0]) !== target) continue;
    var q = String(rows[i][2] || '');
    if (q) map[q] = true;
  }
  return map;
}

/**
 * 按 Header 名对数据行排序（不含第 1 行 Header；不删 Filter、不改 cell 值）。
 * sortSpecs: [{ header: 'DataDate', ascending: false }, ...]
 * Primary header 缺失 → throw；secondary 缺失 → 跳过。
 */
function sortSheetByHeaders_(sheetName, sortSpecs) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;

  if (!sortSpecs || !sortSpecs.length) return;

  var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var colByHeader = {};
  for (var h = 0; h < headerRow.length; h++) {
    var name = String(headerRow[h] || '').trim();
    if (name) colByHeader[name] = h + 1;
  }

  var primaryName = sortSpecs[0].header;
  if (!colByHeader[primaryName]) {
    throw new Error('SORT primary header missing: ' + primaryName + ' on ' + sheetName);
  }

  var keys = [];
  for (var i = 0; i < sortSpecs.length; i++) {
    var spec = sortSpecs[i];
    var col = colByHeader[spec.header];
    if (!col) {
      if (i === 0) {
        throw new Error('SORT primary header missing: ' + spec.header + ' on ' + sheetName);
      }
      continue;
    }
    keys.push({
      column: col,
      ascending: !!spec.ascending
    });
  }

  if (!keys.length) return;
  sheet.getRange(2, 1, lastRow, lastCol).sort(keys);
}

/** 监控历史表「最新在前」的默认排序规格（不含站点配置等人工表） */
function getMonitoringSortSpecs_() {
  var specs = {};
  specs[SHEET_NAMES.SNAPSHOT] = [
    { header: 'RunDate', ascending: false },
    { header: 'Site', ascending: true }
  ];
  specs[SHEET_NAMES.DAILY] = [
    { header: 'DataDate', ascending: false },
    { header: 'Site', ascending: true }
  ];
  specs[SHEET_NAMES.QUERIES] = [
    { header: 'DataDate', ascending: false },
    { header: 'Site', ascending: true },
    { header: 'Impressions', ascending: false },
    { header: 'AveragePosition', ascending: true }
  ];
  specs[SHEET_NAMES.QUERY_PAGES] = [
    { header: 'DataDate', ascending: false },
    { header: 'Site', ascending: true },
    { header: 'Impressions', ascending: false },
    { header: 'AveragePosition', ascending: true }
  ];
  specs[SHEET_NAMES.URL_INDEX] = [
    { header: 'RunDate', ascending: false },
    { header: 'Site', ascending: true }
  ];
  specs[SHEET_NAMES.LOG] = [
    { header: 'Timestamp', ascending: false }
  ];
  return specs;
}

/**
 * 对指定监控 Sheet（或全部监控历史表）按「最新在前」排序一次。
 * 单表失败只 Logger，不 throw，不影响数据采集 Status。
 * @param {Array<string>=} sheetNames 省略则排序全部监控历史表
 */
function sortSheetsNewestFirst_(sheetNames) {
  var allSpecs = getMonitoringSortSpecs_();
  var names = sheetNames && sheetNames.length
    ? sheetNames
    : [
        SHEET_NAMES.SNAPSHOT,
        SHEET_NAMES.DAILY,
        SHEET_NAMES.QUERIES,
        SHEET_NAMES.QUERY_PAGES,
        SHEET_NAMES.URL_INDEX,
        SHEET_NAMES.LOG
      ];

  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var specs = allSpecs[name];
    if (!specs) {
      Logger.log('SORT_SKIP | ' + name + ' | not a monitoring history sheet');
      continue;
    }
    try {
      sortSheetByHeaders_(name, specs);
      Logger.log('SORT_OK | ' + name);
    } catch (e) {
      Logger.log('SORT_FAILED | ' + name + ' | ' + e.message);
    }
  }
}

/** 全部监控历史表最新在前（内部） */
function sortMonitoringSheetsNewestFirst_() {
  sortSheetsNewestFirst_();
}
