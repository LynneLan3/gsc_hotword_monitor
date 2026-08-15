/**
 * M3-2 本地自测：Evaluation Eligibility（不依赖 SpreadsheetApp）。
 * 运行：node scripts/test-evaluation-eligibility.js
 */

var fs = require('fs');
var path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var EVALUATION_ELIGIBILITY = {
  ELIGIBLE: 'ELIGIBLE',
  PENDING: 'PENDING',
  EXCLUDED: 'EXCLUDED'
};

var EVALUATION_EXCLUSION_REASON = {
  WAITING_HUMAN: 'WAITING_HUMAN',
  SKIPPED: 'SKIPPED',
  NO_INTERVENTION: 'NO_INTERVENTION'
};

function classifyEvaluationEligibility_(input) {
  input = input || {};
  var human = String(input.humanDecision || '').trim().toUpperCase();
  var count = Number(input.interventionCount || 0);

  if (!human) {
    return excludedEligibility_(EVALUATION_EXCLUSION_REASON.WAITING_HUMAN);
  }
  if (human === 'SKIP') {
    return excludedEligibility_(EVALUATION_EXCLUSION_REASON.SKIPPED);
  }
  if (count <= 0) {
    return excludedEligibility_(EVALUATION_EXCLUSION_REASON.NO_INTERVENTION);
  }

  return {
    d7: input.hasD7
      ? EVALUATION_ELIGIBILITY.ELIGIBLE
      : EVALUATION_ELIGIBILITY.PENDING,
    d14: input.hasD14
      ? EVALUATION_ELIGIBILITY.ELIGIBLE
      : EVALUATION_ELIGIBILITY.PENDING,
    d30: input.hasD30
      ? EVALUATION_ELIGIBILITY.ELIGIBLE
      : EVALUATION_ELIGIBILITY.PENDING,
    exclusionReason: ''
  };
}

function excludedEligibility_(reason) {
  return {
    d7: EVALUATION_ELIGIBILITY.EXCLUDED,
    d14: EVALUATION_ELIGIBILITY.EXCLUDED,
    d30: EVALUATION_ELIGIBILITY.EXCLUDED,
    exclusionReason: reason
  };
}

function buildEvaluationEligibilityRow_(input) {
  input = input || {};
  var h = input.history || {};
  return [
    String(h.decisionId || '').trim(),
    String(h.ruleVersion || '').trim(),
    String(h.decisionDataDate || '').trim(),
    String(h.site || '').trim(),
    String(h.humanDecision || '').trim(),
    Number(input.interventionCount || 0),
    input.d7Observed ? true : false,
    input.d14Observed ? true : false,
    input.d30Observed ? true : false,
    String(input.d7Eligibility || ''),
    String(input.d14Eligibility || ''),
    String(input.d30Eligibility || ''),
    String(input.exclusionReason || ''),
    String(input.updatedAt || '')
  ];
}

