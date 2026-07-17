---
name: PUBMAXX
description: Nights-out-with-friends crawl planner — Candle Coral light, Night Out dark
colors:
  ink: "#1c1412"
  ink-soft: "#4a3632"
  muted: "#7a5c55"
  line: "#efcfc4"
  line-soft: "#f5e0d6"
  paper: "#fff1e6"
  panel: "#fffaf6"
  panel-raised: "#ffffff"
  ink-deep: "#16122a"
  brass: "#ff5a5f"
  brass-bright: "#ff7a55"
  pint: "#18a76d"
  amber: "#f2a71b"
  brick: "#ff5a5f"
  river: "#2864d8"
  river-bright: "#29b6f6"
  night-paper: "#070b0a"
  night-panel: "#0e1613"
  night-panel-raised: "#141c19"
  night-amber: "#f0a01a"
  night-pint: "#3dff9a"
typography:
  display:
    fontFamily: "Space Grotesk"
    fontWeight: 700
    lineHeight: 1.12
  body:
    fontFamily: "Inter"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "JetBrains Mono"
    fontWeight: 700
rounded:
  sm: "7px"
  md: "10px"
  lg: "18px"
  pill: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  10: "40px"
  12: "48px"
---

# Design System: PUBMAXX

## 1. Overview

**Creative North Star: "Nights Out With Friends"**

PUBMAXX is a map-first crawl planner that should feel like planning Saturday with your mates — warm candle paper by day, street-amber energy by night. The UI serves the product: Plan, Stop, Venue, Friend, Route. Brand moments (display type, coral/amber CTA) punch through; chrome stays calm enough to navigate under street light or kitchen lamp.

Light theme ships **Direction A Candle Coral** (warm peach paper + coral Plan CTA). Dark theme ships **Direction B Night Out** (deep ink + amber route/CTA + pint neon go). Field Guide hues (`river` / `pint` / `brick`) keep semantic jobs for pins and prices — they do not steal the primary CTA.

This system explicitly rejects purple-glow SaaS dark, cream+terracotta DTC defaults, card-dashboard first viewports, and Inter-as-display. Explorations live in `docs/design-explorations/`; strategic context in `PRODUCT.md`; implementation tokens in `app/globals.css` + `app/theme.css`.

**Key Characteristics:**

- One accent owns Plan hierarchy per theme (coral light / amber dark)
- Map plane is the hero surface; sheets support the Plan
- Semantic roles over decorative rainbow
- Space Grotesk display + Inter body + JetBrains Mono data
- Taste dials: variance ~5, motion ~4–5, density ~6 (product register)

## 2. Colors

Candle Coral neutrals with a coral primary by day; Night Out ink with amber primary by night. Semantics stay named.

### Primary

- **Candle Coral** (`#ff5a5f` / `--brass`): Light-theme Plan CTA, selection, active accent. Legacy token name `--brass` — keep the name so `readTokens()` and existing components keep working.
- **Coral Hover** (`#ff7a55` / `--brass-bright`): Louder warm hover / marker lift on Plan actions.
- **Night Amber** (`#f0a01a` / `--night-amber`, also assigned to `--brass` in dark): Dark-theme Plan CTA and route energy. `.planBtn` uses amber fill under `html[data-theme="dark"]`.

### Secondary (semantic — not decoration)

- **Pint Go** (`#18a76d` light / `#3dff9a` dark / `--pint`): Cheap pint / positive / neon-go on night.
- **Lager Caution** (`#f2a71b` / `--amber`): Mid price / caution (route energy in dark aligns with amber CTA).
- **Brick Dear** (`#ff5a5f` family / `--brick`): Expensive / destructive — same coral family as light CTA, but job is price/danger, not Plan.
- **River Info** (`#2864d8` / `--river`): Heritage / by-water / tube-blue info.

### Neutral

- **Candle Paper** (`#fff1e6` / `--paper`): Light page base — peach candle tint, not flat cream `#F4F1EA`.
- **Candle Panel** (`#fffaf6` / `--panel`): Recessed panel.
- **Raised** (`#ffffff` / `--panel-raised`): Cards, inputs.
- **Warm Ink** (`#1c1412` / `--ink`): Primary text on paper.
- **Coral Line** (`#efcfc4` / `--line`): Hairlines warmed toward coral, not lilac.
- **Night Ink Paper** (`#070b0a` / `--paper` dark): Deep nightlife base.
- **Night Chrome** (`#0e1613` / `#141c19`): Dark panel / raised.

### Named Rules

**The One Accent Rule.** Coral (light) or amber (dark) owns primary CTA and Plan selection. Pint, river, and brick never decorate chrome that isn’t a price band, heritage marker, or status.

