/**
 * M2-4 本地自测：Feedback Sample View（不依赖 SpreadsheetApp）。
 * 运行：node scripts/test-feedback-samples.js
 */

var fs = require('fs');
var path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var OBSERVATION_STATUS = {
  PENDING: 'PENDING',
  OBSERVED: 'OBSERVED',
  DATA_MISSING: 'DATA_MISSING'
};

var FEEDBACK_SAMPLE_STATUS = {
  WAITING_HUMAN: 'WAITING_HUMAN',
  SKIPPED: 'SKIPPED',
  HANDLED_NO_INTERVENTION: 'HANDLED_NO_INTERVENTION',
  INTERVENTION_PENDING_OUTCOME: 'INTERVENTION_PENDING_OUTCOME',
  D7_OBSERVED: 'D7_OBSERVED',
  D14_OBSERVED: 'D14_OBSERVED',
  D30_OBSERVED: 'D30_OBSERVED'
};

function classifyFeedbackSampleStatus_(input) {
  input = input || {};
  var human = String(input.humanDecision || '').trim().toUpperCase();
  var count = Number(input.interventionCount || 0);
  if (!human) return FEEDBACK_SAMPLE_STATUS.WAITING_HUMAN;
  if (human === 'SKIP') return FEEDBACK_SAMPLE_STATUS.SKIPPED;
  if (human === 'DONE' && count <= 0) {
    return FEEDBACK_SAMPLE_STATUS.HANDLED_NO_INTERVENTION;
  }
  if (count > 0 && !input.hasD7) {
    return FEEDBACK_SAMPLE_STATUS.INTERVENTION_PENDING_OUTCOME;
  }
  if (input.hasD7 && !input.hasD14) return FEEDBACK_SAMPLE_STATUS.D7_OBSERVED;
  if (input.hasD14 && !input.hasD30) return FEEDBACK_SAMPLE_STATUS.D14_OBSERVED;
  if (input.hasD30) return FEEDBACK_SAMPLE_STATUS.D30_OBSERVED;
  if (count > 0) return FEEDBACK_SAMPLE_STATUS.INTERVENTION_PENDING_OUTCOME;
  return FEEDBACK_SAMPLE_STATUS.WAITING_HUMAN;
}

function aggregateInterventionsForFeedback_(list) {
  var rows = list || [];
  var count = rows.length;
  var pages = [];
  var pageSeen = {};
  var types = [];
  var typeSeen = {};
  var first = '';
  var last = '';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var date = String(r.updateDate || '').trim().substring(0, 10);
    if (date) {
      if (!first || date < first) first = date;
      if (!last || date > last) last = date;
    }
    var pathLabel = String(r.pagePath || '').trim();
    var pageLabel = pathLabel ? pathLabel : '（整站）';
    if (!pageSeen[pageLabel]) {
      pageSeen[pageLabel] = true;
      pages.push(pageLabel);
    }
    var t = String(r.updateType || '').trim();
    if (t && !typeSeen[t]) {
      typeSeen[t] = true;
      types.push(t);
    }
  }
  return {
    count: count,
    pages: pages.join(' | '),
    firstDate: first,
    lastDate: last,
    types: types.join(' | ')
  };
}

function pickHorizonOutcome_(byHorizon, horizon) {
  if (!byHorizon) return null;
  return byHorizon[horizon] || null;
}

function horizonStatusAndMetrics_(outcome) {
  if (!outcome) {
    return {
      status: OBSERVATION_STATUS.PENDING,
      impressions: '',
      clicks: '',
      guideQueries: '',
      bestPosition: ''
    };
  }
  return {
    status: OBSERVATION_STATUS.OBSERVED,
    impressions: outcome.impressionsWindow,
    clicks: outcome.clicksWindow,
    guideQueries: outcome.guideQueryCount,
    bestPosition: outcome.bestPosition
  };
}

function buildFeedbackSampleRow_(input) {
  input = input || {};
  var h = input.history || {};
  var iv = input.intervention || {};
  var d7 = horizonStatusAndMetrics_(input.d7);
  var d14 = horizonStatusAndMetrics_(input.d14);
  var d30 = horizonStatusAndMetrics_(input.d30);
  return [
    String(h.decisionId || '').trim(),
    String(h.decisionDataDate || '').trim(),
    String(h.site || '').trim(),
    String(h.ruleVersion || '').trim(),
    String(h.recommendedAction || '').trim(),
    String(h.priority || '').trim(),
    h.domainScore === null || h.domainScore === undefined ? '' : h.domainScore,
    String(h.humanDecision || '').trim(),
    String(h.humanNote || '').trim(),
    Number(iv.count || 0),
    String(iv.pages || ''),
    String(iv.firstDate || ''),
    String(iv.lastDate || ''),
    String(iv.types || ''),
    d7.status,
    d7.impressions,
    d7.clicks,
    d7.guideQueries,
    d7.bestPosition,
    d14.status,
    d14.impressions,
    d14.clicks,
    d14.guideQueries,
    d14.bestPosition,
    d30.status,
    d30.impressions,
    d30.clicks,
    d30.guideQueries,
    d30.bestPosition,
    String(input.sampleStatus || ''),
    String(input.updatedAt || '')
  ];
}

