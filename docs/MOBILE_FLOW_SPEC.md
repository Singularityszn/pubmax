# Mobile Flow Spec — PUBMAXXING

The contract every UI agent codes against. Mobile-first (after-work users on phones,
390×844). Desktop keeps its own nav; this spec governs the phone experience. Spec only
the approved set + existing surfaces — no invented features.

## 1. The five tabs (approved)

Bottom tab bar. Left→right, Pint Drop is the emphasized centre action.

| Tab | Job (one sentence) | Root screen |
|-----|--------------------|-------------|
| Map | See pubs, prices and crawls on the 3-D map right now. | `/map` (preferred city) |
| Pubs | Browse the full pub list and jump any one onto its pin. | `/pubs` |
| Pint Drop | Log a pint at a pub in two taps — the core loop. | `/map?log=1` (composer open) |
| Pint stories | Read tonight's drops, boards, editorial and crawls. | `/discover` |
| You | Your passport, activity, saved lists and messages. | `/u/<handle>` |

Vocabulary (approved): the same page is **one label everywhere** — kill desktop
"Drinks" vs mobile "Discover"; the centre action is **Pint Drop** (one noun, not
"Drop"/"Log"); "London" in nav becomes **Boroughs**; the map's persistent CTA is
**Plan tonight**.

Reachability rule: every content surface must be reachable in ≤2 taps from a tab.
Feed and Crawls have no tab, so **Pint stories (`/discover`) is their hub** and MUST
link out to `/feed` and `/crawls` (today it links only to `/map`).

## 2. Transition table

FROM surface × intent → TO surface, with the exact mechanic. Deep-link params are the
`/map` contract in §3. "Back" = the browser/OS back gesture.

| From | Intent | To | Mechanic | Back |
|------|--------|----|----------|------|
| Pint stories / drink card | "show me these on the map" | Map (filtered lens) | `Link` → `/map?drink=<cat>` (or `food=1&q=<cuisine>`, `cocktails=1`, `crawl=<id>`). Map opens with that filter applied, list + pins narrowed. | back → Pint stories, scroll restored |
| Pubs list item | "put this pub on the map" | Map pin | `Link` → `venueMapUrl(id)` = `/map?sel=<id>`. MUST open the venue sheet AND centre the camera on the pin (fly-to). | sheet closes first, then back → Pubs |
| Venue sheet | "plan a night around this" | Plan / crawl | Sticky-bar action "Make it a stop" → seeds the pub into a plan/crawl (`?mode=build&pubs=<id>`), map stays underneath. Copy: "Like this one? Make it stop one." | back closes planning, sheet returns |
| Feed story | "see this pub" → "on the map" | Venue → Map | Story pub `Link` → `/map?sel=<venueId>` (same sheet+centre contract as Pubs). | sheet → back → Feed |
| Crawl editorial | "walk this crawl" | Map crawl mode | `Link` → `/map?crawl=<id>` (curated) or `?mode=build&pubs=<ids>`. Map draws the polyline + route panel. | back → Crawls |
| Pint Drop composer | finished / cancelled | back where they were | Composer is a mode of Map (`?log=1`), not a page. Closing clears `log` and returns to the map beneath; if arrived from a tab, the tab's root shows. | closing composer ≠ leaving Map |
| Plan link (shared) | "join this plan" | Map of the plan's stops | `/plan/<id>` → join → `/map?pubs=<stops>&mode=build` showing the route. | back → plan detail |
| You | passport / activity / messages | profile sub-screens | `/u/<handle>`, `/activity`, `/messages` — in-tab pushes with back to the tab root. | back within You tab |

## 3. The `/map` URL param contract (single source of truth)

Read/round-tripped in `lib/crawlUrl.ts` + `components/PubMap.tsx`. Decode never throws;
unknown/malformed params are ignored.

