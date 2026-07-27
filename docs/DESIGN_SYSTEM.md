# PUBMAXXING design system

**North star: "Nights Out With Friends."** PubMax is a map-first crawl planner
for Saturday with your mates — candle-table planning by day, street-amber
energy by night. Strategic context lives in root `PRODUCT.md`; the visual
spec (Impeccable / Stitch format) lives in root `DESIGN.md`. This document
remains the engineering token guide for `app/globals.css` + `app/theme.css`.

## Locked color decision (Phase 0 → Phase 3)

Explored in [`docs/design-explorations/`](./design-explorations/README.md).
**Ship A for light, B for dark — not a blend.**

| Theme | Direction | Thesis |
|---|---|---|
| **Light (default)** | **A Candle Coral** | Warm peach paper + coral Plan CTA (`--brass` ≈ `#ff5a5f`) |
| **Dark** | **B Night Out** | Deep ink + amber route/CTA (`--night-amber` / dark `--brass`) + pint neon go — **no purple glow** |

Field Guide jobs retained: `--river` / `--pint` / `--brick` stay semantic for
pins and prices. Coral (light) or amber (dark) owns the primary CTA.

Pointers: [`PRODUCT.md`](../PRODUCT.md) · [`DESIGN.md`](../DESIGN.md) ·
[`docs/design-explorations/`](./design-explorations/).

This document describes the token scale, type pairing, and pressed-ink
tactility that make that thesis hold. It **extends** the existing system in
`app/globals.css` (tokens, light theme) and `app/theme.css` (dark theme
overrides + shared theme-toggle chrome) — nothing here forks or replaces those
files, and every token that existed before this pass still resolves under the
same **name** (values may retune within the A/B decision).

## Where things live

