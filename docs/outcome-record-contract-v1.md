# Phase 6B-4A — Outcome Record Contract Validation

审计日期：2026-08-22

## Scope

本文件只记录当前 `决策结果` / Outcome 结构审计与未来 Outcome V1 的字段契约设计。
本阶段不创建 Outcome，不写入 Google Sheet，不修改 Decision、Intervention、页面、Steam、Control Center、Apps Script runtime 或同步系统。

本次审计依据仓库中的 Apps Script schema、读写路径和本地 validation tests。未通过远端 Sheet 运行时读取现有数据行，因此不对当前 Sheet 的实际行数或已有结果值作断言。

## Current Outcome Status

| 项目 | 当前结论 |
| --- | --- |
| Outcome storage | 已有：`决策结果` Sheet，由 `DECISION_OUTCOME_HEADERS` 定义；`setup()` 会确保该 Sheet 存在。 |
| Existing fields | 19 列，见下方字段表。 |
| DecisionID support | 有。观察入口从 `决策历史` 读取 Decision，再按 `DecisionID + Horizon` 规划追加。 |
| InterventionID support | 无。`内容更新记录` 当前只有 `DecisionID`，没有 `InterventionID`。 |
| Available metrics | Outcome 当前写入窗口曝光、窗口点击、Query 计数、Guide Query 计数、Top50/Top20 Query 计数、BestPosition、IndexedURLCount、IndexRate。 |
| Evaluation window support | 有限支持：`D7/D14/D30`、`TargetDate`、`ObservedDataDate`、`ObservedAt` 已存在；没有独立的 `evaluation_date`。 |
| Human assessment | 无 `success/neutral/negative` 字段，也没有人工评估入口。现有 `EffectEvaluation` 只做 eligibility/readiness/evidence，不做成败判断。 |
| Current gaps | 缺 `outcome_id`、`intervention_id`、`site_id`、`lifecycle`、`evaluation_date`、CTR、AveragePosition、related queries、query expansion、page impressions、人工 assessment。 |

## Current Storage Map

| 层 | 当前位置 | 关联方式 | 本轮结论 |
| --- | --- | --- | --- |
| Decision | `决策历史` | `DecisionID` | 已有稳定 ID；Decision History 还保存 `LifecycleStage` 和决策前 7D baseline。 |
| Intervention | `内容更新记录` | 可选 `DecisionID` | 是实际改站事实表；没有独立 Intervention ID。旧记录允许空 DecisionID，不补造历史关联。 |
| Outcome observation | `决策结果` | `DecisionID + Horizon` | 已有观察存储和人工菜单入口；当前观察的是推荐机会后表现，不含 Intervention 归因字段。 |
| Raw GSC facts | `GSC日数据` / `Query明细` / `Page明细` / `Query页面明细` / `每日快照` | `Site`、日期、Query/Page 复合键 | 原始 CTR、AveragePosition、Page impressions 等可用，但尚未完整投影进 Outcome。 |
| Derived views | `反馈样本` / `评价资格` / `效果变化` / `效果评价` | 以 `DecisionID` join | 可用于事实阶段、资格和可比性；不是 Outcome 事实源，也不产生 success/neutral/negative。 |

## Current `决策结果` Fields

当前 19 列顺序如下：

`DecisionID`, `Site`, `RuleVersion`, `RecommendedAction`, `DecisionDataDate`, `Horizon`, `TargetDate`, `ObservedDataDate`, `ObservationStatus`, `ImpressionsWindow`, `ClicksWindow`, `QueryCount`, `GuideQueryCount`, `Top50QueryCount`, `Top20QueryCount`, `BestPosition`, `IndexedURLCount`, `IndexRate`, `ObservedAt`。

当前观察逻辑：

- 只从已有 `决策历史` 读取 Decision；不从 Outcome 反推 Decision。
- `Horizon` 为 `D7`、`D14`、`D30`，目标日期相对 `DecisionDataDate` 加 7/14/30 天。
- Outcome 窗口为 `TargetDate−6 … TargetDate`，包括两端。
- 数据未成熟时保持 pending 规划，不落 Outcome 行。
- 当前写入入口是独立的 `runDecisionOutcomeObservation()`，没有接入 `runDaily()`。

## Metric Availability

