/**
 * 站点配置与常量
 * Day0 请在「站点配置」Sheet 中由用户自行填写，不要在此硬编码。
 */

var SHEET_NAMES = {
  USAGE: '使用说明',
  METRICS: '指标说明',
  SITES: '站点配置',
  SNAPSHOT: '每日快照',
  DAILY: 'GSC日数据',
  QUERIES: 'Query明细',
  PAGES: 'Page明细',
  QUERY_PAGES: 'Query页面明细',
  URL_INDEX: 'URL索引',
  LOG: '运行日志',
  RULES: '规则配置',
  SITE_STATUS: '站点状态',
  DECISION_HISTORY: '决策历史',
  DECISION_OUTCOMES: '决策结果',
  FEEDBACK_SAMPLES: '反馈样本',
  RULE_SCORECARD: '规则评分卡',
  EVALUATION_ELIGIBILITY: '评价资格',
  OUTCOME_DELTA: '效果变化',
  EFFECT_EVALUATION: '效果评价',
  PORTFOLIO: '站点经营',
  WINNER_ASSETS: '内容资产',
  TODAY_ACTIONS: '今日行动',
  OPPORTUNITIES: '内容机会',
  RESEARCH_JOBS: '研究任务',
  RESEARCH_REVIEW: '研究审核',
  DEVELOPMENT_TASKS: '开发任务',
  CONTENT_UPDATES: '内容更新记录',
  /** 旧/实验层：仅用于识别与隐藏，setup 不会创建 */
  PAGE_OPPORTUNITIES: 'PAGE_OPPORTUNITIES'
};

/**
 * Decision Engine 规则版本。规则逻辑实质变化时人工升级；普通数据变化不升级。
 * M2-1：只标记，不改变任何阈值/打分。
 */
var DECISION_RULE_VERSION = 'gsc-decision-v1.0';

/**
 * 面向人的 Sheet 顺序（存在才排列；不存在不创建，除「使用说明」「指标说明」由 ensure* 负责）。
 * 后台数据靠后；旧实验页放建议顺序末尾。
 */
var SHEET_UI_ORDER = [
  SHEET_NAMES.USAGE,
  SHEET_NAMES.METRICS,
  SHEET_NAMES.TODAY_ACTIONS,
  SHEET_NAMES.SNAPSHOT,
  SHEET_NAMES.OPPORTUNITIES,
  SHEET_NAMES.RESEARCH_JOBS,
  SHEET_NAMES.RESEARCH_REVIEW,
  SHEET_NAMES.SITE_STATUS,
  SHEET_NAMES.PORTFOLIO,
  SHEET_NAMES.WINNER_ASSETS,
  SHEET_NAMES.DECISION_HISTORY,
  SHEET_NAMES.DECISION_OUTCOMES,
  SHEET_NAMES.FEEDBACK_SAMPLES,
  SHEET_NAMES.RULE_SCORECARD,
  SHEET_NAMES.EVALUATION_ELIGIBILITY,
  SHEET_NAMES.OUTCOME_DELTA,
  SHEET_NAMES.EFFECT_EVALUATION,
  SHEET_NAMES.RULES,
  SHEET_NAMES.DAILY,
  SHEET_NAMES.QUERIES,
  SHEET_NAMES.PAGES,
  SHEET_NAMES.QUERY_PAGES,
  SHEET_NAMES.URL_INDEX,
  SHEET_NAMES.LOG,
  SHEET_NAMES.PAGE_OPPORTUNITIES
];

/** 「指标说明」表头（与 Steam 工作簿对齐） */
var METRIC_GUIDE_HEADERS = [
  '指标/字段',
  '主要出现位置',
  '类型',
  '数据来源',
  '当前口径/公式',
  '业务用途',
  '是否参与自动判断',
  '当前标准/阈值',
  '标准来源',
  '当前成熟度',
  'PM 注意事项'
];

/** 建议顺序之外、仍由系统管理的 Sheet，固定放到 PAGE_OPPORTUNITIES 之后 */
var SHEET_UI_TRAILING_ORDER = [
  SHEET_NAMES.SITES,
  SHEET_NAMES.DEVELOPMENT_TASKS,
  SHEET_NAMES.CONTENT_UPDATES
];

