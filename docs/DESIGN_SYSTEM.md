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
| **Dark** | **B Night Out** | Deep ink + coral CTA (`--brass`) + amber route (`--night-amber`) + muted pint green - **no purple glow** |

Field Guide jobs retained: `--river` / `--pint` / `--brick` stay semantic for
pins and prices. Coral owns the primary CTA in both themes; amber stays a
transport and price signal.

Messages follow their [scoped visual rule](rules/components-venue-plan-and-message-surfaces.md#a-thread-reads-like-a-conversation-and-its-composer-is-pinned-over-the-foot-of-t).
Where its surface and accent choices differ, that rule takes precedence.

Pointers: [`PRODUCT.md`](../PRODUCT.md) · [`DESIGN.md`](../DESIGN.md) ·
[`docs/design-explorations/`](./design-explorations/).

This document describes the token scale, type pairing, and pressed-ink
tactility that make that thesis hold. It **extends** the existing system in
`app/globals.css` (tokens, light theme) and `app/theme.css` (dark theme
overrides + shared theme-toggle chrome) — nothing here forks or replaces those
files, and every token that existed before this pass still resolves under the
same **name** (values may retune within the A/B decision).

## Where things live

Project and area rules govern every design task. `DESIGN.md` describes visual
intent and a token subset. This guide owns engineering conventions. CSS owns
runtime token values and theme overrides. Component code and tests establish
current behaviour. Investigate any mismatch with a rule.
`docs/VOICE.md` owns product copy.

Skills provide task procedures. A generic skill or its example must not replace
these owners, change the chosen fonts, or introduce new colours or motion rules.
Read only the skills needed for the task. Keep each decision in its owning file
and link to it from other documents.

| File | Owns |
|---|---|
| `PRODUCT.md` | Strategic brief: vocabulary, A/B lock, taste dials, anti-refs |
| `DESIGN.md` | Impeccable visual spec (colors, type, components, do/don't) |
| `app/globals.css` | `:root` token definitions (light/default values), sheet material, resets, shared press feedback, and the pressed-ink utility |
| `app/theme.css` | `html[data-theme="dark"]` token overrides, dark-first sheet material, active Plan fill, theme-toggle |
| `app/layout.tsx` | `next/font` wiring — loads the three type-trio fonts as CSS variables on `<html>` |
| `lib/springMotion.ts` + `lib/useSpringValue.ts` | Interruptible spring integration, reduced-motion jumps, and React animation ownership |
| `components/map/canvas/` + `lib/mapBasemapTaste.ts` | Scene marks and label ink read live tokens; the map-owned basemap palette and label hierarchy stay in `lib/mapBasemapTaste.ts` |

If you're adding a new component: reach for a token below before writing a
literal value. If the token you need does not exist, add it to the theme source
first, then document its non-obvious role here.

### Where each law is fenced

A design law here is not advice: each one has a test that fails when a surface
breaks it. This is the door - go to the fence to find out what a law actually
refuses, and add your assertion there rather than minting a second gate.

| Law | Where it is written | The fence |
|---|---|---|
| The token set a launch surface may paint with | Launch tokens, below; `app/globals.css` owns the values | `__tests__/designTokens.test.ts` |
| A text button is one row of `--control-*` tokens, and `button.css` sits outside every cascade layer | Launch tokens > Text buttons | `__tests__/buttonPrimitive.test.tsx`, `e2e/mobile-button-system.spec.ts` |
| A chip reads that same row, and a number square is ONE family across the planner and /pubs | Launch tokens > Text buttons; `components/ui/chip.css` | `__tests__/chipPrimitive.test.tsx`, `e2e/design-review-followups.spec.ts` |
| One painted primary per screen, a quiet row of at most two ways onward, and a form screen paints no head primary | `docs/design/LAUNCH_SCREENS.md` | `__tests__/coreUiAudit.test.ts`, `__tests__/launchPrimitives.test.tsx` |
| The accent as a WORD takes `--brass-ink`; opacity is never a muted token | Colour, below | `__tests__/accentInkContrast.test.ts` |
| Coral is spent twice, and since 1 Nov 2026 once (the one primary; the create disc is retired); a selection reads in `--state-selected-*`, a kicker in muted ink, a link in ink with an underline | Launch tokens > Coral is spent twice | `__tests__/visualDiscipline.test.ts`, `__tests__/coralEconomy.test.ts` (a count of resting coral that only goes down) |
| A pint price on a row or a card goes through `PriceBadge` / `PintPriceBadge` with its band; never a bare coloured number | Launch tokens > Status and price | `__tests__/onePriceLook.test.ts`, `__tests__/priceBandSurfaces.test.ts` |
| Monospace is for figures alone, never a label, nav or prose | Launch tokens > Monospace is for figures | `__tests__/visualDiscipline.test.ts` |
| A tab row is one tab stop: a roving `tabIndex`, the arrows, Home and End, and the selected tab in `--state-selected-*` ink | Spacing, radius, shadow > Tabs | `__tests__/tablistKeyboard.test.tsx`, `__tests__/visualDiscipline.test.ts` |
| A hue is never text on a tint of itself: the tint inks | Colour > A hue on a tint of itself | `__tests__/accentInkContrast.test.ts` |
| An icon draws at one of four sizes and at Lucide's own stroke | Spacing, radius, shadow > Icons; `lib/iconScale.ts` | `__tests__/iconScale.test.ts` |
| A media query cuts the screen at a named breakpoint, or at a measured figure in the allowlist | Spacing, radius, shadow > Breakpoints; `lib/breakpoints.ts` | `__tests__/breakpoints.test.ts` |
| The browser bar matches the page under it, in each theme | Day/night coherence; `lib/browserBarColor.ts` | `__tests__/browserBarColor.test.ts` |
| The map retry notice uses semantic ink for readable text in both themes | `.mapSoftRetry` in `app/globals.css` | `__tests__/mapSoftRetryContrast.test.ts` |
| A price wears its band and no other colour | `docs/PRICE_BANDS.md` | `__tests__/priceBand.test.ts`, `__tests__/priceBandSurfaces.test.ts` |
| The template-pattern ban list | `docs/VOICE.md` > Template patterns | `__tests__/templatePatterns.test.ts` |
| Copy voice: no em dash, British spelling, no hedge line | `docs/VOICE.md` | `__tests__/emDashLaw.test.ts`, `__tests__/frictionVoice.test.ts` |

Open design debt and raised design decisions live in
[`docs/design/BACKLOG.md`](./design/BACKLOG.md), never in a `docs/proof/`
directory: a proof records one finished measurement and nobody re-reads one.

### Tools for checking a page

Two outside references help a person check a page against this system. Both
are optional, and neither is a dependency of the app: nothing here installs,
loads or bundles them.

| Tool | Use it for |
|---|---|
| [Squints](https://squints.app) | A free Chrome extension for a live page: rulers, the gap between two elements, the colour and the font that actually rendered, a column grid and slow motion. Use it to check a change against the tokens below: a spacing step, a radius from the corner scale, a colour that is a token and not a literal, and an animation at its real pace. |
| [The Iconography Encyclopedia](https://encyclopedia.iconography.co) | A glossary of icon design terms (stroke weight, corner smoothing, boolean operations, naming). Use its words when you describe or review an icon. Icons still come from Lucide alone, at the scale under [Icons](#icons). |

### Optional DESIGN.md validation

For a structural check of the root specification, run the pinned Google tool:

```sh
npm exec --yes --ignore-scripts --package=@google/design.md@0.4.0 -- designmd lint DESIGN.md
```

Inspect warnings even when the command exits successfully. The tool checks
structured token references and declared component colour pairs. It does not
resolve contradictory prose, compare application CSS, or verify a rendered page.
The root specification is a token subset without component colour pairs, so a
clean result does not establish accessible UI contrast. Keep the existing tests
and browser checks. Do not export this subset over the application stylesheets.

## Launch tokens

The September 2026 relaunch (issue #1354) builds every launch surface from
this subset of `app/globals.css`. It is the whole vocabulary a new screen
needs, and it is closed: `__tests__/designTokens.test.ts` holds this list and
the file to each other, checks each token is declared, and holds the four
launch primitives in `components/ui/` (Kicker, TrustPill, EmptyState, Screen)
to these tokens and no hex, `rgb()` or foreign token.

**Surfaces.** The elevation ladder, recessed to overlay: `--panel`, `--paper`,
`--panel-raised`, `--panel-overlay`, and `--ink-deep` for inverse chrome. Their
semantic names are `--color-surface-panel`, `--color-surface`,
`--color-surface-raised`, `--color-surface-overlay`, `--color-surface-inverse`.

**Text.** `--ink`, `--ink-soft`, `--muted` as `--color-text`,
`--color-text-soft`, `--color-text-muted`. On a painted fill: `--color-on-accent`
(dark ink on coral), `--color-on-accent-strong`, `--color-on-inverse` (cream
on ink-deep), `--color-on-photo` (white on a scrim).

**Edges.** `--line`, `--line-soft`, `--hairline`, `--hairline-strong`;
semantic `--color-border`, `--color-border-soft`. Borders are for inputs,
hairlines for structure (see "Edges: the de-box rule").

**Accent.** One coral: `--brass` as `--color-accent` and `--accent-action`,
`--brass-bright` as `--color-accent-strong` and `--accent-action-strong`.
`--brass-accessible` is the login primary alone. A Screen paints exactly one
control with `--accent-action`; nothing else on that screen wears it. On the
venue sheet that control is the action card's plan door at every width
(`components/map/inspector/VenueActionCard.tsx`), so the Overview's price
door is drawn in ink beside it.

**Coral as a fill and coral as a word are two tokens.** `--brass` is 2.5:1 to
2.9:1 as TEXT on the light elevation ladder, below AA at every step, so accent
words take `--brass-ink` (`--color-accent-ink`) instead: a light-only deepening
that clears 4.78:1 on the recessed panel and 5.27:1 on the page. Dark keeps one
coral, because `--brass` already reads 5.3:1 to 6.5:1 there. A coral FILL is
unchanged and still carries `--color-on-accent`. `__tests__/accentInkContrast.test.ts`
holds the ratios and sweeps for a coral put back on a light word.

**Coral is spent twice.** A coral FILL (`--accent-action`, `--brass`) is the
ONE primary action per screen (the filled button), and nothing else. Its
second spend, the floating create disc, left with the five-tab dock (captain,
1 Nov 2026), and the rule keeps its name so the many places that cite it
still find it. A selection is not an action: an active tab, a
pressed chip, a chosen segment and the page you are on read in ink through
`--state-selected-surface`, `--state-selected-border` and
`--state-selected-ink`, never a coral fill or a coral tint. A suggestion chip
(the `/plan` describe chips, the tonight vibe chips) is a neutral outline on
`--hairline-strong`. A kicker or eyebrow is a label and takes
`--color-text-muted`, never coral. A text link is an ink word with an
underline (`--color-text`), never coral; `--brass-ink` stays only for the
rare coral word a primary's own label needs. `--state-active-*` stays the
"you are here" place marker, which is not a selection.
`__tests__/coralEconomy.test.ts` counts every resting coral declaration in
`app/` and `components/` outside a commented allowlist of primaries, focus
rings and the map key, and the count may only go down.

**Monospace is for figures.** `--font-data` sets prices, dates and times,
counts and codes, and nothing else. A label, a kicker, a footer heading or
link, the legal line, a nav row, a loader caption and a word chip such as
"Prices listed" are set in `--font-body`.

**Status and price.** `--pint` (`--color-positive`), `--amber`
(`--color-caution`), `--brick` (`--color-negative`), `--river` (`--color-info`).
A PRICE wears its band and nothing else (captain's law 2026-09-05,
`lib/priceBand.ts`, `docs/PRICE_BANDS.md`): `--price-band-cheap` (green),
`--price-band-average` (yellow) and `--price-band-expensive` (red) paint a
fill, and `--price-band-cheap-ink`, `--price-band-average-ink` and
`--price-band-expensive-ink` are the same hues deepened to read as text at
4.5:1 on the page and the card in both themes. They are applied through the
`.priceBand-cheap`, `.priceBand-average` and `.priceBand-expensive` class
family alone, which sets `--price-band-hue`, `--price-band-ink`,
`--price-band-surface` and `--price-band-border` on the element. A price with
no band, and every price that is not a pint, stays neutral on `--badge-surface`,
`--badge-border`, `--badge-ink`. Trust (confirmed, listed, estimated, logged
once, aged) is a word, a badge or a pin shape, never a tone: no surface may
colour a standing. `--accent-price` and `--accent-price-ink` remain the brass
plaque for non-price metal (the zone strip's frame, a history row) and are not
a price colour. Counts and metadata take the neutral badge trio. "You are here"
is `--state-active-surface`, `--state-active-border`, `--state-active-ink`.
"This one is chosen" is `--state-selected-surface`, `--state-selected-border`,
`--state-selected-ink`.

**Type.** Three faces: `--font-display`, `--font-body`, `--font-data`. Nine
sizes: `--text-2xs`, `--text-xs`, `--text-sm`, `--text-base`, `--text-md`,
`--text-lg`, `--text-xl`, `--text-2xl`, `--text-3xl`. Leading `--leading-tight`
(display), `--leading-snug` (cards), `--leading-normal` (body). Tracking
`--tracking-tight` on display sizes only. Sentence case everywhere but a stamp.

**Space and measure.** `--space-1`, `--space-2`, `--space-3`, `--space-4`,
`--space-5`, `--space-6`, `--space-8`, `--space-10`, `--space-12`.
`--page-gutter` is the one horizontal inset;
`--content-max` the reading column; `--content-max-wide` the page.
Both Pub Pal meeting and returning pages use the page cap and shared gutter.
`e2e/page-centering.spec.ts` checks their balanced margins and horizontal overflow.

**Shape and depth.** `--radius`, `--radius-sm`, `--radius-lg`, `--radius-pill`
and `--control-radius` for buttons and control chips. `--shadow`,
`--shadow-sm`. No other shadow, no glow.

**Text buttons.** `components/ui/button.tsx` is the primitive and
`components/ui/button.css` paints it from the `--control-*` row (height, side
padding, type size and weight, radius, the two secondary surfaces). That sheet
sits outside every cascade layer on purpose: `app/globals.css` resets
`button { font: inherit }` unlayered, and an unlayered declaration outranks a
layered utility whatever the order, which is how a Tailwind `text-sm font-bold`
on the primitive rendered as 16px at weight 400. A bespoke text button reads
the same tokens rather than restating a figure.

The native `Button` path uses `components/ui/ready-button.tsx` and
`lib/useClientReady.ts`. The `asChild` path keeps Radix `Slot` and the
child's native element. The [control guide](../README.md#features) owns
user-facing readiness and navigation feedback.

**Chips.** `components/ui/chip.tsx` is the primitive and
`components/ui/chip.css` paints it, outside every cascade layer for the reason
the text button's sheet is: a chip is a control, so it reads the same
`--control-*` row. Two variants and no third: `pill` is a word you tap and
`number` the square a reader taps a figure on, which the planner's pub-stop
count and the `/pubs` fare-zone picker both render.

**Motion.** `--duration-fast`, `--duration-base`, `--duration-slow`;
`--ease-out` for colour, `--ease-out-strong` for entrances; `--press-scale` on
press. Every animation sits behind the reduced-motion contract.

**Stacking.** `--z-float`, `--z-nav`, `--z-tabbar`, `--z-modal`,
`--z-overlay-top`. Never a literal.

The four primitives: `Kicker` is the sentence-case line above a heading;
`TrustPill` is a pure renderer over the one standing `lib/priceTier.ts`
decided, and it says that standing in WORDS: confirmed (with its day), listed,
estimated (which prints `est. £X` and offers its method) and no price yet. Its
only colour is the price band of the figure it prints (`lib/priceBand.ts`,
captain's law 2026-09-05), so a pill with no figure is neutral;
`EmptyState` is a title, one line and at most one quiet way onward; `Screen` is
kicker, heading, one painted primary and at most one secondary, in that order at
every width. The screen table is `docs/design/LAUNCH_SCREENS.md`.

The map has a deliberate style-layer contract. Dark mode uses a neon-noir
near-black field with slate water and restrained roads; light mode is a calm
map for price pills (launch plan, 1 November 2026): warm near-grey ground,
white roads whose rank is their width and grey casing, a pale sage park, a
grey-blue river and grey labels, and no price-band hue anywhere on the ground,
so the only colour on a light map is a price. Pub marks lead the hierarchy: basemap pub POI
labels are prominent, generic venue-label layers receive the same priority,
neighbourhood labels are smaller and quieter, and road labels remain
contextual. This pass changes palette and label paint/layout
only; it does not add `pubs-hero-glow` or `pubs-confidence-ring` layers. The
implementation and absence checks live in `lib/mapBasemapTaste.ts` and
`__tests__/mapSymbolCollision.test.ts`.

## Colour

### Palette roles

DOM token values and the deliberate map/root versus DOM/body split live in
`app/globals.css` and `app/theme.css`. Map style-layer values and derivations
live in `lib/mapBasemapTaste.ts`; the stable token roles are:

| Token family | Role |
|---|---|
| `--ink`, `--ink-soft`, `--muted` | primary, secondary, and tertiary text |
| `--line`, `--line-soft`, `--hairline` | map-aware and DOM structural edges |
| `--paper`, `--panel`, `--panel-raised`, `--panel-overlay` | page-to-overlay elevation ladder |
| `--ink-deep` | inverse and stamp-dark chrome |
| `--brass`, `--brass-bright` | Plan CTA and identity accent |
| `--brass-accessible` | login primary only - deepened coral that carries a white label at AA |
| `--brass-ink` | coral as a WORD on a light surface - light-only deepening so accent TEXT clears AA; dark keeps `--brass` |
| `--tint-ink-accent`, `--tint-ink-positive`, `--tint-ink-caution`, `--tint-ink-negative`, `--tint-ink-info` | a hue as a WORD on a TINT of itself - see "A hue on a tint of itself" |
| `--pint`, `--amber`, `--brick` | price and status semantics |
| `--river`, `--river-bright` | heritage and by-water information |
| `--route-line` | the crawl route on the map, the key and the plan strip, and the walk of a way chosen in Night Mode. It is drawn thick on its own paper edge (dark: ink edge), like directions in a maps app. A ride on that way wears its own TfL line colour, never this token |

**One accent owns the CTA in both themes.** Coral (`--brass`) carries actions;
amber (`--night-amber`) stays a route and price signal. Every other hue (`pint` / `amber` /
`brick`, `river`) is a semantic status/category colour — don't reach for them
to "add colour" to something that isn't a price band or a heritage/by-water
marker.

### A hue on a tint of itself

**A hue is never text on a tint of itself.** A source badge, an era chip, a
provenance stamp and a pressed icon chip all print the hue they mean as a word
on a 7 to 20 per cent tint of that same hue. That measures 2.1:1 to 4.4:1 in
light and 4.4:1 in dark, so `/pubs` shipped 24 chain-source badges at 3.75:1 —
the one axe finding in the 17 September 2026 sweep — with a Young's badge at
2.25:1 and a Greene King badge at 2.75:1 latent behind them.

No ladder ink fixes it. `--brass-ink` is tuned against `--paper`, `--panel` and
`--panel-raised`, and on a 12 per cent coral tint of the recessed panel it is
4.25:1. `app/plan/plan.css` already derived a local answer twice (`--fit-ink`
and `--plan-stamp-ink`, the hue deepened toward `--ink` per theme); the
**tint inks** are that derivation promoted to the token layer, one per semantic
hue, so the next badge reads a token instead of inventing a percentage:

```
--tint-ink-accent     the coral  (--brass)  as a word on a coral tint
--tint-ink-positive   the green  (--pint)   as a word on a green tint
--tint-ink-caution    the amber  (--amber)  as a word on an amber tint
--tint-ink-negative   the red    (--brick)  as a word on a red tint
--tint-ink-info       the blue   (--river)  as a word on a blue tint
```

Only the ink moves: the paired SURFACE keeps whatever tint it chose. Light
deepens the hue toward `--ink` and dark lifts it toward the pale ink, because
the tint under it is a near-black surface. Each clears 4.5:1 against the worst
pair in the tree (a 20 per cent tint on the recessed panel in light, on the
overlay in dark) in both themes.

The accent's is derived from **`--brass-ink`, not raw `--brass`**. `--brass-ink`
is warmed to hue 12 against `--brick`'s 356 on purpose, because a price wears
its band and no other colour and a coral word must not read as "expensive"; a
straight mix of `--brass` and `--ink` lands on hue 357, which *is* brick's hue,
so the chain badges and the Pint Index pill would have printed in the crimson
the expensive band owns. `__tests__/accentInkContrast.test.ts` holds the two at
least 10 degrees apart in light. Dark separates the same pair by chroma and
lightness instead, so the rule is a light-theme one.

The other four sit close to their own band's ink by construction - they are the
same hue deepened the same way - and that is fine: what stops a chain badge
reading as a price is the tint under it, not the ink over it. They are still a
**separate row**, and a badge may not reach for a `--price-band-*-ink`.

`__tests__/accentInkContrast.test.ts` holds the shipped ratios and sweeps every
stylesheet under `app/**` and `components/**` except the two token owners
themselves (`app/globals.css` and `app/theme.css`, which the token assertions
in that same file cover), resolving each rule's own `color`-over-`background`
pair through `var()` and `color-mix()` in both themes against the surfaces the
DOM really paints - the `body` remap, not the `:root` values the map reads.
Two shapes it cannot see stay with `e2e/a11y-core-journeys.spec.ts`: a rule that
declares no background of its own, and a translucent fill whose composite
depends on an ancestor.

### Semantic roles (new — additive aliases)

Raw palette tokens describe *hue*; semantic tokens describe *job*. New work
should prefer the semantic name so a future palette change (e.g. retuning
`--brick`) propagates without hunting down every consumer:

```
--color-accent            → var(--brass)
--color-accent-strong     → var(--brass-bright)
--color-accent-ink        → var(--brass-ink)
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
--input-placeholder       → var(--muted)
--color-border            → var(--line)
--color-border-soft       → var(--line-soft)
```

### Text on painted fills

A handful of places set text colour on an **accent fill** (a brass button or
gradient, an ink-deep button, a photo-caption scrim) rather than a page
surface. Use these roles instead of a raw hex. Regular brass brightens in dark
mode, so its text role flips with the theme; inverse, strong-accent, and photo
fills keep fixed text colours. Exact values live in `app/globals.css` and
`app/theme.css`.

```
--color-on-accent          theme-aware text on regular brass
--color-on-inverse         cream text on solid ink-deep
--color-on-accent-strong   dark text on coral or brass-bright
--color-on-photo           white text on a photo-scrim overlay
```

The `/login` primary and the magic-link button are the one coral fill that
carries a **white** label (`--color-on-photo`). They paint `--brass-accessible`,
a deepened coral, because `--brass` under white is below AA. It is not a second
site-wide primary: the landing hero CTA and the map's sanctioned coral marks
stay on `--brass` with dark ink. `app/globals.css` owns the rationale beside the
token. `e2e/login-page.spec.ts` measures rendered label contrast at rest and on
hover in both themes, with a 4.5:1 minimum.

## Type

### The trio

| Role | Typeface | Variable | Why |
|---|---|---|---|
| Display | **Space Grotesk** (variable weight, 300–700) | `--font-display` (aliased by `--serif`) | A modern geometric grotesque with a **very large x-height**, chosen for a Gen-Z-native voice. The big x-height keeps capitals and lowercase close in size, so there is little caps-contrast and headlines read confident and current rather than shouty. Its quirky terminals give it character without tipping into gimmick. This **supersedes the earlier Fraunces "field-guide serif"** thesis — the brand is now a display sans, not hand-set serif. Open-licence, self-hosted via `next/font/google` without a browser request to Google. |
| Body | **Inter** | `--font-body` | Already the app's body face — kept deliberately. Inter is neutral and extremely legible at small UI sizes (panel copy, chip labels), which is exactly what a body face should be: carry the display face's personality without competing for it. |
| Data | **JetBrains Mono** | `--font-data` | Figures only: prices, dates and times, counts, codes. Never a label, nav or prose (Launch tokens > Monospace is for figures). A monospace gives numerals a "stamped ticket / till receipt" character that Inter's tabular figures don't — it's a deliberate second texture, not just a bolder body font. Paired with `font-variant-numeric: tabular-nums` so columns of numbers align. |

All three are loaded once in `app/layout.tsx` and exposed as CSS variables
on `<html>`: Space Grotesk and Inter via `next/font/google`, and JetBrains Mono
via `next/font/local` from its vendored file in `app/_fonts/`.
The display and body variables also receive their generated `style.fontFamily`
chains inline on `<html>`, preserving their metric-matched fallbacks against theme overrides.
Components read the shared variables without per-component font imports.
Cascade coverage is in `__tests__/rootFontCascade.test.tsx` and
`e2e/root-font-cascade.spec.ts`.

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
- the passport seal (`.passportSeal`, the bordered PUBMAXX stamp); the
  `.passportKicker` beside it is a plain label, so it is sentence case
  (taste plan, 18 Oct 2026)

If a label is plain text with letter-spacing (an eyebrow, a section title, a
stat `dt`), it is sentence case. If it's a chip with a border/fill that reads
as a stamp, it may keep caps.

### Type scale

```
--text-2xs   0.68rem     eyebrows, micro-labels (0.75rem in the native shells)
--text-xs    0.76rem     chip/tag text
--text-sm    0.85rem     secondary body copy
--text-base  1rem        default body
--text-md    1.16rem     h3 / card titles
--text-lg    1.42rem     h2
--text-xl    1.74rem     h1 / section heroes
--text-2xl   2.13rem     page-level display
--text-3xl   2.6rem      landing hero only
```

Inside the iOS and Android shells, `html[data-native-shell]` raises `--text-2xs`
to 0.75rem, which is 12px at the default text size. There it sits close to
`--text-xs` on purpose: on a phone a micro-label must stay legible, and that
wins over the step between the two sizes. The web keeps the stepped scale.

```
--leading-tight   1.12   display headlines
--leading-snug    1.35   card copy
--leading-normal  1.5    body paragraphs
--tracking-tight  -0.01em  large display type (Space Grotesk headlines)
--tracking-wide   0.05em   legacy; sentence-case labels now use ~0.01em
--tracking-wider  0.08em   legacy (all-caps titles are retired — see caps policy)
```

Shared type-role utilities live in `app/globals.css`. High-impact surfaces use
those roles or a local responsive clamp where the layout needs one; new type
decisions should extend the same hierarchy rather than add another peer-sized
heading.

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
--radius        8px      default corner (cards, inputs)
--radius-sm     6px      tight corner (descriptive chips and pills)
                         A TEXT BUTTON OR CONTROL CHIP TAKES --control-radius
                         (the role token, = --radius 8px), never this - see
                         Launch tokens > Text buttons. Four sizes, no 14px.
--radius-lg    18px      sheets / bottom-drawer corners
--radius-pill 999px      pills, avatar-style chips
```

### Breakpoints

The screen is cut at five named widths and nowhere else. `lib/breakpoints.ts`
(`BREAKPOINTS`) owns the figures. This build has no `@custom-media`, so a
stylesheet writes the figure by hand, and `__tests__/breakpoints.test.ts`
fails a `@media` width in `app/` or `components/` that is not in this table
or in the test's commented allowlist. Each boundary is one line: the narrow
side reads `max-width`, the wide side `min-width` one pixel up.

| Name | Narrow side | Wide side | What changes there |
|---|---|---|---|
| `phoneSmall` | `max-width: 360px` | `min-width: 361px` | The smallest phones squeeze a row; nothing is redesigned. |
| `phone` | `max-width: 640px` | `min-width: 641px` | The tab-bar boundary: at or under 640 the bottom tab bar owns navigation. `MOBILE_MEDIA_QUERY` reads it. |
| `tablet` | `max-width: 900px` | `min-width: 901px` | Single-column page layouts end; side columns start. |
| `desktop` | `max-width: 1023px` | `min-width: 1024px` | The sticky desktop rail, the map's docked venue drawer and the two-column Tonight, Crawls and Historic layouts. |
| `wide` | `max-width: 1279px` | `min-width: 1280px` | Extra columns and the roomier hero; the full site-nav row. |

A rule for "a narrow phone" takes `phone`, not a figure between 360 and 640.
A width kept outside the set (the map's 768 sheet band, the site nav's 767
row, the landing hero's 960 and the map's 1371 zoom lane) is measured, and
its reason is written beside it in the allowlist. The allowlist only shrinks.

### Shadow: neutral depth (dark) and paper-lift (light)

`--shadow` and `--shadow-sm` use the values in the theme stylesheets.

- **Light (`app/globals.css`):** Warm brown drop shadows over Candle Coral paper.
- **Dark (`app/theme.css`):** Black drop shadows, a dark outline, and a faint white inset highlight. No amber bloom.

`--shadow-inset-press` uses a dark inset edge and a white inset highlight in
both themes. The theme values change their opacity for the surface behind them.
Use these shared tokens instead of adding a new glow.

### Edges: the de-box rule

**Borders are for inputs. Fills are for selection. Hairlines are for
structure. Nothing else gets an edge.**

A border is a strong signal, so it has one job: it says "type into me" or
"pick from me". Anything that is not an input earns its grouping some other
way, and the choice is made in this order:

1. **A fill.** This is how selection reads. A selected control takes
   `--panel-raised` with `--ink` text; an unselected one takes no fill at all
   and `--muted` text. Never invert that: an unselected control drawn louder
   than the selected one tells the eye the wrong thing.
2. **A hairline.** `--line-soft` divides list rows and separates the segments
   inside one control. A group of segments wears at most ONE edge, around the
   group, never one per segment.
3. **Spacing.** A heading with controls under it is already a section. It does
   not need a card.
4. **Nothing.** Most containers are in this row.

Coral (`--brass`) is not a selection colour. It belongs to the primary CTA;
an active tab reads in `--state-selected-*` ink, and the selected pin on the
map is a solid ink price pill or an ink ring. See Launch tokens > Coral is
spent twice.

Two traps this repo has hit:

- **This app ships no Tailwind preflight.** A `<button>` with no explicit
  `border`/`background` inherits the user agent's `2px outset buttonborder` on
  `buttonface`. Every new button primitive must set `border-0 bg-transparent`
  at its base, or it draws the heaviest chrome in the app for free.
- **The global `:focus-visible` rule sets `border-radius: var(--radius-sm)`.**
  A round control has to restate its own radius on focus, or it squares off the
  moment it is focused. Prefer `outline-offset: -2px` on anything already
  inside a bordered group, so focus marks the control rather than building a
  second shape around it.

`__tests__/deBoxSegmentedControl.test.ts` pins the segmented-control half of
this. Origin: design judgement 2026-08-01, findings 2.4, 2.5, 2.13 and 2.16.

### Tabs

A tab row is a selection, so it follows the two laws above: the selected tab
reads in ink and the group wears at most one edge. Seven rows ship today: the
venue sheet's sections, the `Tabs` primitive (`components/ui/tabs.tsx`), the
sign-in doors, the Social feed axis, the soft-drink chips, the admin sections,
and the phone tab bar, which is navigation (links with `aria-current`) rather
than a tablist.

- **Selected.** `--state-selected-surface`, `--state-selected-border` and
  `--state-selected-ink`, or the raised segment fill every segmented control
  shares, plus a weight step so colour is never the only cue. Never a coral
  fill, a coral tint or a category hue.
- **Keyboard.** The row is ONE tab stop. The selected tab carries
  `tabIndex={0}` and the rest `-1`; Left and Right move and wrap, Home and End
  jump to the ends. A hand-rolled row calls `moveTablistFocus` from
  `components/ui/tabs.tsx` rather than restating the arithmetic. A row whose
  every choice is a route push or a fetch passes `{ activate: false }`, so the
  arrows move focus and Enter or Space chooses. With nothing selected, the
  first tab holds the stop.
- **Focus.** The accent outline stays (a focus ring is an affordance, not a
  resting mark), drawn at `outline-offset: -2px` inside a bordered group, and
  a pill restates its own radius under `:focus-visible`.

**The phone tab bar is the pressed rail.** The dock is a raised mat with one
hairline and one soft drop, and the page you are on is a WELL pressed into it,
which glides between tabs in the single-row layout: `--state-selected-surface` with a shadow under its
top lip and a lit lower lip, the glyph sitting one pixel down. At night the
well is a darker recess (`app/theme.css`), because pressed ink reads as shadow
on a near-black rail. It is the bar-mat tactility spent on structure, never a
second stamp: no tilt, no coral at rest. The well's radius is the rail's minus
`--tab-inset`, so the two curves stay concentric at every width; glyphs are
20px in a 22px box over the 11px label floor, idle words at 600 and the
current page at 750. The [primary row rule](rules/components-sheets-chrome-and-navigation.md#the-primary-row-is-five-doors-and-the-header-carries-only-what-has-something-beh) owns the five tabs and the foot clearance, and the [Pal door rule](rules/components-sheets-chrome-and-navigation.md#the-pub-pal-is-a-door-in-the-top-bar-and-on-the-map-edge-never-a-tab) owns where the Pal sits now that it has left the dock.
Before and after: `docs/proof/tab-bar-pressed-rail/`.

`__tests__/tablistKeyboard.test.tsx` sweeps every `role="tab"` under `app/`
and `components/` for the roving index and the key handler, and
`__tests__/visualDiscipline.test.ts` names each row's selected rule.

### Sheet material

Sheets and drawers use one translucent neutral material over the map, with
layered micro-shadows and a solid fallback for reduced transparency, increased
contrast, or missing backdrop-filter support. `app/globals.css` and
`app/theme.css` own the material roles; map and mobile sheet styles only consume
them. This is a functional depth cue for movable overlays, not permission to
add decorative glass elsewhere.

### Icons

One icon set (Lucide) at one scale, written down in `lib/iconScale.ts`:
14 beside small text (meta lines, chips, captions), 16 beside body text and
inside a labelled button, field or heading, 20 for an icon alone in a control
(close, overflow, header and tab bar icons) and 24 for the few large controls
(full-screen viewer chrome). Every icon keeps Lucide's own
stroke of 2 and passes no `strokeWidth`: at 14 and 16px it draws the same stem
as the Inter beside it, where 1.75 drew thinner than the words. A selected tab
reads by its ink, its label weight and the gliding well, not by a heavier
stroke. The only icons off the scale are the named display marks in that file,
glyphs that stand in for a picture or open an empty state.

## Motion

CSS duration and easing tokens in `app/globals.css` own hover, focus, ambient,
and pointer-down feedback. They do not own sheet travel.

`lib/springMotion.ts` owns bounded spring integration and momentum projection.
`lib/useSpringValue.ts` owns animation frames, interruption, retargeting,
cleanup, and reduced-motion jumps. Phone sheets animate real height to preserve
sticky-footer geometry; tablet drawers use vertical translation; wider desktop
drawers use horizontal translation. Direct drag remains one-to-one and release
velocity carries into the settling spring.

Shared non-map press feedback is a low-specificity base layer. Components with
their own positioning transform keep local ownership and neutralise the shared
scale through the documented custom-property seam in `app/globals.css`.

## Stacking (z-index)

Never write a literal `z-index` in app/component CSS — use the semantic ladder
defined in `:root` in `app/globals.css` (`--z-float` 50 → `--z-overlay-top`
1300, with the map's internal ladder `--z-map-base` 450 … `--z-map-toolbar`
560 in between; see the token block for the full list with per-token comments).
Contextual push cards use `--z-context-prompt` (1320), above map sheets (1300)
and below the primary dock (1350). They stand down while a strict modal owns focus.
Each token's value equals the literal it replaced, so adopting one is never a
stacking-order change. If two overlays must NOT tie, they get separate tokens
(e.g. `--z-map-route-chip` sits under `--z-map-chip`). Map status news uses
`--z-map-hover`, below route stop panels and modal scrims. Component-internal
stacking (0–20, local stacking contexts) stays as literals.

**Rule:** CSS animation belongs behind the reduced-motion media contract in
`app/globals.css`; JavaScript animation must read the same preference and jump
to its target. Static price-stamp tilt is a shape, not travel, and remains
visible in reduced motion.

## Pressed-ink / bar-mat tactility

The price stamp, provenance chips, and vibe tags should feel like something
**physically stamped** - pressed ink on a bar mat - not a generic rounded
badge. `app/globals.css` owns the utility and plaque roles.

`components/PriceBadge.tsx` owns the DOM price signature. Feed, borough,
venue, mobile peek, and recap surfaces compose that component instead of
restating its border, surface, type, or tilt. MapLibre cannot render the DOM
component, so `components/map/canvas/tokens.ts` resolves the same plaque roles
and `buildScene.ts` applies them inside the existing collision-indexed symbol
layers.

Word-based provenance and vibe chips may use the flat pressed treatment, but
the tilt remains price-only.

## The signature element

**One thing held with restraint: the brass price stamp.** It's the only
place the press-tilt (`.ink-stamp--tilt`) treatment should appear. The
candle-lit map is the second memory hook (see `components/map/canvas/`), but it is a
*mode*, not a stampable UI element, so it doesn't compete with the price
stamp for the "one signature" slot.

Do not add a second tilted/stamped element elsewhere in the UI. If a new
surface needs emphasis, reach for weight, size or ink, not coral and not a
second signature gesture (see "Coral is spent twice").

## Day/night coherence

**The night is dark by default.** A reader who has not chosen a theme gets
the dark theme from 21:30 to 03:59 London time, and the OS decides the rest
of the day. A stored choice from the theme control always wins. The rule is
`resolveThemePreference` in `lib/themePreference.ts`, and
`public/theme-init.js` applies the same rule before first paint (it keeps its
own copy of the two times, held to the module by
`__tests__/themeNight.test.tsx`). `components/ThemeAttribute.tsx` asks again
every minute and when a tab comes back, so an open page turns dark at 21:30
and light at 04:00. A tap on the theme control is the reader's choice even
when storage refuses to keep it, and the night rule stands down for the rest
of that page's life. `html[data-night-theme="1"]` marks a page that is dark
because of the night rule rather than a choice.

Both themes flip from the same token names — `app/theme.css` only
overrides values inside `html[data-theme="dark"]`, never introduces new
variable names. The map token reader in `components/map/canvas/tokens.ts`
reads current computed values for semantic scene marks and label ink. The
basemap style-layer palette remains deliberately map-owned in
`lib/mapBasemapTaste.ts`, where the dark and light map contracts stay together.

This pass audited `app/globals.css` and `app/theme.css` for literals that
bypassed this: it found six repeated instances of hardcoded cream/dark text
sitting on solid brass/ink-deep fills (now `--color-on-accent` /
`--color-on-inverse` / `--color-on-accent-strong`), and two card gradients
(`.writerCard`, `.landlordAnswer`) whose end-stop was a fixed light-cream hex
that would have gone bright and jarring against the dark theme's charcoal
surfaces — both now resolve via `--surface-tint-river` /
`--surface-tint-brass`, `color-mix()`-derived from `--panel-raised` so they
stay in the current theme's tonal range automatically.

The browser bar follows the same rule. `<meta name="theme-color">` paints the
light page floor (`#f8f2ec`) under a light OS appearance and the dark page
floor (`#0a0a0b`) under a dark one. The root layout's viewport reads them from
`lib/browserBarColor.ts`, and `public/manifest.webmanifest` repeats the light
one, held to it by the fence. It used to
paint near-black in both, so a light page sat under a black strip.

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
- Route new CSS and JavaScript animation through the reduced-motion owners
  described above.
- Add a new token to the theme source before inventing a one-off value.

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
- Don't add decorative glassmorphism. Translucency is limited to movable
  sheets/overlays and narrow functional floating chrome.
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
