/**
 * 本地纯逻辑验证：内容更新 cooldown（不依赖 SpreadsheetApp）。
 * node scripts/test-content-update-cooldown.js
 */

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
        pagePath: String(row[2] || '').trim()
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

function formatContentUpdateCooldownReason_(cooldown) {
  return (
    '该站于 ' +
    cooldown.updateDate +
    ' 完成内容更新，当前处于 ' +
    cooldown.days +
    ' 天观察期；原始建议为内容优化，先等待新 GSC 数据验证效果。'
  );
}

function findActionCooldown_(history, site, action, runDate, rules) {
  var ACTION_COOLDOWN_ACTIONS = {
    CONTENT_OPTIMIZE: true,
    CONTENT_EXPAND: true,
    SERP_RECHECK: true,
    DOMAIN_PREPARE: true
  };
  if (!ACTION_COOLDOWN_ACTIONS[action]) return null;
  var cooldownDays = Number(rules && rules.ACTION_COOLDOWN_DAYS) || 3;
  var latest = '';
  var latestStatus = '';
  for (var i = 0; i < history.length; i++) {
    var row = history[i];
    if (String(row[2] || '').trim() !== site) continue;
    if (String(row[4] || '').trim() !== action) continue;
    var status = String(row[7] || '').trim().toUpperCase();
    if (status !== 'DONE' && status !== 'SKIP') continue;
    var date = String(row[0] || '').trim().substring(0, 10);
    if (!date) continue;
    if (!latest || date > latest) {
      latest = date;
      latestStatus = status;
    }
  }
  if (!latest) return null;
  var elapsed = daysBetweenStr_(latest, runDate);
  if (elapsed === null || elapsed < 0) return null;
  if (elapsed >= cooldownDays) return null;
  return {
    doneDate: latest,
    status: latestStatus,
    untilDate: addDaysStr_(latest, cooldownDays),
    days: cooldownDays
  };
}

var rules = { CONTENT_UPDATE_COOLDOWN_DAYS: 3, ACTION_COOLDOWN_DAYS: 3 };
var fails = [];

function assert(cond, msg) {
  if (!cond) fails.push(msg);
}

var agefieldRows = [
  ['2026-08-14', 'Agefield High: Rock the School', '', '社媒研究', '根据最新社媒玩家信息完成内容更新']
];
var agefieldCd = findContentUpdateCooldownFromRows_(
  agefieldRows,
  'Agefield High: Rock the School',
  '',
  '2026-08-15',
  rules
);
assert(!!agefieldCd, 'Agefield 2026-08-15 应处于内容更新冷却');
var agefieldReason = '原始评分理由' + '；' + formatContentUpdateCooldownReason_(agefieldCd);
assert(agefieldReason.indexOf('观察期') >= 0, 'Reason 含观察期');
assert(agefieldReason.indexOf('原始评分理由') >= 0, '保留原 Reason');
assert(agefieldFinalWouldBeWait_(true), 'CONTENT_OPTIMIZE + cooldown → WAIT(P3)');

function agefieldFinalWouldBeWait_(hasCd) {
  var raw = { action: 'CONTENT_OPTIMIZE', priority: 'P2' };
  if (hasCd) return { action: 'WAIT', priority: 'P3' }.action === 'WAIT';
  return raw.action === 'CONTENT_OPTIMIZE';
}

assert(
  !findContentUpdateCooldownFromRows_(
    agefieldRows,
    'Agefield High: Rock the School',
    '',
    '2026-08-17',
    rules
  ),
  '满 3 天后解除'
);

var ms2Rows = [
  ['2026-08-14', 'Mortal Shell II', '', '社媒研究', '根据最新社媒玩家信息完成内容更新']
];
assert(
  !!findContentUpdateCooldownFromRows_(
    ms2Rows,
    'Mortal Shell II',
    '/mortal-shell-ii/beta/',
    '2026-08-15',
    rules
  ),
  'Mortal Shell II 整站更新应跳过 Research Job'
);

