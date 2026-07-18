# FABLE SESSION HANDOFF (2026-07-18 morning, updated continuously)

Read this first after any model/effort switch or compaction. This is the live state; history lives in fable-implement-prd.md (cycles 1-14) and docs/CYCLE15_PRD.md + docs/PERSONA_DRINKS_AND_DESKTOP_PRD.md. THE CURRENT PROGRAMME IS docs/UNIVERSAL_DAY0_PRD.md (cycle 17, launch week): Sol and every new lane read that file first.

## Who and how

Owner: Karan (address by name, he/him). Asleep until morning; granted six-hour full autonomy (~21:00-03:00 UK). Fable = architect/reviewer/merger; NEVER implements inline. All implementation via agents in ISOLATED worktrees, separate branches, non-draft PRs. Announce model tier + exact version + effort per delegation. Opus 4.8 (claude-opus-4-8) = implementation; Fable forks = taste/architecture/review. Merge on full green only (Vercel runs npm run ci = tests + build; CodeRabbit + Cursor security also gate). Squash merge, delete branch, remove worktree after. Caveman terse mode active for replies. No em dashes in any product copy. Anti-slop bar ruthless. Provenance non-negotiable.

## Tonight's approved decisions (owner said GO)

CSP double-build line CLOSED (v3 refuted; owner conversation pending) · check-ins stay friends-only · idle orbit stays removed · bill-split OUT of launch · demo flip DONE (NEXT_PUBLIC_DEMO_CONTENT=off in prod env) · persona shape = pub-tied lens only · standing privacy rule: named private individuals NEVER appear on the public site or in tracked files (specifics live in session memory); private-personas feature is the sanctioned alternative (future ticket).

## Merged tonight + this morning

#380 area news · #381 desktop parity · #382 cleanup · #383 hermetic weather tests · #398 seven live-verify fixes · #399 workflow docs · #400 persona lens · #401 desktop D1 shell · #402 feed/You clarity · #403 map clarity · #404 copy/layout · #405 GNHF tests · #406 prod-deploy unbreaker (vitest.setup strips NEXT_PUBLIC_DEMO_CONTENT + canary; prod deploys had been silently failing since demo flip) · #407 whats_on refresh (477 servable rows) · #409 tonight data root cause (isOnTonight start-containment dropped all 384 all-day deals every night; now interval overlap; Tuesday 1 row to 127) + copy fixes · #410 map boot two-clock skeleton fix + ?q= restore fly-to. Wayfinder clarity loop #393-#397: judge verdict delivered, final wave merged; close #396/#397 with evidence.

## Running lanes (cycle 17, see docs/UNIVERSAL_DAY0_PRD.md for full briefs)

- Lane A (Opus worktree): /today morning brief + mobile home
- Lane B (SOL/Codex): web push backend + daily brief sender
- Lane C (Opus worktree): /pal concierge chat skin over existing engine, narration flag OFF
- Lane D (Opus worktree): growth loop (crew invites end-to-end, press kit, ASO, owner content assets)
- Lane E (SOL/Codex): restaurants + attractions ingest through slop filter + provenance bar
- Owner awake and steering. Overnight lanes all closed. CSP line CLOSED (v3 refuted; owner conversation pending, three options recorded in session).

## Standing watchers/protocol

PR watchers = background bash until-loops (gh pr checks N; grep -c pending = 0 → settled; grep -c fail exit code 1 means ZERO fails, read the printed number). On green: gh pr merge N --squash (allowed rule Bash(gh pr merge:*)); git revert allowed (Bash(git revert:*)). GitHub Actions crons DEAD (billing, $0 limit — owner morning item); run scripts manually instead (npm run refresh:weather done tonight; ingest:night-signals available). The "3 pre-existing weather test failures" lanes report locally are LOCAL CLOCK NOISE; Vercel is the gate and has been green since #383. Shared checkout must stay on main; lanes sometimes stray-branch it — fix by cherry-pick to main + branch -D. Disk was 95%, now ~72% after worktree purge; purge finished-lane worktrees promptly.

## Remaining this week (in order)

1. Close #396/#397 with evidence (judge report + #409/#410 merges); verify prod dpl_ serves post-merge build.
2. Cycle-17 lanes per docs/UNIVERSAL_DAY0_PRD.md sequencing (A+B, then C+D, then E rows; judge loops day 4-5; Capacitor sync day 6).
3. Update fable-implement-prd.md with cycle 15/16 close + cycle 17 open.
4. Morning-list conversation items with owner: Actions billing (CRITICAL for brief freshness), store enrollment #390, Ticketmaster key #385, VAPID keypair, Exa/Firecrawl credit top-ups, OpenRouter funding for narration flip, sport seed #408, stale stash@{0}, CSP three-options conversation.

## Owner morning list

