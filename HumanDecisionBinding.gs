/**
 * M2-3A Human Action Binding
 * 将「今日行动」中带 DecisionID 的 DONE/SKIP + 人工备注
 * 同步到「决策历史」的 HumanDecision / HumanNote。
 * 不修改 Snapshot 冻结字段，不重跑 Decision Engine，不改 cooldown / Outcome。
 */

/**
 * 独立入口：菜单「同步人工决策」。
 */
function syncHumanDecisions() {
  ensureSheet_(SHEET_NAMES.TODAY_ACTIONS, TODAY_ACTION_HEADERS);
  ensureTodayActionHeader_();
  ensureSheet_(SHEET_NAMES.DECISION_HISTORY, DECISION_HISTORY_HEADERS);
  applyTodayActionValidation_();

  var actions = loadTodayActionsForHumanSync_();
  var history = loadDecisionHistoryRowsForHumanSync_();
  var plan = planHumanDecisionSync_(actions, history);
  var applied = applyHumanDecisionSyncPlan_(plan);

  writeLog_(
    'INFO',
    '',
    'syncHumanDecisions 结束 updated=' +
      applied.updated +
      ' unchanged=' +
      applied.unchanged +
      ' skippedMissingHistory=' +
      plan.skippedMissingHistory +
      ' skippedNoId=' +
      plan.skippedNoId +
      ' skippedTodo=' +
      plan.skippedTodo
  );
  return applied;
}

/**
 * 纯函数：根据今日行动与历史行规划 Human 字段更新。
 * 不模糊匹配 Site/Action；DecisionID 为空或不存在于历史则跳过。
 *
 * @param {Array<{decisionId:string,status:string,note:string}>} actions
 * @param {Array<{decisionId:string,rowIndex:number,humanDecision:string,humanNote:string,frozen:Object}>} historyRows
 * @return {{updates:Array, skippedNoId:number, skippedTodo:number, skippedMissingHistory:number}}
 */
function planHumanDecisionSync_(actions, historyRows) {
  var byId = {};
  var hist = historyRows || [];
  for (var h = 0; h < hist.length; h++) {
    var id = String(hist[h].decisionId || '').trim();
    if (!id) continue;
    byId[id] = hist[h];
  }

  var updates = [];
  var skippedNoId = 0;
  var skippedTodo = 0;
  var skippedMissingHistory = 0;
  var seen = {};

  var list = actions || [];
  for (var i = 0; i < list.length; i++) {
    var a = list[i];
    var decisionId = String((a && a.decisionId) || '').trim();
    if (!decisionId) {
      skippedNoId++;
      continue;
    }
    var status = normalizeTodayStatus_(a.status);
    if (!TODAY_ACTION_HUMAN_SYNC_STATUSES[status]) {
      skippedTodo++;
      continue;
    }
    if (!byId[decisionId]) {
      skippedMissingHistory++;
      continue;
    }
    // 同一 DecisionID 多行时：后出现的覆盖前（Sheet 通常最新在前，但以遍历顺序最后为准）
    seen[decisionId] = {
      decisionId: decisionId,
      humanDecision: status,
      humanNote: a.note === null || a.note === undefined ? '' : String(a.note),
      rowIndex: byId[decisionId].rowIndex,
      frozen: byId[decisionId].frozen || null
    };
  }

  var ids = Object.keys(seen);
  for (var k = 0; k < ids.length; k++) {
    updates.push(seen[ids[k]]);
  }

  return {
    updates: updates,
    skippedNoId: skippedNoId,
    skippedTodo: skippedTodo,
    skippedMissingHistory: skippedMissingHistory
  };
}

/**
 * 纯函数：计算实际需要写回的更新（值未变则计为 unchanged）。
 */
