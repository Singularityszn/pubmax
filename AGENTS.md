# AGENTS.md

PubMaxing is a single Next.js 16 (App Router, React 19, TypeScript) web app, a price-aware London pub-crawl planner with a MapLibre 3-D map. There is one service.

## Cursor Cloud specific instructions

- **Factory docs:** See [`docs/factory/`](docs/factory/) for PUBMAXX vision and roadmap.

### Where the rules live

This file is an index. Every rule is written down once, in the area file that owns
the code it is about, and an agent reads the nearest one up the tree from the file
it is editing. Nothing here is a summary of a child: read the child before you
change code in that area, and add a new rule to the child rather than to this file.

| Area file | What it owns |
| --- | --- |
| [`app/AGENTS.md`](app/AGENTS.md) | Routes, pages, the API envelope, the proxy, CSP and file tracing. |
| [`components/AGENTS.md`](components/AGENTS.md) | The map canvas, the sheets and chrome, and the launch primitives. |
| [`lib/AGENTS.md`](lib/AGENTS.md) | The policy leaves, the closed vocabularies and the stores. |
| [`lib/harvest/AGENTS.md`](lib/harvest/AGENTS.md) | Pointer to scripts/AGENTS.md, which owns the harvest rules. |
| [`__tests__/AGENTS.md`](__tests__/AGENTS.md) | The unit suite: the PostgreSQL harness, jsdom and the launch fences. |
| [`e2e/AGENTS.md`](e2e/AGENTS.md) | The Playwright suite: the server it drives and the idioms that stop a spec lying. |
| [`scripts/AGENTS.md`](scripts/AGENTS.md) | The CLIs: harvest, builders, quality gates and deploys. |
| [`supabase/AGENTS.md`](supabase/AGENTS.md) | Migration labels, rollbacks, RLS and the permission matrix. |
| [`ios/AGENTS.md`](ios/AGENTS.md) | The Capacitor shell seams and the iOS capabilities. |
| [`android/AGENTS.md`](android/AGENTS.md) | The Android half of every native promise. |
| [`docs/AGENTS.md`](docs/AGENTS.md) | How copy reads, and what a number means. |
| [`data/AGENTS.md`](data/AGENTS.md) | The committed datasets, packs and price lanes. |
| [`public/data/AGENTS.md`](public/data/AGENTS.md) | Pointer to data/AGENTS.md. |
| [`perf/AGENTS.md`](perf/AGENTS.md) | Page and API ceilings, the Core Web Vitals baseline and the findings behind them. |

`CLAUDE.md` imports this file and nothing else. `__tests__/agentsMdTree.test.ts`
holds the table to the tree: every file named here exists, every area file in the
tree is named here, and this file stays under 12 KB.

### Laws that apply everywhere

- **Never red.** `npm run verify` is the merge bar and it is run locally, because
  a gate nobody spends is not a gate. Lint, a failing test and a flaky test are all
  yours to fix, whoever wrote them.
- **A ceiling comes down, never up.** Route and API budgets follow the measured
  figure down. Raising one takes the commit that needs it, the reason, and a
  measured figure beside it. See [`perf/AGENTS.md`](perf/AGENTS.md).
- **A commit carries no agent trailer.** No `Co-Authored-By` for an agent and no
  session link in a commit message.
- **Design and copy have a door.** `docs/DESIGN_SYSTEM.md` owns the launch tokens
  and primitives, `docs/VOICE.md` owns the words, and both are fenced by tests.
  See [`components/AGENTS.md`](components/AGENTS.md) and [`docs/AGENTS.md`](docs/AGENTS.md).
- **Nothing is fetched without permission.** `lib/harvest/sourcePolicy.ts` is the
  fence in front of every harvested URL, and no caller may hand it one of its own.
  See [`scripts/AGENTS.md`](scripts/AGENTS.md).
- **The captain applies migrations and decides a deploy.** Agents ship SQL and a
  rollback beside it. See [`supabase/AGENTS.md`](supabase/AGENTS.md).

