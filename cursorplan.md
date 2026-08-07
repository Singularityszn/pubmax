# cursorplan.md

> New-user acquisition through taste: landing + first map open.
> Drafted from a live computer-use review of pubmaxxing.com (2026-08-07).
> Status: **DRAFT — awaiting dual-model deep review (Grok 4.5 + Composer 2.5).**

---

## 0. Why this plan exists

A live walk of [pubmaxxing.com](https://pubmaxxing.com) at desktop and ~390px found a product that already has teeth (map bands, honest price disclosure, planner) sitting behind a landing that undersells it. Cold visitors bounce before they feel the map. Regulars who already hunt cheap pints will click through. That gap is a taste and hierarchy problem, not a missing feature.

**Verdict from the review:** Partially ready to attract new users. Average score ~4.7/10 across first impression, clarity, polish, trust, conversion, mobile.

This plan is the smallest sequence of taste-led changes that make a stranger stay, without inventing fake social proof or fighting `docs/VOICE.md`.

---

## 1. Non-negotiables (read before editing)

| Fence | Authority |
|---|---|
| Voice: no em dashes, no exclamation marks, British spelling, no banned marketing words, no fake counts | `docs/VOICE.md`, `__tests__/emDashLaw.test.ts`, `__tests__/landingPriceHonesty.test.ts` |
| Only people-logged price lanes may be dated per row; curated index shares one stamp | AGENTS.md price-lane rules |
| Community price authority vs provisional mark stay separate | `lib/communityPrice.ts`, `components/map/communityPriceSignals.ts` |
| Map density / collision / pin figure honesty are contracts | `buildScene.ts`, `formatPinPriceLabel`, related tests |
| Landing CTA hierarchy already has a flag path (`landingFindMyPint`) and source locks | `__tests__/landingFindMyPintHierarchy.test.ts` |
| Do not invent user counts, "real-time", unverifiable testimonials, or paid-acquisition copy | Voice + taste doctrine |
| Design system continuity over generic AI redesign | Existing tokens, `landing.css`, prior taste waves in `docs/` |

**Taste bar:** Brand first. One composition in the first viewport. One job per section. Show the product, do not decorate around it. Jokes stay off figures, dates, sources, and accessible names.

---

## 2. Problem statement (grounded in what was on screen)

### Landing hero (desktop)
- Brand wordmark is present but the H1 ("Listed pint prices for nights out.") is soft and does not name the outcome.
- Subcopy is honest about publishers, but reads as policy before desire.
- Three actions compete: **Find my pint** (primary, `/near`, location-gated), **Open the map**, **Plan with friends**.
- Right plane is a photo with drink-shape pins (`ThamesHero`) — atmospheric, but not the map product a stranger needs to believe.
- Stats chips (pubs / prices / boroughs) help, but carry no freshness cue a first visit can trust at a glance.

### Landing hero (mobile ~390–400)
- Text + red primary CTA dominate; product visual is easy to miss before the fold.
- Bottom tab bar is present early; "Today" can feel empty for a cold session.
- Header cluster (bell, messages, theme, Sign in) is tight.

### Map first open
- Full London density + two chrome rows + weather + list count + Pub Pal + city chip = power-user surface.
- Price key exists (good) but is easy to miss under the noise.
- No first-visit orientation: what the bands mean, where to start, why a grey pin is honest emptiness not a bug.

### Plan
- Intake is clear and paced (Step 1 of 5), but jumping here from the hero is heavy for exploration.
- Should stay a secondary path from landing.

---

## 3. Goals and non-goals

### Goals
1. A cold visitor understands, in one glance, that this is **listed pint prices on a map of London pubs**, with an obvious next step.
2. The primary conversion path is **browse the map without permissions**.
3. First map open feels inviting, not chaotic: one orientation beat, then the tool.
4. Trust reads as honesty (publisher / none, counts that are real), never as invented social proof.
5. Mobile first viewport shows product + one clear CTA, not chrome theatre.

### Non-goals
- Full visual rebrand or new colour system.
- Fake testimonials, inflated user counts, "real-time" claims the data path cannot support.
- Replacing `ThamesHero` drink IP wholesale without a better product frame.
- Changing community-price authority / corroboration policy.
- Native app or install-prompt growth loops in this wave.
- Rewriting Plan, Social, Tonight product surfaces beyond how landing links into them.

---

## 4. Design principles for this wave

1. **Map is the hero product.** Landing must show map truth (bands, a readable price, empty-as-honest) more than pub atmosphere alone.
2. **One primary CTA.** Browse map first. Location and Plan are secondary.
3. **Desire, then honesty.** Lead with the night-out outcome; keep publisher disclosure close, not as the first sentence.
4. **Orientation, not onboarding theatre.** One dismissible beat on first map open. No multi-step tutorial.
5. **Ship inside existing taste.** Extend `landing.css` / tokens / voice fences; do not invent a new aesthetic lane.
6. **Prove with screenshots and source locks.** Every visible claim stays behind tests already in the tree (`landingPriceHonesty`, `landingFindMyPintHierarchy`, friction voice, em-dash law).

---

## 5. Proposed workstreams

### W1 — Landing hierarchy and copy (must)
**Owner surfaces:** `components/landing/LandingPage.tsx`, `landing.css`, `app/page.tsx` flag wiring, existing L19 tests.

- Decide the **default** hero primary: prefer **Open the map** for cold acquisition (no geo gate). Reconcile with the existing `landingFindMyPint` flag so we do not fork three hierarchies.
- Rewrite H1 / lede within VOICE: concrete, desire-led, no banned words, no invented freshness claims. Candidate direction (not final copy): problem of expensive London pints → listed prices on the map → pick a drink / area.
- Keep publisher honesty, but move it out of the first breath (subline or adjacent caption), so the hero sells then discloses.
- Demote Plan to text; keep Find my pint as secondary (or flag-gated primary for returning / near-intent tests).
- Preserve honest stats chips; only add a freshness phrase if a **real** stamp exists in `lib/aboutStats` / freshness registry — otherwise do not invent one.

**Acceptance**
- First viewport reads as one composition: brand, one H1, one short lede, one primary CTA, one product visual.
- Source locks updated; `landingPriceHonesty` and em-dash law still green.
- Desktop + 390 proof shots in `docs/proof/` or artifacts.

### W2 — Hero product frame (must, taste-critical)
**Owner surfaces:** `ThamesHero.tsx`, `landing.css`, possibly a slim map preview component.

Options ranked by taste (pick one after dual-model review):
1. **Evolve ThamesHero** so drink pins feel more like map truth (band colour language, clearer price tags, less "sticker on photo").
2. **Split hero:** left copy + right static/live map frame showing real bands and one labelled pint (still illustrative if live data is too heavy for LCP).
3. **Hybrid:** keep drink IP as the interactive layer, but ground it on a map-like field rather than a bar interior alone.

**Acceptance**
- A stranger can parse "price on a pub" without reading the caption.
- Mobile: product frame visible without relying on scroll past stats.
- No pin figure that lies (no demo figure masquerading as corroborated community authority on product surfaces that claim authority).

### W3 — First map open orientation (must)
**Owner surfaces:** map chrome / welcome / surface stack — likely `components/map/**`, existing first-run welcome if any, `lib/explicitMapIntent.ts` awareness.

- One first-visit beat explaining band colours in plain voice (reuse map key language; do not invent a second vocabulary).
- Prefer starting camera in a **named neighbourhood or intentional arrival**, not "all of London screams at once", when there is no explicit map intent. Respect existing intentional-arrival freeze rules.
- Do not bury the price key; consider a single stronger first-show of the key then collapse.
- Pub Pal / news / city chip remain, but must not outrank orientation for a first open.

**Acceptance**
- First open at desktop and 390: visitor can state what green / amber / dear / unknown mean within 5 seconds.
- No `history.go()` games; surface-stack rules intact.
- E2E or unit pin for "first visit shows orientation once".

### W4 — Trust without fiction (should)
- Surface publisher-not-recorded / dated community language where landing already promises it (`VOICE` + honesty tests).
- If about-stats can expose a real "prices updated" or feed stamp without lying, use it; else leave counts alone.
- Empty pubs ("No price logged yet") stay honest; improve the empty-state line only within friction-voice rules — invite logging without begging.

### W5 — Mobile chrome restraint (should)
- Hero: one primary button full-width; secondary as text row (align with flag-on CSS already present).
- Ensure trust captions never ellipsis (existing mobile chrome contracts).
- Soften empty Today first-run if it is the default tab after install-like visits — only if in scope of landing handoff; do not rebuild Tonight.

### W6 — Measurement (should)
- Confirm analytics events for hero CTA clicks and first map orientation dismiss already exist or add minimal events in `lib/analyticsEvents.ts` / funnel docs.
- No vanity metrics. Funnel: land → map open → pin select / search.

---

## 6. Sequencing

```
W1 copy + CTA hierarchy  ─┐
W2 hero product frame    ─┼─→ proof shots → W3 map orientation → W4/W5 polish → W6 metrics
                          ┘
```

Ship W1+W2 together if possible (landing is one composition). W3 can follow in the same PR if small, else a fast follow. Do not ship copy that promises a map frame W2 did not deliver.

---

## 7. Risks and traps

| Risk | Mitigation |
|---|---|
| Fighting L19 Find-my-pint flag / tests | Treat hierarchy as intentional product decision; update tests and flag semantics together |
| "Freshness" copy without a real stamp | Only bind to existing freshness / aboutStats; otherwise omit |
| Replacing atmosphere with a generic map screenshot | Prefer living components / honest illustrative frame; avoid stock dashboard look |
| Onboarding modal fatigue | One beat, dismissible, never blocks map pan |
| Voice drift (exclaims, em dashes, "unlock", fake social proof) | Run honesty + em-dash + friction fences before merge |
| Concurrent next-dev / build clobber | Use `NEXT_DIST_DIR=.next-prod` for proof builds |

---

## 8. Proof checklist

- [ ] Desktop landing first viewport (light + dark)
- [ ] Mobile 390 landing first viewport (light + dark)
- [ ] Desktop map first open (orientation visible once)
- [ ] Mobile map first open
- [ ] `npm run lint` + targeted vitest for landing hierarchy / honesty / voice
- [ ] Manual: primary CTA opens map without geolocation prompt
- [ ] Manual: Find my pint / Plan still reachable as secondary

---

## 9. Open questions for dual-model review

1. Should **Open the map** become the unconditional default primary, with Find my pint only via flag — or invert the current L19 flag meaning?
2. Is ThamesHero's drink-shape IP sacred enough to keep as the hero visual if we recolour/ground it, or should W2 introduce a true map frame?
3. What is the lightest first-map orientation that fits surface-stack + existing welcome banners without a new modal pattern?
4. Which real freshness signal (if any) can sit beside "prices on record" without violating dated-lane rules?
5. Does the cream/paper landing already hit the "avoid warm cream + terracotta AI look" trap enough that W2 must shift atmosphere — or is brand continuity more important than escaping that cluster?

---

## 10. Dual-model review log

> Grok 4.5 and Composer 2.5 will each: (a) walk the live site with computer use, (b) read landing/map/voice/taste code, (c) challenge this draft, (d) write a joint refinement into this file.

### 10.1 Grok 4.5 — pending

_(Not filled at time of Composer review.)_

### 10.2 Composer 2.5

**Live walk (2026-08-07).** Screenshots: `/opt/cursor/artifacts/screenshots/composer-review/` (landing desktop + 390, map first open desktop + 390, plan desktop). `/pubs` exists but is not linked from landing; skip for this wave.

**Score adjustment.** The draft’s ~4.7/10 is fair for cold acquisition, but the codebase is further along than the plan admits. Landing already has honest `aboutStats` chips, L19 flag plumbing, AVIF LCP preloads, and a mature map key (`lib/mapPriceLegend.ts` → `MapKey`). The gap is hierarchy and composition, not missing infrastructure.

#### What the draft gets right

- **Desire before disclosure.** The lede opens on publisher policy (`LandingPage.tsx` `heroLede`) while the H1 is abstract. Voice allows honesty; it does not require leading with it.
- **One primary CTA for cold traffic.** Shipped hero defaults to **Find my pint** → `/near` (geo gate). Final CTA already uses **Open the map** as primary when `landingFindMyPint` is off — the page contradicts itself.
- **ThamesHero is product-adjacent, not product truth.** Drink glyphs + illustrative prices (`ThamesHero.tsx`: "illustrative only") do not teach band semantics. Mobile pushes the photo below stats (`landing.css` ≤700px column stack).
- **Map first open is crowded.** Desktop: full London + dual chrome rows + weather + list count + small key card. Mobile: analytics consent + Describe-your-night + tab bar before any band explanation. The price key on phone lives under Layers → Key (`PubMap.tsx`), not first paint.

#### What the draft gets wrong (implementability traps)

| Draft assumption | Code reality | Fix |
|---|---|---|
| "No first-visit orientation" | **FirstRunTour** (4-step modal, map-only, `lib/firstRunTour.ts`) + **MapOnboardingOverlay** ("Start with a story", `MapOnboardingOverlay.tsx`) + optional **BandOnboardingChip** for `?band=` | **Do not add a third modal.** Extend or replace an existing surface. |
| W3 "one dismissible beat" | FirstRunTour is **four** beats and competes with prompt budget (`docs/PROMPT_ORCHESTRATION.md`), analytics consent, and curated onboarding | Collapse tour to **one** band-colour beat, or fold band copy into tour step 1 and cut steps 2–3 from the first session |
| "Prefer named neighbourhood camera" | No simple default-centre constant; `explicitMapIntent` freezes deep links; whole-city view is intentional for cold `/map` | Defer camera work unless we add a **non-deep-link** first-open centroid (e.g. Soho/Camden at z≈14) behind a new localStorage gate — do not fight `explicitMapIntent` |
| W2 "live map frame" | `app/page.tsx` preloads hero AVIF; `ThamesHero` uses `priority` night photo | **Static/hybrid only.** Live MapLibre in hero would blow LCP and tracing budgets |
| Flip CTA "update flag semantics together" | `landingFindMyPint` **on** = Find my pint even more dominant (actions before lede, `lp--findMyPint`) | Change **flag-off default**, keep flag **on** for geo-primary A/B — do not invert flag meaning |
| Freshness beside stats | `aboutStats` has counts only; curated index is one shared stamp (`landingPriceHonesty.test.ts`) | **No date on hero chips.** Month-level dataset note only if wired to `freshness_registry` literal stamp, with copy that never implies per-row dates |
| `e2e/mobile-landing-entry.spec.ts` | Expects retired H1 + "How it works" CTA | Update or delete in same PR as W1 — spec drift is a merge hazard |

#### Open question answers (§9)

1. **Should Open the map become the unconditional default primary?** **Yes.** Make **Open the map** (`primaryCtaHref` → `/choose-city` or preferred city map) the brass primary in the **flag-off** hero. Keep **Find my pint** as secondary text link (or quiet button). Preserve `landingFindMyPint` **on** as the experiment arm that restores Find-my-pint-primary — do not invert the flag; change the default-off branch and update `__tests__/landingFindMyPintHierarchy.test.ts` snapshots accordingly.

2. **ThamesHero sacred vs true map frame?** **Keep drink-shape IP; evolve, do not replace.** Rank **W2 option 1 (evolve ThamesHero)**: subtle band-colour rim on glyphs (decorative, not authority), optional faint map-grid scrim under the photo, keep illustrative price tags labelled as examples in figcaption. Reject live map embed. Pin prices must stay clearly non-authoritative (existing figcaption + `docs/evidence/mobile-hidden-qualifier-audit.md` contract).

3. **Lightest first-map orientation?** **Piggyback `mapPriceLegend` on first open — no new modal pattern.**
   - **Desktop:** auto-open `MapPriceControl` once (`MapPriceControl.tsx` `useState(false)` → sessionStorage gate) using existing `activePriceLegend` rows.
   - **Mobile:** same one-shot, or a single-line chip above the tab bar quoting legend hint text — not a fourth overlay.
   - **FirstRunTour:** replace welcome stack with **one** card: title from `legend.title`, four swatches from `legend.rows`, dismiss → `markTourSeen()`. Drop Moment/Social steps from first session (they duplicate tab bar).
   - **Suppress** `MapOnboardingOverlay` until tour/legend dismissed (`shouldShowCuratedOnboarding` already respects `onboardingDismissed` — align keys).
   - Respect `explicitMapIntent` and prompt budget; never stack over analytics consent.

4. **Which freshness signal beside "prices on record"?** **None on the hero readout.** Safest honest addition: optional footer or `/about` line sourced from `data/freshness_registry.json` `pint_prices` literal stamp, phrased as dataset refresh month ("Price records last checked July 2026"), never "each dated". Community lane dating stays in wedge copy only (`landingPriceHonesty` scoping).

5. **Cream/paper vs escaping AI-warm cluster?** **Brand continuity wins.** `--paper` / brass / ink-deep are load-bearing (nav glass matches `siteNav.css`, memory section, final CTA). Design taste wave 1 already invested here. W2 adjusts **composition and band language**, not palette. Avoid stock-map-dashboard beige.

#### Sharpest minimal sequence (Composer)

```
PR1 (ship together — one composition):
  W1  Flip hero CTA + H1/lede rewrite (desire → disclosure)
  W2  ThamesHero band rim + mobile grid reorder (product frame in first 390px viewport)
  Tests: landingFindMyPintHierarchy, landingPriceHonesty, landingChromeCss, fix mobile-landing-entry drift

PR2 (fast follow):
  W3  One-shot legend open + FirstRunTour collapse to band beat; defer MapOnboardingOverlay
  W6  `landing_cta_clicked` { target: "map" | "near" | "plan" } + `map_legend_dismissed`

Defer:
  W4  unless PR1 still feels thin on trust (footer provenance already strong)
  W5  mostly satisfied once PR1 makes one full-width primary on mobile
  Camera/neighbourhood default — only after legend beat ships; high regression risk
```

**Copy direction (not final).** H1 toward concrete outcome: e.g. "See pint prices on the map before you set off." Subline: one sentence on the map + cheapest nearby; move publisher sentence to second line or wedge #01 (already there). Ban list unchanged (`docs/VOICE.md`).

**Proof.** Re-run shots at 1440 + 390 light/dark; add `docs/proof/landing-acquisition-wave/` mirroring design-taste-wave-1 pattern. Manual: primary opens map with **no** geolocation prompt.

#### Agreements / disagreements with Grok (§10.1)

_Grok section not filled at review time — no endorsements or dissents yet._

---

### 10.3 Joint synthesis — pending

**Composer amendments** (for joint synthesis):

- Treat **W1 + W2 as a single landing composition PR**; do not ship copy promising map-band literacy until ThamesHero shows band language.
- **Invert the default CTA, not the `landingFindMyPint` flag** — flag-on stays the geo-intent experiment arm.
- **W3 is consolidation, not addition:** collapse FirstRunTour, auto-open existing `MapKey` / `MapPriceControl`, defer "Start with a story" — three overlays on first map open is the bug.
- **No hero freshness chip** without a registry-backed month line that passes `landingPriceHonesty`.
- **No live map in hero** — LCP and pin-authority fences rule it out.
- **Fix `e2e/mobile-landing-entry.spec.ts`** alongside hierarchy change (spec still expects retired hero copy).
- **`/pubs` out of scope** — not linked from landing; do not expand surface area.
- **Measurement:** add `landing_cta_clicked` and `map_legend_dismissed`; `discovery_viewed` and `tour_complete` already exist.

---

## 11. Out of scope reminders

Do not touch AuthProvider token-fragment paths, RLS policy shape, community price corroboration thresholds, pin collision constants, or Pint Index archive rules in this wave.
