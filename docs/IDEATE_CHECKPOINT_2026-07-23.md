# PUBMAXX ideation checkpoint — 2026-07-23

## Purpose

Resume current ideate pipeline after context compaction. User asked to sync latest GitHub state, inspect `pubmaxxing.com` in real browsers, grill decisions one at a time, run a top-tier adversarial agent panel, produce a planning/task breakdown, then dispatch approved work through gated implementation.

## Repository state

- Primary checkout branch: `main`.
- Primary checkout intentionally preserves local work and must not be used as a lane base.
- Historical planning baseline: `B1 = 6958dc6170c82b87a1784d1b513ec8a897e89b58`.
- Phase A landed as `6ee249e6`; L03 then merged via PR #575 as `9071b3cf`.
- Current supervisor-confirmed integration tip: `9071b3cf`. New lanes fetch and record the latest supervisor-confirmed base plus any reviewed unmerged DAG dependencies; never infer a base from the primary checkout.
- Existing local edits remain preserved and must not be overwritten:
  - `skills/emil-design-eng/SKILL.md`
  - `skills/review-animations/SKILL.md`
  - `skills/review-animations/STANDARDS.md`
- Untracked planning records remain intentionally local:
  - `docs/IDEATE_CHECKPOINT_2026-07-23.md`
  - `docs/PUBMAXX_TRUSTED_PINT_TO_CREW_DRAFT_PLAN_2026-07-23.md`
  - `docs/PUBMAXX_TRUSTED_PINT_TO_CREW_IMPLEMENTATION_PLAN_2026-07-23.md`

## Browser tooling installed

User explicitly authorized browser tooling installation and execution.

- `chrome-devtools-mcp@1.6.0` installed globally.
- `agent-browser@0.33.0` installed globally with lifecycle script allowed.
- Agent Browser Chrome `151.0.7922.47` installed at `~/.agent-browser/browsers/chrome-151.0.7922.47`.
- Chrome DevTools daemon running in headless isolated mode. Last observed PID: `61881`.
- `browser-harness` skill exists, but its expected binary was unavailable. Agent Browser and Chrome DevTools now cover rendered browser work.
- No Claude settings or permission files were changed.

## Browser evidence captured

### Desktop landing

Agent Browser opened `https://pubmaxxing.com/` successfully.

- Title: `PUBMAXX: real pint prices on a live map`
- URL: `https://pubmaxxing.com/`
- Screenshot: `/tmp/pubmax-desktop.png`
- Chrome DevTools screenshot attempt to `/tmp` was blocked because DevTools only writes within configured workspace roots. Agent Browser screenshot succeeded.
- Console: one informational service-worker message only: `PUBMAXXING: a new offline version is installing; it takes over on your next visit.`
- Agent Browser reported no page errors.
- Chrome DevTools captured 90 network requests; all shown requests returned `200` or expected `304`. No failed request appeared.
- Served deployment query marker observed: `dpl_BzjBungqaR1ifJBwGSEqFeki1Rrj`.

### Landing structure observed

- Persistent top navigation: Map, Tonight, Moment, Stories, You, Activity, Messages, theme, sign-in.
- Hero promise: real dated pint prices plus walkable crawl planning.
- Hero CTAs: Find my pint, Open map, Plan my night.
- Trust metrics: 964 pubs, 2,800 dated prices, 33 London boroughs.
- Product pillars: sourced prices, contextual city information, one planned route.
- Privacy/story loop: plan privately, invite crew, preserve moments as story.
- Community section currently shows an empty live-feed state: `No drops yet. Be the first...`.
- Pub Pal positioned as plan generator with user confirmation.
- Nine city cards: London, Manchester, Liverpool, Oxford, Durham, Glasgow, Bristol, Cambridge, Bath.
- Footer carries home-screen install guidance, provenance promise, responsible-drinking link.

### Initial visual judgment

Desktop landing looks coherent and credible. Strong hierarchy, clear core promise, restrained coral/ink identity, real trust metrics. Main product concern is breadth: many competing journeys and CTAs before user proves one core outcome. Empty `Fresh from the taps` state weakens social proof despite strong static dataset metrics.

### Static fetch caveat

Earlier static WebFetch claimed garbled/duplicated brand text and empty icon links. Rendered Agent Browser screenshot and accessibility snapshot did not reproduce garbled branding. Treat static-fetch issue as extraction artifact, not confirmed product defect.

### Mobile and performance evidence reviewed

Artifacts:

- `/tmp/pubmax-mobile-light.png`
- `/tmp/pubmax-mobile-dark.png`
- `/tmp/pubmax-mobile-light-snapshot.txt`
- `/tmp/pubmax-mobile-dark-snapshot.txt`
- `/tmp/pubmax-mobile-light-a11y.json`
- `/tmp/pubmax-mobile-light-console.txt`
- `/tmp/pubmax-mobile-light-errors.txt`
- `/tmp/pubmax-mobile-dark-console.txt`
- `/tmp/pubmax-mobile-dark-errors.txt`
- `/tmp/pubmax-vitals.json`

