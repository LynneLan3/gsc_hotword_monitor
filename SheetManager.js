/**
 * Google Sheet 读写与格式
 */

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * 写入/读取前把网格扩到至少 requiredRows × requiredCols。
 * 默认新表常为 1000×26；站点状态 27 列、决策历史 38 列会越界。
 */
function ensureSheetGrid_(sheet, requiredRows, requiredCols) {
  if (!sheet) return sheet;
  var needRows = Math.max(1, parseInt(requiredRows, 10) || 1);
  var needCols = Math.max(1, parseInt(requiredCols, 10) || 1);
  var maxRows = sheet.getMaxRows();
  var maxCols = sheet.getMaxColumns();
  if (needCols > maxCols) {
    sheet.insertColumnsAfter(maxCols, needCols - maxCols);
  }
  if (needRows > maxRows) {
    sheet.insertRowsAfter(maxRows, needRows - maxRows);
  }
  return sheet;
}

function sheetDataRowCount_(sheet) {
  if (!sheet) return 0;
  var last = sheet.getLastRow();
  return last >= 2 ? last - 1 : 0;
}

/**
 * 数据区 Range（从第 2 行起）。无数据行时返回 null，不请求 0 行范围。
 * numRows = lastRow - 1，不是 lastRow。
 */
function getSheetDataRange_(sheet, numCols) {
  var n = sheetDataRowCount_(sheet);
  if (n < 1) return null;
  var cols = Math.max(1, parseInt(numCols, 10) || 1);
  ensureSheetGrid_(sheet, sheet.getLastRow(), cols);
  return sheet.getRange(2, 1, n, cols);
}

/**
 * 若 sheet 不存在则创建并设置表头与基础格式；已存在则不改动数据。
 */
function ensureSheet_(name, headers) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Invalid sheetName: ' + String(name));
  }

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (sheet) {
    if (headers && headers.length) ensureSheetGrid_(sheet, 1, headers.length);
    return sheet;
  }

  sheet = ss.insertSheet(name);
  ensureSheetGrid_(sheet, 1, headers.length);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.getRange(1, 1, 1, headers.length).createFilter();
  applyColumnWidths_(sheet, name);
  applyNumberFormats_(sheet, name);
  return sheet;
}