function selectHumanDecisionWrites_(planUpdates, historyById) {
  var writes = [];
  var unchanged = 0;
  var list = planUpdates || [];
  for (var i = 0; i < list.length; i++) {
    var u = list[i];
    var cur = historyById && historyById[u.decisionId];
    if (!cur) continue;
    var sameDecision = String(cur.humanDecision || '') === String(u.humanDecision || '');
    var sameNote = String(cur.humanNote || '') === String(u.humanNote || '');
    if (sameDecision && sameNote) {
      unchanged++;
      continue;
    }
    writes.push(u);
  }
  return { writes: writes, unchanged: unchanged };
}

function loadTodayActionsForHumanSync_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.TODAY_ACTIONS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), TODAY_ACTION_HEADERS.length)).getValues()[0];
  var map = headerIndexMap_(headers);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    out.push({
      decisionId: cellByHeader_(row, map, 'DecisionID'),
      status: cellByHeader_(row, map, 'Status'),
      note: cellByHeader_(row, map, '人工备注')
    });
  }
  return out;
}

function loadDecisionHistoryRowsForHumanSync_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DECISION_HISTORY);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var colCount = Math.max(sheet.getLastColumn(), DECISION_HISTORY_HEADERS.length);
  var headers = sheet.getRange(1, 1, 1, colCount).getValues()[0];
  var map = headerIndexMap_(headers);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, colCount).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var decisionId = String(cellByHeader_(row, map, 'DecisionID') || '').trim();
    if (!decisionId) continue;
    out.push({
      decisionId: decisionId,
      rowIndex: i + 2,
      humanDecision: String(cellByHeader_(row, map, 'HumanDecision') || ''),
      humanNote: String(cellByHeader_(row, map, 'HumanNote') || ''),
      frozen: {
        runDate: cellByHeader_(row, map, 'RunDate'),
        decisionDataDate: cellByHeader_(row, map, 'DecisionDataDate'),
        site: cellByHeader_(row, map, 'Site'),
        ruleVersion: cellByHeader_(row, map, 'RuleVersion'),
        recommendedAction: cellByHeader_(row, map, 'RecommendedAction'),
        domainScore: cellByHeader_(row, map, 'DomainScore'),
        reason: cellByHeader_(row, map, 'Reason'),
        recordedAt: cellByHeader_(row, map, 'RecordedAt')
      }
    });
  }
  return out;
}

function applyHumanDecisionSyncPlan_(plan) {
  plan = plan || { updates: [] };
  var history = loadDecisionHistoryRowsForHumanSync_();
  var byId = {};
  for (var i = 0; i < history.length; i++) {
    byId[history[i].decisionId] = history[i];
  }
  var selected = selectHumanDecisionWrites_(plan.updates, byId);
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DECISION_HISTORY);
  if (!sheet) {
    return { updated: 0, unchanged: selected.unchanged };
  }
  var headers = sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), DECISION_HISTORY_HEADERS.length))
    .getValues()[0];
  var map = headerIndexMap_(headers);
  var colDecision = map.HumanDecision;
  var colNote = map.HumanNote;
  if (colDecision === undefined || colNote === undefined) {
    writeLog_('WARN', '', 'syncHumanDecisions：决策历史缺少 HumanDecision/HumanNote 列');
    return { updated: 0, unchanged: selected.unchanged };
  }

  var writes = selected.writes;
  for (var w = 0; w < writes.length; w++) {
    var u = writes[w];
    // 只写两列；不碰其它冻结字段
    sheet.getRange(u.rowIndex, colDecision + 1).setValue(u.humanDecision);
    sheet.getRange(u.rowIndex, colNote + 1).setValue(u.humanNote);
  }
  return { updated: writes.length, unchanged: selected.unchanged };
}

function headerIndexMap_(headers) {
  var map = {};
  for (var i = 0; i < (headers || []).length; i++) {
    var name = String(headers[i] || '').trim();
    if (name && map[name] === undefined) map[name] = i;
  }
  return map;
}

function cellByHeader_(row, map, headerName) {
  var idx = map[headerName];
  if (idx === undefined || idx === null) return '';
  var v = row[idx];
  return v === null || v === undefined ? '' : v;
}