Verified findings:

- Mobile hero is clear and credible, but 7,442px page length, repeated CTA pairs, six-item bottom navigation, and multiple product propositions create choice and scroll fatigue.
- Three hero actions compete above fold. Evidence supports one dominant immediate-use action, with planning and story paths demoted.
- Dark mode is cohesive but consecutive black sections weaken section wayfinding.
- Axe found two serious contrast failures: `Start a plan` at 2.92:1 and `Live product proof` at 2.31:1. Three other checks remain incomplete, not confirmed failures.
- Console contained only informational service-worker update message; error files were empty.
- Lab metrics: LCP 1,044ms good, CLS 0.0031 good, FCP 1,044ms good, TTFB 781.6ms good but near boundary. INP unavailable because no interaction was measured.
- Highest-confidence implication: technical baseline is strong; clearest defects are contrast failures, while largest product risk is mobile landing breadth after an already-clear hero.

### Mobile core-journey audit

Read-only Agent Browser audit at 390x844 found:

- **High — first-visit map blocker:** `/near?patch=soho` Venue selection opens `/map?sel=venue-196albe` with map tour and Venue sheet together. Venue-sheet scrim blocks `Skip the tour`; closing Venue loses selected context before tour can be dismissed. Evidence: `/tmp/pubmax-mobile-map-tour-venue.png`.
- **High — stale/repetitive Tonight content:** `/tonight` promises nearby results “right now”, but accessible list contained 60 repeated 11:30am Curry Club entries around 20:45. Evidence: `/tmp/pubmax-mobile-tonight.png`.
- **Medium — locality lost in Pub Pal handoff:** Tonight Quiet Pint returned four Wetherspoons across Lewisham, Brent, and Lambeth with no distance/walk time despite Soho-near framing.
- **High — contrast:** map state showed four serious 2.92:1 contrast failures; Stories active nav label measured 3.79:1.
- **Medium — map search:** known Venue query produced silent empty listbox with no visible or announced no-results state; exact alternate query opened Venue correctly.
- **Medium — Plan time to value:** large intro plus five-step intake delays result. Evening selection around 20:45 advanced date to 24 July while header retained “Tonight”, creating possible date-label mismatch.
- **Positive — `/near` works:** choosing Soho produces five concrete dated price results after one choice, including £2.55 cheapest pint.
- **Stories:** empty and fallback states are coherent, though signed-out London + Yours initially looks contradictory: empty headline above populated fallback prices.
- No runtime page errors; only informational service-worker update message.

### Desktop core-journey audit

Read-only Agent Browser audit at 1440x900 found:

- **High — landing CTA visibility:** all three primary actions begin at y=900 in a 900px viewport, leaving initial desktop viewport without a CTA. Evidence: `/tmp/pubmax-desktop-landing.png`.
- **High — Stories filters:** `Latest`, `Yours`, and `Cheap pints` change active pill only; URL, 12 items, and ordering stay identical. Cheapest £2.25 item remains last.
- **High — Plan context contradiction:** after selecting Soho, canned `Cheap round` prompt fills Victoria, silently conflicting with chosen area.
- **High — first-visit map friction:** selected Venue sheet is hidden behind welcome tour until Skip. Mobile version is worse because sheet scrim blocks Skip and forces context loss.
- **Medium — map settling and console warnings:** direct search works, but initial map/media render is incomplete for about 3 seconds. Console repeatedly reports `[pubmap] tile failure burst, reloading style` with invalid `icon-size` zoom expression.
- **High — Tonight repetition:** all 60 accessible listings are same 11:30am Curry Club item across many Venues; seven vibe actions compete above list.
- **High — Pub Pal context loss/dead end:** Quiet Pint returns four distant Wetherspoons, generic `A calmer fit` explanations, weak visible provenance, and no in-product global navigation/back.
- **Accessibility:** serious contrast failures on landing Plan CTA, map city switch, and all 60 Tonight badges. Sign-in trigger remains a critical manual-review ARIA candidate.
- First useful value: `/near` needs two post-landing decisions; direct map search gives a useful Venue sheet after one query and about 3 seconds; Tonight is immediate but low relevance.
- No production mutation performed. Plan audit stopped before generation/save boundaries.

## Product/repo context already established