function applyColumnWidths_(sheet, name) {
  var widths = {};
  if (name === SHEET_NAMES.SITES) {
    widths = { 1: 220, 2: 360, 3: 360, 4: 110, 5: 80 };
  } else if (name === SHEET_NAMES.SNAPSHOT) {
    widths = {
      1: 100, 2: 130, 3: 180, 4: 280, 5: 50,
      6: 110, 7: 110, 8: 90, 9: 100, 10: 70,
      11: 70, 12: 110, 13: 120, 14: 130,
      15: 280, 16: 280, 17: 200, 18: 140, 19: 220
    };
  } else if (name === SHEET_NAMES.DAILY) {
    widths = {
      1: 100, 2: 180, 3: 70, 4: 100, 5: 70,
      6: 110, 7: 120, 8: 280, 9: 280
    };
  } else if (name === SHEET_NAMES.QUERIES) {
    widths = {
      1: 100, 2: 180, 3: 260, 4: 70, 5: 100, 6: 70, 7: 110
    };
  } else if (name === SHEET_NAMES.PAGES) {
    widths = {
      1: 100, 2: 180, 3: 320, 4: 220,
      5: 70, 6: 100, 7: 70, 8: 110
    };
  } else if (name === SHEET_NAMES.QUERY_PAGES) {
    widths = {
      1: 100, 2: 180, 3: 220, 4: 320, 5: 220,
      6: 70, 7: 100, 8: 70, 9: 110
    };
  } else if (name === SHEET_NAMES.WINNER_ASSETS) {
    widths = {
      1: 100, 2: 180, 3: 280, 4: 120, 5: 110, 6: 110,
      7: 110, 8: 100, 9: 150, 10: 220, 11: 420, 12: 130,
      13: 110, 14: 260, 15: 110, 16: 220, 17: 100,
      18: 150, 19: 150, 20: 220, 21: 160
    };
  } else if (name === SHEET_NAMES.URL_INDEX) {
    widths = {
      1: 100, 2: 160, 3: 320, 4: 80, 5: 140, 6: 120,
      7: 120, 8: 140, 9: 120, 10: 220, 11: 220, 12: 90, 13: 200
    };
  } else if (name === SHEET_NAMES.LOG) {
    widths = { 1: 160, 2: 70, 3: 160, 4: 480 };
  } else if (name === SHEET_NAMES.RULES) {
    widths = { 1: 240, 2: 90, 3: 420 };
  } else if (name === SHEET_NAMES.SITE_STATUS) {
    widths = {
      1: 100, 2: 180, 3: 110, 4: 50, 5: 120,
      6: 90, 7: 110, 8: 110, 9: 140, 10: 130,
      11: 90, 12: 110, 13: 140, 14: 120, 15: 120,
      16: 120, 17: 80, 18: 100, 19: 90, 20: 110,
      21: 110, 22: 80, 23: 100, 24: 120, 25: 150, 26: 70, 27: 360
    };
  } else if (name === SHEET_NAMES.TODAY_ACTIONS) {
    widths = {
      1: 100, 2: 70, 3: 180, 4: 120, 5: 150,
      6: 100, 7: 360, 8: 80, 9: 180
    };
  } else if (name === SHEET_NAMES.OPPORTUNITIES) {
    widths = {
      1: 150, 2: 100, 3: 160, 4: 260, 5: 240,
      6: 280, 7: 220, 8: 70, 9: 100, 10: 70,
      11: 110, 12: 120, 13: 120, 14: 90, 15: 180,
      16: 360, 17: 110, 18: 80, 19: 90, 20: 110, 21: 160,
      22: 220, 23: 160
    };
  } else if (name === SHEET_NAMES.DEMAND_RADAR) {
    widths = {
      1: 280, 2: 100, 3: 100, 4: 100, 5: 110,
      6: 180, 7: 180, 8: 280, 9: 160, 10: 360,
      11: 90, 12: 90, 13: 110, 14: 110, 15: 110, 16: 110,
      17: 120, 18: 110, 19: 80, 20: 110, 21: 110, 22: 140,
      23: 90, 24: 110, 25: 220, 26: 150
    };
  } else if (name === SHEET_NAMES.FRESH_QUERY_MONITOR) {
    widths = {
      1: 160, 2: 180, 3: 260, 4: 360,
      5: 110, 6: 110, 7: 110, 8: 130,
      9: 110, 10: 110, 11: 110, 12: 80,
      13: 220, 14: 180, 15: 160, 16: 120, 17: 180
    };
  } else if (name === SHEET_NAMES.RESEARCH_JOBS) {
    widths = {
      1: 260, 2: 160, 3: 160, 4: 160,
      5: 280, 6: 240, 7: 90, 8: 180, 9: 280, 10: 90, 11: 420,
      12: 140, 13: 90, 14: 360, 15: 160, 16: 280,
      17: 320, 18: 360,
      19: 110, 20: 320, 21: 160, 22: 140
    };
  } else if (name === SHEET_NAMES.RESEARCH_REVIEW) {
    widths = {
      1: 260, 2: 160, 3: 160, 4: 280, 5: 240,
      6: 90, 7: 220, 8: 280, 9: 420, 10: 320,
      11: 80, 12: 160
    };
  } else if (name === SHEET_NAMES.CONTENT_UPDATES) {
    widths = {
      1: 110, 2: 220, 3: 240, 4: 120, 5: 360, 6: 140, 7: 280,
      8: 140, 9: 220, 10: 140, 11: 180, 12: 220, 13: 120, 14: 220,
      15: 260, 16: 180, 17: 260, 18: 220, 19: 200, 20: 220, 21: 180,
      22: 220, 23: 260, 24: 180
    };
  } else if (name === SHEET_NAMES.FEEDBACK_SAMPLES) {
    widths = {
      1: 280, 2: 110, 3: 180, 4: 140, 5: 150,
      6: 70, 7: 90, 8: 100, 9: 180, 10: 90,
      11: 260, 12: 110, 13: 110, 14: 160, 15: 90,
      30: 180, 31: 140
    };
  } else if (name === SHEET_NAMES.RULE_SCORECARD) {
    widths = {
      1: 160, 2: 100, 3: 120, 4: 90, 5: 90,
      6: 140, 7: 140, 8: 110, 9: 110, 10: 110,
      11: 130, 12: 140
    };
  } else if (name === SHEET_NAMES.EVALUATION_ELIGIBILITY) {
    widths = {
      1: 280, 2: 140, 3: 110, 4: 160, 5: 100,
      6: 110, 7: 90, 8: 90, 9: 90, 10: 100,
      11: 100, 12: 100, 13: 140, 14: 140
    };
  } else if (name === SHEET_NAMES.OUTCOME_DELTA) {
    widths = {
      1: 280, 2: 140, 3: 110, 4: 160, 5: 100, 6: 110
    };
  } else if (name === SHEET_NAMES.EFFECT_EVALUATION) {
    widths = {
      1: 280, 2: 140, 3: 110, 4: 160, 5: 100, 6: 110,
      7: 110, 8: 120, 9: 130, 10: 120, 11: 110, 12: 130, 13: 130, 14: 140
    };
  } else if (name === SHEET_NAMES.DEVELOPMENT_TASKS) {
    widths = {
      1: 280, 2: 160, 3: 260, 4: 160, 5: 160, 6: 240,
      7: 120, 8: 360, 9: 70, 10: 90, 11: 160, 12: 280
    };
  }

  Object.keys(widths).forEach(function (col) {
    sheet.setColumnWidth(Number(col), widths[col]);
  });
}

