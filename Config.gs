/**
 * 站点配置与常量
 * Day0 请在「站点配置」Sheet 中由用户自行填写，不要在此硬编码。
 */

var SHEET_NAMES = {
  SITES: '站点配置',
  SNAPSHOT: '每日快照',
  DAILY: 'GSC日数据',
  QUERIES: 'Query明细',
  QUERY_PAGES: 'Query页面明细',
  URL_INDEX: 'URL索引',
  LOG: '运行日志',
  RULES: '规则配置',
  SITE_STATUS: '站点状态',
  TODAY_ACTIONS: '今日行动'
};

var SITE_HEADERS = ['站点名称', 'Property URL', 'Sitemap URL', 'Day0', 'Enabled'];
var SNAPSHOT_HEADERS = [
  'RunDate', 'LatestGSCDataDate', 'Site', 'PropertyURL', 'Day',
  'SitemapURLCount', 'IndexedURLCount', 'IndexRate',
  'Impressions', 'Clicks', 'CTR', 'AveragePosition',
  'ReturnedQueryCount', 'FirstImpressionDate',
  'TopQueries', 'TopPages', 'NewQueries', 'Status', 'Error'
];
var DAILY_HEADERS = [
  'DataDate', 'Site', 'Clicks', 'Impressions', 'CTR',
  'AveragePosition', 'ReturnedQueryCount', 'TopQueries', 'TopPages'
];
var QUERY_HEADERS = [
  'DataDate', 'Site', 'Query', 'Clicks', 'Impressions', 'CTR', 'AveragePosition'
];
/** Fresh Query×Page 联合维度；rowLimit 仍用 QUERY_ROW_LIMIT（小站够用，不保证长期完整） */
var QUERY_PAGE_HEADERS = [
  'DataDate', 'Site', 'Query', 'PageURL', 'PagePath',
  'Clicks', 'Impressions', 'CTR', 'AveragePosition'
];
var URL_INDEX_HEADERS = [
  'RunDate', 'Site', 'URL', 'Verdict', 'CoverageState', 'RobotsTxtState',
  'IndexingState', 'LastCrawlTime', 'PageFetchState',
  'GoogleCanonical', 'UserCanonical', 'CrawledAs', 'Error'
];
var LOG_HEADERS = ['Timestamp', 'Level', 'Site', 'Message'];
var RULE_HEADERS = ['规则Key', '当前值', '说明'];
var SITE_STATUS_HEADERS = [
  'RunDate', 'Site', 'DecisionDataDate', 'Day',
  'IndexedURLCount', 'IndexRate',
  'Impressions24H', 'Impressions7D', 'Previous3DImpressions', 'Latest3DImpressions', 'Growth3D',
  'QueryCount7D', 'GuideQueryCount7D',
  'Top50QueryCount', 'Top30QueryCount', 'Top20QueryCount',
  'Clicks7D',
  'TractionScore', 'QueryScore', 'MomentumScore', 'ExpansionScore', 'RiskScore',
  'DomainScore',
  'LifecycleStage', 'RecommendedAction', 'Priority', 'Reason'
];
var TODAY_ACTION_HEADERS = [
  'Date', 'Priority', 'Site', 'LifecycleStage', 'RecommendedAction',
  'DomainScore', 'Reason', 'Status', '人工备注'
];
var TODAY_ACTION_STATUSES = ['TODO', 'DONE', 'SKIP'];
var TODAY_ACTION_EXCLUDED = {
  NO_ACTION: true,
  WAIT: true
};

/**
 * Decision Engine 默认规则。首次写入「规则配置」；之后以 Sheet 当前值为准。
 * INDEX_RATE_WARNING 为比率（0.5 = 50%）。
 */
