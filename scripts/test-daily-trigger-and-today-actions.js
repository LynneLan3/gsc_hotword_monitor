/**
 * Minimal regressions for production daily-trigger + 今日行动 view stability.
 * Run: node scripts/test-daily-trigger-and-today-actions.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = path.join(__dirname, '..');
const codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
const decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');
const hotfixSrc = fs.readFileSync(path.join(root, 'TimeoutRetentionHotfix.gs'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert(start >= 0, name + ' exists');
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unclosed ' + name);
}

// --- 1) createDailyTrigger reconciles to runDailyLean, never recreates runDaily ---
const createDaily = extractFn(codeSrc, 'createDailyTrigger');
assert(/newTrigger\(leanHandler\)/.test(createDaily) || /newTrigger\(HOTFIX_DAILY_HANDLER\)/.test(createDaily) || /newTrigger\(['"]runDailyLean['"]\)/.test(createDaily) || /newTrigger\(leanHandler\)/.test(createDaily), 'creates lean daily handler');
assert(/leanHandler/.test(createDaily) && /runDailyLean/.test(createDaily), 'lean handler resolved');
assert(!/newTrigger\(['"]runDaily['"]\)/.test(createDaily), 'does not create legacy runDaily');
assert(/fn === 'runDaily'/.test(createDaily) && /deleteTrigger\(legacyDailyTriggers/.test(createDaily), 'removes legacy runDaily if present');
assert(/fn === DAILY_CONTINUE_HANDLER/.test(createDaily), 'removes legacy runDaily continuation');
assert(!/refreshUnifiedActionQueue_/.test(codeSrc), 'finalizer no longer rebuilds unified queue into 今日行动');

const removeDaily = extractFn(codeSrc, 'removeDailyTrigger');
assert(/leanHandler/.test(removeDaily) && /runDaily/.test(removeDaily), 'removeDaily clears lean + legacy daily');

assert(/HOTFIX_DAILY_HANDLER = 'runDailyLean'/.test(hotfixSrc), 'production lean collector remains runDailyLean');

// --- 2) mergeTodayActionRows_ drops Steam / Radar background rows, keeps GSC Decision rows ---
const context = {
  TODAY_ACTION_HEADERS: [
    'Date', 'Priority', 'Site', 'LifecycleStage', 'RecommendedAction',
    'DomainScore', 'Reason', 'Status', '人工备注', 'DecisionID',
    'SourceSystem', 'OpportunityID', 'Game', 'OpportunityType',
    'CurrentState', 'SourceReference'
  ],
  TODAY_ACTION_EXCLUDED: { NO_ACTION: true, WAIT: true },
  normalizeKeyDate_: function (v) { return String(v || '').trim(); },
  normalizeTodayStatus_: function (v) { return String(v || '').trim().toUpperCase(); },
  todayActionKey_: function (date, site, action) {
    return String(date || '') + '||' + String(site || '') + '||' + String(action || '');
  },
  todayPriorityRank_: function (p) {
    const s = String(p || '').toUpperCase();
    if (s === 'P0') return 0;
    if (s === 'P1') return 1;
    if (s === 'P2') return 2;
    if (s === 'P3') return 3;
    return 9;
  },
  compareTodayAction_: function (a, b) {
    return String(a.site || '').localeCompare(String(b.site || ''));
  },
  padTodayActionRow_: function (row) {
    const out = [];
    const src = row || [];
    for (let i = 0; i < context.TODAY_ACTION_HEADERS.length; i++) {
      out.push(src[i] === undefined || src[i] === null ? '' : src[i]);
    }
    return out;
  }
};
vm.createContext(context);
vm.runInContext(extractFn(decisionSrc, 'isGscDecisionTodayActionRow_'), context);
vm.runInContext(extractFn(decisionSrc, 'mergeTodayActionRows_'), context);

const gscLegacy = context.padTodayActionRow_([
  '2026-09-08', 'P1', 'Withering Realms Guide', 'LAUNCH', 'CONTENT_OPTIMIZE',
  12, 'GSC decision', 'DONE', 'ok', 'decision-wr-1'
]);
const gscTodoIncoming = {
  date: '2026-09-09',
  priority: 'P1',
  site: 'Withering Realms Guide',
  lifecycleStage: 'LAUNCH',
  recommendedAction: 'CONTENT_OPTIMIZE',
  domainScore: 11,
  reason: 'fresh GSC decision',
  decisionId: 'decision-wr-2'
};
const steamPending = context.padTodayActionRow_([
  '2026-09-09', 'P2', '', '1B完成→人工第二轮', 'Google Trends',
  '', 'Steam 候选需要人工处理', 'TODO', '', '',
  'STEAM', 'opp-steam-1', 'Titanic Escape', 'STEAM_CANDIDATE', 'PENDING', 'steam-row'
]);
const radarDiscovered = context.padTodayActionRow_([
  '2026-09-09', 'P2', 'Mortal Shell II', 'RADAR', 'Research',
  '', 'GSC 需求雷达需要人工处理：雷达状态=DISCOVERED', 'TODO', '', '',
  'GSC', 'opp-radar-1', 'Mortal Shell II', 'GSC_RESEARCH', 'DISCOVERED', '需求雷达'
]);
const researchPending = context.padTodayActionRow_([
  '2026-09-09', 'P2', 'Mortal Shell II', 'RESEARCH', 'Research',
  '', 'GSC 研究任务需要人工处理：任务状态=PENDING', 'TODO', '', '',
  'GSC', 'opp-research-1', 'Mortal Shell II', 'GSC_RESEARCH', 'PENDING', '研究任务'
]);

assert(context.isGscDecisionTodayActionRow_(gscLegacy) === true, 'legacy GSC Decision row kept');
assert(context.isGscDecisionTodayActionRow_(steamPending) === false, 'Steam PENDING excluded');
assert(context.isGscDecisionTodayActionRow_(radarDiscovered) === false, 'Radar DISCOVERED excluded');
assert(context.isGscDecisionTodayActionRow_(researchPending) === false, 'Research PENDING excluded');

const merged = context.mergeTodayActionRows_(
  '2026-09-09',
  [gscLegacy, steamPending, radarDiscovered, researchPending],
  [gscTodoIncoming]
);

assert(merged.length === 2, 'only legacy GSC DONE + new GSC Decision TODO remain');
assert(merged.some(function (row) { return row[9] === 'decision-wr-1'; }), 'keeps GSC Decision DONE');
assert(merged.some(function (row) { return row[9] === 'decision-wr-2' && row[4] === 'CONTENT_OPTIMIZE'; }), 'writes GSC Decision TODO');
assert(!merged.some(function (row) { return row[10] === 'STEAM'; }), 'no Steam rows written');
assert(!merged.some(function (row) { return row[14] === 'DISCOVERED'; }), 'no Radar DISCOVERED rows written');
assert(!merged.some(function (row) { return row[13] === 'GSC_RESEARCH'; }), 'no Research background rows written');

console.log('PASS scripts/test-daily-trigger-and-today-actions.js');
