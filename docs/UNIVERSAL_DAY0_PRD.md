# UNIVERSAL DAY-0 PRD (cycle 17)

Written 2026-07-18 by Fable after owner grilling + three-lens ideation panel (skeptic, builder, differentiator, all Fable 5 forks). This is the canonical spec for the launch-week push. Sol (Codex) and all Opus lanes read THIS file first. FABLE_HANDOFF.md carries live session state; this file carries the what and why.

## Vision (owner's words, condensed)

PUBMAXX becomes the app people open every day: morning weather check, best places today, tonight's move, how to get there and home. Universal going-out app. Not one app per pub chain plus Uber plus Just Eat; one app for the whole day out in London, then the world. Counter-positioning: presence over optimization; the pub as third place; never anti-health, never pro-drinking-more.

## Owner decisions (locked 2026-07-18, morning)

1. All three surfaces ship this week: morning brief, tonight surface, concierge chat.
2. Mobile UI first; day-0 user acquisition is the priority axis. LLM keys deferred ("relax about the keys"): concierge ships deterministic-first, model narration flips on when a key is funded.
3. Concierge grounding when live: our facts PLUS live web search. Provenance labels on everything ours; web answers clearly marked as web.
4. Morning brief: home screen AND daily push. Web push now (installed PWA, iOS 16.4+ home-screen installs); native APNs later on the same backend when the store account exists.
5. Categories: every layer we already source, AND new scraping (restaurants, attractions) starting now. Owner funds/rotates his own Exa/Firecrawl keys as they exhaust. Standing rule: any credit failure is reported to the owner immediately. Scraping stays within provider terms on owner-funded keys; the slop filter and provenance bar gate EVERY ingested row exactly as they gated pub descriptions (93% rejection rate is a feature, not a bug).
6. Growth: all four channels this week. Engineering builds the crew-invite share loop; press kit + ASO are content lanes; TikTok/IG and pub partnerships are owner-led with asset support from us.

## Panel dissents (recorded, not overturned; revisit if week one slips)