function applyNumberFormats_(sheet, name) {
  // 对整列设置格式，便于后续写入
  if (name === SHEET_NAMES.SITES) {
    sheet.getRange('D:D').setNumberFormat('yyyy-mm-dd');
  } else if (name === SHEET_NAMES.SNAPSHOT) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('H:H').setNumberFormat('0.00%');
    sheet.getRange('K:K').setNumberFormat('0.00%');
    sheet.getRange('L:L').setNumberFormat('0.0');
    sheet.getRange('N:N').setNumberFormat('yyyy-mm-dd');
  } else if (name === SHEET_NAMES.DAILY) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('E:E').setNumberFormat('0.00%');
    sheet.getRange('F:F').setNumberFormat('0.0');
  } else if (name === SHEET_NAMES.QUERIES) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('F:F').setNumberFormat('0.00%');
    sheet.getRange('G:G').setNumberFormat('0.0');
  } else if (name === SHEET_NAMES.PAGES) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('G:G').setNumberFormat('0.00%');
    sheet.getRange('H:H').setNumberFormat('0.0');
  } else if (name === SHEET_NAMES.QUERY_PAGES) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('H:H').setNumberFormat('0.00%');
    sheet.getRange('I:I').setNumberFormat('0.0');
  } else if (name === SHEET_NAMES.WINNER_ASSETS) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('R:R').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange('S:S').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange('U:U').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  } else if (name === SHEET_NAMES.URL_INDEX) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
  } else if (name === SHEET_NAMES.LOG) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  } else if (name === SHEET_NAMES.SITE_STATUS) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('C:C').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('F:F').setNumberFormat('0.00%');
    sheet.getRange('K:K').setNumberFormat('0.00');
  } else if (name === SHEET_NAMES.TODAY_ACTIONS) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
  } else if (name === SHEET_NAMES.OPPORTUNITIES) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('J:J').setNumberFormat('0.00%');
    sheet.getRange('K:K').setNumberFormat('0.0');
    sheet.getRange('Q:Q').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('W:W').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  } else if (name === SHEET_NAMES.DEMAND_RADAR) {
    sheet.getRange('B:E').setNumberFormat('yyyy-mm-dd');
    sheet.getRange('O:P').setNumberFormat('0.00%');
    sheet.getRange('Z:Z').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange('AH:AH').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  } else if (name === SHEET_NAMES.FRESH_QUERY_MONITOR) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange('G:G').setNumberFormat('0.00%');
    sheet.getRange('H:H').setNumberFormat('0.0');
    sheet.getRange('J:J').setNumberFormat('0.00%');
  } else if (name === SHEET_NAMES.RESEARCH_JOBS) {
    sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange('O:O').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange('U:U').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  } else if (name === SHEET_NAMES.RESEARCH_REVIEW) {
    sheet.getRange('K:K').setNumberFormat('0.00');
    sheet.getRange('L:L').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  } else if (name === SHEET_NAMES.CONTENT_UPDATES) {
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
  } else if (name === SHEET_NAMES.DEVELOPMENT_TASKS) {
    sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange('K:K').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }
}

/**
 * 产品经理可读的「使用说明」正文（中文；不解释代码）。
 * @return {Array<string>}
 */