### Working in this tree

- **Runs keyless.** `npm run dev` works with no secrets: Pint Drops use an in-memory store and `/api/heritage` returns grounded structured-only answers. Supabase and `OPENROUTER_API_KEY` in `.env.local` are only needed for durable persistence, browser auth, admin moderation and narrated heritage replies. See `.env.example`.
- **Standard commands** live in `package.json` scripts and `README.md`. `npm run verify` is the pre-push gate; `npm run ci` is verify plus build.
- **Pre-push hook** (`.githooks/pre-push`) runs `npm run verify`, but only after `npm run setup` sets `core.hooksPath=.githooks`; it is not enabled in a fresh clone.
- **Do not commit tooling churn.** `next dev` rewrites `next-env.d.ts`'s route-types import to the dev path and `npm install-scripts approve` adds an `allowScripts` block to `package.json`. Both are local artifacts of running the app, not changes: `git checkout --` them before committing.
- **Shared-worktree build gotcha:** a concurrent `next dev` and `next build` can clobber `.next` mid-build and leave `BUILD_ID` missing, so the `prestart` guard refuses to `next start`. For isolated production QA, build and serve with `NEXT_DIST_DIR=.next-prod`.

### Anti-goals

- **Honest path anti-goals (London night OS first).** Do not ship a Twitter-for-pubs growth engine; do not market multi-city splash without London density; do not add Stripe Checkout or payments theatre before venue trust density; do not build AI that fabricates prices, hours or pub lore (heritage and plan generate fail closed to grounded or scarcity answers); do not claim "we beat Stripe" in marketing or investor copy. THREE STANDING COMMITMENTS ride with these. (1) A REFERRAL IS A MARK OF HONOUR, NEVER A FEATURE: a milestone confers recognition and nothing in the product may branch on it (`lib/referrals.ts`, fence `__tests__/referralMarkLaw.test.ts`). The old capability-grant model is deleted, not switched off, in TypeScript and in SQL. (2) THE ANNUAL YEAR IN PINTS WRAP IS FREE FOREVER: it is a person's own year read back to them, so it may never sit behind a price, a tier, a referral count or an account upgrade. (3) FIRST REVENUE COMES FROM VENUES, NEVER DRINKERS: a drinker pays for nothing, and no drinker-facing paywall, membership or metered read may be built before the venue rail earns. Platform prep is ADR-only: `docs/adr/0011-venue-operator-rail.md`, `docs/adr/0012-entitlement-ledger-contract.md`. Ops checklist: `docs/growth/HORIZON0_OPS_CHECKLIST.md`. Extend `docs/plans/PLG_STRATEGY.md` waves rather than inventing a parallel roadmap.

## Agent workflow

Every task moves through the same four beats, from Michael Shimeles' Rasmic template, adapted to this
tree. A beat never overrides a law here.

### The four beats

1. **Isolate with `/new-feature`.** Start every task in a fresh worktree and branch cut from
   `origin/main`. Never build on `main`.
2. **Build with `/code-structure`.** Actions and boundaries orchestrate the why and when; a service layer
   owns the reusable how, with explicit inputs and structured returns. Here that is the policy-leaf shape
   [`lib/AGENTS.md`](lib/AGENTS.md) fences: one owner per rule, closed vocabularies, thin routes over the
   one API envelope [`app/AGENTS.md`](app/AGENTS.md) names.
3. **Prove with `/evidence-driven-testing`.** Run the repo's checks plus runtime evidence. Capture the
   BEFORE state while the issue reproduces, before the fix, when it is cheapest, and the AFTER state once
   it works. Evidence lanes: `npm run verify`, `npm run e2e:cli` for shots and snapshots, `docs/proof/`.
4. **Ship with `/before-and-after`, then `/greploop` or `/greploop-apps`.** Validate with no-mistakes
   once on the final head; that run precedes the PR. Open the PR with before/after proof in the body, a
   screenshot or video for a visible surface, measured numbers or output pairs otherwise. Then run
   `/greploop` on the opened PR, or `/greploop-apps` past Greptile's file-count limit, until Greptile
   reports 5/5 with zero unresolved comments.

