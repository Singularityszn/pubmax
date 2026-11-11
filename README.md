# PUBMAXXING

**Every pint has a story.** A **price-aware, story-led London night-out map and pub-crawl planner**, with a pint-price hunt across covered UK cities. Pubs show listed pint prices; hand-curated bars, late-food institutions, and iconic restaurants use labelled, dated anchors for the item actually priced. Three layers share one living 3-D map: **price**, **setting**, and **story**, with visible provenance so history and legend never blur.

Pick a crawl style, filter, and either accept a **Suggested Crawl** or **Build your own** by tapping pubs, or load a curated **Featured route**. Any crawl is captured in the URL and shareable. Tap a pub to open **The Landlord**, a retrieval-grounded AI that tells the pub's real history and honestly says when it doesn't know.

## Features

- **Pub comparison** - open `/tools` to compare an order before choosing a pub. The [pub comparison guide](docs/PUB_COMPARISON.md) explains search, prices, walking routes and sharing.
- **Pub pictures** - the pub gallery, map venue sheet and pub page try usable real photos before showing an illustrated sign. The map sheet tries the pub website photo, then an available community photo. If no usable photo remains, the sign shows the real pub name and area, with no founding year, price or photo credit. Its accessible name starts with "Illustrated sign for" and names the pub. Photos with unknown provenance are skipped. The sign works without wild mode. Historic cover art stays behind wild mode.
- **Chain pub gallery** - each **from** price at `/pubs` shows its own recorded drink, stated serving, publisher and source-read day when available. The card uses evidence only when the evidence amount matches the shown price. The card labels missing facts without borrowing evidence from the menu link. Uppercase drink tags appear in title case. A recorded half keeps its amount and stays outside pint price bands. The source-read day does not confirm today's price.
- **Night preview selector** - these public browser choices do not grant account access. The master wild switch and the preview selection start off. To show the selector, open a page with `?wild=1`, such as `/plan?wild=1`. Desktop choices appear inside **More**. On phones, **Night preview** appears below the header on Home, Map, and pages with shared navigation.

  Choose **Round Rota**, **Borough Bingo**, or **Previews off**. Only one idea can be selected at a time. Pub Tarot remains deferred. See the [browser preview parameter contract](docs/MAP_URL_PARAMS.md#browser-preview-parameters) for link handling and storage limits.

  With wild mode on and Round Rota selected, a verified member of an open Round can use the tracker. It keeps a private turn order for that account and Round in the current browser tab. It records no money and does not share the order with the crew. The order survives a return or reload in the same tab when browser storage is available. Switching accounts clears the saved order.

  **Borough Bingo** extends the existing board on your own profile. With the preview off, the normal owner board stays unchanged. The selected preview replaces that board, so the page shows one board. It appears only for the verified owner after a Been read grants full access. Its 33 cells cover the 32 London boroughs and a free City of London square. Each marked borough links to a supporting pub from your Been list. The preview stays private and adds no score. Account changes hide the previous account's board immediately. The preview stays hidden while access is unresolved or refused.

- **Appearance** - use the sun or moon button in the header to switch between light and dark themes. Home and app headers expose it on desktop, mobile web and native layouts, with or without sign-in. You can also use **Appearance** on the You page or the theme control in the map's Layers sheet. The command palette's **Toggle theme** uses the same choice.

  Each control keeps your choice through in-app navigation, even when the browser cannot save it. The night clock does not override your choice. When the browser can save your choice, it survives reloads and updates other open tabs for this site in the same browser. Otherwise, a reload can reset it. Without a choice, the theme follows the [automatic night-theme rule](docs/DESIGN_SYSTEM.md#daynight-coherence). Day and Tonight select content independently of the visual theme.
- **Landing** - the hunt card compares recorded pint prices across UK cities on the map. It names the pub, price and source. The date says **Source read** for a listed price or **Price observed** for a confirmed community price. The current price may differ. Under it, **Plan a crawl** opens `/plan`. Below the fold, **Cheapest pint finds, city by city** shows each covered city's qualifying pint, or explains why no pint qualifies. Cities without prices show **No prices yet. Log the first one.** with a link to record a price. **London's dearest pint in our pub list** follows the city list. It compares each qualifying London pub's cheapest pint. The footer links to **London pub crawl routes** at `/crawls`. The old `/index` address permanently redirects to `/`. **Cheapest pints near me** opens nearby listed prices and asks for location (`/near?locate=1`). Directory browsing stays available without that prompt at `/near`. When a historical comparison exists, **Earlier prices** shows its sources and limits. When available, the listed-price comparison appears below the main answer with its collection dates. It compares the mean of each priced pub's cheapest listed pint with the mean for the sample's cheapest third. The gap is not a promised saving. A signed-in reader can also see their own total from logged prices. Below the savings section, **Find your next pub** links to borough guides, historic pubs, pub crawl routes and up to three published drink-price pages. If no drink page qualifies, the guide links remain. **Around London** links the founder's photographs to places on the map. Below the FAQ, **Play London film** starts the optional film. Its poster stays static until you request playback, including with reduced motion. **Log what you paid** opens `/map?log=1`. Choose a pub through **Search pubs** or **Near me**, then enter a price in the blank form. Opening this picker preserves the saved map camera. Pub-specific confirmation links keep their price seed. The picker requests location only after **Near me**, separately from travel-location sharing. It forgets that location when it closes or the map receives a new location.
- **Phone controls** - the phone has five tabs: **Explore** (the map), **Tonight**, **Plan**, **Social** and **You**. At large browser or native text sizes, the tabs show icons alone and keep their accessible names. Returning to the browser page applies default-font changes, including restoring tab labels when text becomes smaller. The map uses a [large-text layout](docs/rules/components-sheets-chrome-and-navigation.md#the-phone-map-rests-on-three-layers-and-the-bottom-card-is-the-answer) to keep names readable. Map sheets leave these tabs reachable. The **Pub Pal** button is in the top bar on every page that has one. On the map, the Pal button is above **Near me**, and **More map controls** also has **Ask your Pub Pal**. On the phone homepage, the top bar carries the Pal, so the floating Pal shortcut stays hidden there. Desktop keeps the floating shortcut. There is no floating **+** button. Save a Moment from **Social** or **You**, log a price from a pub's sheet or from **More map controls**, and start a plan on **Plan**. The tabs hide while the keyboard is open. A strict modal makes the tabs unavailable. In the map planner, the keyboard's Go or Enter key submits the outing description. Pub Pal uses compact headings while analytics consent is visible. On short phone screens, its portrait also shrinks.
- **You and sign-in** - the **You** tab opens your profile when your signed-in account has a confirmed handle. Otherwise, it opens the account page. A remembered profile does not sign you in. If the account check fails without a signed-in account, the page offers **Try again** and **Browse without signing in**. **Try again** reloads the page. In the iPhone app, request an email link there. Open it from Mail to return to the initiating app. After you cancel provider sign-in, you can retry with email or an available provider. See the [iPhone email-return contract](docs/rules/ios-native-email-return.md) for installation requirements and verification limits.

  After an offline start, reconnect or return to the app to retry the sign-in check. Once the check confirms you are signed out, you can retry **Continue with Apple** without restarting the iPhone app.

  On a signed-out map visit, **Sign in** can appear before the map pins. If the account check is unavailable, account status stays unresolved until pins appear or you leave the map. A failed check does not sign you out.

  If you are signed in and your profile check fails or takes too long, **You** and **Social** offer **Retry**. **Retry** checks your profile again without reloading the page.

  During account setup, a background session refresh keeps the handle you are typing. Switching to another account checks that account's setup status.

  If a remembered account is banned, a refused switch shows a ban notice with **Community guidelines** and **Dismiss** controls. This includes automatic switches after signing out. An expired sign-in alone does not show a ban notice. During account setup, the notice appears inside the form. **Community guidelines** opens `/terms` without the setup form covering it. Returning restores the unfinished form.

  Your profile has a cover, personal details, statistics and section links. Desktop places your passport beside your activity. Phones show activity first. Account settings follow both sections. The account button and signed-in account card use your public profile photo. Without an uploaded photo, they show your initials. Sign-in provider pictures do not replace a missing profile photo.

  In **Private account details**, you can correct your date of birth. If your stored date currently says you are under 18, you cannot change it to an adult date here. That refused save changes none of your private details. Other valid date corrections remain available. If the restriction blocks a genuine correction, contact [support](https://pubmaxxing.com/privacy#contact).

  If your profile cannot load pints, choose **Retry** to request them again. The button stays unavailable while the request runs.

  **Followers** and **Following** open a profile's people lists. A link under `/u/you/people/` returns to the account page. People lists ask search engines not to index them or follow their links.

  Shared cover links follow your **Who can see your profile** setting. The [account privacy rule](docs/rules/lib-identity-accounts-and-sessions.md#an-account-is-public-or-private-and-that-is-a-visible-choice-rather-than-a-prope) explains reader access and moderator previews.

  On the account page, **Bring this device** saves finished-night recaps as private Memories without publishing them. **Keep only on this device** leaves them local. If a save fails or you switch accounts during transfer, all device drafts remain. Earlier saves can appear in your Memories while the remaining recaps wait. Retrying with the same account reuses each saved Memory. A successful save refreshes your Memories without clearing the draft in the Memory editor.

  Switching accounts clears Mates' prices, presence rows, drinker-added regular-night rows and **Still on** receipts. The rows stay hidden until the new read finishes. Anonymous regular-night browsing remains available. See the [account read contract](docs/rules/lib-identity-accounts-and-sessions.md#the-signed-in-account-is-the-only-identity-authority-on-a-device) for implementation rules.

- **I'm here** - in a pub's map sheet, open **Overview** and tap **I'm here** to record a check-in. The [privacy notice](https://pubmaxxing.com/privacy#presence) explains who can see it and for how long.

  A successful check-in at another pub replaces your previous presence. A failed save does not confirm that you are here. Tap again to retry.

- **Control readiness** - Import, Near, and shared header buttons stay unavailable until page scripts can handle a click. Shared navigation links show a loading line while an accepted page change waits. If you choose **Meet your Pub Pal** while the session loads, the page keeps your request and shows a status message. The button stays unavailable while the request waits.

- **Day and Tonight navigation** - the main **Tonight** link in mobile, desktop and homepage navigation uses the selected city's clock. All currently selectable cities use Europe/London. After the page loads, the link opens **Day** (`/today`) from 04:00 until 16:00. It opens **Tonight** (`/tonight`) from 16:00 across midnight until 04:00. Both pages mark the **Tonight** tab as current. The link updates at minute boundaries and when you return to the app. The open page stays at its current URL. Explicit links, bookmarks and the **Day | Tonight** page links keep their destinations. The app saves no Day or Tonight preference. Before JavaScript starts, or when it is disabled, the main link opens **Tonight**. The listings and planner keep their existing 04:00 rollover. The greeting keeps its separate 05:00 morning boundary. These content choices do not change the visual theme.

- **Tonight** - the homepage card counts dated, pub-matched events from Tonight's primary and music lists. It counts each listing record once. It keeps pub recommendations and recurring deals separate from that count. With no events, it says **No pub events listed for tonight.** Available deals add **See recurring deals.** If both listing reads fail, the card says it could not reach the listings. `/tonight` opens with three answers: the cheapest pint near you, one confirmed listing, and the last train. When no confirmed listing exists, expand **Regular nights** for sourced rows or the current read status. The rows show their source and read date, separate from confirmed listings. Open plans come next, then the pubs Londoners keep recommending. Its first listing result or availability notice appears without JavaScript. Every pub shows its reason, source link and checked date, plus its cheapest listed pint and the day it was listed when we hold one. Pubs the map can open come first, with **Open on map** beside the area; a recommendation older than 120 days is left off. Expand the additional-pubs list to read the remaining pubs. The **Live music tonight** section shows up to eight cards on desktop and mobile. Its **Checked** date follows the [source-date contract](docs/rules/lib-venues-areas-listings-and-nights.md#a-checked-stamp-reports-the-freshest-confirmation-and-a-stamp-about-one-source-c). If that contract cannot date every card, the section says **No date on this yet**. Further down, **Tomorrow and the weekend** reads those listings when you pick a day, and open plans and the Drink Wall sit beside them (an old `/out` link redirects here, query included). When pub-matched live music appears below an empty primary list, Tonight names its listing count. Without that music, eligible chain listings below an empty primary list produce **Chain listings are available below.** Ended listings do not qualify. With neither music nor chain listings, successful empty event reads beside pub suggestions say **No confirmed events listed tonight.** When event listings lack a pub match, Tonight says **Some event listings are not matched to a pub.** Failed reads keep their own notices. **Today** (`/today`) shows daytime answers and links to Tonight for evening listings. See the [daytime page contract](docs/rules/lib-venues-areas-listings-and-nights.md#a-picks-section-is-four-words-and-tonight-is-the-one-surface-that-says-them). Both pages show **Page prepared** in London time. This time dates the server-prepared page. Source dates can be older. After the page loads, Today's London date and greeting follow the browser clock. The first Tube notice uses central London. After the page loads, Tube status uses your remembered area. It refreshes every five minutes while the tab is visible and when you return to it. See the [listing states](docs/rules/lib-venues-areas-listings-and-nights.md#a-picks-section-is-four-words-and-tonight-is-the-one-surface-that-says-them) for the Tonight empty-picks contract.

  On **Today**, each price in the cheap-pints and quiet-pint lists shows its recorded drink, serving and publisher. Listed prices show the full source-read date when recorded. Reported prices show the full observation date when recorded. A source link appears when available and safe. Missing facts are labelled.

  A reported price keeps its own evidence, even when a listed price has the same amount. The quiet-pint list keeps price evidence separate from its history source. Tonight uses the same quiet-pint list. These disclosures do not change price ranking.

  The cheapest-pint answer shows the selected drink, serving, publisher, source link and full observation day when available. Missing facts are labelled. For a nearby winner, these facts stay unavailable until matching pub details load. A failed or incomplete nearby search uses the London city answer when available.

  If a last-train refresh fails, Tonight keeps its previous answer for the same location until that answer becomes out of date. It then hides the train time. The **Last orders** panel asks you to check TfL. A different location does not use the previous location's answer.

  When Tonight has two or fewer confirmed primary listings, **Cheapest listed pints** shows qualifying London prices when available. Below 600 pixels, the prices appear on beer mats. At 600 pixels and wider, they appear on the pint belt. Each presentation carries the selected price's drink, serving, publisher link and full read date, or says when a fact is missing. The list remains available while a presentation loads or if it fails. Press Enter or Space to turn a beer mat over. With reduced motion, the back appears without a flip animation.

  Quizzes at different pubs remain separate cards, even when their titles and times match. Duplicate quiz listings at one pub share one card when their title, source and schedule match.

  Source credits count displayed primary and music groups once, rather than every returned event. When an Out read succeeds with venue matching ready and no pub matches, its credit says **No pub-matched events**. Matches hidden by display filters, including stale matches, prevent that claim. With no displayed groups, matched What's-on results use **Pub-matched listings**, including chain-only results. Each feed reports its own source date. A missing date says **The what’s-on source check date is not recorded.** or **The live listings source check date is not recorded.**

  Tonight counts pub listings hidden by the [source-age rule](docs/rules/app-proxy-csp-caching-and-file-tracing.md#the-answer-is-three-cards-then-a-pub-londoners-keep-recommending-then-our-own-listings). Its explanation distinguishes checks older than 24 hours from missing dates. The count excludes past events, unmatched listings, and duplicates of accepted listings. A stale-only result does not also claim that its source date is missing. Displayed listings with unknown source dates keep their notice beside unrelated exclusions.

  Known exclusions remain visible when the Out read fails, returns degraded data, or cannot match venues. Those failures retain their availability notices and do not receive successful-read credits.

  After Tonight's answer, **Your saved pubs** offers **Open your saved pub on the map** for the newest saved pub the map recognises. The link uses saves from this browser on this device, without reading an account's lists. It shows no private list labels, notes or raw venue IDs. Empty, unreadable or corrupt saves, or saves with no known map venue, produce no cue. Reading Tonight and following the link leave the saved-pub bytes unchanged. Without JavaScript, Tonight still shows its server-rendered answer and omits the cue.

- **3-D map** - pitched MapLibre view of London and supported UK cities. On a first visit, one card asks whether you want the cheapest pints near you: share your location, or choose an area. It stays away from a deep link or a planner handoff that already asks its own question, and a refused location hands you the area picker instead. The picker lists London neighbourhoods, searches localities, and offers the other city guides. A neighbourhood shows a pub count only once every pin behind that count has loaded, so a part-loaded map prints no figure rather than a low one; the area you pick is remembered on this device and names the map's own area chip. No point of yours is stored: a remembered "Near me" asks your browser again on the next visit. Curated London venues use distinct pub, bar, late-food, and restaurant glyphs. In Pints mode, equally relevant suggestions favour pubs with listed pint prices. The [map search contract](docs/rules/components-map-canvas-and-pins.md#a-camera-move-has-an-owner-and-the-map-a-reader-is-looking-at-loads-first) explains suggestion ranking, other drink modes, surrounding price pins and camera framing. In the toolbar search, **Close search results** or Escape hides results without clearing your query. Click the field to reopen them. The [map URL guide](docs/MAP_URL_PARAMS.md#history-and-filter-synchronisation) explains which state a return visit restores. The [map chrome guide](docs/MAP_CHROME_TIERS.md) explains listing counts. Searches for **The Blackfriar** and **The Black Friar** find the same London pub in Map and Pub Pal. Legacy `/pub/the-black-friar-blackfriars` and `/venue/the-black-friar-blackfriars` links open this pub. Name-only links that match multiple pubs return 404. See the [phone map controls](docs/rules/components-sheets-chrome-and-navigation.md#the-phone-map-rests-on-three-layers-and-the-bottom-card-is-the-answer) for the price answer, List, Plan, Tonight and the arrival card policy. A keyboard and screen-reader [List view](docs/A11Y_MATRIX_2026-07-18.md#follow-up-status) follows the venues currently visible through the map's filters and opens the same venue sheet as a pin. By default, the map is priced by the pint. The [venue price contract](docs/rules/lib-venues-areas-listings-and-nights.md#a-venue-kind-is-a-closed-list-with-one-owner-and-a-non-pub-kind-is-present-but-n) determines which prices use pint bands or relative item bands. The [cluster display contract](docs/rules/components-map-canvas-and-pins.md#a-cluster-is-a-neutral-disc-that-reads-from-its-cheapest-price-and-a-priced-pin-) explains price figures and venue counts at city zoom. A complete text key opens from the desktop map and, on phone, from Prices and places or More, so colour is never the only carrier. At street zoom, a venue with a sourced pint price prints the figure itself ("£5.40") on a pill with its band as a foot, or beneath its glyph when it is selected or wears a mark - bar, food, and restaurant anchor prices stay on the venue sheet, labelled, never printed as a bare figure. Choose another drink and both the colour and the printed figure follow that drink instead (see "Priced by your drink"). Kind filters can hide ordinary pins, while selected and deep-linked venues remain visible. Unverified UK pubs appear only after street-level zoom as quieter, unpriced rings. The phone's TfL control and Transit tab are available only on the London map. See the [CityMCP integration](docs/CITYMCP_LONDON.md#runtime-api-surfaces-app-facing) for desktop local-news display and transport request and recovery rules.

  If both map styles conclusively fail before the map loads, **Map tiles unavailable** appears without waiting for the fallback timeout. **Browse all pubs** and **Retry** appear before the fallback venue rows. You do not need to scroll those rows to reach either control. The pub list and the planner remain available. A pending or uncertain fallback request keeps its eight-second timeout. A map that already loaded keeps its existing recovery notice. On desktop, you can use that notice's **Retry** button while a pub drawer is open.

  The [saved map view rules](docs/MAP_URL_PARAMS.md#saved-map-views-and-location-privacy) explain which views can return and how location requests clear stored views.

  The map planner's toggle and desktop map button return to the previous sheet or the map root. On phones, **Map the route** does the same. A planner opened over a venue returns to that venue. **Home** returns to the map root, even after you reopen an earlier sheet.

- **Pub features** - open **Filters** on desktop or phone to select the following choices.

  - **Beer garden** uses listed pub records and dated OpenStreetMap facts.
  - **Outdoor seating** uses dated OpenStreetMap or Google Places facts and may mean a pavement or terrace.
  - **Live sport** uses dated OpenStreetMap facts. A listed sport flag without a named source does not qualify.
  - **Dogs welcome** uses quoted pub website policies and dated OpenStreetMap facts. Outside-only policies do not qualify. Lead restrictions may apply.
  - **Darts** and **Pool** use listed pub records.
  - **Open now** uses Wetherspoon's directory hours and keeps pubs with unknown hours visible.

  Missing feature details stay unknown and do not match feature filters, except for the stated **Open now** rule. Recorded sport and dog exclusions remain effective after pub details load. Views and fireplaces have no sourced filter coverage and remain unavailable. Water proximity, distance and pub names do not establish views. The controls count matching places loaded on the map, rather than a city-wide total. **Clear features** resets these choices and preserves your other filters.
- **Find your town** - open the city picker (`/places`) from the map's city chip or the footer's **Pick your city**, open a city and choose **Set as my city**. The picker starts with London for planning and takes city requests by email. Other cities can also have listed prices. Each city guide still opens by search and at its own map address. Desktop and mobile **Map** links follow that choice, including changes made in another tab. Choosing Manchester sends Map links to `/map/manchester`; without a stored choice, they open London. A bookmarked `/map` always opens London. Price-entry instructions are under "Log tonight's price" below. The city picker also searches the curated city guides and any other UK place with a mapped pub, without changing the city links or the geolocation path. A curated match keeps its full guide, prices and crawls; anywhere else opens the pub map at that place with the unverified UK pub layer streaming, and says plainly that no prices are logged there yet rather than implying the town was checked. Place names are OpenStreetMap locality tags already carried by the committed UK pub data (ODbL 1.0); see [`public/data/uk_base/README.md`](public/data/uk_base/README.md).
- **Typed venue anchors** - hand-curated bars, late food, and restaurants show labelled, dated, sourced cocktail, food, or signature-dish anchors, never disguised as pint prices. A restaurant's signature dish also seeds its Menu tab as a sourced, dated item. Open **Menu**, then choose **Food** or **Drinks** where recorded menus are available. **Menus** returns to the category choices and restores focus to your previous choice. Food rows show recorded sources and collection dates. Publisher-stated calories appear when recorded, without a health rating. Pint Drops and community price logging remain pub-only.
- **Food and drink subtotal** - in a venue's **Menu** tab, open **Add up food and drinks** when listed items are available. Choose an item, then enter a whole quantity from 0 to 100. Zero removes the item. An empty or invalid quantity keeps the item selected and shows **Incomplete** until you enter a valid quantity. **Clear items** removes all selections.

  Each selected item shows its publisher status and collection date, or states that the date is missing. The [price disclosure rules](docs/VOICE.md#the-mission-said-plainly) explain publisher labels and unavailable links. The subtotal uses listed menu prices and excludes community Pint Drops. Missing prices make the subtotal incomplete. A warning identifies prices that need a new check. The full cost stays unknown because required fees, tax, deposits and availability need checking. This does not confirm an offer or reservation.
- **Pub price reads** - the [price-read contract](docs/rules/lib-prices-trust-and-drinks.md) explains loading and failure wording in the phone peek and Overview. The Ledger uses the same price precedence. Its Price record keeps published prices and public pint reports separate, each with its source and date. Published prices name their recorded publisher under the [publisher disclosure rules](docs/VOICE.md#the-mission-said-plainly). Its historical comparison uses the selected price.

  A pub sheet can also show a published Guinness pint from Guinndex, including at an OpenStreetMap base pub. In the default beer view, the sheet shows the drink, serving, publisher link and recorded day, with a price-change warning. A visible community price takes precedence on a base pub sheet. The [base-pub price-read contract](docs/rules/lib-prices-trust-and-drinks.md#base-pub-price-reads) explains loading and failure states.

  London map pins with no existing price can show a qualifying Guinndex pint price. For a pub priced only by Guinndex, opening the pub or restoring the map preserves its pin price and cheapest-pint ranking.
- **Price estimates** - London pubs can show a labelled estimate when their available records contain no pint price. The [estimate guide](https://pubmaxxing.com/how-we-estimate) explains the methods and limits.
- **Pub website details** - open a pub's Overview tab and expand **Details and practical info** for its stated dog policy and opening hours. Website facts carry a **Pub website · Read <date>** credit, even when the read is old. A usable Google Places dog policy takes precedence at any age. Website hours appear when Google Places has no usable hours from the last 30 days. A day the website does not state says **Not stated**, rather than **Closed**. OpenStreetMap hours appear separately under **OpenStreetMap opening hours**. If any rule names a public holiday, this block shows the original OpenStreetMap text. A closing time such as `24:15` reads `00:15 next day`, while `24:00` stays unchanged. The **Pub features** entry above explains the separate map filter sources.
- **Priced by your drink** - the map answers cheapest pint by default. Pick another drink and pin colour, the printed pin figure and the cheapest-in-this-area list all follow that drink's trusted community prices, with every non-pint figure naming its drink ("£6 Whisky"). A pub with no trusted price for the chosen drink stays neutral and says so, never borrowing its pint or anchor price, and the price key reports whether the map-wide read finished, covered only part of the list, or failed, so an empty map is never passed off as a city with nothing logged. The max-pint-price filter and the pint refinements step aside while another drink owns the map, because a category price proves nothing about a brand, a subtype or a pint band. Only drinks the map can show and clear are offered as a view, so a category you can log but never see selected cannot narrow the map in silence. Cheapest-pint buckets and the Pint Index stay pint-only.

  Your drink choice in **Tune details** on `/plan` can appear in **Near me** on the same city's map. Choose **Show Wine on the map**, for example, to apply it. The map stays unchanged until you choose the action. Default pints and choices the map already shows need no action. A saved account alcohol-free preference takes priority over the device choice. See the [preference storage limits](docs/API_CONTRACTS_THE_LOCAL.md#9-getput-apimenight-profile) for device and account differences.

- **No alcohol and food views** - open **Filters**, then use **Show me** to narrow the map. The no-alcohol view keeps venues known to serve without alcohol, any pub with a corroborated soft-drink or alcohol-free price, and sourced food venues. The food view includes pubs and bars with recorded food service, plus late-food and restaurant venues. A recorded absence of food service excludes a venue. Soft drinks and alcohol-free drinks are their own logged categories, held to the same corroboration and freshness rules as a pint, and they colour and label pins like any other chosen drink. A food or dish anchor never prints on a pin: it stays on the venue sheet, labelled and sourced. A view's figure always names its drink or dish, and never reaches cheapest-pint buckets or the Pint Index. A pub with nothing logged says so plainly rather than implying it was checked.
- **Pub Pal** - typed chat starts with a greeting. Ask for four pubs in Soho to get grounded choices beside a map of those pubs. Follow with "Same area, under £6 a pint" to refine the budget. Open a result and return to continue the [current conversation](docs/rules/lib-saves-nudges-rounds-reports-and-pub-pal.md). **New conversation** clears the chat without deleting approved memories.

  <a id="pub-pal-new-picks"></a>

  For new picks in typed or voice chat, ask for "somewhere new", "places I haven't been" or "surprise me".
  When you are signed in with **Taste read** enabled, these picks exclude pubs in your diary, visible Pint Drops and **Been here** list.
  With **Taste read** off, Pal reads no visit history.
  Pal says, "I'm not using your history, so some of these you may know."
  Without history or sign-in, Pal says, "I don't know where you've been yet."
  If the history check fails, Pal says, "I couldn't check where you've been, so some of these you may know."

  <a id="pub-pal-age-requirements"></a>

  Creating a Pal requires sign-in and confirmation that you are 18 or over.
  If your stored date of birth says you are under 18, you cannot create a Pal or start voice.
  An adult confirmation cannot override that date.
  If the account date cannot be checked, both actions are temporarily unavailable.
  The map's voice chip stays hidden until the server confirms that the account date does not block voice.
  A failed check keeps the voice chip hidden.
  Adults and accounts without a stored date keep the same setup requirements.
  Pal setup records the adult confirmation time without storing a birth date in the Pal record.

  For a group table request, ask "A table for 8 near Soho on Friday".
  When Pal recognises one supported group size, known pub cards offer **Ask for a table**.
  This opens the pub's form with that size prefilled.
  If sign-in or handle setup is required, the table request link preserves the pub and group size through those steps.
  Opening the form sends nothing and confirms no booking.
  Keep the form open when you retry after a connection error.
  The [table request rules](docs/rules/lib-shared-seams-stores-http-freshness-brand.md#a-table-request-is-a-message-to-a-pub-and-only-a-send-counts-as-sent) explain delivery and contact fallback.

  Map Ask and keyless typed chat accept "Find three quiet pubs in Soho for tonight. Show the source and date for any price you use."
  The evidence instruction preserves your requested pub count and preferences. It does not require a recorded price for every pub.

  Ask "Cheapest pint near Soho" for cards with walk times when available.
  Each price shows its own recorded drink, stated serving, publisher and full source-read day.
  Missing facts are labelled in words. A publisher name does not provide a source link.
  These captions say **Link unavailable** when a publisher is recorded.

  For a named pub's drinks, listed pint cards in typed and voice chat show their own publisher and **Source read** date.
  Missing, invalid or future dates show **Source read date unknown**.

  "Hi show me the map" and "OK. Show me the map" focus the existing recommendation map when available.
  Otherwise, these commands open `/map`.
  A discovery or service request beside a generic map command stays in chat.
  "Map, not yet" and "Show me the map. Please stop." keep the conversation open.

  On `/pal`, choose **Share my year** to select lines for your Year in Pints card. **See the card** previews your choices. **Share the card** opens your device's share sheet or a WhatsApp draft. The [Year in Pints rules](docs/rules/lib-saves-nudges-rounds-reports-and-pub-pal.md) explain annual totals, privacy, and the free-forever commitment.

  Name a pub to ask about its recorded menu prices, servings, calories or dietary labels. Unrecorded details and current availability stay unknown. Meal and non-pint price comparisons across pubs remain unavailable. **Ask again** repeats a failed question while preserving your unsent draft.

  Map Ask and keyless typed chat accept questions such as "What are the opening hours of The Crosse Keys?"
  They return recorded regular hours with a source and checked date, or state that current hours are unknown.
  An unmatched or ambiguous pub name prompts a question. A failed record read produces a separate failure message.
  This lookup does not confirm live open-now status or holiday hours.

  Map Ask and keyless typed chat also read recorded late-food service for simple questions such as "Food in Soho tonight at 1am".
  The lookup accepts one recognised area and one clear time phrase, optionally with one ISO date.
  "Food after midnight near Soho" or "Food in Soho tonight" asks for a night and time when the area has records.
  "Food late in Soho tonight" checks 23:00 tonight.
  "Food late in Soho", "Late food in Soho", and "Where can I get late food in Soho?" use the same time.
  This default also accepts "late night" and "late-night" with one recognised area and no clock, date, or other night or day word.
  "Late" beside a clock, date, "tomorrow", or "today" keeps the existing handling and does not infer tonight.
  "After midnight" tonight checks 01:00. The answer names the time it checked.
  A reply such as "What about after midnight?" keeps the food question and moves only the time.
  Vague, repeated or conflicting times and dates also ask for a clearer night and time.
  A timed question asks for an area when the current conversation cannot supply one.
  Reply with an area, clock time or ISO date, such as "Soho", "1am" or "2026-11-07".
  Replies replace only the fields they name. A clock reply keeps unresolved day choices, so the answer still asks which night.
  Filters cover one category (pizza, kebab, cafe or restaurant) and recorded vegan, vegetarian or gluten-free labels.
  Unknown qualifiers, including "Chinese", and extra sentences stay part of a recognised request.
  If the record cannot confirm the whole request, the answer explains the missing evidence and returns no cards.
  Questions outside this parser keep the existing Ask handling, which does not establish food-service coverage.
  Late-food results show the source and recorded date, or explain that no current record qualifies.
  Check the service hours for your requested date before you leave. Recorded hours do not confirm live availability.

  Map Ask uses the same safety response as Pub Pal for sobriety and getting-home questions.
  It does not assess sobriety or recommend another drink.
  It points you to **Getting Home** on the venue sheet and retains sourced transport facts.

  <a id="pub-pal-map-chip"></a>

  On the map, tap your unmuted Pal's chip to start voice in place when voice is available. The chip becomes the voice bar. If voice is unavailable, the chip opens `/pal` with its writing option.

  Signed out, the map chip offers **Sign in to talk to your Pal**. **Close** hides this sign-in chip for the current page view. On another city's map, an unmuted Pal's chip says **Talks about London for now**.

  Voice starts only after your action. You can cancel startup or choose **Ask in writing** if voice cannot connect. The status line tells you when your chosen voice falls back to the default. Configured voice shows transcripts, returned pub cards and their map.

  Grounded voice results also show numbered picks on the main map and dim the other pins. Tap a pick to open its pub. The map frames the picks unless you hold or move it. [ADR 0014](docs/adr/0014-night-os-ask-agent.md#decision) defines voice view moves and actions that still need confirmation.

  During a voice call, ask to open the map or focus a numbered pick. You can also ask to open its pub page or clear the picks. Ask to move the view to a London area, such as Camden. The call stays live on the map. An unavailable pick or unknown area leaves the view unchanged and sends an explanation to the Pal.

  When pubs appear on the map, the voice prompt requests a brief reply and directs you to the remaining picks. Plan requests can receive longer replies.

  As the Pal names a pick during audio playback, its marker pulses and the map voice bar shows its returned price card. The card keeps the recorded price, source and date. Each repeated mention restarts the pulse without reframing the map. Talking over the Pal stops the pulses and clears the card. With reduced motion, a ring replaces the pulse.

  The [voice interruption guide](docs/PUB_PAL_SETUP.md#voice-interruptions) explains navigation between `/pal` and `/map`, map voice controls, screen lock, background calls, **Carry on**, and SDK startup.

  Memory cards in text and voice need your confirmation. Approved past-night reports can retain your stated visits, drinks and spending. Recorded pint prices never establish your bill. Correct or delete memories on your Pal page.

  Written chat shows your Pub Pal with the conversation. It uses the default companion when your Pal is unavailable. Switching accounts or signing out removes your Pal from open shortcuts, map markers, celebrations and postcards. The [cached Pal ownership rule](docs/rules/lib-saves-nudges-rounds-reports-and-pub-pal.md#cached-pal-ownership) explains the privacy checks. The composer waits for your earlier conversation to load. If restoration fails, **New conversation** lets you continue.

  Large portraits use the seven authorised original species models, with pointer and keyboard controls. Original images remain visible until the model draws, and return if it fails. Reduced motion and compact avatars keep the still artwork. Local browser acceptance and live voice verification remain separate requirements. The [setup guide](docs/PUB_PAL_SETUP.md) explains provider requirements and verification limits.

- **Crawl planner** - at `/plan`, describe a night, such as "Quiet wine in Clapham for 2". Choose **Plan it**. On a new plan, the description and primary action appear before **Already have a list of pubs?** and **Import a pub list**. Import opens a dialog and requires sign-in. Closing the dialog returns focus to **Import a pub list**. Before saving, [review the result, including incomplete routes, and check **Drinks** in **Tune details**](docs/rules/components-venue-plan-and-message-surfaces.md#the-plan-result-is-a-route-and-the-settings-sit-behind-it). You can choose an alcoholic drink category or the existing no-alcohol option. A non-beer selection leaves unavailable prices and route budgets unknown. For these nights or the no-alcohol option, leave **Max per person** unset: generation cannot prove that ceiling from the available reports. Saved community reports show their date and say when serving size is missing. First-run **Plan my night** opens the same planner with your selected area and budget. See the [generation limits](docs/API_CONTRACTS_THE_LOCAL.md#3-post-apiplansgenerate--grounded-plan-generation) for meal constraints and pint ceilings. The [budget search limits](docs/API_CONTRACTS_THE_LOCAL.md#budget-route-search) explain refusals for **Max per person**. The map also offers Suggest mode or Build mode. The [map URL guide](docs/MAP_URL_PARAMS.md#history-and-filter-synchronisation) explains planner closure, reload, and saved filters. Developer details and current persistence limits live in the [Plan price contract](docs/API_CONTRACTS_THE_LOCAL.md#selected-drink-price-evidence).

  Before using a quoted price, check its [serving, publisher and source-read date](docs/rules/components-venue-plan-and-message-surfaces.md#the-plan-result-is-a-route-and-the-settings-sit-behind-it).

  Choose the number of pubs with the stop picker or name the number in your description. The [draft recovery contract](docs/rules/lib-venues-areas-listings-and-nights.md#a-plan-may-be-one-pub-and-lib-planstopcount-ts-is-the-whole-vocabulary) explains how the planner restores your request. If a save notice appears, keep the page open to retain unsaved changes. If the latest description cannot be restored, enter it again.

  During **Lock it in**, stop edits, name and time fields, templates, and **Release this pub** are disabled. If the response is lost, you can retry the unchanged plan. If the planner requests a refresh, choose **Regenerate route**. Review the result before choosing **Lock it in** again.

  Use **Open in Plan** to continue a Pub Pal draft in the planner. The [draft handoff rules](docs/adr/0014-night-os-ask-agent.md#decision) explain how Plan handles your chosen pub, requested stop count, and incomplete routes.

  The [public venue checks](docs/API_CONTRACTS_THE_LOCAL.md#14-public-venue-eligibility) explain which venues the planner, hosted crawls and Pub Pal drafts exclude.

  The [account isolation contract](docs/rules/lib-identity-accounts-and-sessions.md#the-signed-in-account-is-the-only-identity-authority-on-a-device) explains what resets when you switch accounts or sign out with the planner open.

  If **Tonight near me** cannot select a checked area, type an area in the description. Choose **Plan it**. You can still make an editable draft. Check the [opening and travel notice beside the stops](docs/rules/components-venue-plan-and-message-surfaces.md#the-plan-result-is-a-route-and-the-settings-sit-behind-it) before you go. Restored drafts also show when these checks are unavailable.

  On a shared invite, **Open the plan** stays available when this browser restores guest access, including after a page reload.

  After the host chooses **Open it up**, the existing invite link opens the public crew page. Visitors ask to join there. The host accepts or declines each request.

  The route map's accessible description uses the areas recorded for its stops. It names every distinct area when the route crosses areas. If any stop lacks a specific area, the description omits geography. Search distance does not establish a borough boundary.

  If a signed-in member loses the Plan session cookie, a crew-status action can restore access without reloading the page.
  After the crew returns, choose the status again to save it. The failed action is not sent again automatically.
  A signed-out browser cannot restore lost access through an account. Open the host's invite link to join again.

  Crew-status changes, including **Here** on an open crawl, follow the [Plan status limits](docs/API_CONTRACTS_THE_LOCAL.md#crew-status).

  If Night mode refuses an arrival or skip after a route change, follow the [route-change notice](docs/API_CONTRACTS_THE_LOCAL.md#5-post-apiplansidactions--record-a-stop-action).

  A saved Plan needs at least two stops in one city to offer a walking route. **See the walking route** and the main **Map** link then open the saved stops. Unsaved edits do not change that destination. Each stop's **Open on the map** link keeps the walk and selects that pub. **Show whole walk** restores the route view on phones and desktop after you move the map or search elsewhere. If street routing is unavailable, dashed lines show stop order only.

  On a saved Plan with candidate pubs, open **Plan it together**. Choose **Compare journeys from broad areas**. The comparison starts off. Add broad London areas to see each pub's longest and average straight-line walking estimates from the area centres. Pubs without usable coordinates show **journey time unknown**. These estimates do not establish routed or step-free journeys.

  Starting areas stay in temporary local state. They never enter shared preferences, requests, URLs, browser storage or analytics. Switching the comparison off or changing the Plan or member clears the choices. The comparison does not change the route.

- **Sliding Doors** - on a saved Plan, open **Plan it together** and choose **Compare routes** under **How else could tonight go?** Compare the saved route with available checked alternatives for less walking or more pub history. Some routes have no suitable alternative. Distances are straight-line estimates, and missing prices and totals stay unknown. Choose **Send route for crew review** to propose an alternative. Crew votes leave the route unchanged. Only **Accept route** by the host saves the proposal. The accepted first pub, completed stops and required needs remain protected.
- **Find our table** - in Night mode, record **We are here** at the current pub. In the saved Plan or Night mode, the host can then choose a symbol and add a short note. Choose **Set table sign** to save it. Crew members can read the sign and open it full screen. The host can remove it. The sign clears when the night advances or the route changes, and expires within two hours. It describes the recorded arrival and does not track anyone's location.
- **Crew live location** - use **Share where you are** in a saved Plan, Night mode or an Open Crew. Choose **Share my location tonight** to request location access. When another member shares, **See your crew on the map** opens their dots. A confirmed **Stop sharing** ends your share. If a reload pauses an existing share, choose **Resume sharing** to send updates again. See the [privacy policy](https://pubmaxxing.com/privacy#collect) for access and retention rules.
- **London clue hunt** - choose **Turn clues on** in the saved Plan. In Night mode, first open **Clues and mystery stops**. The app checks for sourced landmark questions beside actual walking routes. Straight-line estimates supply no clues. Choose **Reveal answer**, skip individual clues or turn clues off. Nearby landmarks may not be visible or accessible from the path. Progress stays on the page and resets after a reload. Clues do not change the route or record visits.
- **Mystery envelopes** - the host can choose **Turn on mystery envelopes** in the saved Plan or Night mode's **Clues and mystery stops**. This shared setting hides future stop names. Each reader opens stops separately on their device. **Show full route**, prices, access information and the map remain available. Stamped completed stops stay revealed after safe route changes. Older Plans start with mystery envelopes off. All four night features are free.

- **Curated routes** - named Featured crawls load as ordered stops. The `/crawls` directory lists these routes without JavaScript. Each `/routes/{slug}` page includes the Pint Line, the crawl receipt, and **Plan this crawl**, which opens the existing map route. The stop list, diagram and receipt use the same selected row under the [comparable-pint rules](docs/rules/lib-prices-trust-and-drinks.md#comparable-pint-rankings). The receipt shows each selected pint's price, drink, publisher and full read date. Its per-person subtotal covers one pint at each priced stop. This subtotal does not cover the whole night's spend. The group total multiplies that subtotal by the selected number of people. An equal split gives the same per-person subtotal. Stops without a qualifying pint price show **No price yet** on the receipt and stay outside its subtotal. The receipt counts these stops and missing planned stops. Once all stops load, the featured card shows minutes as a **straight-line estimate**. This estimate does not follow streets. If any stop is missing, the card omits the estimate.

  On `/crawls`, the featured card and compact rows show a range of comparable listed pint prices. Each endpoint names its pub, publisher and full source-read day in London time. Drink and serving appear only when the slim index carries them. The page counts stops with a comparable listed pint. The evidence appears outside **Plan this crawl** links.

  An unavailable price read shows **Price evidence unavailable.** The page then omits ranges and coverage claims. A successful read with no qualifying prices states that none are recorded for these stops.

  Below the London routes, **Crawls in other cities** lists complete routes by city, with each route's name and stop count. Choose a route to open its ordered stops on that city's map. A route appears only when it has at least two stops and every stop has valid coordinates inside its city. Price coverage notes appear under each city's name. If every listed city has the same note, that note appears once below the section heading.

  A valid shared Crawl Story link shows the story instead of the directory. An unreadable shared link shows the directory, including available city routes.

- **Borough guides** - `/borough` names the pub behind each borough's cheapest qualifying pint. Each priced borough or pub row shows its selected drink, serving, publisher and full source-read or report date. Missing facts are labelled. Source links appear when available and safe. Pub rows on `/borough/{slug}` keep their price order, map links and price-history links. Non-pint amounts remain visible without a pint price colour. When available, the CityMCP average shows its own full London day, separate from any cheaper local pint and its evidence. Dates remain unavailable when a timestamp has no stated timezone.

  On `/borough/{slug}`, each cheapest and dearest pint shows its own drink, serving, publisher and full read day. Missing facts are labelled. The average states its pub count, publisher coverage and full-read-day coverage. The visible FAQ and its structured data use identical answers. The borough share image uses the same average and cheapest pint, with their evidence captions. The [price population contract](docs/rules/lib-prices-trust-and-drinks.md#comparable-pint-rankings) explains which prices enter the average and priced-pub count.

- **Pubs near me** - `/near` compares nearby listed pints, cheapest first, under the [comparable-pint rules](docs/rules/lib-prices-trust-and-drinks.md#comparable-pint-rankings). Each priced result shows its recorded publisher status, while one shared date tells you when the Venue Dataset was collected. When the price answer names different pubs with the same name, it adds a recorded street or area when available. This applies to the summary and result rows, including names that differ only by a leading "The". Location stays on the device, and a denied or unavailable location falls back to a remembered or default area. An optional price check loads separately once the app confirms sign-in and Pint results appear. The Pint results stay available while the price check loads or if it fails. If it fails to load, choose **Try again** to retry the price check.

  With a location, **Nearest listed pub** separately names the closest public pub in the available list, including pubs without a pint price. It shows distance and an estimated walk based on straight-line distance, without a price. On `/near`, it uses the current city's listed pubs. On the map, it uses the pubs allowed by the current filters, including **Saved only**. It does not claim the nearest pub outside that list. **View pub** opens that pub on the map.

  Area answers hide the nearest result. A location update also hides it until a new location answer arrives. When map filters change, the answers refresh for the same location or area without another location request.
- **Lucia 🐐** - open **Drink** on the map. Under **Soft drinks**, choose **Lucia 🐐** for the Coke Zero and Diet Coke price list. The link opens `/soft-drinks-and-water?sub=soft-drink-lucia-special` on mobile and desktop. The mobile Drink panel opens at full height.

- **Spoons** - choose **Spoons** under **More** in the home footer at any screen width to open `/spoons-value`. The desktop Spoons tab opens the same page. On a phone, you can also open **Drink** on the map and choose **Spoons value**. Search the published ranking by pub, town or postcode. Open **Round costs** to read each drink's recorded cost and units, the round total and the source date. These figures come from SpoonMe's dated report, so prices may have changed. They describe recorded rounds, not complete current menus. The page links each matched pub to the Spoons map.

- **Somewhere to sit and work** - the same `/near` page asks a second question. A Pint or Desk switch at the top opens Desk mode (`/near?mode=desk`), which ranks London cafes, coworking spaces, libraries, hotel lounges and wifi pubs by the same on-device locality, then keeps at most one venue per chain in the answer so five results are five different places. A card says only what OpenStreetMap stated: the amenities it knows ("Wifi: yes"), or "No amenity data yet" when it knows none; one plain hours line for right now ("Open until 22:00", "Opens 07:00", "Closed today" or "Hours unknown") with the raw OpenStreetMap string behind "Full hours"; and the date the data was checked. Nothing here records how busy a place is. Pint stays the default, the chosen mode is remembered on the device for a bare `/near` (a shared link that names a patch, a locate request or a poster scan opens the mode its URL says), and the answer credits OpenStreetMap contributors (ODbL 1.0). See [`public/data/london_desks/README.md`](public/data/london_desks/README.md).
- **Cheapest pints of one beer** - `/drink/{brand}` lists the cheapest listed pints of a named beer in London. Its area-specific pages appear under the [publication contract](docs/specs/governed-priced-landings/PRODUCT.md#which-pages-exist). Each ranked figure comes from its own price row. Each row shows its publisher status, and one shared date describes the Venue Dataset. Those area pages can also show a separate estimate. A combination without enough priced pubs is a 404 rather than a thin page. Nothing here is a community submission and nothing here moves the map, the cheapest-pint buckets or the Pint Index.
- **Shareable URLs** - the URL preserves the whole crawl state. **Copy link** shares it. Shared `/map`, `/pal` and `/tonight` links use their own page titles and artwork.
- **Rounds** - a shared beer mat for the buying rotation: whose turn is up, who bought last, what each round cost, and an immutable night diary. A map route or member-only active Plan can start one with its title and ordered stops already queued. While the Round is open, anyone with the code can add diary lines. The current composer keeps drink lines in the diary. The [Round contribution rules](docs/rules/lib-saves-nudges-rounds-reports-and-pub-pal.md#a-round-records-spend-never-debt) govern community-price promotion and its evidence requirements. No balances, IOUs, or settling up.

  If starting a Round fails, try again in the same form without changing its details. The attempt reuses any Round already created.

  On the map, **Tonight's Round** links to the saved Round. Its checks pause while the tab is hidden or the shortcut is dismissed. Returning to the tab checks again. Dismissing the shortcut keeps the saved code. A missing or closed Round removes the shortcut and its saved code.

- **Diary** - sign in, open a pub's sheet and choose **Log this visit**. Pick the London day you were there (today by default), an optional rating from 1 to 5 in half stars, and an optional line of up to 280 characters. One pub logs once per day; a second log for the same day is refused. Entries are private: only you see them, listed on your own profile where you can edit the day, rating or review. You can also remove the entry. The pub stays fixed, and the account export carries the entries. The [contribution access rules](docs/rules/lib-identity-accounts-and-sessions.md#contributing-asks-two-questions-and-the-age-one-is-the-10-aug-rule-s) also apply to Diary.
- **Wanted** - choose **Save for a night** on a venue sheet. You can also paste a link or venue name into Wanted on your own profile. Sign in and choose a handle to keep the private list. Open rows let you edit the note, open the saved link or remove the place. Fulfilled rows keep the saved link and removal control, with no note editor. [Contribution access rules](docs/rules/lib-identity-accounts-and-sessions.md#contributing-asks-two-questions-and-the-age-one-is-the-10-aug-rule-s) govern the age check.
- **Pint Drops** - community photos, the price you paid, and a passed-down note, moderated. New priced drops start as not checked. When bill reading is available, the app checks an attached bill after saving the drop. A matching read earns receipt evidence. Mismatches enter the admin **Bills** queue, and unreadable bills leave prices not checked. The [bill check rules](docs/rules/lib-prices-trust-and-drinks.md#a-bill-earns-receipt-only-when-it-shows-the-price) define matching, retries and failure behaviour. Your Pint Passport counts distinct London boroughs across the author's complete attributed drop history that you can view, including visits outside the timeline. Other drop statistics use the capped timeline. Another person cannot see your anonymous drops through your profile or contribution totals. Sign in to include them in your own timeline and contribution totals. A City of London visit counts once and changes the label to **Boroughs + City**. Without a City visit, the label stays **Boroughs**. Shared passport text names the City separately. Drops with no recorded London borough or City do not increase this count.

  After a lost response, retry the Pint Drop without changing its details or attachments. The app can return the saved drop. Changed retry details are refused. See the [creation retry contract](docs/rules/app-api-contract-and-rate-limits.md#keyed-pint-drop-and-round-creation) for attachment limits.

  Choose **Friends** to share notes with people you follow who also follow you. **Legacy** keeps an entry in the pub's Ledger. Other people see the entry without your note or price. Anyone with a photo's link can open it while the link remains valid.

- **Venue price stories** - open a pub's **Prices** tab to see **The Golden Thread**. Each listed or updated price keeps its own drink, serving, publisher and source-read day. A drinker report keeps its own drink, serving, attribution and log date. Missing facts are labelled. Another row never supplies missing evidence, even when its price matches. Only reports for the selected pub count.

  A change requires the same named drink and serving, positive prices, named publishers and valid dates in order. The report must follow the earlier record and remain within the [community-price freshness window](lib/priceAuthorityWindow.ts). Demo prices and anecdotes cannot establish a change. Otherwise, two displayed records show **Price comparison unavailable**, without an arrow, comparison bars, percentage or spoken change claim. A memory's era does not date its logged price, so the story shows no inflation adjustment. Source reads and reports do not confirm today's price.
- **Offline pages** - with a registered service worker, previously cached public `/plan/<id>` previews can reopen without signal. Cached landing, Map, Tonight and offline fallback pages can also reopen.

  Nearby links (`/near`, with or without query parameters) need a connection. When navigation fails, the service worker shows the cached offline explanation. If that page is unavailable, it shows a plain offline error.

  A Map link for a town, national browse or share card needs a cached document with the exact same query. If that document is absent when the network fails, the worker uses the cached landing page or offline fallback. These Map links wait for the network result and never use the timed cache fallback.

  Pint Drop pages (`/p/<id>`), nested plan pages and member details need a connection. Plan previews cached before the privacy repair are never reused. Eligible previews from the trusted cache family remain available if migration writes fail. The [Plan cache header](public/sw-plan-cache.js) owns eligibility and retirement details. See the [Capacitor wrap guide](docs/CAPACITOR_WRAP.md) for native-shell availability, outage fallback and retry rules.
- **Drink Wall** - `/wall` is a city-wide photo grid of pints, pub fronts and London views. Anyone can browse; signed-in contributors post through the same moderated photo pipeline as pub walls, and a photo on a pub wall also appears here. On a pub wall, choose a photo and crop it. **Use photo** accepts the crop. Add an optional drink tag and caption. Choose whether to share to your feed. Choose **Post photo** to publish. Pub-linked posts show on both walls. **Remove** on your own photo removes it from both walls.

  On the Drink Wall, selecting a pub moves keyboard focus to **Remove**. Removing the pub or cancelling its search with **Cancel** or Escape returns focus to **Link a pub**. Cancelling the photo form returns focus to **Add a photo**. If a filter is still loading and that button is absent, focus returns to the wall heading. Caption edits keep focus.

  Switching accounts clears the unsent photo, caption and pub selection. Cancelling the photo form or switching accounts prevents a delayed crop from starting an upload. Results from an earlier photo selection or upload cannot change a newer account's draft.

- **Social** - `/social` is the canonical mobile and desktop Social shell, live by default with chronological Following, Nearby, and Across town lanes plus public pub discovery. Full posts and private activity stay closed unless the server confirms Social access; set `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` only for an emergency preview rollback. `/feed` and `/stories` now lead to this shell; `/discover` and `/drinks` open its Discover view. Plan joins use the [host connection policy](docs/prd/SOCIAL_LAUNCH_PRD.md#wp7---friend-graph-formation-crews-search-invites-m-l). Each new follow created by a join gives the person followed a private follow entry in `/activity`. Notification storage failures can prevent delivery. Existing follows and join retries add no duplicate entry. The entry names the follower and carries no plan or membership details.

  Available Social notifications appear in **Activity** in the desktop sidebar.

  For open crawls, a new join request notifies the host, and an acceptance notifies the guest. Each notice links to the crawl page. Delivery uses Activity and, when [email is configured](.env.example), the recipient's account email. A decline, cancellation or replay sends no notice.

  Delivery is best effort and does not block the join action. Missing email settings do not prevent in-app delivery. These notices do not use push.

  Open crawl links at `/social/crews/<crewId>` have an image preview for sharing on Luma, X and other services.
  Anyone can read the [public crawl details](https://pubmaxxing.com/privacy#crews) without an account.
  Choose **Ask to join** to request a place. The host accepts or declines the request.
  Crews that are not open and failed reads show a plain PUBMAXX image instead.

  See the [Crew membership rules](docs/WRITE_SURFACE_CERTIFICATION.md#social-crew-authority-routes-routes-81-89) for invitation closure and returning after leaving or removal.

  On the night, accepted open-crawl members can choose **I'm here** on the crew page.
  The control marks your own place **Here** and does not undo an arrival.
  See the [arrival API contract](docs/WRITE_SURFACE_CERTIFICATION.md#appapisocialcrewscrewidarrival-route-89) for the arrival window.

  If the signed-out London feed is empty, its [public next actions](docs/design/LAUNCH_SCREENS.md#social-action-order) appear before the body sign-in offer.

  On phones, posts appear before crews and other supporting tools. Desktop keeps those tools beside the feed. The Posts view links to **Messages**, **Your Pub Pal**, **Plan a crawl**, and **Save a Moment**. **Post** opens a composer with visibility guidance and a character count.

  Private tools show placeholders during download, including a disabled **Edit post** button on post cards. The [Social loading rule](docs/rules/components-design-system-and-launch-primitives.md) explains when downloads start. The reel viewer downloads when you open a reel. If a download fails, **Try again** retries that tool while the rest of Social stays available. Closing a reel returns focus to its opening button if that button remains on the page.

  If another tab updates your identity for the same account, the composer stays open while Social checks access again. A failed check or a changed access result can still close it.

  **A pub worth sharing** and **Who's about?** add text to an empty new draft without publishing it. Failed comment and reaction reads have separate retry controls. **Find your lot** can retry a failed handle search without a new query. Crew phase filters and counts appear only when the complete list contains more than one crew.

- **Messages** - sign in with a claimed handle, open `/messages`, and choose **New message**. Search by at least two characters of a public handle, then select people from the results or your recent direct conversations. Select one person and choose **Chat**, or select two to eleven people and choose **Create group**. Groups include you and can have an optional name. Members can leave, but nobody can be added after creation. **All**, **Unread**, and **Groups** filter your existing inbox. **Search conversations** matches displayed names, handles, or group titles within the selected filter. The search and filter reset when you change accounts. In an empty conversation, **Share a pub** and **Share a plan** open the existing pickers. These buttons do not send a message or replace your text draft. The [navigation rules](docs/rules/components-sheets-chrome-and-navigation.md#the-primary-row-is-five-doors-and-the-header-carries-only-what-has-something-beh) explain when unread badges refresh.

  In a direct or group chat, tap, hover over, or focus one of your sent messages. Choose **Unsend** from the revealed actions. Confirm the removal. Everyone sees **Message unsent** instead of its text or attachment. The [permission matrix](docs/security/PERMISSION_MATRIX.md) explains access to reported content after an unsend.

  Open **Chat options** in the thread header. Choose **Delete chat**. Confirm to remove the chat and its existing history from your view. Other participants keep their messages. A later message restores the chat in your inbox with only the messages sent after deletion. Deleting a group chat keeps your membership. Choose **Back to inbox** to see later messages after deletion.

  To stop receiving group messages, open **Chat options**. Choose **Leave group**. Confirm your departure. Your earlier messages stay for the remaining members. After deletion or departure, the thread shows a confirmation until you leave that view or change accounts.

  If PUBMAXX cannot check your profile, the inbox shows a retry action. A failed refresh keeps previously loaded conversations. Within the inbox limit, a failed check for new messages in one deleted chat keeps that chat and the others visible. Messages from before deletion stay hidden, and the inbox shows an availability notice. When the check succeeds, the restored chat sorts and displays its newest message time.

  Use **Add an attachment** on a phone or **More to attach** on desktop to open the attachment chooser. It appears as a bottom sheet on phones and a centred dialog on larger screens.

  If a send fails, check the restored draft before choosing **Send** again. The [message retry rules](docs/rules/lib-shared-seams-stores-http-freshness-brand.md#message-retries) explain duplicate protection and its limits.

  A suspended account cannot start a conversation or send a message. If PUBMAXX cannot check suspension, it refuses the send and asks you to retry.

- **Founders wall** - `/founders` keeps the first hundred claimed handles on public record. Social Posts and Your PUBMAXX link to it.
- **Log tonight's price** - on the mobile map, open **More map controls**, choose **Layers**, then **Log a price** to keep the map's city and selected drink. Choose a pub if none is selected. **Search pubs** keeps the request active while you search; **Show all pubs** clears constraints but keeps the drink category. Wine and cocktail requests open their own price forms, and sign-in returns to the same city, pub, and drink. You can also tap **Add price** from a pub's sheet, choose a category, and enter the price. Each accepted submission shows on the pub's own page instantly, on its own dated row, never overwriting the price on record. The [paired-save rules](docs/rules/lib-prices-trust-and-drinks.md#what-a-community-price-is-allowed-to-move-is-a-policy-not-an-implementation-deta) explain how pint prices and Pint Drops save together, including failed saves and older-price refusals. [Contribution access rules](docs/rules/lib-identity-accounts-and-sessions.md#contributing-asks-two-questions-and-the-age-one-is-the-10-aug-rule-s) govern the sign-in, handle and age checks. A first pint report also marks the pub's pin at once with a small unconfirmed dot, but the pin's colour and card restamp with a dated community badge only once a second independent drinker logs the same figure, and a community price over 30 days old hands the map back to the price on record.

  The [price mission rules](docs/rules/lib-prices-trust-and-drinks.md#a-price-evidence-mission-is-one-useful-community-price-task-never-a-reservation) explain which tasks remain available after you contribute.

- **Contributor record** - `/contributors` ranks public profiles by visible price logs, Visit Reports and weather Recommendations added together across all time. Equal totals share a place. Legacy price rows without a handle and hidden contributions stay off the record; detailed attribution and retention terms live in the [privacy notice](https://pubmaxxing.com/privacy).
- **Invite a mate** - signed-in accounts can share an account invite link. A same-journey new-account signup can record a private referral edge. Reaching 1, 3 or 5 qualified referrals earns a mark of honour on your own account surface and nothing else: nothing in the product is behind it. [`docs/REFERRALS.md`](docs/REFERRALS.md) owns the attribution, qualification, and recognition boundary.
- **What drinkers noticed** - a quiet panel on the pub's sheet holds four community observations that decide whether you walk in: rough or posh character, step-free access, door policy, and whether people were eating. They read as drinkers' reports and never as venue facts - character always names whose judgement it is, entrance and toilet access are separate questions because British pub toilets are often reached another way, and an access question stays plainly unknown until a second independent drinker confirms it, however old a lone report gets. Reading stays public; adding a report follows the same contribution access rules as community prices, and none of it moves pin colour, price bands or the Pint Index.
- **How busy is it right now** - a pub's sheet asks one question and takes one tap: Empty, Some seats or Full. Reporting needs a signed-in account; anyone can read the answer. The reading is always dated ("Some seats · 12 min ago") and only a report under 90 minutes old may answer for now, so an older one reads "No fresh reading" rather than passing as tonight. A read that failed says it could not check, never that nobody has reported. Crowd reports move nothing else: not pin colour, not price bands, not the Pint Index.
- **What it used to cost** - the homepage and pub sheet show dated historical pint prices with their sources beside current figures where available. When the evidence cannot establish the same pint, both figures remain and a note explains why the app claims no price change. A pub with history but no current price still shows the old figure alone. A bar or food venue's anchor price never becomes a current pint figure. See the [historical-price contract](public/data/price_history/README.md) for comparison requirements and the boundary between historical and current prices.
- **Pint Index** - `/pint-index` ranks London boroughs by observed pint price, with a TfL fare-zone median strip beside it and a dearest-end view of the same league. Only prices carrying a public source and the day they were seen are eligible, which is stricter than the map: an area can post a zone median and still sit empty in the league. Every closed month freezes into its own dated page so a quoted figure stays quotable, and the live page and each dated edition publish `Dataset` structured data, with a CSV download whenever they hold rows. Cited national benchmarks sit above the league as somebody else's figures, each naming who counted it and when, never merged into ours.
- **Price coverage** - the map's **Drink** control counts pubs loaded so far. Pints use prices on record. Other drinks use confirmed prices from drinkers. Coffee and alcohol-free drinks also show a separate Listed menu count. Its source-read date names the newest eligible listing among loaded pubs. A failed menu read shows an unavailable message. The Shoreditch café count stays separate. Pint Index also shows coverage across its London pub list, including listed prices and published menus. Each pub counts once per drink. This total is not every pub in London, and it is separate from the borough league and CSV. Partial reads disclose incomplete counts. These listed prices do not promise today's price.
- **The Landlord** - pub-history answers use recorded facts and keep dates attached to their sourced events, without calculating present-day ages. For typed history questions, use a complete listed pub name or recorded alias. A shared name such as The Lamb asks you to choose a pub on the map. An unlisted name produces no pub card. An unlisted or ambiguous name does not discard another uniquely matched pub in the same question.
- **Report a person** - when signed in, open **Report @handle** on a profile or crew page and choose a reason. If several people are listed, open **Report someone** and choose the person first. The public crew preview offers a report for its host. A report enters the moderation queue without blocking the person or removing content.
- **Moderation** - reports from two distinct signed-in accounts hide a Pint Drop; anonymous reports queue it for moderator review without auto-hiding it. The `/admin` console reviews hidden drops. A community price or a drinker's pub observation can also be reported by anyone, but never auto-hides: only a moderator hides it (hide, never delete) through the moderator-gated admin API, one queue for both shapes. Social reports and flagged DMs have separate queues in the same console. The [Social moderation guide](docs/SOFT_LAUNCH_RUNBOOK.md#52-social-moderation-rota) covers those controls.

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

For PUBMAXX Night Architect in ChatGPT, see the [integration and pilot guide](docs/integrations/chatgpt-night-architect.md).
The separate loopback prototype retains its [public map setup guide](scripts/chatgpt-map/README.md).

Useful scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run typecheck` | Checks project types; [compiler compatibility](next.config.mjs) explains how this differs from the Next build check |
| `npm run verify:no-mistakes:changed` | Runs change-scoped checks before push. See [verification policy](AGENTS.md#verifying). |
| `npm run verify` | Full checks for CI or an explicitly requested local run. [`package.json`](package.json) defines the sequence. `test:rls` and `db:types:check` need PostgreSQL 16; a host that genuinely cannot install one sets `PUBMAX_RLS_ALLOW_SKIP=1` to admit the skip out loud, because a skipped policy proof reported as a pass is what let an RLS hole live for four days |
| `npm run ci` | `verify` + build, for an explicitly requested full local check. [`vercel.json`](vercel.json) defines Vercel's build command |
| `npm run ci:isolated` | Collision-safe keyless `ci` in a unique temporary Next dist directory; restores Next-managed tracked files |
| `npm test` | Vitest unit suite ([PostgreSQL suite inventory](scripts/rls/postgresSuites.mjs); those suites boot throwaway PostgreSQL 16 clusters, `PUBMAX_PG_MAX_CLUSTERS` caps concurrency, and `PUBMAX_RLS_NO_PG=1` skips them) |
| `npm run test:chatgpt-map` | Installs the pinned local MCP package and runs its Node tests; included in `verify`. Separate browser proof is described in the [setup guide](scripts/chatgpt-map/README.md) |
| `npm run test:landing-transport` | Checks font transport ordering with synthetic HTTP fixtures. Included in `verify`. Real-font browser checks remain in [the landing spec](e2e/aperture-splash.spec.ts). |
| `npm run test:e2e` | Playwright browser suite, including UI and accessibility guards (builds, starts, drives Chromium) |
| `npm run test:e2e:plan-auth` | Disposable local Plan authentication and recovery checks. See the [recovery guide](docs/testing/signed-in-review.md#disposable-plan-recovery) for requirements, configuration, and cleanup. |
| `node scripts/e2e/run-disposable-plan-browser.mjs` | Wine and cocktail persistence and forged-hint browser checks against disposable PostgreSQL/PostgREST. Requires local PostgreSQL 16, PostgREST, and Playwright Chromium. Builds an isolated production server, applies the [fixture's migration range](scripts/e2e/disposable-plan-db.mjs) only to its temporary database, and cleans up its server, database, and build directory. Results stay in `test-results/`. |
| [Signed-in review harness](docs/testing/signed-in-review.md) | Seeded local authenticated browser review |
| `npm run shots` | Generates 390/1440 light/dark Gate-Z screenshots under ignored `artifacts/screenshots/` for upload to the PR. Map captures require a painted pub mark |
| `npm run shots:extended` | Runs the same gate with the 430/1280 breakpoint audit |
| `npm run setup` | Enables the optional pre-push hook (`core.hooksPath=.githooks`). See the [verification policy](AGENTS.md#verifying) |
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

On phones, tap the map credit control to expand its text and links. The Pub Pal shortcut hides during expansion and returns when the credit closes. On desktop maps, the shortcut hides while Layers or the venue drawer is open, keeping their actions reachable.

## Demo data

The community layer includes optional demo Pint Drops and Featured crawls. Enabled demo content carries a `demo` tag and stays visibly distinct from contributor activity. It cannot affect price or story metrics. Provenance chips distinguish `Sourced`, `Contributor`, `Anecdote` and `Demo` content.

Seeded content is opt-in: it renders only in a build where
`NEXT_PUBLIC_DEMO_CONTENT` is the literal value `on`, in lists and by id. Leave
it empty or `off` in both Vercel Preview and Production. Set it to `on` for a
local keyless demo; the e2e server sets it itself. The setting is read at build
time, so a change needs a fresh deployment.

## Deeper docs

- **`docs/teach.md`** — full repo tour: architecture, data model, map lifecycle, backend, trust boundaries, with `file:line` anchors.
- **[`docs/MOBILE_FLOW_SPEC.md`](docs/MOBILE_FLOW_SPEC.md)** - mobile transition, Back, and state-preservation principles.
- **[`docs/MAP_URL_PARAMS.md`](docs/MAP_URL_PARAMS.md)** - map URL ownership, validation, and history rules.
- **[`docs/specs/governed-priced-landings/PRODUCT.md`](docs/specs/governed-priced-landings/PRODUCT.md)** - the publication and redirect contract for beer and area pages.
- **`docs/DEPLOYMENT.md`** — reproducible Vercel + Supabase + OpenRouter runbook.
- **[`docs/CRON_PLANE_RUNBOOK.md`](docs/CRON_PLANE_RUNBOOK.md)** - scheduler, auth, failure posture, and honest freshness boundaries.
- **[`docs/LOCAL_REFRESH_SCHEDULER.md`](docs/LOCAL_REFRESH_SCHEDULER.md)** - local launchd acquisition, resource gates, logs, and review-PR operation.
- **[`docs/WAYFINDER_LIVE_DATA.md`](docs/WAYFINDER_LIVE_DATA.md)** - source, cadence, gate, and staleness policy for every data class.
- **[`docs/REFERRALS.md`](docs/REFERRALS.md)** - private attribution, qualification, and the mark-of-honour law: a milestone confers recognition, never a capability.
- **[`data/README.md`](data/README.md)** - pint-price source lineage, app-dataset build, and fail-loud postcode-coordinate decision rules.
- **`docs/DEMO_DECK.md`** — demo script.
- **[`data/osm/uk/README.md`](data/osm/uk/README.md)** - UK-wide OSM seed-pack refresh, provenance, dedupe, and runtime shard generation.
- **[`public/data/price_history/README.md`](public/data/price_history/README.md)** - what earns a row in the hand-curated historical price file, where wave one came from, and what it yielded.

### Walking-route refund rollout

See the [walking-route refund prerequisites and rollback](docs/SOFT_LAUNCH_RUNBOOK.md#walking-route-refunds) before production rollout.