- Latest handoff says Cursor backlog is closed: 12 PRs merged, one superseded issue closed, board empty.
- Only explicit hold mentioned in handoff: MapLibre 6 issue `#229`.
- New merged plan work includes invite privacy previews, plan-end invite expiry, host invite/revoke clarity, local save versus Lock it in clarity, routed walking minutes, and Tonight trust improvements.
- Significant deployed-but-owner-device verification debt remains across mobile sheets, plan flow, invite flow, map layers, and recent visual/systemic fixes.
- Current app exposes broad surface area: map, tonight, moments, stories/feed, planning/crawls, social/profile/messages, Pub Pal, city discovery, price data, heritage, events, transport, and safety layers.
- Canonical product vocabulary comes from `PRODUCT.md`, supported by `CONTEXT.md`: Plan, Stop, Venue, Friend, Route. Avoid trip/itinerary/journey, leg/waypoint/step, and place/location when referring to a Venue.
- Core route boundaries: `/near` gives a location-dependent instant answer; `/map` is durable discovery; `/plan` composes three editable ordered Stops and saves a shareable Plan; `/tonight` is sourced what-is-on discovery; Pub Pal supports Plan creation but is not a gate or primary nav destination; Venue detail stays in a map sheet; `/feed` is canonical Stories browse surface.

## Ideate pipeline state

Global `ideate` skill invoked. Required order remains:

1. Grill one decision at a time.
2. After shared understanding, run 2–3 highest-tier agents with skeptic, builder, and differentiator lenses.
3. Present verdict plus strongest dissent.
4. Only after owner approval, produce implementation plan and execute through Implement, Verify, Review, Close, Retro gates.

### Owner decisions

Karan adopted all 17 recommended answers in `docs/PUBMAXX_TRUSTED_PINT_TO_CREW_DRAFT_PLAN_2026-07-23.md` as written on 2026-07-23. Every decision is now resolved. Adopted thesis: build differently around a **trusted pint-to-crew handoff**, with Find my pint as primary entry, accepted Venue and context preserved through Map and Plan, Friend handoff as downstream proof, London-density first, and broad Stories/Pub Pal/city expansion parked.

### Panel state

First panel completed using three independent `gpt-5.6-sol` agents through `claudex`, effort `high`: skeptic, builder, differentiator.

Consensus:

- Do not optimize raw first-session Plan creation or link copying before recommendation trust works.
- Build differently around a **trusted pint-to-crew handoff**.
- Fix map tour/Venue collision, Tonight freshness/repetition, lost locality, template/date contradictions, contrast, and search no-results before broad expansion.
- Strongest dissent: definitive dated pint-price index first. Karan resolved this by adopting narrow price-freshness work as P1 trust substrate, not replacement strategy.

Post-resolution adversarial panel completed after compaction using three independent `gpt-5.6-sol` agents through `claudex`, effort `high`. All three returned **REVISE** without reopening adopted product choices. Final plan resolves blockers covering one-Stop lifecycle, Friend privacy, state precedence, grounding proof V2, URL/history ownership, analytics, Tonight freshness, executable gates, rollout, rollback, and shared-file ownership.

### Planning state

Final implementation plan exists at `docs/PUBMAXX_TRUSTED_PINT_TO_CREW_IMPLEMENTATION_PLAN_2026-07-23.md`. Draft remains at `docs/PUBMAXX_TRUSTED_PINT_TO_CREW_DRAFT_PLAN_2026-07-23.md` as pre-panel record. Final plan now defines 20 original implementation lanes, narrow L05A prerequisite, and one integration assembly lane, with exact worktree/branch names, stacked reviewed-SHA dependencies, model efforts, file ownership, deterministic/browser gates, evidence receipts, staged activation, rollback, and supervisor-gated delivery.

GitHub `main` reached fixed baseline `B1 = 6958dc6170c82b87a1784d1b513ec8a897e89b58` through ten supervisor-reviewed presentational merges. Lane amendments preserve Map desktop rail and banner staging, Near shell, Plan CTA tokens, existing `lib/tonightListGrouping.ts` dedup, Pal navigation, FeedCard/auth presentation, and landing `PintDropStrip` fail-soft behavior. L13-L15 must adopt and harden existing Tonight grouping rather than regress or replace it. L19 must preserve current `PintDropStrip`.

### Security note

Exposed local `claudex` gateway credential remains retired from this execution path. Native Sol agents are used instead. Never print or reproduce token value.

### Implementation state

Full-DAG execution is approved. Coordinator dispatches and records lanes only; coordinator never implements. Every implementation, verification, and review pass uses a distinct native `gpt-5.6-sol` subagent in an isolated lane, with effort capped at `high`. Compact between every lane wave.

Foundation-wave checkpoint:

- **Phase A complete:** L00, rebuilt L01, and L05A passed implementation, fresh verification, and review. Supervisor pushed and merged Phase A as `6ee249e6`. Lanes performed no supervisor-reserved push, PR, merge, deployment, or production mutation.
- **L03 complete and merged:** Final candidate `2b4e2e8475c01a6d5419023bbb981d63166897a5` passed verifier and reviewer with Critical/High/Medium/Low `0/0/0/0`. Supervisor merged PR #575 as `9071b3cf`; `RR-L03` sent. S03 now satisfies L04 dependency.
- **L02 complete and awaiting supervisor gate:** Final candidate `1c44a73e4f0dabc251a0be282bf33c1aff1c67aa` is based on `6ee249e603aae13179c90bcb7706d5c01805d67f`. Revision fixed cross-tab revoke/regrant replay, added deterministic two-window coverage, and corrected canonical metrics docs. Fresh verifier and reviewer returned `PASS` with `0/0/0/0`. Evidence: focused 118/118; exact CI 549 files/5,394 tests; Playwright 3/3 with zero failures, skips, or retries; build, TypeScript, lint, audit, and diff checks passed. `RR-L02` ready for supervisor gate. No lane push, PR, merge, or deployment.
- **L04 active:** Draft arbitration implementer runs from supervisor-confirmed base `9071b3cf`; verifier and reviewer remain queued.
- **Wave boundary:** Send `RR-L02`, checkpoint this exact state, then compact. Continue L04 after compaction. Later lanes use latest supervisor-confirmed integration base and explicit reviewed DAG dependencies.

### Active execution policy

- Coordinator is DAG coordinator only; all lane implementation occurs in subagents.
- Use native `gpt-5.6-sol` for every implementation, verification, and review pass.
- Effort matches task difficulty and remains `low`, `medium`, or `high`; never `xhigh` or `max`.
- Every feature uses its own exact git worktree and branch. No shared lanes.
- Implementer, verifier, and reviewer remain three distinct agents.
- Supervisor receives `RR-Lxx` after each lane and is sole push, PR, review-gate, and merge operator.
- Coordinator and lane agents perform no push or PR action.
- Subscription-included execution only. If included allowance ends, stop all new agent/model work; never consume API credits, paid fallback credits, or fallback gateways without fresh explicit owner authorization.
- No Vercel deploy or promotion. No domain or production mutation.
- Never touch `feat/desktop-parity-d3-gazetteer`.
- North star: make `pubmaxxing.com` the best app in the world.

## Task list

- Repository sync and B1 revalidation: completed.
- Live desktop/mobile product audit: completed.
- Mobile artifact, accessibility, console, and performance review: completed.
- First Sol 5.6 skeptic/builder/differentiator panel: completed.
- Owner decisions: all 17 resolved and adopted as recommended.
- Detailed draft plan: completed at `docs/PUBMAXX_TRUSTED_PINT_TO_CREW_DRAFT_PLAN_2026-07-23.md`.
- Post-resolution adversarial panel: completed; unanimous **REVISE**, blockers resolved in final planning contracts.
- Final implementation plan: completed at `docs/PUBMAXX_TRUSTED_PINT_TO_CREW_IMPLEMENTATION_PLAN_2026-07-23.md`.
- Full-DAG implementation: approved and in progress under coordinator-only dispatch.
- Phase A — L00, L01, L05A: independently gated and merged by supervisor as `6ee249e6`.
- L03: independently gated `PASS`, receipt sent, and merged by supervisor via PR #575 as `9071b3cf`.
- L02: final candidate `1c44a73e4f0dabc251a0be282bf33c1aff1c67aa` independently gated `PASS`; `RR-L02` ready for supervisor gate.
- L04: implementation active from `9071b3cf`; verifier and reviewer queued.
- L05-L20: pending DAG prerequisites and reviewed receipts.
- Push, PR update, merge, deploy, flag activation, and production action: supervisor-only gate. Lane/coordinator contexts performed none.

## Exact next steps

1. Send final `RR-L02` for candidate `1c44a73e4f0dabc251a0be282bf33c1aff1c67aa` to supervisor.
2. Type `/compact` as a message and wait for supervisor submission; L04 may continue through its already-open isolated lane.
3. After compaction, collect L04 implementer result, then run fresh verifier and reviewer against the exact candidate SHA before issuing `RR-L04`.
4. Use `9071b3cf` as current supervisor-confirmed integration base unless supervisor supplies a newer merged tip.
5. Dispatch later lanes only when every DAG prerequisite is reviewed or merged and exact dependency SHAs are recorded.
6. Full L05 must preserve merged L05A mobile shared-sheet geometry.
7. Preserve existing `lib/tonightListGrouping.ts` behavior in L13-L15 and current `PintDropStrip` in L19.
8. Keep implementer, verifier, and reviewer distinct; maximum two revision cycles.
9. Require deterministic, browser, privacy, accessibility, performance, and recorded review receipts against exact SHAs.
10. Preserve all pre-existing local edits and planning documents.
11. Never touch `feat/desktop-parity-d3-gazetteer`; never deploy, flip flags, or mutate production.
12. Stop all new model/agent work when included subscription allowance ends; never use API credits, paid fallback credits, or fallback gateways.