/** 旧/实验 Tab：只隐藏，不删除数据、不删除代码依赖 */
var SHEET_UI_HIDDEN = [SHEET_NAMES.PAGE_OPPORTUNITIES];

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
/** Fresh page-only 维度；Winner Page 事实源。rowLimit 仍用 QUERY_ROW_LIMIT */
var PAGE_HEADERS = [
  'DataDate', 'Site', 'PageURL', 'PagePath',
  'Clicks', 'Impressions', 'CTR', 'Position'
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

/**
 * 站点经营（Portfolio / Investment Layer）。
 * 显示层中文；InvestmentTier / PortfolioAction / WinnerIntent 单元格仍写英文 enum。
 * 不替代 RecommendedAction，不改 DomainScore。
 */
var PORTFOLIO_HEADERS = [
  '运行日期',
  '站点',
  '投入档位',
  '经营动作',
  '赢家页面',
  '赢家意图',
  '赢家页点击7日',
  '赢家页曝光7日',
  '攻略查询数7日',
  '意图类别数',
  '点击7日',
  '曝光7日',
  'Top20查询数',
  'DomainScore',
  '最近内容更新',
  '人工经营决定',
  '人工原因',
  '下次复盘日期'
];

var INVESTMENT_TIER = {
  T0_TEST: 'T0_TEST',
  T1_TRACTION: 'T1_TRACTION',
  T2_WINNER: 'T2_WINNER',
  FROZEN: 'FROZEN'
};

var PORTFOLIO_ACTION = {
  INVEST: 'INVEST',
  HOLD: 'HOLD',
  FREEZE: 'FREEZE'
};

/** B1 经营层实验阈值（偏保守；不是 Google / SEO 官方标准） */
var PORTFOLIO_V1 = {
  TRACTION_MIN_IMPRESSIONS_7D: 30,
  INTENT_BREADTH_MIN: 3,
  FREEZE_MIN_DAY: 21,
  WINNER_LEAD_RATIO: 1.5,
  REVIEW_EVERY_DAYS: 7
};

/** B2 内容资产候选层 enum（单元格仍写英文） */
var ASSET_TYPE = {
  VERIFIED_GUIDE: 'VERIFIED_GUIDE',
  ANSWER_DATABASE: 'ANSWER_DATABASE',
  COMPARISON_MATRIX: 'COMPARISON_MATRIX',
  CHECKLIST: 'CHECKLIST',
  STATS_TABLE: 'STATS_TABLE',
  TIMELINE: 'TIMELINE',
  OTHER: 'OTHER'
};

var ASSET_LEVEL = {
  NORMAL_PAGE: 'NORMAL_PAGE',
  EVIDENCE_PAGE: 'EVIDENCE_PAGE',
  LINKABLE_ASSET: 'LINKABLE_ASSET'
};

var ASSET_EVIDENCE_STATUS = {
  UNKNOWN: 'UNKNOWN',
  PARTIAL: 'PARTIAL',
  READY: 'READY'
};

var ASSET_HUMAN_DECISION = {
  TODO: 'TODO',
  APPROVE: 'APPROVE',
  HOLD: 'HOLD',
  SKIP: 'SKIP'
};

var ASSET_STATUS = {
  CANDIDATE: 'CANDIDATE',
  RESEARCH: 'RESEARCH',
  READY: 'READY',
  DONE: 'DONE',
  ARCHIVED: 'ARCHIVED'
};

/** 已进入人工流程的状态；重复运行时不覆盖 Status */
var ASSET_LOCKED_STATUSES = {
  RESEARCH: true,
  READY: true,
  DONE: true,
  ARCHIVED: true
};

var ASSET_HUMAN_DECISION_LABELS = {
  TODO: '待处理',
  APPROVE: '批准研究',
  HOLD: '暂缓',
  SKIP: '跳过'
};

var ASSET_HUMAN_DECISION_OPTIONS = [
  ASSET_HUMAN_DECISION_LABELS.TODO,
  ASSET_HUMAN_DECISION_LABELS.APPROVE,
  ASSET_HUMAN_DECISION_LABELS.HOLD,
  ASSET_HUMAN_DECISION_LABELS.SKIP
];

/**
 * 内容资产（Winner Asset Candidate Layer）。
 * 只读「站点经营」；人工决定后由 processWinnerAssetDecisions 创建标准 Research Job。
 * 后两列只能追加在末尾，不得移动前 19 列。
 */
var WINNER_ASSET_HEADERS = [
  '生成时间',
  '站点',
  '赢家页面',
  '赢家意图',
  '赢家页点击7日',
  '赢家页曝光7日',
  '攻略查询数7日',
  '意图类别数',
  '资产候选类型',
  '资产候选标题',
  '候选理由',
  '当前资产级别',
  '证据状态',
  '缺失证据',
  '人工决定',
  '人工备注',
  '状态',
  '创建时间',
  '更新时间',
  '研究任务ID',
  '研究请求时间'
];

/**
 * Decision Snapshot（append-only）。只记录真正进入「今日行动」的判断。
 * 不含 D7/D14/D30 / Outcome（后续 M2）。
 */
var DECISION_HISTORY_HEADERS = [
  'DecisionID',
  'RunDate',
  'DecisionDataDate',
  'Site',
  'RuleVersion',
  'Day',
  'IndexedURLCount',
  'IndexRate',
  'Impressions24H',
  'Impressions7D',
  'Previous3DImpressions',
  'Latest3DImpressions',
  'Growth3D',
  'QueryCount7D',
  'GuideQueryCount7D',
  'Top50QueryCount',
  'Top30QueryCount',
  'Top20QueryCount',
  'Clicks7D',
  'IntentCategoryCount',
  'TractionScore',
  'QueryScore',
  'MomentumScore',
  'ExpansionScore',
  'RiskScore',
  'DomainScore',
  'LifecycleStage',
  'RecommendedAction',
  'Priority',
  'Reason',
  'HumanDecision',
  'HumanNote',
  'RecordedAt',
  // M3-3：与 Outcome 同口径的决策前 7D Baseline（追加在末尾，不移动既有列）
  'BaselineStartDate',
  'BaselineEndDate',
  'BaselineImpressions',
  'BaselineClicks',
  'BaselineQueryCount',
  'BaselineGuideQueryCount',
  'BaselineTop50QueryCount',
  'BaselineTop20QueryCount',
  'BaselineBestPosition'
];

/**
 * Decision Outcome Observation（append-only）。
 * 一个 DecisionID 最多 D7/D14/D30 三条；不含 DomainScore 等内部模型字段。
 */
var DECISION_OUTCOME_HEADERS = [
  'DecisionID',
  'Site',
  'RuleVersion',
  'RecommendedAction',
  'DecisionDataDate',
  'Horizon',
  'TargetDate',
  'ObservedDataDate',
  'ObservationStatus',
  'ImpressionsWindow',
  'ClicksWindow',
  'QueryCount',
  'GuideQueryCount',
  'Top50QueryCount',
  'Top20QueryCount',
  'BestPosition',
  'IndexedURLCount',
  'IndexRate',
  'ObservedAt'
];

/** Outcome 观察地平线：天数相对 DecisionDataDate */
var DECISION_OUTCOME_HORIZONS = [
  { name: 'D7', days: 7 },
  { name: 'D14', days: 14 },
  { name: 'D30', days: 30 }
];

var OBSERVATION_STATUS = {
  PENDING: 'PENDING',
  OBSERVED: 'OBSERVED',
  DATA_MISSING: 'DATA_MISSING'
};

/**
 * 反馈样本（派生分析视图，可 rebuild）。
 * 一条 DecisionID 一行；不复制全部 Snapshot / Outcome 字段。
 */
var FEEDBACK_SAMPLE_HEADERS = [
  'DecisionID',
  'DecisionDataDate',
  'Site',
  'RuleVersion',
  'RecommendedAction',
  'Priority',
  'DomainScore',
  'HumanDecision',
  'HumanNote',
  'InterventionCount',
  'InterventionPages',
  'FirstInterventionDate',
  'LastInterventionDate',
  'InterventionTypes',
  'D7Status',
  'D7Impressions',
  'D7Clicks',
  'D7GuideQueries',
  'D7BestPosition',
  'D14Status',
  'D14Impressions',
  'D14Clicks',
  'D14GuideQueries',
  'D14BestPosition',
  'D30Status',
  'D30Impressions',
  'D30Clicks',
  'D30GuideQueries',
  'D30BestPosition',
  'SampleStatus',
  'UpdatedAt'
];

/** SampleStatus：事实阶段，不是成功/失败标签 */
var FEEDBACK_SAMPLE_STATUS = {
  WAITING_HUMAN: 'WAITING_HUMAN',
  SKIPPED: 'SKIPPED',
  HANDLED_NO_INTERVENTION: 'HANDLED_NO_INTERVENTION',
  INTERVENTION_PENDING_OUTCOME: 'INTERVENTION_PENDING_OUTCOME',
  D7_OBSERVED: 'D7_OBSERVED',
  D14_OBSERVED: 'D14_OBSERVED',
  D30_OBSERVED: 'D30_OBSERVED'
};

/**
 * 规则评分卡（派生分析视图，可 rebuild）。
 * 一行一个 RuleVersion；只做样本计数，不做成功/失败评价。
 */
var RULE_SCORECARD_HEADERS = [
  'RuleVersion',
  'DecisionCount',
  'WaitingHumanCount',
  'DoneCount',
  'SkipCount',
  'InterventionDecisionCount',
  'InterventionRecordCount',
  'D7ObservedCount',
  'D14ObservedCount',
  'D30ObservedCount',
  'LatestDecisionDataDate',
  'UpdatedAt'
];

/**
 * 评价资格（派生视图，可 rebuild）。
 * 一 DecisionID 一行；只判定 Intervention Evaluation Eligibility，不做成败评价。
 */
var EVALUATION_ELIGIBILITY_HEADERS = [
  'DecisionID',
  'RuleVersion',
  'DecisionDataDate',
  'Site',
  'HumanDecision',
  'InterventionCount',
  'D7Observed',
  'D14Observed',
  'D30Observed',
  'D7Eligibility',
  'D14Eligibility',
  'D30Eligibility',
  'ExclusionReason',
  'UpdatedAt'
];

/** 事实资格状态（禁止价值判断词） */
var EVALUATION_ELIGIBILITY = {
  ELIGIBLE: 'ELIGIBLE',
  PENDING: 'PENDING',
  EXCLUDED: 'EXCLUDED'
};

var EVALUATION_EXCLUSION_REASON = {
  WAITING_HUMAN: 'WAITING_HUMAN',
  SKIPPED: 'SKIPPED',
  NO_INTERVENTION: 'NO_INTERVENTION'
};

/**
 * 效果变化（派生分析视图，可 rebuild）。
 * 一 DecisionID 一行；只描述 Baseline→Horizon 指标变化，不做成败评价。
 */
var OUTCOME_DELTA_HEADERS = [
  'DecisionID',
  'RuleVersion',
  'DecisionDataDate',
  'Site',
  'HumanDecision',
  'InterventionCount',
  'BaselineImpressions',
  'BaselineClicks',
  'BaselineGuideQueries',
  'BaselineBestPosition',
  'D7Status',
  'D7Impressions',
  'D7ImpressionsDelta',
  'D7ImpressionsDeltaPct',
  'D7Clicks',
  'D7ClicksDelta',
  'D7ClicksDeltaPct',
  'D7GuideQueries',
  'D7GuideQueriesDelta',
  'D7GuideQueriesDeltaPct',
  'D7BestPosition',
  'D7PositionImprovement',
  'D14Status',
  'D14Impressions',
  'D14ImpressionsDelta',
  'D14ImpressionsDeltaPct',
  'D14Clicks',
  'D14ClicksDelta',
  'D14ClicksDeltaPct',
  'D14GuideQueries',
  'D14GuideQueriesDelta',
  'D14GuideQueriesDeltaPct',
  'D14BestPosition',
  'D14PositionImprovement',
  'D30Status',
  'D30Impressions',
  'D30ImpressionsDelta',
  'D30ImpressionsDeltaPct',
  'D30Clicks',
  'D30ClicksDelta',
  'D30ClicksDeltaPct',
  'D30GuideQueries',
  'D30GuideQueriesDelta',
  'D30GuideQueriesDeltaPct',
  'D30BestPosition',
  'D30PositionImprovement',
  'UpdatedAt'
];

/** 效果变化 Horizon 数据存在状态（不是评价资格） */
var OUTCOME_DELTA_STATUS = {
  OBSERVED: 'OBSERVED',
  PENDING: 'PENDING'
};

/**
 * 效果评价（派生 cohort / readiness + Evidence Contract 视图，可 rebuild）。
 * 只定义是否可进入 Intervention Effect Evaluation、当前 Horizon、以及证据是否足以进入后续效果方向分类；
 * 不做成败评价，不产出 IMPROVED / SUCCESS 等效果标签。
 */
var EFFECT_EVALUATION_HEADERS = [
  'DecisionID',
  'RuleVersion',
  'DecisionDataDate',
  'Site',
  'HumanDecision',
  'InterventionCount',
  'EvaluationStatus',
  'EvaluationHorizon',
  'ComparableMetricCount',
  'ImpressionsComparable',
  'ClicksComparable',
  'GuideQueriesComparable',
  'BestPositionComparable',
  'EvidenceStatus',
  'EvidenceReason',
  'UpdatedAt'
];

var EFFECT_EVALUATION_STATUS = {
  EXCLUDED: 'EXCLUDED',
  PENDING: 'PENDING',
  READY: 'READY'
};

/** Evidence Contract V1：是否具备进入效果方向分类的最低证据（非效果好坏）。 */
var EFFECT_EVIDENCE_STATUS = {
  NOT_READY: 'NOT_READY',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  COMPARABLE: 'COMPARABLE'
};

var EFFECT_EVIDENCE_REASON = {
  TOO_FEW_COMPARABLE_METRICS: 'TOO_FEW_COMPARABLE_METRICS',
  LOW_SEARCH_VOLUME: 'LOW_SEARCH_VOLUME'
};

/**
 * 项目 V1 实验阈值（非 Google / SEO 官方标准）。
 * MIN_COMPARABLE_METRICS：至少 2 个可比指标。
 * MIN_IMPRESSIONS_VOLUME / MIN_GUIDE_QUERIES_VOLUME：Search Demand 规模门槛（取 max(Baseline, Outcome)）。
 */
var EFFECT_EVIDENCE_V1 = {
  MIN_COMPARABLE_METRICS: 2,
  MIN_IMPRESSIONS_VOLUME: 10,
  MIN_GUIDE_QUERIES_VOLUME: 3
};

var TODAY_ACTION_HEADERS = [
  'Date', 'Priority', 'Site', 'LifecycleStage', 'RecommendedAction',
  'DomainScore', 'Reason', 'Status', '人工备注', 'DecisionID'
];
var TODAY_ACTION_STATUSES = ['TODO', 'DONE', 'SKIP'];
/** 可同步回决策历史的终态 */
var TODAY_ACTION_HUMAN_SYNC_STATUSES = {
  DONE: true,
  SKIP: true
};
var TODAY_ACTION_EXCLUDED = {
  NO_ACTION: true,
  WAIT: true
};

/**
 * 内容更新记录 = Content Intervention 权威事实表。
 * 用于 CONTENT_OPTIMIZE / Research Job 观察期冷却；也可绑定 DecisionID。
 * 页面路径为空 = 整站更新。
 * DecisionID / 更新类型追加在末尾，不移动 cooldown 依赖的前 5 列。
 */
var CONTENT_UPDATE_HEADERS = [
  '更新时间', '站点', '页面路径', '来源', '更新说明', '更新类型', 'DecisionID'
];

/**
 * 内容 intervention 更新类型（可选；旧记录可为空）。
 * 与 Decision RecommendedAction 可同名，但此处表示「实际改站动作」，不是推荐。
 */
var CONTENT_INTERVENTION_TYPES = {
  CONTENT_OPTIMIZE: 'CONTENT_OPTIMIZE',
  CONTENT_EXPAND: 'CONTENT_EXPAND',
  INTERNAL_LINK: 'INTERNAL_LINK',
  INDEX_FIX: 'INDEX_FIX',
  OTHER: 'OTHER'
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
  '审核摘要', '审核链接',
  '审核决定', '审核备注', '审核时间',
  '研究类型'
];

/** 研究任务来源类型（单元格写英文；旧行空值视为 CONTENT_RESEARCH） */
var RESEARCH_TYPE = {
  CONTENT_RESEARCH: 'CONTENT_RESEARCH',
  ASSET_RESEARCH: 'ASSET_RESEARCH'
};

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
  WATCH: 'WATCH',
  FAILED: 'FAILED',
  APPROVED: 'APPROVED',
  ARCHIVED: 'ARCHIVED'
};

