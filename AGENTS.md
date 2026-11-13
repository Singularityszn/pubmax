# PubMaxxing

PubMaxxing (pubmaxxing.com) is a price-aware London pub-crawl planner. It is one Next.js 16 app (App Router,
React 19, TypeScript) with a MapLibre 3-D map, Supabase, and a Capacitor shell for iOS and Android.

## What we never compromise

1. **Honest prices.** Every price shows its source and date. A city with no prices says so. AI never invents
   a price, opening hours or pub lore. Heritage and plan answers fail closed.
2. **Speed.** Time to the first priced pin on a phone is the metric. Performance ceilings come down, never up.
   Raising one needs the measured figure and the captain's word. See `perf/AGENTS.md`.
3. **Nothing is fetched without permission.** `lib/harvest/sourcePolicy.ts` is the fence in front of every
   harvested URL. No caller passes it a URL of its own.
4. **Drinkers never pay.** First revenue comes from venues. A referral is a mark of honour, never a feature
   (`lib/referrals.ts`). The Year in Pints wrap is free forever. The full anti-goals are in
   `docs/factory/vision.md`.
5. **Launch first.** Until launch, do not add a page, API route or migration that the launch plan does not need.

## A note from the captain

Speed, performance, design and customer onboarding decide every change. Fight scope creep. Find the smallest
change that makes the correct behaviour obvious. Do not keep complexity because it exists. If a rule here fights
the task, say so and ask before you break it.

## Words

Use the terms in `CONTEXT.md`. **Captain** is the owner. **You** is the agent. **Pint Drop** is a price a person
logged. **Plan** is a night out with stops. **Pal** is the Pub Pal assistant.

## Ways to hurt yourself

1. **Writing to production.** Preview deployments use the production Supabase project. A signed-in preview test
   writes production data. Never run a schema experiment against a shared database.
2. **Applying a migration.** Agents ship SQL with a rollback beside it. An agent applies one migration only on the
   captain's explicit "apply <n>", and a separate agent verifies it. Only the captain decides a deploy. See
   `supabase/AGENTS.md`.
3. **Killing by pattern.** Never `pkill` or `killall`. Stop only a PID you started. Use a private port.
4. **Sharing `.next`.** A concurrent `next dev` and `next build` corrupt `.next`. For production QA, build and
   serve with `NEXT_DIST_DIR=.next-prod`.
5. **Fetching around the fence.** No script or route fetches a harvested URL without `sourcePolicy`.

## Hit every surface

A change that works on the path you tested is often missing elsewhere. Before you call UI work done, say which
of these applied:

- **Widths:** 390, 768 and 1440. Large text. Light and night theme.
- **Shells:** web, iOS (Capacitor), Android.
- **People:** signed out, signed in, under 18, a new account.
- **Places:** London, a city with prices, a city with no prices.
- **Doors:** the map, the venue sheet, Plan, Pal, a shared link. A way in needs a way out.
- **Copy:** `docs/VOICE.md`. Tokens and primitives: `docs/DESIGN_SYSTEM.md`. Tests fence both.

## Dev

- `npm run dev` runs with no secrets: in-memory stores and grounded structured-only heritage answers.
  `.env.local` adds Supabase and model keys. See `.env.example`.
- To drive the app in a browser and take evidence, follow `e2e/AGENTS.md`.
- Do not commit `next-env.d.ts` or tooling churn. A build, `validate-data` or a plain `npm run verify` restamps
  `public/data`. Unless your change rebuilds data on purpose, run `git restore public/data` before you stage.
- Change `allowScripts` only with its reason in `scripts/ci/install-script-allowlist.mjs`.

## Verifying

- Before you push, run `npm run verify:no-mistakes:changed`: the lint, typecheck and tests that your change reaches.
- Do not run `npm run verify` or the full suite locally unless asked. CI owns it, and a merge needs CI green on
  the latest commit.
- A red check is fixed at its source. Rerunning a red job does not fix a flaky test. Fix a flaky test without
  test-runner retries or skips. If the fix is outside your task, file it with the evidence and tell Firstmate.

## Tests

- Test behaviour that can break: prices and trust, auth and RLS, money and limits, data parsing, persistence,
  race fixes, and the logic a bug fix changed.
