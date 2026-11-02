# Design and UX plan

Status: PROPOSAL, CAPTAIN DECIDES. Written 2 November 2026.

This plan answers one complaint: "I asked for design work, and I do not see
it." It reads every design document, looks at every page, and gives one order
of work. Each step ends with screenshots that the captain can see on a phone.

## 1. The short answer

Design work was done. You cannot see most of it, for four reasons.

1. **The newest design work is not on the live site.** The live site runs
   commit `0cafcb24` (launch week 3). The design pull request #2456 (five
   21st.dev designs) merged after it. Nobody deployed it. Check:
   `https://pubmaxxing.com/api/version`.
2. **Much of the shipped design shows only in special conditions.** The table
   in section 3 lists them. Examples: a desktop with a mouse, a quiet night,
   dark mode only from 21:30 to 04:00 London time.
3. **Most design work since August removed things or wrote rules.** Examples:
   one coral button for each screen, no boxes round groups, no tilt on prices.
   These rules make the app consistent. They do not make it look new.
4. **Every list page uses one template.** `docs/design/LAUNCH_SCREENS.md` gives
   41 pages the same shape: a small grey label, a big heading, a coral button,
   an underlined link and paragraphs. So a change on one page looks like no
   change.

The result: the app is clean and consistent, but it looks like a document, not
a night out. The good design (the venue sheet, the crawl route, dark mode) is
two or three taps deep.

## 2. What was checked

- A production build of `main` at `109dce6a`, served on a private port.
- 58 pages and 3 map states (a pub open, a crawl route, a zoomed street), at
  phone width (390px) and desktop width (1440px), in light and dark: about 240
  screenshots.
- The design documents: `DESIGN.md`, `PRODUCT.md`, `docs/DESIGN_SYSTEM.md`,
  `docs/design/`, `docs/design-explorations/`, the launch plan, PlanAstra, the
  July and August design PRDs, and the git history.

The screenshot script is a scratch tool. Step 0.4 makes it a repo command.

## 3. Shipped design that is hidden