function getUsageGuideLines_() {
  return [
    '【每天只从「今日行动」开始】',
    '',
    '这张表是热词站 GSC 每日监控的工作台。打开后先看「今日行动」，不要从后台数据表开始翻。',
    '',
    '—— 当前工作流 ——',
    'GSC 数据 → Decision Engine → 今日行动 → 站点经营 → 内容机会 → 研究任务 → 研究审核 → 人工决定是否修改内容 → 后续继续观察 GSC',
    '',
    '—— 每日 SOP（很短） ——',
    '1. 看「今日行动」',
    '2. 只有 RecommendedAction 是 CONTENT_OPTIMIZE / CONTENT_EXPAND 时，才进入「内容机会」',
    '3. 只有存在 Research 待审核时，才进入「研究任务」/「研究审核」',
    '4. 出现异常（收录、任务失败）才看「URL索引」/「运行日志」',
    '5. 今日行动为空或都是等待类结论时，不要机械改网站',
    '',
    '—— 各 Sheet 职责 ——',
    '今日行动：每天主要入口；只列出需要人处理的站点与建议动作',
    '指标说明：数据字典；说明指标来自 Google、系统计算，还是热词站实验规则',
    '每日快照：快速看站点健康、曝光/点击概况与异常 Status',
    '内容机会：把真实 GSC Query 转成可执行的内容机会（不是随便想话题）',
    '需求雷达：记录 GSC Query 尚未充分暴露、但系统检测到值得进一步调查的需求信号。DISCOVERED 只是发现，不代表内容机会成立。CrossValidated 只有在至少两个独立 Source Family 指向同一需求时才成立。当前 QUERY_BLIND_SPOT 属于 GSC 单来源信号，不应直接触发内容开发。',
    '实时Query监控：用 GSC hourly 数据看最近 24 小时突然爆发的 Query，并观察落地页承接。只用于热词发现和爆量提醒，不进入 Decision / D7 / 效果评价。百分比增长还需近24h展现≥10。Mortal Shell II 的 skip prologue 若仍落在旧页，记为旧页承接、观察新页切换。数据可能仍不完整。',
    '研究任务：需要外部 Research 的任务队列',
    '研究审核：Human Gate，人工核对证据后再决定是否批准开发/继续观察/无需处理',
    '站点状态：解释 Decision Engine 为什么给出当前判断（分数、阶段、理由）',
    '站点经营：在 SEO RecommendedAction 之外看经营投入（投入档位 / 经营动作 / 赢家页面）。HOLD 不覆盖今日行动里的 SEO Decision',
    '内容资产：把已赢页面转成可人工判断的资产升级候选。人工决定后用「处理内容资产决定」创建研究任务；审核后再用「同步内容资产研究结果」回写 READY / ARCHIVED。不自动改站',
    '决策历史：保存系统当时的规则版本、输入指标和推荐动作，用于后续回测；并冻结与 Outcome 同口径的决策前 7 天 Baseline（DecisionDataDate−6…DecisionDataDate）。Baseline 不是 intervention 前一刻表现，也不是成功/失败判定；日常无需查看',
    '决策结果：在 Decision 后的 D7 / D14 / D30，用已有 GSC 历史记录后续搜索表现，用于以后回测规则；表示“推荐机会后来的表现”，不等于证明某次人工修改造成了增长；日常无需查看',
    '反馈样本：系统自动生成的分析视图，把决策 → 人工处理 → 实际内容修改 → D7/D14/D30 后续表现汇总到一行。SampleStatus 只表示当前事实阶段，不代表成功或失败。该表可重新生成，不应作为人工填写入口。',
    '规则评分卡：按 RuleVersion 汇总 Decision / 人工处理 / 内容干预 / D7·D14·D30 样本数量。只回答“积累了多少真实样本”，不评价规则成功或失败；可重新生成，不应人工填写。',
    '评价资格：判断某个 Decision 在 D7/D14/D30 是否有资格进入后续「内容干预效果评价」。ELIGIBLE 只代表已满足进入该 Horizon 评价的事实条件，不代表成功、失败、正确推荐、错误推荐，也不证明内容修改造成了因果效果。本表只覆盖 Intervention Evaluation Eligibility，不评价 SKIP 推荐质量；可重新生成，不应人工填写。',
    '效果变化：把 Decision Baseline 7D 与真实 D7/D14/D30 Outcome 做成指标变化视图（Delta / DeltaPct / PositionImprovement）。只描述 Baseline 与后续观察窗口之间的搜索指标变化，不证明 Content Intervention 导致了这些变化；可重新生成，不应人工填写。',
    '效果评价：基于「评价资格」与「效果变化」，标记哪些 Decision 已进入 Intervention Effect Evaluation cohort、当前 Horizon，以及 EvidenceStatus（数据是否足以进入后续效果方向分类）。EvaluationStatus=READY / EvidenceStatus=COMPARABLE 都不等于效果成功/失败；Evidence 使用项目 V1 实验阈值（Comparable≥2，且 Impressions≥10 或 GuideQueries≥3），不是 Google / SEO 官方标准；可重新生成，不应人工填写。',
    '规则配置：系统自己的判断阈值；不是 Google 官方标准，也不要当 SEO 真理',
    'GSC日数据：底层历史汇总，日常不用先看',
    'Query明细：真实 GSC Query 明细，日常不用先看',
    'Page明细：真实 GSC 页面 Performance，经营层 Winner Page 看这张表',
    'Query页面明细：Query × Landing Page，用于核对「词落到了哪个页」',
    'URL索引：收录异常诊断，有索引问题时再看',
    '运行日志：自动任务故障诊断，脚本报错时再看',
    'PAGE_OPPORTUNITIES：旧版/实验层，不是当前正式入口（Tab 已隐藏，数据保留）',
    '',
    '—— 其他后台表（一般不用当日常入口） ——',
    '站点配置：站点开关、Property / Sitemap、Day0',
    '开发任务：审核批准后的开发队列',
    '内容更新记录：只有网站实际发生页面修改时才记录。它与 HumanDecision=DONE 不同——DONE 只表示任务被处理；「内容更新记录」才代表实际网站 intervention。若由某个系统 Decision 触发，新记录使用 DecisionID 与「决策历史」关联；旧历史记录可能没有 DecisionID，属于正常情况。',
    '',
    '如果不知道某个指标来自哪里、如何计算，或它是不是项目实验规则，请查看「指标说明」。',
    '',
    '「今日行动」中带 DecisionID 的新任务在 DONE / SKIP 后，可同步回「决策历史」的 HumanDecision / HumanNote，用于后续判断系统推荐是否被人工执行。DONE ≠ 搜索结果成功；SKIP ≠ 系统推荐一定错误——它们只是人工执行状态。',
    '',
    '提醒：没有明确行动时，优先继续观察 GSC，而不是每天改站。'
  ];
}

/**
 * 确保「使用说明」存在，并写成当前真实工作流（覆盖旧说明；不碰其他 Sheet 数据）。
 */
function ensureUsageGuideSheet_() {
  var ss = getSpreadsheet_();
  var name = SHEET_NAMES.USAGE;
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  var lines = getUsageGuideLines_();
  var values = [];
  for (var i = 0; i < lines.length; i++) {
    values.push([lines[i]]);
  }

  sheet.clear();
  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }
  sheet.setFrozenRows(0);
  ensureSheetGrid_(sheet, values.length, 1);
  sheet.getRange(1, 1, values.length, 1).setValues(values);
  sheet.setColumnWidth(1, 900);
  sheet.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  if (values.length > 1) {
    sheet
      .getRange(2, 1, values.length - 1, 1)
      .setFontWeight('normal')
      .setFontSize(11);
  }
  sheet.setTabColor('4285F4');
}

/**
 * 确保「指标说明」存在并重写为当前数据字典（可重复；不碰业务数据 Sheet）。
 */
function ensureMetricGuideSheet_() {
  var ss = getSpreadsheet_();
  var name = SHEET_NAMES.METRICS;
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  var headers = METRIC_GUIDE_HEADERS;
  var rows = getMetricGuideRows_();
  var values = [headers].concat(rows);

  sheet.clear();
  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }
  ensureSheetGrid_(sheet, values.length, headers.length);
  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(1);
  sheet
    .getRange(1, 1, 1, headers.length)
    .setBackground('#1F4E78')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.setTabColor('1D4ED8');

  var widths = [200, 220, 130, 220, 360, 240, 140, 280, 200, 90, 340];
  for (var i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }
}

/**
 * 纯函数：根据已有 Sheet 名计算目标顺序。
 * preferred 在前（仅保留已存在的），trailing 次之，其余保持 existingNames 相对顺序。
 * @param {Array<string>} existingNames
 * @param {Array<string>} preferredNames
 * @param {Array<string>} trailingNames
 * @return {Array<string>}
 */