### Writing for humans

Run `/unslop` over anything a person will read, before you commit, post or send it: commit messages, the
PR title and body, README and doc edits, code comments, the closing reply. It strips AI tells, swaps
fancy words for plain ones and passive voice for active. Apply it to text you wrote or changed, not to
prose you did not touch.

### Multi-agent rules

- Never commit directly to `main`.
- One worktree and one branch per task and per agent. Never reuse or modify another agent's worktree,
  branch or uncommitted work.
- **Scope check before starting.** Skim open PRs' changed files (`gh pr list`,
  `gh pr diff <n> --name-only`) and look for uncommitted work in shared checkouts. On overlap, stop and
  ask for direction.
- Never plain `--force` anywhere. Only `--force-with-lease`, and only on your own task branch.
- Resolve lockfile conflicts by regenerating, never by hand-merging.
- Worktrees do not isolate shared resources: confirm a dev-server port answers your own process, never
  run schema experiments against a shared database, and mind the shared `.next` clobber above.
- If a conflict cannot be resolved confidently, stop and report instead of guessing.

### Completing a task

1. Keep the changes limited to the assigned task.
2. Run the checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` for browser work,
   `npm run build` for a deploy-shaped change. `npm run verify` is the merge bar. Hard invariants: the
   [laws above](#laws-that-apply-everywhere) plus the fences in [`lib/AGENTS.md`](lib/AGENTS.md) and
   [`supabase/AGENTS.md`](supabase/AGENTS.md).
3. Assemble the evidence captured along the way into before/after pairs.
4. Commit with a clear message, rebase onto the latest `origin/main`, and rerun the checks.
5. Push: `git push -u origin <branch>`, then `--force-with-lease` alone after rebasing a pushed branch.
6. Run the no-mistakes validation pass on the final head; it precedes the PR.
7. Open the PR. The body explains what changed, how it was tested, the before/after proof, and the risks
   and follow-up work.
8. Run `/greploop` or `/greploop-apps` until Greptile reports 5/5 with zero unresolved comments, then
   present the PR URL.

A merge happens only on the captain's word. Keep the worktree until the PR is merged or closed.

### Environment and local limits

- **Env quick reference, names only, never values.** The full list is [`.env.example`](.env.example); the
  keyless law sits [above](#working-in-this-tree). Task work touches `PUBMAX_E2E_KEYLESS`,
  `PUBMAX_E2E_LOGIN`, `PUBMAX_PG_MAX_CLUSTERS`, `PUBMAX_RLS_NO_PG`, `PUBMAX_RLS_ALLOW_SKIP`,
  `NEXT_DIST_DIR`, `PW_SKIP_WEBSERVER`, `PW_NEXT_DIST_DIR`.
- **Local test infrastructure.** The Playwright config builds and starts a keyless server with stub
  Supabase, VAPID, PostHog and admin credentials, so the suite needs no secrets; a stray server on its
  port makes a run lie, and priced specs attach the bill fixture through `e2e/helpers/priceBill.ts`
  ([`e2e/AGENTS.md`](e2e/AGENTS.md)). The unit suite boots throwaway PostgreSQL 16 clusters behind one
  harness ([`__tests__/AGENTS.md`](__tests__/AGENTS.md)).
- **Not testable locally.** The Vercel edge (body cap, proxy and CDN nonce lane, cron), production
  Supabase auth and Storage, APNS and FCM push, the OpenRouter moderation model, ElevenLabs. Prove those
  with `docs/proof/` evidence, a preview deploy the captain orders, or a measured figure in the PR body.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (Singularityszn/pubmax), driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default names: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root plus `docs/adr/`. See `docs/agents/domain.md`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
A rule about one area belongs in that area's own `AGENTS.md`, not here; this file keeps
the index, the laws that apply everywhere and nothing else.
When updating this file, preserve this bar for all agents and keep entries concise.