function planEvaluationEligibilityRows_(ctx) {
  ctx = ctx || {};
  var history = ctx.history || [];
  var interventions = ctx.interventions || [];
  var outcomes = ctx.outcomes || [];
  var updatedAt = ctx.updatedAt || '';
  var upstream = JSON.stringify({
    history: history,
    interventions: interventions,
    outcomes: outcomes
  });
  var historyIds = {};
  var i;

  for (i = 0; i < history.length; i++) {
    var hid = String(history[i].decisionId || '').trim();
    if (hid) historyIds[hid] = true;
  }

  var interventionCountById = {};
  var ignoredOrphanInterventions = 0;
  for (i = 0; i < interventions.length; i++) {
    var iv = interventions[i];
    var iid = String(iv.decisionId || '').trim();
    if (!iid) continue;
    if (!historyIds[iid]) {
      ignoredOrphanInterventions++;
      continue;
    }
    interventionCountById[iid] = (interventionCountById[iid] || 0) + 1;
  }

  var outcomesById = {};
  var ignoredOrphanOutcomes = 0;
  var outcomeSeen = {};
  for (i = 0; i < outcomes.length; i++) {
    var oc = outcomes[i];
    var oid = String(oc.decisionId || '').trim();
    var hz = String(oc.horizon || '').trim();
    if (!oid || !hz) continue;
    if (!historyIds[oid]) {
      ignoredOrphanOutcomes++;
      continue;
    }
    var key = oid + '||' + hz;
    if (outcomeSeen[key]) continue;
    outcomeSeen[key] = true;
    if (!outcomesById[oid]) outcomesById[oid] = {};
    outcomesById[oid][hz] = true;
  }

  var rows = [];
  for (i = 0; i < history.length; i++) {
    var h = history[i];
    var id = String(h.decisionId || '').trim();
    if (!id) continue;
    var count = Number(interventionCountById[id] || 0);
    var hasD7 = !!(outcomesById[id] && outcomesById[id].D7);
    var hasD14 = !!(outcomesById[id] && outcomesById[id].D14);
    var hasD30 = !!(outcomesById[id] && outcomesById[id].D30);
    var judged = classifyEvaluationEligibility_({
      humanDecision: h.humanDecision,
      interventionCount: count,
      hasD7: hasD7,
      hasD14: hasD14,
      hasD30: hasD30
    });
    rows.push(
      buildEvaluationEligibilityRow_({
        history: h,
        interventionCount: count,
        d7Observed: hasD7,
        d14Observed: hasD14,
        d30Observed: hasD30,
        d7Eligibility: judged.d7,
        d14Eligibility: judged.d14,
        d30Eligibility: judged.d30,
        exclusionReason: judged.exclusionReason,
        updatedAt: updatedAt
      })
    );
  }

  assert(
    JSON.stringify({
      history: history,
      interventions: interventions,
      outcomes: outcomes
    }) === upstream,
    'must not mutate upstream fixtures'
  );

  return {
    rows: rows,
    ignoredOrphanInterventions: ignoredOrphanInterventions,
    ignoredOrphanOutcomes: ignoredOrphanOutcomes
  };
}

function hist(id, human, extras) {
  extras = extras || {};
  return {
    decisionId: id,
    ruleVersion: extras.ruleVersion || 'gsc-decision-v1.0',
    decisionDataDate: extras.date || '2026-08-01',
    site: extras.site || 'SiteA',
    humanDecision: human
  };
}

function elig(row) {
  return {
    id: row[0],
    count: row[5],
    d7o: row[6],
    d14o: row[7],
    d30o: row[8],
    d7: row[9],
    d14: row[10],
    d30: row[11],
    reason: row[12]
  };
}

// 1. History 空 → 0 数据行
var empty = planEvaluationEligibilityRows_({
  history: [],
  interventions: [{ decisionId: 'orphan-iv' }],
  outcomes: [{ decisionId: 'orphan-oc', horizon: 'D7' }],
  updatedAt: 't0'
});
assert(empty.rows.length === 0, 'empty history → 0 rows');
assert(empty.ignoredOrphanInterventions === 1, 'orphan iv ignored');
assert(empty.ignoredOrphanOutcomes === 1, 'orphan oc ignored');

// 2. HumanDecision 空 → 三 Horizon EXCLUDED / WAITING_HUMAN
var waiting = planEvaluationEligibilityRows_({
  history: [hist('d-wait', '')],
  interventions: [],
  outcomes: [{ decisionId: 'd-wait', horizon: 'D7' }],
  updatedAt: 't1'
});
assert(waiting.rows.length === 1, 'waiting row');
var w = elig(waiting.rows[0]);
assert(w.d7 === 'EXCLUDED' && w.d14 === 'EXCLUDED' && w.d30 === 'EXCLUDED', 'waiting excluded');
assert(w.reason === 'WAITING_HUMAN', 'waiting reason');
assert(w.d7o === true, 'observed flag still factual when excluded');

// 3. SKIP
var skipped = planEvaluationEligibilityRows_({
  history: [hist('d-skip', 'SKIP')],
  interventions: [{ decisionId: 'd-skip' }],
  outcomes: [{ decisionId: 'd-skip', horizon: 'D7' }],
  updatedAt: 't2'
});
var s = elig(skipped.rows[0]);
assert(s.d7 === 'EXCLUDED' && s.d14 === 'EXCLUDED' && s.d30 === 'EXCLUDED', 'skip excluded');
assert(s.reason === 'SKIPPED', 'skip reason');
assert(s.count === 1, 'skip may still count interventions factually');

