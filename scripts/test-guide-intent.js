/**
 * Guide Intent 词表本地自测（不依赖 SpreadsheetApp）。
 * 运行：node scripts/test-guide-intent.js
 *
 * 与 Config.gs GUIDE_INTENT_CATEGORIES + DecisionEngine matchGuideIntentCategories_ 对齐。
 */

var BRAND_TOKEN_STOPWORDS = {
  the: true,
  a: true,
  an: true,
  of: true,
  and: true,
  to: true,
  ii: true,
  iii: true
};

var GUIDE_INTENT_CATEGORIES = [
  { key: 'guide', terms: ['guide', 'wiki', 'walkthrough'] },
  { key: 'mission', terms: ['mission', 'missions'] },
  { key: 'weapon', terms: ['weapon', 'weapons'] },
  { key: 'character', terms: ['character', 'characters'] },
  { key: 'map', terms: ['map', 'maps'] },
  { key: 'code', terms: ['code', 'codes'] },
  { key: 'achievement', terms: ['achievement', 'achievements'] },
  { key: 'ending', terms: ['ending', 'endings'] },
  { key: 'boss', terms: ['boss', 'bosses'] },
  { key: 'build', terms: ['build', 'builds'] },
  { key: 'class', terms: ['class', 'classes'] },
  { key: 'skill', terms: ['skill', 'skills'] },
  { key: 'location', terms: ['location', 'locations'] },
  { key: 'howto', terms: ['how to'] },
  { key: 'where', terms: ['where'] },
  { key: 'best', terms: ['best'] },
  { key: 'romance', terms: ['romance'] },
  { key: 'platform', terms: ['platform', 'console', 'ps5', 'xbox', 'switch'] },
  {
    key: 'save_progress',
    terms: ['carry over', 'carries over', 'carryover', 'save file', 'save', 'progress']
  },
  { key: 'reward', terms: ['rewards', 'reward'] }
];

function escapeRe_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function intentWordRe_(term) {
  return new RegExp('(?:^|[^a-z0-9])' + escapeRe_(term) + '(?:$|[^a-z0-9])', 'i');
}

function queryHasIntentTerms_(queryLower, terms) {
  for (var i = 0; i < terms.length; i++) {
    var term = String(terms[i] || '').toLowerCase();
    if (!term) continue;
    if (term.indexOf(' ') >= 0) {
      if (queryLower.indexOf(term) >= 0) return true;
    } else if (intentWordRe_(term).test(queryLower)) {
      return true;
    }
  }
  return false;
}

function tokenizeBrand_(text) {
  var raw = String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var tok = raw[i];
    if (!tok || tok.length < 2) continue;
    if (BRAND_TOKEN_STOPWORDS[tok]) continue;
    if (/^\d+$/.test(tok)) continue;
    out.push(tok);
  }
  return out;
}

function getBrandTokenSet_(site) {
  var set = {};
  var chunks = [];
  if (site && site.name) chunks.push(site.name);
  if (site && site.propertyUrl) {
    try {
      var host = new URL(site.propertyUrl).hostname || '';
      chunks.push(host.split('.')[0] || '');
    } catch (e) {
      // ignore
    }
  }
  for (var i = 0; i < chunks.length; i++) {
    var toks = tokenizeBrand_(chunks[i]);
    for (var t = 0; t < toks.length; t++) set[toks[t]] = true;
  }
  return set;
}

function isPureBrandQuery_(queryLower, site) {
  var tokens = tokenizeBrand_(queryLower);
  if (!tokens.length) return false;
  var brand = getBrandTokenSet_(site);
  if (!Object.keys(brand).length) return false;
  for (var i = 0; i < tokens.length; i++) {
    if (!brand[tokens[i]]) return false;
  }
  return true;
}

function matchGuideIntentCategories_(query, site) {
  var q = String(query || '')
    .toLowerCase()
    .trim();
  if (!q) return [];
  if (isPureBrandQuery_(q, site)) return [];
  var matched = [];
  for (var i = 0; i < GUIDE_INTENT_CATEGORIES.length; i++) {
    var cat = GUIDE_INTENT_CATEGORIES[i];
    if (queryHasIntentTerms_(q, cat.terms)) matched.push(cat.key);
  }
  return matched;
}

var fails = [];
function assert(cond, msg) {
  if (!cond) fails.push(msg);
}

var leafy = { name: 'Leafy Corner', propertyUrl: 'https://leafy-corner.vercel.app/' };
var mortal = { name: 'Mortal Shell II', propertyUrl: 'https://mortal-shell-ii.vercel.app/' };

assert(matchGuideIntentCategories_('leafy corner', leafy).length === 0, '纯品牌 leafy');
assert(matchGuideIntentCategories_('mortal shell 2', mortal).length === 0, '纯品牌 MS2');
assert(
  matchGuideIntentCategories_('leafy corner walkthrough', leafy).indexOf('guide') >= 0,
  '既有 guide 类别仍命中'
);
assert(
  matchGuideIntentCategories_('best weapon build', leafy).indexOf('weapon') >= 0,
  '既有 weapon 类别仍命中'
);
assert(
  matchGuideIntentCategories_('grain rot ps5', {
    name: 'Grain Rot',
    propertyUrl: 'https://grainrot.vercel.app/'
  }).indexOf('platform') >= 0,
  '既有 platform 类别仍命中'
);

var saveProgressQueries = [
  'mortal shell 2 beta progress carry over',
  'mortal shell 2 beta carry over',
  'does mortal shell 2 beta progress carry over',
  'mortal shell 2 beta what carries over',
  'mortal shell 2 beta save',
  'mortal shell 2 beta save file',
  'mortal shell 2 demo progress'
];
for (var i = 0; i < saveProgressQueries.length; i++) {
  var q = saveProgressQueries[i];
  var keys = matchGuideIntentCategories_(q, mortal);
  assert(keys.indexOf('save_progress') >= 0, q + ' → save_progress (got ' + keys.join(',') + ')');
}

var rewardQueries = ['mortal shell 2 beta rewards', 'mortal shell 2 open beta rewards'];
for (var r = 0; r < rewardQueries.length; r++) {
  var rq = rewardQueries[r];
  var rkeys = matchGuideIntentCategories_(rq, mortal);
  assert(rkeys.indexOf('reward') >= 0, rq + ' → reward (got ' + rkeys.join(',') + ')');
}

if (fails.length) {
  console.error('FAIL test-guide-intent.js');
  fails.forEach(function (f) {
    console.error(' - ' + f);
  });
  process.exit(1);
}
console.log('PASS test-guide-intent.js');
saveProgressQueries.forEach(function (q) {
  console.log('  ' + q + ' → ' + matchGuideIntentCategories_(q, mortal).join(','));
});
rewardQueries.forEach(function (q) {
  console.log('  ' + q + ' → ' + matchGuideIntentCategories_(q, mortal).join(','));
});
