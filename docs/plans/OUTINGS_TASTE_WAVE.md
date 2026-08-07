# Outings Taste Wave — beauty without rebrand

> Status: **EXECUTING** (2026-08-07). Wave S4 “Taste of usefulness” as shippable PRs.
> Relates to [`FIRST_PRINCIPLES_OUTINGS.md`](./FIRST_PRINCIPLES_OUTINGS.md) §5 Wave S4 and [`OUTINGS_WAVE2_EXECUTION.md`](./OUTINGS_WAVE2_EXECUTION.md).
> Does **not** reopen WhatsApp (#816), night-OS first-price (#829/#832), or fight landing copy (#836) / Discover lede (#824) / coffee chip content (#843).

---

## Goal

Make the product feel **designed by people with taste** — warm London pub material, brand-first story surfaces, one composition per viewport — without inventing a second brand system.

This is fashion for usefulness: hierarchy, type, glass, empty-state material, motion. Not a purple DTC makeover. Not cream-and-serif brochure. Not broadsheet hairlines.

## Hard constraints

- Tokens stay candle coral / night ink / brass / paper (existing `--*` system)
- Brand first on branded pages; hero stays one composition
- No card soup in heroes; cards only where interaction needs a container
- No hero overlays (badges, floating chips on media)
- Motion: 2–3 intentional, `prefers-reduced-motion` respected
- `docs/VOICE.md`: no em dashes, no `!`, British spelling; jokes only in empty/loading lanes
- Preserve measured phone chrome contracts (`mobile-map-chrome-fit`)

## Anti-goals

- New font stack / Inter / purple gradients / glow soup
- Invented biography or fake aesthetic “lifestyle” photography
- Rewriting map pin collision or price honesty for looks
- Fighting open functional PRs on the same files

## Ranked jobs

### T1 — `/plan` describe-first composition
**Branch:** `cursor/plan-describe-taste-dd0b`  
**Base:** outings tip (#817)  
**Job:** Display type on the heading; de-box the describe surface into one composition; chips stay scannable without pill soup. Copy labels unchanged.  
**Done when:** planDescribeFirst tests + plan e2e locators still green.

### T2 — Shared EmptyState material
**Branch:** `cursor/empty-state-material-dd0b`  
**Base:** `main` or outings tip  
**Job:** Replace dashed upload-zone look with pressed paper / ink stamp material using existing tokens; keep jokes allowed here.  
**Done when:** emptyState unit + design-taste e2e (if present) green.

### T3 — `/about` brand-first first viewport
**Branch:** `cursor/about-brand-hero-dd0b`  
**Base:** after #824 / #836 copy tips if needed, else outings tip  
**Job:** Wordmark-level brand presence + one lede composition; brass rule / paper atmosphere; no new card grid; no invented scars.  
**Done when:** about VOICE fences green; brand testable without inventing biography.

### T4 — Drink chip strip elegance (after #843)
**Branch:** `cursor/drink-chip-strip-taste-dd0b`  
**Base:** #843 tip  
**Job:** 9-chip strip keeps de-box, scroll fade/mask, selected state that is not a coral CTA hijack; coffee/AF/soft readable in dark. Content categories unchanged.  
**Done when:** drinkShapeChips + chip e2e green.

### T5 — Discover head breathing (after #824)
**Branch:** `cursor/discover-breathing-dd0b`  
**Base:** #824 tip  
**Job:** CSS-only de-card of `.discoverHead` / explore lane; lede helper untouched.  
**Done when:** discover editorial / copy tests green.

### T6 — Mobile map glass ↔ SiteNav parity
**Branch:** `cursor/mobile-map-glass-taste-dd0b`  
**Base:** `main`  
**Job:** Top bar glass matches landing/SiteNav brass-mix tokens; **no** geometry contract changes.  
**Done when:** `mobileChromeFit` unit + e2e geometry still hold.

### T7 — Landing atmosphere motion (after #836)
**Branch:** `cursor/landing-atmosphere-motion-dd0b`  
**Base:** #836 tip  
**Job:** 2–3 reduced-motion-safe presence motions; move any floating hero hint out of media overlay. Hero budget preserved.  
**Done when:** design-taste / landing hierarchy tests green.

## Execution rules

1. One concern per PR; stack notes when depending on #824 / #836 / #843.
2. Prefer CSS + light markup; avoid logic churn in PubMap.
3. Commit + push + draft PR before claiming done.
4. Screenshot or note visual intent in PR body when CSS-heavy.

## Success

A cold open of `/plan`, `/about`, empty borough, Discover, and the phone map feels like one tasteful product — not a feature checklist — while every honesty fence still holds.
