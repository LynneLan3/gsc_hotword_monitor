/**
 * G027 P4 — GA4 Admin discovery matching (local, no OAuth).
 * Run: node scripts/test-ga4-admin-discovery.js
 */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var adminSrc = fs.readFileSync(path.join(root, 'Ga4Admin.gs'), 'utf8');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var appsscript = JSON.parse(
  fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8')
);

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
}

function extractFn(src, name) {
  var re = new RegExp(
    'function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}(?=\\n(?:function\\s|\\/\\*|var\\s|$))'
  );
  var m = src.match(re);
  if (!m) {
    // fallback: from function to next top-level function
    var start = src.indexOf('function ' + name + '(');
    assert(start >= 0, 'missing function ' + name);
    var next = src.indexOf('\nfunction ', start + 1);
    return next < 0 ? src.slice(start) : src.slice(start, next);
  }
  return m[0];
}

assert(
  appsscript.dependencies &&
    appsscript.dependencies.enabledAdvancedServices &&
    appsscript.dependencies.enabledAdvancedServices.some(function (s) {
      return s.serviceId === 'analyticsadmin' && s.userSymbol === 'AnalyticsAdmin';
    }),
  'AnalyticsAdmin advanced service enabled'
);
assert(
  (appsscript.oauthScopes || []).indexOf(
    'https://www.googleapis.com/auth/analytics.readonly'
  ) >= 0,
  'analytics.readonly scope present'
);
assert(configSrc.indexOf("'ga4_stream_id'") >= 0, 'SITE_HEADERS has ga4_stream_id');
assert(
  configSrc.indexOf("'ga4_measurement_id'") >= 0,
  'SITE_HEADERS has ga4_measurement_id'
);
assert(configSrc.indexOf('GA4_REGISTRY_IDENTITY_V1') >= 0, 'registry identity snapshot');
assert(configSrc.indexOf('GA4_DISCOVERY') >= 0, 'GA4_DISCOVERY sheet name');
assert(/function authorizeGa4Admin\(/.test(adminSrc), 'authorizeGa4Admin entry');
assert(/function discoverGa4SiteBindings\(/.test(adminSrc), 'discoverGa4SiteBindings entry');
assert(/nextPageToken/.test(adminSrc), 'pagination handled');
assert(
  adminSrc.indexOf('Never fuzzy-match property display names') >= 0,
  'documents no fuzzy name matching'
);
assert(
  !/displayName\s*===\s*|includes\(.*displayName/i.test(adminSrc),
  'no displayName equality matcher'
);

var GA4_SENTINELS = { UNKNOWN: 'UNKNOWN', MISSING: 'MISSING', DISABLED: 'DISABLED' };
var GA4_REGISTRY_IDENTITY_V1 = {
  beastlink: {
    production_url: 'https://beast-link.vercel.app',
    ga4_measurement_id: 'G-ME3VVC6QLD'
  },
  'mortal-shell-ii': {
    production_url: 'https://mortalshell2guide.com',
    ga4_measurement_id: 'G-1D66T98097'
  },
  'grain-rot': {
    production_url: 'https://grainrot.vercel.app',
    ga4_measurement_id: 'G-6XGRN3QF1N'
  }
};

/* eslint-disable no-unused-vars */
eval(extractFn(adminSrc, 'normalizeGa4MatchKey_'));
eval(extractFn(adminSrc, 'isGa4MeasurementId_'));
eval(extractFn(adminSrc, 'isBlankGa4IdentityValue_'));
eval(extractFn(adminSrc, 'uniqueGa4StreamCandidates_'));
eval(extractFn(adminSrc, 'resolveGa4SiteIdentityBaseline_'));
eval(extractFn(adminSrc, 'matchGa4SiteBinding_'));
eval(extractFn(adminSrc, 'mapGa4WebStream_'));
/* eslint-enable no-unused-vars */

assert(
  normalizeGa4MatchKey_('https://Beast-Link.vercel.app') ===
    normalizeGa4MatchKey_('https://beast-link.vercel.app/'),
  'trailing slash + case normalize'
);
assert(
  normalizeGa4MatchKey_('MISSING') === '',
  'sentinel production_url empty key'
);
assert(
  normalizeGa4MatchKey_('https://a.example/path') === 'https://a.example/',
  'path ignored; host exact'
);

var streams = [
  {
    property_id: '111',
    property_display_name: 'BeastLink',
    stream_id: 's1',
    measurement_id: 'G-ME3VVC6QLD',
    default_uri: 'https://beast-link.vercel.app/',
    match_key: normalizeGa4MatchKey_('https://beast-link.vercel.app/')
  },
  {
    property_id: '222',
    property_display_name: 'Mortal',
    stream_id: 's2',
    measurement_id: 'G-1D66T98097',
    default_uri: 'https://mortalshell2guide.com',
    match_key: normalizeGa4MatchKey_('https://mortalshell2guide.com')
  },
  {
    property_id: '333',
    property_display_name: 'Dup A',
    stream_id: 's3a',
    measurement_id: 'G-AAAA111111',
    default_uri: 'https://dup.example/',
    match_key: normalizeGa4MatchKey_('https://dup.example/')
  },
  {
    property_id: '334',
    property_display_name: 'Dup B',
    stream_id: 's3b',
    measurement_id: 'G-BBBB222222',
    default_uri: 'https://dup.example',
    match_key: normalizeGa4MatchKey_('https://dup.example')
  }
];

var matched = matchGa4SiteBinding_(
  {
    siteId: 'beastlink',
    name: 'BeastLink',
    propertyUrl: 'https://beast-link.vercel.app/',
    ga4PropertyId: 'MISSING',
    ga4StreamId: '',
    ga4MeasurementId: '',
    productionUrl: ''
  },
  streams
);
assert(matched.match_status === 'MATCHED', 'beastlink MATCHED got ' + matched.match_status);
assert(matched.ga4_property_id === '111', 'property id 111');
assert(matched.ga4_measurement_id === 'G-ME3VVC6QLD', 'mid cross-check ok');
assert(matched.write === true, 'matched writeable');

var conflict = matchGa4SiteBinding_(
  {
    siteId: 'beastlink',
    name: 'BeastLink',
    propertyUrl: 'https://beast-link.vercel.app/',
    ga4PropertyId: '',
    ga4MeasurementId: 'G-WRONG00000',
    productionUrl: 'https://beast-link.vercel.app'
  },
  streams
);
assert(conflict.match_status === 'CONFLICT', 'MID mismatch CONFLICT');
assert(conflict.write === false, 'conflict not writeable');

var ambiguous = matchGa4SiteBinding_(
  {
    siteId: 'dup',
    name: 'Dup',
    propertyUrl: 'https://dup.example/',
    ga4PropertyId: '',
    ga4MeasurementId: '',
    productionUrl: 'https://dup.example/'
  },
  streams
);
assert(ambiguous.match_status === 'AMBIGUOUS', 'dup host AMBIGUOUS');
assert(ambiguous.write === false, 'ambiguous not written');

var noMatch = matchGa4SiteBinding_(
  {
    siteId: 'grain-rot',
    name: 'Grain Rot',
    propertyUrl: 'https://grainrot.vercel.app/',
    ga4PropertyId: '0',
    ga4MeasurementId: 'G-6XGRN3QF1N',
    productionUrl: ''
  },
  streams
);
assert(noMatch.match_status === 'NO_MATCH', 'grain-rot NO_MATCH without stream');
assert(noMatch.write === false, 'no_match not written');

// Existing correct property id → still MATCHED (idempotent)
var again = matchGa4SiteBinding_(
  {
    siteId: 'beastlink',
    name: 'BeastLink',
    propertyUrl: 'https://beast-link.vercel.app/',
    ga4PropertyId: '111',
    ga4StreamId: 's1',
    ga4MeasurementId: 'G-ME3VVC6QLD',
    productionUrl: 'https://beast-link.vercel.app/'
  },
  streams
);
assert(again.match_status === 'MATCHED', 'rerun MATCHED');
assert(again.write === true, 'rerun still applies idempotently');

var mapped = mapGa4WebStream_(
  {
    name: 'properties/999/dataStreams/55',
    type: 'WEB_DATA_STREAM',
    webStreamData: {
      measurementId: 'G-ABCDEF1234',
      defaultUri: 'https://example.com'
    }
  },
  '999',
  'Example'
);
assert(mapped.stream_id === '55', 'stream id parsed');
assert(mapped.match_key === 'https://example.com/', 'map match key');

var midCount = Object.keys(GA4_REGISTRY_IDENTITY_V1).filter(function (k) {
  return /^G-/.test(GA4_REGISTRY_IDENTITY_V1[k].ga4_measurement_id || '');
}).length;
assert(midCount === 3, 'fixture mid count');

// Config snapshot includes the 8 known production MIDs
var cfgMids = (configSrc.match(/ga4_measurement_id:\s*'G-[A-Z0-9]+'/g) || []).length;
assert(cfgMids === 8, 'registry snapshot has 8 measurement IDs, got ' + cfgMids);

console.log('test-ga4-admin-discovery: PASS');
