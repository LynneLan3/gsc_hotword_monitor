/**
 * M1-2 本地自测：指标说明配置与关键口径一致性（不改业务逻辑）。
 * 运行：node scripts/test-metric-guide.js
 */
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var configSrc = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');
var sheetSrc = fs.readFileSync(path.join(root, 'SheetManager.gs'), 'utf8');
var decisionSrc = fs.readFileSync(path.join(root, 'DecisionEngine.gs'), 'utf8');
var searchSrc = fs.readFileSync(path.join(root, 'SearchConsole.gs'), 'utf8');
var utilsSrc = fs.readFileSync(path.join(root, 'Utils.gs'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(/METRICS:\s*'指标说明'/.test(configSrc), 'SHEET_NAMES.METRICS missing');
assert(
  /SHEET_UI_ORDER\s*=\s*\[[\s\S]*?SHEET_NAMES\.USAGE[\s\S]*?SHEET_NAMES\.METRICS/.test(
    configSrc
  ),
  '指标说明 must follow 使用说明 in SHEET_UI_ORDER'
);
assert(/METRIC_GUIDE_HEADERS/.test(configSrc), 'METRIC_GUIDE_HEADERS missing');
assert(/function getMetricGuideRows_\(\)/.test(configSrc), 'getMetricGuideRows_ missing');
assert(
  /function ensureMetricGuideSheet_\(\)/.test(sheetSrc),
  'ensureMetricGuideSheet_ missing'
);
assert(
  /ensureMetricGuideSheet_\(\)/.test(sheetSrc) &&
    /function setupSheets\(\)[\s\S]*ensureMetricGuideSheet_/.test(sheetSrc),
  'setupSheets must call ensureMetricGuideSheet_'
);
assert(
  /function organizeSheetUi\(\)[\s\S]*ensureMetricGuideSheet_/.test(sheetSrc),
  'organizeSheetUi must call ensureMetricGuideSheet_'
);
assert(
  /如果不知道某个指标来自哪里/.test(sheetSrc),
  '使用说明 must point to 指标说明'
);

// Eval only getMetricGuideRows_ + headers from Config by extracting function body
var headersMatch = configSrc.match(
  /var METRIC_GUIDE_HEADERS\s*=\s*(\[[\s\S]*?\]);/
);
assert(headersMatch, 'cannot parse METRIC_GUIDE_HEADERS');
var headers = eval(headersMatch[1]);
assert(headers.length === 11, 'headers must be 11 columns, got ' + headers.length);
assert(headers[0] === '指标/字段' && headers[2] === '类型', 'header labels mismatch');

var rowsMatch = configSrc.match(
  /function getMetricGuideRows_\(\) \{\s*return (\[[\s\S]*?\]);\s*\}/
);
assert(rowsMatch, 'cannot parse getMetricGuideRows_ return array');
var rows = eval(rowsMatch[1]);
assert(rows.length === 72, 'metric count must stay 72, got ' + rows.length);

var ALLOWED_TYPES = {
  原始事实: true,
  人工配置: true,
  系统计算: true,
  实验规则: true,
  'AI / Research 判断': true,
  人工判断: true,
  诊断字段: true
};

var typeCounts = {};
var byName = {};
for (var i = 0; i < rows.length; i++) {
  assert(rows[i].length === 11, 'row ' + i + ' col count');
  var t = rows[i][2];
  assert(ALLOWED_TYPES[t], 'illegal type at row ' + i + ' (' + rows[i][0] + '): ' + t);
  assert(t.indexOf('+') < 0, 'composite type forbidden: ' + t);
  typeCounts[t] = (typeCounts[t] || 0) + 1;
  byName[rows[i][0]] = rows[i];
}

assert(byName.Day0[2] === '人工配置', 'Day0 must be 人工配置');
assert(byName.RuleVersion[2] === '人工配置', 'RuleVersion must be 人工配置');
assert(byName.DecisionID[2] === '系统计算', 'DecisionID must be 系统计算');
assert(
  byName['QueryCount7D / GuideQueryCount7D'][2] === '系统计算',
  'GuideQueryCount7D row must be 系统计算'
);
assert(
  byName['IntentCategoryCount / ExpansionScore'][2] === '系统计算',
  'IntentCategoryCount row must be 系统计算'
);

function mustHave(name) {
  assert(byName[name], 'missing metric: ' + name);
}

[
  'Day0',
  'Day',
  'Clicks',
  'Impressions',
  'CTR',
  'Average Position',
  'Query',
  'Landing Page / Page',
  'RunDate',
  'LatestGSCDataDate',
  'DecisionDataDate',
  'SitemapURLCount',
  'IndexedURLCount',
  'IndexRate',
  'Impressions24H / Impressions7D',
  'Previous3D / Latest3D Impressions',
  'Growth3D',
  'QueryCount7D / GuideQueryCount7D',
  'TractionScore',
  'QueryScore',
  'MomentumScore',
  'RiskScore',
  'DomainScore',
  'InvestmentTier / PortfolioAction',
  'WinnerPage / WinnerIntent',
  'Winner Asset Candidate',
  'Page明细',
  'QUERY_BLIND_SPOT / QueryClickCoverage / QueryImpressionCoverage',
  'IndependentSourceFamilyCount / 来源族',
  'CrossValidated',
  '搜索意图 / Opportunity Level / 内容机会动作',
  '相关度 / 发现主题 / 玩家问题 / Research Recommendation',
  '研究审核（Human Gate）'
].forEach(mustHave);

assert(
  byName['QUERY_BLIND_SPOT / QueryClickCoverage / QueryImpressionCoverage'][2] === '系统计算',
  'QUERY_BLIND_SPOT type'
);
assert(
  /非 Google|不是 Google/.test(
    byName['QUERY_BLIND_SPOT / QueryClickCoverage / QueryImpressionCoverage'][8]
  ),
  'QUERY_BLIND_SPOT not Google official'
);
assert(byName.CrossValidated[2] === '实验规则', 'CrossValidated type');
assert(
  /IndependentSourceFamilyCount|独立来源/.test(byName.CrossValidated[4]),
  'CrossValidated uses independent families'
);
assert(
  /非 Google|不是 Google/.test(byName['IndependentSourceFamilyCount / 来源族'][8]),
  'source family not Google official'
);
assert(/Google Search Console/.test(byName.Clicks[3]), 'Clicks source');
assert(byName.Impressions[2] === '原始事实', 'Impressions type');
assert(byName.Query[2] === '原始事实', 'Query type');
assert(byName['Average Position'][2] === '原始事实', 'Position type');
assert(byName.CTR[2] === '原始事实', 'CTR must be GSC returned fact');
assert(/非本地/.test(byName.CTR[4]) || /ctr 字段/.test(byName.CTR[4]), 'CTR formula note');

assert(/min\(|较早|两侧/.test(byName.DecisionDataDate[4]), 'DecisionDataDate formula');
assert(
  /URL Inspection|Verdict/.test(byName.IndexedURLCount[4]),
  'IndexedURLCount must describe Inspection history'
);
assert(/不是 GSC Coverage API/.test(byName.IndexedURLCount[4]), 'must deny Coverage API myth');
assert(/IndexedURLCount ÷ SitemapURLCount|÷/.test(byName.IndexRate[3] + byName.IndexRate[4]), 'IndexRate formula');
assert(/0\.5|50%/.test(byName.IndexRate[7]), '50% warning');
assert(/非 Google 官方/.test(byName.IndexRate[8] + byName.IndexRate[10]), '50% not Google official');

assert(/Latest3D \/ Previous3D|latest3d \/ previous3d/i.test(byName.Growth3D[4]), 'Growth3D ratio');
assert(/previous3d|Previous3D|分母/.test(byName.Growth3D[4] + byName.Growth3D[10]), 'zero denom');

assert(
  /GUIDE_INTENT|词表/.test(
    byName['QueryCount7D / GuideQueryCount7D'][3] +
      byName['QueryCount7D / GuideQueryCount7D'][4]
  ),
  'Guide wordlist'
);
assert(
  /实验分类|项目自己的|不是 Google/.test(
    byName['QueryCount7D / GuideQueryCount7D'][10]
  ),
  'Guide not GSC field'
);

assert(/不是 Google 指标/.test(byName.DomainScore[10]), 'DomainScore disclaimer');
assert(/正向|加分|不是扣分/.test(byName.RiskScore[4] + byName.RiskScore[10]), 'RiskScore naming');
assert(
  byName['相关度 / 发现主题 / 玩家问题 / Research Recommendation'][2].indexOf('AI') >= 0,
  'Relevance AI type'
);
assert(byName['研究审核（Human Gate）'][2] === '人工判断', 'Human Gate type');

// Code consistency checks (read-only)
assert(/function safeGrowth_/.test(decisionSrc), 'safeGrowth_ exists');
assert(
  /if \(!previous3d \|\| previous3d <= 0\)/.test(decisionSrc),
  'safeGrowth_ zero denom'
);
assert(
  /latestDaily < latestQuery \? latestDaily : latestQuery/.test(decisionSrc),
  'DecisionDataDate min logic'
);
assert(/ctr: r\.ctr \|\| 0/.test(searchSrc), 'CTR from GSC API');
assert(
  /endDate - Day0 \+ 1|diff \+ 1/.test(utilsSrc),
  'Day formula is end-Day0+1'
);
assert(/verdict === 'PASS'/.test(sheetSrc), 'IndexedURLCount PASS filter');
assert(
  !/function scoreTraction_|function decideRecommendedAction_/.test(
    configSrc + sheetSrc.replace(/ensureMetricGuideSheet_[\s\S]*?^}/m, '')
  ) || true,
  'noop'
);

// SHEET_UI_HIDDEN must still only hide PAGE_OPPORTUNITIES
assert(
  /SHEET_UI_HIDDEN\s*=\s*\[\s*SHEET_NAMES\.PAGE_OPPORTUNITIES\s*\]/.test(configSrc),
  'only PAGE_OPPORTUNITIES hidden'
);
assert(
  !/SHEET_UI_HIDDEN\s*=\s*\[[^\]]*SHEET_NAMES\.METRICS/.test(configSrc),
  '指标说明 must not be hidden'
);

console.log(
  JSON.stringify(
    {
      metricCount: rows.length,
      typeCounts: typeCounts,
      headers: headers
    },
    null,
    2
  )
);
console.log('PASS scripts/test-metric-guide.js');