| 指标 | 原始 Sheet 可用性 | 当前 Outcome 字段 | V1 结论 |
| --- | --- | --- | --- |
| clicks | `GSC日数据` 可用 | `ClicksWindow` | 保留为 primary。 |
| impressions | `GSC日数据` 可用 | `ImpressionsWindow` | 保留为 primary。 |
| CTR | `GSC日数据` / Query / Page 可用 | 无 | V1 增加 `ctr`，口径需明确为窗口 clicks / impressions。 |
| average position | Query/Page 原始字段可用 | 只有 `BestPosition` | V1 增加 `average_position`；不得把 BestPosition 冒充 AveragePosition。 |
| related queries | Query 明细可枚举 | 无 | V1 允许结构化或稳定序列化字段；当前不回填。 |
| query expansion | 可由 Query 窗口与 baseline 对比计算 | 无 | V1 增加明确的 `query_expansion` 记录；不要由 Outcome 自动判定好坏。 |
| page impressions | Page / Query页面明细可用 | 无 | V1 增加 page-level 记录或受控序列化字段；当前不写入。 |

## Outcome V1 Contract（设计，不启用）

未来若进入 Runtime Adoption，`决策结果` 的 Outcome 事实行至少应支持下列字段。字段名为契约名，不代表本阶段要把它们加到 Sheet。

| 分组 | 字段 | 要求 |
| --- | --- | --- |
| Identity | `outcome_id` | 必填、唯一、不可变；区分不同评估记录。 |
| Identity | `decision_id` | 必填；必须精确匹配 `决策历史.DecisionID`。 |
| Identity | `intervention_id` | Attribution Outcome 必填；必须精确匹配实际 Intervention 事实。无法关联时不得猜测或补造。 |
| Identity | `site_id` | 必填；使用稳定站点身份，不以显示名称替代。 |
| Identity | `lifecycle` | 必填；记录该 Outcome 所属生命周期。不要从 Outcome 反推 Decision。 |
| Evaluation | `evaluation_date` | 必填；记录人工/系统完成该次评估的日期，与数据观察日期分开。 |
| Evaluation | `horizon` | 枚举 `D7` / `D14` / `D30`。 |
| Metrics | `clicks` | Primary；保留数值及窗口口径。 |
| Metrics | `impressions` | Primary；保留数值及窗口口径。 |
| Metrics | `ctr` | Primary；必须能区分原始窗口 CTR 与计算口径。 |
| Metrics | `average_position` | Primary；使用 AveragePosition 口径，不能复用 BestPosition。 |
| Metrics | `related_queries` | Secondary；记录相关 Query 集合或受控序列化结果。 |
| Metrics | `query_expansion` | Secondary；记录 Query 集合相对 baseline 的扩展事实，不自动转成好坏。 |
| Metrics | `page_impressions` | Secondary；记录目标页或页面集合的曝光事实。 |
| Assessment | `assessment` | 可空，人工填写枚举 `success` / `neutral` / `negative`；本字段禁止自动判断。 |

建议保留 `observation_status`、`observed_data_date`、窗口起止日期和数据来源元数据，以便审计数据成熟度与重现口径；这些属于后续字段扩展，不在本阶段落表。

## Attribution Rules

```text
Decision (decision_id)
        ↓ exact foreign-key validation
Intervention (intervention_id)
        ↓ exact foreign-key validation
Outcome (outcome_id)
```

规则：

1. Outcome 不允许没有 `decision_id`。
2. Attribution Outcome 不允许没有 `intervention_id`。
3. `decision_id` 必须先存在于 Decision History；未知 ID 不写入 Outcome。
4. `intervention_id` 必须先存在于实际 Intervention 事实；未知 ID 不写入 Outcome。
5. 不从 Outcome 反推 Decision 或 Intervention。
6. 历史缺失关联保持缺失，不补造、不猜测、不回填伪 ID。
7. 同一 `outcome_id` 不重复；同一 Decision 的不同 Horizon 必须可区分。
8. `assessment` 只记录人工选择，不由点击、曝光、CTR、排名或内部规则自动推断。

## Gaps and Adoption Boundary

当前已有 Outcome observation storage，但不是满足 Attribution Pilot 的完整 Outcome V1 Contract。主要缺口是独立 Outcome/Intervention identity、稳定 `site_id`、独立评估日期、完整 primary/secondary 指标和人工 assessment。

当前已有人工流程只覆盖：

- 人工在 `今日行动` 上填写/同步 `HumanDecision`；
- 人工显式记录实际内容更新到 `内容更新记录`；
- 人工菜单触发已有 Outcome observation。

当前没有：

- Outcome 的人工 `success/neutral/negative` 评估流程；
- `InterventionID → Outcome` 的 runtime join；
- Outcome V1 字段的 runtime adoption。

因此本阶段停止在 Contract Validation；不得进入 Outcome Runtime Adoption。

## Verification

本地只读 validation 全部通过：

- `node scripts/test-decision-history.js`
- `node scripts/test-sheet-range.js`
- `node scripts/test-site-identity.js`
- `node scripts/test-content-intervention-binding.js`
- `node scripts/test-decision-outcomes.js`

本文件不创建 Outcome、不修改 Sheet 数据、不修改 runtime。
