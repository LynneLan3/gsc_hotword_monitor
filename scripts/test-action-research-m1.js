/** Action → Research → ContentDecision M1 contract test. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractAssign(src, name) {
  var match = src.match(new RegExp('var ' + name + '\\s*=\\s*([\\s\\S]*?);\\s*\\n(?:var |/\\*|function )'));
  assert(match, 'missing ' + name);
  return eval('(' + match[1] + ')');
}

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var headers = extractAssign(configSrc, 'RESEARCH_JOB_HEADERS');
var RESEARCH_TYPE = extractAssign(configSrc, 'RESEARCH_TYPE');
var context = {
  RESEARCH_TYPE: RESEARCH_TYPE,
  ACTION_RESEARCH_TYPES: extractAssign(configSrc, 'ACTION_RESEARCH_TYPES'),
  CONTENT_DECISION_PRIMARY_ACTIONS: extractAssign(configSrc, 'CONTENT_DECISION_PRIMARY_ACTIONS'),
  RESEARCH_JOB_STATUS: extractAssign(configSrc, 'RESEARCH_JOB_STATUS'),
  RESEARCH_JOB_STATUS_LABELS: extractAssign(configSrc, 'RESEARCH_JOB_STATUS_LABELS'),
  RESEARCH_RESULT_RECOMMENDATIONS: extractAssign(configSrc, 'RESEARCH_RESULT_RECOMMENDATIONS'),
  RESEARCH_RESULT_RECOMMENDATION_LABELS: extractAssign(configSrc, 'RESEARCH_RESULT_RECOMMENDATION_LABELS'),
  OPPORTUNITY_LEVEL_LABELS: extractAssign(configSrc, 'OPPORTUNITY_LEVEL_LABELS'),
  OPPORTUNITY_ACTION_LABELS: extractAssign(configSrc, 'OPPORTUNITY_ACTION_LABELS'),
  RESEARCH_JOB_HEADERS: headers,
  INTENT_CLUSTER_ACTIONS: { RESEARCH_NEW_INTENT: 'RESEARCH_NEW_INTENT', CANNIBALIZATION: 'CANNIBALIZATION' },
  INTENT_PAGE_ACTIONS: { OPTIMIZE_EXISTING: 'OPTIMIZE_EXISTING' },
  INTENT_CLUSTER_ENTITY_ALIASES: [],
  INTENT_CLUSTER_THRESHOLDS: {},
  OPPORTUNITY_HUB_SLUGS: [],
  SHEET_NAMES: { DEVELOPMENT_TASKS: '开发任务' },
  opportunityLabel_: function (map, value) { return (map && map[value]) || value || ''; },
  headerIndexMap_: function (row) {
    var out = {};
    row.forEach(function (name, i) { out[name] = i; });
    return out;
  },
  cell_: function (row, col, name) { return col[name] === undefined ? '' : row[col[name]]; },
  enumFromLabel_: function (map, value) { return String(value || '').trim(); },
  safeJsonParse_: function (text, fallback) {
    try { return JSON.parse(String(text || '')); } catch (e) { return fallback; }
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'ResearchJobs.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'IntentOpportunityEngine.gs'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'DevelopmentTasks.gs'), 'utf8'), context);

var col = context.headerIndexMap_(headers);
var actionJob = {
  job_id: 'm1-action-job',
  game: 'Mortal Shell II',
  topic: 'Gloombound Flame',
  existing_page: '/mortal-shell-ii/gloombound-flame/',
  opportunity_level: 'HIGH',
  recommended_action: 'RESEARCH_EXPAND_EXISTING',
  source_query: 'light extinguished lantern mortal shell 2',
  related_queries: 'gloombound flame | lantern',
  research_type: 'PAGE_OPTIMIZATION_RESEARCH',
  source_action: 'OPTIMIZE_EXISTING',
  action_context: { pagePath: '/mortal-shell-ii/gloombound-flame/', pageImpressions: 158 }
};
var actionRow = context.researchJobSheetRow_(actionJob, 'Mortal Shell II', new Date('2026-08-23T00:00:00Z'));
assert(actionRow.length === headers.length, 'action research row matches RESEARCH_JOB_HEADERS');
assert(headers.length === 48, 'M1 research job schema remains 48 columns');
assert(actionRow[col['SourceAction']] === 'OPTIMIZE_EXISTING', 'SourceAction column is aligned');
assert(JSON.parse(actionRow[col['ActionContext']]).pageImpressions === 158, 'ActionContext column is aligned');
assert(actionRow[col['DecisionID']] === '', 'DecisionID placeholder is aligned');
assert(actionRow[col['Confidence']] === '', 'Confidence placeholder is aligned');
assert(actionRow[col['DecisionCreatedAt']] === '', 'DecisionCreatedAt placeholder is aligned');

function assertBuilderWidth(name, row) {
  assert(row.length === headers.length, name + ' matches RESEARCH_JOB_HEADERS');
}
assertBuilderWidth('gameWideDiscoveryResearchJobSheetRow_', context.gameWideDiscoveryResearchJobSheetRow_(
  { job_id: 'game-wide-job', game: 'Mortal Shell II', trigger_type: 'DAILY_GAME_WIDE',
    discovery_scope: {}, seed_terms: [], source_families_requested: [],
    source_signal_summary: '', discovery_cycle_date: '2026-08-23', opportunity_id: '' },
  'Mortal Shell II', new Date()
));
assertBuilderWidth('demandDiscoveryResearchJobSheetRow_', context.demandDiscoveryResearchJobSheetRow_(
  { job_id: 'demand-job', game: 'Mortal Shell II', discovery_scope: {}, anchor_page: '',
    radar_id: '', trigger_type: '', seed_terms: [], source_families_requested: [],
    source_signal_summary: '', discovery_cycle_date: '2026-08-23', opportunity_id: '' },
  'Mortal Shell II', new Date()
));
assertBuilderWidth('searchDemandResearchJobSheetRow_', context.searchDemandResearchJobSheetRow_(
  { job_id: 'search-job', game: 'Mortal Shell II', discovery_scope: {}, anchor_page: '',
    radar_id: '', trigger_type: '', seed_terms: [], search_sources_requested: [],
    source_signal_summary: '', search_cycle_date: '2026-08-23', opportunity_id: '' },
  'Mortal Shell II', new Date()
));
var recommendationSource = new Array(headers.length).fill('');
recommendationSource[col['任务ID']] = 'search-job';
recommendationSource[col['站点']] = 'Mortal Shell II';
recommendationSource[col['游戏']] = 'Mortal Shell II';
recommendationSource[col['发现周期日期']] = '2026-08-23';
assertBuilderWidth('researchRecommendationSheetRow_', context.researchRecommendationSheetRow_(
  recommendationSource, null, col, new Date()
));

function jobRow(type, actionContext, pagePath) {
  var row = new Array(headers.length).fill('');
  row[col['任务ID']] = 'job-' + type.toLowerCase();
  row[col['站点']] = 'Mortal Shell II';
  row[col['页面路径']] = pagePath || '';
  row[col['研究类型']] = type;
  row[col['SourceAction']] = type === 'PAGE_OPTIMIZATION_RESEARCH' ? 'OPTIMIZE_EXISTING' : 'RESEARCH_NEW_INTENT';
  row[col['ActionContext']] = JSON.stringify(actionContext || {});
  return row;
}

var pageContext = {
  pagePath: '/mortal-shell-ii/gloombound-flame/',
  clusterKey: 'GLOOMBOUND_FLAME',
  clusterQueries: ['gloombound flame', 'light extinguished lantern', 'lantern'],
  pageImpressions: 158
};
var pageRow = jobRow('PAGE_OPTIMIZATION_RESEARCH', pageContext, pageContext.pagePath);
var pageDecision = context.buildContentDecisionFromResearchPayload_(
  pageRow, col,
  {
    content_decision: {
      primary_decision: 'EXPAND_EXISTING',
      secondary_actions: ['ADD_FAQ', 'ADD_STEPS'],
      decision_reason: 'Visible queries show location and use gaps.',
      evidence_summary: 'SERP and community evidence support the gaps.',
      target_queries: pageContext.clusterQueries,
      recommended_sections: ['Where to find Gloombound Flame'],
      recommended_title_change: 'Clarify location and lantern use',
      confidence: 'HIGH'
    }
  },
  context.RESEARCH_JOB_STATUS.REVIEW,
  'EXPAND_EXISTING',
  5,
  'research completed',
  new Date('2026-08-23T00:00:00Z')
);
assert(pageDecision.primaryDecision === 'EXPAND_EXISTING', 'page decision primary');
assert(pageDecision.pagePath === pageContext.pagePath, 'page decision target');
assert(pageDecision.targetQueries.length === 3, 'page decision carries query context');
assert(context.isContentDecisionImplementationEligible_(pageDecision), 'high-confidence actionable decision is eligible');

var newRow = jobRow('NEW_INTENT_RESEARCH', { clusterKey: 'NEW_INTENT', clusterQueries: ['new intent'] });
var newDecision = context.buildContentDecisionFromResearchPayload_(
  newRow, col, { content_decision: { primary_decision: 'CREATE_NEW_PAGE', confidence: 'HIGH' } },
  context.RESEARCH_JOB_STATUS.REVIEW, 'NEW_CONTENT', 5, '', new Date()
);
assert(newDecision.primaryDecision === 'CREATE_NEW_PAGE', 'new intent decision');
assert(context.isContentDecisionImplementationEligible_(newDecision), 'new page decision is eligible');

var cannibalRow = jobRow('CANNIBALIZATION_RESEARCH', {
  clusterKey: 'CRASHING', competingPages: [{ page: '/a/' }, { page: '/b/' }]
});
var cannibalDecision = context.buildContentDecisionFromResearchPayload_(
  cannibalRow, col, { content_decision: { primary_decision: 'KEEP_BOTH', confidence: 'HIGH' } },
  context.RESEARCH_JOB_STATUS.REVIEW, '', 5, '', new Date()
);
assert(cannibalDecision.primaryDecision === 'KEEP_BOTH', 'cannibalization decision');
assert(!context.isContentDecisionImplementationEligible_(cannibalDecision), 'KEEP_BOTH creates no development task');

['WATCH', 'NO_CHANGE', 'REJECT_NOISE'].forEach(function (primary) {
  var type = primary === 'REJECT_NOISE' ? 'NEW_INTENT_RESEARCH' : 'PAGE_OPTIMIZATION_RESEARCH';
  var row = jobRow(type, {});
  var decision = context.buildContentDecisionFromResearchPayload_(
    row, col, { content_decision: { primary_decision: primary, confidence: 'HIGH' } },
    context.RESEARCH_JOB_STATUS.REVIEW, '', 5, '', new Date()
  );
  assert(!context.isContentDecisionImplementationEligible_(decision), primary + ' creates no development task');
});

console.log('PASS scripts/test-action-research-m1.js (three research types, structured decisions, eligibility)');
