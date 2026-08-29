# Serious Sam: Shatterverse — GSC onboarding baseline

Recorded: 2026-08-29 (Asia/Shanghai)

## Launch identity

- Site ID: `serious-sam-shatterverse`
- Launch datetime: `2026-08-29T12:37:01+08:00` (Vercel production deployment creation time)
- Production URL: https://serious-sam-shatterverse.vercel.app/
- Git commit SHA: `93e686b6e1440f338ae455c58564822b47a7796c`
- Vercel deployment ID: `dpl_GAVkkUJdMRapwuj4wpF1zzHpmxF7`
- Vercel deployment status: `Ready`, target `production`

## Search and indexing identity

- GSC property: `https://serious-sam-shatterverse.vercel.app/`
- Sitemap endpoint: https://serious-sam-shatterverse.vercel.app/sitemap-index.xml
- Sitemap status: `HTTP 200`; child sitemap `sitemap-0.xml` also `HTTP 200`
- Google verification: `PASS` — https://serious-sam-shatterverse.vercel.app/googlee7ae1126663f7b53.html returns `HTTP 200` and the expected verification token
- IndexNow: `PASS` — public key https://serious-sam-shatterverse.vercel.app/d9769250-d5b1-4818-8f1d-e1372e8b6934.txt returns `HTTP 200` and matches the site repo key

## Current formal URL set

Source: the production child sitemap returned by the sitemap index.

1. https://serious-sam-shatterverse.vercel.app/
2. https://serious-sam-shatterverse.vercel.app/co-op-solo-crossplay/
3. https://serious-sam-shatterverse.vercel.app/guides/
4. https://serious-sam-shatterverse.vercel.app/lava-golem-mechanics/
5. https://serious-sam-shatterverse.vercel.app/overview/
6. https://serious-sam-shatterverse.vercel.app/weapons-ranks-affixes/
7. https://serious-sam-shatterverse.vercel.app/what-resets-after-death/

## Monitoring binding

The site is registered through the existing `DEFAULT_SITES` and `site_id` identity paths. Once the row is present in the `站点配置` sheet and enabled, the existing `runDaily` and `runIndexAuditBatch` flows include it in `GSC日数据`, `Query明细`, `Page明细`, `Query页面明细`, and `URL索引`; no parallel monitoring system is introduced.

Live GSC row/execution evidence is intentionally not fabricated in this source baseline. It becomes available after the next authorized Apps Script run for the property.

## Verdict

`PASS_SERIOUS_SAM_GSC_ONBOARDING`

Blocker: `NONE` for source onboarding and public identity checks. Live GSC collection remains `EXPECTED_IN_PROGRESS` until the next scheduled or explicitly authorized Apps Script execution.
