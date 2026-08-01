# Design judgement: pubmaxxing.com, 1 August 2026

Scope: the live site, over the network. Phone first at 390x844, dark theme first.
Then desktop at 1440x900. Every claim below has a screenshot in
`docs/design-judgement-2026-08-01/`. Every ratio below was measured on the live
DOM with computed styles, not read from the source.

Standards applied: the `apple-design` and `emil-design-eng` skills, the
`improve-animations` audit playbook, plus this repo's own `DESIGN.md`,
`docs/DESIGN_SYSTEM.md`, `PRODUCT.md` and `docs/VOICE.md`. Where the live site
breaks its own written rules, I say so, because those are the cheapest wins:
the taste already exists on paper.

---

## 1. The verdict

The captain is right. The site is built from bordered containers at one volume,
so no surface tells you what matters first, and the one colour that should mean
"act here" is spent on chips, badges, base pins, rings and tabs until it means
nothing. The single most wrong thing: the map, the product itself, is buried
under three stacked bars of boxed chrome and a swarm of identical coral marks,
while its primary action text fails contrast at 2.91:1 in both themes.

Counts: **16 actively bad**, **11 mediocre**, **7 genuinely good**.

---

## 2. Actively bad

### 2.1 Coral means everything, so coral means nothing

Screenshots: `04-map-phone-dark-first.png`, `15-map-phone-dark-nearme-state.png`,
`41-map-desktop-dark.png`.

On one phone map screen, coral (`--brass #ff5a5f`) is at once: the Near me
chip fill, four of five category chip fills, the Tonight and Filters badge
dots, the TfL badge, the active Map tab, the Moment tab ring, every base-layer
pin ring (dozens per screen) and the selection ring. `DESIGN.md` names the One
Accent Rule: coral owns Plan actions and selection, nothing else. The live map
uses it as wallpaper. A user cannot find "what do I tap next" because
everything answers.

**Fix.** Coral survives in exactly three places on the map: the primary CTA
("Describe your night" / "Plan tonight"), the selected pin ring, and the active
tab glyph. Category chips become neutral: selected = `--panel-raised` fill +
`--ink` text + 1 tick, unselected = ghost with `--line` border. Base-layer
unpriced pins drop to a desaturated neutral (`#6b5f57` family at 60%
opacity), never brand coral. Badge counts become `--ink` on `--panel-raised`.

### 2.2 Primary action text fails contrast, measured, both themes

Screenshots: `04-map-phone-dark-first.png`, `22-map-phone-light.png`.

Measured live: the Near me chip renders cream `rgb(253,250,242)` on coral
`#ff5a5f` = **2.91:1** at 12.5px/400. The category chips render the same cream
at 11.2px/800 on the same coral family. In light theme the active tab label is
coral on the cream tab bar = **2.91:1** at 11px/700. The earlier audit's 2.92
finding is alive on production. `DESIGN.md` itself specifies "fixed dark label
ink for AA contrast" on coral, and the landing CTA obeys it; the map chrome
does not.

**Fix.** Use the existing `--color-on-accent-strong` (dark ink) for every
label on a coral fill, exactly as the landing "Find my pint" already does.
For the light-theme active tab, pair the coral glyph with an ink label, or
darken the label to `#c93a3f` (4.6:1 on `#faf8f5`).

### 2.3 Three stacked chrome bars bury the map on a phone

Screenshot: `04-map-phone-dark-first.png`.

Header pill, then the Near me / Tonight / Filters row, then a full-width
category bar. With the bottom "Describe your night" pill and the tab bar, the
map keeps roughly half of an 844px screen, and the top third is three separate
grey rounded containers stacked with three different heights and paddings.
Apple's wayfinding test ("where am I, what can I do") drowns: nine controls
before the first pin.

**Fix.** One top bar. Category toggles move into the Filters sheet, which
already duplicates them as "Show me" (`16-map-phone-dark-filters.png` proves
the duplication). Near me becomes a round FAB on the map edge, standard map
grammar. Target: map owns 75% of the viewport at rest.

### 2.4 Everything a box: the filters sheet is the exhibit

Screenshot: `16-map-phone-dark-filters.png`, `17-map-phone-dark-filters-bottom.png`.