- Do not test what types guarantee, copy text, static markup, mock-call mirrors or file lists.
- Extend an existing test before you add one. Test at one layer: the lowest one that fails on main.
- A logic bug gets a failing test first. A purely visual bug gets before/after screenshots and no test.
- No fixed sleeps, manual polling loops, per-test timeouts or test-runner retries. Wait for the event.
  Web-first auto-retrying assertions (`expect(...).toPass()`) and auto-waiting locators are allowed. A skip names its tracking issue.
- Do not add a test that reads source or workflow files as text. If a rule needs a machine check, make it a lint rule.

## Pull requests

- One problem per PR. Aim for under 400 changed lines, tests excluded. Say why if it is bigger.
- Title: a conventional commit in plain words, for example `fix(map): pins no longer flash on zoom`.
- Body, in plain English: the problem in one or two sentences, the change, how you checked it, what you could
  not check. UI changes include before/after images. Motion needs a short video.
- A PR that touches auth, RLS, prices, money or migrations also carries the show-me body: pseudocode of the
  changed logic, one Mermaid diagram of the flow, and the three-commit TDD proof (failing-test commit, red run, green run).
  Other PRs keep the short body. `.github/PULL_REQUEST_TEMPLATE.md` has both.
- Upload evidence to the PR. Never commit screenshots, proof sheets, plans or scratch notes.
- Check each review finding against the source. Fix real ones. Dismiss false ones with a reason. Stop when the
  checks are green on the latest commit.
- No `Co-Authored-By` agent trailer and no session link. Merges happen only on the captain's word.

## Docs

- Most changes need no doc change. Agents can read the code.
- An area `AGENTS.md` holds only traps that the code cannot show, in under 4 KB. No incident stories, dates
  or PR numbers. The PR is the history. Long rules live in `docs/rules/`. Read one only for the rule you change.
- When a decision changes, rewrite or delete the old text. Do not append.
- Talk to the captain in Simplified Technical English. Follow `.agents/skills/ste/SKILL.md`.

## Where things live

Each agent reads the nearest `AGENTS.md` up the tree from the file it edits.

| Area | Owner file |
| --- | --- |
| Routes, API envelope, proxy, CSP | [`app/AGENTS.md`](app/AGENTS.md) |
| Map, sheets, design primitives | [`components/AGENTS.md`](components/AGENTS.md) |
| Stores, policy leaves, vocabularies | [`lib/AGENTS.md`](lib/AGENTS.md) |
| Harvest modules (pointer to scripts) | [`lib/harvest/AGENTS.md`](lib/harvest/AGENTS.md) |
| Harvest, builders, gates, deploys | [`scripts/AGENTS.md`](scripts/AGENTS.md) |
| Migrations, RLS, permissions | [`supabase/AGENTS.md`](supabase/AGENTS.md) |
| Unit tests, PostgreSQL harness | [`__tests__/AGENTS.md`](__tests__/AGENTS.md) |
| Browser tests and browser evidence | [`e2e/AGENTS.md`](e2e/AGENTS.md) |
| iOS shell and shared native seams | [`ios/AGENTS.md`](ios/AGENTS.md) |
| Android shell | [`android/AGENTS.md`](android/AGENTS.md) |
| Datasets and price lanes | [`data/AGENTS.md`](data/AGENTS.md) |
| Published data packs (pointer to data) | [`public/data/AGENTS.md`](public/data/AGENTS.md) |
| Copy and analytics | [`docs/AGENTS.md`](docs/AGENTS.md) |
| Performance ceilings | [`perf/AGENTS.md`](perf/AGENTS.md) |

Issues: GitHub Issues on Singularityszn/pubmax, labels in `docs/agents/triage-labels.md`.
Decisions: `docs/adr/`. Vision and roadmap: `docs/factory/`. Task workflow: `docs/agents/build-methodology.md`.

## Taste

- Routes stay thin: decode input, call one store or service function, map errors to the one API envelope.
- One owner per rule. Closed vocabularies live in `lib/`.
- Design primitives own their look. Pick a variant. Do not restyle one in place.
- No new file over 800 lines. Do not grow `components/PubMap.tsx`, `components/PubMapCanvas.tsx` or
  `app/globals.css`. Extract from them.
- Default to no comment. Write one only for a constraint the code cannot show.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
