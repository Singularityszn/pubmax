# PUBMAXXING

**Every pint has a story.** A **price-aware, story-led London night-out map and pub-crawl planner**. Pubs keep observed pint prices; hand-curated bars, late-food institutions, and iconic restaurants use labelled, dated anchors for the item actually priced. Three layers share one living 3-D map: **price**, **setting**, and **story**, with visible provenance so history and legend never blur.

Pick a crawl style, filter, and either accept a **Suggested Crawl** or **Build your own** by tapping pubs, or load a curated **Featured route**. Any crawl is captured in the URL and shareable. Tap a pub to open **The Landlord**, a retrieval-grounded AI that tells the pub's real history and honestly says when it doesn't know.

## Features

- **Landing** - a London skyline photograph introduces the app. **Cheapest pints near me** opens nearby listed prices and asks for location (`/near?locate=1`). Directory browsing stays available without that prompt at `/near`.
- **Phone controls** - map sheets leave the primary tabs reachable. The tabs and floating Create control hide while the keyboard is open. A strict modal makes these controls unavailable. Create also stays hidden on the Moment and Plan compose pages. Tap outside the create menu or tap its close mark to dismiss it. In the map planner, the keyboard's Go or Enter key submits the outing description. Pub Pal uses compact headings while analytics consent is visible. On short phone screens, its portrait also shrinks.
- **Tonight** - `/tonight` lists the pubs people are talking about. Expand **Why this pub** on the first pub for its explanation, source link and checked date when recorded. Later pubs show those details directly. Expand the additional-pubs list to read the remaining pubs. **Open on map** stays outside the first pub's disclosure when the map can open the pub.
- **3-D map** - pitched MapLibre view of London and supported UK cities. After pins appear, an idle view orbits slowly through capped bearing steps. Any map or camera input stops it; reduced-motion, hidden, and off-screen maps stay still. On a first visit, one card asks whether you want the cheapest pints near you: share your location, or choose an area. It shows once per device, stays away from a deep link or a planner handoff that already asks its own question, and a refused location hands you the area picker instead. The picker lists London neighbourhoods, searches localities, and offers the other city guides. A neighbourhood shows a pub count only once every pin behind that count has loaded, so a part-loaded map prints no figure rather than a low one; the area you pick is remembered on this device and names the map's own area chip. No point of yours is stored: a remembered "Near me" asks your browser again on the next visit. Curated London venues use distinct pub, bar, late-food, and restaurant glyphs. Searches for **The Blackfriar** and **The Black Friar** find the same London pub in Map and Pub Pal. Legacy `/pub/the-black-friar-blackfriars` and `/venue/the-black-friar-blackfriars` links open this pub. Name-only links that match multiple pubs return 404. A keyboard and screen-reader [List view](docs/A11Y_MATRIX_2026-07-18.md#follow-up-status) follows the venues currently visible through the map's filters and opens the same venue sheet as a pin. By default the map is priced by the pint: pub colours use pint-price thresholds; bar, food, and restaurant colours use relative bands within their own type; at city zoom, a cluster is a disc whose ring carries the band - desktop split rings show the known price mix while solid fallback rings use the most common known band and stay grey only when none is known - and whose figure is the cheapest pint price a pub inside lists, or the venue count when none lists one. A complete text key opens from the desktop map and, on phone, from Prices and places or More, so colour is never the only carrier. At street zoom, a pub with a sourced pint price prints the figure itself ("£5.40") on a pill with its band as a foot, or beneath its glyph when it is selected or wears a mark - bar, food, and restaurant anchor prices stay on the venue sheet, labelled, never printed as a bare figure. Choose another drink and both the colour and the printed figure follow that drink instead (see "Priced by your drink"). Kind filters can hide ordinary pins, while selected and deep-linked venues remain visible. Unverified UK pubs appear only after street-level zoom as quieter, unpriced rings. The phone's TfL control and Transit tab are available only on the London map. See the [CityMCP integration](docs/CITYMCP_LONDON.md#runtime-api-surfaces-app-facing) for desktop local-news display and transport request and recovery rules.
- **Find your town** - open a city in Places (`/places`) and choose **Set as my city**. Desktop and mobile **Map** links follow that choice, including changes made in another tab. Choosing Manchester sends Map links to `/map/manchester`; without a stored choice, they open London. A bookmarked `/map` always opens London. Price-entry instructions are under "Log tonight's price" below. The city picker also searches the curated city guides and any other UK place with a mapped pub, without changing the city links or the geolocation path. A curated match keeps its full guide, prices and crawls; anywhere else opens the pub map at that place with the unverified UK pub layer streaming, and says plainly that no prices are logged there yet rather than implying the town was checked. Place names are OpenStreetMap locality tags already carried by the committed UK pub data (ODbL 1.0); see [`public/data/uk_base/README.md`](public/data/uk_base/README.md).
- **Typed venue anchors** - bars, late food, and restaurants show labelled, dated, sourced cocktail, food, or signature-dish anchors, never disguised as pint prices. A restaurant's signature dish also seeds its Menu tab as a sourced, dated item. Pint Drops and community price logging remain pub-only.
- **Pub website details** - open a pub's Overview tab and expand **Details and practical info** for its stated dog policy and opening hours. Website facts carry a **Pub website · Read <date>** credit, even when the read is old. A usable Google Places dog policy takes precedence at any age. Website hours appear when Google Places has no usable hours from the last 30 days. A day the website does not state says **Not stated**, rather than **Closed**. Dog policy does not enter map filters.
- **Priced by your drink** - the map answers cheapest pint by default. Pick another drink and pin colour, the printed pin figure and the cheapest-in-this-area list all follow that drink's trusted community prices, with every non-pint figure naming its drink ("£6 Whisky"). A pub with no trusted price for the chosen drink stays neutral and says so, never borrowing its pint or anchor price, and the price key reports whether the map-wide read finished, covered only part of the list, or failed, so an empty map is never passed off as a city with nothing logged. The max-pint-price filter and the pint refinements step aside while another drink owns the map, because a category price proves nothing about a brand, a subtype or a pint band. Only drinks the map can show and clear are offered as a view, so a category you can log but never see selected cannot narrow the map in silence. Cheapest-pint buckets and the Pint Index stay pint-only.
- **No alcohol and food views** - a "Show me" switch under the map search narrows the map to the night you are actually planning. The no-alcohol view keeps venues known to serve without alcohol, any pub with a corroborated soft-drink or alcohol-free price, and sourced food venues; the food view keeps late-food and restaurant venues. Soft drinks and alcohol-free drinks are their own logged categories, held to the same corroboration and freshness rules as a pint, and they colour and label pins like any other chosen drink. A food or dish anchor never prints on a pin: it stays on the venue sheet, labelled and sourced. A view's figure always names its drink or dish, and never reaches cheapest-pint buckets or the Pint Index. A pub with nothing logged says so plainly rather than implying it was checked.
- **Crawl planner** - describe a night at `/plan`, such as "Quiet wine in Clapham for 2", then [review the route and check **Drinks** in **Tune details**](docs/rules/components-venue-plan-and-message-surfaces.md#the-plan-result-is-a-route-and-the-settings-sit-behind-it) before saving. You can choose an alcoholic drink category or the existing no-alcohol option. A non-beer selection leaves unavailable prices and route budgets unknown. For these nights or the no-alcohol option, leave **Max per person** unset: generation cannot prove that ceiling from the available reports. Saved community reports show their date and say when serving size is missing. The map also offers Suggest mode or Build mode. Developer details and current persistence limits live in the [Plan price contract](docs/API_CONTRACTS_THE_LOCAL.md#selected-drink-price-evidence).
- **Curated routes** — named "generational" Featured crawls loaded as ordered stops.
- **Pubs near me** - `/near` compares listed Pint Prices nearby, cheapest first. Each result shows its recorded publisher status, while one shared date tells you when the Venue Dataset was collected. Location stays on the device, and a denied or unavailable location falls back to a remembered or default area.
- **Somewhere to sit and work** - the same `/near` page asks a second question. A Pint or Desk switch at the top opens Desk mode (`/near?mode=desk`), which ranks London cafes, coworking spaces, libraries, hotel lounges and wifi pubs by the same on-device locality, then keeps at most one venue per chain in the answer so five results are five different places. A card says only what OpenStreetMap stated: the amenities it knows ("Wifi: yes"), or "No amenity data yet" when it knows none; one plain hours line for right now ("Open until 22:00", "Opens 07:00", "Closed today" or "Hours unknown") with the raw OpenStreetMap string behind "Full hours"; and the date the data was checked. Nothing here records how busy a place is. Pint stays the default, the chosen mode is remembered on the device for a bare `/near` (a shared link that names a patch, a locate request or a poster scan opens the mode its URL says), and the answer credits OpenStreetMap contributors (ODbL 1.0). See [`public/data/london_desks/README.md`](public/data/london_desks/README.md).
- **Cheapest pints of one beer** - `/drink/{brand}` lists the cheapest listed pints of a named beer in London, and `/area/{area}/drink/{brand}` asks the same question inside one Night Area. Every figure comes from the price row that owns it, each row shows its own publisher status, and one shared date says when the Venue Dataset was collected. A combination without enough priced pubs is a 404 rather than a thin page. Nothing here is a community submission and nothing here moves the map, the cheapest-pint buckets or the Pint Index.
- **Shareable URLs** — the whole crawl state round-trips through the URL; "Copy link" shares it.
- **Rounds** - a shared beer mat for the buying rotation: whose turn is up, who bought last, what each round cost, and an immutable night diary. A map route or member-only active Plan can start one with its title and ordered stops already queued. Anyone with the code can add diary lines; only lines from a signed-in account with a claimed handle can enter the community-price lane, where the usual corroboration gate still applies. No balances, IOUs, or settling up.
- **Diary** - sign in, open a pub's sheet and choose **Log this visit**. Pick the London day you were there (today by default), an optional rating from 1 to 5 in half stars, and an optional line of up to 280 characters. One pub logs once per day; a second log for the same day is refused. Entries are private: only you see them, listed on your own profile where you can edit the day, rating or review. You can also remove the entry. The pub stays fixed, and the account export carries the entries. The [contribution access rules](docs/rules/lib-identity-accounts-and-sessions.md#contributing-asks-two-questions-and-the-age-one-is-the-10-aug-rule-s) also apply to Diary.
- **Wanted** - choose **Save for a night** on a venue sheet. You can also paste a link or venue name into Wanted on your own profile. Sign in and choose a handle to keep the private list. Open rows let you edit the note, open the saved link or remove the place. Fulfilled rows keep the saved link and removal control, with no note editor. [Contribution access rules](docs/rules/lib-identity-accounts-and-sessions.md#contributing-asks-two-questions-and-the-age-one-is-the-10-aug-rule-s) govern the age check.
- **Pint Drops** - community photos, the price you paid, and a passed-down note, moderated. Your Pint Passport counts distinct London boroughs from these drops. A City of London visit counts once and changes the label to **Boroughs + City**. Without a City visit, the label stays **Boroughs**. Shared passport text names the City separately. Drops with no recorded London borough or City do not increase this count.
- **Offline pages** - with a registered service worker, previously cached public `/plan/<id>` previews can reopen without signal. Cached landing, Map, Tonight and offline fallback pages can also reopen. Pint Drop pages (`/p/<id>`), nested plan pages and member details need a connection. Plan previews cached before the privacy repair are never reused. Eligible previews from the trusted cache family remain available if migration writes fail. The [Plan cache header](public/sw-plan-cache.js) owns eligibility and retirement details. See the [Capacitor wrap guide](docs/CAPACITOR_WRAP.md) for native-shell availability, outage fallback and retry rules.
- **Drink Wall** - `/wall` is a city-wide photo grid of pints, pub fronts and London views. Anyone can browse; signed-in contributors post through the same moderated photo pipeline as pub walls, and a photo on a pub wall also appears here. On a pub wall, choose a photo and crop it. **Use photo** accepts the crop. Add an optional drink tag and caption. Choose whether to share to your feed. Choose **Post photo** to publish. Pub-linked posts show on both walls. **Remove** on your own photo removes it from both walls.
- **Social** - `/social` is the canonical mobile and desktop Social shell, live by default with chronological Following, Nearby, and Across town lanes plus public pub discovery. Full posts and private activity stay closed unless the server confirms Social access; set `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` only for an emergency preview rollback. `/feed` and `/stories` now lead to this shell; `/discover` and `/drinks` open its Discover view.
- **Messages** - sign in with a claimed handle, open `/messages`, and choose **New message**. Search by at least two characters of a public handle, then select people from the results or your recent direct conversations. Select one person and choose **Chat**, or select two to eleven people and choose **Create group**. Groups include you and can have an optional name. Members can leave, but nobody can be added after creation. **Search conversations** filters your existing inbox by person or group name.
- **Founders wall** - `/founders` keeps the first hundred claimed handles on public record. Social Posts and Your PUBMAXX link to it.
- **Log tonight's price** - on mobile, choose **Create → Log a price** to keep the map's city and selected drink. Choose a pub if none is selected. If you start outside the map, it opens your remembered city, or London if none is saved. **Search pubs** keeps the request active while you search; **Show all pubs** clears constraints but keeps the drink category. Wine and cocktail requests open their own price forms, and sign-in returns to the same city, pub, and drink. You can also tap **Add price** from a pub's sheet, choose a category, and enter the price. Each submission shows on the pub's own page instantly, on its own dated row, never overwriting the price on record. [Contribution access rules](docs/rules/lib-identity-accounts-and-sessions.md#contributing-asks-two-questions-and-the-age-one-is-the-10-aug-rule-s) govern the sign-in, handle and age checks. A first pint report also marks the pub's pin at once with a small unconfirmed dot, but the pin's colour and card restamp with a dated community badge only once a second independent drinker logs the same figure, and a community price over 30 days old hands the map back to the price on record.
- **Contributor record** - `/contributors` ranks public profiles by visible price logs, Visit Reports and weather Recommendations added together across all time. Equal totals share a place. Legacy price rows without a handle and hidden contributions stay off the record; detailed attribution and retention terms live in the [privacy notice](https://pubmaxxing.com/privacy).
- **Invite a mate** - signed-in accounts can share an account invite link. A same-journey new-account signup can record a private referral edge. Reaching 1, 3 or 5 qualified referrals earns a mark of honour on your own account surface and nothing else: nothing in the product is behind it. [`docs/REFERRALS.md`](docs/REFERRALS.md) owns the attribution, qualification, and recognition boundary.
- **What drinkers noticed** - a quiet panel on the pub's sheet holds four community observations that decide whether you walk in: rough or posh character, step-free access, door policy, and whether people were eating. They read as drinkers' reports and never as venue facts - character always names whose judgement it is, entrance and toilet access are separate questions because British pub toilets are often reached another way, and an access question stays plainly unknown until a second independent drinker confirms it, however old a lone report gets. Reading stays public; adding a report follows the same contribution access rules as community prices, and none of it moves pin colour, price bands or the Pint Index.
- **How busy is it right now** - a pub's sheet asks one question and takes one tap: Empty, Some seats or Full. Reporting needs a signed-in account; anyone can read the answer. The reading is always dated ("Some seats · 12 min ago") and only a report under 90 minutes old may answer for now, so an older one reads "No fresh reading" rather than passing as tonight. A read that failed says it could not check, never that nobody has reported. Crowd reports move nothing else: not pin colour, not price bands, not the Pint Index.
- **What it used to cost** - where the archives evidence it, a pub's sheet sets one dated historical pint price against the price on record now ("£3.60 in April 2014. £5.80 now."), with the source named, dated and linked. A pub with history but no current price still shows the old figure alone, and a bar or food venue never gets the comparison because its anchor price is not a pint. Historical prices are strictly second class: they never move pin colour, price bands, cheapest-pint buckets or the Pint Index.
- **Pint Index** - `/pint-index` ranks London boroughs by observed pint price, with a TfL fare-zone median strip beside it and a dearest-end view of the same league. Only prices carrying a public source and the day they were seen are eligible, which is stricter than the map: an area can post a zone median and still sit empty in the league. Every closed month freezes into its own dated page so a quoted figure stays quotable, and the live page and each dated edition publish `Dataset` structured data, with a CSV download whenever they hold rows. Cited national benchmarks sit above the league as somebody else's figures, each naming who counted it and when, never merged into ours.
- **The Landlord** — grounded pub-heritage Q&A that reads back only server-known facts and refuses to invent.
- **Moderation** - reports from two distinct signed-in accounts hide a Pint Drop; anonymous reports queue it for moderator review without auto-hiding it. A token-gated `/admin` console reviews hidden drops. A community price or a drinker's pub observation can also be reported by anyone, but never auto-hides: only a moderator hides it (hide, never delete) through the moderator-gated admin API, one queue for both shapes.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · MapLibre GL + OpenFreeMap
basemaps (CARTO fallback) · Supabase (Postgres + Storage + RLS) · OpenRouter
(Claude) for The Landlord · Vitest + Playwright · deployed on Vercel.

## Quick start

Use a Node.js release accepted by `engines.node` in [`package.json`](package.json).

```sh
npm install
npm run dev            # http://localhost:3000 — works with NO secrets
```

The app runs **keyless** for local dev: Pint Drops use an in-memory store and The Landlord answers in grounded/structured mode (reads the facts on record; no narration). To light up the durable seams, copy `.env.example` → `.env.local` and add Supabase + `OPENROUTER_API_KEY`.

### WebMCP Agent Night Board

Open [`/webmcp`](http://localhost:3000/webmcp) to build one visible Crawl Route with a person and a browser agent. It works without secrets or sign-in. ChatGPT's in-app browser supports WebMCP. Google Chrome 149 or later needs `chrome://flags/#enable-webmcp-testing` enabled.

Challenge source: [karanmrn/pubmaxx-webmcp](https://github.com/karanmrn/pubmaxx-webmcp).

The page registers five top-level tools only while the Night Board is open:

- `search_pubmaxx_venues`
- `read_london_night_context`
- `draft_pub_crawl`
- `swap_crawl_stop`
- `open_crawl_in_pubmaxx`

Registration uses the native imperative API:

```ts
document.modelContext.registerTool(
  {
    name: "search_pubmaxx_venues",
    description: "Search the curated PUBMAXX Venue Dataset by venue name or area.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 2, maxLength: 80 } },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (input, context) => searchPubmaxxVenues(input, context.signal),
  },
  { signal: registrationController.signal },
);
```

Implementation, trust boundaries, browser test steps, and tool contracts are in [`docs/WEBMCP.md`](docs/WEBMCP.md). Challenge answers and the demo script are in [`docs/WEBMCP_SUBMISSION.md`](docs/WEBMCP_SUBMISSION.md).

For the separate local ChatGPT MCP Apps prototype, see the [public map setup guide](scripts/chatgpt-map/README.md).

Useful scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run typecheck` | Checks project types; [compiler compatibility](next.config.mjs) explains how this differs from the Next build check |
| `npm run verify` | Local pre-push gate; its complete check sequence is defined by the `verify` script in [`package.json`](package.json). `test:rls` and `db:types:check` need PostgreSQL 16; a host that genuinely cannot install one sets `PUBMAX_RLS_ALLOW_SKIP=1` to admit the skip out loud, because a skipped policy proof reported as a pass is what let an RLS hole live for four days |
| `npm run ci` | `verify` + build - the full local gate; Vercel's build command is defined separately in [`vercel.json`](vercel.json) |
| `npm run ci:isolated` | Collision-safe keyless `ci` in a unique temporary Next dist directory; restores Next-managed tracked files |
| `npm test` | Vitest unit suite ([PostgreSQL suite inventory](scripts/rls/postgresSuites.mjs); those suites boot throwaway PostgreSQL 16 clusters, `PUBMAX_PG_MAX_CLUSTERS` caps concurrency, and `PUBMAX_RLS_NO_PG=1` skips them) |
| `npm run test:chatgpt-map` | Installs the pinned local MCP package and runs its Node tests; included in `verify`. Separate browser proof is described in the [setup guide](scripts/chatgpt-map/README.md) |
| `npm run test:e2e` | Playwright browser suite, including UI and accessibility guards (builds, starts, drives Chromium) |
| `node scripts/e2e/run-disposable-plan-browser.mjs` | Wine and cocktail persistence and forged-hint browser checks against disposable PostgreSQL/PostgREST. Requires local PostgreSQL 16, PostgREST, and Playwright Chromium. Builds an isolated production server, applies the [fixture's migration range](scripts/e2e/disposable-plan-db.mjs) only to its temporary database, and cleans up its server, database, and build directory. Results stay in `test-results/`. |
| [Signed-in review harness](docs/testing/signed-in-review.md) | Seeded local authenticated browser review |
| `npm run shots` | Generates required 390/1440 light/dark Gate-Z screenshots; map captures fail unless MapLibre paints a pub mark |
| `npm run shots:extended` | Runs the same gate with the 430/1280 breakpoint audit |
| `npm run setup` | Enables the pre-push git hook (`core.hooksPath=.githooks`) — run once |
| `npm run build:slim` | Slim map index + **venue detail artifacts** (`data/generated/`) — also runs in `npm run build` |
| `npm run build:city-slim` | Regenerates enabled city slim packs, compatibility cores, and manifests |

### Venue detail index

`npm run build:slim` (`scripts/build_slim_index.mjs`) writes:

- `public/data/venues_slim.manifest.json` plus `venues_slim.core.json` and `venues_slim.cell.*.json` — location-aware map shards loaded for the current viewport
- `public/data/venues_slim.json` — complete compatibility index for server and whole-index readers
- `data/generated/venue_detail_index.json` + `venue_details.jsonl` — server-side lazy detail for `/api/venue/[id]`

For London, the map loads the manifest and only the cells around its opening
viewport, then loads neighbouring cells as the camera settles. Other city packs
use one compatibility core. The generated detail files are gitignored (large).
Local/dev falls back to the raw pint dataset and curated venue packs when they
are missing; production should run `npm run build` / `build:slim` so the index exists.
`npm run build:venue-details` writes only the two detail files and leaves the
committed map packs untouched.
See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) and the [map speed evidence](docs/perf/map-speed-caching-2026-08-28.md).

### Map data attribution

`public/data/london_localities.json` is the Greater London locality gazetteer that powers map search (Willesden, Cricklewood, Gospel Oak…). It is built once from OpenStreetMap place nodes by `scripts/gen_london_localities.mjs`. **OpenStreetMap data is © OpenStreetMap contributors, licensed under the Open Database Licence (ODbL) 1.0** (<https://www.openstreetmap.org/copyright>); the attribution and licence travel in the file's header fields. Regenerate with `node scripts/gen_london_localities.mjs`.

The UK-wide unverified pub layer also comes from OpenStreetMap. Its pins remain
outside the curated venue index, and its sheet displays source attribution while
accepting community price submissions. Because OSM-derived venues ship in both
pub layers, the map corner itself credits OpenStreetMap contributors (ODbL) via
`OSM_ATTRIBUTION` in `components/map/canvas/tokens.ts`. See
[`public/data/uk_base/README.md`](public/data/uk_base/README.md) for the runtime
data contract.

## Demo data

The community layer ships alive: hand-written Pint Drops and Featured crawls are seeded so the map has content on day one. Seeded content is tagged `demo` and stays **visibly distinct** — it never masquerades as organic contributor signal and is filtered out before it can move any price or story metric. Provenance chips (`Sourced` / `Contributor` / `Anecdote` / `Demo`) are the product's trust signal.

Public releases set `NEXT_PUBLIC_DEMO_CONTENT=off` in both Vercel Preview and
Production. The setting is read at build time, so it needs a fresh deployment.
Local keyless demos may leave it empty to keep labelled seed content visible.

## Deeper docs

- **`docs/teach.md`** — full repo tour: architecture, data model, map lifecycle, backend, trust boundaries, with `file:line` anchors.
- **[`docs/MOBILE_FLOW_SPEC.md`](docs/MOBILE_FLOW_SPEC.md)** - mobile transition, Back, and state-preservation principles.
- **[`docs/MAP_URL_PARAMS.md`](docs/MAP_URL_PARAMS.md)** - map URL ownership, validation, and history rules.
- **[`docs/specs/governed-priced-landings/PRODUCT.md`](docs/specs/governed-priced-landings/PRODUCT.md)** - what the `/drink` and brand-by-area price pages may claim, and why `/area/{slug}` is held.
- **`docs/DEPLOYMENT.md`** — reproducible Vercel + Supabase + OpenRouter runbook.
- **[`docs/CRON_PLANE_RUNBOOK.md`](docs/CRON_PLANE_RUNBOOK.md)** - scheduler, auth, failure posture, and honest freshness boundaries.
- **[`docs/LOCAL_REFRESH_SCHEDULER.md`](docs/LOCAL_REFRESH_SCHEDULER.md)** - local launchd acquisition, resource gates, logs, and review-PR operation.
- **[`docs/WAYFINDER_LIVE_DATA.md`](docs/WAYFINDER_LIVE_DATA.md)** - source, cadence, gate, and staleness policy for every data class.
- **[`docs/REFERRALS.md`](docs/REFERRALS.md)** - private attribution, qualification, and the mark-of-honour law: a milestone confers recognition, never a capability.
- **[`data/README.md`](data/README.md)** - pint-price source lineage, app-dataset build, and fail-loud postcode-coordinate decision rules.
- **`docs/DEMO_DECK.md`** — demo script.
- **[`data/osm/uk/README.md`](data/osm/uk/README.md)** - UK-wide OSM seed-pack refresh, provenance, dedupe, and runtime shard generation.
- **[`public/data/price_history/README.md`](public/data/price_history/README.md)** - what earns a row in the hand-curated historical price file, where wave one came from, and what it yielded.