var RESEARCH_JOB_STATUS_LABELS = {
  PENDING: '待处理',
  REVIEW: '待审核',
  WATCH: '继续观察',
  FAILED: '失败',
  APPROVED: '已批准',
  ARCHIVED: '已归档'
};

/**
 * Human Review Gate：运营在「研究任务」填写的审核决定。
 * 内部 enum 英文；Sheet 下拉与显示层中文。
 */
var RESEARCH_REVIEW_DECISION = {
  APPROVE: 'APPROVE',
  WATCH: 'WATCH',
  NO_ACTION: 'NO_ACTION'
};

var RESEARCH_REVIEW_DECISION_LABELS = {
  APPROVE: '批准开发',
  WATCH: '继续观察',
  NO_ACTION: '无需处理'
};

/** Sheet「审核决定」下拉选项（中文，顺序固定） */
var RESEARCH_REVIEW_DECISION_OPTIONS = [
  RESEARCH_REVIEW_DECISION_LABELS.APPROVE,
  RESEARCH_REVIEW_DECISION_LABELS.WATCH,
  RESEARCH_REVIEW_DECISION_LABELS.NO_ACTION
];

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

/**
 * M3：已批准研究任务 → 开发任务队列。
 * 不调用 Codex、不改网站；仅写「开发任务」Sheet。
 */
var DEVELOPMENT_TASK_HEADERS = [
  '开发任务ID', '创建时间', '来源任务ID', '站点', '游戏', '页面路径',
  '开发目标', 'Evidence链接', '优先级', '任务状态', '完成时间', '备注'
];

var DEVELOPMENT_TASK_STATUS = {
  TODO: 'TODO',
  DONE: 'DONE',
  SKIPPED: 'SKIPPED'
};

var DEVELOPMENT_TASK_STATUS_LABELS = {
  TODO: '待开发',
  DONE: '已完成',
  SKIPPED: '已跳过'
};

/** 开发目标显示层（短中文，非 Codex prompt） */
var DEVELOPMENT_GOAL_LABELS = {
  EXPAND_EXISTING: '扩充现有页面',
  NEW_PAGE: '新建页面',
  UPDATE_EXISTING: '更新现有页面'
};

var DEVELOPMENT_PRIORITY_LABELS = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低'
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
  ['ACTION_COOLDOWN_DAYS', 3, '同站点同动作完成后多少天内不重复提醒'],
  ['CONTENT_UPDATE_COOLDOWN_DAYS', 3, '内容更新后多少天内不再建议 CONTENT_OPTIMIZE / 不重复创建 Research Job']
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
  { key: 'platform', terms: ['platform', 'console', 'ps5', 'xbox', 'switch'] },
  {
    key: 'save_progress',
    terms: ['carry over', 'carries over', 'carryover', 'save file', 'save', 'progress']
  },
  { key: 'reward', terms: ['rewards', 'reward'] }
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

/**
 * 「指标说明」数据字典行（只解释，不参与计算）。
 * 列顺序同 METRIC_GUIDE_HEADERS。
 * @return {Array<Array<string>>}
 */
