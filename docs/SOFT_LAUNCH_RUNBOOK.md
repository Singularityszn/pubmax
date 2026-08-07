# Soft-launch runbook

_An operator's checklist for the PubMaxx v1 soft launch. Follow it in order. It tracks issue [#392](https://github.com/Singularityszn/pubmax/issues/392)._

---

## 1. Rollout order

### 1.1 Deploy mechanism

Vercel builds on every push through its Git integration. `vercel.json` sets the build command:

```json
{ "buildCommand": "npm run validate-data && npm run build" }
```

This runs the data gate and the Next build only. It does not run lint, typecheck, tests, or the audit.

**`docs/DEPLOYMENT.md` says the build command is `npm run ci` (the full gate). That is out of date.** PR [#748](https://github.com/Singularityszn/pubmax/pull/748) narrowed the Vercel build command on 2026-08-06 to cut build-hour cost. Tests, lint, and typecheck moved to GitHub Actions CI (`.github/workflows/ci.yml`).

GitHub Actions CI is currently broken. Every run on `main` fails with `startup_failure` before a job is allocated (a runner/account problem, not a code problem). The fix, PR [#747](https://github.com/Singularityszn/pubmax/pull/747) (migrate to Blacksmith runners), is still open and unmerged.

**Result: nothing automated currently checks lint, typecheck, or tests before a deploy reaches production.** Run `npm run ci` locally before every push this weekend. This already matches `docs/DEPLOYMENT.md`'s "Agent workflow for Codex / Opus" checklist, and it is now load-bearing, not a nicety.

One workflow does run and pass reliably: `.github/workflows/rls-session.yml` (effective RLS tests against a real Postgres 16 and PostgREST 14). Check it stays green on every push to `main`.

### 1.2 Promote after deploy

This project does not auto-assign the production domain to every deploy. After a Vercel deploy, promote it explicitly:

```sh
vercel deploy
vercel promote <deployment-url>
```

Run these from a normal deploy machine, never from a Mac, and never with `--prebuilt`. `docs/DEPLOYMENT.md` documents why promotion is safe to use after a build: the promotion API points production traffic at an existing deployment and does not rebuild it. The exact `vercel deploy` / `vercel promote` command pair above is operator practice; it is not itself written down in `docs/DEPLOYMENT.md`, so treat this section as the source for it going forward.

After promotion, confirm both hosts serve the release:

```sh
curl -sSIL https://pubmaxxing.com/map
curl -sSIL 'https://www.pubmaxxing.com/map?sel=venue-xjf3n0'
```

### 1.3 Migrations

The owner applies migrations. Agents ship SQL only.

`FABLE_HANDOFF.md` is not a current ledger. Its latest entry is dated 2026-07-23 and covers migrations only up to roughly `0053`. Do not use it to decide what is applied.

To check the live ledger, compare `supabase/migrations/` against the Supabase dashboard's migration history for the project (Database → Migrations), or run:

```sh
supabase migration list
```

**Live snapshot taken 2026-08-07 while writing this runbook** (reverify before running, this will go stale): the database has every migration applied through `0072_social_posts`. Six are not yet applied, in this order:

| Order | File | Migration |
|---|---|---|
| 1 | `20260806150000_0073_social_interactions.sql` | `0073_social_interactions` |
| 2 | `20260806151000_0074_social_composer.sql` | `0074_social_composer` |
| 3 | `20260806160000_0076_plan_member_group_prefs.sql` | `0076_plan_member_group_prefs` |
| 4 | `20260806162000_0077_pending_plan_recaps.sql` | `0077_pending_plan_recaps` |
| 5 | `20260806235944_0075_social_crews.sql` | `0075_social_crews` |
| 6 | `20260807000000_0078_profile_tombstone.sql` | `0078_profile_tombstone` |

Note the order: `0075_social_crews` has a later timestamp than `0076` and `0077`, so it applies last despite its lower number. This is the same out-of-order case `docs/DEPLOYMENT.md` documents for `0070`-`0072`. Use `supabase db push --include-all` rather than assuming filename-number order, and check `0075` does not depend on anything `0076` or `0077` add before applying it out of number order.

### 1.4 Feature flags

Social ships behind one server-checked flag, `SOCIAL_INVITE_BETA_ENABLED` (read in `lib/socialAccessServer.ts`). Set it to `"1"` to open the invite beta; any other value, including unset, keeps every Social surface in `preview` state (`isSocialInviteBetaEnabled`, `lib/socialAccess.ts`).

Do not enable it yet. Issue [#736](https://github.com/Singularityszn/pubmax/issues/736) blocks the beta on a primary and backup moderator, and `docs/social/SOCIAL_BETA_CONTRACT.md` lists both as **Unassigned, Blocking**. Check that table before flipping the flag.

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
| Social tab | `https://pubmaxxing.com/social` | While the beta flag is off: safe preview copy only, no post content, no sign-in-required content leak. Once the flag is on: verified adults see the feed; everyone else sees the correct `sign_in_required` or `age_verification_required` state. |

---

## 3. Rollback

### 3.1 Application code

Promote the previous known-good deployment:

```sh
vercel promote <previous-deployment-url>
```

Find the previous URL in the Vercel dashboard's Deployments list, or `vercel ls`. This does not rebuild anything; it repoints production traffic.

### 3.2 Migrations are not rollback-safe by default

Applied migrations are not covered by a code rollback. Rolling back the app does not undo a schema change.

Every migration from `0071` onward, including all six migrations queued for this weekend (section 1.3), has its own matching file in `supabase/migrations/rollback/`. Run the rollback SQL manually against the database; nothing runs it automatically.

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

The site's one public contact address is `CONTACT_EMAIL` in `lib/siteContact.ts`. Read it from that file rather than copying the address into a message; the file is the single place the app itself uses, and it can change without this runbook going stale.

### 5.2 Social moderation rota

`docs/social/SOCIAL_BETA_CONTRACT.md` requires a named primary and backup moderator, able to resolve reports within 24 hours, before any invite-beta flag goes live. As of this runbook, both are listed **Unassigned, Blocking** in that document and in issue [#736](https://github.com/Singularityszn/pubmax/issues/736).

Do not enable `SOCIAL_INVITE_BETA_ENABLED` until both roles are named and the handover between them has been exercised at least once. Check `docs/social/SOCIAL_BETA_CONTRACT.md`'s moderation table for current status before launch.