// 4. DONE + 无 intervention
var noIv = planEvaluationEligibilityRows_({
  history: [hist('d-done', 'DONE')],
  interventions: [],
  outcomes: [],
  updatedAt: 't3'
});
var n = elig(noIv.rows[0]);
assert(n.d7 === 'EXCLUDED' && n.d14 === 'EXCLUDED' && n.d30 === 'EXCLUDED', 'no iv excluded');
assert(n.reason === 'NO_INTERVENTION', 'no iv reason');
assert(n.count === 0, 'count 0');

// 5. DONE + intervention + 无 Outcome → PENDING
var pending = planEvaluationEligibilityRows_({
  history: [hist('d-pend', 'DONE')],
  interventions: [{ decisionId: 'd-pend' }],
  outcomes: [],
  updatedAt: 't4'
});
var p = elig(pending.rows[0]);
assert(p.d7 === 'PENDING' && p.d14 === 'PENDING' && p.d30 === 'PENDING', 'all pending');
assert(p.reason === '', 'pending reason empty');
assert(p.d7o === false && p.d14o === false && p.d30o === false, 'no observed');

// 6. 只有 D7 Outcome
var onlyD7 = planEvaluationEligibilityRows_({
  history: [hist('d-d7', 'DONE')],
  interventions: [{ decisionId: 'd-d7' }],
  outcomes: [{ decisionId: 'd-d7', horizon: 'D7' }],
  updatedAt: 't5'
});
var o7 = elig(onlyD7.rows[0]);
assert(o7.d7 === 'ELIGIBLE' && o7.d14 === 'PENDING' && o7.d30 === 'PENDING', 'only D7 eligible');
assert(o7.d7o === true && o7.d14o === false && o7.d30o === false, 'only D7 observed');
assert(o7.reason === '', 'eligible/pending reason empty');

// 7. D7+D14
var d7d14 = planEvaluationEligibilityRows_({
  history: [hist('d-714', 'DONE')],
  interventions: [{ decisionId: 'd-714' }],
  outcomes: [
    { decisionId: 'd-714', horizon: 'D7' },
    { decisionId: 'd-714', horizon: 'D14' }
  ],
  updatedAt: 't6'
});
var o714 = elig(d7d14.rows[0]);
assert(
  o714.d7 === 'ELIGIBLE' && o714.d14 === 'ELIGIBLE' && o714.d30 === 'PENDING',
  'D7+D14'
);

// 8. D7+D14+D30
var allH = planEvaluationEligibilityRows_({
  history: [hist('d-all', 'DONE')],
  interventions: [{ decisionId: 'd-all' }],
  outcomes: [
    { decisionId: 'd-all', horizon: 'D7' },
    { decisionId: 'd-all', horizon: 'D14' },
    { decisionId: 'd-all', horizon: 'D30' }
  ],
  updatedAt: 't7'
});
var oa = elig(allH.rows[0]);
assert(oa.d7 === 'ELIGIBLE' && oa.d14 === 'ELIGIBLE' && oa.d30 === 'ELIGIBLE', 'all eligible');

// 9. 多 intervention 不改变资格语义
var multi = planEvaluationEligibilityRows_({
  history: [hist('d-multi', 'DONE')],
  interventions: [
    { decisionId: 'd-multi' },
    { decisionId: 'd-multi' },
    { decisionId: 'd-multi' }
  ],
  outcomes: [{ decisionId: 'd-multi', horizon: 'D7' }],
  updatedAt: 't8'
});
var m = elig(multi.rows[0]);
assert(m.count === 3, 'multi count');
assert(m.d7 === 'ELIGIBLE' && m.d14 === 'PENDING' && m.d30 === 'PENDING', 'multi same eligibility');

// 10. orphan 不生成评价记录
var orphan = planEvaluationEligibilityRows_({
  history: [hist('d-real', 'DONE')],
  interventions: [
    { decisionId: 'd-real' },
    { decisionId: 'ghost-iv' }
  ],
  outcomes: [
    { decisionId: 'd-real', horizon: 'D7' },
    { decisionId: 'ghost-oc', horizon: 'D14' }
  ],
  updatedAt: 't9'
});
assert(orphan.rows.length === 1, 'only history decision');
assert(orphan.rows[0][0] === 'd-real', 'real id');
assert(orphan.ignoredOrphanInterventions === 1, 'orphan iv');
assert(orphan.ignoredOrphanOutcomes === 1, 'orphan oc');

