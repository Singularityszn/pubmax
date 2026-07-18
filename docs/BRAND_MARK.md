# PUBMAXX brand mark

PUBMAXX had no mark — only the `PubmaxxWordmark` text lockup (the old landing
badge was removed in #311). This doc presents three mark concepts, the chosen
system, and the rules for using it. It ships the **system and the doc only** —
the live favicon/manifest are **not** repointed here (see § Activation).

The brand reality this mark answers to:

- **Name** — `PUBMA××ING`. The doubled **××** is the hero of the wordmark
  (`components/brand/PubmaxxWordmark.tsx`; second X in `--brass`).
- **Product** — London pubs, honest prices, night navigation.
- **Tone** — dry London. No kitsch: **no beer mugs, no foam, no froth.**
- **Tokens** — coral `--brass #ff5a5f` + `--brass-bright #ff7a55` (brand/action),
  amber `--amber #f0a01a` (price/route energy), `--ink-deep #060607` / `--paper`,
  pint-green `--pint`. Price plaques read brass; the mark inherits that language.

---

## The three concepts

Each is drawn on a 64×64 grid with shared stroke weight and corner radius, is
single-colour capable, and is legible at a 16px favicon.

### Concept A — The Crossing  ★ chosen

A single bold **X**: "× marks the pub," and two routes meeting at a lit
**rendezvous node**. It is the mark half of the identity — the wordmark keeps the
doubled ××, the mark distils it to one. One X survives a 16px favicon where a
pair smears, and it is the most ownable, least-kitsch reduction of the name.

Plaque (app icon), duotone (lockup), mono (favicon-in-context / inline):

```svg
<!-- plaque -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#ff5a5f"/>
  <path d="M18.5 18.5 L45.5 45.5" stroke="#060607" stroke-width="8.5" stroke-linecap="round"/>
  <path d="M45.5 18.5 L18.5 45.5" stroke="#060607" stroke-width="8.5" stroke-linecap="round"/>
  <circle cx="32" cy="32" r="3.2" fill="#ff7a55"/>
</svg>
<!-- duotone (transparent) -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <path d="M18.5 18.5 L45.5 45.5" stroke="#ff5a5f" stroke-width="8.5" stroke-linecap="round"/>
  <path d="M45.5 18.5 L18.5 45.5" stroke="#f0a01a" stroke-width="8.5" stroke-linecap="round"/>
  <circle cx="32" cy="32" r="3.2" fill="#ff7a55"/>
</svg>
<!-- mono (currentColor) -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <path d="M18.5 18.5 L45.5 45.5" stroke="currentColor" stroke-width="8.5" stroke-linecap="round"/>
  <path d="M45.5 18.5 L18.5 45.5" stroke="currentColor" stroke-width="8.5" stroke-linecap="round"/>
</svg>
```

**Rationale:** the name's own hero, reduced. Ownable, dry, geometric, and the
only concept that stays unmistakable at 16px.

### Concept B — The Plaque Pint

A pint reduced to pure geometry: a nonic silhouette flattened to a tapered
trapezoid on a brass plaque, with one crossbar = the honest **price / fill
line**. No handle, no foam — a plaque, not a mug. Nods hardest to the price-plaque
token system.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#f0a01a"/>
  <path d="M23 19 L41 19 L38 45 Q37.6 47 35.5 47 L28.5 47 Q26.4 47 26 45 Z"
        fill="none" stroke="#060607" stroke-width="5" stroke-linejoin="round"/>
  <path d="M25 31 L39 31" stroke="#060607" stroke-width="5" stroke-linecap="round"/>
</svg>
```

**Rationale:** most literal "honest pint price." Risk: a lone vessel can read as
a cup/bag at 16px and edges toward the beer-glass cliché we're avoiding.

### Concept C — Pin Crossing

A map pin whose interior counter is an **X** — "location" fused with the ××
rendezvous. Reads as a night-map marker large, and as a pin at favicon size.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M32 7 C21 7 12.5 15.3 12.5 26 C12.5 38.5 32 57 32 57 C32 57 51.5 38.5 51.5 26 C51.5 15.3 43 7 32 7 Z" fill="#ff5a5f"/>
  <path d="M26 20 L38 32 M38 20 L26 32" stroke="#060607" stroke-width="5" stroke-linecap="round"/>
</svg>
```

**Rationale:** most explicit "navigation" read. Risk: the pin silhouette is a
generic UI trope; the X hole nearly closes at 16px, weakening the brand tie.

---

## Chosen system — The Crossing

Implemented in `components/brand/PubmaxxMark.tsx` (`MARK_GEOMETRY` is the single
source of truth). Three variants:

| variant  | fill                                    | use                                   |
| -------- | --------------------------------------- | ------------------------------------- |
| `mono`   | `currentColor` X, transparent           | inline in text, single-colour, stamps |
| `duo`    | coral + amber X, lit node, transparent  | wordmark lockup, on-surface badge     |
| `plaque` | coral chip, ink-deep X, lit node        | app icon, avatar, standalone tile     |

```tsx
import PubmaxxMark from "@/components/brand/PubmaxxMark";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";

<PubmaxxMark variant="plaque" size={40} title="PUBMAXX" />
<PubmaxxWordmark withMark markVariant="duo" markSize={22} />  // full lockup
<PubmaxxWordmark />                                            // text-only (unchanged)
```

Colours resolve from live theme tokens (`var(--brass …)`) with literal
fallbacks, so the mark is correct in **both** light and dark and also renders
outside the app's CSS. `mono` inherits theme ink via `currentColor`.

### Lockup & spacing rules

- **Clear space** between mark and wordmark = `0.42em` of the wordmark size
  (`.pubmaxxLockup` gap). Around the whole lockup, keep clear space ≥ half the
  mark height.
- **Minimum sizes** — mark: 16px (favicon). Lockup: wordmark ≥ 14px so the ××
  glyphs stay legible; below that, use the mark alone.
- Mark and wordmark scale as **one unit** — never resize one independently.

### Don'ts

- Don't add a beer glass, foam, handle, or froth to the mark.
- Don't recolour the X outside the token palette (coral/amber/ink/currentColor).
- Don't rotate, skew, outline-stroke, or add a drop shadow to the X.
- Don't stretch — width and height stay equal.
- Don't place the `duo`/`mono` mark on a low-contrast surface; use `plaque` there.
- Don't reintroduce the old "P/pint" glyph (`public/favicon.svg` legacy).

---

## Static assets

`scripts/gen-brand-assets.mjs` stamps every static asset from the same geometry
into **`public/brand/`** (staging):

- `favicon.svg`, `icon.svg` (scalable "any")
- `icon-192.png`, `icon-512.png`
- `icon-maskable.svg`, `icon-maskable-512.png` (full-bleed; mark inside the 80%
  safe zone)
- `apple-touch-icon.png` (180px, opaque — iOS supplies its own corner mask)
- `mark-mono.svg`

Run `node scripts/gen-brand-assets.mjs`. PNGs are stamped via `sharp` when it is
installed (it is, in this repo); without it the script writes the source SVGs and
prints the manual raster step.

## OG / share-card integration (note only — do not edit here)

`lib/ogBrand.tsx` renders share cards through `next/og` + satori, which cannot
read `var(--…)` and cannot import this component (it re-declares tokens as
literals). Its `Wordmark`/`PintGlyph` still draw the old pint lockup. On
activation, port The Crossing into `ogBrand.tsx` as an inline-literal SVG:
coral `#ff5a5f` chip, two `#060607` strokes (`stroke-width` ≈ `size*8.5/64`,
round caps), a `#ff7a55` node — mirroring the `plaque` variant. Left unchanged in
this PR by design.

## Activation (follow-up, one commit)

This PR does not touch live references. To activate the chosen concept:

1. `cp public/brand/{favicon.svg,icon-192.png,icon-512.png,apple-touch-icon.png} public/`
   and `cp public/brand/icon-maskable.svg public/`.
2. Regenerate `public/icon-512.svg` / `icon-192.svg` from `public/brand/icon.svg`.
3. Update `public/manifest.webmanifest` maskable entry to the raster
   `icon-maskable-512.png` (or keep the SVG) and confirm `theme_color`.
4. Port the mark into `lib/ogBrand.tsx` per the note above.
5. Swap `PubmaxxWordmark` call sites to `withMark` where a mark is wanted.