| Param | Meaning | Read? | Write-back? |
|-------|---------|-------|-------------|
| `sel=<venueId>` | Select a venue: force-include pin + open sheet. | yes | yes |
| `mode=suggest\|build` | Crawl planner mode. | yes | yes (omit `suggest`) |
| `crawl=<id>` | Named curated crawl → hydrate polyline map-first. | yes | yes |
| `pubs=<id,id>` | Hand-built crawl stop ids. | yes | yes |
| `style=<crawlStyle>` | Scoring style (heritage/balanced/…). | yes | yes |
| `alt=<pint\|food\|coffee\|mocktail>` | "Kind of night" copy label. | yes | yes |
| `drink=<category>` | Drink lens (the "lens" filter). | yes | yes |
| `brand=<id>` | Brand within the drink lens. | yes | yes |
| `cocktails=1` | Cocktail lens shortcut. | yes | yes |
| `food=1` | Serves-food filter. | yes | yes |
| `q=<text>` | Free query; also carries the **cuisine hint** (no dedicated `cuisine` param). | yes | yes |
| `band=<id>` | Story-band overlay. | yes | yes |
| `landmark=<id>` | Landmark chapter fly-to. | yes | yes |
| `max`,`stops`,`win` | Planner sliders (clamped). | yes | yes |
| `log=1` | Open the Pint Drop composer. | yes | no (write-only intent flag) |
| `place=<name>` + `lat`,`lng` | Uncovered UK place arrival: frame the map there and stand the city chrome down. Resolved server-side in `app/map/page.tsx` against the place index, never read from the URL by the client. | server only | preserved (passthrough) |

Gaps to flag: **cuisine has no first-class param** (rides `food=1&q=`); **`log`
never round-trips**; there is **no `lens=` alias** — the lens is `drink`/`cocktails`.
UI agents: use `venueMapUrl(id)` and the `crawlUrl` encoders, never hand-build.

## 4. Back-stack rules

1. **Tab switches never build history.** Tapping a bottom tab replaces, it does not
   push — back must never walk the user backward through tabs they tapped.
2. **In-tab pushes DO build history** (list→detail, story→venue, plan→join).
3. **The sheet closes before the tab pops.** With the venue sheet or planner open
   (`appShell.detail-open` / `.planning-open`), the first back gesture closes the
   overlay; only a second back leaves the map. The tab bar is hidden while an overlay
   is up (mobileNav.css) — back must dismiss the overlay, not the whole page.
4. **Scroll restoration:** returning to Pint stories / Pubs / Feed restores the prior
   scroll position (Next default scroll restoration); deep-linking into Map does not
   inherit list scroll.

## 5. State-preservation rules

1. Switching tabs and returning to Map **preserves camera + filters** — the map keeps
   its centre/zoom/pitch and any active `drink`/`band`/`crawl` lens.
2. A **half-written Pint Drop is never silently lost** — leaving the composer keeps its
   draft (venue + text) until explicitly discarded or posted.
3. Filters are URL-truth: the map's state is reconstructable from the address bar, so a
   shared link reproduces exactly what the sender saw.

## 6. Violations today (C1 implementation checklist)

Each is a current transition that breaks this spec. File pointers included.

- [ ] Label mismatch: `/discover` is "Drinks" on desktop (`SiteNav.tsx` L62) but
  "Discover" on mobile (`MobileTabBar.tsx` L47). Unify to **Pint stories**.
- [ ] Centre-action naming: tab reads "Drop" (`MobileTabBar.tsx` L46), not the approved
  one-noun **Pint Drop**.
- [ ] Feed unreachable on mobile: no tab, and Discover's `match:["/feed"]`
  (`MobileTabBar.tsx` L47) is a lie — `DiscoverPageClient.tsx` links only to `/map`.
  Add Feed links on `/discover`.
- [ ] Crawls unreachable on mobile: no tab, no link from Discover, `/crawls`
  (`app/crawls/page.tsx`) is orphaned. Surface via Pint stories.
- [ ] Boroughs naming: nav still says "London" (`SiteNav.tsx` L63); rename to
  **Boroughs**; `/borough` has no mobile entry point beyond the Discover `match`.
- [ ] `?sel=` does not reliably centre the camera: pin selects + force-includes
  (`PubMap.tsx` ~L705) and a fly-to exists (`PubMapCanvas.tsx` ~L2251) but the
  mount-time seed loses to initial route framing / late venue load. Ensure the
  deep-link `sel` seed centres on load.
- [ ] No "Make it a stop" handoff: venue sticky bar is Drop/Crawl/Share/Train
  (`VenueInspector.tsx` ~L963) and "Add to crawl" only shows in `build` mode
  (L541). Add the "Like this one? Make it stop one." plan handoff from any mode.
- [ ] No persistent **Plan tonight** CTA on the map — approved but unbuilt.
- [ ] `/plan` has no nav slot (route on an open PR, absent here) — reserve the entry
  and the join→`/map?pubs=…` flow (§2).
- [ ] Pint Drop composer entry (`/map?log=1`) has no defined "return to where I was" —
  today `log` is a write-only flag (`crawlUrl.ts`); define the close→prior-surface
  behaviour (§2, §4.3).
- [ ] Start Round buried ~4 screens deep — surface the round/plan start from the Map
  CTA rather than deep in the planner.