var DEFAULT_DECISION_RULES = [
  ['DOMAIN_SCORE_PREPARE', 60, 'DomainScore 达到此值且未到升级线时，推荐 DOMAIN_PREPARE'],
  ['DOMAIN_SCORE_PROMOTE', 75, 'DomainScore 达到此值且通过 Domain Gate 时，推荐 DOMAIN_UPGRADE'],
  ['DOMAIN_MIN_DAY', 3, '非 Fast Track 的域名动作最早天数'],
  ['DOMAIN_MIN_INDEXED_URLS', 2, 'Domain Gate：最少已索引 URL 数'],
  ['DOMAIN_MIN_7D_IMPRESSIONS', 30, 'Domain Gate：近 7 天最少曝光'],
  ['DOMAIN_MIN_GUIDE_QUERIES', 2, 'Domain Gate：近 7 天最少 Guide Query 数'],
  ['FAST_TRACK_24H_IMPRESSIONS', 300, 'Fast Track：最近一日曝光阈值'],
  ['FAST_TRACK_GUIDE_QUERIES', 5, 'Fast Track：近 7 天 Guide Query 阈值'],
  ['ARCHIVE_MIN_DAY', 14, 'ARCHIVE 最早天数（避免误杀新站）'],
  ['ARCHIVE_MAX_7D_IMPRESSIONS', 10, 'ARCHIVE：近 7 天曝光上限（含）'],
  ['INDEX_CHECK_DAY', 7, '从这天起检查索引是否异常'],
  ['INDEX_RATE_WARNING', 0.5, '索引率低于此值时优先 CHECK_INDEX（0.5 = 50%）'],
  ['CONTENT_OPTIMIZE_MIN_7D_IMPRESSIONS', 30, '进入 CONTENT_OPTIMIZE 所需最近7日最少曝光'],
  ['CONTENT_OPTIMIZE_MIN_GUIDE_QUERIES', 2, '进入 CONTENT_OPTIMIZE 所需攻略型 Query 数'],
  ['CONTENT_OPTIMIZE_MIN_CLICKS', 1, '进入 CONTENT_OPTIMIZE 所需最近7日最少 Click'],
  ['ACTION_COOLDOWN_DAYS', 3, '同站点同动作完成后多少天内不重复提醒']
];

/** V1：这些人工动作在 DONE/SKIP 后进入短冷却；强动作不冷却 */
var ACTION_COOLDOWN_ACTIONS = {
  CONTENT_OPTIMIZE: true,
  CONTENT_EXPAND: true,
  SERP_RECHECK: true,
  DOMAIN_PREPARE: true
};

/**
 * Guide Query V1：可解释的攻略意图词表。
 * 同一 key 下的单复数视为同一 Intent 类别（用于 ExpansionScore）。
 */
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
  { key: 'platform', terms: ['platform', 'console', 'ps5', 'xbox', 'switch'] }
];

/** 从站点名 / hostname 提取品牌词时忽略的短词 */
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

/** 首次 setup 时预填的 7 个站点（Day0 留空） */
var DEFAULT_SITES = [
  {
    name: 'Agefield High: Rock the School',
    propertyUrl: 'https://agefield-high-rock-the-school.vercel.app/'
  },
  {
    name: 'Mortal Shell II',
    propertyUrl: 'https://mortal-shell-ii.vercel.app/'
  },
  {
    name: 'BeastLink',
    propertyUrl: 'https://beast-link.vercel.app/'
  },
  {
    name: 'Sovereign Tower',
    propertyUrl: 'https://sovereign-tower.vercel.app/'
  },
  {
    name: 'Approximately Up',
    propertyUrl: 'https://approximately-up.vercel.app/'
  },
  {
    name: 'Grain Rot',
    propertyUrl: 'https://grainrot.vercel.app/'
  },
  {
    name: 'Leafy Corner',
    propertyUrl: 'https://leafy-corner.vercel.app/'
  }
];

var GSC_API_BASE = 'https://www.googleapis.com/webmasters/v3';
var URL_INSPECTION_API =
  'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

var QUERY_ROW_LIMIT = 1000;
var TOP_N = 5;
var NEW_QUERIES_MAX = 10;
var LOOKBACK_DAYS_FOR_LATEST = 10;
var BACKFILL_DAYS = 14;
var MAX_RETRIES = 3;

/** Fresh Query 明细：覆盖最近 N 个自然日（含今天），使用 dataState=all */
var FRESH_QUERY_DAYS = 3;

/** 每次 runIndexAuditBatch 最多完整 Inspection 的站点数 */
var INDEX_AUDIT_BATCH_SIZE = 2;

/** runIndexAuditBatch 一天内 4 次 trigger 的大致时段（Asia/Shanghai） */
var INDEX_AUDIT_TRIGGER_HOURS = [9, 12, 15, 20];