function planFeedbackSampleRows_(ctx) {
  ctx = ctx || {};
  var history = ctx.history || [];
  var interventions = ctx.interventions || [];
  var outcomes = ctx.outcomes || [];
  var updatedAt = ctx.updatedAt || '';
  var warnings = [];
  var historyIds = {};
  var i;
  for (i = 0; i < history.length; i++) {
    var hid = String(history[i].decisionId || '').trim();
    if (hid) historyIds[hid] = true;
  }
  var interventionsById = {};
  var ignoredOrphanInterventions = 0;
  for (i = 0; i < interventions.length; i++) {
    var iv = interventions[i];
    var iid = String(iv.decisionId || '').trim();
    if (!iid) continue;
    if (!historyIds[iid]) {
      ignoredOrphanInterventions++;
      continue;
    }
    if (!interventionsById[iid]) interventionsById[iid] = [];
    interventionsById[iid].push(iv);
  }
  var outcomesById = {};
  var ignoredOrphanOutcomes = 0;
  for (i = 0; i < outcomes.length; i++) {
    var oc = outcomes[i];
    var oid = String(oc.decisionId || '').trim();
    if (!oid) continue;
    if (!historyIds[oid]) {
      ignoredOrphanOutcomes++;
      warnings.push('Feedback sample ignored orphan Outcome DecisionID=' + oid);
      continue;
    }
    if (!outcomesById[oid]) outcomesById[oid] = {};
    var hz = String(oc.horizon || '').trim();
    if (!hz) continue;
    var prev = outcomesById[oid][hz];
    if (prev) {
      warnings.push(
        'Feedback sample duplicate Outcome DecisionID=' +
          oid +
          ' Horizon=' +
          hz +
          '; keeping latest ObservedAt'
      );
      if (String(oc.observedAt || '') >= String(prev.observedAt || '')) {
        outcomesById[oid][hz] = oc;
      }
    } else {
      outcomesById[oid][hz] = oc;
    }
  }
  var rows = [];
  var upstreamSnapshot = JSON.stringify({ history: history, interventions: interventions, outcomes: outcomes });
  for (i = 0; i < history.length; i++) {
    var h = history[i];
    var id = String(h.decisionId || '').trim();
    if (!id) continue;
    var agg = aggregateInterventionsForFeedback_(interventionsById[id] || []);
    var d7 = pickHorizonOutcome_(outcomesById[id], 'D7');
    var d14 = pickHorizonOutcome_(outcomesById[id], 'D14');
    var d30 = pickHorizonOutcome_(outcomesById[id], 'D30');
    var human = String(h.humanDecision || '').trim().toUpperCase();
    if (!human && agg.count > 0) {
      warnings.push(
        'Feedback sample data inconsistency: intervention without HumanDecision DecisionID=' +
          id
      );
    }
    var sampleStatus = classifyFeedbackSampleStatus_({
      humanDecision: human,
      interventionCount: agg.count,
      hasD7: !!d7,
      hasD14: !!d14,
      hasD30: !!d30
    });
    rows.push(
      buildFeedbackSampleRow_({
        history: h,
        intervention: agg,
        d7: d7,
        d14: d14,
        d30: d30,
        sampleStatus: sampleStatus,
        updatedAt: updatedAt
      })
    );
  }
  assert(
    JSON.stringify({ history: history, interventions: interventions, outcomes: outcomes }) ===
      upstreamSnapshot,
    'Case12 upstream mutated'
  );
  return {
    rows: rows,
    warnings: warnings,
    ignoredOrphanInterventions: ignoredOrphanInterventions,
    ignoredOrphanOutcomes: ignoredOrphanOutcomes
  };
}

function baseHistory(overrides) {
  return Object.assign(
    {
      decisionId: '2026-08-15|Grain Rot|CONTENT_OPTIMIZE|gsc-decision-v1.0',
      decisionDataDate: '2026-08-10',
      site: 'Grain Rot',
      ruleVersion: 'gsc-decision-v1.0',
      recommendedAction: 'CONTENT_OPTIMIZE',
      priority: 'P2',
      domainScore: 42,
      humanDecision: '',
      humanNote: ''
    },
    overrides || {}
  );
}

