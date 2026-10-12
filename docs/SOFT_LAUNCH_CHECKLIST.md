# Soft-launch checklist: the first hundred users

_The ORDER of the soft launch. Work down it. Do not skip a row._

This file says WHEN each act happens, who owns it, and what proves it.
[`docs/SOFT_LAUNCH_RUNBOOK.md`](SOFT_LAUNCH_RUNBOOK.md) says HOW the machinery works:
the deploy mechanism, the migration ledger, the feature flag table, the smoke grid,
the rollback commands and the monitoring sources. Where a step needs that detail, it
names the runbook section instead of repeating it.

Tracks issue [#392](https://github.com/Singularityszn/pubmax/issues/392). Part of the
relaunch map [#1354](https://github.com/Singularityszn/pubmax/issues/1354).

## Owners

Two owners, and no third.

- **Captain.** Merges, promotes, holds every secret, applies every migration, sends the
  invites, reads the weekly dashboard, decides a rollback.
- **Fleet.** Ships the product, runs the gates, collects the evidence, reports a
  finding. The fleet never promotes and never applies a migration.

A step with no dated proof is not done. Record each proof against its row in section 5.

---

## 1. Pre-launch proof

Do the whole of section 1 before the captain names a launch day. Every row here is
repeatable, so re-run it after any late merge.

### 1.1 The branch is green

| # | Step | Owner | Proof | Command or page |
|---|---|---|---|---|
| 1.1.1 | Full local gate | Fleet | `npm run ci` exits 0. Record the exact `main` SHA beside it. | `npm run ci` |
| 1.1.2 | Hosted CI green | Fleet | The `ci` workflow passes on the release SHA. A runner or billing fault is a gate failure, not a pass. | `gh run list --repo Singularityszn/pubmax --workflow=ci.yml` |
| 1.1.3 | Effective RLS green | Fleet | The `rls-session` workflow passes on the same SHA. | `gh run list --repo Singularityszn/pubmax --workflow=rls-session.yml` |
| 1.1.4 | Browser suite green | Fleet | Playwright passes on a clean port. Install the browser first. | `npx playwright install --with-deps chromium && npm run test:e2e` |
| 1.1.5 | Migration ledger matches the tree | Captain | `supabase migration list` and `supabase/migrations/` agree. Runbook 1.3 owns the reconciliation notes. | `supabase migration list` |

### 1.2 Preview verification

Verify on the pull request's Vercel preview, before production. Deployment protection
keeps preview hosts private, so open them signed in to the Vercel team.

| # | Step | Owner | Proof | Command or page |
|---|---|---|---|---|
| 1.2.1 | Preview environment carries the apex site URL | Captain | `NEXT_PUBLIC_SITE_URL=https://pubmaxxing.com` in the Preview environment. A preview host in that value breaks the magic-link callback. Detail: [`docs/DEPLOYMENT.md`](DEPLOYMENT.md). | Vercel, Project, Settings, Environment Variables |
| 1.2.2 | Preview environment carries every secret | Captain | `SUPABASE_*`, `OPENROUTER_API_KEY`, `ADMIN_TOKEN`, `RATE_LIMIT_SALT` and `CRON_SECRET` are all set in Preview. | Vercel, Project, Settings, Environment Variables |
| 1.2.3 | Demo content is off | Captain | `NEXT_PUBLIC_DEMO_CONTENT=off` in Preview and in Production. `NEXT_PUBLIC_DEMO_DRINKS` stays unset. A seeded pour beside a real Pint Drop is a trust failure. | Vercel, Project, Settings, Environment Variables |
| 1.2.4 | The map paints | Fleet | Pins render, clusters open, the console is clean. | `<preview-url>/map` |
| 1.2.5 | A pub sheet is honest | Fleet | The sheet shows a real figure with its lane, or one honest absence line. Never a blank. | Tap any pin on `<preview-url>/map` |
| 1.2.6 | The front door asks for a price | Fleet | The landing primary action is `Log what you paid` and it opens `/near?locate=1`. | `<preview-url>/` |
| 1.2.7 | Sign-in completes | Captain | A magic link from the preview lands signed in. The captain holds the mailbox. | `<preview-url>/login` |
| 1.2.8 | The admin door refuses a stranger | Fleet | `GET /admin` answers 401 with the token form alone. | `<preview-url>/admin` in a private window |

### 1.3 The Tonight lede test

`/tonight` once led with a JD Wetherspoon Curry Club deal. Check the first screen
against the [Tonight feature guide](../README.md#features) and the
[lede contract](rules/app-proxy-csp-caching-and-file-tracing.md).

| # | Step | Owner | Proof | Command or page |
|---|---|---|---|---|
| 1.3.1 | The lede contract holds | Fleet | The contract test passes. It fails on a `deal-jdw-` id, a JD Wetherspoon source host or a Ticketmaster `kind: "event"` row in the first screen. | `npx vitest run __tests__/tonightLedeContract.test.ts` |
| 1.3.2 | The rendered night agrees | Fleet | The browser spec passes. | `npm run test:e2e -- e2e/tonight.spec.ts` |
| 1.3.3 | Read the real night | Captain | Open the page at a London evening hour. Check the lede and empty-event wording against the linked guides. | `<preview-url>/tonight` |

### 1.4 Price standings are honest

A modelled figure may never pass as a published one, and a lone report may never
paint the map.

| # | Step | Owner | Proof | Command or page |
|---|---|---|---|---|
| 1.4.1 | The standings vocabulary holds | Fleet | The tier, lane and estimate fences pass. | `npx vitest run __tests__/priceTier.test.ts __tests__/venuePriceLane.test.ts __tests__/priceEstimateAuthorityFence.test.ts` |
| 1.4.2 | An estimate never prints bare | Fleet | The estimate suite passes. Every modelled figure reaches a screen as `est. £X`. | `npx vitest run __tests__/priceEstimate.test.ts __tests__/lonePintDropLane.test.ts` |
| 1.4.3 | The data gate accepts every basis | Fleet | `npm run validate-data` exits 0. It refuses a chain basis with no pages, a region basis with no provenance, and any basis under the sample floor. | `npm run validate-data` |
| 1.4.4 | The explanation page is live | Fleet | The page states the model and the standings in plain words. | `<preview-url>/how-we-estimate` |
| 1.4.5 | Read three real pubs | Captain | Open one confirmed pub, one estimated pub and one pub with no price. Each says what it is worth, and the one with nothing says so. | `<preview-url>/map` |

### 1.5 Freshness is honest

Stale and unmeasurable are two findings. Neither may read as fresh.

| # | Step | Owner | Proof | Command or page |
|---|---|---|---|---|
| 1.5.1 | No feed is over budget | Fleet | `npm run check:freshness` exits 0 and prints no advisory STALE row. A non-zero exit names the breached or unresolved artifact; an advisory row (`area_news`, `google_places_content`) warns without failing the exit. | `npm run check:freshness` |
| 1.5.2 | The live spine agrees | Fleet | The `summary` block carries no `stale` and no `unknown` count. | `curl -sS <preview-url>/api/freshness` |
| 1.5.3 | The corroboration figure is real | Fleet | `communityPrices.degraded` is `false`. A degraded read is a store fault, never a count of zero. | Same call as 1.5.2 |
| 1.5.4 | The tracing declarations hold | Fleet | The tracing fences pass, so a runtime data pack cannot ship missing from its function. | `npx vitest run __tests__/freshnessTracing.test.ts __tests__/venueIndexTracing.test.ts` |

### 1.6 Seed density before anyone is invited

Grey pins in the first viewport end the launch on the first tap.

| # | Step | Owner | Proof | Command or page |
|---|---|---|---|---|
| 1.6.1 | Two boroughs carry corroborated prices | Captain | Soho and Camden read as priced on first open. Method: [`docs/growth/SEED_BOROUGH_PLAYBOOK.md`](growth/SEED_BOROUGH_PLAYBOOK.md). | `<preview-url>/map` |
| 1.6.2 | The Pint Index has something to publish | Fleet | The snapshot builds and validates. The script refuses to write an empty Index over a real one. | `npm run build:pint-index-snapshot` |

### 1.7 Discovery doors

| # | Step | Owner | Proof | Command or page |
|---|---|---|---|---|
| 1.7.1 | Google Search Console | Captain | Domain property verified, `sitemap.xml` submitted, fetch succeeded. Dated screenshot. | https://search.google.com/search-console |
| 1.7.2 | Bing Webmaster Tools | Captain | Site verified, sitemap submitted, fetch succeeded. Dated screenshot. | https://www.bing.com/webmasters |
| 1.7.3 | The sitemap builds | Fleet | The sitemap fence passes. A truncated sitemap deindexes what it drops. | `npx vitest run __tests__/sitemap.test.ts` |

---

## 2. Launch day

Nothing in section 2 starts until the captain says so. The order is the point.

| # | Step | Owner | Proof | Command or page |
|---|---|---|---|---|
| 2.1 | Confirm section 1 is complete and dated | Captain | Every row in section 5 carries a date. | This file, section 5 |
| 2.2 | Apply any outstanding migration | Captain | `supabase migration list` shows the release set. Agents ship SQL only. Runbook 1.3. | `supabase db push --include-all` |
| 2.3 | Confirm the production environment | Captain | `NEXT_PUBLIC_DEMO_CONTENT=off`, `PUBMAX_SOCIAL_FRIENDS_LAUNCH` unset, every secret set. Runbook 1.4. | Vercel, Project, Settings, Environment Variables |
| 2.4 | Deploy | Captain | A build id from Vercel. Never pass `--prebuilt` from a Mac. | `vercel deploy` |
| 2.5 | Promote | Captain | The promoted deployment id, recorded. Promotion repoints traffic and does not rebuild. | `vercel promote <deployment-url>` |
| 2.6 | Both hosts serve the release | Fleet | Two 200 answers carrying the release build. | `curl -sSIL https://pubmaxxing.com/map` and `curl -sSIL https://www.pubmaxxing.com/map` |
| 2.7 | Production smoke | Fleet | Every row of the runbook smoke grid passes on the production host. | Runbook section 2 |
| 2.8 | The title markers answer | Fleet | Both greps match. | `curl --fail --silent --location https://pubmaxxing.com/map \| grep -F '<title>Map · PUBMAXXING</title>'` |
| 2.9 | Freshness on production | Fleet | `summary` carries no `stale` and no `unknown`; `communityPrices.degraded` is `false`. | `curl -sS https://pubmaxxing.com/api/freshness` |
| 2.10 | The Tonight lede on production | Captain | The first screen names a pub or says the night is quiet. | https://pubmaxxing.com/tonight |
| 2.11 | Analytics reaches PostHog | Fleet | A consented visit produces `discovery_viewed` with `surface = 'landing'` in the live events view within a minute. | https://eu.posthog.com/project/219466 |
| 2.12 | The weekly dashboard exists | Captain | Six insights created from `docs/analytics/weekly-dashboard.json`. This needs a personal API key; the deployment token is write-only and cannot create one. Method: [`docs/analytics/TRACKING_PLAN.md`](analytics/TRACKING_PLAN.md) 3.1. | https://eu.posthog.com/project/219466 |
| 2.13 | Invite the first cohort | Captain | The WhatsApp message goes to 15 to 40 London drinkers already known to the captain. One map link, one plan invite for a real night, one line of ask. Copy: [`docs/growth/HORIZON0_OPS_CHECKLIST.md`](growth/HORIZON0_OPS_CHECKLIST.md). | WhatsApp |

### 2.14 Who watches what, first 48 hours

| Signal | Watcher | Threshold | Act |
|---|---|---|---|
| Vercel runtime errors, per route | Fleet | Any route error rate climbing | Open the route logs the same hour. Report the route and the reason. |
| 401 on `/api/*` | Fleet | A spike above routine sign-out traffic | Treat as an auth regression, not noise. |
| 429 on `/api/*` | Fleet | Any sustained spike | Budgets too tight for real traffic, or a client retry loop. |
| `price_submit_failed` where `reason = 'rejected'` | Fleet | Any sustained rise | `/api/price-submit` is refusing real drinkers. Read the route logs the same day. |
| Supabase advisors | Captain | Any new security finding | Read before the next deploy. |
| RLS session workflow on `main` | Fleet | Red | A launch blocker, never a flake. |
| Sign-up drop-off between `/login` submit and a session | Captain | Any cliff | The identity door is the cost of a price. A product decision. |

One deploy per night. A fix found at 22:00 waits for the next night unless it is a
rollback trigger in section 4.

---

## 3. The first week

### 3.1 The weekly view

Read the dashboard once a week. [`docs/analytics/TRACKING_PLAN.md`](analytics/TRACKING_PLAN.md)
is the source of truth for what each number answers; `docs/analytics/weekly-dashboard.json`
is the machine definition. Five numbers in six insights.

| # | Tile | Reads |
|---|---|---|
| 1 | Weekly active visitors | Unique `distinct_id` over all events |
| 2 | First action within 60 seconds | The release metric, plus its funnel companion |
| 3 | Landing to Map to venue sheet | `discovery_viewed`, `$pageview` on `/map`, `venue_sheet_opened` |
| 4 | Pint Drop submissions and corroboration | `price_submitted`, `price_submit_outcome`, `price_submit_failed` |
| 5 | Top routes by LCP | `web_vital` where `metric = LCP`, p75, by route |

Three limits to state every time a figure is quoted.

1. Every rate is a rate over CONSENTED visitors. It is never a rate over all traffic.
2. A named event carries no `$session_id`. A session-scoped funnel over named events
   answers nothing. Use a time window over `distinct_id`.
3. Tile 3 crosses both transports. Read step 1 to step 3 as the reliable pair.

### 3.2 Who acts on which number

The full table is [`docs/analytics/TRACKING_PLAN.md`](analytics/TRACKING_PLAN.md)
section 4. These are the five that decide the first week.

| Number | Not healthy when | Owner acts |
|---|---|---|
| First action within 60 seconds | It falls two weeks running | Captain: the front door asks for the wrong first tap. Re-cut the landing primary action, then re-read the tile the week after. |
| Landing to venue sheet | It falls while the 60 second tile holds | Fleet, map lane: the tap lands and the walk to a pub dies. Read `map_search_no_results` and the surface trail before touching the landing. |
| Pint Drop submissions per week | Flat while venue sheets rise | Fleet, price lane: drinkers reach pubs and do not log. Read `price_submit_viewed` against `price_submitted`, then `price_submit_failed` by reason. |
| `price_submit_outcome` trusted share | Flat or falling while submissions rise | Fleet, price lane: prices land and never corroborate, so the map stays grey. Point price evidence missions at the pubs holding one voice. |
| LCP p75 per route | Any route over its ceiling | Fleet: open [`perf/route-budgets.json`](../perf/route-budgets.json) and [`docs/PERFORMANCE_BUDGETS.md`](PERFORMANCE_BUDGETS.md), not the dashboard. |

No number here may be read as a person. There is no account identity in the analytics
rail, and nothing may be joined to `distinct_id` to make one.

### 3.3 The Pint Drop corroboration loop

This loop is the product. It is what turns one drinker's report into a price the map
may paint.

1. A signed-in drinker logs a price. The write needs a verified actor, so the drop
   carries an authority key.
2. That first report is PROVISIONAL. It shows on the pub's own sheet with its date and
   the provisional line. It earns the pin a mark, and nothing more. It never reaches
   pin colour, the cheapest buckets or the Pint Index.
3. A SECOND independent reporter agrees. The server mints a confirmation. Both drops
   carry the same confirmation id, because one agreement is one event.
4. The pin now paints, the pub enters the cheapest buckets, and the Pint Index may
   date the pub.
5. A moderator may confirm one queued drop instead of waiting for a second drinker.

| # | Weekly act | Owner | Proof | Command or page |
|---|---|---|---|---|
| 3.3.1 | Read the trusted share | Captain | Tile 4. `price_submit_outcome` with `outcome = 'trusted'` is the nearest honest signal of corroboration. | https://eu.posthog.com/project/219466 |
| 3.3.2 | Read the durable count | Fleet | `communityPrices.corroboratedCategories`. This is the confirmed figure, and it does not live in PostHog. A server-minted confirmation has no consenting browser behind it. | `curl -sS https://pubmaxxing.com/api/freshness` |
| 3.3.3 | Clear the moderation queue | Captain | No reported price or photo older than 48 hours. Reporting never auto-hides. Only a moderator hides, and hiding never deletes. | https://pubmaxxing.com/admin |
| 3.3.4 | Point missions at lone voices | Fleet | Pubs holding one report appear as ranked price evidence missions on `/near` and in the map sheet. | `https://pubmaxxing.com/near` |
| 3.3.5 | Republish the Index | Fleet | The snapshot rebuilds from live confirmations. It refuses rather than publish an empty Index. | `npm run build:pint-index-snapshot` |

### 3.4 The week-1 pass bar

- At least 10 distinct humans opened the map.
- At least 5 RSVPs or logged prices.
- At least one plan reached a crew of two or more.
- The seed boroughs did not read as empty grey on first open.
- No paid advertising was run.

Cohort-specific reads live in [`docs/growth/V1_INVITE_SCOREBOARD.md`](growth/V1_INVITE_SCOREBOARD.md).

### 3.5 Standing anti-goals for the first hundred

- No drinker pays for anything. The first revenue comes from venues.
- The annual Year in Pints wrap stays free.
- A referral is a mark of honour. Nothing in the product branches on a referral count.
- No Stripe Checkout, no payments theatre.
- No multi-city marketing while London is the only dense city.

---

## 4. Rollback

Decide fast. Each trigger has one lever. The commands live in runbook section 3.

| Trigger | Lever | Owner | Command |
|---|---|---|---|
| A bad release, any cause | Promote the previous known-good deployment | Captain | `vercel promote <previous-deployment-url>` |
| A Social incident | Set the launch flag to `0`, then promote | Captain | `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` in Vercel Production |
| A price surface reading wrong | Promote back first, then hide the offending rows from the moderation queue | Captain | `vercel promote <previous-deployment-url>`, then `/admin` |
| A schema fault | Run the matching rollback SQL by hand | Captain | `supabase/migrations/rollback/` |

Three facts about a rollback here.

1. A code rollback does not undo a schema change. Migrations are not rollback-safe by
   default.
2. Migrations `0065` to `0069` share ONE rollback file. Roll all five back together.
3. Migrations before `0065` have no rollback files. Treat any rollback there as a
   manual, reviewed operation.

After any rollback, re-run the production smoke grid (runbook section 2) and record
what was rolled back and why against section 5.

---

## 5. Evidence

Issue #392 is not closed until every row carries a date and a link or a screenshot
from the owning service.

| Gate | Owner | Required evidence | Date |
|---|---|---|---|
| Release SHA and local gate | Fleet | The `main` SHA and a passing `npm run ci` | |
| Hosted CI and RLS | Fleet | Two green workflow runs on that SHA | |
| Preview verification | Captain | Section 1.2 complete on the preview host | |
| Tonight lede | Captain | Section 1.3 complete, including the read on a real evening | |
| Price standings | Captain | Section 1.4 complete, including the three real pubs | |
| Freshness | Fleet | Section 1.5 complete, with the `/api/freshness` body | |
| Seed density | Captain | Two boroughs reading as priced | |
| Search Console and Bing | Captain | Verified property, submitted sitemap, successful fetch | |
| Demo content off | Captain | `NEXT_PUBLIC_DEMO_CONTENT=off` in Production, with the promoted deployment id | |
| Promotion | Captain | The promoted deployment id | |
| Production smoke | Fleet | Every runbook smoke row passing on the production host | |
| Analytics live | Captain | The weekly dashboard, with all six insights | |
| First cohort | Captain | 10 distinct map opens and 5 RSVPs or price logs, with no paid ads | |
