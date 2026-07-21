# PUBMAXX brand mark

The master mark is **The Clink**, owner-approved on 2026-07-21 and activated
across every web and native surface from a single geometry source. It supersedes
the earlier "Crossing" exploration (which lives on only in the OG share cards and
the store-listing masters until their own follow-up sync; see the note at the
end).

## The story

The X is two pints the second they touch in a toast, the moment a night
officially starts. The ember is the clink.

Each arm is a tapered pint glass caught mid-toast: wide mouth up, narrow base
down. The ember dot at the point where the two glasses meet is the clink itself.
At size the taper reads as glasses; at a 16px favicon it collapses to a confident
chiselled X. It keeps the previous mark's ember, so the brand evolves rather than
reboots, and it is the one reduction of the name where the joy is structural: it
is literally the moment the product exists for.

The brand reality the mark answers to:

- **Name**: `PUBMA××ING`. The doubled `××` is the hero of the wordmark
  (`components/brand/PubmaxxWordmark.tsx`; second X in `--brass`).
- **Product**: London pubs, honest prices, night navigation.
- **Tone**: dry London. No kitsch, no foam, no froth. The pints are implied by
  the taper, never drawn as mugs.
- **Tokens**: coral `--brass #ff5a5f` + `--brass-bright #ff7a55` (the ember),
  `--ink-deep #060607`, `--paper #fffdf9`.

## Geometry

Drawn on a 64x64 grid, the single source of truth is `MARK_GEOMETRY` in
`components/brand/PubmaxxMark.tsx`. The two arms are filled polygons (not stroked
paths) so the flat-cut chiselled terminals stay crisp at every raster tier. The
same numbers are copied, and MUST stay identical, in `scripts/gen-brand-assets.mjs`
and `scripts/gen-native-app-icons.mjs`.

```svg
<!-- bare Clink (transparent): favicon / PWA "any" icons -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <polygon points="19.8,8.7 10.2,17.3 46.0,53.7 52.0,48.3" fill="#ff5a5f"/>
  <polygon points="44.2,8.7 53.8,17.3 18.0,53.7 12.0,48.3" fill="#ff5a5f"/>
  <circle cx="32" cy="32" r="3.2" fill="#ff7a55"/>
</svg>
<!-- tile (app icon / maskable / apple-touch): coral Clink on ink-deep -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#060607"/>
  <polygon points="19.8,8.7 10.2,17.3 46.0,53.7 52.0,48.3" fill="#ff5a5f"/>
  <polygon points="44.2,8.7 53.8,17.3 18.0,53.7 12.0,48.3" fill="#ff5a5f"/>
  <circle cx="32" cy="32" r="3.2" fill="#ff7a55"/>
</svg>
```

- **Arm A** (top-left mouth to bottom-right base): `19.8,8.7 10.2,17.3 46.0,53.7 52.0,48.3`
- **Arm B** (top-right mouth to bottom-left base): `44.2,8.7 53.8,17.3 18.0,53.7 12.0,48.3`
- **Ember node**: circle cx 32, cy 32, r 3.2, fill `#ff7a55`.

## Small-optics rule

At raster tiers of 24px or smaller the ember would smear into the arm crossing,
so it **drops out and the arms carry the mark alone** (the #444 precedent). This
is a raster-generation rule: the 16px member of `favicon.ico` is stamped without
the node, while the live vector component keeps the ember on the `duo` and
`plaque` variants at every size (a vector never smears).

## Component

Implemented in `components/brand/PubmaxxMark.tsx`. Three variants, one API:

| variant  | fill                                          | use                                   |
| -------- | --------------------------------------------- | ------------------------------------- |
| `mono`   | `currentColor` arms, no ember, transparent    | inline in text, single-colour, stamps |
| `duo`    | coral arms + coral-bright ember, transparent  | wordmark lockup, on-surface badge     |
| `plaque` | ink-deep tile, coral arms, coral-bright ember | app icon, avatar, standalone tile     |

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

- Don't add a beer glass, foam, handle, or froth. The pints are the taper.
- Don't recolour the arms outside the token palette (coral / ink / currentColor).
- Don't rotate, skew, outline-stroke, or drop-shadow the mark.
- Don't stretch. Width and height stay equal.
- Don't place the `duo` or `mono` mark on a low-contrast surface; use `plaque`.
- Don't reintroduce the old X "Crossing" arms or the retired pint glyph.

## Static assets

`scripts/gen-brand-assets.mjs` stamps the **live** web assets from the geometry
above (the earlier staging plus copy dance is retired now that the Clink is
activated). Run `node scripts/gen-brand-assets.mjs`; it needs `sharp` (already a
dependency).

Live under `public/`:

- `favicon.svg`, `favicon.ico` (16 / 32 / 48 PNG members; the 16 uses the no-node
  small-optics cut)
- `icon-192.svg` / `icon-192.png`, `icon-512.svg` / `icon-512.png` (bare Clink)
- `icon-maskable.svg` / `icon-maskable-512.png` (ink-deep tile, mark inside the
  80% safe zone, rx 0 for the platform mask)
- `apple-touch-icon.png` (180px, coral Clink on ink-deep, iOS supplies its own
  corner mask)

A `public/brand/` reference mirror (plus `mark-mono.svg`) is refreshed by the
same run. The `?v=` cache-busting token on the `<head>` icon URLs (`app/layout.tsx`)
is bumped to `20260721-clink` on activation.

## Native app icons and splash

`scripts/gen-native-app-icons.mjs` writes the `@capacitor/assets` source images
into `assets/` (coral icon field with the ink Clink; a light coral splash and a
dark ink splash, mark centred). The canonical stamp step is
`npx @capacitor/assets@3 generate`, which fans them into `ios/` and `android/`.
When that tool cannot run in a sandbox (its bundled `sharp` binary fails to load),
the committed `ios/` and `android/` PNGs are re-stamped directly from the same
geometry with the hoisted `sharp`, reusing each launcher file's existing alpha
silhouette so the rounded-square and circle masks are preserved exactly.

## Follow-up (not in the activation lane)

Two surfaces still draw the old Crossing geometry and need their own sync:

1. `lib/ogBrand.tsx` `CrossingMark`, used by the dynamic `next/og` share cards
   (roughly 17 `opengraph-image.tsx` / `*-card` routes) and `public/og.png`.
2. The store-listing masters in `public/store-assets/` and their generator
   `scripts/gen-store-assets.mjs`, pinned by `__tests__/storeAssets.test.ts` to
   the canonical Crossing arm endpoints. Updating these means porting the Clink
   polygons into the masters and re-pinning that test.

Both were left untouched here so the activation lane stays scoped and the test
suite stays green; they carry the mark but sit outside the favicon / PWA / native
icon set this lane owns.