function buildSheetUiOrder_(existingNames, preferredNames, trailingNames) {
  var present = {};
  for (var i = 0; i < existingNames.length; i++) {
    present[existingNames[i]] = true;
  }

  var used = {};
  var out = [];

  function appendFrom_(list) {
    if (!list) return;
    for (var j = 0; j < list.length; j++) {
      var n = list[j];
      if (!present[n] || used[n]) continue;
      out.push(n);
      used[n] = true;
    }
  }

  appendFrom_(preferredNames);
  appendFrom_(trailingNames);

  for (var k = 0; k < existingNames.length; k++) {
    var name = existingNames[k];
    if (used[name]) continue;
    out.push(name);
    used[name] = true;
  }
  return out;
}

/**
 * 调整 Tab 顺序 + 隐藏旧/实验 Sheet。
 * 不删除任何 Sheet，不改表头与业务数据行。
 */
function organizeSheetUi_() {
  var ss = getSpreadsheet_();
  var sheets = ss.getSheets();
  if (!sheets || !sheets.length) return;

  var existingNames = [];
  var byName = {};
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    existingNames.push(name);
    byName[name] = sheets[i];
  }

  var orderedNames = buildSheetUiOrder_(
    existingNames,
    SHEET_UI_ORDER,
    SHEET_UI_TRAILING_ORDER
  );

  for (var pos = 0; pos < orderedNames.length; pos++) {
    var sheet = byName[orderedNames[pos]];
    if (!sheet) continue;
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(pos + 1);
  }

  for (var h = 0; h < SHEET_UI_HIDDEN.length; h++) {
    var hideName = SHEET_UI_HIDDEN[h];
    var hideSheet = byName[hideName];
    if (!hideSheet) continue;
    if (!hideSheet.isSheetHidden()) {
      hideSheet.hideSheet();
    }
  }

  // 打开表时落到「使用说明」；若无则落到第一个可见 Tab
  var focus =
    byName[SHEET_NAMES.USAGE] ||
    byName[SHEET_NAMES.TODAY_ACTIONS] ||
    ss.getSheets()[0];
  if (focus) {
    if (focus.isSheetHidden()) {
      var all = ss.getSheets();
      for (var v = 0; v < all.length; v++) {
        if (!all[v].isSheetHidden()) {
          focus = all[v];
          break;
        }
      }
    }
    ss.setActiveSheet(focus);
  }

  Logger.log('organizeSheetUi_ order=' + JSON.stringify(orderedNames));
}

/** 菜单/手动：只整理使用说明、指标说明、顺序与隐藏，不改业务数据 */
function organizeSheetUi() {
  ensureUsageGuideSheet_();
  ensureMetricGuideSheet_();
  organizeSheetUi_();
  writeLog_('INFO', '', 'organizeSheetUi 完成：使用说明/指标说明/顺序/隐藏已更新');
}

