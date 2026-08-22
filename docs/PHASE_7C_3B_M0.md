# Phase 7C-3B M0 — External Opportunity Merge

## Ownership

`gsc_hotword_monitor` is the Opportunity Merge Owner. `hotword-engine` remains
the External Research Executor. Control Center only records the architecture
contract; it is not a runtime writer.

The merge is additive to the existing `内容机会` Sheet. It does not create a
new Sheet or database, and it does not replace GSC ingestion.

## Input gate

Only a Research Result or callback with both of these values is accepted:

```text
research_type = DEMAND_DISCOVERY
discovery_scope = GAME_WIDE
```

The callback's `top_clusters` is sufficient for M0. The full
`game_wide_social_result.json` may also be passed as `clusters`. GSC demand is
read from the existing `Query明细` / `Query页面明细` Sheets, and existing
content is read from the existing `内容资产` Sheet.

## Merge contract

Each accepted external cluster becomes one candidate with these fields:

| Field | Meaning |
| --- | --- |
| `OpportunityID` | Stable ID produced by the existing `buildOpportunityIdFromRadarId_` rule using the canonical `game|cluster` key. |
| `Game` | Game identity from the Research Job/result. |
| `OpportunityType` | `NEW_PAGE_CANDIDATE`, `EXPAND_EXISTING`, or `WATCH`. |
| `ExternalEvidence` | Cluster topic, questions, source families/providers, URLs, count, and Research source reference. |
| `GSCEvidence` | Matching existing GSC query/page rows and snapshot metrics. |
| `ExistingAsset` | Matching existing content asset, or `null`. |
| `Confidence` | `HIGH`, `MEDIUM`, or `LOW`. |
| `RecommendedAction` | Same M0 candidate classification; it is not an execution command. |
| `SourceReference` | Research result/callback reference. |

Classification is intentionally deterministic:

```text
External + GSC + Existing Asset → EXPAND_EXISTING / HIGH
External + GSC                  → NEW_PAGE_CANDIDATE / MEDIUM
External only                   → WATCH / LOW
```

No Decision, BUILD, UPDATE, page generation, SERP Top10, scoring system, or
Publishing transition is performed.

## Entrypoints

- `runExternalOpportunityMergeM0(researchInput, options)` — explicit manual/M0
  entry; `options.gsc` and `options.assets` are test/fixture overrides.
- `mergeGameWideResearchResultM0_` — acceptance alias.
- A completed GAME_WIDE callback invokes the same merge after the Research Job
  row is updated. A merge failure is logged and does not rewrite the Research
  Job result.

The legacy GSC-only Opportunity refresh preserves M0 rows and uses the same
`内容机会` Sheet, so a daily finalizer does not create a second candidate for
the same OpportunityID.
