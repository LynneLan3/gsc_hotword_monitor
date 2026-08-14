# 7站 GSC 每日数据自动汇总 → Google Sheet

面向产品同学的安装说明。最终只在 **Google Sheet + Google Apps Script** 里运行，不需要服务器、不需要写代码能力。

---

## 这个脚本做什么

每天自动读取 7 个热词站在 Google Search Console 的：

- 曝光 / 点击 / CTR / 平均排名
- Top Query / Top Page
- 新出现的 Query（提醒人工看）
- Sitemap URL 数量
- URL 索引状态（URL Inspection）

并写入同一个 Google Sheet。

**不会**自动提交索引、不会自动建页、不会改网站。

---

## 你需要提前准备

1. 一个 Google 账号
2. 这个账号在 Google Search Console 里，对下面 7 个 URL-prefix 站点至少有**读取**权限：
   - `https://agefield-high-rock-the-school.vercel.app/`
   - `https://mortal-shell-ii.vercel.app/`
   - `https://beast-link.vercel.app/`
   - `https://sovereign-tower.vercel.app/`
   - `https://approximately-up.vercel.app/`
   - `https://grainrot.vercel.app/`
   - `https://leafy-corner.vercel.app/`
3. 一台电脑 + 浏览器

---

## 第 1 步：打开 Google Cloud，启用 Search Console API

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)
2. 左上角选择或创建一个项目（名字随意，例如 `gsc-hotword-monitor`）
3. 搜索栏输入：`Google Search Console API`
4. 进入后点击 **启用 / Enable**
5. 再搜索：`Search Console API`（有的界面显示为 Google Search Console API，同一个即可）
   - 确认状态是「已启用」

说明：本脚本**不使用** Service Account。授权时会弹出 Google 登录页，用你自己的账号同意即可。

---

## 第 2 步：新建 Google Sheet

