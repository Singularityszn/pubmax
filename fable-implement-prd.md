# FABLE IMPLEMENT PRD — App Launch Foundations (2026-07-17)

Author: Fable 5 (architect/reviewer — no inline execution). For Sol's review. This file is the only direct-to-main commit from this session; all code went through PRs listed below, **none merged** — Sol reviews and merges.

## Decisions grilled with the owner (locked)

1. **Distribution**: Capacitor wrap of the existing PWA + native push + real in-app camera. No static export — remote-URL shell over pubmaxxing.com. Full native rebuild rejected.
2. **Sequencing**: foundation before wrap. Verified against GitHub remote (local clone was 25 commits stale — remote main is ground truth; squash merges make local ahead/behind counts lie).
3. **Launch headline**: London-only THE LOCAL loop. Wave 2 nine-city and Wave 4 Pub Pal voice deferred.
4. **Growth**: crew-invite universal links (eng priority) + Pint Index press launch + owner clears SEO blockers. Paid UA budget confirmed exists.
5. **Store accounts**: none existed; Apple enrollment deferred by owner ("mobile site version first"). Play's 14-day new-account closed-test rule likely pushes Android production past the month.
6. **Convex**: NOT migrating. Supabase is certified production (RLS, ledger, Wave 0 write-surface certification); `convex/` stays dormant. Post-launch decision.
7. **Process**: Fable plans/reviews only; implementation delegated to model-tiered subagents (haiku=mechanical, sonnet=standard, opus=hard). Fable never merges — Sol reviews + merges in the owner's Codex environment. Fable's work never overwrites owner/GPT plans (sol2.md, PRDs).

## Ground-truth audit (start of session)

Remote main `5e1252df` already contained Sol's overnight lanes: H1 rate-limit isolation, F1 night-profile (+ wired into You), locked public error contract, store dedup, weather + late food, endings persistence, Master PRD #280, Wave 0 mutating-API certification #292, consent analytics #294, migration ledger #289, sheets-above-nav #290. Live prod verified fresh (serves night-profile 401 with proper envelope; no stale deployment pin). H1 fix confirmed per-IP (`app/api/plans/generate/route.ts:179`).

## Shipped this session (open PRs — Sol's queue)

| PR | Title | Implementing model | Status at handoff |
|---|---|---|---|
| #276 | About/founder story + press kit — conflicts vs redesigned landing resolved; CodeRabbit MAJOR fixed (aboutStats counts only venues with accepted price observations); stylelint + test fixes | Fable 5 subagent (inherited, pre-tiering rule) | CI green + CLEAN |
| #295 | Capacitor iOS wrap foundation: remote-URL shell, `ios/` scaffold (SPM), native seams (`lib/nativePlatform/nativeCamera/nativePush.ts`), `POST /api/push-tokens` + `lib/pushTokenStore.ts` + migration `0039_push_tokens`, AASA universal links (`/plan/*`, `/rounds/*`, `/p/*`), breakpoint hoist `lib/breakpoints.ts`. Architect review forced 5 fixes (rate limit, error envelope, webDir stub, AASA comment, write-surface certification as route 61). Cursor security MEDIUM (forwarded-header rotation) fixed with global backstop bucket 300/h + regression test (301 requests / 250 rotating IPs) | Fable 5 subagent (inherited, pre-tiering rule) | CI green + CLEAN, security re-passed |
| #296 | First-run WELCOME tour gated to `/map` surfaces only (`shouldShowFirstRunTour` in `lib/firstRunTour.ts`, 21-assertion test). Once-per-device persistence already existed; surface gate was the real bug | **Sonnet 5** | CI green + CLEAN |
| #298 | e2e: `serviceWorkers: "block"` on chromium-gl — `public/sw.js` tile cache bypassed Playwright `page.route()`, silently defeating the delayed-tiles scenario (pre-existing main failure, now fixed; test-infra only) | **Sonnet 5** (claude-sonnet-5) | CI green + CLEAN |
| #299 | (stacked on #295) Contextual push permission prompt — sequence-gated after first plan action (join/start/confirm), "Later" re-offers only after next qualifying action; native first-run redirect landing→map, once ever, never over existing city preference. 11 new gate tests, full suite 3118 green | **Sonnet 5** (claude-sonnet-5) | CI green + CLEAN (CodeRabbit skips stacked base) |
| #300 | (stacked on #295) Push SENDING pipeline behind APNs-ready provider seam (noop until env keys), fan-out + invalid-token pruning, night-signal go-live broadcast with DURABLE at-most-once dedup (budget-of-1 isLimited claim keyed on snapshot generatedAt — Fable review caught the original per-instance Set flaw), plan-scoped sends dormant behind identity seam (privacy: pre-auth tokens have no identity) | **Opus 4.8** (claude-opus-4-8) | CI green + CLEAN |
| #297 | Map first-frame watchdog: WebGL context GRANTED but zero frames painted → `style.load` settled the scene into permanent blank white with no fallback. Watchdog on MapLibre `render` event, 10s visible-tab timeout → honest `no-frame` fallback with Retry + cheapest-pubs venue rows + `/pubs` link. e2e under SwiftShader with stubbed rAF | Fable 5 subagent (launched pre-tiering rule) | CI pending at handoff |

