/**
 * M2-3A 本地自测：Human Action Binding（不依赖 SpreadsheetApp）。
 * 运行：node scripts/test-human-decision-binding.js
 */

var TODAY_ACTION_HUMAN_SYNC_STATUSES = {
  DONE: true,
  SKIP: true
};

function normalizeTodayStatus_(v) {
  return String(v || '').trim().toUpperCase();
}

function buildDecisionId_(runDate, siteName, recommendedAction, ruleVersion) {
  return [
    String(runDate || '').trim(),
    String(siteName || '').trim(),
    String(recommendedAction || '').trim(),
    String(ruleVersion || '').trim()
  ].join('|');
}

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
    seen[decisionId] = {
      decisionId: decisionId,
      humanDecision: status,
      humanNote: a.note === null || a.note === undefined ? '' : String(a.note),
      rowIndex: byId[decisionId].rowIndex,
      frozen: byId[decisionId].frozen || null
    };
  }

  var ids = Object.keys(seen);
  for (var k = 0; k < ids.length; k++) updates.push(seen[ids[k]]);
  return {
    updates: updates,
    skippedNoId: skippedNoId,
    skippedTodo: skippedTodo,
    skippedMissingHistory: skippedMissingHistory
  };
}

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var idA = buildDecisionId_(
  '2026-08-15',
  'Grain Rot',
  'CONTENT_OPTIMIZE',
  'gsc-decision-v1.0'
);
var frozenA = {
  runDate: '2026-08-15',
  decisionDataDate: '2026-08-10',
  site: 'Grain Rot',
  ruleVersion: 'gsc-decision-v1.0',
  recommendedAction: 'CONTENT_OPTIMIZE',
  domainScore: 42,
  reason: 'orig reason',
  recordedAt: '2026-08-15 09:00:00'
};
var history = [
  {
    decisionId: idA,
    rowIndex: 2,
    humanDecision: '',
    humanNote: '',
    frozen: frozenA
  }
];

// Case 9: same DecisionID builder for today action + history
var actionId = buildDecisionId_(
  '2026-08-15',
  'Grain Rot',
  'CONTENT_OPTIMIZE',
  'gsc-decision-v1.0'
);
assert(actionId === idA, 'Case9 same DecisionID');

// Case 1: TODO → no sync update
var plan1 = planHumanDecisionSync_(
  [{ decisionId: idA, status: 'TODO', note: 'draft' }],
  history
);
assert(plan1.updates.length === 0, 'Case1 no update');
assert(plan1.skippedTodo === 1, 'Case1 skipped todo');

// Case 2: DONE
var plan2 = planHumanDecisionSync_(
  [{ decisionId: idA, status: 'DONE', note: '' }],
  history
);
assert(plan2.updates.length === 1, 'Case2 one update');
assert(plan2.updates[0].humanDecision === 'DONE', 'Case2 DONE');

// Case 3: SKIP
var plan3 = planHumanDecisionSync_(
  [{ decisionId: idA, status: 'SKIP', note: '' }],
  history
);
assert(plan3.updates[0].humanDecision === 'SKIP', 'Case3 SKIP');

// Case 4: note
var plan4 = planHumanDecisionSync_(
  [{ decisionId: idA, status: 'DONE', note: '已更新 gameplay' }],
  history
);
assert(plan4.updates[0].humanNote === '已更新 gameplay', 'Case4 note');

// Case 5: repeat sync unchanged
var historyDone = [
  {
    decisionId: idA,
    rowIndex: 2,
    humanDecision: 'DONE',
    humanNote: '已更新 gameplay',
    frozen: frozenA
  }
];
var plan5 = planHumanDecisionSync_(
  [{ decisionId: idA, status: 'DONE', note: '已更新 gameplay' }],
  historyDone
);
var byId5 = {};
byId5[idA] = historyDone[0];
var sel5 = selectHumanDecisionWrites_(plan5.updates, byId5);
assert(sel5.writes.length === 0, 'Case5 no rewrite');
assert(sel5.unchanged === 1, 'Case5 unchanged');

// Case 6: wrong / missing DecisionID — no fuzzy match
var plan6 = planHumanDecisionSync_(
  [{ decisionId: 'no-such-id', status: 'DONE', note: 'x' }],
  history
);
assert(plan6.updates.length === 0, 'Case6 no fuzzy');
assert(plan6.skippedMissingHistory === 1, 'Case6 missing history');

// Case 7: empty DecisionID
var plan7 = planHumanDecisionSync_(
  [{ decisionId: '', status: 'DONE', note: 'old' }],
  history
);
assert(plan7.updates.length === 0, 'Case7 skip empty');
assert(plan7.skippedNoId === 1, 'Case7 no id');

// Case 8: frozen fields remain on history object (sync plan does not mutate frozen)
var plan8 = planHumanDecisionSync_(
  [{ decisionId: idA, status: 'DONE', note: 'n' }],
  history
);
assert(plan8.updates[0].frozen.domainScore === 42, 'Case8 frozen domain');
assert(plan8.updates[0].frozen.reason === 'orig reason', 'Case8 frozen reason');
assert(plan8.updates[0].frozen.recordedAt === '2026-08-15 09:00:00', 'Case8 frozen recordedAt');
assert(plan8.updates[0].frozen.recommendedAction === 'CONTENT_OPTIMIZE', 'Case8 frozen action');

// Note change after DONE allowed
var planNote = planHumanDecisionSync_(
  [{ decisionId: idA, status: 'DONE', note: '新备注' }],
  historyDone
);
var selNote = selectHumanDecisionWrites_(planNote.updates, byId5);
assert(selNote.writes.length === 1, 'note change writes');
assert(selNote.writes[0].humanNote === '新备注', 'note updated');

// Wiring / config markers
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');
var humanSrc = fs.readFileSync(path.join(root, 'HumanDecisionBinding.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');

assert(/'DecisionID'/.test(configSrc.match(/var TODAY_ACTION_HEADERS = \[[\s\S]*?\];/)[0]), 'DecisionID header');
assert(/人工备注/.test(configSrc.match(/var TODAY_ACTION_HEADERS = \[[\s\S]*?\];/)[0]), 'note header');
assert(/TODAY_ACTION_STATUSES = \['TODO', 'DONE', 'SKIP'\]/.test(configSrc), 'status enum');
assert(/function syncHumanDecisions\(/.test(humanSrc), 'sync fn');
assert(!/\.addItem\('同步人工决策'/.test(codeSrc), 'retired menu hidden');
assert(/decisionId: decisionId/.test(decisionSrc), 'action writes DecisionID');
assert(/buildDecisionHistoryRow_\([\s\S]*decisionId/.test(decisionSrc), 'history same id');
assert(/ensureTodayActionHeader_/.test(decisionSrc), 'header ensure');
assert(/带 DecisionID 的新任务在 DONE \/ SKIP 后/.test(sheetSrc), 'usage');
assert(/'HumanDecision'/.test(configSrc) && /'HumanNote'/.test(configSrc), 'metric guide human fields');
// Status validation still column H
assert(/getRange\('H2:H'\)/.test(decisionSrc), 'Status still column H');
assert(!/runDaily/.test(humanSrc), 'not in runDaily file');
assert(!/SUCCESS|FAILURE|FALSE_POSITIVE/.test(humanSrc), 'no outcome labels');

console.log('PASS scripts/test-human-decision-binding.js');