**The No Purple Glow Rule.** Dark theme uses ink + amber bloom + pint neon only. No purple mesh, violet gradients, or grape bloom behind surfaces.

**The Candle Not Cream Rule.** Light paper stays peach-warm (`#fff1e6` family). Avoid generic warm-cream DTC (`#F4F1EA` + terracotta + serif display).

## 3. Typography

**Display Font:** Space Grotesk (with system sans fallback) — via `--font-display` / legacy alias `--serif`
**Body Font:** Inter (with system sans fallback) — `--font-body`
**Label/Mono Font:** JetBrains Mono — `--font-data`

**Character:** Confident geometric display with a big x-height; neutral body that doesn’t compete; mono stamps for prices and route metrics.

### Hierarchy

- **Display** (700, `--text-xl`–`--text-3xl`, tight leading): Brand mark, page heroes — sentence case.
- **Headline** (700, `--text-lg`–`--text-xl`): Section titles.
- **Title** (600–700, `--text-md`): Card / stop titles.
- **Body** (400–500, `--text-base` / `--text-sm`): Panel copy, stop meta.
- **Label / Stamp** (700 mono or caps chip): Price stamps and provenance chips only — uppercase reserved for stamps.

### Named Rules

**The Inter-Is-Body Rule.** Inter is never the display face. Space Grotesk (or an intentional display substitute documented here) owns headlines.

**The Caps-Are-Stamps Rule.** Sentence case everywhere except bordered/filled stamp chips.

## 4. Elevation

Hybrid: light theme uses soft paper-lift shadows; dark theme uses deeper drop plus a faint warm amber bloom so chrome feels lit, not merely dimmed. Map floating chrome uses solid night panels (no frosted glass wash).

### Shadow Vocabulary

- **Paper lift** (light `--shadow`): Soft warm-tinted lift over candle paper.
- **Night bloom** (dark `--shadow`): Deep black drop + amber glow (`rgba` warm, never purple).
- **Pressed ink** (`--shadow-inset-press`): Letterpress inset for `.ink-stamp`.

### Named Rules

**The Flat-Chrome-On-Map Rule.** Floating map controls are solid `--panel-raised`, not glassmorphism.

## 5. Components

Tactile and decisive — Plan actions read louder than chrome.

### Buttons

- **Shape:** Pill (`--radius-pill` / 999px) for Plan; default radius 10px for standard controls.
- **Primary (`.planBtn`):** Light — coral gradient `var(--brass)` → `var(--brass-bright)`. Dark — amber fill via `--night-amber` / dark `--brass`.
- **Hover / Focus:** Brass/amber border or glow ring; focus-visible outline 2px accent.
- **Active Plan:** Ink-deep treatment for “planning” state (existing `.planBtn.active`).

### Chips

- **Style:** Hairline border, optional brass/pint/river tint by job.
- **Stamps:** `.ink-stamp` pressed border + inset shadow; tilt rare and opt-in.

### Cards / Containers

- **Corner Style:** 10px default; 18px sheets.
- **Background:** `--panel` / `--panel-raised` — cards only when they contain interaction (stop list, controls). No decorative card grids in the hero.
- **Border:** `--line` hairlines.

### Inputs / Fields

- **Style:** Raised surface, soft line border, 10px radius.
- **Focus:** Accent ring (`--brass` / dark amber).

### Navigation

Quiet brass/amber hover on icons; floating theme toggle as raised pill on map. Mobile tab bar uses solid night panel in dark.

### Map (signature)

Full-bleed map plane with colored pins (pint / amber / brick / river by semantics) and route stroke in theme accent. `readTokens()` in `PubMapCanvas` consumes the same CSS variables — do not fork hexes in TS.

## 6. Do's and Don'ts

### Do:

- **Do** use Candle Coral paper + coral `--brass` for light Plan CTAs (`#ff5a5f` family).
- **Do** use Night Out deep ink + amber CTA / route energy in dark (`#f0a01a` / `--night-amber`).
- **Do** keep `--pint` / `--river` / `--brick` on pins and price semantics.
- **Do** keep existing token names (`--brass`, `--paper`, …) so map `readTokens()` keeps working.
- **Do** put brand + one Plan CTA + map in the first viewport hierarchy — see explorations README.

### Don't:

- **Don't** ship purple glow / mesh SaaS dark (no violet nebula, no grape bloom stacks).
- **Don't** default to cream DTC (`#F4F1EA` + terracotta + serif display).
- **Don't** build card dashboards or equal feature-card grids in the first viewport.
- **Don't** use Inter (or Roboto / Arial / system) as the display/hero face.
- **Don't** blend A’s coral paper with B’s neon and C’s river accents in one theme.
- **Don't** put floating promo badges or sticker chips on the map hero.