GitHub Actions billing (Settings->Billing, raise $0 limit — revives weather/signals/ingest crons) · TICKETMASTER_API_KEY (ticket #385, sole real events path) · store enrollment (ticket #390) · soft-launch runbook items (ticket #392) · review the night's design changes on his iPhone.

## Wayfinder

Map = issue #384. Spec #393 (clarity bar) with loop tickets #394 (closed) -> #395 -> #396 -> #397. Closed decision tickets: #386, #387, #388, #391.

## FULL EXECUTION LEDGER (everything, condensed)

Pre-launch programme (cycles 1-12, detail in fable-implement-prd.md): ~60 PRs #276-#360 built by Opus/Fable lanes, reviewed, merged in choreographed order on 2026-07-18 launch day — includes THE LOCAL night OS, plans/crawls/rounds, moments + recap artifact (privacy choke getPublishedRecapSource), night signals pipeline, Pint Index + zone lens (#328 role tokens, bar-mat design thesis), prompt orchestration budget, durable rate limiting, write-surface certification (now 63), dual-backend store seam + factory (#360), Capacitor iOS wrap (#295), weather cache + late food, consent-gated analytics, PWA/offline, em-dash sweep (#358), provenance registry (#359), global gutters (#357), Tonight sheet fix (#356). Launch-day deploy crisis: five sequential CI-only failures fixed, final blocker withRouteTiming type erasure (fcf60731); production went green same evening.

Cycle 13 (evening): owner keys verified + wired (Eventbrite: capability-dead for discovery, honest zero-row provider seam #364; Exa: night-signals ingest producer + daily workflow #366; TfL keyless). Live-data wave merged: #361 FHRS hygiene badge (Sorensen-Dice match), #362 police night-calm bands (relative share, tone-tested), #363 TfL get-home strip on Tonight (privacy copy honest, coords rounded), #365 heritage NHLE facts (237 pubs, OGL attribution). Londonmaxxing resources audit sourced the API shortlist. Meetup parked (OAuth+Pro).

Cycle 14 (night): owner screenshots + desktop audit (13 findings) drove: #367 map UX (list-pill CSS ordering, rotation flattening root cause, attitude upgrade, brass compass), #368 venue sheet dvh + Train dedupe, #369 perf split (3MB price JSON out of map chunk, 7.9->5.2MB; owner REJECTED unsafe-inline via AskUserQuestion), #370 The Crossing brand activation (favicon/icons/manifest/OG), #371 search fly-to + /stories redirect + branded 404 + banner gating, #372 drawer polish (peek-strip media leak, Positron light basemap, pin precedence), #373 copy quality (event-title dash seam, pint-index lead, superscript citations). CSP saga: #374 manifest-header delivery FAILED live (Vercel drops patched manifest; ~30min no-CSP window, reverted), #375 meta-tag delivery FAILED live (Vercel serves own prerender store, reverted 2f91ce5e); v3 double-build running under proof protocol. Anthropic skills refreshed (13 new). Global ideate skill created (~/.claude/skills/ideate + CLAUDE.md rule). Memory rules: api-credit-alerts, ideation-flow.

Cycle 15 (this night): four regional research sweeps (~150 sourced facts + concrete pint prices via Firecrawl social pass; deserts confirmed: Ilford/Romford/Purley) -> docs/research/. Slop audit (F1 voice spec unapplied, F2 493/693 scraped slop descriptions) -> #376 slop filter (93% filtered to honest empty states) + voice spec applied. #377 native readiness (Android platform, Crossing icons/splash, docs/STORE_READINESS.md; owner-only steps enumerated). #378 Tonight Conditions (8-rule drinkWeather table, honest no-fireplace-amenity refusal) + manual weather refresh (20 observations; cron dead per Actions billing). #379 Social Loop v1 (mutual follow=your lot, share-link /add/handle, feed tabs, we're-out check-ins area-only 12h expiry, migration 0043 privatizes follow graph; three CI rounds: module-scope assertServerEnv, then requiresSupabaseStore guard, both fixed by house-idiom test mocks). #380 area news layer. Persona drinks: research crawl 81 sourced entries (rejects prove the bar: brand-owners, sober, apolitical) -> #400 lens. Then tonight's merges listed above (#381-#400) and the running lanes.

Infrastructure facts a fresh session needs: pubmaxxing.com = Vercel project chengdu (pubmax project builds too); prod env has EVENTBRITE_API_TOKEN, EXA_API_KEY (also GH secret), NEXT_PUBLIC_DEMO_CONTENT=off; .env.local (gitignored) additionally has FIRECRAWL_API_KEY (valid; the firecrawl MCP server env is stale — use REST via curl); TfL needs no key. Firecrawl/Exa credit failures must be reported to owner immediately (standing memory rule). GNHF CLI installed. Chrome extension browser automation works but window won't resize below ~910px.
