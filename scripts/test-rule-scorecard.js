/**
 * M3-1 本地自测：Rule Scorecard（不依赖 SpreadsheetApp）。
 * 运行：node scripts/test-rule-scorecard.js
 */

var fs = require('fs');
var path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function newRuleScorecardBucket_(ruleVersion) {
  return {
    RuleVersion: ruleVersion,
    decisionIds: {},
    DecisionCount: 0,
    WaitingHumanCount: 0,
    DoneCount: 0,
    SkipCount: 0,
    InterventionDecisionCount: 0,
    InterventionRecordCount: 0,
    D7ObservedCount: 0,
    D14ObservedCount: 0,
    D30ObservedCount: 0,
    LatestDecisionDataDate: ''
  };
}

function buildRuleScorecardRow_(bucket, updatedAt) {
  bucket = bucket || {};
  return [
    String(bucket.RuleVersion || ''),
    Number(bucket.DecisionCount || 0),
    Number(bucket.WaitingHumanCount || 0),
    Number(bucket.DoneCount || 0),
    Number(bucket.SkipCount || 0),
    Number(bucket.InterventionDecisionCount || 0),
    Number(bucket.InterventionRecordCount || 0),
    Number(bucket.D7ObservedCount || 0),
    Number(bucket.D14ObservedCount || 0),
    Number(bucket.D30ObservedCount || 0),
    String(bucket.LatestDecisionDataDate || ''),
    String(updatedAt || '')
  ];
}

function planRuleScorecardRows_(ctx) {
  ctx = ctx || {};
  var history = ctx.history || [];
  var interventions = ctx.interventions || [];
  var outcomes = ctx.outcomes || [];
  var updatedAt = ctx.updatedAt || '';
  var upstream = JSON.stringify({ history: history, interventions: interventions, outcomes: outcomes });

  var decisionToVersion = {};
  var buckets = {};
  var i;

  for (i = 0; i < history.length; i++) {
    var h = history[i];
    var id = String(h.decisionId || '').trim();
    if (!id) continue;
    var version = String(h.ruleVersion || '').trim();
    if (!version) version = '(unknown)';
    decisionToVersion[id] = version;
    if (!buckets[version]) buckets[version] = newRuleScorecardBucket_(version);
    var b = buckets[version];
    if (!b.decisionIds[id]) {
      b.decisionIds[id] = true;
      b.DecisionCount++;
      var human = String(h.humanDecision || '').trim().toUpperCase();
      if (!human) b.WaitingHumanCount++;
      else if (human === 'DONE') b.DoneCount++;
      else if (human === 'SKIP') b.SkipCount++;
      var ddate = String(h.decisionDataDate || '').trim().substring(0, 10);
      if (ddate) {
        if (!b.LatestDecisionDataDate || ddate > b.LatestDecisionDataDate) {
          b.LatestDecisionDataDate = ddate;
        }
      }
    }
  }

  var ignoredOrphanInterventions = 0;
  var interventionDecisionSeen = {};
  for (i = 0; i < interventions.length; i++) {
    var iv = interventions[i];
    var iid = String(iv.decisionId || '').trim();
    if (!iid) continue;
    var ivVersion = decisionToVersion[iid];
    if (!ivVersion) {
      ignoredOrphanInterventions++;
      continue;
    }
    var ib = buckets[ivVersion];
    if (!ib) continue;
    ib.InterventionRecordCount++;
    if (!interventionDecisionSeen[iid]) {
      interventionDecisionSeen[iid] = true;
      ib.InterventionDecisionCount++;
    }
  }

  var ignoredOrphanOutcomes = 0;
  var outcomeSeen = {};
  for (i = 0; i < outcomes.length; i++) {
    var oc = outcomes[i];
    var oid = String(oc.decisionId || '').trim();
    var hz = String(oc.horizon || '').trim();
    if (!oid || !hz) continue;
    var ov = decisionToVersion[oid];
    if (!ov) {
      ignoredOrphanOutcomes++;
      continue;
    }
    var key = oid + '||' + hz;
    if (outcomeSeen[key]) continue;
    outcomeSeen[key] = true;
    var ob = buckets[ov];
    if (!ob) continue;
    if (hz === 'D7') ob.D7ObservedCount++;
    else if (hz === 'D14') ob.D14ObservedCount++;
    else if (hz === 'D30') ob.D30ObservedCount++;
  }

  var versions = Object.keys(buckets).sort();
  var rows = [];
  for (i = 0; i < versions.length; i++) {
    rows.push(buildRuleScorecardRow_(buckets[versions[i]], updatedAt));
  }

  assert(
    JSON.stringify({ history: history, interventions: interventions, outcomes: outcomes }) ===
      upstream,
    'Case10 upstream mutated'
  );

  return {
    rows: rows,
    ignoredOrphanInterventions: ignoredOrphanInterventions,
    ignoredOrphanOutcomes: ignoredOrphanOutcomes
  };
}