/**
 * 创建全部工作表；预填站点配置（仅当站点配置为空时）
 */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error('No active spreadsheet');
  }

  var sheets = ss.getSheets();

  if (!sheets || sheets.length === 0) {
    throw new Error('Spreadsheet has no sheets');
  }

  // 每次新的 Apps Script execution 都先明确设置一个真实存在的 Sheet 为 active。
  // 当前 Spreadsheet 曾删除默认 Sheet1，单独运行 repairSpreadsheetContext 只对当次 execution 有效，
  // 下一次 execution 仍可能出现 Sheet 0 not found。
  ss.setActiveSheet(sheets[0]);
  SpreadsheetApp.flush();

  Logger.log(
    'setupSheets context: ' +
      sheets[0].getName() +
      ' [gid=' +
      sheets[0].getSheetId() +
      ']'
  );

  Logger.log(
    'setupSheets 将初始化: ' +
      JSON.stringify([
        SHEET_NAMES.SITES,
        SHEET_NAMES.SNAPSHOT,
        SHEET_NAMES.DAILY,
        SHEET_NAMES.QUERIES,
        SHEET_NAMES.PAGES,
        SHEET_NAMES.QUERY_PAGES,
        SHEET_NAMES.URL_INDEX,
        SHEET_NAMES.LOG,
        SHEET_NAMES.RULES,
        SHEET_NAMES.SITE_STATUS,
        SHEET_NAMES.PORTFOLIO,
        SHEET_NAMES.WINNER_ASSETS,
        SHEET_NAMES.TODAY_ACTIONS,
        SHEET_NAMES.OPPORTUNITIES,
        SHEET_NAMES.DEMAND_RADAR,
        SHEET_NAMES.FRESH_QUERY_MONITOR,
        SHEET_NAMES.RESEARCH_JOBS,
        SHEET_NAMES.RESEARCH_REVIEW,
        SHEET_NAMES.DEVELOPMENT_TASKS,
        SHEET_NAMES.CONTENT_UPDATES
      ])
  );

  ensureSheet_(SHEET_NAMES.SITES, SITE_HEADERS);
  ensureSheet_(SHEET_NAMES.SNAPSHOT, SNAPSHOT_HEADERS);
  ensureSheet_(SHEET_NAMES.DAILY, DAILY_HEADERS);
  ensureSheet_(SHEET_NAMES.QUERIES, QUERY_HEADERS);
  ensureSheet_(SHEET_NAMES.PAGES, PAGE_HEADERS);
  ensureSheet_(SHEET_NAMES.QUERY_PAGES, QUERY_PAGE_HEADERS);
  ensureSheet_(SHEET_NAMES.URL_INDEX, URL_INDEX_HEADERS);
  ensureSheet_(SHEET_NAMES.LOG, LOG_HEADERS);
  ensureSheet_(SHEET_NAMES.RULES, RULE_HEADERS);
  ensureSheet_(SHEET_NAMES.SITE_STATUS, SITE_STATUS_HEADERS);
  ensureSheet_(SHEET_NAMES.PORTFOLIO, PORTFOLIO_HEADERS);
  ensurePortfolioHeader_();
  ensureSheet_(SHEET_NAMES.WINNER_ASSETS, WINNER_ASSET_HEADERS);
  ensureWinnerAssetHeader_();
  applyWinnerAssetDecisionValidation_();
  ensureSheet_(SHEET_NAMES.DECISION_HISTORY, DECISION_HISTORY_HEADERS);
  ensureDecisionHistoryHeader_();
  ensureSheet_(SHEET_NAMES.DECISION_OUTCOMES, DECISION_OUTCOME_HEADERS);
  ensureSheet_(SHEET_NAMES.FEEDBACK_SAMPLES, FEEDBACK_SAMPLE_HEADERS);
  ensureSheet_(SHEET_NAMES.RULE_SCORECARD, RULE_SCORECARD_HEADERS);
  ensureSheet_(SHEET_NAMES.EVALUATION_ELIGIBILITY, EVALUATION_ELIGIBILITY_HEADERS);
  ensureSheet_(SHEET_NAMES.OUTCOME_DELTA, OUTCOME_DELTA_HEADERS);
  ensureSheet_(SHEET_NAMES.EFFECT_EVALUATION, EFFECT_EVALUATION_HEADERS);
  ensureEffectEvaluationHeader_();
  ensureSheet_(SHEET_NAMES.TODAY_ACTIONS, TODAY_ACTION_HEADERS);
  ensureTodayActionHeader_();
  ensureSheet_(SHEET_NAMES.OPPORTUNITIES, OPPORTUNITY_HEADERS);
  ensureSheet_(SHEET_NAMES.DEMAND_RADAR, DEMAND_RADAR_HEADERS);
  ensureDemandRadarHeader_();
  ensureSheet_(SHEET_NAMES.FRESH_QUERY_MONITOR, FRESH_QUERY_MONITOR_HEADERS);
  ensureSheet_(SHEET_NAMES.RESEARCH_JOBS, RESEARCH_JOB_HEADERS);
  ensureSheet_(SHEET_NAMES.RESEARCH_REVIEW, RESEARCH_REVIEW_HEADERS);
  ensureSheet_(SHEET_NAMES.DEVELOPMENT_TASKS, DEVELOPMENT_TASK_HEADERS);
  ensureSheet_(SHEET_NAMES.CONTENT_UPDATES, CONTENT_UPDATE_HEADERS);
  ensureContentUpdateHeader_();

  // 不 ensure PAGE_OPPORTUNITIES：旧实验页只识别/排序/隐藏，不新建
  ensureUsageGuideSheet_();
  ensureMetricGuideSheet_();

  seedSitesIfEmpty_();
  seedMissingDecisionRules_();
  applyTodayActionValidation_();
  ensureResearchJobResultColumns_(
    getSpreadsheet_().getSheetByName(SHEET_NAMES.RESEARCH_JOBS)
  );
  applyResearchReviewDecisionValidation_();
  ensureDevelopmentTaskHeader_();

  organizeSheetUi_();

  writeLog_('INFO', '', 'setup 完成：工作表已就绪');
}

function seedSitesIfEmpty_() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.SITES);
  if (!sheet) return;
  if (sheet.getLastRow() > 1) return; // 已有数据，不覆盖

  var rows = DEFAULT_SITES.map(function (s) {
    return [
      s.name,
      normalizePropertyUrlForGsc_(s.propertyUrl),
      defaultSitemapUrl_(s.propertyUrl),
      '', // Day0 留空
      true
    ];
  });
  if (rows.length === 0) return;

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(2, 5, rows.length, 1).insertCheckboxes();
}

/**
 * 读取启用的站点配置
 * @return {Array<Object>}
 */
function getEnabledSites() {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.SITES);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var values = sheet.getRange(2, 1, sheet.getLastRow(), SITE_HEADERS.length).getValues();
  var sites = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var name = String(row[0] || '').trim();
    var propertyUrl = String(row[1] || '').trim();
    if (!name || !propertyUrl) continue;

    var enabled = row[4];
    if (enabled === false || enabled === 'FALSE' || enabled === 'false' || enabled === 0) {
      continue;
    }

    var day0 = row[3];
    var day0Str = toDateStr_(day0);

    var sitemapUrl = String(row[2] || '').trim() || defaultSitemapUrl_(propertyUrl);

    sites.push({
      name: name,
      propertyUrl: normalizePropertyUrlForGsc_(propertyUrl),
      sitemapUrl: sitemapUrl,
      day0: day0Str,
      rowIndex: i + 2
    });
  }
  return sites;
}

/**
 * 按唯一键 upsert：keyFn(rowValues) -> string
 * headers 对应列顺序；row 为与 headers 对齐的数组
 * @return {{rowIndex:number, action:string}} action = 'insert' | 'update'
 */