One screen of the "Prices and places" sheet shows nineteen bordered rounded
containers: a bordered section card, three bordered toggle buttons, six
bordered drink boxes, seven bordered fare-zone squares, three bordered amber
zone-price boxes. Every border is the same 1px, every fill near-identical, so
nothing ranks. This is the captain's complaint in one frame.

**Fix, concrete.** Borders are for inputs and for nothing else. Drink
categories: glyph + label, no container; selected gets a `--panel-raised` fill
only. Fare zones: a single segmented control with interior hairlines, not
seven boxes. Zone price summary: plain text rows with a mono figure, divided
by `--line-soft` hairlines. Section headers: sentence case, no card. The
whole sheet needs at most two visible borders.

### 2.5 Map controls sheet: selection reads inverted

Screenshot: `20-map-phone-dark-more-menu.png`, `22-map-phone-light.png`.

The Key / Layers / Prices / Events / Transit segmented row draws the
unselected segments lighter and louder than the selected one. Unselected =
light grey fill, selected = dark fill. The eye reads the four wrong tabs as
active. In light theme all five get hard 2px near-black borders, the heaviest
chrome anywhere in the app, on a utility sheet.

**Fix.** Selected = filled `--panel-raised` + `--ink` text. Unselected = no
fill, `--muted` text, no border. One shared hairline around the group at most.

### 2.6 Phone search overlay overflows the viewport

Screenshot: `07-map-phone-dark-search-results.png`.

At 390px the search field and the results panel render wider than the screen.
The distance column ("2.6", "2.8"...) is cut at the right edge, the field
itself runs off-screen, and the map behind zooms out to the whole city for no
reason the user asked. Meanwhile the input draws a coral ring inside a second
coral ring (double border), and shows two X buttons side by side, clear-input
and close-search, visually identical.

**Fix.** Panel width: `calc(100vw - 2 * gutter)`. One focus ring
(`--brass`, 2px, outer only). One X inside the field; close-search becomes a
"Cancel" text button or the scrim tap. The camera does not move when a
keyboard opens.

### 2.7 Near me fails silently and the map lies about where you are

Screenshots: `15-map-phone-dark-nearme-state.png`, `24-near-phone-dark-after-find.png`.