## Mobile audit findings (live 390×844 captures via Firecrawl)

- **Blank map** in no-frame environments — fixed by #297. Matters for Instagram/TikTok in-app webviews.
- **Welcome modal on every surface** — fixed by #296.
- **Pint Index page says "Public release pending"** — OWNER DECISION: copy/timing vs press launch.
- Feed/Tonight healthy; Tonight honestly thin until signals ingestion gets EXA_API_KEY.

## Suggested merge order

#295 → #299 → #300 (stack; retarget #299/#300 to main after #295 lands if preferred — CodeRabbit will then review them). #276, #296, #297, #298 independent, any order.

## For Sol — beyond the PR queue

- Pre-existing e2e failure on main (proved identical on main baseline): `map-gl.spec.ts` "bounded pin fallback when basemap tiles are delayed" — `public/sw.js` caches `tiles.openfreemap.org`; service-worker fetches bypass Playwright `page.route` delay. Separate fix.
- 38 remote branches map to already-merged PR head refs — prune list ready, owner confirmation pending.
- #295 leaves push SENDING unbuilt (needs APNs key after Apple enrollment); `registerNativePush()` deliberately unwired — prompt placement is a product decision (recommend: after first plan action).
- Drafts #263/#264 remain held; #229 MapLibre 6 stays HOLD.

## Tooling/ops done this session (not code PRs)

- Local main fast-forwarded 25 commits; CLI already latest (2.1.212).
- Firecrawl API key installed + validated; mcporter installed + configured (Chrome attach still failing — extension reconnect pending); browser-use skill's wrong-user path fixed.
- Auto-compact at 70% (~140k) set globally; statusline now shows model/dir/branch (verified: `Fable 5 / pubmax [main]`).

## CYCLE 2 — Mobile-web love (grilled + locked 2026-07-17, evening)

Owner directive: mobile WEB only. App/store/Apple work is owner-scheduled, later — users must love the site and beg for the app first. Decisions locked in grilling:

- **Metrics**: funnel of four, all first-class — nights planned/week, invites per planner, return rate (measured daily, not weekend-bound — people drink every day), A2HS installs. No single tiebreaker.
- **Daily hook**: utility first (Tonight + live pint prices earn the random-Tuesday open), companion layered on top; feed waits for density.
- **Identity**: push harder — account prompt after first plan or first moment, early email capture. Browsing/map/prices never gated (SEO + first touch).
- **USP bets — all four**: (1) last-train/last-orders guardian (TfL, issue #45), (2) gamified pint-price drops (one-tap submission, proof, streaks, borough leaderboards — deepens the data moat daily), (3) live buzz layer (BLOCKED on EXA_API_KEY), (4) group ledger polish.
- **Beg-for-app mechanics**: A2HS prompt after second visit or first completed night (installed iOS PWAs gain web push — reachability without an app); email digest + WhatsApp-native share artifacts (recap, invite, price drop).

### Waves (mobile web)

- **Wave A — measure + speed (first)**: metrics funnel instrumentation (consent-gated, PostHog server lib exists); perf budget pass on the map loop (LCP < 2.5s mid-tier 4G, instant back-nav, no sheet jank). Nothing ships without moving/measuring the funnel.
- **Wave B — USP**: B1 guardian; B2 price drops (new mutating surface — full write-surface certification, anti-abuse, provenance gates per Pint Index rules); B3 ledger polish; B4 buzz when EXA lands.
- **Wave C — reach**: identity nudges; weekly email digest; WhatsApp-native share artifacts on every night object; A2HS flow (iOS share-sheet instruction sheet + Android beforeinstallprompt).

Planned lanes (worktrees; Fable reviews, Sol merges): guardian + price drops = Opus 4.8; funnel, A2HS/share, ledger, digest = Sonnet 5; mechanical chores = Haiku 4.5.

## STANDING LOOP — iterate until excellent (owner directive, 2026-07-17 night)

Owner mandate: keep iterating on the mobile web product in a continuous loop until it stops reading as AI slop and the journey is excellent. Rules: Fable audits (screenshots of live + Vercel PR previews), writes each cycle's PRD here so Sol reviews with full intent, delegates to **Opus 4.8 agents** in isolated worktrees, separate branch + separate PR per lane, Fable reviews, **Sol merges — never Fable**. London only; every borough matters.

**The judging persona (every cycle, every surface):** a 9-to-5 worker leaving the office, any night of the week, wants a cheap good pint near where they are. If they can't get from open → answer in seconds, the cycle failed.

### Cycle 3 PRD (this cycle)

Audit basis: live 390×844 captures + Cycle-2 PR previews. Two failures against the persona:

1. **No instant answer.** Opening the site, the persona meets: landing marketing OR a map needing pan/tap/filter work. Nowhere is there a one-tap "cheapest pints near me right now" answer. The map is a tool; the persona wants an ANSWER first, tool second. → Lane `feat/instant-answer` (Opus 4.8): a "Near me now" instant surface — geolocate, show the 3–5 cheapest quality pubs within walking distance as immediate cards (price, walk minutes, open-late flag), one tap from everywhere (map, landing, tab bar treatment TBD by lane research), full map one tap deeper. Reuse slim index + existing geolocation + venue sheet; no new backend if possible.
2. **Borough coverage is hollow.** "Every single area in London" — /pubs gallery holds ~119 scraped pubs; the persona in Croydon or Barnet may find nothing near them. → Lane `data/borough-coverage` (Opus 4.8): coverage report per borough (pubs with usable price data ÷ borough), then expand via the EXISTING scrape/canonicalize scripts (`fetch:city-pubs`, `canonicalize:venues`, `refresh:prices` — read them first); provenance rules absolute (no invented prices); output = data PR + honest coverage table in the PRD for the next cycle's audit.

Carried follow-ups for later cycles (from PR #306 audit): first-map-paint ~4.2s (maplibre-bound, post-#297), Supabase eager on /map, sheet-drag/back-nav trace pass, header consistency, feed card slimming (in flight).

### Loop mechanics

Each cycle: capture screenshots (live + preview URLs of open PRs) → judge as persona → append Cycle N PRD here → launch Opus lanes → Fable reviews diffs → separate PRs → next cycle. Loop sustains across sessions via this file + memory.

## Owner queue (unchanged)

Apple Developer enrollment (deferred, still the longest pole) · Search Console + Bing verification + sitemap submit · `hello@pubmaxxing.com` inbox · EXA_API_KEY · Pint Index copy decision · branch-prune confirmation.