function upsertRow_(sheetName, headers, row, keyFn) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) {
    sheet = ensureSheet_(sheetName, headers);
  }

  var lastRow = sheet.getLastRow();
  var key = keyFn(row);

  if (lastRow >= 2) {
    var existing = sheet.getRange(2, 1, lastRow, headers.length).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (keyFn(existing[i]) === key) {
        sheet.getRange(i + 2, 1, 1, headers.length).setValues([row]);
        return { rowIndex: i + 2, action: 'update' };
      }
    }
  }

  sheet.appendRow(row);
  return { rowIndex: sheet.getLastRow(), action: 'insert' };
}

function upsertDailyRow_(row) {
  return upsertRow_(SHEET_NAMES.DAILY, DAILY_HEADERS, row, function (r) {
    return normalizeKeyDate_(r[0]) + '||' + String(r[1] || '');
  });
}

function upsertQueryRow_(row) {
  return upsertRow_(SHEET_NAMES.QUERIES, QUERY_HEADERS, row, function (r) {
    return normalizeKeyDate_(r[0]) + '||' + String(r[1] || '') + '||' + String(r[2] || '');
  });
}

/** 唯一键：DataDate + Site + PageURL */
function upsertPageRow_(row) {
  return upsertRow_(SHEET_NAMES.PAGES, PAGE_HEADERS, row, function (r) {
    return (
      normalizeKeyDate_(r[0]) +
      '||' +
      String(r[1] || '') +
      '||' +
      String(r[2] || '')
    );
  });
}

/** 唯一键：DataDate + Site + Query + PageURL */
function upsertQueryPageRow_(row) {
  return upsertRow_(SHEET_NAMES.QUERY_PAGES, QUERY_PAGE_HEADERS, row, function (r) {
    return (
      normalizeKeyDate_(r[0]) +
      '||' +
      String(r[1] || '') +
      '||' +
      String(r[2] || '') +
      '||' +
      String(r[3] || '')
    );
  });
}

function appendSnapshotRow_(row) {
  // RunDate + Site 唯一：已存在则更新，不重复 append
  upsertRow_(SHEET_NAMES.SNAPSHOT, SNAPSHOT_HEADERS, row, function (r) {
    return normalizeKeyDate_(r[0]) + '||' + String(r[2] || '');
  });
}

function appendUrlIndexRow_(row) {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.URL_INDEX);
  if (!sheet) sheet = ensureSheet_(SHEET_NAMES.URL_INDEX, URL_INDEX_HEADERS);
  sheet.appendRow(row);
}

/**
 * 从「URL索引」读取某站当前 IndexedURLCount。
 * 按 URL 去重，每个 URL 只取最新一条记录；Verdict === PASS 才计入。
 * 无历史时返回 null（调用方应留空，不要写成 0）。
 * IndexRate 由调用方用 IndexedURLCount / SitemapURLCount 重算。
 * @return {{indexedCount:number, urlCount:number}|null}
 */
function getLatestKnownIndexStats_(siteName) {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.URL_INDEX);
  if (!sheet || sheet.getLastRow() < 2) return null;

  var rows = sheet.getRange(2, 1, sheet.getLastRow(), URL_INDEX_HEADERS.length).getValues();
  // url -> { date, verdict, rowIndex }
  var byUrl = {};
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][1]) !== siteName) continue;
    var url = String(rows[i][2] || '').trim();
    if (!url) continue;
    var d = normalizeKeyDate_(rows[i][0]);
    if (!d) continue;
    var prev = byUrl[url];
    if (!prev || d > prev.date || (d === prev.date && i > prev.rowIndex)) {
      byUrl[url] = {
        date: d,
        verdict: String(rows[i][3] || ''),
        rowIndex: i
      };
    }
  }

  var urls = Object.keys(byUrl);
  if (!urls.length) return null;

  var indexedCount = 0;
  for (var k = 0; k < urls.length; k++) {
    if (byUrl[urls[k]].verdict === 'PASS') indexedCount++;
  }

  return {
    indexedCount: indexedCount,
    urlCount: urls.length
  };
}

function normalizeKeyDate_(v) {
  if (v instanceof Date) return formatDate_(v);
  return String(v || '').trim().substring(0, 10);
}

/**
 * 从历史「每日快照」或「GSC日数据」读取已知 FirstImpressionDate
 */
function getKnownFirstImpressionDate_(siteName) {
  var ss = getSpreadsheet_();

  // 优先从每日快照倒序找非空值
  var snap = ss.getSheetByName(SHEET_NAMES.SNAPSHOT);
  if (snap && snap.getLastRow() >= 2) {
    var data = snap.getRange(2, 1, snap.getLastRow(), SNAPSHOT_HEADERS.length).getValues();
    for (var i = data.length - 1; i >= 0; i--) {
      if (String(data[i][2]) === siteName) {
        var fid = data[i][13];
        if (fid instanceof Date) return formatDate_(fid);
        if (fid) return String(fid).trim().substring(0, 10);
      }
    }
  }

  // 从 GSC日数据找最早 Impressions > 0
  var daily = ss.getSheetByName(SHEET_NAMES.DAILY);
  if (daily && daily.getLastRow() >= 2) {
    var rows = daily.getRange(2, 1, daily.getLastRow(), DAILY_HEADERS.length).getValues();
    var earliest = null;
    for (var j = 0; j < rows.length; j++) {
      if (String(rows[j][1]) !== siteName) continue;
      var impressions = Number(rows[j][3] || 0);
      if (impressions <= 0) continue;
      var d = normalizeKeyDate_(rows[j][0]);
      if (!earliest || d < earliest) earliest = d;
    }
    if (earliest) return earliest;
  }

  return '';
}