Tap Near me with no permission and the chip quietly renames itself to "Try
near me". No message, no state, the camera stays where it was. The known
Victoria bug compounds it: `showNearbyMap` passes every venue in London to
`fitNearby`, so the chip and list can be right while the camera frames
Piccadilly. How it feels: the app claims to know where you are and shows you
somewhere else, which spends the exact trust the price ledger works to earn.
The `/near` page handles the same failure honestly ("Location's off, so
here's central London. Not your patch?"), so the good pattern already exists
on an adjacent surface. Three review branches (`fix/map-nearme-honesty`,
`fix/map-area-picker-reach`, `fix/map-location-honesty`) sit unshipped.

**Fix.** Ship the honesty branches. The chip never renames itself as the only
signal; a one-line toast states the situation in `/near`'s register. And fix
`maxCount` so the camera frames the venues the sheet claims.

### 2.8 The Plan flow dead-ends on the happy path

Screenshots: `30-plan-phone-dark-result.png`, `31-plan-phone-dark-route.png`,
`32-plan-phone-dark-route-s2.png`.

Soho, Evening, everything else skipped, tap "Plan my night": the first
response is an amber box saying "This route needs a refresh. Context changed,
so the preview may no longer fit the night you described." No route ever
existed. "Context changed" is plumbing (VOICE.md rule 2). Tap "Regenerate
route" and the failure arrives twice on one screen: once grey under THE
CRAWL, once bold red below "Add another stop", same sentence. Above them sits
"4 higher confidence · 16 with warnings", numbers with no nouns. The
five-step intake ends in a wall.

**Fix.** Never show refresh state before a first result. One failure message,
once, in voice ("Soho's not giving us three good stops tonight. Widen the
patch or drop a must-have."), with the two actions it names. Kill the
confidence/warnings line or translate it into a sentence a drinker can use.

### 2.9 Empty coral rings scattered across the map read as render bugs

Screenshots: `05-map-phone-dark-soho.png`, `13-map-phone-dark-nearme.png`,
`41-map-desktop-dark.png`.

Dozens of glyphless coral circles float over Soho and Mayfair, some paired and
overlapping, none labelled. Whatever they encode (activity? recency?), they
share the selection ring's shape and the brand's colour while marking nothing
tappable. On desktop they cluster into visual static. A reader cannot tell
signal from glitch, which also poisons the real selection ring.

**Fix.** No ring without a pin. If the data is "recent activity", pulse the
venue's own pin once on load, subtly, and respect `prefers-reduced-motion`.

### 2.10 The legend is duplicated, and half of it looks dead

Screenshots: `17-map-phone-dark-filters-bottom.png`, `20-map-phone-dark-more-menu.png`.

The same pin key appears in both the Filters sheet and the Map controls sheet.
In both, "Pin shapes", "Dots and rings" and "Routes" are collapsed `<details>`
with no chevron, no affordance, nothing: three bare headings floating over
dead translucent space. They look like sections whose content failed to load.

**Fix.** One legend, in Map controls only. Give each `<details>` a summary
row with a chevron that rotates, or just expand them; a legend this short
does not need progressive disclosure.

### 2.11 Plumbing words printed on reader surfaces

Screenshots: `41-map-desktop-dark.png` ("TONIGHT ARC" as a visible caps label
over the desktop map), `33-tonight-phone-dark.png` ("Freshness unknown" twice,
plus "2 listings tonight · Freshness unknown · via what's-on · nearest Soho
first", a debug line as a subtitle), `13-map-phone-dark-nearme.png` ("Low
confidence", "Plan with warnings" badges beside area names),
`33-pal-phone-dark.png` ("ROUTE BEFORE CHARACTER", "Optional by design"),
`30-plan-phone-dark-result.png` ("Context changed").

VOICE.md rule 2 bans exactly this. "Tonight Arc" is an internal component
name. "Freshness unknown" is the freshness spine's enum leaking upward.

**Fix.** Copy sweep against VOICE.md with its before/after table as the
model. "Freshness unknown" becomes "We can't date these listings yet." "Low
confidence" becomes "Rough guess". "TONIGHT ARC" is deleted; the chips need
no title.

### 2.12 All-caps eyebrows everywhere, against the site's own caps policy

Screenshots: `26-plan-phone-dark-step1.png` (SORT MY NIGHT, LONDON · TONIGHT,
ONE LINK FOR THE WHOLE GROUP., SHAPE THE ROUTE, START NEARBY),
`29-plan-phone-dark-final.png` (YOUR NIGHT SO FAR, DESCRIBE YOUR NIGHT, THE
CRAWL), `33-feed-phone-dark.png` (QUIET AT THE BAR), `33-tonight-phone-dark.png`
(TONIGHT IN LONDON), `16-map-phone-dark-filters.png` (SHOW ME, FARE ZONE),
`24-near-phone-dark-after-find.png` (CHEAPEST PINT, five times).

`docs/DESIGN_SYSTEM.md` retired tracked all-caps labels: sentence case,
~0.01em, caps reserved for stamp chips. The live product is wallpapered with
tracked caps eyebrows. Worst case: "CHEAPEST PINT" repeats on every row of
the /near list while the pub names truncate to make room for it.

**Fix.** Apply the written policy. Eyebrows go sentence case at `--text-2xs`
with 0.01em tracking. In /near, say "cheapest pint" once in the section
header and give the column back to the names.

### 2.13 /near rows: the name loses to a repeated caption

Screenshot: `24-near-phone-dark-after-find.png`.

"The Three Tuns - LSE Stu…" truncates while every row spends a full column on
the identical caps caption. A row also prints "1 min · 0.0 km", a zero
distance shown as data. Each row is a raised grey box; five boxes stacked with
identical weight.

**Fix.** Caption appears once. Rows become hairline-divided list items, price
right-aligned in the mono stamp. Distances under 100m read "right here",
never "0.0 km".

### 2.14 The consent banner sits on the content and follows you

Screenshots: `01-landing-phone-dark.png`, `03-landing-phone-dark-s3.png`.

On first paint the analytics banner covers the proof stats ("2,788 prices on
record" is half-hidden behind it). It persists over every scroll position and
page until answered. The stats are the landing page's credibility row, and
the first thing a new visitor cannot read.

**Fix.** Reserve layout space for the banner (it pushes content, not covers
it), or dock it as a single compact line above the tab bar.

### 2.15 Desktop map: two banners parked in the centre of the product

Screenshot: `41-map-desktop-dark.png`.

"Visiting another city? Near me?" and "Major Piccadilly line closure" stack in
the exact centre of the viewport, over Oxford Street's pins. The SHOW ME
panel also arrives open, a third layer over the map. Four corners are already
occupied (key, list view, Pub Pal, layers). The map is the hero surface with
five things standing in front of it.

**Fix.** Banners dock top-centre under the control bar, single-line, and
auto-dismiss on map interaction. SHOW ME opens only from its control,
closed by default.

### 2.16 Venue sheet details undercut the best surface

Screenshots: `08-map-phone-dark-venue-sheet.png`,
`09-map-phone-dark-venue-drinks-empty.png`, `10-map-phone-dark-venue-priced.png`.

The sheet is close to good, then: the close button draws a coral ring around
a bordered dark box, a double-ringed bullseye louder than the pub's name; two
grab-handle bars render (one at the sheet top, a second blue one above the
photo), promising two different drags; the selected Drinks tab is a circular
coral-orange blob that ignores the label's width; the "Last train" tab clips
to "Train" with no fade; a dashed "Find booking" box floats above the Drinks
empty state where it has no business; "No price yet." sits in a bordered
mono box beside "Near me / for walk time", three visual idioms in one row.

**Fix.** Close = plain 44px circular ghost button, no ring. One handle. Tab
selection = pill sized to the label, `--panel-raised` fill, coral only as a
2px underline if needed. Overflowing tab strip gets an edge fade. "Find
booking" lives in Overview only.

---

## 3. Mediocre and fixable

1. **Wordmark kerning.** "PUBMAXXING" renders as "PUBMA x x ING", the two
   rotated X glyphs gapped so the name breaks into three fragments at header
   size (`01-landing-phone-dark.png`). Tighten the X pair to normal tracking;
   keep the rotation gimmick at display size only, if at all.
2. **Phone hero type scale.** The landing h1 fills six lines and ~55% of the
   viewport (`01`). Two sizes down (clamp to ~2.1rem at 390px) buys the CTA
   and stats above the fold.
3. **Truncation habit.** Area rows truncate their primary name to fit badges
   ("Maryleb…", "King's …", `13`); both plan-page placeholders clip mid-word
   ("under £2", "anything we", `19`, `29`). Names and prices never truncate;
   badges wrap below or abbreviate.
4. **Tonight cards repeat the venue name** as both title and location line
   ("Ballie Ballerson / Ballie Ballerson", `18`, `33-tonight`). Suppress the
   location row when it equals the title.
5. **Raw native datetime input** on the plan result: "02/08/2026, 07:00 PM",
   US format, unstyled (`32`). Format day-first, 24h, and style the control.
6. **Feed segmented toggle** wraps "Your lot" to two lines and the selected
   blob misaligns with the segment (`33-feed`). Fixed-width segments, single
   line labels.
7. **Motion tokens are a duplicate.** Live CSS: `--ease-out` and
   `--ease-in-out` are both `cubic-bezier(.4,0,.2,1)`, the stock Material
   curve. The distinction is fake, and nothing on the site has a real
   ease-out's fast start. Adopt `cubic-bezier(0.23,1,0.32,1)` for enter/exit
   and `cubic-bezier(0.77,0,0.175,1)` for on-screen movement. Press feedback
   exists (transform 130ms) and is the right idea.
8. **Dark backgrounds differ per page.** Map is neutral black, /plan sits on
   a warm brown gradient, /pal on a maroon wash, /feed has faint diagonal
   streaks (`26`, `33-pal`, `33-feed`). One dark stage, per the token sheet.
9. **The TfL chip clips** at the right edge of the category bar and its "15"
   badge collides with the bar's corner (`04`, `05`). Give it the corner lane
   the CSS reserves for it.
10. **Search-in-chip-bar collision.** The active search chip overlaps the
    Restaurants chip, leaving "taurants" sticking out (`10`). Search state
    should replace the row, not fight it.
11. **/u/you secondary action** "Meet your Pub Pal" is bare text beside a
    coral CTA, reads as a label, not a button (`33-uyou`). Ghost-button it.

---

## 4. Genuinely good, preserve it

1. **The desktop landing hero** (`40`). Headline left, real bar photo right,
   priced drink tags pinned to it. It sells the product in one glance.
2. **The empty-state voice.** "Nothing matching that. Try a pub name or an
   area." (`12`), "No pints logged yet tonight. Be the first to drop one."
   (`33-feed`), "Location's off, so here's central London. Not your patch?"
   (`24`). This is the brand at its best; protect these lines.
3. **The pint-index editorial cards** (`33-pint-index`). Named publisher,
   date, and what was counted, under a plain claim. Trust made visible.
4. **The price stamp idiom.** The amber mono `£6.55` with "current recorded
   price" under it (`10`), and the honest "Photo: pub website" credit.
5. **The dark basemap.** Warm, subordinate, readable; landmark glyphs sit
   quietly. `lib/mapBasemapTaste.ts` is doing its job.
6. **Honest thin-coverage copy on /tonight**: "Thin coverage tonight: 2
   sourced listings only. Not a full gig guide." Keep the sentence, lose the
   "Freshness unknown" twin beside it.
7. **Reduced-motion coverage is real**: 57 `prefers-reduced-motion` blocks
   and 14 hover-guard media queries in shipped CSS.

---

## 5. The ordered list

Ranked by how much each change improves the product for the person outside a
pub at 22:40, not by effort.

1. **Rebuild the coral economy on the map** (2.1, 2.9). One accent, three
   jobs; neutral chips; neutral base pins; no empty rings. This is the
   single change that makes the product stop shouting.
2. **Collapse map chrome to one bar** (2.3, 2.15). Categories into the
   Filters sheet, Near me to a FAB, banners docked and dismissable. The map
   becomes the hero it is documented to be.
3. **Fix measured contrast failures** (2.2). Dark ink on every coral fill;
   light-theme active tab. Two token edits, sitewide effect, closes the old
   audit finding for real.
4. **Ship the location honesty branches and the fitNearby fix** (2.7). The
   map that frames Piccadilly while you stand in Victoria is the most
   trust-expensive bug on the product.
5. **De-box pass** (2.4, 2.5, 2.13, 2.16). Filters sheet, Map controls,
   /near rows, plan card frame, venue-sheet close button. Rule: borders for
   inputs; fills for selection; hairlines for structure; nothing else.
6. **Repair the Plan result surface** (2.8). No refresh-state before a first
   route; one failure message in voice; one CTA. The five-step intake
   currently ends in the app arguing with itself.
7. **Copy sweep: plumbing and caps** (2.11, 2.12). VOICE.md and the caps
   policy already legislate this; the live site never got the sweep.
8. **Fix the phone search overlay** (2.6). Overflow, double ring, double X,
   camera jump. It is the first interaction most users try.
9. **Venue sheet detail polish** (2.16, plus 3.3, 3.4). The sheet is the
   conversion surface; the details are what a user stares at longest.
10. **Motion foundation** (3.7). Real ease-out and ease-in-out tokens, then
    apply the venue sheet's spring discipline to chip and sheet transitions.
11. **Landing phone tune-up** (2.14, 3.1, 3.2). Banner placement, wordmark
    kerning, hero scale. First impressions, lowest interaction risk.

---

## Appendix: measurements

| Element | Colours | Size/weight | Ratio | Verdict |
|---|---|---|---|---|
| Map "Near me" chip label, dark | `#fdfaf2` on `#ff5a5f` | 12.5px/400 | 2.91:1 | Fail AA |
| Map category chip labels, dark | `#fdfaf2` on coral fill | 11.2px/800 | ~2.9:1 | Fail AA |
| Active tab "Map" label, light | `#ff5a5f` on `#faf8f5` | 11px/700 | 2.91:1 | Fail AA |
| Tab bar idle label, dark | `#9a9aa0` on `#141416` | 11px/700 | 5.80:1 | Pass |
| Tab bar idle label, light | `#666670` on cream | 11px/700 | 5.42:1 | Pass |
| Landing CTA "Find my pint" | dark ink on coral | 16px/700 | passes (per token) | Pass |
| `--ease-out` token, live | `cubic-bezier(.4,0,.2,1)` | | equals `--ease-in-out` | Duplicate |

Dark tokens read live from production: `--paper #0a0a0b`, `--panel #141416`,
`--panel-raised #202024`, `--ink #eef3ef`, `--muted #9a9aa0`, `--brass
#ff5a5f`, `--amber #f0a01a`, `--pint #5fb389`, `--brick #d47a82`.

Known limits of this pass: no physical device, so gesture feel (sheet drag,
velocity handoff) was not judged; geolocation was unavailable in the test
browser, so the granted-permission Near me path relies on the captain's
Victoria report plus the code cause already identified. Both are flagged
rather than guessed.
