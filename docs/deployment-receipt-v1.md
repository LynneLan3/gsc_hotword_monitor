# Deployment Receipt V1

`Deployment Receipt` is the machine fact that a production website change happened. The
existing Apps Script Web App dispatches a JSON receipt through `doPost(e)` and keeps the
existing research callback path intact.

## Boundary

- Monitoring creates Signal, Research, Intent, and Goal metadata.
- Codex/other executors build, validate, commit, push, deploy, and submit the receipt.
- Apps Script ingests the receipt and writes the existing `内容更新记录`, `干预时间线`,
  and `干预观察` sheets. It never generates article prose.

## Required receipt fields

`schemaVersion`, `receiptKey`, `interventionId` (recommended for stable identity),
`goalId`, `siteId`, `siteName`, `batchId`, optional `decisionId`,
`productionDeployedAt`, `commitSHA`, `deploymentURL`, `productionURL`, `releaseDate`,
`releaseOffsetDay`, `lifecyclePhase`, `action`, and non-empty `affectedPages`.

Each `affectedPages[]` item carries `path`, `action`, `primaryURL`, `triggerType`,
`triggerQueries`, `triggerSummary`, `sourceRefs`, and `reason`.

The receipt token is read only from Script Properties under
`DEPLOYMENT_RECEIPT_TOKEN_V1`; it is never stored in this repository, a Sheet, or logs.

## Idempotency and observation timing

The receipt key, intervention ID, and page receipt key are deterministic. Replays return
`DUPLICATE_ACCEPTED` and do not add rows. Every affected page receives D1, D3, D7, and D14
observations. Future targets are `WAITING_HORIZON`; elapsed targets without GSC coverage are
`WAITING_DATA`; only `LatestGSCDataDate >= TargetDate` permits calculation.