function getMetricGuideRows_() {
  return [
    [
      'Day0',
      '站点配置 / 每日快照 / 站点状态',
      '人工配置',
      '站点配置（人工填写）',
      '该站点开始实验观察的基准日历日',
      '作为 Day 计算与跨站对比的起点',
      '是（Day / ARCHIVE / Domain 天数门槛）',
      '由 PM 按站点填写；留空则 Day 为空',
      '热词站项目配置',
      '人工判断',
      '不同站点必须按 Day 比较，不要直接比“今天的绝对曝光/点击”。'
    ],
    [
      'Day',
      '每日快照 / 站点状态 / 今日行动',
      '系统计算',
      '系统公式（基于 Day0 与截止日）',
      'calcDayNumber_：截止日 − Day0 + 1；Decision 优先用 DecisionDataDate，否则 RunDate；若快照已有 Day 可覆盖',
      '站点实验天数；参与 ARCHIVE / Domain 最早天数等规则',
      '是',
      'ARCHIVE 最早 Day≥14（ARCHIVE_MIN_DAY）；非 Fast Track 域名动作最早 Day≥3',
      '确定性计算 + 项目规则阈值',
      '较稳定',
      '若 Day0 晚于截止日，可能出现 0 或负数；见待后续验证事项。不要把 Day 当成 Google 指标。'
    ],
    [
      'Clicks',
      '每日快照 / GSC日数据 / Query明细 / Page明细 / Query页面明细 / 内容机会',
      '原始事实',
      'Google Search Console Search Analytics API',
      'GSC 直接返回的 clicks',
      '真实点击量；参与 Content Opportunity / Domain 部分信号',
      '是（部分决策与机会分级）',
      '无项目重算；CONTENT_OPTIMIZE 等规则见规则配置',
      '外部事实（Google Search Console）',
      '稳定',
      '这是 Google 原始数据，不是项目打分。'
    ],
    [
      'Impressions',
      '每日快照 / GSC日数据 / Query明细 / Page明细 / Query页面明细 / 内容机会',
      '原始事实',
      'Google Search Console Search Analytics API',
      'GSC 直接返回的 impressions',
      '搜索结果中出现次数；窗口汇总后进入 Domain Score',
      '是',
      '窗口汇总阈值见 Impressions7D / TractionScore 等',
      '外部事实（Google Search Console）',
      '稳定',
      'Impression = 出现在搜索结果中，不等于用户点击。'
    ],
    [
      'CTR',
      '每日快照 / GSC日数据 / Query明细 / Page明细 / Query页面明细 / 内容机会',
      '原始事实',
      'Google Search Console Search Analytics API',
      'GSC API 返回的 ctr 字段（非本地 Clicks÷Impressions 重算）',
      '点击率观察；内容机会表展示',
      '否（当前 Decision 不直接用 CTR 阈值）',
      '无项目 CTR 阈值',
      '外部事实（Google Search Console）',
      '稳定',
      '以 GSC 返回值为准；不要自行用本地除法“纠正”后当事实。'
    ],
    [
      'Average Position',
      '每日快照 / GSC日数据 / Query明细 / Page明细 / Query页面明细 / 内容机会',
      '原始事实',
      'Google Search Console Search Analytics API',
      'GSC 返回的 position（平均排名；数值越小越好）',
      '观察排名区间；TopN Query 与机会 HIGH 带用到 best/平均 position',
      '是（Top20/30/50 与 Opportunity HIGH 带）',
      'Top20/30/50：best position≤20/30/50；HIGH 带：position 4–30（OPPORTUNITY_THRESHOLDS）',
      '外部事实（GSC）+ 项目观察分组',
      '较稳定',
      '这是平均排名指标，不要简单理解成“固定排在第 N 名”。'
    ],
    [
      'Query',
      'Query明细 / Query页面明细 / 内容机会',
      '原始事实',
      'Google Search Console Search Analytics API',
      'GSC 返回的真实搜索词字符串',
      '内容机会与 Guide Query 分类的输入',
      '是（派生指标输入）',
      '无',
      '外部事实（Google Search Console）',
      '稳定',
      'Query 本身是 Google 原始词；Guide Query / 搜索意图 / 品牌词是项目分类，不是 Google 标签。'
    ],
    [
      'Landing Page / Page',
      'Page明细 / Query页面明细 / 内容机会',
      '原始事实',
      'Google Search Console（page 维度 / Query × Page 维度）',
      'Page明细：page-only 的 URL/Path。Query页面明细：承接该 Query 的页面 URL/Path',
      'Page明细用于 Winner Page；Query×Page 用于核对词落到了哪个页',
      '是（经营层 Winner Page；Opportunity 动作）',
      'Hub / 相关 Guide 路径规则见 Opportunity Engine',
      '外部事实（Google Search Console）',
      '较稳定',
      '页面归属是 GSC 事实；是否 Hub / 是否相关 Guide 是项目规则。Page-only 与 Query×Page 因隐私截断可能不一致。'
    ],
    [
      'Page明细',
      'Page明细 / 站点经营',
      '原始事实',
      'Google Search Console Search Analytics API（dimensions=page, dataState=all）',
      '按日 page-only 行：DataDate+Site+PageURL 唯一；Clicks/Impressions/CTR/Position 为 GSC 原始值',
      'Page Performance 事实源；Portfolio Winner Page 只读本表，不读 Query×Page',
      '是（经营层 Winner Page）',
      '每日滚动最近 FRESH_QUERY_DAYS=5 天；历史用 14 日补采',
      '外部事实（Google Search Console）',
      '实验中',
      'Query×Page 行数少不等于页面没有点击。Winner Page 必须以 Page明细为准。'
    ],
    [
      'RunDate',
      '每日快照 / 站点状态 / 今日行动 / URL索引 / 运行日志',
      '系统计算',
      '脚本运行日（项目时区 Asia/Shanghai）',
      '本次自动化脚本执行时写入的运行日期',
      '标记“这次跑批”的时间；不等于 GSC 数据日',
      '是（冷却、任务时间等）',
      '无业务表现阈值',
      '系统字段',
      '较稳定',
      'RunDate ≠ LatestGSCDataDate。不要把今天脚本结果当成“Google 今天的数据”。'
    ],
    [
      'LatestGSCDataDate',
      '每日快照',
      '系统计算',
      '基于已写入的 GSC 日数据取最新 DataDate',
      '当前工作簿中该站已获得的最新 GSC 数据日（受 GSC 延迟影响）',
      '告诉 PM Google 侧最新可用到哪一天',
      '间接（影响 Day / 快照解读）',
      'GSC 常见延迟数日；脚本 LOOKBACK 窗口有限',
      '外部数据可用性 + 系统取最新',
      '较稳定',
      '有延迟：脚本今天跑 ≠ Google 今天已出数。'
    ],
    [
      'DecisionDataDate',
      '站点状态',
      '系统计算',
      'Decision Engine：Daily 与 Query 两侧 latest 的较早者',
      'resolveDecisionDataDate_：两侧都有数据时取 min(最新日数据日, 最新 Query 日)；任一侧缺失则为空，且不对齐混算',
      '统一 Decision 指标截止日，避免不同时间截面混用',
      '是（所有对齐窗口指标）',
      '两侧缺一则 Decision 指标窗口为空/归零',
      '热词站项目对齐规则',
      '较稳定',
      'DecisionDataDate 是项目对齐日，不是 Google 单独返回的字段。'
    ],
    [
      'SitemapURLCount',
      '每日快照 / 站点状态',
      '原始事实',
      '站点 Sitemap URL 抓取解析',
      '当前 sitemap 中列出的 URL 数量',
      '索引率分母；健康度观察',
      '是（IndexRate / CHECK_INDEX）',
      '无固定“多少 URL 才合格”的 Google 标准',
      '外部读取（sitemap）',
      '较稳定',
      '这是 sitemap 列表规模，不是 Google 已收录总数。'
    ],
    [
      'IndexedURLCount',
      '每日快照 / 站点状态',
      '原始事实',
      'URL Inspection 历史（「URL索引」Sheet）',
      '按 URL 去重取最新 Verdict；仅 Verdict=PASS 计入。不是 GSC Coverage API 全站索引总数',
      '当前系统已检查 URL 的可用索引统计',
      '是（Domain Gate / CHECK_INDEX / RiskScore）',
      'Domain Gate 默认 ≥2（DOMAIN_MIN_INDEXED_URLS）',
      '外部 Inspection 抽样结果 + 系统聚合',
      '实验中',
      '不要当成 Google 给出的全站真实索引总数；未检查到的 URL 不会出现在统计里。'
    ],
    [
      'IndexRate',
      '每日快照 / 站点状态',
      '系统计算',
      'IndexedURLCount ÷ SitemapURLCount',
      'percent_(IndexedURLCount, SitemapURLCount)；sitemap=0 时为空',
      '粗略观察已检查 URL 的收录比例',
      '是（CHECK_INDEX；INDEX_RATE_WARNING）',
      'INDEX_RATE_WARNING 默认 0.5（50%）：低于则可能优先 CHECK_INDEX',
      '热词站项目当前实验参数（非 Google 官方异常线）',
      '实验中',
      '50% 不是 Google 官方异常标准，只是本项目实验阈值。'
    ],
    [
      'Impressions24H / Impressions7D',
      '站点状态',
      '系统计算',
      'GSC 日数据对齐 DecisionDataDate',
      '24H 字段名易误解：实际是截止日当天曝光。7D 是截止日往前共 7 天（含当天）曝光总和',
      'Fast Track / Traction / Domain Gate / ARCHIVE / CONTENT_OPTIMIZE',
      '是',
      'Fast Track 当天曝光≥300；Gate 7d≥30；ARCHIVE 7d≤10；CONTENT_OPTIMIZE 7d≥30',
      '确定性计算 + 项目规则阈值',
      '较稳定',
      '窗口锚定 DecisionDataDate，不是 RunDate；不要把 24H 理解成滚动 24 小时。'
    ],
    [
      'Previous3D / Latest3D Impressions',
      '站点状态',
      '系统计算',
      'GSC 日数据对齐窗口',
      'Latest3D：DecisionDataDate−2…截止日；Previous3D：截止日−5…截止日−3',
      'Growth3D 分子/分母',
      '是（Momentum）',
      '无独立业务阈值',
      '确定性计算',
      '较稳定',
      '必须同一 DecisionDataDate 截面比较。'
    ],
    [
      'Growth3D',
      '站点状态',
      '系统计算',
      'safeGrowth_(Latest3D, Previous3D)',
      'Previous3D>0 时 = Latest3D / Previous3D；否则 hasGrowth=false、值记 0，站点状态该格可留空（n/a）',
      'MomentumScore；RiskScore 增长加分条件',
      '是',
      'Momentum：>2→15；≥1.5→10；≥1.2→6；≥0.8→3；数据不足不加分也不处罚',
      '确定性计算 + 项目评分档位',
      '实验中',
      '分母为 0 时不是“增长 0”，而是数据不足。'
    ],
    [
      'QueryCount7D / GuideQueryCount7D',
      '站点状态',
      '系统计算',
      '真实 GSC Query → GUIDE_INTENT_CATEGORIES 匹配 → 聚合',
      'QueryCount7D：近 7 天不同 Query 数。GuideQueryCount7D：真实 GSC Query 经 GUIDE_INTENT_CATEGORIES 匹配攻略意图后聚合的条数（品牌纯词通常不计）',
      'QueryScore / Domain Gate / Fast Track / ARCHIVE',
      '是',
      'QueryScore：Guide≥10→25；≥5→17；≥3→10；≥1→5；Fast Track Guide≥5；Gate 默认≥2；ARCHIVE 要求 Guide=0',
      '热词站项目语义规则',
      '实验中',
      'Query 本身是 Google 原始数据，但“是否属于 Guide Query”是热词站项目自己的实验分类。'
    ],
    [
      'Top50 / Top30 / Top20 QueryCount',
      '站点状态',
      '系统计算',
      '近 7 天 Query 的 best AveragePosition 分组',
      'best position>0 且 ≤50 / ≤30 / ≤20 的去重 Query 数',
      'TractionScore 排名 bonus；Domain Gate（Top50>0）',
      '是',
      '观察分组，非 Google“机会区间”官方定义',
      '热词站项目观察层',
      '实验中',
      '不要把 Top20/30/50 说成 Google 官方机会区间。'
    ],
    [
      'IntentCategoryCount / ExpansionScore',
      '站点状态',
      '系统计算',
      '对当前项目识别出的攻略意图类别去重计数；再按 Expansion 档位打分',
      'IntentCategoryCount：近 7 天 Guide Query 命中多少个不同意图 key（去重）。ExpansionScore：类别数 ≥8→15；≥5→10；≥3→5',
      '判断需求是否扩展成多主题；DomainScore 子项',
      '是',
      'Expansion 档位见左',
      '热词站项目语义规则',
      '实验中',
      '意图类别本身由项目规则定义，不是 Google Search Console 原始分类。'
    ],
    [
      'TractionScore',
      '站点状态',
      '实验规则',
      'scoreTraction_（Impressions7D + TopN）',
      '7d 曝光档：≥1000→25；≥300→20；≥100→12；≥30→5；另 Top20+10 / 否则 Top30+6 / 否则 Top50+3；上限 35',
      'DomainScore 子项：流量牵引',
      '是（DomainScore）',
      '见左；上限 35',
      '热词站项目当前评分模型',
      '实验中',
      '不是 Google 指标；不要为刷分改内容。'
    ],
    [
      'QueryScore',
      '站点状态',
      '实验规则',
      'scoreQuery_(GuideQueryCount7D)',
      'Guide≥10→25；≥5→17；≥3→10；≥1→5；否则 0',
      'DomainScore 子项：攻略型需求',
      '是',
      '见左',
      '热词站项目当前评分模型',
      '实验中',
      '依赖 Guide 词表；词表实验中。'
    ],
    [
      'MomentumScore',
      '站点状态',
      '实验规则',
      'scoreMomentum_(hasGrowth, Growth3D)',
      '仅当 Growth 有效：>2→15；≥1.5→10；≥1.2→6；≥0.8→3；数据不足→0',
      'DomainScore 子项：短期动量',
      '是',
      '见左',
      '热词站项目当前评分模型',
      '实验中',
      '数据不足不加分也不扣分。'
    ],
    [
      'RiskScore',
      '站点状态',
      '实验规则',
      'scoreRisk_（当前为正向健康/信号加分，上限 10）',
      '索引达标且 IndexRate≥警告线 +2；Clicks7D>0 +2；Top30>0 +2；Guide≥5 +2；有效 Growth>1.2 +2',
      '计入 DomainScore 的加分项（尽管字段名含 Risk）',
      '是',
      '上限 10；阈值引用 Domain Gate / INDEX_RATE_WARNING 等',
      '热词站项目当前评分模型',
      '实验中',
      '字段名像“风险”，当前实现主要是健康与正信号加分，不是扣分风险项。不要当负面风险分理解。'
    ],
    [
      'DomainScore',
      '站点状态 / 今日行动',
      '实验规则',
      'Traction+Query+Momentum+Expansion+Risk 求和',
      '五子项相加；用于 DOMAIN_PREPARE / DOMAIN_UPGRADE 排序门槛',
      '内部资源配置与域名动作排序',
      '是',
      'PREPARE 默认≥60；UPGRADE 默认≥75（且过 Domain Gate 等）',
      '热词站项目当前评分模型',
      '实验中',
      '不是 Google 指标，也不是 SEO 行业标准。不要为提高 Domain Score 而刷分。'
    ],
    [
      'InvestmentTier / PortfolioAction',
      '站点经营',
      '实验规则',
      'classifyInvestmentTier_ / recommendPortfolioAction_（PORTFOLIO_V1）',
      'T0_TEST：无 traction。T1_TRACTION：有 traction 但无赢家页。T2_WINNER：近 7 天有真实点击且曝光/排名明显领先的页面。FROZEN：Day≥21 且仍无 traction。INVEST：T2 且意图类别≥3。HOLD：默认观察。FREEZE：仅 FROZEN 档。不看 RecommendedAction',
      '回答哪些站值得继续投入 / 只观察 / 冻结；与今日行动的 SEO Decision 独立',
      '是（只写「站点经营」，不改今日行动）',
      '曝光门槛 30；意图广度 3；冻结最早 Day 21；赢家领先比 1.5',
      '热词站项目 B1 经营层实验参数',
      '实验中',
      '不是 Google 指标。PortfolioAction=HOLD 可以与 RecommendedAction=DOMAIN_UPGRADE 同时成立。'
    ],
    [
      'WinnerPage / WinnerIntent',
      '站点经营',
      '系统计算',
      'Page明细 7 日窗口聚合；WinnerIntent 另读 Query页面明细 + GUIDE_INTENT_CATEGORIES',
      'Winner Page 按 Page明细汇总点击/曝光/最佳排名；必须有真实点击，且点击第一并在曝光或排名上明显领先。WinnerIntent 取赢家页在 Query×Page 中出现最多的 Guide Intent key；Query×Page 缺失时 WinnerIntent 可为空，不取消 Winner',
      '识别当前最值得跟进的落地页，而不是再做一套评分模型',
      '是（经营层）',
      '点击≥1；相对第二名点击严格更高，或点击并列时曝光≥1.5 倍',
      '确定性聚合 + 项目 Guide 词表',
      '实验中',
      '赢家页不是 Google 官方概念；无点击的曝光页不能当 Winner。不要用 Query×Page 判断页面是否 Winner。'
    ],
    [
      'Winner Asset Candidate',
      '内容资产',
      '系统计算',
      'runWinnerAssetEngine_ 只读「站点经营」T2_WINNER + 非首页 WinnerPage',
      '按规则建议 AssetType / AssetLevel / EvidenceStatus / 候选理由；Site+WinnerPage 唯一；重复运行更新 metrics 但保留人工字段与已进入 RESEARCH/READY/DONE 的状态',
      '把已赢页面转成可人工判断的资产升级候选；菜单「处理内容资产决定」后才创建 Research Job，不自动改站',
      '否（人工决定 APPROVE 后才进入 B2-B）',
      '首页 `/` 第一版 skip；save_progress→COMPARISON_MATRIX；intent 空→VERIFIED_GUIDE',
      '热词站项目 B2 资产候选实验规则',
      '实验中',
      '不等于自动内容生产。Approximately Up 类 homepage winner 默认不生成 candidate。'
    ],
    [
      'DOMAIN_PREPARE / DOMAIN_UPGRADE / Fast Track',
      '今日行动 / 站点状态 RecommendedAction',
      '实验规则',
      'decideRecommendedAction_ + 规则配置',
      'Domain Gate：indexed≥2、7d曝光≥30、Guide≥2、Top50>0 中至少 2 项；且 Day≥3（Fast Track 例外）。PREPARE：Gate 且 Score∈[60,75)。UPGRADE：Gate 且 Score≥75，或 Fast Track（截止日当天曝光≥300 且 Guide≥5）直接 UPGRADE',
      '是否进入域名准备/升级候选',
      '是（输出 RecommendedAction）',
      '见规则配置 DEFAULT_DECISION_RULES',
      '热词站项目当前实验参数',
      '实验中',
      '这些是项目动作建议，不是 Google 返回的站点状态。'
    ],
    [
      'CHECK_INDEX / ARCHIVE / WAIT',
      '今日行动 / 站点状态',
      '实验规则',
      'Decision Engine',
      'CHECK_INDEX：Day≥7 且索引未知/不足/IndexRate 低于警告，且未达 ARCHIVE。ARCHIVE：Day≥14 且 7d曝光≤10 且 Guide=0。WAIT：证据不足时的默认动作（通常不进今日行动）',
      '索引排查 / 归档候选 / 继续观察',
      '是',
      '见 INDEX_* / ARCHIVE_* 规则配置',
      '热词站项目 Decision 动作',
      '实验中',
      'CHECK_INDEX 不是 Google Coverage 状态；ARCHIVE 不是 Google 判站失败；WAIT 不是失败。'
    ],
    [
      '搜索意图 / Opportunity Level / 内容机会动作',
      '内容机会',
      '实验规则',
      'Opportunity Engine（意图分类 + classifyOpportunityLevel_/Action_）',
      '意图（品牌/明确/模糊）非 GSC 字段。HIGH：明确意图且有点击，或曝光≥3 且 position 4–30；MEDIUM/WATCH 见阈值。动作：RESEARCH_EXPAND_EXISTING / RESEARCH_NEW_CONTENT / WATCH / IGNORE_BRAND',
      '内容机会优先级与研究路径建议',
      '是（Research 入队）',
      'HIGH_MIN_CLICKS=1；HIGH_MIN_IMPRESSIONS=3；HIGH_POS 4–30；WATCH_POS_FAR=40',
      '热词站项目当前实验参数',
      '实验中',
      'HIGH 与建议动作都是项目实验规则，不是 Google 官方“高机会”，也不自动改站。'
    ],
    [
      'Research Job Status / Evidence Count',
      '研究任务',
      '系统计算',
      'Research Jobs 状态机 + 回写证据条数',
      '状态：PENDING / REVIEW / WATCH / FAILED / APPROVED / ARCHIVED。证据数量为筛选后有效 Evidence 条数',
      '跟踪研究进度与材料量',
      '是（队列）；证据数不直接定 DomainScore',
      '无“多少条必对”阈值',
      '系统状态 / 系统聚合',
      '较稳定',
      '任务状态不是搜索表现；Evidence 多 ≠ 结论正确。'
    ],
    [
      '相关度 / 发现主题 / 玩家问题 / Research Recommendation',
      '研究审核 / 研究任务',
      'AI / Research 判断',
      'Research Engine / hotword-engine 回写',
      'Relevance、Discovered Topic、Player Question、以及 EXPAND_EXISTING / NEW_CONTENT / WATCH 等研究结果建议',
      '人工审核参考；批准后可进开发任务',
      '否（须 Human Gate）',
      '最终须人工确认',
      'AI / Research 输出',
      '待验证',
      '相关度不是搜索量/GSC 分数/可信度百分比；输出可能跨游戏污染，必须过研究审核。'
    ],
    [
      '研究审核（Human Gate）',
      '研究审核 / 研究任务审核决定',
      '人工判断',
      '产品经理 / 运营',
      '人工确认来源真实、Evidence 相关、无跨游戏污染、是否支撑改内容；决定批准开发 / 继续观察 / 无需处理',
      '防止错误研究直接驱动改站',
      '是（开发任务入口）',
      '无自动阈值可替代',
      '人工判断',
      '人工判断',
      '未经审核不要把 Research 输出当事实落地。'
    ],
    [
      '今日行动 Status（TODO / DONE / SKIP）',
      '今日行动',
      '人工判断',
      '产品经理任务状态',
      'TODO=待处理；DONE=已处理；SKIP=跳过（可进入动作冷却）',
      '跟踪人是否处理过建议动作',
      '是（冷却逻辑）',
      '无搜索表现含义',
      '人工判断',
      '人工判断',
      '这是 PM 任务状态，不是搜索表现指标。'
    ],
    [
      'RuleVersion',
      '决策历史',
      '人工配置',
      '代码常量 DECISION_RULE_VERSION',
      '本次 Decision Engine 使用的规则版本标识（如 gsc-decision-v1.0）；规则实质变化时人工升级',
      '回测时还原“当时用的是哪版规则”',
      '否（不参与打分）',
      '当前：gsc-decision-v1.0',
      '热词站项目规则版本管理',
      '较稳定',
      '不是分数，也不是 Google 指标。普通数据变化不升级版本。'
    ],
    [
      'DecisionID',
      '决策历史 / 决策结果',
      '系统计算',
      'RunDate|Site|RecommendedAction|RuleVersion',
      '由运行日、站点、推荐动作、规则版本拼接的稳定唯一键',
      '标识一次 Decision Snapshot；同键重复运行不重复写入',
      '是（历史去重）',
      '同日同站同动作同版本唯一',
      '系统字段',
      '较稳定',
      '同日若推荐动作变化，会生成新 DecisionID 并保留新 Snapshot。'
    ],
    [
      'Horizon',
      '决策结果',
      '人工配置',
      '固定枚举 D7 / D14 / D30',
      '相对 DecisionDataDate 的观察地平线（+7 / +14 / +30 天）',
      '标记这条 Outcome 对应哪个未来时间点',
      '是（与 DecisionID 联合去重）',
      '仅允许 D7、D14、D30',
      '热词站项目 Outcome 合同',
      '较稳定',
      '不是分数；同一 DecisionID 每个 Horizon 最多一条 OBSERVED。'
    ],
    [
      'TargetDate',
      '决策结果',
      '系统计算',
      'DecisionDataDate + Horizon 天数',
      '例如 DecisionDataDate=2026-08-15 则 D7→2026-08-22；基于 DecisionDataDate，不是 RunDate',
      '判断该地平线是否到期、以及 Outcome 窗口截止日',
      '是（成熟判断）',
      '必须 LatestGSCDataDate ≥ TargetDate 才可观察',
      '热词站项目 Outcome 合同',
      '较稳定',
      'GSC 有延迟：RunDate 已过 TargetDate 不等于数据已成熟。'
    ],
    [
      'ImpressionsWindow / ClicksWindow',
      '决策结果',
      '系统计算',
      'GSC日数据在 Outcome 7d 窗口内求和',
      '窗口 = TargetDate−6 … TargetDate（含两端）的 Impressions / Clicks 总和',
      '观察推荐之后真实搜索曝光/点击表现',
      '否（不回写 Decision）',
      '无成功/失败阈值',
      '外部事实（GSC）聚合',
      '较稳定',
      '这是后续表现观察，不等于证明人工改站造成了增长；也不使用 DomainScore。'
    ],
    [
      'Outcome GuideQueryCount',
      '决策结果「GuideQueryCount」',
      '系统计算',
      'Query明细 + GUIDE_INTENT_CATEGORIES',
      'Outcome 7d 窗口内命中攻略意图词表的去重 Query 数',
      '辅助观察攻略型需求是否延续',
      '否',
      '辅助指标，不能作为唯一成功标准',
      '热词站项目语义规则',
      '实验中',
      'Guide 分类是项目规则；Query 本身仍是 GSC 原始词。'
    ],
    [
      'BestPosition',
      '决策结果',
      '系统计算',
      'Outcome 窗口内各 Query 最佳 AveragePosition 再取最优',
      '窗口内所有 Query 的 best position 中的最小值；无有效排名则留空（不写 0）',
      '观察后续排名表现',
      '否',
      '无',
      '外部事实（GSC）聚合',
      '较稳定',
      '平均排名指标；无 Query 时必须留空。'
    ],
    [
      'HumanDecision',
      '决策历史',
      '人工判断',
      '今日行动 Status（DONE / SKIP）同步',
      'PM 对该 DecisionID 的实际处理状态；TODO 不同步，保持空',
      '记录系统推荐是否被人工执行/跳过',
      '否（不改 DomainScore / Outcome）',
      'DONE / SKIP；非搜索成功标签',
      '人工判断',
      '人工判断',
      '不是 Outcome。DONE ≠ 搜索结果成功；SKIP ≠ 系统推荐一定错误。'
    ],
    [
      'HumanNote',
      '决策历史',
      '人工判断',
      '今日行动「人工备注」',
      'PM 对执行或跳过原因的备注，随 syncHumanDecisions 同步',
      '补充人工上下文，便于回测解读',
      '否',
      '无',
      '人工判断',
      '人工判断',
      '可选；不代替 Outcome 指标。'
    ],
    [
      '更新时间',
      '内容更新记录',
      '人工配置',
      '人工记录（网站实际上线/改动日）',
      '内容 intervention 实际发生日期（yyyy-MM-dd）；不是 DecisionDataDate / 今日行动 Date / sync 时间',
      'cooldown 起算日；未来 Outcome 可按真实改站日分组',
      '是（CONTENT_UPDATE_COOLDOWN）',
      'CONTENT_UPDATE_COOLDOWN_DAYS 默认 3',
      '热词站项目规则 + 人工事实',
      '较稳定',
      '只在网站确实改过之后填写；不要用 Decision 日冒充。'
    ],
    [
      '更新类型',
      '内容更新记录',
      '人工配置',
      '人工选择（可选）',
      'CONTENT_OPTIMIZE / CONTENT_EXPAND / INTERNAL_LINK / INDEX_FIX / OTHER；旧记录可空',
      '描述实际改站动作类别，便于回测',
      '否（不改 DomainScore）',
      '可选枚举；空=未标注',
      '热词站项目约定',
      '实验中',
      '不是 Decision 推荐动作本身；表示这次 intervention 实际做了什么。'
    ],
    [
      'DecisionID（内容更新记录）',
      '内容更新记录',
      '系统计算',
      '来自决策历史 / 今日行动的正式 DecisionID（人工填写关联）',
      '把实际内容修改绑定到触发它的 Decision Snapshot；一 Decision 可对应多行 intervention',
      'join 决策历史 ↔ 内容更新记录；区分“有改站”与“仅 DONE”',
      '否（不改 Snapshot / Outcome）',
      '空=未绑定（有效）；未知 ID 不会写入本列（拒绝悬空外键）',
      '系统关联键（类型归入系统计算）',
      '实验中',
      '为空不代表记录无效；M2-3B 前的历史 intervention 可以没有 DecisionID。DONE ≠ 自动产生本记录。未知 DecisionID 会 WARN 后清空绑定列。'
    ],
    [
      'InterventionCount',
      '反馈样本',
      '系统计算',
      '内容更新记录按 DecisionID 精确匹配计数',
      '同 DecisionID 的内容更新记录条数；一 Decision 可对应多页面多行',
      '区分“仅 DONE”与“真实发生内容修改”',
      '否（不改 DomainScore / Outcome）',
      '0=无绑定 intervention',
      '系统聚合',
      '实验中',
      '只按 DecisionID 精确关联；不用 Site/日期模糊匹配。'
    ],
    [
      'FirstInterventionDate',
      '反馈样本',
      '系统计算',
      '内容更新记录「更新时间」聚合（min）',
      '该 DecisionID 最早实际改站日；与 LastInterventionDate 成对',
      '观察改站相对 Outcome 的时间关系',
      '否',
      '无则空',
      '系统聚合',
      '实验中',
      '来自真实内容更新记录，不是 DecisionDataDate。'
    ],
    [
      'SampleStatus',
      '反馈样本',
      '系统计算',
      'HumanDecision + InterventionCount + D7/D14/D30 是否存在',
      '事实阶段：WAITING_HUMAN / SKIPPED / HANDLED_NO_INTERVENTION / INTERVENTION_PENDING_OUTCOME / D7_OBSERVED / D14_OBSERVED / D30_OBSERVED',
      '告诉 PM 当前样本走到哪一步；便于筛选待观察样本',
      '否（不参与打分）',
      '固定枚举；不是 SUCCESS/FAILURE',
      '热词站项目流程状态',
      '实验中',
      '不是 Opportunity Level，不是 Success Label。SKIPPED ≠ False Positive；DONE ≠ Success。'
    ],
    [
      'DecisionCount',
      '规则评分卡',
      '系统计算',
      '决策历史按 RuleVersion 去重 DecisionID',
      '该 RuleVersion 已落盘的唯一 Decision 数',
      '衡量规则版本积累了多少真实推荐样本',
      '否（不参与自动调规则）',
      '无阈值',
      '系统聚合',
      '实验中',
      '只计数，不表示规则好坏。'
    ],
    [
      'InterventionDecisionCount',
      '规则评分卡',
      '系统计算',
      '内容更新记录按 DecisionID 精确绑定后再按 RuleVersion 聚合',
      '至少有 1 条 Content Intervention 的 Decision 数（多页面仍计 1）',
      '区分“仅人工处理”与“真实改站”样本规模',
      '否',
      '无阈值',
      '系统聚合',
      '实验中',
      'InterventionRecordCount 才是改站记录总行数。'
    ],
    [
      'D7ObservedCount',
      '规则评分卡',
      '系统计算',
      '决策结果中 Horizon=D7 且 Decision 属于该 RuleVersion 的条数',
      '已存在的真实 D7 Outcome 数量；不按日期推断“应该成熟”',
      '衡量该规则版本有多少成熟观察样本',
      '否',
      '无阈值',
      '系统聚合',
      '实验中',
      '不是成功率。D14/D30 同理另列。'
    ],
    [
      'D7Eligibility / D14Eligibility / D30Eligibility',
      '评价资格',
      '系统计算',
      'HumanDecision + InterventionCount + 决策结果是否真实存在该 Horizon',
      'ELIGIBLE / PENDING / EXCLUDED；各 Horizon 独立，只认已落盘 Outcome',
      '筛选哪些 Decision 有资格进入后续 Intervention Outcome Evaluation',
      '否（不自动评价效果）',
      '无效果阈值',
      'M3-2 Evaluation Contract',
      '实验中',
      'ELIGIBLE 只表示满足进入该 Horizon 评价的事实条件，不等于成功/失败/正确推荐。'
    ],
    [
      'ExclusionReason',
      '评价资格',
      '系统计算',
      'WAITING_HUMAN / SKIPPED / NO_INTERVENTION',
      '仅在三 Horizon 均为 EXCLUDED 时填写；PENDING/ELIGIBLE 时留空',
      '解释为何当前不能进入 Intervention 效果评价',
      '否',
      '固定枚举',
      'M3-2 Evaluation Contract',
      '实验中',
      'SKIPPED ≠ False Positive；NO_INTERVENTION ≠ 推荐错误。'
    ],
    [
      'Intervention Evaluation Eligibility',
      '评价资格',
      '系统计算',
      '仅针对已发生 Content Intervention 的 Decision',
      '派生视图；一 DecisionID 一行；可 rebuild',
      '明确“谁有资格被评价”，不是“评价结果好坏”',
      '否',
      '无',
      'M3-2 Evaluation Contract',
      '实验中',
      '本表不做 Recommendation Evaluation；SKIP 样本本轮不评价。'
    ],
    [
      'BaselineStartDate / BaselineEndDate',
      '决策历史',
      '系统计算',
      'DecisionDataDate−6 … DecisionDataDate（含）',
      '与 Outcome 7d 窗口同一 helper：computeOutcomeWindow_(DecisionDataDate)',
      '冻结 Decision 前 7 天搜索表现基线的日期范围，供未来与 D7/D14/D30 比较',
      '否（不参与打分/调规则）',
      '无效果阈值',
      'M3-3 Decision Baseline 7D',
      '实验中',
      '不是 intervention 前一刻基线；也不是 SEO 行业 benchmark。写入后冻结，不因 rebuild 覆盖。'
    ],
    [
      'BaselineImpressions / BaselineClicks / BaselineQuery*',
      '决策历史',
      '系统计算',
      'GSC日数据 + Query明细；复用 computeOutcomeWindowMetrics_',
      '与决策结果 ImpressionsWindow / ClicksWindow / QueryCount / GuideQueryCount / Top50 / Top20 / BestPosition 同口径',
      '建立 Baseline7D → D7 → D14 → D30 可比较的事实基线',
      '否',
      '无 Delta / 无 SUCCESS 阈值',
      'M3-3 Decision Baseline 7D',
      '实验中',
      '即使看到 Baseline→D7 变化，也只能描述 Decision 后样本的观察变化，不能直接声称改页造成增长。不等于 Impressions24H / Growth3D。'
    ],
    [
      'ImpressionsDelta / ClicksDelta / GuideQueriesDelta',
      '效果变化',
      '系统计算',
      '决策结果 Outcome − 决策历史 Baseline',
      '绝对变化：OutcomeWindow − Baseline；PENDING Horizon 留空，不填 0',
      '观察 Decision 后各 Horizon 相对 Baseline 的搜索量变化',
      '否（不自动评价）',
      '无成功/失败阈值',
      'M3-4 Outcome Delta View',
      '实验中',
      '只描述变化事实，不证明 Content Intervention 造成了增长。'
    ],
    [
      'ImpressionsDeltaPct / ClicksDeltaPct / GuideQueriesDeltaPct',
      '效果变化',
      '系统计算',
      '(Outcome − Baseline) / Baseline',
      '仅当 Baseline > 0 时计算；Baseline=0 时留空（不写 Infinity / 伪增长率）',
      '观察相对变化幅度',
      '否',
      '无阈值',
      'M3-4 Outcome Delta View',
      '实验中',
      '不是 GSC 原始字段；Baseline 与 Outcome 都为 0 时 DeltaAbs=0、DeltaPct 仍空。'
    ],
    [
      'PositionImprovement',
      '效果变化',
      '系统计算',
      'BaselineBestPosition − OutcomeBestPosition',
      '正数=排名提升（数字变小）；负数=下降；任一缺失则空；不算百分比',
      '观察平均最佳排名相对 Baseline 的改善/恶化',
      '否',
      '无阈值',
      'M3-4 Outcome Delta View',
      '实验中',
      '不要用 Outcome−Baseline 当改善值；排名越小越好。'
    ],
    [
      'D7Status / D14Status / D30Status（效果变化）',
      '效果变化',
      '系统计算',
      '决策结果是否存在该 DecisionID + Horizon',
      'OBSERVED / PENDING；不按日期推断成熟；不是评价资格',
      '标明该 Horizon 是否已有真实 Outcome 可供比较',
      '否',
      '固定枚举',
      'M3-4 Outcome Delta View',
      '实验中',
      '资格判断仍以「评价资格」为准；本列只表示数据是否存在。'
    ],
    [
      '效果变化（Outcome Delta View）',
      '效果变化',
      '系统计算',
      '决策历史 Baseline + 决策结果 D7/D14/D30',
      '派生视图；一 DecisionID 一行；可 rebuild；无需 Intervention 也有行',
      '回答“相对 Baseline 变了多少”，不回答“是否成功”',
      '否',
      '无',
      'M3-4 Outcome Delta View',
      '实验中',
      '无 Intervention 的行不能进入未来 Intervention Effect Evaluation。'
    ],
    [
      'EvaluationStatus',
      '效果评价',
      '系统计算',
      '评价资格三 Horizon 状态',
      'EXCLUDED / PENDING / READY；消费既有资格层，不重算 SKIP/WAITING/NO_INTERVENTION',
      '标明 Decision 是否已进入 Intervention Effect Evaluation cohort',
      '否（不自动评价效果）',
      '固定枚举',
      'M3-5 Effect Evaluation Cohort',
      '实验中',
      'READY ≠ SUCCESS / 有效 / 推荐正确；只代表具备进入后续效果判断的数据条件。'
    ],
    [
      'EvaluationHorizon',
      '效果评价',
      '系统计算',
      '评价资格中 ELIGIBLE 的最长真实 Horizon',
      '优先级 D30 > D14 > D7；不要求连续存在；不补造缺失 Horizon',
      '指定当前应用哪个观察窗口做后续效果判断',
      '否',
      '仅 D7 / D14 / D30 或空',
      'M3-5 Effect Evaluation Cohort',
      '实验中',
      '是“截至当前最长可评价窗口”，不是最终效果结论。'
    ],
    [
      'ComparableMetricCount / *Comparable',
      '效果评价',
      '系统计算',
      '效果变化中 Baseline 与选中 Horizon Outcome 是否均为有效数值',
      '检查 Impressions / Clicks / GuideQueries / BestPosition；Baseline=0 仍可比；不因 DeltaPct 空而判不可比',
      '统计当前可进入后续效果分类的指标数量',
      '否',
      'EvaluationStatus 本身无最低可比门槛；Evidence 另用 V1 实验阈值',
      'M3-5 Effect Evaluation Cohort',
      '实验中',
      'READY + ComparableMetricCount=0 仍保持 READY，不擅自改成 EXCLUDED。'
    ],
    [
      'EvidenceStatus',
      '效果评价',
      '实验规则',
      'EvaluationStatus + ComparableMetricCount + Baseline/Outcome 绝对规模（效果变化）',
      'NOT_READY / INSUFFICIENT_EVIDENCE / COMPARABLE。项目内部“是否具备效果分类最低证据”的 V1 实验规则，不是 Google / SEO 官方标准，也不是 AI 判断或效果成功率。COMPARABLE ≠ IMPROVED / SUCCESS。',
      '回答当前 EvaluationHorizon 的数据是否足以进入下一阶段效果方向分类',
      '否（不自动产出效果方向标签）',
      '项目 V1 实验阈值：ComparableMetricCount≥2；且 max(BaselineImpressions,OutcomeImpressions)≥10 或 max(BaselineGuideQueries,OutcomeGuideQueries)≥3',
      'M3-6 Effect Evidence Contract',
      '实验中',
      '不依据 Delta 正负；Clicks / BestPosition 可计入可比数，但不能单独通过 Search Volume Gate。'
    ],
    [
      'EvidenceReason',
      '效果评价',
      '实验规则',
      'EvidenceStatus 判定的首个主要原因',
      'TOO_FEW_COMPARABLE_METRICS / LOW_SEARCH_VOLUME；NOT_READY 与 COMPARABLE 时留空。V1 只记一个原因，不拼接。',
      '解释为何证据不足（若不足）',
      '否',
      '固定枚举或空',
      'M3-6 Effect Evidence Contract',
      '实验中',
      'Reason 只服务 Evidence Contract，不表示效果方向。'
    ]
  ];
}