function H(id, version, human, date) {
  return {
    decisionId: id,
    ruleVersion: version,
    humanDecision: human || '',
    decisionDataDate: date || ''
  };
}

// Case 1: empty history
var p1 = planRuleScorecardRows_({ history: [], interventions: [], outcomes: [] });
assert(p1.rows.length === 0, 'Case1 empty');

// Case 2: one RuleVersion, multiple decisions
var p2 = planRuleScorecardRows_({
  history: [
    H('a', 'gsc-decision-v1.0', '', '2026-08-10'),
    H('b', 'gsc-decision-v1.0', 'DONE', '2026-08-11'),
    H('c', 'gsc-decision-v1.0', 'SKIP', '2026-08-09')
  ],
  interventions: [],
  outcomes: [],
  updatedAt: 't'
});
assert(p2.rows.length === 1, 'Case2 one version');
assert(p2.rows[0][0] === 'gsc-decision-v1.0', 'Case2 version');
assert(p2.rows[0][1] === 3, 'Case2 DecisionCount');

// Case 3: human buckets
assert(p2.rows[0][2] === 1, 'Case3 waiting');
assert(p2.rows[0][3] === 1, 'Case3 done');
assert(p2.rows[0][4] === 1, 'Case3 skip');

// Case 4: multi intervention same decision
var p4 = planRuleScorecardRows_({
  history: [H('a', 'gsc-decision-v1.0', 'DONE', '2026-08-10')],
  interventions: [
    { decisionId: 'a', updateDate: '2026-08-16', pagePath: '/x/' },
    { decisionId: 'a', updateDate: '2026-08-17', pagePath: '/y/' },
    { decisionId: 'a', updateDate: '2026-08-18', pagePath: '' }
  ],
  outcomes: []
});
assert(p4.rows[0][5] === 1, 'Case4 InterventionDecisionCount');
assert(p4.rows[0][6] === 3, 'Case4 InterventionRecordCount');

// Case 5: orphan intervention ignored
var p5 = planRuleScorecardRows_({
  history: [H('a', 'gsc-decision-v1.0', '', '2026-08-10')],
  interventions: [{ decisionId: 'orphan', updateDate: '2026-08-16', pagePath: '/z/' }],
  outcomes: []
});
assert(p5.rows[0][5] === 0 && p5.rows[0][6] === 0, 'Case5 no orphan counted');
assert(p5.ignoredOrphanInterventions === 1, 'Case5 ignored');

// Case 6: D7/D14/D30 only real outcomes
var p6 = planRuleScorecardRows_({
  history: [
    H('a', 'gsc-decision-v1.0', 'DONE', '2026-08-01'),
    H('b', 'gsc-decision-v1.0', 'DONE', '2026-08-02')
  ],
  interventions: [],
  outcomes: [
    { decisionId: 'a', horizon: 'D7' },
    { decisionId: 'a', horizon: 'D14' },
    { decisionId: 'b', horizon: 'D7' }
  ]
});
assert(p6.rows[0][7] === 2, 'Case6 D7');
assert(p6.rows[0][8] === 1, 'Case6 D14');
assert(p6.rows[0][9] === 0, 'Case6 D30');

// Case 7: multiple RuleVersions independent
var p7 = planRuleScorecardRows_({
  history: [
    H('a', 'gsc-decision-v1.0', 'DONE', '2026-08-10'),
    H('b', 'gsc-decision-v1.1', 'SKIP', '2026-08-12'),
    H('c', 'gsc-decision-v1.1', '', '2026-08-11')
  ],
  interventions: [{ decisionId: 'b', updateDate: '2026-08-13', pagePath: '/m/' }],
  outcomes: [{ decisionId: 'a', horizon: 'D7' }]
});
assert(p7.rows.length === 2, 'Case7 two versions');
var byV = {};
for (var i = 0; i < p7.rows.length; i++) byV[p7.rows[i][0]] = p7.rows[i];
assert(byV['gsc-decision-v1.0'][1] === 1, 'Case7 v1 count');
assert(byV['gsc-decision-v1.0'][7] === 1, 'Case7 v1 D7');
assert(byV['gsc-decision-v1.1'][1] === 2, 'Case7 v1.1 count');
assert(byV['gsc-decision-v1.1'][5] === 1, 'Case7 v1.1 intervention decisions');
assert(byV['gsc-decision-v1.1'][7] === 0, 'Case7 v1.1 no D7');