| File | Owns |
|---|---|
| `PRODUCT.md` | Strategic brief: vocabulary, A/B lock, taste dials, anti-refs |
| `DESIGN.md` | Impeccable visual spec (colors, type, components, do/don't) |
| `app/globals.css` | `:root` token definitions (light/default values), resets, most component classes, the pressed-ink utility |
| `app/theme.css` | `html[data-theme="dark"]` token overrides, Plan CTA amber override, theme-toggle |
| `app/layout.tsx` | `next/font` wiring — loads the three type-trio fonts as CSS variables on `<html>` |
| `components/PubMapCanvas.tsx` | Reads tokens at runtime via `readTokens()` to paint the MapLibre style — the map is a *consumer* of these tokens, never a second source of truth |

If you're adding a new component: reach for a token below before writing a
literal value. If the token you need doesn't exist, add it here first.

## Colour

### Palette (the literal values)

| Token | Light (A Candle Coral) | Dark (B Night Out) | Role |
|---|---|---|---|
| `--ink` | `#1c1412` | `#eef3ef` | primary text |
| `--ink-soft` | `#4a3632` | `#c5d0c9` | secondary text |
| `--muted` | `#7a5c55` | `#8fa399` | tertiary/label text |
| `--line` | `#efcfc4` | `#24302b` | hairline borders |
| `--line-soft` | `#f5e0d6` | `#1a2420` | faint dividers |
| `--paper` | `#fff1e6` | `#070b0a` | page base |
| `--panel` | `#fffaf6` | `#0e1613` | recessed panel |
| `--panel-raised` | `#ffffff` | `#141c19` | cards, inputs |
| `--ink-deep` | `#16122a` | `#040606` | brand-mark / stamp-dark chrome |
| `--pint` | `#18a76d` | `#3dff9a` | cheap pint / positive / neon-go |
| `--amber` | `#f2a71b` | `#f0a01a` | mid price / caution |
| `--brick` | `#ff5a5f` | `#ff6b7a` | expensive / destructive |
| `--brass` | `#ff5a5f` | `#f0a01a` | **Plan CTA / accent** (coral light → amber dark) |
| `--brass-bright` | `#ff7a55` | `#ffb328` | accent hover / bright lift |
| `--night-amber` | aliases `--brass` | `#f0a01a` | explicit Night Out CTA accent |
| `--river` | `#2864d8` | `#64b5ff` | heritage / by-water |
| `--river-bright` | `#29b6f6` | `#7dd3fc` | heritage on dark chrome |

**One accent owns the CTA by theme.** Coral (`--brass`) in light; amber
(`--brass` / `--night-amber`) in dark. Every other hue (`pint` / `amber` /
`brick`, `river`) is a semantic status/category colour — don't reach for them
to "add colour" to something that isn't a price band or a heritage/by-water
marker.

### Semantic roles (new — additive aliases)

Raw palette tokens describe *hue*; semantic tokens describe *job*. New work
should prefer the semantic name so a future palette change (e.g. retuning
`--brick`) propagates without hunting down every consumer:

```
--color-accent            → var(--brass)
--color-accent-strong     → var(--brass-bright)
--color-positive          → var(--pint)
--color-caution           → var(--amber)
--color-negative          → var(--brick)
--color-info              → var(--river)
--color-info-strong       → var(--river-bright)
--color-surface           → var(--paper)
--color-surface-panel     → var(--panel)
--color-surface-raised    → var(--panel-raised)
--color-surface-inverse   → var(--ink-deep)
--color-text              → var(--ink)
--color-text-soft         → var(--ink-soft)
--color-text-muted        → var(--muted)
--color-border            → var(--line)
--color-border-soft       → var(--line-soft)
```

### Fixed-contrast text

A handful of places set text colour on a **solid accent fill** (a brass
button, an ink-deep button, a photo-caption scrim) rather than a
theme-flipping surface. That text must stay constant in both themes — the
fill already carries the theme's contrast logic. Use these instead of a raw
hex:

```
--color-on-accent          #fdfaf2   cream text on solid brass
--color-on-inverse         #fdfaf2   cream text on solid ink-deep
--color-on-accent-strong   #12100c   dark text on solid brass-bright
--color-on-photo           #ffffff   white text on a photo-scrim overlay
```

## Type

### The trio

| Role | Typeface | Variable | Why |
|---|---|---|---|
| Display | **Space Grotesk** (variable weight, 300–700) | `--font-display` (aliased by `--serif`) | A modern geometric grotesque with a **very large x-height**, chosen for a Gen-Z-native voice. The big x-height keeps capitals and lowercase close in size, so there is little caps-contrast and headlines read confident and current rather than shouty. Its quirky terminals give it character without tipping into gimmick. This **supersedes the earlier Fraunces "field-guide serif"** thesis — the brand is now a display sans, not hand-set serif. Open-licence, self-hosted via `next/font/google` (no external request, no layout shift). |
| Body | **Inter** | `--font-body` | Already the app's body face — kept deliberately. Inter is neutral and extremely legible at small UI sizes (panel copy, chip labels), which is exactly what a body face should be: carry the display face's personality without competing for it. |
| Data | **JetBrains Mono** | `--font-data` | Prices, stats, route metrics. A monospace gives numerals a "stamped ticket / till receipt" character that Inter's tabular figures don't — it's a deliberate second texture, not just a bolder body font. Paired with `font-variant-numeric: tabular-nums` so columns of numbers align. |

All three are loaded once in `app/layout.tsx` via `next/font/google` and
exposed as CSS variables on `<html>`, so `globals.css`/`theme.css` and any
component reading `var(--serif)`, `var(--font-body)`, or `var(--font-data)`
picks them up automatically — no per-component font imports.

`--serif` is kept as a permanent alias for `--font-display`: every existing
`h1`/`h2`/`h3`/`.eyebrow`/card-title that already reads `var(--serif)` now
renders in Space Grotesk with zero changes to those components. The variable
name is historical (it's a sans now, not a serif) — it's kept only so the swap
touches one place, not ~40 call-sites.

### Caps policy — stamps only

Display type is set in **sentence case**, not all-caps. Eyebrows, section
titles, stat labels, and column headers were previously `text-transform:
uppercase` with wide tracking; that tracking existed to make all-caps legible,
and the caps themselves fought Space Grotesk's low caps-contrast. They are now
sentence case with tight tracking (~`0.01em`), sized up slightly to hold the
hierarchy the tracking used to carry.

**Uppercase is reserved for stamps** — small bordered/filled pill chips and
badges that read as a pressed mark rather than prose. These keep their caps as
a deliberate ink-stamp idiom:

- provenance / era chips (`.provChip`, `.claimEra`, `.ledgerProvenance`)
- honesty + demo badges (`.exampleTag`, `.demoDataNote span`, `.feedFilterDemo`)
- pill kicker/badge chips (`.curatedBadge`, `.goldenKicker`, feed status chips)
- the passport-stamp kicker (`.passportKicker`, set in the mono data face)

If a label is plain text with letter-spacing (an eyebrow, a section title, a
stat `dt`), it is sentence case. If it's a chip with a border/fill that reads
as a stamp, it may keep caps.

### Type scale

```
--text-2xs   0.68rem     eyebrows, micro-labels
--text-xs    0.76rem     chip/tag text
--text-sm    0.85rem     secondary body copy
--text-base  1rem        default body
--text-md    1.16rem     h3 / card titles
--text-lg    1.42rem     h2
--text-xl    1.74rem     h1 / section heroes
--text-2xl   2.13rem     page-level display
--text-3xl   2.6rem      landing hero only
```

```
--leading-tight   1.12   display headlines
--leading-snug    1.35   card copy
--leading-normal  1.5    body paragraphs
--tracking-tight  -0.01em  large display type (Space Grotesk headlines)
--tracking-wide   0.05em   legacy; sentence-case labels now use ~0.01em
--tracking-wider  0.08em   legacy (all-caps titles are retired — see caps policy)
```

Existing components keep their literal `font-size` values (this pass doesn't
rewrite 35+ components); the scale exists so **new** type decisions have a
system to land on instead of another one-off rem value.

### Data/tabular utility

```css
.font-data,
.tabular-data {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
}
```

Opt-in class for anything migrating to the full "stamped ticket" numeral
treatment. Existing price displays that only set
`font-variant-numeric: tabular-nums` (without the mono face) are untouched —
adding the class is optional, additive polish.

## Spacing, radius, shadow

```
--space-1 … --space-12   4px base scale (4/8/12/16/20/24/32/40/48)
--radius       10px      default corner (cards, inputs)
--radius-sm     7px      tight corner (chips, small controls)
--radius-lg    18px      sheets / bottom-drawer corners
--radius-pill 999px      pills, avatar-style chips
```

### Shadow: night bloom (dark) vs paper-lift (light)

`--shadow` is the same variable in both themes but tuned to a different
*feeling*, not just a darker version of itself:

- **Light (`app/globals.css`)** — soft warm paper-lift over Candle Coral paper
  (coral-tinted, not cool lavender).
- **Dark (`app/theme.css`)** — deeper drop **plus a faint amber bloom** (Night
  Out street light) — never purple mesh/glow.

`--shadow-sm` follows the same day/night pairing for smaller elements.
`--shadow-inset-press` is the inset "pressed" shadow shared by both themes
for the pressed-ink utility (see below) — it flips its highlight edge (cream
in light, amber in dark) so the letterpress effect reads correctly against
either surface.

## Motion

```
--duration-fast     0.12s   press/tap feedback
--duration-base     0.15s   hover/focus colour transitions
--duration-slow     0.28s   drawer/sheet slide
--duration-ambient  1.4s    ambient pulses (loading dots, thinking indicator)
--duration-press    0.13s   button press-in / release
--ease-standard     ease
--ease-out          cubic-bezier(0.4, 0, 0.2, 1)
--ease-out-strong   cubic-bezier(0.23, 1, 0.32, 1)    entrances / UI feedback — starts fast
--ease-drawer       cubic-bezier(0.32, 0.72, 0, 1)    iOS-like sheet / drawer travel
--ease-spring       cubic-bezier(0.34, 1.56, 0.64, 1) subtle overshoot — momentum entrances only
--press-scale       0.97    default pressed scale — subtle, "the UI heard you"
--press-scale-firm  0.94    small icon buttons can press a touch firmer
```

## Stacking (z-index)

Never write a literal `z-index` in app/component CSS — use the semantic ladder
defined in `:root` in `app/globals.css` (`--z-float` 50 → `--z-overlay-top`
1300, with the map's internal ladder `--z-map-base` 450 … `--z-map-toolbar`
560 in between; see the token block for the full list with per-token comments).
Each token's value equals the literal it replaced, so adopting one is never a
stacking-order change. If two overlays must NOT tie, they get separate tokens
(e.g. `--z-map-route-chip` 540 sits under `--z-map-chip` 541; `--z-map-suggest`
512 under `--z-map-banner` 515). Component-internal stacking (0–20, local
stacking contexts) stays as literals.

**Rule: every animated property lives behind
`@media (prefers-reduced-motion: no-preference)`**, or is cut to `0.01ms` by
the existing global
`@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`
rule at the bottom of `globals.css`. This was already true before this pass
(map orbit, drawer transitions, hero-card reveal, pulse dots); the new
`.ink-stamp--tilt` press-tilt utility follows the same rule — the tilt is
purely visual, so it's skipped entirely for reduced-motion users rather than
just made instant.

## Pressed-ink / bar-mat tactility

The price stamp, provenance chips, and vibe tags should feel like something
**physically stamped** — pressed ink on a bar mat — not a generic rounded
badge. One shared utility, defined once in `app/globals.css`:

```css
.ink-stamp {
  border: var(--ink-stamp-border);       /* 1.5px solid brass */
  border-radius: var(--ink-stamp-radius); /* 6px */
  box-shadow: var(--ink-stamp-shadow);    /* inset letterpress shadow */
  font-family: var(--font-data);
  font-weight: 700;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}

.ink-stamp--flat  /* same border/shadow, body face instead of data face — for word chips */
.ink-stamp--tilt  /* adds the -1.5deg press tilt, behind prefers-reduced-motion */
```

**API for other components to adopt** (additive — existing `.priceStamp`,
`.provChip`, `.vibeChip` classes are untouched and keep working; add
`.ink-stamp` alongside them):

- `.ink-stamp` — base treatment for anything numeric (prices, stamped
  figures).
- `.ink-stamp--flat` — same border/shadow, but body-face type for
  word-based chips (provenance labels, vibe tags).
- `.ink-stamp--tilt` — the signature `-1.5deg` press tilt. **Reserve this for
  the one signature element** (the brass price stamp) — provenance chips and
  vibe tags should use `.ink-stamp`/`.ink-stamp--flat` *without* the tilt, so
  the tilt itself stays rare and memorable rather than becoming "how all
  chips look."

Example adoption (not applied in this pass — components are owned by other
in-flight work):

```tsx
<span className="priceStamp ink-stamp ink-stamp--tilt">£4.20</span>
<span className="provChip sourced ink-stamp--flat">Sourced</span>
<span className="vibeChip small ink-stamp--flat">rowdy</span>
```

## The signature element

**One thing held with restraint: the brass price stamp.** It's the only
place the press-tilt (`.ink-stamp--tilt`) treatment should appear. The
candle-lit map is the second memory hook (already built — see
`components/PubMapCanvas.tsx`'s `readTokens()`/scene build), but it is a
*mode*, not a stampable UI element, so it doesn't compete with the price
stamp for the "one signature" slot.

Do not add a second tilted/stamped element elsewhere in the UI. If a new
surface needs emphasis, reach for the brass border/accent colour, not a
second signature gesture.

## Day/night coherence

Both themes flip from the same token names — `app/theme.css` only
overrides values inside `html[data-theme="dark"]`, never introduces new
variable names. The map (`components/PubMapCanvas.tsx`) reads the *current*
computed values via `readTokens()` at scene-build time and re-triggers on
theme change, so it never hardcodes a light or dark palette of its own.

This pass audited `app/globals.css` and `app/theme.css` for literals that
bypassed this: it found six repeated instances of hardcoded cream/dark text
sitting on solid brass/ink-deep fills (now `--color-on-accent` /
`--color-on-inverse` / `--color-on-accent-strong`), and two card gradients
(`.writerCard`, `.landlordAnswer`) whose end-stop was a fixed light-cream hex
that would have gone bright and jarring against the dark theme's charcoal
surfaces — both now resolve via `--surface-tint-river` /
`--surface-tint-brass`, `color-mix()`-derived from `--panel-raised` so they
stay in the current theme's tonal range automatically.

One legend swatch (`.mapLegend span`) keeps a fixed light-mode ink colour by
design — the legend chip's background is intentionally always a light,
translucent card (readable pinned over the map basemap in both themes), so
its text should not flip dark.

## Do / don't

**Do**

- Reach for a semantic token (`--color-accent`, `--color-positive`, …) before
  a raw palette token, and a raw palette token before a literal hex.
- Use `--font-display`/`--serif` for headlines and brand marks,
  `--font-body` for everything else, `--font-data` for prices/stats.
   the `--ink-stamp-*` tokens for the pressed-ink utility.
- Gate any new animation behind `prefers-reduced-motion: no-preference`.
- Add a new token here (and to `:root`) before inventing a one-off value.

**Don't**

- Don't introduce a second accent hue. Brass is the accent; `pint`/`amber`/
  `brick`/`river` are semantic, not decorative.
- Don't use gradients as decoration — the two gradients in this codebase
  (`.writerCard`, `.landlordAnswer`) are subtle, single-hue surface tints, not
  a visual flourish; don't add a rainbow/hero gradient elsewhere.
  Authored Pub Pal materials are the narrow exception: a gradient may model
  chrome, glass, or hologram depth inside the character portrait only. It must
  use one Signal affinity plus semantic surface tokens and must never become a
  page, card, button, or navigation background.
- Don't add glassmorphism beyond the existing, narrow `backdrop-filter: blur()`
  uses on floating chrome (toolbar, legend, onboarding scrim) — those are
  functional (legibility over the map), not aesthetic.
- Don't add a second tilted/stamped signature element — restraint is the
  point.
- Don't hardcode a hex value in a component that already has a token for that
  role; if no token fits, propose one here first.

## Category colour & drink imagery (Epic E5)

The "site looks plain" fix, held to the same token discipline — **additive
colour, not a repaint**. Brass is still the one brand accent; the category
colours identify a *drink family* the way `--pint`/`--amber`/`--river` are
semantic hues, not a licence to paint any surface. If you're not showing a
drink category, don't reach for a `--cat-*` token.

### Category colour tokens

One accent per drink category, defined as CSS custom properties in the E5
append-only block at the end of `app/globals.css`, mirrored in
`lib/categoryColors.ts` (the source of truth for TS consumers). Each has an
explicit light + dark value, hand-tuned to pass **WCAG contrast as text/icon
on the recessed panel** (`--panel`: `#fbf8f0` light / `#171712` dark):

| Token | Light | ratio | Dark | ratio | Hue |
|---|---|---|---|---|---|
| `--cat-beer` | `#9a6a24` | 4.44\* | `#d3a44a` | 7.86 | brass (== the base accent) |
| `--cat-wine` | `#8a2846` | 8.00 | `#e07a97` | 6.34 | burgundy |
| `--cat-whisky` | `#985a12` | 5.20 | `#e0a34e` | 8.15 | amber |
| `--cat-gin` | `#0f7a72` | 4.89 | `#4fc9bd` | 8.92 | botanical teal |
| `--cat-vodka` | `#2f6f8f` | 5.22 | `#7ec4e0` | 9.30 | ice-blue |
| `--cat-rum` | `#8a4a24` | 6.41 | `#cd8a5a` | 6.32 | mahogany |
| `--cat-cocktail` | `#b5493a` | 4.97 | `#ef8a6a` | 7.29 | sunset |
| `--cat-shot` | `#6a3fb0` | 6.71 | `#b28ae8` | 6.59 | electric violet |
| `--cat-alcohol-free` | `#176b72` | 5.47 | `#67cbd0` | 9.30 | clear teal |
| `--cat-soft-drink` | `#7a4f00` | 7.20 | `#f0b65a` | 9.37 | citrus |
| `--cat-other` | `#5c5347` | 7.11 | `#a89e8c` | 6.79 | neutral bark |

\* beer is pinned to the brass accent (one identity with the map's
cheapest-pint hue), so it's AA-large / icon (3:1) rather than AA-normal. Use it
as a glyph or large accent, not small body text.

**Legacy Mode** gets a darker (light theme) / brighter (dark theme)
high-contrast set via the `html[data-legacy="1"]` overrides in the same block —
the tokens flip automatically, no consumer changes.

### Drink imagery — licence-safe, our IP

Per-category glyphs are **original SVG line-art** authored for this repo
(`components/drinks/icons/*.tsx`): a pint glass, wine glass, whisky tumbler, gin
balloon, rum snifter, vodka shooter, cocktail coupe, shot glass, a zero-sealed
pint for `alcohol-free`, a straw-and-citrus tumbler for `soft-drink`, and a
generic bottle for `other`. They stroke with `currentColor` on a shared 32×32
viewBox, so they stay crisp from 16px to 128px and take the category colour from
whatever sets `color`.

**Licence rule for any future raster imagery:** do NOT scrape or embed
copyrighted photos. Any bitmap must be **CC0 / public-domain**, credited in the
provenance the same way drink prices are (source + licence + observedAt). Until
then, the SVG glyphs are the drink imagery — they're ours, so there's no licence
risk.

### How to opt in (adoption guide)

Other surfaces stay opt-in — this pass ships the *system*, glyphs, and a
showcase; it does not recolour existing feed/map/ledger panels (that's
codex-collision territory).

1. **A single category glyph, correctly themed:**

   ```tsx
   import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
   <DrinkGlyph category="wine" size={40} title="Wine" />   // labelled
   <DrinkGlyph category="gin" />                            // decorative
   ```

   `DrinkGlyph` colours itself from `var(--cat-*)` (light/dark/Legacy all
   handled). Pass `inheritColor` to draw in the parent's `currentColor` instead
   (e.g. inside a mono chip that already sets the colour).

2. **A category accent in CSS** — reference the token, never a literal hex:

   ```css
   .menuSection[data-category="whisky"] .sectionRule { color: var(--cat-whisky); }
   ```

   Or from TS via `categoryColor("whisky")` → `"var(--cat-whisky)"`.

3. **The whole palette at a glance** — drop the showcase on a menu header /
   discover surface:

   ```tsx
   import { CategoryShowcase } from "@/components/drinks/CategoryShowcase";
   <CategoryShowcase title="Every drink, every colour" />
   ```

4. **Paper/linen texture** — add the `.textured-panel` class to a NEW surface
   you own (a card, a header). It lays a ~4% brass-tinted linen weave in a
   `::before` (multiply in light, screen in dark), never intercepts pointer
   events, and self-disables under Legacy Mode / forced-colors. Keep it subtle —
   texture, not noise — and do **not** retrofit it onto existing panels codex may
   be editing.

**Don't:** don't recolour prices, statuses, or heritage markers with a
`--cat-*` token (those own `--amber`/`--pint`/`--river`); don't apply a category
colour to something that isn't a drink category; don't add a second texture
pattern or bump the linen opacity into "pattern" territory.
