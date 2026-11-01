# Soft-launch runbook

_The MECHANISM of the PubMaxx v1 soft launch: how the deploy, the migrations, the flags, the smoke, the rollback and the monitoring work. It tracks issue [#392](https://github.com/Singularityszn/pubmax/issues/392)._

**The ORDER lives next door.** [`docs/SOFT_LAUNCH_CHECKLIST.md`](SOFT_LAUNCH_CHECKLIST.md) is the ordered runbook for the first hundred users: pre-launch proof, launch day, the first week and rollback, each step naming its owner and its proof. Work down that file, and read this one for the detail it points at.

**Launch week is section 8.** The Product Hunt launch on Tuesday 17 November 2026 has its own dated order there: what the captain does before Monday 16 November, the Monday freeze, release, sweeps and smoke walk, the launch-day watch list, rollback, the database upgrade trigger and the uptime monitor.

---

## 1. Rollout order

### 1.1 Deploy mechanism

The [deployment checks](DEPLOYMENT.md#continuous-integration-and-deployment-checks)
own the Vercel build contract and local pre-push gate. The
[CI runbook](CI_RUNBOOK.md) owns runner configuration and recovery;
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) owns CI triggers and commands.

The captain decides runner changes.

Effective RLS stays in `.github/workflows/rls-session.yml` (Postgres 16 + PostgREST 14). Keep both workflows green on every pull request.

### 1.2 Release to production

Ship to production with `npm run release:prod` and nothing else. It stages a build with Production environment values, promotes that build, and waits for the production smoke run. The [release procedure](DEPLOYMENT.md#one-release-command) owns its steps. Its last line names the released commit and deployment id: record both.

Never promote a Preview build with `vercel deploy` then `vercel promote`. Promotion does not rebuild, so a Preview-built artifact keeps its Preview environment values in production. [`docs/DEPLOYMENT.md`](DEPLOYMENT.md#manual-deploy-and-promote) explains why.

After the release, confirm both hosts answer for it:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://pubmaxxing.com/map
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' 'https://www.pubmaxxing.com/map?sel=venue-xjf3n0'
```

The apex prints `200`. The `www` host prints `308 https://pubmaxxing.com/map?sel=venue-xjf3n0`. Neither command follows the redirect, so the second reads the first response's `Location` and proves the path and query survive it.

### 1.3 Migrations

The owner applies migrations. Agents ship SQL only.

`docs/handoffs/FABLE_HANDOFF.md` is not a current ledger. Its latest entry is dated 2026-07-23 and covers migrations only up to roughly `0053`. Do not use it to decide what is applied.

To check the live ledger, compare `supabase/migrations/` against the Supabase dashboard's migration history for the project (Database → Migrations), or run:

```sh
supabase migration list
```

**Ledger reconciliation re-verified 2026-08-31:** production contains the objects
recorded by source migrations `0127`-`0132`. The production objects were applied
on 2026-08-27 through PR [#1237](https://github.com/Singularityszn/pubmax/pull/1237),
which then closed unmerged. The source bodies are idempotent against that
production state and let a fresh database reproduce it. This records source-ledger
parity; it does not prove that Captain has applied these new version rows to the
remote ledger.
Check `supabase migration list` before any push or database action.

The Plan account-claim follow-up migrations `0133` and `0134` are in the
source ledger with matching rollback files. Their account-claim RPCs are
already live in production, so the application change has no deploy-order
hazard. Migrations `0135` and `0136` extend this lane and also have matching
rollback files. `0135` makes the claim RPC and its unique index count active
seats only. `0136` applies the same active-seat predicate to both account join
and invite-redemption prechecks. Captain owns reconciling and applying
`0135` and `0136`; do not treat revoked-seat join or invite redemption as live
until `0136` is present in the remote ledger.

The 14-digit timestamp is the migration identity and execution order. The
four-digit number is a human label only. Historical duplicate labels are
pinned by `__tests__/migrationVersions.test.ts`; never rename an applied file
to repair them. New work reserves `0138` for price-trust reconciliation.
Update this reservation when each migration lands.

`0139` withdraws `public.create_one_tap_price_pair` (#1292). The function is
live in production, no app code calls it, and it cannot report the drinker's
own figure: it builds the Pint Drop from whatever row the newer-wins shared
upsert returns, so a stored newer price makes the drop report a figure nobody
submitted. The honest lane is already the live two-phase write in
`app/api/price-submit/route.ts`. `0132` stays in the ledger as the record of
what production ran; `0139` records the withdrawal, and its rollback restores
`0132`'s exact body. Before applying, run this read-only query to see whether
any drop needs a look first, and note that no column separates a pair-written
Pint Drop from a two-phase one, so this is a review prompt rather than proof:

```sql
select count(*)
  from public.pint_drops drop_row
  join public.community_prices price
    on price.venue_id = drop_row.venue_id
 where drop_row.provenance = 'contributor'
   and drop_row.created_at < price.submitted_at
   and price.price_pennies = round(drop_row.price_gbp * 100);
```

`0139` removes the function and no row. Never turn that query into a delete:
taking down a real drinker's Pint Drop on a shape match would be a worse
defect than the latent one this closes.

The complete applied order is deliberately not copied here. Treat the live
`supabase migration list` and the files in `supabase/migrations/` as authoritative.

Note the order: `0075_social_crews` has a later timestamp than `0076` and `0077`, so it applied after them despite its lower number. This is the same out-of-order case `docs/DEPLOYMENT.md` documents for `0070`-`0072`. Future pushes should still use `supabase db push --include-all` rather than assuming filename-number order.

If a later agent finds the live ledger behind the tree again, re-run `supabase migration list` (or the dashboard history) before applying, and never assume this section is current.

#### Walking-route refunds

Migration [`0196`](../supabase/migrations/20261023170000_0196_rate_limit_refund.sql) adds the service-role-only `refund_rate_limit_hit` function.
The client sends only `p_key` in the JSON request body, so the request size does not grow with the bucket.
The function removes at most one unit through a single atomic `UPDATE`.
The application attempts a refund at most once per unused reservation, within a 2.5-second timeout.
Repeated releases do not send another refund request.
The migration remains unapplied to production and shared databases.
The captain must apply it before production rollout.
If the function is missing, the application retains the charged unit and emits `rate_limit.refund_failed`.
Other refund failures emit the same event.
After an ambiguous write, the application does not retry or grant replacement quota.
The cancelled request does not call the routing provider.
Admission still uses the existing limiter policy without a refund-function preflight.

The [rollback](../supabase/migrations/rollback/20261023170000_0196_rate_limit_refund_rollback.sql) removes the function and preserves all rate-limit rows, table grants, and policies.
After rollback, unused durable reservations retain their charges until the migration returns.

### 1.4 Feature flags

Social ships behind one server-checked launch switch:

| Flag | Read in | Emergency rollback (`=0`) | Live default |
|---|---|---|---|
| `PUBMAX_SOCIAL_FRIENDS_LAUNCH` | `lib/socialAccessServer.ts`, `app/layout.tsx`, `app/api/out/route.ts`, and public Crew route | Set only to `0` during an incident. Every Social surface returns to **preview**. Landing and `/we-are-out` point at Memories, not Open Social. The surface names itself **Social preview** in the desktop nav, command palette, and Social pages; the phone tab keeps `Social` with a preview dot and spoken name `Social preview`. | Unset, empty, `1`, or `true` keeps Social **live**. Signed-in Supabase accounts with a claimed handle and an 18+ answer reach **verified** access. When a date of birth exists, it decides the answer; otherwise, one recorded self-assertion can answer it. Friends-only reads use mutual follows (WP6). |

**Live default:** leave `PUBMAX_SOCIAL_FRIENDS_LAUNCH` unset or empty in Production and Preview. `1` and `true` are also live values. `0` is the only emergency rollback value and returns Social to preview.

**Live-state verification (captain act):**

1. Confirm `PUBMAX_SOCIAL_FRIENDS_LAUNCH` is unset, empty, `1`, or `true` in Vercel **Production** environment variables.
2. Confirm `OPENAI_API_KEY`, `SUPABASE_*`, `ADMIN_TOKEN`, and `RATE_LIMIT_SALT` are already set (avatar scan + moderation queue).
3. Promote a fresh production deployment (`vercel --prod` or dashboard promote). The flag is read at request time, but a redeploy is the audited change record.
4. Run the captain demo script below on the production host (or a staging env with the same flag and secrets).
5. Keep `PUBMAX_SOCIAL_FREEZE` unset unless ops needs to pause writes without hiding the surface. The freeze also pauses the signed-out London lane (captain decision 7, 1 November 2026): strangers see the sign-in wall until it is unset.
6. Open `/social` signed out and confirm the read-only **Across London** lane shows public posts tagged a London patch, each card with one quiet "Sign in to cheer or comment" link and no cheer, comment or compose control.

**Emergency rollback (captain act):**

1. Set `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` in Vercel **Production** environment variables.
2. Promote a fresh production deployment and run the rollback check below.
3. Restore the live default by removing the variable or setting it to `1` or `true`, then promote again.

### 1.5 Captain demo script (Social + avatars dress rehearsal)

Run after a fresh deployment with `PUBMAX_SOCIAL_FRIENDS_LAUNCH` unset, empty, `1`, or `true` in the demo environment. `0` is rollback state and must pass the rollback check below.

**Emergency rollback check (`=0`):**

1. Open `https://pubmaxxing.com/social` signed out.
2. Confirm the preview heading: "Social preview is invite-only for now. It opens more widely soon."
3. Confirm no post lanes, compose button, or protected feed content appears.
4. Confirm the desktop nav and the command palette both read `Social preview`, and the phone tab reads `Social` with the preview dot.

**Live default check (full loop):**

1. **Sign in** at `/login` with a fresh Supabase test account (magic link).
2. **Claim a handle** and provide an 18+ answer. When a date of birth exists, it decides the answer; otherwise, record one self-assertion (D2).
3. Confirm `/social` lands in **verified** state (compose + Posts lane visible).
4. **Upload a profile photo** on `/u/<handle>` → Edit profile. A normal photo should appear on the public profile after one request.
5. **Join a plan crew** with a second account and confirm the mutual follow edge forms (WP7); search handles from Social if needed.
6. Post a **friends-only** update from account A; confirm account B (mutual) sees it and account C (non-mutual) does not.
7. **Flag a photo** via the reader report path; confirm it queues in Admin → profile avatars (reported lane).
8. **Hide** the reported avatar from the admin console; confirm the public profile falls back to initials.
9. Attempt a **known-bad test image** upload; confirm instant honest refusal (no silent publish).
10. Temporarily unset `OPENAI_API_KEY` in a staging slot and retry upload; confirm the photo still uploads and one `uploaded_image.scan_skipped` line names the surface and the reason. The scan is advisory; the report/hide lane is the net.

**Automated rehearsal (Playwright):**

```sh
# Live smoke coverage - explicit `=1` is equivalent to live default.
npm run test:e2e -- e2e/smoke.spec.ts e2e/profile-avatar.spec.ts

# Social live-loop dress rehearsal (`=1`):
PW_SOCIAL_OPEN=1 PUBMAX_SOCIAL_FRIENDS_LAUNCH=1 npm run test:e2e -- e2e/social-open.spec.ts
```

---

## 2. Smoke checklist (post-deploy)

Run each check on the production host after every promoted deploy.

| Check | URL | Good looks like |
|---|---|---|
| Sign-in journey | `https://pubmaxxing.com/login` | Email field accepts an address, submit shows the same neutral confirmation message for any address, magic link email arrives, the link signs the browser in and lands on `/map`. |
| Handle claim | `https://pubmaxxing.com/map` after sign-in | Account onboarding offers a handle claim. An account with an existing handle shows it as already owned, never a fresh claim form. |
| Map paint | `https://pubmaxxing.com/map` | Pins render within a few seconds, cluster and un-cluster on zoom, no console errors. |
| Venue sheet | Tap any pin on the map | Sheet opens with venue name, address, and price state (a real price, or an honest "no price logged" line, never a blank). |
| Plan generate | `https://pubmaxxing.com/plan` | Five-step intake completes and returns a priced route, or the honest 422 "No three-stop route ... meets every must-have need" message. Never a raw error page. |
| Plan invite share | After locking in a plan on `/plan/[id]` | "Send on WhatsApp" is the primary next action; "Copy invite link" works for the host session and never for an anonymous visitor to the same URL. |
| Public invite RSVP | `/invite/[token]` from the host copy | Guest can RSVP with a name only; "Open these stops on the map" is present before and after the RSVP, and opens `/map?mode=build&pubs=<ordered stops>` (one stop opens `/map?sel=<id>`). |
| Host Remove (cookie path) | Host revisits `/invite/[token]` after a guest RSVP | Remove appears for the host; after Remove the guest row is gone and stays gone on reload. Guest browsers never see Remove. |
| Social tab | `https://pubmaxxing.com/social` | With `PUBMAX_SOCIAL_FRIENDS_LAUNCH` unset, empty, `1`, or `true`: verified adults see the feed; a signed-out visitor reads the read-only Across London lane under the Sign in door; a signed-in account that is not verified sees the correct `SOCIAL_ADULT_VERIFICATION_REQUIRED` state with `Adult verification is needed for Social.`. With `=0`: the surface is named `Social preview`, safe preview copy only, no post content, and no sign-in-required content leak. |

---

## 3. Rollback

### 3.1 Application code

Promote the previous known-good deployment:

```sh
vercel promote <previous-deployment-url>
```

Find the previous URL in the Vercel dashboard's Deployments list, or `vercel ls`. This does not rebuild anything; it repoints production traffic. So pick a deployment that `npm run release:prod` built for Production, never a Preview build, which keeps its Preview environment values after promotion.

### 3.2 Migrations are not rollback-safe by default

Applied migrations are not covered by a code rollback. Rolling back the app does not undo a schema change.

Every migration from `0071` onward, including reconciliation migrations `0127`-
`0134` (section 1.3), has its own matching file in
`supabase/migrations/rollback/`. Run the rollback SQL manually against the
database; nothing runs it automatically.

Two points to know about the already-applied history:

- `0065`-`0069` (the RLS wave 2 migrations) share one combined rollback file, `20260803200000_rls_wave2_rollback.sql`. Roll all five back together, not one at a time.
- `20260806035204_0070_v1_release_security.sql` has its own rollback file. Its same-numbered sibling, `20260806145644_0070_rate_limit_expiry.sql`, has none. If a problem traces back to that second migration, write and review rollback SQL by hand before running it. Do not assume the two share a rollback file just because they share a number.

Migrations before `0065` have no rollback files at all. Treat any rollback need there as a manual, reviewed operation.

---

## 4. Monitoring

| Source | What it shows | Where |
|---|---|---|
| Vercel deployment logs | Build and runtime logs, function errors | Vercel dashboard → project → Deployments → select a deployment → Logs |
| Vercel usage | Build-hours, function invocations, bandwidth | Vercel dashboard → project → Usage |
| Supabase logs | Postgres and PostgREST request logs | Supabase dashboard → project → Logs |
| Supabase advisors | Security and performance lint findings on the live schema | Supabase dashboard → project → Advisors |
| PostHog | Product analytics, funnels, sign-up conversion | `https://eu.posthog.com/project/219466` |
| RLS session tests | Effective row-level-security proof on every push | `gh run list --repo Singularityszn/pubmax --workflow=rls-session.yml` |

### First 48 hours, watch for

- 401 spikes on `/api/*` routes: a real auth regression, not routine sign-out traffic.
- 429 spikes: rate-limit budgets too tight for real launch traffic, or a client retry loop.
- Error rate climbing on any single route in Vercel's runtime logs.
- Sign-up funnel drop-off in PostHog between `/login` submit and a completed session.
- The RLS session workflow going red on a push to `main`: treat as a launch blocker, not a routine CI flake, because it is the one currently reliable automated safety net alongside a local `npm run ci`.

---

## 5. Comms

### 5.1 Where users report problems

The site's one public contact address is `CONTACT_EMAIL` in `lib/siteContact.mjs` (`lib/siteContact.ts` is the app's door onto it). Read it from that file rather than copying the address into a message; the file is the single place the app and the crawler scripts both use, and it can change without this runbook going stale. It is a mailbox the captain owns; docs/STORE_READINESS.md section 8 carries the step that makes it answer.

### 5.2 Social moderation rota

Live Social uses the existing admin session and named moderator role for queue
decisions. Check queue access and moderator ownership during each launch
review. The historical
[`SOCIAL_BETA_CONTRACT.md`](social/SOCIAL_BETA_CONTRACT.md) is not a current
launch gate. During `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0`, use static preview only.

---

## 6. V1 invite cohort (map + plan invite + price logging)

V1 is not a Social launch. Invite 15–40 London drinkers you already WhatsApp nights with. Product strategy: [docs/plans/PLG_STRATEGY.md](plans/PLG_STRATEGY.md). Weekly scoreboard detail: [docs/growth/V1_INVITE_SCOREBOARD.md](growth/V1_INVITE_SCOREBOARD.md). Full Horizon 0 merge / promote / smoke / anti-goals checklist: [docs/growth/HORIZON0_OPS_CHECKLIST.md](growth/HORIZON0_OPS_CHECKLIST.md). Seed density playbook: [docs/growth/SEED_BOROUGH_PLAYBOOK.md](growth/SEED_BOROUGH_PLAYBOOK.md).

### 6.1 What you send

One WhatsApp message with:

1. Map link (`https://pubmaxxing.com/map` or `/near`)
2. Optional plan invite for a real upcoming night (`/invite/[token]` from Copy invite link)
3. One-line ask: open the map / RSVP / log a pint if you buy one

### 6.2 Seed density before the blast

Captain + early cohort pre-log corroborated prices in 1–2 boroughs guests will open first (for example Soho + Camden). Grey pins in the first viewport kill trust. Follow [SEED_BOROUGH_PLAYBOOK.md](growth/SEED_BOROUGH_PLAYBOOK.md).

### 6.3 Weekly scoreboard (PostHog)

Instrumentation lives in [METRICS_FUNNEL.md](METRICS_FUNNEL.md).
Read invitation response through the [canonical definitions](analytics/METRICS.md#32-invitation-response-measures).
Track corroborated coverage in seed boroughs and meaningful plan actions (`plan_saved`, `plan_invite_sent`, `plan_invite_link_copied`).
Also track return `activity_pulse` and landing CTA mix (`landing_cta_clicked`).
Track Social only for an explicit, consented product question.
`PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` provides static preview only.

### 6.4 Done when

At least 10 distinct humans completed a map open and at least 5 RSVPs or price logs in week 1 without paid ads. Seed boroughs must not read as empty grey; invite share should appear on most successful locked plans.

---

## 7. Owner go-live evidence

Do not mark issue #392 complete until each row has a dated link or screenshot from the owning service.

| Gate | Required evidence | Status on 2026-08-23 |
|---|---|---|
| Google Search Console | Verified domain property, submitted `https://pubmaxxing.com/sitemap.xml`, and successful fetch | Owner action |
| Bing Webmaster Tools | Verified site, submitted sitemap, and successful fetch | Owner action |
| Android PWA install | After a second distinct-day visit or a completed Crawl Route, supported Android Chrome emits `beforeinstallprompt`; the PUBMAXX prompt appears and the installed PWA launches from the home screen | Owner action |
| iOS install | Safari Add to Home Screen instructions are accurate and the installed app launches from the home screen | Owner action |
| Demo content | Vercel Production environment shows `NEXT_PUBLIC_DEMO_CONTENT=off`; promoted deployment ID recorded | Owner action |
| Analytics order | PostHog receives release, map open, plan generated, invite opened, invite accepted, crew activation, completion, recap share, and repeat-plan events in that order | Owner action |
| First cohort | Dated result for 10 distinct map opens and 5 RSVPs or price logs, with no paid ads | Owner action |
| Release gate | Exact `main` SHA, local `npm run ci`, RLS, browser smoke, hosted CI state, and promoted deployment ID | In progress |

### Smoke walk, 30 October 2026, local production build, keyless

What happened: builder 34 walked every row of section 2 in a browser on 30 October 2026. No row failed. Two results are partial, because a keyless local build cannot prove the whole acceptance row. Three results need keys that a keyless build does not have. The captain must prove the two partial results and walk the three key-dependent rows on the production host after the next release.

- **Build:** `main` at `734b39e97690890cc716866c4d9516329e3d5e3d`, built with `NEXT_DIST_DIR=.next-prod` and served on a private port with `PUBMAX_E2E_KEYLESS=1` and no Supabase keys. `/api/version` named that commit.
- **Driver:** `npm run e2e:cli` (Playwright CLI, headless Chromium). Pictures and console logs went to `artifacts/playwright-cli/`, which is not committed.
- **Not proved here:** the production host. A local build proves the code at this commit, not the Vercel environment values.

| Check | Result | What the browser showed |
|---|---|---|
| Sign-in journey | NEEDS KEY | `/login` says "Sign-in is not configured on this build. You can still browse the map." It needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and the Supabase email sender for the magic link. |
| Handle claim | NEEDS KEY | It needs a signed-in Supabase account, so it needs the same keys as sign-in. |
| Map paint | PARTIAL | Proved: price clusters at London zoom merge into four clusters at county zoom and split into single price pins at street zoom, and the console had 0 errors. Not proved: "pins render within a few seconds". The first pin painted after 5.8 seconds on a warm load and after 16 to 18 seconds on the first two loads. The machine was a shared 4-core box that draws WebGL in software, so these times are not a production figure, and the timing part of the row is proved only on the production host. |
| Venue sheet | PASS | A tap on a pin opened Baccarat Bar with its address, a listed £9.50 pint, its collection date and the publisher Pint Prices. The "Checking" lines settled within 8 seconds. |
| Plan generate | PASS | The five steps (Soho, Evening, 4 people, Standard, access skipped) then "Make a plan" gave the honest 422 line "No 3-stop route in Piccadilly & Soho meets every must-have need with the information available." on the page. "Quiet in Clapham for 4, not pricey" gave a priced three-stop route at £16.85 each. No raw error page appeared. |
| Plan invite share | PASS | "Lock it in" opened `/plan/<id>`. The coral "Send to the crew" button jumps to the share card, where "Send on WhatsApp" is the first full-width action. "Copy invite link" said "Invite link copied." and put `/invite/<token>` on the clipboard. A fresh browser on the same URL showed no "Copy invite link". |
| Public invite RSVP | PARTIAL | Proved: a fresh guest browser saw a form with one field, "Your name". "Open these stops on the map" was there before and after the RSVP. It opened `/map?mode=build&pubs=<three ids>` with the route drawn. Not proved: the one-stop invite, which the row says opens `/map?sel=<id>`; it was not walked and is owed on the production host. |
| Host Remove (cookie path) | PASS | The host browser saw "Remove Priya". After Remove and a reload, Priya was gone. The guest browser saw no Remove button. |
| Social tab, live default, signed out | PASS | With `PUBMAX_SOCIAL_FRIENDS_LAUNCH` unset, `/social` said "Sign in to use Social." with no posts and no compose control. |
| Social tab, live default, verified adult and adult verification | NEEDS KEY | Both states need a signed-in Supabase account, so they need the sign-in keys. |
| Social tab, `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` | PASS | The title, the page heading, the desktop navigation and the command palette all read "Social preview". The page said "Social preview is invite-only for now. It opens more widely soon." and showed no posts. |

Count: 9 checklist rows, walked as 11 results: 6 PASS, 2 PARTIAL, 0 FAIL, 3 NEEDS KEY. A PARTIAL result proves part of its acceptance row and names the part it does not prove.

Two observations that are not failures of a row:

1. Soho, a seed borough, gave the 422 line with no must-have need chosen. The server found 1 eligible pub of 135, so the words "every must-have need" name a need the person did not choose.
2. Production served commit `e5da6c0` on 30 October 2026, not this `main` commit. The titles it served match the titles this build serves.

### Release metric, how to record it

The release metric is the share of landings whose first meaningful action comes 60 seconds or less after the landing. [`docs/analytics/TRACKING_PLAN.md`](analytics/TRACKING_PLAN.md) section 2 owns the definition and the query, and this block does not copy the query. `npm run release:prod` does not measure the metric. Its last line names the commit and the deployment that you measure.

Measure it on the launch head after the merge and after the release, when the release has had seven days of traffic.

1. Write down the commit and the deployment id from the last line of `npm run release:prod`: `Released <commit> as <deployment id>.`
2. Take the first 7 characters of that commit. Every event carries them as `release` (`lib/analyticsAttribution.mjs`).
3. Copy the query in TRACKING_PLAN 2.1. In BOTH the `landings` part and the `actions` part, add `AND properties.environment = 'production'` and `AND properties.release = '<7 characters>'`. The query joins actions to landings by `distinct_id` only, so an unfiltered action from another environment or release would count towards this release. Put it in a file as `{"query": {"kind": "HogQLQuery", "query": "<the query>"}}`.
4. Run this command. It needs a PostHog personal API key that can read queries.

```sh
curl -sS -X POST "https://eu.posthog.com/api/projects/219466/query/" \
  -H "Authorization: Bearer $POSTHOG_PERSONAL_API_KEY" \
  -H "content-type: application/json" \
  --data @release-metric.json
```

5. Write down `rate_pct` as the release metric. Write `landings`, `acted_within_60s` and `median_seconds_to_first_action` beside it, because a rate over a few landings means little. Put the five values and the date in the table below.

| Date measured | Commit (7) | Deployment id | Landings | Within 60 s | `rate_pct` | Median seconds |
|---|---|---|---|---|---|---|
| Not measured yet | | | | | | |

---

## 8. Launch week, 16 and 17 November 2026

_A dated section, written on 1 November 2026. PUBMAXX launches on Product Hunt on Tuesday 17 November 2026 at 08:01 UK (00:01 Pacific). This section is the order for that week. The plan behind it is [`LAUNCH_PLAN_2026-11-01.md`](plans/LAUNCH_PLAN_2026-11-01.md), sections 6 (R1 to R4), 8 and 10. The mechanism behind each step is in sections 1 to 7 above._

Two owners, the same two as [`SOFT_LAUNCH_CHECKLIST.md`](SOFT_LAUNCH_CHECKLIST.md):

- **Captain.** Holds every login and every secret. Applies migrations, releases, rolls back, upgrades a plan, and answers on Product Hunt.
- **Fleet.** The agents. Runs read-only checks, runs the sweeps, writes the records, and opens one fix pull request for each finding. The fleet never releases, never applies a migration and never changes a vendor setting.

A row marked **Owner action** is a step only the captain can do. On 1 November 2026 no owner action in this section is done. Write the date in the row when it is done. Do not mark a row done without a dated proof.

### 8.1 Owner actions, all in one list

| # | Owner action | Where it is described | Done on |
|---|---|---|---|
| O1 | Apply the launch migrations in the same sitting as a release, then make the ledger check pass | 8.2.1 | Not done |
| O2 | Set the production environment values | 8.2.2 | Not done |
| O3 | Set a money cap at each paid vendor | 8.2.3 | Not done |
| O4 | Run the restore drill and record its time in [`DR_RUNBOOK.md`](DR_RUNBOOK.md) | 8.2.4 | Not done |
| O5 | Set `PUBMAX_ALERT_WEBHOOK_URL` as a GitHub repository secret and in Vercel Production, then send one test post | 8.6.2 | Not done |
| O6 | Create the PostHog alert on `$exception` spikes | 8.6.3 | Not done |
| O7 | Fill in the emergency contact list, in a private copy | 8.6.4 | Not done |
| O8 | Check the Supabase sign-in email sender and its hourly limit | 8.2.5 | Not done |
| O9 | Merge the uptime monitor to `main`, then start it once by hand | 8.6.1 | Not done |
| O10 | Start the freeze, release the launch head and walk the smoke rows on production | 8.3 | Not done |
| O11 | Run the PostHog check of the four crew-night events | 8.4 | Not done |
| O12 | Watch Tuesday, and decide any rollback or database upgrade | 8.5 | Not done |

### 8.2 Before Monday 16 November

Do all of 8.2 by Sunday 15 November. The one exception is the last migrations, which go in with the Monday release (8.2.1). An item that is not done by Sunday moves the Monday release later.

#### 8.2.1 Migrations (Owner action)

Production must hold every file in `supabase/migrations/` before Monday's release, because `npm run release:prod` refuses when the ledger lacks one ([release rule](rules/scripts-deploys-and-uploads.md#the-release-refuses-when-production-lacks-a-migration-and-the-check-compares-names)).

**Apply them in the same sitting as a release, never days ahead.** `0215` replaces `create_plan_route_proposal_atomic` with a version that needs one more argument. The build that production served on 1 November (`e5da6c0`) calls the old version, so its route proposals fail from the moment `0215` is applied until a newer build is live. The best order is the launch plan's week 1: apply `0203` to `0216` and release `main` straight after. Then on Monday only the files added since then (`0217` to `0219`, and any later file) are applied, and the launch release follows at once (8.3.3).

The launch set, in the order of the 14-digit timestamp, which is the apply order. Note that `0216` comes before `0214` and `0215`. Each file has its rollback in `supabase/migrations/rollback/`.

| Order | File | What it adds |
|---|---|---|
| 1 | `20261030180000_0203_venue_corrections.sql` | The "That's wrong" door on the venue sheet |
| 2 | `20261030190000_0204_pint_drop_with_tags.sql` | "With" tags on a Pint Drop |
| 3 | `20261030200000_0205_diary_usual_drink.sql` | "Your usual here" on a diary entry. Its header says apply after `0196` |
| 4 | `20261030210000_0206_regular_night_reports.sql` | Regular night reports |
| 5 | `20261030220000_0207_diary_with_tags.sql` | "With" tags on a diary entry |
| 6 | `20261030230000_0208_open_crew_plan.sql` | Open crawls |
| 7 | `20261031000000_0209_kitchen_reports.sql` | Kitchen reports |
| 8 | `20261031010000_0210_drink_measure_sizes.sql` | Glass and spirit sizes |
| 9 | `20261031020000_0211_plan_crew_usual_drink.sql` | A crew member's usual drink on a plan |
| 10 | `20261031030000_0212_drink_wall_dog_category.sql` | The dog category on the photo wall |
| 11 | `20261031100000_0213_plan_table_beacon.sql` | "Find our table" |
| 12 | `20261031120000_0216_story_source_host_read.sql` | Story source stays private to its host |
| 13 | `20261031143000_0214_plan_presentation.sql` | The optional mystery plan |
| 14 | `20261031170000_0215_grounded_plan_proposals.sql` | Server-checked route proposals |
| 15 | `20261101090000_0217_operator_facts.sql` | Accepted pub operator updates ("From the pub") |
| 16 | `20261101120000_0218_pint_drop_price_evidence.sql` | A typed price without a bill saves as "not checked" |
| 17 | `20261102090000_0219_table_requests.sql` | "Ask the pub for a table" |

Steps:

1. Read what production lacks. The check is read-only. It needs a Supabase personal access token, typed in and never echoed.

   ```sh
   read -rs SUPABASE_ACCESS_TOKEN; export SUPABASE_ACCESS_TOKEN
   npm run check:migration-ledger
   ```

   The check names every missing file. The list can hold files older than `0203`: section 1.3 names `0196` as not applied. Apply every file the check names, not only the launch set.

2. See what the Supabase CLI would run, before it runs anything.

   ```sh
   supabase link --project-ref iankajxliutqogqkmvdg
   supabase db push --include-all --dry-run
   ```

3. If the dry run lists exactly the files that step 1 named, run `supabase db push --include-all`. If the dry run lists any other file, stop and do not push. The live ledger holds many older files under other version numbers, so a push compares versions and would run those files a second time. In that case, apply each missing file by hand, one at a time, in timestamp order, the same way you applied the earlier ones. Give each ledger row the file name without its timestamp, for example `0203_venue_corrections`, because the check compares names.
4. Run `npm run check:migration-ledger` again. It must pass. Then run `npm run release:prod` (8.3.3) in the same sitting. Write the date in O1.

Apart from `0215`, the launch files add tables, columns, checks, policies or functions, and `0213` keeps the old call to `add_plan_action_idempotent_atomic` working through default values. Do not run a rollback file unless that migration is the fault. Read its header first: the `0218` rollback makes every unchecked price read as billed.

#### 8.2.2 Production environment values (Owner action)

Vercel, project `chengdu`, Settings, Environment Variables, filter Production: `https://vercel.com/pubmax69/chengdu/settings/environment-variables`. The full list of required names is in [`DEPLOYMENT.md`](DEPLOYMENT.md#required-in-production). Check these values by name:

| Name | Value in Production | Why |
|---|---|---|
| `NEXT_PUBLIC_DEMO_CONTENT` | Unset, empty or `off`. Never `on`. | `on` shows seeded Pint Drops and presence counts to the public (`lib/demoContent.ts`). If the row is marked Sensitive, you cannot read it: delete the row, because unset means off. |
| `NEXT_PUBLIC_DEMO_DRINKS` | Unset or empty | `on` shows seeded menus beside real prices. |
| `RESEND_API_KEY` | The Resend API key, Sensitive, Production only | Without it, "Ask the pub for a table" sends nothing and says so. |
| `EMAIL_FROM` | A sender on a domain verified in Resend, as a bare address or `Name <address>` | Resend refuses any other sender. |
| `PUBMAX_ALERT_WEBHOOK_URL` | The https Discord or Slack incoming-webhook URL, Sensitive | The app posts error-level events there (`lib/alertSink.ts`). Unset is silent. See 8.6.2. |
| `NEXT_PUBLIC_SITE_URL` | `https://pubmaxxing.com` | The sign-in callback must return to the apex. |
| `PUBMAX_SOCIAL_FRIENDS_LAUNCH` | Unset, empty, `1` or `true` | `0` is the emergency rollback value only (section 1.4). |
| `PUBMAX_SOCIAL_FREEZE` | Unset | `social` pauses Social writes ([`OPS_FREEZE_RUNBOOK.md`](OPS_FREEZE_RUNBOOK.md)). |

A `NEXT_PUBLIC_*` value is fixed at build time. A change reaches the site only through the next release, so set every value before Monday's `npm run release:prod`.

#### 8.2.3 Vendor money caps (Owner action)

The code caps requests, not money (launch plan C1). Set a cap in each vendor dashboard, then write the cap in the last column. Where a vendor offers prepaid credit, use prepaid credit and turn auto top-up off: an empty balance stops the spend.

| Vendor | Production variable | What to set | Cap set |
|---|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` | A credit limit on the production key. Auto top-up off. | Not set |
| ElevenLabs | `ELEVENLABS_API_KEY` | Usage-based billing off, or a usage cap on it | Not set |
| OpenAI | `OPENAI_API_KEY` | A monthly budget on the project. Auto recharge off. | Not set |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | Auto top-up off | Not set |
| TypeSafe | `TYPESAFE_API_KEY` | The plan's own limit, or prepaid credit only | Not set |
| Google Places | `GOOGLE_PLACES_API_KEY` | A budget alert on the billing account, and a daily request quota on the API | Not set |
| Resend | `RESEND_API_KEY` | Read the plan's daily and monthly send limits. Write them here. | Not set |
| Vercel | None | On a Pro plan, Spend Management with a budget. On Hobby, read the usage limits. The plan is still open (launch plan C4). | Not set |
| Supabase | None | The free plan sends no bill. After an upgrade (8.5.5), keep the spend cap on. | Not set |

#### 8.2.4 Backups and the restore drill (Owner action)

1. Re-run the installer, so the Mac takes the nightly dump (launch plan R1): `npm run backup:install-launchd`.
2. Check that a complete dump exists from the last 24 hours: `ls -1t ~/pubmax-backups/*.dump | head -1` and `tail -n 20 ~/Library/Logs/pubmax-backup.log`.
3. Run the restore drill in [`DR_RUNBOOK.md`](DR_RUNBOOK.md#1-make-the-backup-and-prove-it-restores), "The restore drill". Time it from step 2 of the drill to the last check.
4. Write the minutes in the drill log in `DR_RUNBOOK.md`. Then write the measured figure as the recovery time objective in its "Targets" section. Until then the runbook has no recovery time, and a database loss on launch day has no known end.

#### 8.2.5 Sign-in email (Owner action)

Every new drinker signs in with a magic link, so the email sender is on the launch path.

1. The Supabase SMTP settings name a production sender on a verified domain ([`DEPLOYMENT.md`](DEPLOYMENT.md#passwordless-email-magic-link) step 2). The built-in sender is for development and sends very few emails an hour.
2. Supabase, Authentication, Rate Limits: read the limit for emails sent each hour. Set it to fit launch traffic. Write the figure here: ______ an hour.
3. Send one magic link to a new address and one to an existing address. Both must arrive within a minute and not in spam.

### 8.3 Monday 16 November: freeze, release, sweeps and smoke walk

#### 8.3.1 The freeze

The freeze reuses the method of the round 6 freeze ([`ROUND6_FREEZE_AND_PROOF_2026-10-30.md`](plans/ROUND6_FREEZE_AND_PROOF_2026-10-30.md) section 2). It is agreed, not enforced by a tool. A written list says what may merge. Every defect is a finding in a table, and each finding gets its own pull request. The captain is the only person who merges to `main` while the freeze holds. No branch protection setting changes for it.

- **Starts:** Monday 16 November, before the release in 8.3.3. Write the time and the launch head commit (`git rev-parse origin/main`) in the release record (8.3.3).
- **Ends:** when the captain lifts it. The suggested time is after the Tuesday record (8.5.6) is written and the first 24 hours are quiet.
- **Tell the fleet.** Tell every agent session that works on this repository that the freeze holds. It opens no pull request for anything on the second list.

May merge, one pull request each, merged by the captain:

- A fix for a defect that the sweeps, the smoke walk or the Tuesday watch found. Name the finding in the pull request.
- A record: a smoke row, a sweep figure, a dated note in `docs/`, or a ceiling in `perf/` that comes down.

May not merge:

- A new surface or a new feature.
- A refactor, a rename or a clean-up.
- A dependency update, including Dependabot pull requests. Leave them open.
- A data refresh pull request from a scheduled workflow (weather, drink prices, the Tavily London pass). Leave it open. The packs stay as released.
- A migration. `0203` to `0219` are the launch set.
- A ceiling that goes up, a skipped test, or a gate that is switched off.
- A workflow change, unless it fixes a red launch check.

Every merge to `main` after the release means a new release (8.3.3) and a new walk of each smoke row the fix touches (8.3.5).

#### 8.3.2 Before the release (Fleet)

1. The launch head is the tip of `main`: `git fetch origin && git rev-parse origin/main`.
2. Hosted CI is green on that commit:

   ```sh
   gh run list --repo Singularityszn/pubmax --workflow ci.yml --branch main --limit 1
   gh run list --repo Singularityszn/pubmax --workflow rls-session.yml --branch main --limit 1
   gh run list --repo Singularityszn/pubmax --workflow e2e.yml --branch main --limit 1
   ```

3. The local gate passes on that commit: `npm run ci` ([`SOFT_LAUNCH_CHECKLIST.md`](SOFT_LAUNCH_CHECKLIST.md) row 1.1.1).
4. Write down the deployment that production serves now. It is the rollback target until the launch build passes its smoke walk: `curl -sS https://pubmaxxing.com/api/version`.

#### 8.3.3 The release (Owner action)

From a clean checkout of `main` at the launch head:

```sh
git switch main && git pull --ff-only
read -rs SUPABASE_ACCESS_TOKEN; export SUPABASE_ACCESS_TOKEN
npm run check:migration-ledger
npm run release:prod
```

If the ledger check names a file, apply it as 8.2.1 says, then release at once. The [release command](DEPLOYMENT.md#one-release-command) refuses a dirty tree, refuses a missing migration, builds with Production values, promotes, and waits for the production smoke run. Its last line is `[release] Released <sha> as <deploymentId>. The production smoke suite passed.` Any other last line means the release is not verified: read 8.5.4 before you do anything else.

Then run the two host checks in section 1.2. The apex prints `200` and the `www` host prints `308 https://pubmaxxing.com/map?sel=venue-xjf3n0`.

The release record. Add a row for every release and every rollback this week. The rollback target is the newest row with "yes" in the "Known good" column.

| Date and time (UK) | What | Commit (7) | Deployment id | Smoke run | Known good |
|---|---|---|---|---|---|
| | Before the release: what production served (8.3.2 step 4) | | | | |
| | Freeze started. Launch head | | | | |
| | Launch release | | | | |

#### 8.3.4 The route, API and Core Web Vitals sweeps (Fleet, and a Mac for step 3)

Sweep the launch head after the release, as the round 6 freeze asked (section 3 of that record). A ceiling only comes down. A figure over its ceiling is a finding in the table below, fixed in its own pull request, and never a raised ceiling ([`perf/AGENTS.md`](../perf/AGENTS.md), [`PERFORMANCE_BUDGETS.md`](PERFORMANCE_BUDGETS.md#changing-a-number)). The captain merges each ceiling that comes down.

1. **Route budgets** (`perf/route-budgets.json`). The macOS job is the measurement of record, so dispatch it on `main` and watch it. It takes up to 55 minutes.

   ```sh
   gh workflow run performance.yml --repo Singularityszn/pubmax --ref main
   gh run list --repo Singularityszn/pubmax --workflow performance.yml --limit 1
   gh run watch <run id> --repo Singularityszn/pubmax --exit-status
   ```

   The job log prints the breach table, the undecided table and the ratchet table. Each ratchet row is a ceiling that may come down. Lower those rows in `perf/route-budgets.json` in one pull request.

2. **API budgets** (`perf/api-budgets.json`). The API performance workflow starts only on a GitHub deployment status, and a release from `npm run release:prod` sends none, so run the probe by hand against production after the release:

   ```sh
   node scripts/probe-api-budgets.mjs --base-url https://pubmaxxing.com
   ```

   Six reads, judged on p50 and p95. Lower a ceiling only where the figure sits well under it.

3. **Core Web Vitals** (`perf/cwv-baseline.json`). No job runs this sweep. Run it on a quiet Mac with a real GPU, never on a shared agent machine, because a box that draws the map in software measures the box. It takes about an hour. The browser install is for that Mac only.

   ```sh
   npx playwright install chromium
   PUBMAX_CWV_RUNS=3 npm run perf:cwv-sweep
   ```

   If the sweep passes, re-take the table with `PUBMAX_CWV_RUNS=3 npm run perf:cwv-record`. Read the diff of `perf/cwv-baseline.json`. Keep a changed figure only where it went down, put back every figure that went up, then commit. If the sweep fails, record nothing: the failure is a finding.

Findings from the sweeps and the smoke walk:

| # | Found by | Route or row | Measured or seen | Ceiling or expected | Decision (fix before launch, or accept with a note) | Pull request |
|---|---|---|---|---|---|---|
| | | | | | | |

#### 8.3.5 The production smoke walk (Captain and Fleet)

Walk every row on `https://pubmaxxing.com` after the release, on a phone and on a desktop. Write PASS, FAIL, PARTIAL or NEEDS KEY, the date and time, and a link or a screenshot name. Rows 4, 5, 6, 10 and 12 close the results that the 30 October walk (section 7) could not prove on a keyless build.

| # | Row | Good looks like | Result | Date and time (UK) | Evidence | By |
|---|---|---|---|---|---|---|
| 1 | Release smoke run | `gh run list --repo Singularityszn/pubmax --workflow prod-smoke.yml --limit 1` shows success for the released deployment | | | | |
| 2 | Both hosts | The section 1.2 commands print `200` and the `308` line | | | | |
| 3 | Health and version | `curl -sS https://pubmaxxing.com/api/health` gives `"ok":true` and `"database":"ok"`. `curl -sS https://pubmaxxing.com/api/version` names the released deployment id | | | | |
| 4 | Sign-in journey | Section 2 row. The magic link arrives within a minute and signs the browser in | | | | |
| 5 | Handle claim | Section 2 row | | | | |
| 6 | Map paint | Section 2 row, and the first pin within a few seconds on a phone on mobile data | | | | |
| 7 | Venue sheet | Section 2 row. The action card shows the price with its date, the plan door, "Ask for a table" and Share | | | | |
| 8 | Plan generate | Section 2 row | | | | |
| 9 | Plan invite share | Section 2 row | | | | |
| 10 | Public invite RSVP | Section 2 row, for a three-stop invite and for a one-stop invite, which opens `/map?sel=<id>` | | | | |
| 11 | Host Remove | Section 2 row | | | | |
| 12 | Social tab | Section 2 row, signed out (the Across London lane), as a verified adult, and as an account that is not verified | | | | |
| 13 | A price without a bill | A typed price with no bill saves as "not checked", shows on the venue, and does not colour the pin | | | | |
| 14 | Ask the pub for a table | On a pub with a verified operator, the operator gets the email. On a pub without one, the dialog says the request was not sent | | | | |
| 15 | No demo content | No Pint Drop, menu row or presence count on the map, the venue sheet or Recent prices carries the DEMO label | | | | |
| 16 | Analytics arrive | Checklist row 2.11: a consented visit gives `discovery_viewed` with `surface = 'landing'` in PostHog within a minute | | | | |
| 17 | Uptime monitor | `gh run list --repo Singularityszn/pubmax --workflow uptime.yml --limit 3` shows success after the release | | | | |

### 8.4 PostHog: the four crew-night events (Owner action)

Before launch, prove that `plan_invite_sent`, `plan_accepted`, `crew_committed` and `plan_completed` arrive with `environment = production` from the new deployment (launch plan section 10). Every event carries `environment` and `release`, the first 7 characters of the commit (`lib/analyticsAttribution.mjs`).

1. Make the events. Use two browsers: the host, and a second phone or a private window as the guest. In each browser, accept analytics in the consent bar and turn off Do Not Track, because each of the two stops every event.
   1. Host: make a plan on `/plan` and lock it in. This sends `plan_accepted`.
   2. Host: send the invite with "Send on WhatsApp" or "Copy invite link". This sends `plan_invite_sent`.
   3. Guest: open the invite and join, or RSVP Going. The second person on the plan sends `crew_committed`.
   4. Host: in night mode, end the night and save the ending. This sends `plan_completed`.
2. Wait five minutes. Then run this HogQL in PostHog's SQL editor (`https://eu.posthog.com/project/219466`), with the first 7 characters of the commit in the release line (8.3.3) in place of `<release>`:

   ```sql
   SELECT
       event,
       count() AS events,
       min(timestamp) AS first_seen,
       max(timestamp) AS last_seen
   FROM events
   WHERE event IN ('plan_invite_sent', 'plan_accepted', 'crew_committed', 'plan_completed')
     AND properties.environment = 'production'
     AND properties.release = '<release>'
     AND timestamp >= now() - INTERVAL 2 DAY
   GROUP BY event
   ORDER BY event
   ```

   Or save the query as `four-events.sql` and run it through the API, as in section 7. It needs a PostHog personal API key that can read queries.

   ```sh
   jq -n --rawfile q four-events.sql '{query: {kind: "HogQLQuery", query: $q}}' > four-events.json
   curl -sS -X POST "https://eu.posthog.com/api/projects/219466/query/" \
     -H "Authorization: Bearer $POSTHOG_PERSONAL_API_KEY" \
     -H "content-type: application/json" \
     --data @four-events.json
   ```

3. Pass: four rows, one for each event. Write the four counts and the date here: ______.
4. If a row is missing, find out whether the event arrives with another release or not at all. Remove the `release` line and group by it:

   ```sql
   SELECT event, properties.release AS release, count() AS events, max(timestamp) AS last_seen
   FROM events
   WHERE event IN ('plan_invite_sent', 'plan_accepted', 'crew_committed', 'plan_completed')
     AND properties.environment = 'production'
     AND timestamp >= now() - INTERVAL 2 DAY
   GROUP BY event, release
   ORDER BY event, release
   ```

   An event under an older release came from a tab that loaded the old build. Walk that step again in a fresh tab. An event that is missing from both queries is a finding for 8.3.4, and the north star in [`METRICS.md`](analytics/METRICS.md) cannot be read until it is fixed.

### 8.5 Tuesday 17 November: launch day

#### 8.5.1 Open these before 07:00 UK

| What | Where |
|---|---|
| The alert channel | The Discord or Slack channel behind `PUBMAX_ALERT_WEBHOOK_URL` |
| Uptime runs | `https://github.com/Singularityszn/pubmax/actions/workflows/uptime.yml` |
| Vercel deployments | `https://vercel.com/pubmax69/chengdu/deployments` |
| Vercel logs | `https://vercel.com/pubmax69/chengdu/logs` |
| Vercel observability | `https://vercel.com/pubmax69/chengdu/observability` |
| Supabase reports | `https://supabase.com/dashboard/project/iankajxliutqogqkmvdg/reports/database` |
| Supabase usage | The organisation's Usage page (Realtime connections, egress) |
| PostHog | `https://eu.posthog.com/project/219466`: live events, and the exception insight from 8.6.3 |
| Resend | `https://resend.com/emails` |
| Product Hunt | The launch page (Captain) |

#### 8.5.2 The watch list, 07:00 to 20:00 UK

The act lines are this runbook's starting values. Change them in this file if launch traffic shows that a line is wrong. "Fleet" reads and reports. "Captain" decides and acts.

| Time (UK) | Look at | Act when | Who |
|---|---|---|---|
| 07:00 | `curl -sS https://pubmaxxing.com/api/health` and `/api/version`. The uptime runs since midnight. Supabase reports: write down the connections, CPU and Realtime figures as the morning baseline | Health is not 200. Version names a deployment that is not the launch one. Any uptime failure overnight | Fleet reads. Captain acts |
| 07:45 | Every page in 8.5.1 is open. Post one line in the alert channel to show who is watching | A page does not load | Captain |
| 08:01 | Product Hunt goes live | | Captain |
| 08:01 to 10:00, every 15 minutes | Vercel observability (5xx share, function duration). The alert channel. Supabase reports (connections, CPU). PostHog live events with `environment = production` | Any uptime alert. More than 1 in 50 requests answers 5xx for 10 minutes. A `rate_limit.fail_open` post. A Supabase line at its maximum (8.5.5). No consented event for 30 minutes while Vercel shows traffic | Fleet reads. Captain acts |
| 09:00 | The 8.4 query with the launch release. Supabase Auth logs for email rate-limit errors | One of the four events is missing after real plans were made. Any email rate-limit error | Fleet runs. Captain acts |
| 10:00 to 13:00, every 30 minutes | The 08:01 row, plus 429 answers by route in Vercel logs, Resend sends and bounces, and the exception insight | 429 on one route for 15 minutes from many visitors. A bounce on a table request. The exception alert fires | Fleet |
| 13:00 to 17:00, every 15 minutes (US East morning, the Product Hunt peak) | The 08:01 row, plus Vercel usage and Supabase usage against the plan limits | Usage over 80 per cent of a plan limit. Realtime connections near the limit the usage page shows | Captain |
| 17:00 to 20:00, every 30 minutes (London evening, real crawls) | `/api/plans` and `/invite` in Vercel logs. Realtime connections. `plan_invite_sent` and `crew_committed` in PostHog | 5xx on a plan or invite route. Realtime at its limit | Fleet reads. Captain acts |
| 20:00 | Write the day's record (8.5.6). Say who watches overnight, or say that the uptime alert is the only watch overnight | | Captain |

Signals, and what each one means:

- **An uptime alert** (`[pubmax][ci] Production uptime failed`). Open the run. A failed `/api/health` beside a good `/api/version` means the database does not answer: go to 8.5.5. Two failed routes mean the site does not answer: read Vercel, then 8.5.4. A line that names "Vercel firewall" means the firewall answered the monitor, not the app.
- **`rate_limit.fail_open`** in the alert channel. The database rate limiter did not answer in time, and the route fell back to a small local budget. Once is a blip. Again within 15 minutes from another route is a database under strain: go to 8.5.5.
- **`paid_spend.budget_spent` or `ors_budget.exhausted`.** A paid lane spent its daily budget and now degrades as designed. It is not an outage. Do not raise a budget during the freeze without a captain decision.
- **`request.unhandled`.** A route threw. Read the route template in the Vercel logs. One route that repeats is a finding for a fix pull request.

#### 8.5.3 One deploy at a time

During the launch, ship only a fix from the freeze list (8.3.1), and only through `npm run release:prod`. Walk the smoke rows the fix touches. Add a row to the release record. If you turn on Vercel's Attack Challenge Mode, the uptime monitor reads the challenge as down and names the firewall in the run. That is expected while the mode is on.

#### 8.5.4 Rollback for a bad deploy (Owner action)

A deploy is bad when any of these is true after a release: the release smoke run failed, the uptime monitor alerts, the 5xx share is clearly higher than before the release, or sign-in, the map, a plan or an invite is broken for real visitors.

1. Say in the alert channel that you are rolling back, and name the bad deployment id.
2. Find the target: the newest row in the release record (8.3.3) with "yes" in "Known good".
3. Promote it. In Vercel, open Deployments, open the target deployment, open its menu and choose Promote. Or, from a checkout linked to `chengdu`, run `npx -y vercel@62.1.0 promote <deployment url>`. It is the same lever as section 3.1. Never promote a Preview build.
4. Prove it: `curl -sS https://pubmaxxing.com/api/version` names the target deployment id, and `curl -sS https://pubmaxxing.com/api/health` gives `"database":"ok"`. Walk smoke rows 4, 6, 8 and 10 by hand.
5. Do not run `npm run release:prod` again until the fix has merged. The command releases the tip of `main`, which is the bad build.
6. Leave the migrations in place. Most launch migrations add tables and columns that an earlier build does not read. A build from before `0215` cannot create route proposals (8.2.1), so prefer a known-good target that was released after the migrations. Run a rollback file only when the migration itself is the fault, and read its header first.
7. Add a row to the release record: the time, from which deployment, to which deployment, and why.

For a Social incident, use the lighter levers in section 1.4 and in [`OPS_FREEZE_RUNBOOK.md`](OPS_FREEZE_RUNBOOK.md) before a full rollback.

#### 8.5.5 Upgrade Supabase on the day: the trigger (Owner action)

Captain decision 6 keeps the free plan. The launch plan (R1) says to upgrade on the day if the spike is large. This is the line.

The app reaches the database only through Supabase's HTTP API and Realtime. It opens no direct database connection. So a full connection pool shows up as slow or failed API reads and as refused Realtime connections, not as an error that names the limit.

Before Tuesday, open the project's Settings, Compute and Disk page and the organisation's Usage page. Write the limits that they show for the free plan here, so nobody guesses them on the day: database connections ______, pooler connections ______, Realtime connections ______.

Upgrade when any one of these holds for 10 minutes:

1. Supabase reports, database: the connections line sits at or near the maximum that the chart shows.
2. Supabase usage: Realtime connections are at or near the limit that the page shows.
3. The database CPU chart sits at 100 per cent.
4. The uptime monitor reports `/api/health` down while `/api/version` answers, and the Supabase status page shows no incident.
5. `rate_limit.fail_open` posts again within 15 minutes, from more than one route.
6. Vercel logs show database errors such as "too many connections", "remaining connection slots are reserved", or a timeout while the API waits for a connection.

How:

1. Supabase, the organisation, Billing: change the plan to Pro. The page shows the price before you confirm.
2. If the connections line still sits at the maximum 15 minutes later, open the project's Settings, Compute and Disk, and choose the next size up. A compute change restarts the database, so reads fail for a short time. The page says so before you confirm. Read it.
3. Prove it: `/api/health` answers 200 with `"database":"ok"`, and the maximum line on the connections chart has moved up.
4. Keep the spend cap on. Write the time and the new plan in the release record.

#### 8.5.6 The day's record (Captain)

Write it at 20:00 UK, here or in a dated file under `docs/`.

| Item | Value |
|---|---|
| Deployment that served at 20:00 | |
| Releases and rollbacks today | |
| Uptime alerts (count, and the longest outage in minutes) | |
| Peak database connections, CPU and Realtime connections | |
| Supabase plan at 20:00 | |
| Exception alert fired (yes or no, and when) | |
| The four crew-night events today (counts) | |
| Findings opened | |

### 8.6 The uptime monitor and the alerts

Launch plan R3 asked for an uptime check, the alert webhook, a PostHog alert on `$exception` and the emergency contacts. The fleet built the monitor. The other three are owner actions.

#### 8.6.1 How the monitor works

- **What.** `.github/workflows/uptime.yml` runs `scripts/ci/uptime-check.mjs` every five minutes, the shortest interval GitHub allows. It asks `https://pubmaxxing.com/api/health` and `/api/version`. The origin comes from `PRODUCTION_SITE_ORIGIN` in `lib/siteUrlConfig.mjs`, the same constant the app reads.
- **When it says down.** A route fails when it does not answer 200 within 15 seconds, answers 200 with a body that does not say ok (for health, that the database is ok), or answers with a redirect. A failed route is asked once more 30 seconds later. Only a route that fails both times is down, and only then does the run fail. One failure and then a good answer prints a warning, and the run stays green.
- **How it alerts.** A failed scheduled run reaches `.github/workflows/alert-on-failure.yml`, which posts `[pubmax][ci] Production uptime failed: <run link>` to the `PUBMAX_ALERT_WEBHOOK_URL` repository secret. During an outage the post repeats about every five minutes until the site answers. A run that you start by hand never alerts, because you are watching it.
- **What it sends.** No secret and no credential. The two routes are public. The log shows the status, the time and the deployment id, never a response body.
- **Its limits.** GitHub can start a scheduled run late, or drop it when its queue is busy, so an alert can come 5 to 20 minutes after the site goes down. A schedule runs only from the default branch, so the monitor starts when this change is on `main`. GitHub turns a schedule off after 60 days with no repository activity. An external monitor on `/api/health` ([`DEPLOYMENT.md`](DEPLOYMENT.md#uptime-monitor)) is an optional second opinion that does not depend on GitHub.

After the merge, start it once by hand, and check that the alert workflow follows each run (Owner action, O9):

```sh
gh workflow run uptime.yml --repo Singularityszn/pubmax
gh run list --repo Singularityszn/pubmax --workflow uptime.yml --limit 3
gh run list --repo Singularityszn/pubmax --workflow alert-on-failure.yml --limit 3
```

The alert workflow shows a skipped run after each good uptime run. That proves the link between the two. Only a real failure proves the whole chain, so the test post in 8.6.2 is the proof of the webhook itself.

#### 8.6.2 The alert webhook (Owner action, O5)

The secret's name is `PUBMAX_ALERT_WEBHOOK_URL`. Its value is an https Discord or Slack incoming-webhook URL. Treat it as a password.

1. GitHub: Settings, Secrets and variables, Actions, New repository secret, with the name `PUBMAX_ALERT_WEBHOOK_URL`: `https://github.com/Singularityszn/pubmax/settings/secrets/actions`. Every scheduled workflow alerts through it, the uptime monitor included.
2. Vercel Production: the same name and value, marked Sensitive (8.2.2). The app posts its own error-level events through it.
3. Send one test post from your terminal. You type the URL in. It is never echoed and never written to a file:

   ```sh
   read -rs PUBMAX_ALERT_WEBHOOK_URL; export PUBMAX_ALERT_WEBHOOK_URL
   jq -n --arg t "[pubmax][test] Launch week alert test" '{content: $t, text: $t}' |
     curl -fsS --max-time 20 -X POST -H 'content-type: application/json' --data @- "$PUBMAX_ALERT_WEBHOOK_URL" > /dev/null && echo sent
   unset PUBMAX_ALERT_WEBHOOK_URL
   ```

4. The line appears in the channel. Write the date in O5.

#### 8.6.3 The PostHog alert on `$exception` spikes (Owner action, O6)

The browser and the server both send `$exception` events with `environment` set (`lib/posthogClient.ts`, `lib/posthog/posthogServerException.ts`). No agent creates this alert: the deployment's PostHog token can only write events.

1. Open `https://eu.posthog.com/project/219466`. Choose Product analytics, then New insight, then Trends.
2. Series A: the event `$exception`, counted as total count.
3. Add a filter: the event property `environment` equals `production`.
4. Set the interval to Hour and the date range to the last 7 days.
5. Save the insight as "Exceptions in production, by hour".
6. Read the highest hourly value in the last 7 days. That is the baseline. Write it here: ______.
7. On the saved insight, open Alerts, then New alert.
8. Name it "Exception spike". Check series A. Alert when the value is more than three times the baseline, and never less than 10. Check every hour. Notify the captain's PostHog user by email. If the form offers to check the current hour before it is complete, turn that on.
9. Save. The alert shows in the alert list of the insight. Write the date and the threshold in O6.

The alert checks once an hour at most. The uptime monitor and the alert channel are the fast signals. This alert catches a rise in errors that does not take the site down.

#### 8.6.4 The emergency contact list (Owner action, O7)

The repository is public. Write the real names and numbers in a private copy, for example the password manager, and print one copy. Do not commit them here. Account recovery for each service stays in the escalation list in [`OPS_FREEZE_RUNBOOK.md`](OPS_FREEZE_RUNBOOK.md#escalation-list-owner-to-fill-in). Fill that in too.

| Role | Name | Phone | Second way to reach them | What they decide or do |
|---|---|---|---|---|
| Owner on call (captain) | (fill in, private copy) | (fill in, private copy) | (fill in) | Release, rollback, database upgrade, vendor caps |
| Backup contact | (fill in, private copy) | (fill in, private copy) | (fill in) | Answers when the owner does not answer within 15 minutes, and calls the owner |
| Product Hunt hunter | (fill in, private copy) | (fill in, private copy) | (fill in) | The launch post and its replies |
| Vercel support | Not a person | None | The help page in the Vercel dashboard | Platform incidents on `chengdu` |
| Supabase support | Not a person | None | The support form in the Supabase dashboard | Platform incidents on `iankajxliutqogqkmvdg` |
| Domain registrar (GoDaddy) | Not a person | (fill in, private copy) | (fill in) | `pubmaxxing.com` |
| Legal and safeguarding | (fill in, private copy) | (fill in, private copy) | (fill in) | Threats, illegal content, self-harm |
