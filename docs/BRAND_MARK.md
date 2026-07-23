# PUBMAXX brand mark

The master mark is **the double-struck X** ("The Crossing X"), owner-approved on
2026-07-22 and stamped across the web and native surfaces plus the dynamic OG
share cards from a single geometry source. It supersedes the earlier "Clink"
(tapered-pint) exploration on those surfaces.

## The story

A confident, clean X built on the X Corp / blackboard-bold (double-struck)
construction: one **thick solid descending stroke** (`\`, top-left to
bottom-right) crossed by an **ascending stroke** (`/`, bottom-left to top-right)
that is **split into two thin parallel strokes** passing either side of the thick
one, leaving a clear channel where they cross. Flat sharp terminals, zero
ornament. Distinctiveness is ours: coral `#ff5a5f` on ink `#060607`, our own
proportions and terminal angles — a similar construction to X Corp's, never a
trace of their asset.

The brand reality the mark answers to:

- **Name**: `PUBMA××ING`. The doubled `××` is the hero of the wordmark
  (`components/brand/PubmaxxWordmark.tsx`; both glyphs now use the master mark
  construction, the second tinted `--brass`).
- **Product**: London pubs, honest prices, night navigation.
- **Tone**: dry London. No kitsch, no foam, no froth.
- **Tokens**: coral `--brass #ff5a5f` + `--brass-bright #ff7a55` (the ember),
  `--ink-deep #060607`, `--paper #fffdf9`.

## Geometry

Drawn on a 64x64 grid, the single source of truth is `MARK_GEOMETRY` in
`components/brand/PubmaxxMark.tsx`. Every stroke is a filled polygon (not a
stroked path) so the flat-cut terminals stay crisp at every raster tier. The
same numbers are copied, and MUST stay identical, in `scripts/gen-brand-assets.mjs`
and `scripts/gen-native-app-icons.mjs`.

```svg
<!-- bare X (transparent): favicon / PWA "any" icons. No ember on the icon. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <polygon points="42,10 47,10 13,54 8,54" fill="#ff5a5f"/>   <!-- thin / A -->
  <polygon points="51,10 56,10 22,54 17,54" fill="#ff5a5f"/>  <!-- thin / B -->
  <polygon points="9,10 21,10 55,54 43,54" fill="#ff5a5f"/>   <!-- thick \ (on top) -->
</svg>
<!-- tile (app icon / maskable / apple-touch): coral X on ink-deep -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#060607"/>
  <polygon points="42,10 47,10 13,54 8,54" fill="#ff5a5f"/>
  <polygon points="51,10 56,10 22,54 17,54" fill="#ff5a5f"/>
  <polygon points="9,10 21,10 55,54 43,54" fill="#ff5a5f"/>
</svg>
```

- **Thick stroke** (`\`, descending, ~12u wide, drawn on top): `9,10 21,10 55,54 43,54`
- **Thin stroke A** (`/`, upper-left, ~5u): `42,10 47,10 13,54 8,54`
- **Thin stroke B** (`/`, lower-right, ~5u): `51,10 56,10 22,54 17,54`
- **Channel** between the two thin strokes ≈ 4u (where the thick stroke crosses).
- **Simplified slash** (16px raster fallback, replaces the two thins): `45,10 53,10 19,54 11,54`
- **Ember node** (in-app surfaces only, not the icon): circle cx 32, cy 32, r 3.2, fill `#ff7a55`.

## Small-optics rule (16px acceptance bar)

The double-struck read holds down to ~24-32px; below that the ~4u channel between
the two thin strokes closes up. So the **16px member of `favicon.ico` uses the
simplified single ascending slash** (`slashSimple`) plus the thick stroke — a
crisp, unmistakable X at 16px (verified by rendering). `favicon.svg` ("any" size)
keeps the full double-struck construction: on retina tabs it renders at ~32px+
and resolves cleanly; the low-DPI 16px fallback is the `.ico` simplified entry.

## Ember decision

The ember is **not part of the icon silhouette**. On the double-struck crossing
the interlock is already the visual event, and a dot at centre muddies the
channel (verified by rendering). So every static icon export — `favicon.svg`,
`favicon.ico`, `icon-192/512`, maskable, apple-touch — and the native icon/splash
sources drop it. It is kept only on the **lit in-app brand surfaces** as a
personality spark: the `duo`/`plaque` component variants, the Strike pop, the
night seal, the loading ember, and the OG share cards (rendered ≥46px).

## Component

Implemented in `components/brand/PubmaxxMark.tsx`. Three variants, one API:

| variant  | fill                                             | use                                   |
| -------- | ------------------------------------------------ | ------------------------------------- |
| `mono`   | `currentColor` strokes, no ember, transparent    | inline in text, single-colour, stamps |
| `duo`    | coral strokes + coral-bright ember, transparent  | wordmark lockup, on-surface badge     |
| `plaque` | ink-deep tile, coral strokes, coral-bright ember | app icon, avatar, standalone tile     |

```tsx
import PubmaxxMark from "@/components/brand/PubmaxxMark";
import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";

<PubmaxxMark variant="plaque" size={40} title="PUBMAXX" />
<PubmaxxWordmark withMark markVariant="duo" markSize={22} />  // full lockup
<PubmaxxWordmark />                                            // text-only (unchanged)
```

Colours resolve from live theme tokens (`var(--brass ...)`) with literal
fallbacks, so the mark is correct in both light and dark and also renders outside
the app's CSS. `mono` inherits theme ink via `currentColor`.

### Lockup and spacing rules

- **Clear space** between mark and wordmark is `0.42em` of the wordmark size
  (`.pubmaxxLockup` gap). Around the whole lockup, keep clear space of at least
  half the mark height.
- **Minimum sizes**: mark 16px (favicon). Lockup: wordmark at least 14px so the
  `××` glyphs stay legible; below that, use the mark alone.
- Mark and wordmark scale as **one unit**. Never resize one independently.

### Don'ts

- Don't merge the two thin ascending strokes or close their channel (except the
  sanctioned 16px `slashSimple` fallback).
- Don't recolour the strokes outside the token palette (coral / ink / currentColor).
- Don't add the ember to an icon export or small tier.
- Don't rotate, skew, outline-stroke, or drop-shadow the mark.
- Don't stretch. Width and height stay equal.
- Don't place the `duo` or `mono` mark on a low-contrast surface; use `plaque`.
- Don't reintroduce the retired "Clink" tapered-pint arms.

## Static assets

`scripts/gen-brand-assets.mjs` stamps the **live** web assets from the geometry
above. Run `node scripts/gen-brand-assets.mjs`; it needs `sharp` (already a
dependency).

Live under `public/`:

- `favicon.svg`, `favicon.ico` (16 / 32 / 48 PNG members; the 16 uses the
  simplified single-slash cut)
- `icon-192.svg` / `icon-192.png`, `icon-512.svg` / `icon-512.png` (bare X)
- `icon-maskable.svg` / `icon-maskable-512.png` (ink-deep tile, mark inside the
  80% safe zone, rx 0 for the platform mask)
- `apple-touch-icon.png` (180px, coral X on ink-deep, iOS supplies its own
  corner mask)

A `public/brand/` reference mirror (plus `mark-mono.svg`) is refreshed by the
same run. The `?v=` cache-busting token on the `<head>` icon URLs
(`app/layout.tsx`) is bumped to `20260722-x`.

## Native app icons and splash

`scripts/gen-native-app-icons.mjs` writes the `@capacitor/assets` source images
into `assets/` (coral icon field with the ink X; a light coral splash and a dark
ink splash, mark centred, no ember). The Android adaptive foreground is stamped
at scale 0.8 so the wider X stays inside the 66/108 safe zone. The canonical
stamp step is `npx @capacitor/assets@3 generate`, which fans them into `ios/` and
`android/`.

## OG cards

`lib/ogBrand.tsx` `CrossingMark` draws the double-struck X polygons + the ember
(export name/API unchanged so its ~17 `next/og` consumers — `opengraph-image.tsx`
/ `*-card` routes plus the `app/og.png` route — stay untouched). satori renders
the `<polygon>` subset natively.

## Pending: store-listing masters

The store-listing masters under `public/store-assets/` (rendered by
`scripts/gen-store-assets.mjs`, pinned by `__tests__/storeAssets.test.ts`, issue
#440) still carry the retired Clink polygons and are **out of scope for this
lane**. They need a follow-up pass to the double-struck construction so the App
Store / Play icons match; until then the store icons will lag the web/native/OG
surfaces.
