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
  TODAY_ACTIONS: '今日行动',
  OPPORTUNITIES: '内容机会',
  RESEARCH_JOBS: '研究任务',
  RESEARCH_REVIEW: '研究审核'
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
 * Content Opportunity Engine M0：内容机会表头（用户可见中文）。
 * 内部判断仍用 OPPORTUNITY_* 英文 enum。
 */
var OPPORTUNITY_HEADERS = [
  '生成时间', '数据日期', '站点', '站点URL',
  '搜索词', '页面URL', '页面路径',
  '点击', '展现', 'CTR', '平均排名',
  '搜索意图', '意图明确度',
  '机会等级', '建议动作', '推荐理由',
  '首次出现日期', '出现天数', '是否新搜索词',
  '研究状态', '备注',
  '研究任务ID', '研究请求时间'
];

/** Opportunity Engine 独立动作（勿与 Decision Engine RecommendedAction 混用） */
var OPPORTUNITY_ACTIONS = {
  RESEARCH_EXPAND_EXISTING: 'RESEARCH_EXPAND_EXISTING',
  RESEARCH_NEW_CONTENT: 'RESEARCH_NEW_CONTENT',
  WATCH: 'WATCH',
  IGNORE_BRAND: 'IGNORE_BRAND'
};

var OPPORTUNITY_LEVELS = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  WATCH: 'WATCH'
};

var OPPORTUNITY_SPECIFICITY = {
  BRAND_ONLY: 'BRAND_ONLY',
  SPECIFIC_INTENT: 'SPECIFIC_INTENT',
  AMBIGUOUS: 'AMBIGUOUS'
};

/**
 * Intent 规则：按数组顺序优先匹配（更具体的意图放前面）。
 * 纯品牌词在 classify 时单独返回 BRAND，不依赖本表。
 */
var OPPORTUNITY_INTENT_RULES = [
  { intent: 'PLATFORM', terms: ['steam deck', 'ps5', 'xbox', 'nintendo switch', 'switch', 'mobile', 'android', 'ios', 'pc', 'console'] },
  { intent: 'SYSTEM_REQUIREMENTS', terms: ['system requirements', 'sys req', 'requirements', 'specs'] },
  { intent: 'SAVE_PROGRESS', terms: ['carry over', 'carryover', 'save file', 'save', 'progress'] },
  { intent: 'REWARD', terms: ['rewards', 'reward', 'bonus'] },
  { intent: 'MISSION', terms: ['first mission', 'missions', 'mission', 'quests', 'quest'] },
  { intent: 'GUIDE', terms: ['walkthrough', 'tutorial', 'guide', 'wiki', 'how to'] },
  { intent: 'GAMEPLAY', terms: ['gameplay'] },
  { intent: 'RELEASE', terms: ['release date', 'release', 'launch date', 'launch', 'coming out'] },
  { intent: 'DOWNLOAD', terms: ['download', 'downloads'] },
  { intent: 'BUG_FIX', terms: ['bug fix', 'bugs', 'bug', 'crash', 'crashes', 'error', 'fix'] },
  { intent: 'BOSS', terms: ['bosses', 'boss'] },
  { intent: 'ITEM', terms: ['weapons', 'weapon', 'items', 'item'] },
  { intent: 'CHARACTER', terms: ['characters', 'character'] },
  { intent: 'LOCATION', terms: ['locations', 'location', 'maps', 'map'] }
];

var OPPORTUNITY_INTENT = {
  BRAND: 'BRAND',
  GUIDE: 'GUIDE',
  GAMEPLAY: 'GAMEPLAY',
  PLATFORM: 'PLATFORM',
  RELEASE: 'RELEASE',
  SYSTEM_REQUIREMENTS: 'SYSTEM_REQUIREMENTS',
  MISSION: 'MISSION',
  ITEM: 'ITEM',
  CHARACTER: 'CHARACTER',
  LOCATION: 'LOCATION',
  BOSS: 'BOSS',
  SAVE_PROGRESS: 'SAVE_PROGRESS',
  REWARD: 'REWARD',
  BUG_FIX: 'BUG_FIX',
  DOWNLOAD: 'DOWNLOAD',
  OTHER: 'OTHER'
};

/** 内容机会 Sheet 显示层：内部英文 enum → 中文，不参与判断 */
var OPPORTUNITY_INTENT_LABELS = {
  BRAND: '品牌词',
  GUIDE: '攻略',
  GAMEPLAY: '游戏玩法',
  PLATFORM: '平台',
  RELEASE: '发售',
  SYSTEM_REQUIREMENTS: '系统配置',
  MISSION: '任务',
  ITEM: '道具',
  CHARACTER: '角色',
  LOCATION: '地点',
  BOSS: 'Boss',
  SAVE_PROGRESS: '存档进度',
  REWARD: '奖励',
  BUG_FIX: 'Bug修复',
  DOWNLOAD: '下载',
  OTHER: '其他'
};

var OPPORTUNITY_SPECIFICITY_LABELS = {
  BRAND_ONLY: '仅品牌',
  SPECIFIC_INTENT: '明确意图',
  AMBIGUOUS: '模糊意图'
};

var OPPORTUNITY_LEVEL_LABELS = {
  HIGH: '高',
  MEDIUM: '中',
  WATCH: '观察'
};

