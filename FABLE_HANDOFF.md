# FABLE SESSION HANDOFF (2026-07-18 night, updated continuously)

Read this first after any model/effort switch or compaction. This is the live state; history lives in fable-implement-prd.md (cycles 1-14) and docs/CYCLE15_PRD.md + docs/PERSONA_DRINKS_AND_DESKTOP_PRD.md.

## Who and how

Owner: Karan (address by name, he/him). Asleep until morning; granted six-hour full autonomy (~21:00-03:00 UK). Fable = architect/reviewer/merger; NEVER implements inline. All implementation via agents in ISOLATED worktrees, separate branches, non-draft PRs. Announce model tier + exact version + effort per delegation. Opus 4.8 (claude-opus-4-8) = implementation; Fable forks = taste/architecture/review. Merge on full green only (Vercel runs npm run ci = tests + build; CodeRabbit + Cursor security also gate). Squash merge, delete branch, remove worktree after. Caveman terse mode active for replies. No em dashes in any product copy. Anti-slop bar ruthless. Provenance non-negotiable.

## Tonight's approved decisions (owner said GO)

CSP double-build GO (preview-proof before merge) · check-ins stay friends-only · idle orbit stays removed · bill-split OUT of launch · demo flip DONE (NEXT_PUBLIC_DEMO_CONTENT=off in prod env) · persona shape = pub-tied lens only · Erin (private person) NEVER goes on the public site; private-personas feature is the sanctioned alternative (future ticket).

## Merged tonight (after owner slept)

#380 area news (95 facts, award plaques) · #381 desktop parity (Escape layering, press feedback) · #382 cleanup (CrossingMark on all OG cards, rate-limit factory, net -72 lines) · #383 hermetic weather tests (unbroke CI) · #398 seven live-verify fixes (sticky bar 641-768px band, compass mobile, martini pin root cause = accent hash leak, metadata title, source-label dashes) · #399 workflow docs (Actions billing block found) · #400 persona lens (80 entries incl Ron Burgundy milk).

## Running lanes (task names for SendMessage)

- wave1-feed (Opus): feed double-taxonomy merge, You signed-out fix, /you redirect
- wave1-map (Opus): visible search chip, boot skeleton gap, accent diet on Describe pill
- wave1-copy (Opus): Tonight reorder, price-empty CTA, pint-index trims, landing drink-shapes, borough ledger label
- desktop-shell / D1 (Fable fork): right rail (conditions always visible) + feed two-column; was in local CI, push imminent
- csp-v3 (Fable fork): pinned-build-id double build; mid hash-stability experiment; PROOF PROTOCOL: merges only after ITS OWN preview deploy serves hash CSP + PRERENDER/HIT + /map nonce
- design-judge: iteration-1 done (report in ticket #394 close comment); re-judge = clarity loop 3 (#396) after wave 1 merges
- GNHF (external CLI, Codex agent, bib7q45u8): tests-only on branch gnhf/test-depth; steering tripwire monitor b1pfb1acb fires per commit; on exit run companion review (independent coverage + suite check) before any merge

## Standing watchers/protocol

PR watchers = background bash until-loops (gh pr checks N; grep -c pending = 0 → settled; grep -c fail exit code 1 means ZERO fails, read the printed number). On green: gh pr merge N --squash (allowed rule Bash(gh pr merge:*)); git revert allowed (Bash(git revert:*)). GitHub Actions crons DEAD (billing, $0 limit — owner morning item); run scripts manually instead (npm run refresh:weather done tonight; ingest:night-signals available). The "3 pre-existing weather test failures" lanes report locally are LOCAL CLOCK NOISE; Vercel is the gate and has been green since #383. Shared checkout must stay on main; lanes sometimes stray-branch it — fix by cherry-pick to main + branch -D. Disk was 95%, now ~72% after worktree purge; purge finished-lane worktrees promptly.

## Remaining tonight (in order)

1. Merge wave-1 x3 + D1 on green; re-run design judge (loop 3, ticket #396); final wave (#397) with closeout evidence pack.
2. csp-v3: enforce the preview-proof protocol; if hash instability refutes the mechanism, STOP the CSP line entirely and record it (third failure = owner conversation, not a fourth attempt).
3. GNHF companion review on exit.
4. Live verification pass: demo-off confirmed on prod, persona lens live, all wave-1 fixes rendering.
5. Update fable-implement-prd.md (cycle 15/16 close) + morning report: merged list, before/after screenshots, scorecard, owner morning list.

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
