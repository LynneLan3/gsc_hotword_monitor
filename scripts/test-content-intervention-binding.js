/**
 * M2-3B 本地自测：Content Intervention Binding（不依赖 SpreadsheetApp）。
 * 运行：node scripts/test-content-intervention-binding.js
 */

var fs = require('fs');
var path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function parseDateOnly_(str) {
  var s = String(str || '').trim().substring(0, 10);
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function daysBetweenStr_(fromDate, toDate) {
  var a = parseDateOnly_(fromDate);
  var b = parseDateOnly_(toDate);
  if (!a || !b) return null;
  return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

function addDaysStr_(dateStr, delta) {
  var d = parseDateOnly_(dateStr);
  if (!d) return '';
  d.setDate(d.getDate() + Number(delta || 0));
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

function normalizeOpportunityPath_(pagePath) {
  var p = String(pagePath || '').trim();
  if (!p) return '';
  if (p.charAt(0) !== '/') p = '/' + p;
  if (p.length > 1 && p.charAt(p.length - 1) === '/') {
    p = p.substring(0, p.length - 1);
  }
  return p || '/';
}

function contentUpdateRecordMatches_(recordPagePath, queryPagePath) {
  var rec = String(recordPagePath || '').trim();
  if (!rec) return true;
  var query = String(queryPagePath || '').trim();
  if (!query) return false;
  return normalizeOpportunityPath_(rec) === normalizeOpportunityPath_(query);
}

function getLatestContentUpdate_(site, pagePath, rows) {
  var siteName = String(site || '').trim();
  if (!siteName) return null;
  var latest = null;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (String(row[1] || '').trim() !== siteName) continue;
    if (!contentUpdateRecordMatches_(row[2], pagePath)) continue;
    var date = String(row[0] || '').trim().substring(0, 10);
    if (!date) continue;
    if (!latest || date > latest.updateDate) {
      latest = {
        updateDate: date,
        site: siteName,
        pagePath: String(row[2] || '').trim(),
        source: String(row[3] || '').trim(),
        note: String(row[4] || '').trim(),
        updateType: String(row[5] || '').trim(),
        decisionId: String(row[6] || '').trim()
      };
    }
  }
  return latest;
}

function findContentUpdateCooldownFromRows_(rows, site, pagePath, asOfDate, rules) {
  var cooldownDays = Number(rules && rules.CONTENT_UPDATE_COOLDOWN_DAYS);
  if (isNaN(cooldownDays) || cooldownDays <= 0) cooldownDays = 3;
  var latest = getLatestContentUpdate_(site, pagePath, rows);
  if (!latest) return null;
  var elapsed = daysBetweenStr_(latest.updateDate, asOfDate);
  if (elapsed === null || elapsed < 0) return null;
  if (elapsed >= cooldownDays) return null;
  return {
    updateDate: latest.updateDate,
    untilDate: addDaysStr_(latest.updateDate, cooldownDays),
    days: cooldownDays,
    pagePath: latest.pagePath
  };
}

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

function classifyContentInterventionDecisionId_(decisionId, existingDecisionIdSet) {
  var id = String(decisionId || '').trim();
  if (!id) return 'valid-unbound';
  var set = existingDecisionIdSet || {};
  if (set[id]) return 'valid-bound';
  return 'invalid-binding';
}

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

var idA =
  '2026-08-15|Grain Rot|CONTENT_OPTIMIZE|gsc-decision-v1.0';
var historySet = {};
historySet[idA] = true;

// Case 1: DecisionID saved on new intervention
var plan1 = planContentInterventionWrite_(
  {
    updateDate: '2026-08-16',
    site: 'Grain Rot',
    pagePath: '/grain-rot/gameplay/',
    source: 'PM',
    note: 'updated gameplay',
    updateType: 'CONTENT_OPTIMIZE',
    decisionId: idA
  },
  historySet
);
assert(!plan1.reject, 'Case1 accept');
assert(plan1.row[6] === idA, 'Case1 DecisionID');
assert(plan1.decisionBound === true, 'Case1 bound');
assert(plan1.warning === '', 'Case1 no warning');

// empty DecisionID still allowed
var planEmpty = planContentInterventionWrite_(
  {
    updateDate: '2026-08-16',
    site: 'Grain Rot',
    pagePath: '/grain-rot/other/',
    source: 'PM',
    note: 'manual',
    updateType: 'OTHER',
    decisionId: ''
  },
  historySet
);
assert(!planEmpty.reject && planEmpty.row[6] === '', 'empty DecisionID ok');
assert(planEmpty.decisionBound === false, 'empty unbound');

// Case 2: same DecisionID → two pages
var plan2a = planContentInterventionWrite_(
  {
    updateDate: '2026-08-16',
    site: 'Grain Rot',
    pagePath: '/grain-rot/gameplay/',
    source: 'PM',
    note: 'a',
    updateType: 'CONTENT_OPTIMIZE',
    decisionId: idA
  },
  historySet
);
var plan2b = planContentInterventionWrite_(
  {
    updateDate: '2026-08-16',
    site: 'Grain Rot',
    pagePath: '/grain-rot/map/',
    source: 'PM',
    note: 'b',
    updateType: 'INTERNAL_LINK',
    decisionId: idA
  },
  historySet
);
assert(plan2a.row[6] === plan2b.row[6], 'Case2 same DecisionID');
assert(plan2a.row[2] !== plan2b.row[2], 'Case2 different pages');

// Case 3: HumanDecision DONE does not auto-create intervention
// (no writer called from syncHumanDecisions — structural check below)
var root = path.join(__dirname, '..');
var humanSrc = fs.readFileSync(path.join(root, 'HumanDecisionBinding.gs'), 'utf8');
var contentSrc = fs.readFileSync(path.join(root, 'ContentIntervention.gs'), 'utf8');
assert(
  !/recordContent(Update|Intervention)/.test(humanSrc),
  'Case3 DONE sync must not write content update'
);

// Case 4: old rows with empty DecisionID still valid for cooldown
var oldRows = [
  [
    '2026-08-14',
    'Agefield High: Rock the School',
    '',
    '社媒研究',
    '根据最新社媒玩家信息完成内容更新'
  ],
  [
    '2026-08-14',
    'Mortal Shell II',
    '',
    '社媒研究',
    '根据最新社媒玩家信息完成内容更新'
  ]
];
var rules = { CONTENT_UPDATE_COOLDOWN_DAYS: 3 };
assert(
  !!findContentUpdateCooldownFromRows_(
    oldRows,
    'Agefield High: Rock the School',
    '/any/',
    '2026-08-15',
    rules
  ),
  'Case4 Agefield cooldown'
);
assert(
  !!findContentUpdateCooldownFromRows_(
    oldRows,
    'Mortal Shell II',
    '/mortal-shell-ii/guides/weapons/',
    '2026-08-15',
    rules
  ),
  'Case4 MS2 site-wide cooldown'
);

// Case 5: unknown DecisionID — keep intervention facts, clear DecisionID (no dangling FK)
var plan5 = planContentInterventionWrite_(
  {
    updateDate: '2026-08-16',
    site: 'Grain Rot',
    pagePath: '/grain-rot/gameplay/',
    source: 'PM',
    note: 'x',
    updateType: 'OTHER',
    decisionId: 'no-such-id'
  },
  historySet
);
assert(!plan5.reject, 'Case5 allow write');
assert(plan5.row[0] === '2026-08-16', 'Case5 date kept');
assert(plan5.row[1] === 'Grain Rot', 'Case5 site kept');
assert(plan5.row[2] === '/grain-rot/gameplay/', 'Case5 path kept');
assert(plan5.row[6] === '', 'Case5 DecisionID cleared');
assert(plan5.decisionBound === false, 'Case5 unbound');
assert(
  plan5.warning.indexOf(
    'Content intervention recorded without Decision binding: unknown DecisionID=no-such-id'
  ) >= 0,
  'Case5 warning'
);
assert(!historySet['no-such-id'], 'Case5 did not invent history');
var rowsWithUnknownCleared = [plan5.row];
var latest5 = getLatestContentUpdate_(
  'Grain Rot',
  '/grain-rot/gameplay/',
  rowsWithUnknownCleared
);
assert(!!latest5 && latest5.updateDate === '2026-08-16', 'Case5 intervention readable');
assert(latest5.decisionId === '', 'Case5 stored DecisionID empty');
assert(
  !!findContentUpdateCooldownFromRows_(
    rowsWithUnknownCleared,
    'Grain Rot',
    '/grain-rot/gameplay/',
    '2026-08-16',
    rules
  ),
  'Case5 cooldown can use the row'
);

// Case 6: DecisionID column appended — cooldown unchanged vs 5-col fixtures
var withId = oldRows.map(function (r) {
  return r.concat(['', '']);
});
var cdOld = findContentUpdateCooldownFromRows_(
  oldRows,
  'Agefield High: Rock the School',
  '',
  '2026-08-15',
  rules
);
var cdNew = findContentUpdateCooldownFromRows_(
  withId,
  'Agefield High: Rock the School',
  '',
  '2026-08-15',
  rules
);
assert(cdOld && cdNew, 'Case6 both cooldown');
assert(cdOld.updateDate === cdNew.updateDate, 'Case6 same updateDate');
assert(cdOld.untilDate === cdNew.untilDate, 'Case6 same untilDate');
assert(cdOld.days === cdNew.days, 'Case6 same days');

// Case 7 / 8: ContentIntervention must not rewrite Snapshot / Outcome
assert(
  !/appendDecisionHistoryRows_|buildDecisionHistoryRow_/.test(contentSrc),
  'Case7 no snapshot append'
);
assert(
  !/runDecisionOutcomeObservation|appendDecisionOutcome|DECISION_OUTCOME_HEADERS/.test(
    contentSrc
  ),
  'Case8 no outcome write'
);
assert(
  contentSrc.indexOf('sheet.appendRow(plan.row)') >= 0,
  'Case7 writes via content appendRow only'
);
assert(
  !/getSheetByName\(SHEET_NAMES\.DECISION_HISTORY\)[\s\S]{0,400}setValues?\(/.test(
    contentSrc
  ),
  'Case7 history sheet is read-only'
);

// Case 9: update time can differ from DecisionDataDate
var plan9 = planContentInterventionWrite_(
  {
    updateDate: '2026-08-20',
    site: 'Grain Rot',
    pagePath: '/grain-rot/gameplay/',
    source: 'PM',
    note: 'shipped later',
    updateType: 'CONTENT_OPTIMIZE',
    decisionId: idA
  },
  historySet
);
assert(plan9.row[0] === '2026-08-20', 'Case9 intervention date');
assert(plan9.row[0] !== '2026-08-10', 'Case9 not forced to DecisionDataDate');

// Case 10: production-semantic two records still readable (5-col)
var age = getLatestContentUpdate_(
  'Agefield High: Rock the School',
  '',
  oldRows
);
var ms2 = getLatestContentUpdate_('Mortal Shell II', '', oldRows);
assert(age && age.updateDate === '2026-08-14' && age.source === '社媒研究', 'Case10 Agefield');
assert(ms2 && ms2.updateDate === '2026-08-14' && ms2.note.indexOf('社媒') >= 0, 'Case10 MS2');

// Wiring / config
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');
var codeSrc = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');

var headers = configSrc.match(/var CONTENT_UPDATE_HEADERS = \[[\s\S]*?\];/)[0];
assert(/'更新时间'/.test(headers), 'header 更新时间');
assert(/'站点'/.test(headers), 'header 站点');
assert(/'页面路径'/.test(headers), 'header 页面路径');
assert(/'来源'/.test(headers), 'header 来源');
assert(/'更新说明'/.test(headers), 'header 更新说明');
assert(/'更新类型'/.test(headers), 'header 更新类型');
assert(/'DecisionID'/.test(headers), 'header DecisionID');
assert(
  headers.indexOf('更新说明') < headers.indexOf('更新类型') &&
    headers.indexOf('更新类型') < headers.indexOf('DecisionID'),
  'DecisionID is last'
);
assert(/CONTENT_INTERVENTION_TYPES/.test(configSrc), 'types enum');
assert(/function recordContentInterventionAt_/.test(contentSrc), 'writer');
assert(/function ensureContentUpdateHeader_/.test(contentSrc), 'ensure header');
assert(/记录内容更新/.test(codeSrc), 'menu');
assert(/recordContentInterventionAt_/.test(decisionSrc), 'compat delegate');
assert(/ensureContentUpdateHeader_/.test(decisionSrc), 'engine ensure');
assert(/只有网站实际发生页面修改时才记录/.test(sheetSrc), 'usage');
assert(/DecisionID（内容更新记录）/.test(configSrc), 'metric DecisionID content');
assert(/DONE ≠ 自动产生本记录/.test(configSrc), 'metric DONE note');
assert(!/runDaily/.test(contentSrc) || contentSrc.indexOf('不接 runDaily') >= 0, 'no runDaily hook');
assert(!/syncHumanDecisions\(/.test(contentSrc), 'not called from content file');

// cooldown still uses indices 0/1/2
assert(/row\[1\]/.test(decisionSrc) && /row\[2\]/.test(decisionSrc), 'cooldown indices');

console.log('PASS scripts/test-content-intervention-binding.js');