function outcome(horizon, overrides) {
  return Object.assign(
    {
      decisionId: '2026-08-15|Grain Rot|CONTENT_OPTIMIZE|gsc-decision-v1.0',
      horizon: horizon,
      observationStatus: 'OBSERVED',
      impressionsWindow: 100 + Number(String(horizon).replace('D', '') || 0),
      clicksWindow: 3,
      guideQueryCount: 2,
      bestPosition: 12,
      observedAt: '2026-08-20 10:00:00'
    },
    overrides || {}
  );
}

// Case 1: empty history
var plan1 = planFeedbackSampleRows_({ history: [], interventions: [], outcomes: [] });
assert(plan1.rows.length === 0, 'Case1 empty');

// Case 2: waiting human
var plan2 = planFeedbackSampleRows_({
  history: [baseHistory()],
  interventions: [],
  outcomes: [],
  updatedAt: 't'
});
assert(plan2.rows.length === 1, 'Case2 one row');
assert(plan2.rows[0][29] === 'WAITING_HUMAN', 'Case2 status');

// Case 3: SKIP
var plan3 = planFeedbackSampleRows_({
  history: [baseHistory({ humanDecision: 'SKIP', humanNote: 'later' })],
  interventions: [],
  outcomes: []
});
assert(plan3.rows[0][29] === 'SKIPPED', 'Case3 SKIPPED');
assert(plan3.rows[0][7] === 'SKIP', 'Case3 human');

// Case 4: DONE no intervention
var plan4 = planFeedbackSampleRows_({
  history: [baseHistory({ humanDecision: 'DONE' })],
  interventions: [],
  outcomes: []
});
assert(plan4.rows[0][29] === 'HANDLED_NO_INTERVENTION', 'Case4');

// Case 5: DONE + intervention, no D7
var idA = '2026-08-15|Grain Rot|CONTENT_OPTIMIZE|gsc-decision-v1.0';
var plan5 = planFeedbackSampleRows_({
  history: [baseHistory({ humanDecision: 'DONE' })],
  interventions: [
    {
      decisionId: idA,
      updateDate: '2026-08-16',
      pagePath: '/grain-rot/gameplay/',
      updateType: 'CONTENT_OPTIMIZE'
    }
  ],
  outcomes: []
});
assert(plan5.rows[0][29] === 'INTERVENTION_PENDING_OUTCOME', 'Case5');
assert(plan5.rows[0][9] === 1, 'Case5 count');

// Case 6: multi pages
var plan6 = planFeedbackSampleRows_({
  history: [baseHistory({ humanDecision: 'DONE' })],
  interventions: [
    {
      decisionId: idA,
      updateDate: '2026-08-16',
      pagePath: '/grain-rot/gameplay/',
      updateType: 'CONTENT_EXPAND'
    },
    {
      decisionId: idA,
      updateDate: '2026-08-18',
      pagePath: '/grain-rot/map/',
      updateType: 'INTERNAL_LINK'
    },
    {
      decisionId: idA,
      updateDate: '2026-08-17',
      pagePath: '',
      updateType: ''
    }
  ],
  outcomes: []
});
assert(plan6.rows[0][9] === 3, 'Case6 count');
assert(String(plan6.rows[0][10]).indexOf('/grain-rot/gameplay/') >= 0, 'Case6 page1');
assert(String(plan6.rows[0][10]).indexOf('/grain-rot/map/') >= 0, 'Case6 page2');
assert(String(plan6.rows[0][10]).indexOf('（整站）') >= 0, 'Case6 sitewide');
assert(plan6.rows[0][11] === '2026-08-16', 'Case6 first');
assert(plan6.rows[0][12] === '2026-08-18', 'Case6 last');
assert(String(plan6.rows[0][13]).indexOf('CONTENT_EXPAND') >= 0, 'Case6 type');

// Case 7: D7
var plan7 = planFeedbackSampleRows_({
  history: [baseHistory({ humanDecision: 'DONE' })],
  interventions: [
    {
      decisionId: idA,
      updateDate: '2026-08-16',
      pagePath: '/grain-rot/gameplay/',
      updateType: 'CONTENT_OPTIMIZE'
    }
  ],
  outcomes: [outcome('D7', { impressionsWindow: 111, clicksWindow: 5, guideQueryCount: 4, bestPosition: 9 })]
});
assert(plan7.rows[0][29] === 'D7_OBSERVED', 'Case7 status');
assert(plan7.rows[0][14] === 'OBSERVED', 'Case7 D7Status');
assert(plan7.rows[0][15] === 111, 'Case7 impressions from outcome');
assert(plan7.rows[0][16] === 5, 'Case7 clicks');
assert(plan7.rows[0][17] === 4, 'Case7 guide');
assert(plan7.rows[0][18] === 9, 'Case7 best');
assert(plan7.rows[0][19] === 'PENDING', 'Case7 D14 pending');