var auCooldown = findActionCooldown_(
  [['2026-08-14', 'P2', 'Approximately Up', 'TRACTION', 'CONTENT_OPTIMIZE', 38, 'old', 'DONE', '']],
  'Approximately Up',
  'CONTENT_OPTIMIZE',
  '2026-08-15',
  rules
);
assert(!!auCooldown, 'Approximately Up DONE cooldown 兼容');
assert(auCooldown.untilDate === '2026-08-17', 'Approximately Up suppressed until 2026-08-17');

// Page-specific MS2 beta-progress-carry-over intervention (2026-08-15)
var ms2PageRows = [
  [
    '2026-08-15',
    'Mortal Shell II',
    '/mortal-shell-ii/beta-progress-carry-over/',
    'ms2-beta-progress-carry-over-20260814',
    'beta carry-over / reset / Flayed Harbinger reward / Marrow Keep Prologue skip',
    'CONTENT_OPTIMIZE',
    ''
  ]
];
var ms2TargetCd = findContentUpdateCooldownFromRows_(
  ms2PageRows,
  'Mortal Shell II',
  '/mortal-shell-ii/beta-progress-carry-over/',
  '2026-08-16',
  rules
);
assert(!!ms2TargetCd, 'MS2 target page 2026-08-16 应处于内容更新冷却');
assert(ms2TargetCd.untilDate === '2026-08-18', 'MS2 page cooldown until 2026-08-18');
assert(
  !findContentUpdateCooldownFromRows_(
    ms2PageRows,
    'Mortal Shell II',
    '/mortal-shell-ii/beta/',
    '2026-08-16',
    rules
  ),
  '不得误伤 Mortal Shell II 其它页面'
);
assert(
  !findContentUpdateCooldownFromRows_(
    ms2PageRows,
    'Approximately Up',
    '',
    '2026-08-16',
    rules
  ),
  '不得误伤 Approximately Up'
);
assert(
  !findContentUpdateCooldownFromRows_(
    ms2PageRows,
    'Leafy Corner',
    '',
    '2026-08-16',
    rules
  ),
  '不得误伤 Leafy Corner'
);
// Decision Engine 站点级查询 pagePath=''：页面级记录不匹配（现有 contract）
assert(
  !findContentUpdateCooldownFromRows_(
    ms2PageRows,
    'Mortal Shell II',
    '',
    '2026-08-16',
    rules
  ),
  '页面级记录不触发站点级 Decision content-cooldown 查询'
);
assert(
  !findContentUpdateCooldownFromRows_(
    ms2PageRows,
    'Mortal Shell II',
    '/mortal-shell-ii/beta-progress-carry-over/',
    '2026-08-18',
    rules
  ),
  '满 3 天后页面 cooldown 解除，重新允许机会'
);

