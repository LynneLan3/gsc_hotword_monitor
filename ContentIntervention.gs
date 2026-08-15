/**
 * M2-3B Content Intervention Binding
 * 「内容更新记录」是网站实际改动的权威事实表。
 * DecisionID 可选绑定到决策历史；不从 DONE / HumanDecision 自动推断。
 */

/**
 * 已有「内容更新记录」时补齐 更新类型 / DecisionID 表头，不碰旧行业务值。
 */
function ensureContentUpdateHeader_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.CONTENT_UPDATES);
  if (!sheet) return;
  var lastCol = Math.max(sheet.getLastColumn(), CONTENT_UPDATE_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var actual = [];
  for (var i = 0; i < CONTENT_UPDATE_HEADERS.length; i++) {
    actual.push(String(header[i] || '').trim());
  }
  if (actual.join('|') === CONTENT_UPDATE_HEADERS.join('|')) return;
  sheet.getRange(1, 1, 1, CONTENT_UPDATE_HEADERS.length).setValues([CONTENT_UPDATE_HEADERS]);
  sheet.getRange(1, 1, 1, CONTENT_UPDATE_HEADERS.length).setFontWeight('bold');
}

/**
 * 纯函数：构造一行内容更新记录（含可选 更新类型 / DecisionID）。
 * @return {Array}
 */
function buildContentUpdateRow_(updateDate, site, pagePath, source, note, updateType, decisionId) {
  return [
    String(updateDate || '').trim(),
    String(site || '').trim(),
    String(pagePath || '').trim(),
    String(source || '').trim(),
    String(note || '').trim(),
    String(updateType || '').trim(),
    String(decisionId || '').trim()
  ];
}

/**
 * DecisionID 绑定校验（不做模糊匹配）。
 * @return {'valid-unbound'|'valid-bound'|'invalid-binding'}
 */
function classifyContentInterventionDecisionId_(decisionId, existingDecisionIdSet) {
  var id = String(decisionId || '').trim();
  if (!id) return 'valid-unbound';
  var set = existingDecisionIdSet || {};
  if (set[id]) return 'valid-bound';
  return 'invalid-binding';
}

/**
 * 纯函数：规划 intervention 写入（不读写 Sheet）。
 * DecisionID 空 → 正常未绑定。
 * DecisionID 在历史中 → 正式绑定。
 * DecisionID 未知 → 仍写 intervention，但 DecisionID 置空（拒绝悬空外键）。
 *
 * @param {Object} input
 * @param {Object} existingDecisionIdSet DecisionID -> true
 * @return {{row:Array, decisionId:string, decisionBound:boolean, warning:string, reject:boolean}}
 */
function planContentInterventionWrite_(input, existingDecisionIdSet) {
  input = input || {};
  var site = String(input.site || '').trim();
  if (!site) {
    return {
      row: null,
      decisionId: '',
      decisionBound: false,
      warning: 'site 不能为空',
      reject: true
    };
  }
  var requestedId = String(input.decisionId || '').trim();
  var binding = classifyContentInterventionDecisionId_(
    requestedId,
    existingDecisionIdSet
  );
  var storedId = requestedId;
  var warning = '';
  var decisionBound = false;
  if (binding === 'valid-bound') {
    decisionBound = true;
  } else if (binding === 'invalid-binding') {
    storedId = '';
    warning =
      'Content intervention recorded without Decision binding: unknown DecisionID=' +
      requestedId;
  }

  var row = buildContentUpdateRow_(
    input.updateDate,
    site,
    input.pagePath,
    input.source,
    input.note,
    input.updateType,
    storedId
  );
  return {
    row: row,
    decisionId: storedId,
    decisionBound: decisionBound,
    warning: warning,
    reject: false
  };
}

/**
 * 追加一条内容 intervention（权威事实）。
 * @param {string} site
 * @param {string=} pagePath
 * @param {string=} source
 * @param {string=} note
 * @param {string=} updateType
 * @param {string=} decisionId
 */
function recordContentIntervention(site, pagePath, source, note, updateType, decisionId) {
  return recordContentInterventionAt_(
    todayStr_(),
    site,
    pagePath,
    source,
    note,
    updateType,
    decisionId
  );
}

/**
 * @param {string} updateDate yyyy-MM-dd（网站实际改动日）
 * @param {string} site
 * @param {string=} pagePath
 * @param {string=} source
 * @param {string=} note
 * @param {string=} updateType
 * @param {string=} decisionId
 */
