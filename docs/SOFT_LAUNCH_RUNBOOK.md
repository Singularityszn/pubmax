# Soft-launch runbook

_The MECHANISM of the PubMaxx v1 soft launch: how the deploy, the migrations, the flags, the smoke, the rollback and the monitoring work. It tracks issue [#392](https://github.com/Singularityszn/pubmax/issues/392)._

**The ORDER lives next door.** [`docs/SOFT_LAUNCH_CHECKLIST.md`](SOFT_LAUNCH_CHECKLIST.md) is the ordered runbook for the first hundred users: pre-launch proof, launch day, the first week and rollback, each step naming its owner and its proof. Work down that file, and read this one for the detail it points at.

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
