/**
 * M0-1 / M1-2 本地纯函数自测：Sheet UI 顺序。
 * 运行：node scripts/test-sheet-ui-order.js
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

var SHEET_UI_ORDER = [
  '使用说明',
  '指标说明',
  '今日行动',
  '每日快照',
  '内容机会',
  '需求雷达',
  '实时Query监控',
  '研究任务',
  '研究审核',
  '站点状态',
  '站点经营',
  '内容资产',
  '决策历史',
  '决策结果',
  '反馈样本',
  '规则评分卡',
  '评价资格',
  '效果变化',
  '效果评价',
  '规则配置',
  'GSC日数据',
  'Query明细',
  'Page明细',
  'Query页面明细',
  'URL索引',
  '运行日志',
  'PAGE_OPPORTUNITIES'
];

var SHEET_UI_TRAILING_ORDER = ['站点配置', '开发任务', '内容更新记录'];

function assertEqual(actual, expected, label) {
  var a = actual.join('|');
  var e = expected.join('|');
  if (a !== e) {
    throw new Error(label + '\n expected: ' + e + '\n actual:   ' + a);
  }
}

var scrambled = [
  '运行日志',
  '站点配置',
  '今日行动',
  'PAGE_OPPORTUNITIES',
  '内容机会',
  '需求雷达',
  '实时Query监控',
  '使用说明',
  '指标说明',
  '决策历史',
  '决策结果',
  '反馈样本',
  '规则评分卡',
  '评价资格',
  '效果变化',
  '效果评价',
  'GSC日数据',
  '开发任务',
  '神秘旧表',
  '每日快照',
  '研究任务',
  '研究审核',
  '站点状态',
  '站点经营',
  '内容资产',
  '规则配置',
  'Query明细',
  'Page明细',
  'Query页面明细',
  'URL索引',
  '内容更新记录'
];

var ordered = buildSheetUiOrder_(
  scrambled,
  SHEET_UI_ORDER,
  SHEET_UI_TRAILING_ORDER
);

assertEqual(
  ordered,
  [
    '使用说明',
    '指标说明',
    '今日行动',
    '每日快照',
    '内容机会',
    '需求雷达',
    '实时Query监控',
    '研究任务',
    '研究审核',
    '站点状态',
    '站点经营',
    '内容资产',
    '决策历史',
    '决策结果',
    '反馈样本',
    '规则评分卡',
    '评价资格',
    '效果变化',
    '效果评价',
    '规则配置',
    'GSC日数据',
    'Query明细',
    'Page明细',
    'Query页面明细',
    'URL索引',
    '运行日志',
    'PAGE_OPPORTUNITIES',
    '站点配置',
    '开发任务',
    '内容更新记录',
    '神秘旧表'
  ],
  'full order with trailing + unknown'
);

// missing preferred sheets should be skipped, not created in the order list
var partial = buildSheetUiOrder_(
  ['今日行动', '站点配置', 'GSC日数据'],
  SHEET_UI_ORDER,
  SHEET_UI_TRAILING_ORDER
);
assertEqual(
  partial,
  ['今日行动', 'GSC日数据', '站点配置'],
  'partial existing set'
);

// PAGE_OPPORTUNITIES absent → not invented
var noLegacy = buildSheetUiOrder_(
  ['使用说明', '指标说明', '今日行动', '站点配置'],
  SHEET_UI_ORDER,
  SHEET_UI_TRAILING_ORDER
);
assertEqual(
  noLegacy,
  ['使用说明', '指标说明', '今日行动', '站点配置'],
  'does not invent PAGE_OPPORTUNITIES'
);

// 指标说明应紧跟使用说明
var metricsPos = SHEET_UI_ORDER.indexOf('指标说明');
if (metricsPos !== 1 || SHEET_UI_ORDER[0] !== '使用说明') {
  throw new Error('指标说明 must be index 1 after 使用说明');
}
if (SHEET_UI_ORDER.indexOf('PAGE_OPPORTUNITIES') < 0) {
  throw new Error('PAGE_OPPORTUNITIES must remain in UI order (hidden separately)');
}

console.log('PASS scripts/test-sheet-ui-order.js');