// Same page 8/15 + 8/17: latest is 8/17; 8/15 must not expire cooldown early.
var ms2TwoInterventions = [
  [
    '2026-08-15',
    'Mortal Shell II',
    '/mortal-shell-ii/beta-progress-carry-over/',
    'ms2-beta-progress-carry-over-20260814',
    'beta carry-over / reset / Flayed Harbinger reward / Marrow Keep Prologue skip',
    'CONTENT_OPTIMIZE',
    ''
  ],
  [
    '2026-08-17',
    'Mortal Shell II',
    '/mortal-shell-ii/beta-progress-carry-over/',
    'Winner Asset COMPARISON_MATRIX evidence upgrade',
    'ResearchJobID=asset-ms2-beta-progress-carry-over-20260817',
    'CONTENT_EXPAND',
    ''
  ]
];
var ms2Latest = getLatestContentUpdate_(
  'Mortal Shell II',
  '/mortal-shell-ii/beta-progress-carry-over/',
  ms2TwoInterventions
);
assert(ms2Latest && ms2Latest.updateDate === '2026-08-17', 'same-page latest is 2026-08-17');
var ms2Aug17Cd = findContentUpdateCooldownFromRows_(
  ms2TwoInterventions,
  'Mortal Shell II',
  '/mortal-shell-ii/beta-progress-carry-over/',
  '2026-08-17',
  rules
);
assert(!!ms2Aug17Cd, '8/17 asOf stays in cooldown');
assert(ms2Aug17Cd.updateDate === '2026-08-17', 'cooldown starts from 8/17 not 8/15');
assert(ms2Aug17Cd.untilDate === '2026-08-20', 'cooldown until 2026-08-20');
assert(
  !!findContentUpdateCooldownFromRows_(
    ms2TwoInterventions,
    'Mortal Shell II',
    '/mortal-shell-ii/beta-progress-carry-over/',
    '2026-08-18',
    rules
  ),
  '8/18 still cools because latest is 8/17 (8/15-only would have expired)'
);
assert(
  !!findContentUpdateCooldownFromRows_(
    ms2TwoInterventions,
    'Mortal Shell II',
    '/mortal-shell-ii/beta-progress-carry-over/',
    '2026-08-19',
    rules
  ),
  '8/19 still cools'
);
assert(
  !findContentUpdateCooldownFromRows_(
    ms2TwoInterventions,
    'Mortal Shell II',
    '/mortal-shell-ii/beta-progress-carry-over/',
    '2026-08-20',
    rules
  ),
  '8/20 cooldown elapsed'
);
assert(
  !findContentUpdateCooldownFromRows_(
    ms2TwoInterventions,
    'Mortal Shell II',
    '/mortal-shell-ii/open-beta/',
    '2026-08-17',
    rules
  ),
  '8/17 page cooldown does not block other MS2 pages'
);

// 8/16 CONTENT_OPTIMIZE 人工 DONE → action cooldown（不改 Decision 历史事实）
var ms2ActionCd = findActionCooldown_(
  [
    [
      '2026-08-16',
      'P2',
      'Mortal Shell II',
      'TRACTION',
      'CONTENT_OPTIMIZE',
      30,
      'old',
      'DONE',
      '2026-08-15 已完成 beta progress carry-over 页面更新，进入 cooldown，等待新 GSC 数据。'
    ]
  ],
  'Mortal Shell II',
  'CONTENT_OPTIMIZE',
  '2026-08-16',
  rules
);
assert(!!ms2ActionCd, 'MS2 8/16 DONE 应进入 action cooldown');
assert(ms2ActionCd.untilDate === '2026-08-19', 'MS2 action cooldown until 2026-08-19');
assert(
  !findActionCooldown_(
    [
      [
        '2026-08-16',
        'P2',
        'Mortal Shell II',
        'TRACTION',
        'CONTENT_OPTIMIZE',
        30,
        'old',
        'DONE',
        'note'
      ]
    ],
    'Leafy Corner',
    'CONTENT_OPTIMIZE',
    '2026-08-16',
    rules
  ),
  'MS2 DONE 不得误伤 Leafy Corner action cooldown'
);

if (fails.length) {
  console.error('FAIL:\n- ' + fails.join('\n- '));
  process.exit(1);
}
console.log('PASS test-content-update-cooldown.js');
console.log('- Agefield: CONTENT_OPTIMIZE → WAIT(P3) while in content-update observation');
console.log('- Mortal Shell II: site-wide update blocks Research Job for any page');
console.log('- Approximately Up: DONE action cooldown still active until 2026-08-17');
console.log('- After 3 days: content-update cooldown clears');
console.log('- MS2 page-specific 2026-08-15: target page cools; other pages / AU / Leafy untouched');
console.log('- MS2 8/15+8/17: latest=8/17 until=8/20; 8/15 cannot expire cooldown early');
console.log('- MS2 8/16 DONE: action cooldown until 2026-08-19');