| Design | Where it is | What hides it |
|---|---|---|
| Drink taps on a Dock, pour line, pint belt, washing line, menu icons (#2456) | `components/ui/dock.tsx`, `app/tonight/TonightPintBelt.tsx`, `components/nav/siteNav.css` | Not deployed. Then: taps need a desktop mouse; the belt needs 641px or wider and a thin night; the menu icons need 1024px or wider |
| Night Out dark theme | `lib/themePreference.ts` | Default only from 21:30 to 04:00 London time, or by a tap on the moon |
| List beside the map, two-pane messages, the command palette | `components/map/MapSplitList.tsx`, `app/messages/messages.css` | Desktop only (1024px or wider) |
| Price pills on the map | `components/map/canvas/filters.ts` (`PRICE_PILL_MIN_ZOOM = 12`) | Only from zoom 12. The map opens on all of London, below that zoom |
| Night Mode card, Plan card | `components/night/NightModeCard.tsx`, `components/plan/PlanCard.tsx` | Only with an active plan, or for a signed-in plan member |
| Demo content on social pages | `lib/demoContent.ts` | Off unless `NEXT_PUBLIC_DEMO_CONTENT=on`, so social pages look empty |
| Ledger large-text view | `app/globals.css`, `lib/viewMode.ts` | No control turns it on |
| Animated Pub Pal (Remotion, Blender) | `components/pal/PalStage.tsx` | No page uses it |
| London film on the home page | `components/landing/LandingLondonFilm.tsx` | Below the FAQ, behind a Play button |

## 4. What the app looks like today

### Keep these

- **The venue sheet on the map.** A photo, five tabs and one action card
  (price, "Make it Stop 1", "Ask for a table", "Share"). This is the best
  screen in the app.
- **The crawl route on the map.** Numbered stops, walk times between them and
  a "Show whole walk" control.
- **Dark mode.** Deep ink, amber route, coral button. It looks like a night out.
  The Pub Pal art also fits dark mode best.
- **The base system.** Space Grotesk headings, one coral button, one button
  shape, price badges coloured by band, the five-tab dock.

### Fix these, in the order people see them

1. **The first view of the map is noise.** All of London shows about 60 equal
   grey discs, each with "from £x" and "N pubs" under it. Discs are cut at the
   screen edge. On a phone, three layers sit at the bottom: the location ask,
   "Plan a pub crawl" and the tab bar. The good price pills appear only when you
   zoom in. On desktop, coloured Tube lines add more noise.
2. **The home page is a stack of text cards.** It has no map and no pub
   picture above the fold. The price £2.43 shows twice in the first screen,
   once for J.J. Moon's and once for The Moon on the Hill. The page is about
   seven screens long. In its city list, 9 of 12 cities show no pint price.
   Also, two pages disagree: home says the cheapest pint in Britain is £2.43,
   and Tonight says the cheapest in London is £2.09 (J.J. Moon's, Wandsworth).
   The cause is not checked yet; it is likely two different rules for "the
   cheapest". Either way, a reader sees two answers.
3. **Pubs have no face.** The pub page (`/pubs/[id]`) and the historic pub page
   have no photo and no map. The Big Ben page has a large photo, but the
   Prospect of Whitby page has none. Most pubs have no photo, and the no-photo
   state is an icon and the words "No photo yet".
4. **Every page has the same shape.** Near, Today, Tonight, Social, Plan, Pal,
   Places, Pubs, Borough, Crawls, Historic, Pint Index and others: a label, a
   heading, a coral button, a link, then paragraphs. There are few pictures,
   maps or charts.
5. **Pages lead with what is missing.** Social for a visitor: "Sign in", then
   "No London posts yet". Social, Pubs and pints tab: "No creators have shared a
   list yet". Profile: a grid of six zeros. Tonight: "No confirmed listings for
   tonight yet".
6. **Too many words come before the answer.** Today opens with "Page prepared
   2 Nov 2026, 10:29 GMT. Source dates can be older." Source notes and dates sit
   above the content, sometimes in a monospace block.
7. **Desktop is a phone page in the middle of a big screen.** Home, Near, Plan,
   Social and Pint Index use a narrow column with small type and large empty
   areas. On the map, with a pub open, the list, the map and the drawer share
   the width, and the map gets about one quarter of it.
8. **Some pages look like a different product.**
   - `/ledger/[id]` has no menu, black buttons, four full-width buttons in a
     stack, and a heading that touches the last button.
   - `/area/[slug]` and `/drink/[slug]` use a pill-shaped button and a large
     underlined "Publisher: Pint Prices" line.
   - `/routes/[slug]` is a crawl route with no map, and its prices are plain
     text, not price badges.
9. **The menu changes from page to page.** Home has no menu icons; other pages
   have icons. `/ledger` and `/login` have no menu. The menu moves down a few
   pixels on some pages. The highlighted tab is wrong on some pages: Big Ben
   highlights Social, Founders and Contributors highlight You. Most pages
   highlight no tab.
10. **Data pages have no charts.** Pint Index says "London pint prices by
    borough and fare zone", but it shows number tiles, not a map or a chart.
11. **Two visible bugs.**
    - **A big gap in source lines.** "Listed by Pint Prices, collected 2
      October" breaks, and "2026." sits far below it. The cause: the source
      link has a 44px minimum height inside a line of text
      (`components/venue/ListedPriceSource.module.css`, `.publisher`). It shows
      on the home page, the pub page and the ledger.
    - **The desktop menu is crushed on the pub page.** The menu words overlap
      ("Explor Tonigl Plar"). The cause: `app/pubs/[id]/pubPage.css` limits the
      menu to 760px, and #2456 added icons that need more room. This bug is in
      the work that is not deployed yet.

## 5. Why design work did not show

- **Rules, not pictures.** `docs/DESIGN_SYSTEM.md` has 16 fenced laws. They stop
  bad changes. They do not make good screens.
- **One template.** The screen table makes every list page the same.
- **Honesty without design.** The app must not invent data. That is correct.
  But when data is thin, the page shows the gap first, with nothing designed
  around it.
- **Flourishes behind conditions.** New effects were built for a desktop mouse
  or a wide screen. Most people use a phone.
- **No visual proof.** A design change does not come with before and after
  screenshots that the captain can see.
- **Deploys lag.** Merged work is not live.
- **Style sprawl.** 278 stylesheets, 76,582 lines of CSS, 216 different literal
  colours. `app/globals.css` alone has 6,230 lines. A change of look is slow and
  risky.
- **Documents disagree.** Six disagreements are listed in step 0.5.

## 6. The plan

The rule for every step: **if a person cannot see the change on a phone in five
seconds, it is not design work.** Each step ends with a before and after
screenshot sheet (phone and desktop, light and dark) and a deploy decision.

Sizes: S is up to one day, M is two to three days, L is about one week.

### Phase 0. Make the built work visible (S, 1 to 2 days)

| Step | Work | Size |
|---|---|---|
| 0.1 | Fix the crushed desktop menu on the pub page. Let the menu use the page width, as other pages do. | S |
| 0.2 | Fix the gap in source lines. Keep the 44px tap area with an invisible layer, not with line height. | S |
| 0.2b | Find why home and Tonight name a different cheapest pint, and make both pages use one rule. | S |
| 0.3 | Captain: deploy `main` after 0.1 and 0.2. | Captain |
| 0.4 | Add a design proof command: one run takes the screenshot sheet for named pages at both widths and both themes. Every design pull request attaches the sheet. | S |
| 0.5 | Captain picks one answer for each disagreement: (a) price stamp tilt (the map pins still tilt; the page prices do not); (b) the price typeface (the docs say JetBrains Mono, the code uses Inter bold); (c) one motion system (`framer-motion` from #2456, or the house spring code only); (d) the night colours (muted green `#5fb389` or the brighter pint green of the mockups); (e) the venue sheet tab names; (f) the home page primary action. | Captain |

### Phase 1. The first ten seconds: home and map (L, week 1)

| Step | Work | Size |
|---|---|---|
| 1.1 | **Home opens on a picture of London with real prices.** Reuse the map opening picture that `/map` already draws (`scripts/build_map_opening_snapshot.mjs`) and draw the cheapest prices on it as price pills. The hunt card sits on top. One coral button. No MapLibre on the home page, so the page budget holds. | M |
| 1.2 | **Shorten the home page.** Show each city with a price as one row. Put the cities with no prices in one line ("Also on the map: Manchester, Birmingham ..."). Move the source notes to one fold at the foot. Show a price only once in the first screen. | S |
| 1.3 | **A calm first view of the map.** Option A: open at street zoom on central London, where the price pills show. Option B: fewer, larger clusters, coloured by the cheapest band, with no "N pubs" text under each. Hide clusters cut by the screen edge. | M |
| 1.4 | **One bottom card on the phone map.** Join the location ask and "Plan a pub crawl" into one card above the tab bar. | S |
| 1.5 | **Desktop home in two columns.** The hero text on the left; the London price picture at full height on the right. | S |

### Phase 2. Give every pub a face (L, week 2)

| Step | Work | Size |
|---|---|---|
| 2.1 | **A pub sign cover for every pub with no photo.** The pub name in the display face on a panel, the area, the price band as a strip, and a small crop of the street map. It is clearly not a photo, so it is honest. Use it on the pub page, the map peek row, the list rows and the share card. | M |
| 2.2 | **Rebuild the pub page.** Cover (photo or sign), a map crop, one price table with bands, opening hours and the same action card as the venue sheet. Do the same for `/historic/[slug]`, with a licensed Wikimedia photo where one exists, as the landmark pages do. | M |
| 2.3 | **A 56px photo or sign on each map peek row and list row.** | S |
| 2.4 | **Ask for a photo on the sign.** One tap: "Add a photo of this pub". This feeds the photo supply. | S |

### Phase 3. Break the template (L, week 3)

| Step | Work | Size |
|---|---|---|
| 3.1 | **Three page shapes, not one.** An answer page (Near, Today, Tonight): the answer card first, then the list. A place page (Borough, Area, Drink, Historic list): a photo or map header, then a ranked list with badges. A data page (Pint Index, Price Pulse, Spoons value, Time machine): a chart or map first. This changes `docs/design/LAUNCH_SCREENS.md`. | M |
| 3.2 | **Charts on data pages.** Pint Index: a borough map shaded by price and a bar chart by fare zone. Price Pulse already has one bar; give it the same chart style. | M |
| 3.3 | **A map on each crawl route page.** Put the route picture at the top (`app/crawls/RouteThumbnail.tsx` exists), show the stops as a timeline, and show prices as price badges. | S |
| 3.4 | **Bring `/ledger`, `/area` and `/drink` onto the shared shell.** The same menu, buttons, corners and price badges as the rest. | S |
| 3.5 | **Answer first, sources last.** Move "Page prepared ..." and other source notes to one "Sources and dates" fold at the foot of each page. Nothing is removed. | S |

### Phase 4. Never lead with empty (M, week 3 to 4)

| Step | Work | Size |
|---|---|---|
| 4.1 | **Social for a visitor shows what exists.** Lead with real public items: crawl routes, this week's cheapest pints, the photo wall when it has photos. Put the sign-in after them. Never show made-up activity. | M |
| 4.2 | **EmptyState gets a picture slot** and one useful next step. The 404 page art (`DotGlassArt`) shows the style. | S |
| 4.3 | **Profile with no activity:** replace the six zeros with a short first-night list: claim a handle, log a pint, save a pub. | S |
| 4.4 | **Tonight with no listings:** lead with the cheapest pints near you. Bring the beer-mat belt to the phone as a swipe row. | S |

### Phase 5. A desktop that uses the screen (M, week 4)

| Step | Work | Size |
|---|---|---|
| 5.1 | **List beside the map on `/near` and `/pubs`.** This is the open backlog decision `near-and-pubs-split-view`. Load the map only from 1024px and after the answer paints. | M |
| 5.2 | **The map keeps at least half the width.** With a pub open, the drawer covers the list, not the map. | S |
| 5.3 | **Larger type on desktop content pages,** and a wider column where a page has a table or a chart. | S |
| 5.4 | **One menu on every page.** The same icons on home; a menu on `/ledger` and `/login`; one top position; the right tab highlighted for each page. | S |

### Phase 6. Three signature moments (M, week 5)

Pick three moments. Each must show on a phone. Each follows the reduced-motion
rule.

| Step | Work | Size |
|---|---|---|
| 6.1 | **The price lands.** When an answer arrives, the price badge presses in like a stamp. This brings back the "pressed ink" signature as motion, not as a tilt. | S |
| 6.2 | **The route draws.** When a plan lands, the walk line draws from stop to stop. | S |
| 6.3 | **Night comes in.** At 21:30 the app changes to the night theme with one short fade, and the Night Mode screen gets large tap targets (the launch UX variation V2). | M |
| 6.4 | **Touch versions of the #2456 effects,** or remove them. A desktop-only effect that most people never see costs code and gives nothing. | S |

### Phase 7. Make change cheap (ongoing, beside the phases)

| Step | Work | Size |
|---|---|---|
| 7.1 | **A CSS ceiling that only goes down,** like the coral count: total CSS lines and literal colours. Delete styles that no page uses. | M |
| 7.2 | **One visual spec.** `DESIGN.md` holds the look; `docs/DESIGN_SYSTEM.md` holds the engineering rules. Record each step 0.5 answer in its owner file. | S |
| 7.3 | **Dark mode check for every new piece,** with the proof sheet from step 0.4. | S |

## 7. How each step is proved

- The design proof sheet (step 0.4): the same pages, before and after, phone
  and desktop, light and dark.
- A spacing, type and colour check with Squints (`docs/DESIGN_SYSTEM.md`,
  "Tools for checking a page").
- `npm run verify` stays green. The existing design fences stay in place.
- The page ceilings in `perf/route-budgets.json` do not go up. The home
  picture is a static image, not the map engine.

## 8. The design links you shared (2 November 2026)

| Link | Use here | Verdict |
|---|---|---|
| [interfaces.dev](https://interfaces.dev) | Reading for craft: type, motion, detail | Read before Phase 6 |
| [squints.app](https://squints.app) | Measure spacing, type and colour on the live page | Already in `docs/DESIGN_SYSTEM.md`; use it in every proof |
| [pro.reactbits.dev](https://pro.reactbits.dev), [uiarc.dev](https://uiarc.dev) | Animated React components | Ideas only. Rebuild on our tokens, as #2456 did. Do not paste whole blocks |
| [gauge-ui.dev](https://gauge-ui.dev) | SVG gauges | Good fit: a "where this price sits" gauge (cheap, average, dear) on the pub page and Pint Index |
| [audiocn.dev](https://audiocn.dev) | Audio components | Only if the Pub Pal voice ships |
| [mdxcn.dev](https://mdxcn.dev), [pele.run](https://pele.run) | Diagrams for docs | Docs only, not the product |
| [encyclopedia.iconography.co](https://encyclopedia.iconography.co) | Icon words | Already in `docs/DESIGN_SYSTEM.md`; use it for the map icon review |
| [squig.sh](https://squig.sh) | SVG experiments | Ideas for the route line in step 6.2 |
| [great-ui.com](https://www.great-ui.com) (a reply to the post) | Inspiration | Reading only |

## 9. Decisions for the captain

1. Deploy `main` after steps 0.1 and 0.2?
2. Home hero: a London picture with real prices (step 1.1), or the current card
   stack?
3. Map first view: street zoom on central London (step 1.3 A), or new clusters
   (step 1.3 B)?
4. The pub sign cover for pubs with no photo (step 2.1): yes or no?
5. Three page shapes instead of one template (step 3.1): yes or no?
6. The six answers in step 0.5.

When the captain answers 1 to 3, Phase 0 and Phase 1 can start the same day.
