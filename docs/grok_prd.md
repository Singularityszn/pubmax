# PUBMAXX Backlog Waves PRD (`grok_prd`)

**Status:** Active execution PRD (2026-07-28)  
**Author lane:** Grok research pass (PRs, live site, MASTER/Wayfinder/Design Direction, PostHog)  
**Baseline:** `main` @ `d07fc796` (Visit Reports review lane #655)  
**Site audited:** https://pubmaxxing.com (desktop ~1440 and mobile 390×844)

This document is the **2026-07-28 execution queue**. It does not replace the programme authorities below. When this PRD and an authority disagree on sequencing, **Wayfinder + MASTER win**; when they disagree on craft, **Design Direction + PRODUCT/DESIGN win**; when they disagree on copy, **VOICE wins**.

---

## 1. Authorities (read these, do not rebuild them)

| Doc | Role |
|---|---|
| [`docs/MASTER_PRD.md`](./MASTER_PRD.md) | Canonical product programme |
| [`docs/WAYFINDER_PRODUCT_MAP_2026-07-20.md`](./WAYFINDER_PRODUCT_MAP_2026-07-20.md) | Ticketed execution map (six-tab nav locked) |
| [`PRODUCT.md`](../PRODUCT.md) / [`DESIGN.md`](../DESIGN.md) | Brand, vocabulary, colour lock |
| [`docs/VOICE.md`](./VOICE.md) | Copy law (no em dashes, British spelling, joke placement) |
| [`docs/DESIGN_DIRECTION_2026-07-18.md`](./DESIGN_DIRECTION_2026-07-18.md) | Craft Top-8 (D1–D8) |
| [`docs/STORE_READINESS.md`](./STORE_READINESS.md) | Store pack + owner enrolment gate |
| [`docs/FRESHNESS_BURNDOWN_2026-07-24.md`](./FRESHNESS_BURNDOWN_2026-07-24.md) | Stale feeds vs unmeasurable feeds |
| [`docs/A11Y_MATRIX_2026-07-18.md`](./A11Y_MATRIX_2026-07-18.md) | Accessibility findings still open |
| [`docs/UNKNOWNS_MAP_2026-07-21.md`](./UNKNOWNS_MAP_2026-07-21.md) | Living risks (OSA, mid-crawl UX, image rights, push) |
| [`AGENTS.md`](../AGENTS.md) | Engineering contracts (price trust, map density, phone chrome) |

Superseded as implementation authority (evidence only): `PRD_UI_NEXT.md`, mobile-first next-wave, Fable broad-appeal Phase 1 bug lists, archive under `docs/archive/`.

---

## 2. Snapshot (2026-07-28)

### 2.1 Open pull requests

| PR | Title | State | Disposition |
|---|---|---|---|
| [#656](https://github.com/karanmrn/pubmax/pull/656) | Community-observed pub signals on the venue sheet | CONFLICTING | **Wave 0** — rebase onto main (conflicts only in `AGENTS.md` and `docs/WRITE_SURFACE_CERTIFICATION.md` vs #655), apply migration `0059`, verify, merge |
| [#229](https://github.com/karanmrn/pubmax/pull/229) | MapLibre GL 6 + fill-extrusion vertical gradient | CONFLICTING; HOLD was awaiting GA | **Wave 3** — HOLD condition met: npm `maplibre-gl@latest` is **`6.0.0`** (published 2026-07-22). Rebase, pin stable `6.0.0` (not `6.0.0-20`), re-run map E2E, merge |

### 2.2 Recently shipped (do not rebuild)

Plans under `docs/superpowers/plans/` from 2026-07-26 onward map to merged PRs. Treat as **verify / smoke**, not greenfield:

| Theme | PR |
|---|---|
| Visit Reports review lane | #655 |
| Nearby bus departures (getting home) | #654 |
| Weather-matched venue recommendations | #653 |
| PostHog EU ADR | #652 |
| Venue-pack runtime tracing | #651 |
| Drink-priced map lens | #650 |
| Provisional marks on UK base pubs | #649 |
| UK town search from city chooser | #648 |
| Round cost + buying rotation (spend, never debt) | #647 |
| Inbox failure ≠ empty | #646 |
| No-alcohol + food map views | #645 |
| Feed hierarchy / out-of-city leak | #644 |
| Voice jokes on low-stakes surfaces | #643 |
| National pint benchmarks + dearest league | #641 |
| Historical pint prices (then-and-now) | #640 |
| Dark-mode two-tone pin edges | #639 |
| Stale feeds → Vercel scheduler | #638 |
| Restaurant venues / fork pins | #637 |
| Freshness: ship registry + split stale/unmeasurable | #636 |
| Pint Index monthly editions + map arrival | #634 |
| Mobile 390/430 + voice pass | #633 |
| Price on pins | #632 |
| Provisional pin badge | #631 |
| Price dating honesty, OSM credit, community moderation | #630 |
| Community price corroboration gate | #621 |
| UK base OSM layer | #625 |
| PostHog analytics rail | #623 |
| Privacy + terms pages | #627 |

Also locked already: **six-tab nav** + `/tonight` cold start (Wayfinder); Color V2 Waves A/B/C; pin collision / clustering contracts in `buildScene.ts`.

### 2.3 GitHub Issues

The agent token cannot list Issues (HTTP 403). Repo reports ~15 open issues+PRs (~13 issues). **Wave 5 triage** requires owner paste or Issues read access. Known from docs: freshness / episodic prices tracked as **#635**.

### 2.4 PostHog (project 219466, EU)

| Finding | Severity | Link / note |
|---|---|---|
| `no_live_events` — no `$pageview` or `$screen` in last 30 days | Critical health | https://eu.posthog.com/project/219466/health |
| `authorized_urls` not configured | Warning | Same health surface |
| Active errors: TypeError (4), Error (3), URIError (2), RangeError (2), ReferenceError (1) | Active | https://eu.posthog.com/project/219466/error_tracking — MCP redacts descriptions; **open in UI before coding fixes** |

ADR 0008 already chose PostHog EU. Remaining work is **coverage, authorized URLs, and live pageviews**, not a new analytics vendor.

### 2.5 Live site audit (pubmaxxing.com)

Pages: `/`, `/map`, venue sheet (The Old Bell), `/pint-index`, `/privacy`, `/choose-city`.

| Severity | Finding | Wave |
|---|---|---|
| — | No P0 breakage; map paints; pins band by price; privacy honest; sources dated | — |
| P1 | Venue Drinks empty: “No menu on record yet” with no contribute CTA | 1 |
| P1 | Pint Index league empty copy is long/technical (zone vs league) | 1 |
| P2 | Primary nav “More” hides Plan / Near / Pubs / Historic / Pal | 1 |
| P2 | Map load line is fine; progress could be clearer | 1 |
| Verify | Dark theme not deeply exercised; mobile sheet price-caption wrap; submit entry points | 1 |
| Docs/a11y | Canvas pins lack keyboard-operable DOM list; desktop drawer focus trap; cream-on-coral CTA contrast ~2.93:1 | 4 |

Brand read: PUBMAXX·ING + coral is strong; hero photography reads stock; trust copy on landing and Pint Index is honest.

---

## 3. Non-goals for agents executing this PRD

- Rebuilding shipped map/price/social features listed in §2.2.
- Five-tab nav rewrite (six-tab locked).
- Purple-glow / cream-DTC / card-dashboard first viewports ([`PRODUCT.md`](../PRODUCT.md) anti-references).
- Inventing PostHog stack traces from redacted MCP text.
- Closing GitHub Issues without reading their live bodies.
- Merging #229 while still on a MapLibre **prerelease** pin.

---

## 4. Waves

Execute in order unless a wave is explicitly marked parallel-safe. One branch per ticket: `cursor/<slug>-ec2c`. Gate every merge with `npm run verify` (and UI evidence where noted).

```text
Wave 0  Land #656 + hygiene
   ↓
Wave 1  Live-site UI honesty          ⎫
Wave 2  Design craft (D1–D8)          ⎬ may overlap after Wave 0 if file ownership is split
   ↓                                  ⎭
Wave 3  MapLibre 6 + regression smoke
   ↓
Wave 4  A11y + mid-crawl Night Mode
   ↓
Wave 5  Activation + analytics + freshness + issue triage
   ↓
Wave 6  Memory / store / expansion (gated)
```

---

### Wave 0 — Land and stabilize

**Goal:** Clear the only live product PR and document hygiene that blocks other lanes.

| ID | Ticket | Done when |
|---|---|---|
| W0.1 | Rebase [`#656`](https://github.com/karanmrn/pubmax/pull/656) onto current `main` | Conflicts resolved in `AGENTS.md` (Visit Reports + venue-signals bullets both kept) and `docs/WRITE_SURFACE_CERTIFICATION.md` (inventory count reconciled, not overwritten) |
| W0.2 | Apply Supabase migration `20260728130000_0059_community_venue_signals.sql` on the target project | Durable signal rows work; memory backend still works keyless |
| W0.3 | Verify #656 | Targeted vitest from PR body green; 390px “What drinkers noticed” readout; Vercel green; merge |
| W0.4 | Point `docs/MOBILE_FLOW_SPEC.md` at six-tab IA | Spec no longer implies five-tab as current contract |
| W0.5 | Owner ops checklist (not agent-owned) | From Wayfinder 0.1: pending migrations, VAPID, provider keys, GitHub Actions billing if crons must revive |

**Contracts to preserve on #656:** character is drinkers' judgement; step-free unknown stays unknown until corroborated; entrance ≠ toilets; signals share community-price actor/rate-limit/moderation; hidden rows leave sheet + count together; privacy copy honest.

---

### Wave 1 — Live-site UI honesty

**Goal:** Fix what a real visitor hits on pubmaxxing.com without a design-system rewrite.

| ID | Ticket | Severity | Done when |
|---|---|---|---|
| W1.1 | Venue Drinks empty state: short honest line + path to contribute / log a price (not a fake menu) | P1 | Empty state offers a real next action; voice fence holds |
| W1.2 | Pint Index league empty: shorter copy that still separates zone strip vs sourced league | P1 | Empty state readable at 390px; no plumbing words |
| W1.3 | Mobile venue sheet: price captions wrap, never ellipsis | Verify | Passes `__tests__/mobileChromeFit.test.ts` spirit on real 390×844 device viewport |
| W1.4 | Dark mode pass: landing, map, venue sheet vs Night Out tokens | Verify | Both themes screenshot-read; no black-on-black pin rims |
| W1.5 | Nav discoverability for Plan / Near (P2) | P2 | Primary journeys findable without hunting “More” alone |
| W1.6 | Contribute / log-price entry points from sheet | Verify | First-time drinker can find price submit without docs |

**Evidence:** desktop + 390px, light + dark for changed surfaces.

---

### Wave 2 — Design craft (Design Direction D1–D8)

**Goal:** Perceived quality jump on sheets and tokens. Source: [`docs/DESIGN_DIRECTION_2026-07-18.md`](./DESIGN_DIRECTION_2026-07-18.md).

| ID | Item | Priority | Anchors |
|---|---|---|---|
| W2.1 | **D1** Spring-physics sheet/drawer (interruptible) | P0 | `components/ui/sheet.tsx`, venue sheet, route panel |
| W2.2 | **D8** Translucent sheet material (dark-first) | P0 | sheet + `venueSheet.css` / theme panels |
| W2.3 | **D3 / D6 / D2** Layered micro-shadow, commit radius, type hierarchy | P1 | `app/globals.css`, `app/theme.css`, landing hero type |
| W2.4 | **D7** Price-stamp signature consistency | P1 | `PriceBadge`, feed, borough, pins, recap |
| W2.5 | **D5** Pointer-down feedback on core loop (non-map first) | P2 | chips, CTAs, sheet handles |
| W2.6 | Re-judge Color V2 dark map + AA accent text (cream-on-coral ~2.93:1) | P2 | A11Y matrix finding #3 |

D4 warm `--panel-raised` is treated as already present — verify, do not redo.

**Collision:** defer sheet work until #656 merges if both touch venue sheet density.

---

### Wave 3 — MapLibre 6 + regression smoke

**Goal:** Lift the GA hold and prove recent merges still hold.

| ID | Ticket | Done when |
|---|---|---|
| W3.1 | Rebase `#229` onto main | Conflicts resolved across `PubMapCanvas.tsx`, `components/map/canvas/*`, `lib/mapBasemapTaste.ts`, `package.json` / lockfile |
| W3.2 | Pin `maplibre-gl@6.0.0` (stable `latest`) | Lockfile regenerated; no prerelease pin |
| W3.3 | Resolve `buildings-3d` paint intentionally | Native `fill-extrusion-vertical-gradient` for 6.x; drop obsolete 5.24 M6i double massing |
| W3.4 | Re-check `map.style._loaded` private-field call sites | Both sites safe on 6.x |
| W3.5 | Gates | `npm run verify`; isolated `NEXT_DIST_DIR=.next-prod` build/start; `e2e/map-gl`, `map-console-health`, `map-fallback`; 390px pin → sheet → Tonight |
| W3.6 | Smoke recent merges keyless | Visit Reports, bus departures, weather recs, drink lens, provisional base marks, rounds spend, city search — hotfix branches only for real regressions |

---

### Wave 4 — Accessibility + mid-crawl Night Mode

**Goal:** Make the map usable beyond canvas pointer hits; make an active crawl readable on a pavement phone.

| ID | Ticket | Source | Done when |
|---|---|---|---|
| W4.1 | Keyboard/AT-operable venue list parallel to pins | A11Y matrix #1 | WCAG 2.1.1 path exists without requiring canvas hit-testing |
| W4.2 | Desktop venue drawer focus trap | A11Y matrix #2 | Focus stays in drawer while open; Esc returns sensibly |
| W4.3 | Mid-crawl Night Mode surface | Unknowns U7 / Wayfinder | Giant tap targets, next-stop glance, composes existing TfL / last-train / bus — **not** a second app |
| W4.4 | Verify Plan drawer → Round bridge E2E | `RouteActions` + `RoundStarter` | Drinker can start a Round from an active Plan without a dead end |

---

### Wave 5 — Activation, analytics, freshness, issue triage

**Goal:** Solo Plan activation baseline, honest ops data, and a clean GitHub issue queue.

| ID | Ticket | Done when |
|---|---|---|
| W5.1 | Progressive Plan intake (Wayfinder 2.1) | Area / time / group / budget / access steps; skippable; no form wall |
| W5.2 | Hard-constraint generation UI + fence tests (2.2–2.4) | Inaccessible / over-budget stops never silently included |
| W5.3 | Passwordless email + Apple SIWA (2.5–2.6) | Magic link path exists; Apple ready for store review when wrapped |
| W5.4 | PostHog health | `$pageview` (or agreed equivalent) flowing from prod; authorized URLs set; `no_live_events` cleared or reclassified with evidence |
| W5.5 | Loop-metric coverage (Wayfinder 0.5) | Activation/loop events in `lib/analyticsEvents.ts` observed in EU project dashboards |
| W5.6 | Triage PostHog error queue | Each active issue: reproduce or suppress with rationale; fix P0/P1 in code |
| W5.7 | Freshness #635 / burndown | Either real `price_updates` parsers or explicit episodic policy + budgets; CityMCP stale-serve addressed |
| W5.8 | GitHub Issues triage | When readable: close-as-shipped / re-scope / keep; stale Gate-0 tickets (#165/#166/#168/#252 historically) re-audited against current code |

---

### Wave 6 — Memory, store, expansion (gated)

**Entry gate:** Wave 5 activation instrumentation has a London PostHog baseline (Wayfinder Wave 2 exit / Wave 4 entry).

| ID | Ticket | Done when |
|---|---|---|
| W6.1 | Story editor + consent + publish confirmation UI | Memory → consented Story path complete for a real night |
| W6.2 | Offline write outbox (Wayfinder 4.4) | Writes queue offline and flush honestly |
| W6.3 | Account claim completion | Device handle preserved; claim end-to-end |
| W6.4 | Store readiness §8 | Owner enrolment, signing, first binary, TestFlight / Play closed test (owner-gated) |
| W6.5 | Nine-city core parity | After activation gate; city-two scorecard per MASTER Wave 2 |
| W6.6 | Membership / blocking / compliance floor | Wayfinder Wave 6 — do not start early |

---

## 5. Acceptance rules (every wave)

1. `npm run verify` green on the branch tip.
2. No tooling churn commits (`next-env.d.ts` route-types rewrite, `allowScripts` noise).
3. Product copy: British spelling, no em dashes, jokes only on low-stakes surfaces ([`docs/VOICE.md`](./VOICE.md)).
4. Any new mutating API route updates [`docs/WRITE_SURFACE_CERTIFICATION.md`](./WRITE_SURFACE_CERTIFICATION.md) in the same commit.
5. Data-path changes update `/privacy` and `/terms` in the same commit ([`__tests__/legalPages.test.ts`](../__tests__/legalPages.test.ts)).
6. UI waves: both-theme evidence at 390×844; trust captions wrap, never ellipsis.
7. Map density / community-price / drink-lens / rounds / Visit Reports contracts in [`AGENTS.md`](../AGENTS.md) stay intact unless the wave explicitly amends them with tests.

---

## 6. Suggested first three agent branches

1. `cursor/land-venue-signals-ec2c` — Wave 0 (#656)
2. `cursor/empty-state-honesty-ec2c` — Wave 1 (W1.1 + W1.2)
3. `cursor/maplibre-6-ga-ec2c` — Wave 3 (after Wave 0, or parallel if no sheet overlap)

Design craft (Wave 2) should wait until #656’s venue-sheet density is on main, then take D1+D8 as one PR and tokens as a second.

---

## 7. Change log

| Date | Note |
|---|---|
| 2026-07-28 | Initial `grok_prd`: open PRs, live site audit, PostHog health, Design Direction + Wayfinder waves, shipped do-not-rebuild list from #617–#655 |