- Skeptic: refuses all-models chat week one; deterministic-first concierge is the agreed compromise. Freshness infra is dead (GitHub Actions $0 billing cap): a stale morning brief kills the habit it exists to build. OWNER ACTION, highest leverage of the week.
- Differentiator: new scraped categories risk thin-directory slop next to Google. Mitigation locked: same slop filter + provenance bar; category pages render honest empty states rather than filler.
- Builder: all-three-in-one-week works only because tonight = already merged (#409, #410) and the concierge ENGINE already exists (`app/api/concierge` + `lib/concierge/*`, deterministic rank, intent parse with `skipModel` fallback). The real new build is one composed page, one chat skin, one push backend, one ingest pipeline.

## Moat thesis (differentiator, adopted)

Defensible and compounding: (1) THE LOCAL social loop (only asset with network effects), (2) night-signals freshness cadence, (3) Pint Index longitudinal price series, (4) the join between live local data and the private social graph; that join never leaves our servers. Provenance registry is the quality bar that makes the directory layer non-slop. Raw listings, weather, TfL are table stakes.

Positioning line (stores/landing candidate): "London runs on its pubs. This is the app that runs your night."

## Lanes

Each lane: isolated git worktree, own branch, non-draft PR, vitest green, no em dashes in product copy, provenance labels on every sourced claim, hermetic tests (fixed dates, env stripped per vitest.setup.ts doctrine). Merge on full green (Vercel chengdu + pubmax, CodeRabbit, Cursor security).

### Lane A: /today morning brief + mobile home (Opus, UI)

Smallest excellent v1: one route `/today`, becomes the signed-in mobile home before 17:00 London. Four stacked cards, all existing data:
1. Drink-weather verdict (`lib/drinkWeather.ts`, `lib/weatherSnapshots.ts`) with honest staleness line when snapshots are old (Actions dead; manual refresh).
2. Tonight's top 3 picks (`lib/whatsOnStore.ts` windowing; #409 overlap semantics).
3. Get-there strip (`lib/tfl.ts`, follow `TonightGetHomeStrip` pattern).
4. One sourced pub-of-the-day fact (`lib/heritageFacts.ts` / `lib/pintFacts.ts` + `lib/provenanceLabels.ts`).
Cut: personalization, streaks, seasonal theming. Nav entry in `MobileTabBar` + `SiteNav`.

### Lane B: web push gap + daily brief sender (SOL, backend)

RESCOPED 2026-07-18 after spec review: most of the push pipeline ALREADY EXISTS on main (this cycle's commits): `lib/pushTokenStore.ts`, `lib/pushProvider.ts`, `lib/pushSender.ts`, `lib/nativePush.ts`, `lib/nativePushPrompt.ts`, `/api/push-tokens` route, real APNs HTTP/2 ES256 transport. Sol: read those files FIRST; do not rebuild them. The actual gaps:
- Web-push (VAPID) provider path alongside the existing APNs provider behind the same `lib/pushProvider.ts` seam; no-op loudly without VAPID keys (owner provisions).
- Push event handler + notification click-through in `public/sw.js`.
- Daily brief sender: manual script (`scripts/push/sendDailyBrief.mjs`, refresh:weather pattern) since crons are dead; payload = drink-weather verdict + top pick, composed from the same libs Lane A uses.
- Permission ask stays UI-side after a real user action (Lane A wires the prompt); never on boot.
- Contract unchanged: additive public error contract, durable rate limiting on any new route, write-surface certification updated for any new mutating route.

### Lane C: concierge chat surface /pal (Opus, UI + seam)

- Chat skin over the EXISTING engine: user asks, intent parse, deterministic rank over our rows, answer cards ARE the facts with their provenance labels; model narration behind `narrate` flag, OFF until key funded; refuse honestly at zero rows (house empty-state voice).
- Provider seam stays single (`OPENROUTER_MODEL` env); multi-model later, never week one.
- Web-search grounding (owner decision 3): behind a second flag, Exa/Firecrawl at query time, answers marked as web-sourced, OFF by default until spend limiter proven.
- Sol dependency: durable spend limiter on the concierge route before any model/web flag flips in prod.

### Lane D: growth loop (Opus, UI/content)

- Crew-invite share loop end-to-end polish: share links, `/add/[handle]`, plan invites, OG cards on every share surface, invite lands cold-start into the plan.
- Press kit refresh around Pint Index ("London's pint price league table"), ASO copy set (name, subtitle, keywords, screenshot plan from docs/screenshots Gate Z set).
- Content templates for owner's TikTok/IG channel + printable QR poster/beer-mat asset for pub partnerships (owner executes; we produce assets).

### Lane E: category ingest, restaurants + attractions (SOL, backend)

- New ingest pipeline: Exa/Firecrawl producers writing to `public/data/` (or store seam) with per-row source URL + observed-at date, THROUGH `lib/slop` filter + provenance registry. A row without a source and date does not ship.
- Categories attach to the night-out job (near-pub food, pre-pub attractions), not free-floating directories.
- Category pages render honest empty states where the filter rejects everything.
- Freshness registry entry per feed (issue #408 pattern); no past-dated rows served.
- Report any credit/key failure to owner immediately; halt lane rather than degrade to unsourced rows.

## Sequencing (7 days)

Day 1: #409/#410 merged (done). Lane A + Lane B start. PRD on main for Sol.
Day 2-3: Lane C + Lane D start once A/B branches exist (file overlap is minimal; nav files coordinated through Fable merge order).
Day 4: merges A, B; design-judge loop on /today both themes 390x844 + desktop.
Day 5: merges C, D; judge loop on /pal + share surfaces; Lane E lands first sourced category rows or honest empty.
Day 6: fix wave from judge; Capacitor `npx cap sync` (wrap loads deployed site; web ship = app ship); prod domain dpl_ check.
Day 7: buffer. It will be needed.

## Owner actions (blocking, this week)

1. GitHub Actions billing cap (freshness for brief + push + ingest; the habit dies without it).
2. Apple Developer + Play enrollment (#390); TICKETMASTER_API_KEY (#385).
3. Fund/refresh Exa + Firecrawl credits as lanes consume them; provision VAPID keypair for web push; fund OpenRouter when ready to flip narration.
4. Choose positioning line (candidate above) for stores/landing.

## Verification bar (every lane)

Vitest green locally AND on Vercel (ci runs tests inside builds); tsc clean; no em dashes in product copy; provenance label on every sourced claim; hermetic tests only (fixed dates, no real clock, env stripped); no destructive migrations; write-surface certification updated for any new mutating route; screenshots both themes for UI lanes before merge request.
