---
name: PUBMAXX
description: Nights-out-with-friends crawl planner with Candle Coral light and Night Out dark
colors:
  primary: "#ff5a5f"
  ink: "#17171a"
  ink-soft: "#3f3f46"
  muted: "#666670"
  line: "#e2e0e3"
  line-soft: "#ece9eb"
  paper: "#f8f2ec"
  panel: "#eee7df"
  panel-raised: "#fdf9f4"
  ink-deep: "#0b0b0d"
  brass: "#ff5a5f"
  brass-bright: "#ff7a55"
  pint: "#18a76d"
  amber: "#f2a71b"
  brick: "#b8323c"
  river: "#2864d8"
  river-bright: "#29b6f6"
  night-paper: "#0a0a0b"
  night-panel: "#141416"
  night-panel-raised: "#202024"
  night-amber: "#f0a01a"
  night-pint: "#5fb389"
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
  sm: "6px"
  md: "8px"
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

This file describes visual intent and a subset of the existing design tokens.
The [engineering guide](docs/DESIGN_SYSTEM.md#where-things-live) identifies each
owner and the precedence of project rules over generic skills.
The YAML describes default light DOM values, except keys prefixed with `night-`.
`primary` names the existing coral `brass` value for DESIGN.md consumers. It does
not introduce a CSS token. CSS owns runtime values, theme overrides, and the
separate map/root values. Do not export this subset over the application styles.

**Creative North Star: "Nights Out With Friends"**

PUBMAXX is a map-first crawl planner that should feel like planning Saturday with your mates - warm candle paper by day, street-amber energy by night. The UI serves the product: Plan, Stop, Venue, Friend, Route. Brand moments (display type, coral CTA) punch through; chrome stays calm enough to navigate under street light or kitchen lamp.

Light theme ships **Direction A Candle Coral** (warm peach paper + coral Plan CTA). Dark theme ships **Direction B Night Out** (deep ink + coral Plan CTA + amber route + muted pint green). Field Guide hues (`river` / `pint` / `brick`) keep semantic jobs for pins and prices - they do not steal the primary CTA.

This system explicitly rejects purple-glow SaaS dark, cream+terracotta DTC defaults, card-dashboard first viewports, and Inter-as-display. Explorations live in `docs/design-explorations/`; strategic context in `PRODUCT.md`; implementation tokens in `app/globals.css` + `app/theme.css`.

**Key Characteristics:**

- One coral accent owns Plan hierarchy in both themes
- Map plane is the hero surface; sheets support the Plan
- Semantic roles over decorative rainbow
- Space Grotesk display + Inter body + JetBrains Mono data
- Taste dials: variance ~5, motion ~4–5, density ~6 (product register)

## 2. Colors

Candle Coral neutrals by day; Night Out ink by night. Coral stays primary in both themes and semantic colours stay named.

For the messaging exception to these surface and accent rules, see the [design system](docs/DESIGN_SYSTEM.md).

### Primary

- **Candle Coral** (`#ff5a5f` / `--brass`): Primary Plan action in both themes. Keep the legacy token name. Selected tabs and chips use `--state-selected-*`. Coral words use `--brass-ink`.
- **Coral Hover** (`#ff7a55` / `--brass-bright`): Louder warm hover / marker lift on Plan actions.
- **Night Amber** (`#f0a01a` / `--night-amber`): Dark-theme route and price energy. Plan actions stay coral.

### Secondary (semantic — not decoration)

- **Pint Go** (`#18a76d` light / `#5fb389` dark / `--pint`): Positive status and the map's cheap-pint hue.
- **Lager Caution** (`#f2a71b` / `--amber`): Mid price / caution.
- **Brick Dear** (`#b8323c` light / `#d47a82` dark / `--brick`): Expensive or destructive. This hue stays distinct from the coral Plan action.
- **River Info** (`#2864d8` light / `#7aa6cc` dark / `--river`): Heritage, by-water, and transport information.

### Neutral

- **Candle Paper** (`#f8f2ec` / `--paper`): Light page base with a candle tint, not flat cream `#F4F1EA`.
- **Candle Panel** (`#eee7df` / `--panel`): Recessed panel.
- **Raised** (`#fdf9f4` / `--panel-raised`): Cards, inputs.
- **Neutral Ink** (`#17171a` / `--ink`): Primary text on paper.
- **Neutral Line** (`#e2e0e3` / DOM `--line`): Quiet structural hairline.
- **Night Ink Paper** (`#0a0a0b` / `--paper` dark): Deep nightlife base.
- **Night Chrome** (`#141416` / `#202024`): Dark panel / raised.

### Named Rules

**Price and trust.** Follow the engineering guide's
[status and price rules](docs/DESIGN_SYSTEM.md#launch-tokens) for price colours
and TrustPill rendering.

**The One Accent Rule.** Coral owns the one primary CTA per screen in both themes (the floating create disc that was its second home is retired, 1 Nov 2026); a selection (active tab, pressed chip) reads in ink (`--state-selected-*`, docs/DESIGN_SYSTEM.md "Coral is spent twice"). Amber stays a route and price signal; pint, river, and brick never decorate chrome that isn’t a price band, heritage marker, or status.

**The No Purple Glow Rule.** Dark theme uses deep ink, amber routes, and muted pint green. Chrome uses neutral shadows without an amber glow. No purple mesh, violet gradients, or grape bloom behind surfaces.

**The Candle Not Cream Rule.** Keep the light surface roles listed above. Avoid generic warm-cream DTC (`#F4F1EA` + terracotta + serif display).

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

Light theme uses warm paper-lift shadows. Dark theme uses neutral drop shadows and a faint white inset edge. Map floating controls use solid panels.

### Shadow Vocabulary

- **Paper lift** (light `--shadow`): Soft warm-tinted lift over candle paper.
- **Night depth** (dark `--shadow`): Black drop shadow, dark outline, and a faint white inset highlight. No coloured glow.
- **Pressed ink** (`--shadow-inset-press`): Letterpress inset for `.ink-stamp`.

### Named Rules

**The Flat-Chrome-On-Map Rule.** Floating map controls are solid `--panel-raised`, not glassmorphism.

**The Sheet-Material Exception.** Movable sheets and drawers may use the shared
neutral translucent material because it communicates depth over the map. They
must use the solid reduced-transparency and increased-contrast fallback.

## 5. Components

Tactile and decisive — Plan actions read louder than chrome.

### Buttons

- **Shape and type:** Every text button, Plan included, reads the `--control-*` row. See `docs/DESIGN_SYSTEM.md` "Text buttons".
- **Primary (`.planBtn`):** The Button primitive's flat primary (`--color-accent`, hover `--color-accent-strong`, dark label ink) in both themes. It keeps `--shadow-btn` because it floats over the map.
- **Hover / Focus:** Use the shared button styles. Keyboard focus uses a visible outline, without a decorative glow.
- **Active Plan:** Use the existing `.planBtn.active` styling and its theme-specific rules in `app/globals.css` and `app/theme.css`.

### Chips

- **Style:** Hairline border, optional brass/pint/river tint by job.
- **Stamps:** `.ink-stamp` pressed border + inset shadow; tilt is price-only.

### Cards / Containers

- **Corner Style:** 8px default; 18px sheets.
- **Background:** `--panel` / `--panel-raised` — cards only when they contain interaction (stop list, controls). No decorative card grids in the hero.
- **Border:** `--line` hairlines.

### Inputs / Fields

- **Style:** Raised surface, soft line border, 8px radius.
- **Focus:** Coral accent ring (`--brass`).

### Navigation

Quiet accent hover on icons; floating theme toggle as raised pill on map. Mobile tab bar uses solid night panel in dark.

### Map (signature)

Full-bleed map plane with colored pins (pint / amber / brick / river by semantics) and route styling from the existing map tokens. `readTokens()` in `components/map/canvas/tokens.ts` supplies semantic mark and label colours. `lib/mapBasemapTaste.ts` owns the map style-layer palette and pub-first label hierarchy; do not duplicate those values elsewhere.

## 6. Do's and Don'ts

### Do:

- **Do** use coral `--brass` for Plan CTAs in both themes (`#ff5a5f` family).
- **Do** use Night Out deep ink with amber route energy in dark (`#f0a01a` / `--night-amber`).
- **Do** keep `--pint` / `--river` / `--brick` on pins and price semantics.
- **Do** keep existing token names (`--brass`, `--paper`, …) so map `readTokens()` keeps working.
- **Do** put brand + one Plan CTA + map in the first viewport hierarchy — see explorations README.

### Don't:

- **Don't** ship purple glow / mesh SaaS dark (no violet nebula, no grape bloom stacks).
- **Don't** default to cream DTC (`#F4F1EA` + terracotta + serif display).
- **Don't** build card dashboards or equal feature-card grids in the first viewport.
- **Don't** use Inter (or Roboto / Arial / system) as the display/hero face.
- **Don't** blend the [locked theme directions](PRODUCT.md#color-decision-locked).
- **Don't** put floating promo badges or sticker chips on the map hero.