function recordContentInterventionAt_(
  updateDate,
  site,
  pagePath,
  source,
  note,
  updateType,
  decisionId
) {
  ensureSheet_(SHEET_NAMES.CONTENT_UPDATES, CONTENT_UPDATE_HEADERS);
  ensureContentUpdateHeader_();

  var date = normalizeKeyDate_(updateDate) || todayStr_();
  var historyIds = loadDecisionIdSetFromHistory_();
  var plan = planContentInterventionWrite_(
    {
      updateDate: date,
      site: site,
      pagePath: pagePath,
      source: source,
      note: note,
      updateType: updateType,
      decisionId: decisionId
    },
    historyIds
  );
  if (plan.reject) {
    throw new Error('recordContentIntervention: ' + plan.warning);
  }
  if (plan.warning) {
    writeLog_('WARN', String(site || ''), plan.warning);
  }

  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.CONTENT_UPDATES);
  sheet.appendRow(plan.row);

  var out = {
    recorded: true,
    updateDate: plan.row[0],
    site: plan.row[1],
    pagePath: plan.row[2],
    source: plan.row[3],
    note: plan.row[4],
    updateType: plan.row[5],
    decisionId: plan.row[6],
    decisionBound: !!plan.decisionBound,
    warning: plan.warning || ''
  };
  writeLog_(
    'INFO',
    out.site,
    'recordContentIntervention ok date=' +
      out.updateDate +
      ' path=' +
      (out.pagePath || '(site-wide)') +
      ' type=' +
      (out.updateType || '') +
      ' decisionId=' +
      (out.decisionId || '(none)') +
      ' bound=' +
      out.decisionBound
  );
  return out;
}

/**
 * 菜单入口：显式记录内容更新（不自动、不接 runDaily / syncHumanDecisions）。
 */
function recordContentInterventionMenu() {
  var ui = SpreadsheetApp.getUi();
  var site = promptTrim_(ui, '站点名称（必填）', '');
  if (site === null) return;
  if (!String(site).trim()) {
    ui.alert('站点不能为空');
    return;
  }
  var pagePath = promptTrim_(ui, '页面路径（空=整站；建议 /game/path/）', '');
  if (pagePath === null) return;
  var updateDate = promptTrim_(ui, '实际更新时间 yyyy-MM-dd（网站改动日）', todayStr_());
  if (updateDate === null) return;
  var updateType = promptTrim_(
    ui,
    '更新类型（可选：CONTENT_OPTIMIZE / CONTENT_EXPAND / INTERNAL_LINK / INDEX_FIX / OTHER）',
    ''
  );
  if (updateType === null) return;
  var source = promptTrim_(ui, '来源（可选）', '');
  if (source === null) return;
  var note = promptTrim_(ui, '更新说明（可选）', '');
  if (note === null) return;
  var decisionId = promptTrim_(ui, 'DecisionID（可选；来自今日行动/决策历史）', '');
  if (decisionId === null) return;

  var result = recordContentInterventionAt_(
    updateDate,
    site,
    pagePath,
    source,
    note,
    updateType,
    decisionId
  );
  var msg =
    '已记录内容更新：' +
    result.site +
    ' @ ' +
    result.updateDate +
    (result.pagePath ? ' ' + result.pagePath : '（整站）');
  if (result.warning) msg += '\n警告：' + result.warning;
  ui.alert(msg);
}

function promptTrim_(ui, title, defaultValue) {
  var hint =
    defaultValue === undefined || defaultValue === ''
      ? '可留空'
      : '默认：' + defaultValue;
  var res = ui.prompt(title, hint, ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return null;
  var v = res.getResponseText();
  if ((v === null || v === undefined || String(v).trim() === '') && defaultValue !== undefined) {
    return defaultValue;
  }
  return v;
}

function loadDecisionIdSetFromHistory_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DECISION_HISTORY);
  var set = {};
  if (!sheet || sheet.getLastRow() < 2) return set;
  var colCount = Math.max(sheet.getLastColumn(), DECISION_HISTORY_HEADERS.length);
  var headers = sheet.getRange(1, 1, 1, colCount).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i] || '').trim();
    if (name && map[name] === undefined) map[name] = i;
  }
  var idCol = map.DecisionID;
  if (idCol === undefined) return set;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, colCount).getValues();
  for (var r = 0; r < values.length; r++) {
    var id = String(values[r][idCol] || '').trim();
    if (id) set[id] = true;
  }
  return set;
}