// Case 8: LatestDecisionDataDate
assert(byV['gsc-decision-v1.1'][10] === '2026-08-12', 'Case8 latest date');
assert(p2.rows[0][10] === '2026-08-11', 'Case8 p2 latest');

// Case 9: rebuild idempotent (same inputs → same rows)
var again = planRuleScorecardRows_({
  history: [
    H('a', 'gsc-decision-v1.0', 'DONE', '2026-08-10'),
    H('b', 'gsc-decision-v1.1', 'SKIP', '2026-08-12'),
    H('c', 'gsc-decision-v1.1', '', '2026-08-11')
  ],
  interventions: [{ decisionId: 'b', updateDate: '2026-08-13', pagePath: '/m/' }],
  outcomes: [{ decisionId: 'a', horizon: 'D7' }],
  updatedAt: 'same'
});
var p7b = planRuleScorecardRows_({
  history: [
    H('a', 'gsc-decision-v1.0', 'DONE', '2026-08-10'),
    H('b', 'gsc-decision-v1.1', 'SKIP', '2026-08-12'),
    H('c', 'gsc-decision-v1.1', '', '2026-08-11')
  ],
  interventions: [{ decisionId: 'b', updateDate: '2026-08-13', pagePath: '/m/' }],
  outcomes: [{ decisionId: 'a', horizon: 'D7' }],
  updatedAt: 'same'
});
assert(JSON.stringify(again.rows) === JSON.stringify(p7b.rows), 'Case9 idempotent');

// Case 10 covered via upstream snapshot assert inside planner

// orphan outcomes ignored
var pOut = planRuleScorecardRows_({
  history: [H('a', 'gsc-decision-v1.0', '', '2026-08-10')],
  interventions: [],
  outcomes: [{ decisionId: 'ghost', horizon: 'D7' }]
});
assert(pOut.rows[0][7] === 0, 'orphan outcome ignored');
assert(pOut.ignoredOrphanOutcomes === 1, 'orphan outcome counted');

// wiring
var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');
var scSrc = fs.readFileSync(path.join(root, 'RuleScorecard.gs'), 'utf8');

assert(/RULE_SCORECARD:\s*'规则评分卡'/.test(configSrc), 'sheet name');
assert(/RULE_SCORECARD_HEADERS/.test(configSrc), 'headers');
assert(
  /SHEET_NAMES\.RULE_SCORECARD/.test(configSrc.match(/var SHEET_UI_ORDER = \[[\s\S]*?\];/)[0]),
  'ui order'
);
var orderBlock = configSrc.match(/var SHEET_UI_ORDER = \[[\s\S]*?\];/)[0];
assert(
  orderBlock.indexOf('FEEDBACK_SAMPLES') < orderBlock.indexOf('RULE_SCORECARD') &&
    orderBlock.indexOf('RULE_SCORECARD') < orderBlock.indexOf('RULES'),
  'order feedback → scorecard → rules'
);
assert(/function rebuildRuleScorecard\(/.test(scSrc), 'rebuild fn');
assert(!/\.addItem\('重建规则评分卡'/.test(codeSrc), 'retired menu hidden');
assert(/规则评分卡：按 RuleVersion 汇总/.test(sheetSrc), 'usage');
assert(/'DecisionCount'/.test(configSrc) && /规则评分卡/.test(configSrc), 'metrics');
assert(!/SUCCESS|FAILURE|FALSE_POSITIVE|WIN_RATE|ACCURACY|Champion/.test(scSrc), 'no eval labels');
assert(!/function runDaily|runDaily\(/.test(scSrc), 'not in runDaily');
assert(/replaceSheetDataRows_\(\s*SHEET_NAMES\.RULE_SCORECARD/.test(scSrc), 'only writes scorecard');
assert(!/loadDailyRowsBySite_|loadQueryRowsBySite_/.test(scSrc), 'no GSC recompute');
assert(!/appendDecisionHistory|appendDecisionOutcome|recordContentIntervention/.test(scSrc), 'no upstream writers');

console.log('PASS scripts/test-rule-scorecard.js');