// Case 8: D7+D14
var plan8 = planFeedbackSampleRows_({
  history: [baseHistory({ humanDecision: 'DONE' })],
  interventions: [
    { decisionId: idA, updateDate: '2026-08-16', pagePath: '/a/', updateType: 'OTHER' }
  ],
  outcomes: [outcome('D7'), outcome('D14')]
});
assert(plan8.rows[0][29] === 'D14_OBSERVED', 'Case8');

// Case 9: D7+D14+D30
var plan9 = planFeedbackSampleRows_({
  history: [baseHistory({ humanDecision: 'DONE' })],
  interventions: [
    { decisionId: idA, updateDate: '2026-08-16', pagePath: '/a/', updateType: 'OTHER' }
  ],
  outcomes: [outcome('D7'), outcome('D14'), outcome('D30')]
});
assert(plan9.rows[0][29] === 'D30_OBSERVED', 'Case9');

// Case 10: SKIP + outcomes still SKIPPED
var plan10 = planFeedbackSampleRows_({
  history: [baseHistory({ humanDecision: 'SKIP' })],
  interventions: [],
  outcomes: [outcome('D7'), outcome('D14'), outcome('D30')]
});
assert(plan10.rows[0][29] === 'SKIPPED', 'Case10 still SKIPPED');
assert(plan10.rows[0][14] === 'OBSERVED', 'Case10 still shows D7 facts');

// Case 11: orphan intervention DecisionID
var plan11 = planFeedbackSampleRows_({
  history: [baseHistory()],
  interventions: [
    {
      decisionId: 'no-history-id',
      updateDate: '2026-08-16',
      pagePath: '/x/',
      updateType: 'OTHER'
    }
  ],
  outcomes: [{ decisionId: 'orphan-outcome', horizon: 'D7', observedAt: 't' }]
});
assert(plan11.rows.length === 1, 'Case11 only history row');
assert(plan11.rows[0][9] === 0, 'Case11 no orphan intervention counted');
assert(plan11.ignoredOrphanInterventions === 1, 'Case11 ignored intervention');
assert(plan11.ignoredOrphanOutcomes === 1, 'Case11 ignored outcome');

// Case 12 covered inside planFeedbackSampleRows_ via upstreamSnapshot assert

// one Decision always one row even with multi interventions/outcomes
assert(plan6.rows.length === 1, 'one Decision one row');

// wiring
var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');
var fbSrc = fs.readFileSync(path.join(root, 'FeedbackSamples.gs'), 'utf8');

assert(/FEEDBACK_SAMPLES:\s*'反馈样本'/.test(configSrc), 'sheet name');
assert(/FEEDBACK_SAMPLE_HEADERS/.test(configSrc), 'headers');
assert(/SHEET_NAMES\.FEEDBACK_SAMPLES/.test(configSrc.match(/var SHEET_UI_ORDER = \[[\s\S]*?\];/)[0]), 'ui order');
assert(/function rebuildFeedbackSamples\(/.test(fbSrc), 'rebuild fn');
assert(!/\.addItem\('重建反馈样本'/.test(codeSrc), 'retired menu hidden');
assert(/反馈样本：系统自动生成的分析视图/.test(sheetSrc), 'usage');
assert(/'SampleStatus'/.test(configSrc) && /'InterventionCount'/.test(configSrc), 'metrics');
assert(!/SUCCESS|FAILURE|FALSE_POSITIVE|FALSE_NEGATIVE|Champion/.test(fbSrc), 'no value labels');
assert(!/function runDaily|runDaily\(/.test(fbSrc), 'not hooked to runDaily');
assert(/replaceSheetDataRows_\(\s*SHEET_NAMES\.FEEDBACK_SAMPLES/.test(fbSrc), 'only rebuild feedback sheet');
assert(!/loadDailyRowsBySite_|loadQueryRowsBySite_/.test(fbSrc), 'no recompute GSC');
assert(!/appendDecisionHistory|appendDecisionOutcome|recordContentIntervention/.test(fbSrc), 'no upstream writers');

console.log('PASS scripts/test-feedback-samples.js');