/**
 * 获取某站在某个数据日期之前，最近一个有 GSC 日数据的日期
 */
function getPreviousDataDate_(siteName, currentDataDate) {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.DAILY);
  if (!sheet || sheet.getLastRow() < 2) return '';

  var rows = sheet.getRange(2, 1, sheet.getLastRow(), DAILY_HEADERS.length).getValues();
  var prev = '';
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][1]) !== siteName) continue;
    var d = normalizeKeyDate_(rows[i][0]);
    if (d && d < currentDataDate && d > prev) prev = d;
  }
  return prev;
}

/**
 * 读取某站某日已保存的 Query 集合
 * @return {Object} query -> true
 */
function getSavedQueriesForDate_(siteName, dataDate) {
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.QUERIES);
  var map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;

  var rows = sheet.getRange(2, 1, sheet.getLastRow(), QUERY_HEADERS.length).getValues();
  var target = normalizeKeyDate_(dataDate);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][1]) !== siteName) continue;
    if (normalizeKeyDate_(rows[i][0]) !== target) continue;
    var q = String(rows[i][2] || '');
    if (q) map[q] = true;
  }
  return map;
}

/**
 * 按 Header 名对数据行排序（不含第 1 行 Header；不删 Filter、不改 cell 值）。
 * sortSpecs: [{ header: 'DataDate', ascending: false }, ...]
 * Primary header 缺失 → throw；secondary 缺失 → 跳过。
 */
function sortSheetByHeaders_(sheetName, sortSpecs) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;

  if (!sortSpecs || !sortSpecs.length) return;

  var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var colByHeader = {};
  for (var h = 0; h < headerRow.length; h++) {
    var name = String(headerRow[h] || '').trim();
    if (name) colByHeader[name] = h + 1;
  }

  var primaryName = sortSpecs[0].header;
  if (!colByHeader[primaryName]) {
    throw new Error('SORT primary header missing: ' + primaryName + ' on ' + sheetName);
  }

  var keys = [];
  for (var i = 0; i < sortSpecs.length; i++) {
    var spec = sortSpecs[i];
    var col = colByHeader[spec.header];
    if (!col) {
      if (i === 0) {
        throw new Error('SORT primary header missing: ' + spec.header + ' on ' + sheetName);
      }
      continue;
    }
    keys.push({
      column: col,
      ascending: !!spec.ascending
    });
  }

  if (!keys.length) return;
  var numRows = lastRow - 1;
  ensureSheetGrid_(sheet, lastRow, lastCol);
  sheet.getRange(2, 1, numRows, lastCol).sort(keys);
}

/** 监控历史表「最新在前」的默认排序规格（不含站点配置等人工表） */
function getMonitoringSortSpecs_() {
  var specs = {};
  specs[SHEET_NAMES.SNAPSHOT] = [
    { header: 'RunDate', ascending: false },
    { header: 'Site', ascending: true }
  ];
  specs[SHEET_NAMES.DAILY] = [
    { header: 'DataDate', ascending: false },
    { header: 'Site', ascending: true }
  ];
  specs[SHEET_NAMES.QUERIES] = [
    { header: 'DataDate', ascending: false },
    { header: 'Site', ascending: true },
    { header: 'Impressions', ascending: false },
    { header: 'AveragePosition', ascending: true }
  ];
  specs[SHEET_NAMES.PAGES] = [
    { header: 'DataDate', ascending: false },
    { header: 'Site', ascending: true },
    { header: 'Impressions', ascending: false },
    { header: 'Position', ascending: true }
  ];
  specs[SHEET_NAMES.QUERY_PAGES] = [
    { header: 'DataDate', ascending: false },
    { header: 'Site', ascending: true },
    { header: 'Impressions', ascending: false },
    { header: 'AveragePosition', ascending: true }
  ];
  specs[SHEET_NAMES.URL_INDEX] = [
    { header: 'RunDate', ascending: false },
    { header: 'Site', ascending: true }
  ];
  specs[SHEET_NAMES.LOG] = [
    { header: 'Timestamp', ascending: false }
  ];
  return specs;
}

/**
 * 对指定监控 Sheet（或全部监控历史表）按「最新在前」排序一次。
 * 单表失败记录完整 stack 后 throw，避免后处理带着坏范围继续写。
 * @param {Array<string>=} sheetNames 省略则排序全部监控历史表
 */
function sortSheetsNewestFirst_(sheetNames) {
  var allSpecs = getMonitoringSortSpecs_();
  var names = sheetNames && sheetNames.length
    ? sheetNames
    : [
        SHEET_NAMES.SNAPSHOT,
        SHEET_NAMES.DAILY,
        SHEET_NAMES.QUERIES,
        SHEET_NAMES.PAGES,
        SHEET_NAMES.QUERY_PAGES,
        SHEET_NAMES.URL_INDEX,
        SHEET_NAMES.LOG
      ];

  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var specs = allSpecs[name];
    if (!specs) {
      Logger.log('SORT_SKIP | ' + name + ' | not a monitoring history sheet');
      continue;
    }
    try {
      sortSheetByHeaders_(name, specs);
      Logger.log('SORT_OK | ' + name);
    } catch (e) {
      Logger.log('SORT_FAILED | ' + name + ' | ' + formatErrorWithStack_(e));
      throw e;
    }
  }
}

/** 全部监控历史表最新在前（内部） */
function sortMonitoringSheetsNewestFirst_() {
  sortSheetsNewestFirst_();
}