// 不因有 D30 伪造 D7
var onlyD30 = planEvaluationEligibilityRows_({
  history: [hist('d-d30', 'DONE')],
  interventions: [{ decisionId: 'd-d30' }],
  outcomes: [{ decisionId: 'd-d30', horizon: 'D30' }],
  updatedAt: 't10'
});
var od30 = elig(onlyD30.rows[0]);
assert(
  od30.d7 === 'PENDING' && od30.d14 === 'PENDING' && od30.d30 === 'ELIGIBLE',
  'D30 alone does not invent D7/D14'
);

// 11. rebuild 幂等
var once = planEvaluationEligibilityRows_({
  history: [hist('d-id', 'DONE')],
  interventions: [{ decisionId: 'd-id' }, { decisionId: 'd-id' }],
  outcomes: [{ decisionId: 'd-id', horizon: 'D7' }],
  updatedAt: 'fixed'
});
var twice = planEvaluationEligibilityRows_({
  history: [hist('d-id', 'DONE')],
  interventions: [{ decisionId: 'd-id' }, { decisionId: 'd-id' }],
  outcomes: [{ decisionId: 'd-id', horizon: 'D7' }],
  updatedAt: 'fixed'
});
assert(JSON.stringify(once.rows) === JSON.stringify(twice.rows), 'idempotent');

// 禁止价值判断词出现在实现中
var root = path.join(__dirname, '..');
var eeSrc = fs.readFileSync(path.join(root, 'EvaluationEligibility.gs'), 'utf8');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');

[
  'SUCCESS',
  'FAILURE',
  'WIN_RATE',
  'SUCCESS_RATE',
  'FALSE_POSITIVE',
  'FALSE_NEGATIVE',
  'PRECISION',
  'RECALL',
  'ACCURACY'
].forEach(function (bad) {
  assert(eeSrc.indexOf(bad) < 0, 'forbidden token in EvaluationEligibility: ' + bad);
});

assert(/EVALUATION_ELIGIBILITY:\s*'评价资格'/.test(configSrc), 'sheet name');
assert(
  /SHEET_NAMES\.EVALUATION_ELIGIBILITY/.test(
    configSrc.match(/var SHEET_UI_ORDER = \[[\s\S]*?\];/)[0]
  ),
  'ui order'
);
assert(/重建评价资格/.test(codeSrc), 'menu');
assert(
  !/function runDaily\([\s\S]*?rebuildEvaluationEligibility/.test(codeSrc),
  'not called from runDaily'
);
assert(/ELIGIBLE 只代表/.test(sheetSrc), 'usage semantics');
assert(/评价资格：判断某个 Decision/.test(sheetSrc), 'usage sheet');
assert(
  /replaceSheetDataRows_\(\s*SHEET_NAMES\.EVALUATION_ELIGIBILITY/.test(eeSrc),
  'only writes eligibility sheet'
);
assert(
  !/replaceSheetDataRows_\(\s*SHEET_NAMES\.(DECISION_HISTORY|DECISION_OUTCOMES|CONTENT_UPDATES|FEEDBACK_SAMPLES|RULE_SCORECARD|TODAY_ACTIONS)/.test(
    eeSrc
  ),
  'must not write upstream sheets'
);
assert(/ensureSheet_\(SHEET_NAMES\.EVALUATION_ELIGIBILITY/.test(sheetSrc), 'setup ensures sheet');

var headersMatch = configSrc.match(
  /var EVALUATION_ELIGIBILITY_HEADERS\s*=\s*(\[[\s\S]*?\]);/
);
assert(headersMatch, 'headers present');
var headers = eval(headersMatch[1]);
assert(
  headers.join(',') ===
    [
      'DecisionID',
      'RuleVersion',
      'DecisionDataDate',
      'Site',
      'HumanDecision',
      'InterventionCount',
      'D7Observed',
      'D14Observed',
      'D30Observed',
      'D7Eligibility',
      'D14Eligibility',
      'D30Eligibility',
      'ExclusionReason',
      'UpdatedAt'
    ].join(','),
  'headers exact'
);

console.log('PASS scripts/test-evaluation-eligibility.js');