1. 打开 [Google 表格](https://sheets.google.com/)
2. 新建空白电子表格
3. 改个名字，例如：`热词站 GSC 监控`

---

## 第 3 步：打开 Apps Script

1. 在刚建好的 Sheet 顶部菜单点：**扩展程序 → Apps Script**
2. 会打开一个新的脚本编辑器页面
3. 左侧默认有一个 `代码.gs`（或 `Code.gs`）

---

## 第 4 步：把本仓库的文件复制进去

请在 Apps Script 左侧创建这些文件（点 **+** → **脚本**），并复制粘贴对应内容：

| 本地文件 | Apps Script 中的文件名 |
|---|---|
| `Code.gs` | `Code`（或覆盖默认的代码.gs） |
| `Config.gs` | `Config` |
| `SearchConsole.gs` | `SearchConsole` |
| `SheetManager.gs` | `SheetManager` |
| `DecisionEngine.gs` | `DecisionEngine` |
| `Utils.gs` | `Utils` |

注意：

- Apps Script 里文件名一般不需要写 `.gs` 后缀
- 每个文件内容完整粘贴覆盖
- 不要漏文件

---

## 第 5 步：显示并替换 appsscript.json（清单文件）

1. 在 Apps Script 编辑器左侧，点齿轮图标 **项目设置**
2. 勾选：**在编辑器中显示「appsscript.json」清单文件**
3. 回到左侧文件列表，会出现 `appsscript.json`
4. 用本仓库的 `appsscript.json` **整份替换**

它会设置：

- 运行时：V8
- 时区：`Asia/Shanghai`
- 只读 Search Console 权限
- 当前表格读写权限
- 外部请求权限
- Trigger 权限

保存（Ctrl/Cmd + S）。

---

## 第 6 步：第一次运行 `setup()`

1. 在 Apps Script 顶部函数下拉框选择 `setup`
2. 点 **运行**
3. 第一次会弹出授权：

### 如何处理 Google 授权页

1. 点 **审核权限**
2. 选择你的 Google 账号（必须是对那 7 个 GSC 站点有权限的账号）
3. 若出现「此应用未经验证」：
   - 点左侧 **高级**
   - 再点 **转至 xxx（不安全）**
   - 这是你自己的脚本，绑定在你自己的表格上，正常现象
4. 勾选所需权限，点 **允许**

授权成功后，回到 Sheet，应看到这些工作表：

- 站点配置
- 每日快照
- GSC日数据
- Query明细
- Query页面明细
- URL索引
- 运行日志
- 规则配置
- 站点状态
- 今日行动

**Query页面明细**：记录 GSC Fresh Query 与实际 Landing Page 的联合维度数据。字段为 `DataDate / Site / Query / PageURL / PagePath / Clicks / Impressions / CTR / AveragePosition`。用于判断某个 Query 当前由哪个页面获得曝光（`dataState=all`，近 `FRESH_QUERY_DAYS` 天）。

「站点配置」会预填 7 个站。`Enabled` 默认勾选。`Day0` 先是空的。

也可以用 Sheet 顶部菜单：**热词站监控 → 初始化表格**（首次打开 Sheet 后刷新一次页面，菜单才会出现）。

---

## 第 7 步：运行 `testGscAccess()` 检查权限

1. 函数下拉框选择 `testGscAccess`
2. 点运行
3. 看弹窗，或打开：**执行 → 执行记录**，查看 Logger

期望看到：

```text
PASS:
7/7 GSC properties accessible
```

如果是：

```text
FAIL:
5/7
Missing:
https://xxx.vercel.app/
```

说明当前登录账号对 Missing 列表里的站点没有 GSC 权限。请到 [Search Console](https://search.google.com/search-console) 把该账号加成用户（至少「完整」或「受限」读取权限）。

此函数只读，不会改任何 GSC 数据。

---

## 第 8 步：填写 Day0（重要，但可稍后填）

打开「站点配置」Sheet。

**Day0 = 这个站正式开始当前 SEO 实验的日期。**

格式示例：

```text
2026-08-10
```

说明：

- Day0 **不要猜**，按你真实开实验的日期填
- 不填也可以每天跑；只是「每日快照」里的 `Day` 会空着
- 填了之后，脚本才可能去找 `FirstImpressionDate`（第一次有曝光的日期）

---

## 第 9 步：手动跑一次 `runDaily()`

1. 函数下拉框选 `runDaily`，或菜单：**热词站监控 → 立即运行一次**
2. 等待执行结束（7 个站 + URL Inspection，可能要几分钟）
3. 去检查：

| 工作表 | 你应该看到 |
|---|---|
| 每日快照 | 每个启用站新增 1 行 |
| GSC日数据 | 按「站点 + 日期」写入/更新 |
| Query明细 | 最多每站每天 1000 条 query |
| URL索引 | sitemap 里每个 URL 一行检查结果 |
| 站点状态 | 每个启用站 1 行最新决策指标（不追加历史） |
| 今日行动 | 仅写入需要人工处理的站；`WAIT` / `NO_ACTION` 不会出现 |
| 运行日志 | INFO / WARN / ERROR |

注意：Search Console Performance 数据通常有延迟，脚本会自动在最近 10 天里找「最新有数据的日期」，**不要假设昨天一定有数据**。

---

## 第 10 步：首次回填最近 14 天（可选，建议做一次）

菜单：**热词站监控 → 回填最近14天GSC数据**

或运行函数 `backfill14Days`。

作用：把各站最近约 14 天已有的点击/曝光/Query 历史写入「GSC日数据」「Query明细」。  
同一 `Site + DataDate` 会更新，不会重复堆很多行。

这一步**不需要每天跑**。

---

## 第 11 步：创建每日自动任务

菜单：**热词站监控 → 创建每日自动任务**

或运行 `createDailyTrigger`。

- 每天大约早上 8 点（时区 Asia/Shanghai）执行 `runDaily`
- 如果已经有同名任务，不会重复创建

取消：

菜单：**热词站监控 → 删除每日自动任务**

只删除 `runDaily` 对应任务，不影响你其他脚本触发器。

---

## 常见问题

### 1）401 / 403

含义：当前账号未授权，或对某个 property 没权限，或 OAuth scope 不够。

处理：

1. 确认 `appsscript.json` 已正确替换并保存
2. 重新运行任意函数，再次走授权
3. 运行 `testGscAccess()` 看缺哪些站
4. 到 Search Console 给该 Google 账号加权限

### 2）API not enabled / 相关 API 未启用

含义：Google Cloud 项目没启用 Search Console API。

处理：回到第 1 步启用 API。Apps Script 绑定的 Cloud 项目也需要启用（若提示关联项目，按页面指引关联并启用）。

### 3）某个站报 Sitemap 错误

不会影响其他站。看「运行日志」和「每日快照」的 Error 列。常见原因：sitemap 404、XML 格式异常、站点暂时不可访问。

### 4）URL Inspection 部分失败

只会记录该 URL 的 Error，继续检查其他 URL。429/5xx 会自动有限重试（最多 3 次：约 1s / 2s / 4s）。

### 5）每天跑了，但 GSC日数据没有新增日期

正常。可能 Google 还没发布新一天的数据。脚本会对**同一个 Site + DataDate** 做更新，而不是无限追加重复行。

### 6）Status 是什么意思

| 状态 | 含义 |
|---|---|
| ⚪ 等待索引 | Sitemap 有 URL，但还没有 PASS 索引 |
| 🟡 已索引/等待曝光 | 有索引，但当天曝光为 0 |
| 🟢 已有曝光 | 有曝光 |
| 🔥 出现新Query | 相对上一数据日出现了新 query（最多列 10 个） |
| 🔴 需要检查 | sitemap / API / 权限等出错 |

这些状态只是提醒，**不会自动决定建站/扩页/淘汰**。

采集完成后，脚本会再跑一层 Decision Engine，把建议写到「站点状态」和「今日行动」。  
「今日行动」的 `Status` 可标 `TODO` / `DONE` / `SKIP`；重新运行不会把已标记的 `DONE` / `SKIP` 改回 `TODO`，人工备注也会保留。阈值在「规则配置」里改，不必改代码。

Decision Engine **不会**买域名、改 DNS、操作 Vercel，也不会再请求 GSC API。只读已写入的 Sheet。若要单独重跑决策：菜单 **热词站监控 → 运行决策引擎**。

### 7）内容机会引擎（M0，独立入口）

`runContentOpportunityEngine` 只读「Query页面明细」，按确定性规则写入「内容机会」。

- **不**接入 `runDaily`（需人工菜单单独运行）
- **不**请求 GSC / 外部 API / LLM
- 每个 Site 只用该站最新有效 `DataDate` 的 Query
- 无 Query 的站点：跳过，不报错，不造假数据
- 幂等：每次运行重建当前机会快照（按最新 DataDate），不会对同一 `DataDate + Site + normalized Query` 无限追加
- Opportunity 的 `RecommendedAction`（如 `RESEARCH_EXPAND_EXISTING`）与 Decision Engine 的站点动作相互独立

菜单：**热词站监控 → 运行内容机会引擎**。本地规则自检可运行 `debugOpportunityEngineSelfCheck`（不写 Sheet）。

---

## 安全说明

- 使用当前执行用户的 OAuth：`ScriptApp.getOAuthToken()`
- **不会**把 token 写入 Sheet、日志或文件
- **不使用** Service Account、API Key、Google 密码
- 权限范围仅只读 Search Console + 当前表格 + 外部请求 + Trigger

---

## 文件一览

| 文件 | 用途 |
|---|---|
| `Code.gs` | 菜单、setup、每日运行、回填、Trigger、权限测试 |
| `Config.gs` | 站点默认配置与表头常量（含 Query页面明细、决策规则/Guide Intent、Opportunity 常量） |
| `SearchConsole.gs` | Search Analytics / Sitemap / URL Inspection |
| `SheetManager.gs` | 建表、读写、按唯一键更新 |
| `DecisionEngine.gs` | 站点状态评分与今日行动（不请求 GSC API） |
| `OpportunityEngine.gs` | 内容机会 M0：Query→Intent/Level/Action（不请求外部 API） |
| `Utils.gs` | `gscFetch`、日期、重试、日志 |
| `appsscript.json` | V8、时区、OAuth scopes |
| `README.md` | 本说明 |

---

## 推荐首次操作顺序（抄这份就行）

1. 启用 Search Console API  
2. 新建 Google Sheet → 打开 Apps Script  
3. 粘贴 7 个 `.gs` + 替换 `appsscript.json`
4. 运行 `setup`  
5. 运行 `testGscAccess`，确认 `7/7`  
6. （可选）在「站点配置」填 Day0  
7. 运行 `runDaily`  
8. （建议）运行 `backfill14Days`  
9. 创建每日自动任务  

完成。之后每天自动汇总即可。
