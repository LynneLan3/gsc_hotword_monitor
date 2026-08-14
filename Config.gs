/**
 * 站点配置与常量
 * Day0 请在「站点配置」Sheet 中由用户自行填写，不要在此硬编码。
 */

var SHEET_NAMES = {
  SITES: '站点配置',
  SNAPSHOT: '每日快照',
  DAILY: 'GSC日数据',
  QUERIES: 'Query明细',
  URL_INDEX: 'URL索引',
  LOG: '运行日志'
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
var URL_INDEX_HEADERS = [
  'RunDate', 'Site', 'URL', 'Verdict', 'CoverageState', 'RobotsTxtState',
  'IndexingState', 'LastCrawlTime', 'PageFetchState',
  'GoogleCanonical', 'UserCanonical', 'CrawledAs', 'Error'
];
var LOG_HEADERS = ['Timestamp', 'Level', 'Site', 'Message'];

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