var OPPORTUNITY_ACTION_LABELS = {
  RESEARCH_EXPAND_EXISTING: '研究并扩充现有页面',
  RESEARCH_NEW_CONTENT: '研究新内容',
  WATCH: '继续观察',
  IGNORE_BRAND: '忽略品牌词'
};

/**
 * Research Job 出口：内容机会 → 标准 Job 记录。
 * 内部 enum 英文；Sheet 显示层中文。不抓取外部源、不调用 hotword-engine。
 */
var RESEARCH_JOB_HEADERS = [
  '任务ID', '创建时间', '站点', '游戏',
  '搜索词 / topic', '页面路径',
  '机会等级', '建议动作', 'source_query', '任务状态',
  '关联搜索词',
  '研究结果', '证据数量', '结果路径', '完成时间', '错误信息',
  '审核摘要', '审核链接'
];

/**
 * Human Gate：Research 证据明细（运营在 Sheet 内审核，无需下载 JSON）。
 * 按 job_id 幂等替换；每条 evidence 一行。
 */
var RESEARCH_REVIEW_HEADERS = [
  '任务ID', '站点', '游戏', '搜索词 / topic', '页面路径',
  '来源', '发现主题', '玩家问题', '证据摘录', '来源链接',
  '相关度', '研究时间'
];

/** evidence.source → Sheet「来源」显示 */
var RESEARCH_EVIDENCE_SOURCE_LABELS = {
  youtube: 'YouTube',
  reddit: 'Reddit',
  steam: 'Steam'
};

/** Sheet「证据摘录」最大字符数（含省略号） */
var RESEARCH_EVIDENCE_EXCERPT_MAX = 800;

var RESEARCH_JOB_STATUS = {
  PENDING: 'PENDING',
  REVIEW: 'REVIEW',
  FAILED: 'FAILED'
};

var RESEARCH_JOB_STATUS_LABELS = {
  PENDING: '待处理',
  REVIEW: '待审核',
  FAILED: '失败'
};

/** hotword-engine 回写的研究结果建议（与内容机会「建议动作」不同） */
var RESEARCH_RESULT_RECOMMENDATIONS = {
  EXPAND_EXISTING: 'EXPAND_EXISTING',
  NEW_CONTENT: 'NEW_CONTENT',
  WATCH: 'WATCH'
};

var RESEARCH_RESULT_RECOMMENDATION_LABELS = {
  EXPAND_EXISTING: '扩充现有页面',
  NEW_CONTENT: '新内容',
  WATCH: '继续观察'
};

/** Script Properties key；值不进仓库 */
var RESEARCH_JOB_WRITE_TOKEN_PROP = 'RESEARCH_JOB_WRITE_TOKEN';

/** 内容机会「研究状态」显示层（创建 Job 后回写） */
var RESEARCH_STATUS_LABELS = {
  TODO: '待研究'
};

/** 允许从内容机会创建 Research Job 的建议动作（内部 enum） */
var RESEARCH_JOB_ELIGIBLE_ACTIONS = {
  RESEARCH_EXPAND_EXISTING: true,
  RESEARCH_NEW_CONTENT: true
};

/** job_id 前缀；未知游戏回退为站点名 slug */
var RESEARCH_GAME_SLUGS = {
  'Mortal Shell II': 'ms2',
  'Approximately Up': 'au',
  'Leafy Corner': 'leafy',
  'BeastLink': 'beastlink',
  'Sovereign Tower': 'sovtower',
  'Grain Rot': 'grainrot',
  'Agefield High: Rock the School': 'agefield'
};

/**
 * Opportunity Level 阈值（集中配置，禁止散落 magic numbers）。
 * position 使用 GSC AveragePosition（越小越好）。
 */
var OPPORTUNITY_THRESHOLDS = {
  HIGH_MIN_CLICKS: 1,
  HIGH_MIN_IMPRESSIONS: 3,
  HIGH_POS_MIN: 4,
  HIGH_POS_MAX: 30,
  MEDIUM_MIN_IMPRESSIONS: 1,
  WATCH_POS_FAR: 40,
  REPEAT_SEEN_DAYS_BOOST: 2
};

/** 视为游戏 Hub / 泛承接的单段 path slug（不含 /） */
var OPPORTUNITY_HUB_SLUGS = {
  '': true,
  index: true,
  home: true,
  hub: true,
  guides: true,
  guide: true,
  wiki: true,
  browse: true,
  category: true,
  categories: true
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

/**
 * GSC Search Analytics 的数据日边界时区（官方口径）。
 * 脚本项目时区仍为 Asia/Shanghai（RunDate / Trigger），二者不可混用。
 */
var GSC_TIMEZONE = 'America/Los_Angeles';

/** 首次 setup 时预填的站点（Day0 留空；已有「站点配置」数据时不会覆盖） */
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
  },
  {
    name: 'Agent 64: Spies Never Die',
    propertyUrl: 'https://agent-64.vercel.app/'
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

/**
 * Fresh Query 明细：覆盖最近 N 个 GSC 自然日（America/Los_Angeles，含今天），
 * 使用 dataState=all，允许后续补数。取 5 天以覆盖常见延迟窗口。
 */
var FRESH_QUERY_DAYS = 5;

/** 每次 runIndexAuditBatch 最多完整 Inspection 的站点数 */
var INDEX_AUDIT_BATCH_SIZE = 2;

/** runIndexAuditBatch 一天内 4 次 trigger 的大致时段（Asia/Shanghai） */
var INDEX_AUDIT_TRIGGER_HOURS = [9, 12, 15, 20];
