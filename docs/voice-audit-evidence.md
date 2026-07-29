# Voice audit evidence

This file records evidence for the copy audit against `docs/VOICE.md`. It covers claim-shaped copy changed between `c1b5566df425a84a3fc90f76bd7220e301ee54d1` and this branch, plus indirect user-facing string owners inspected during the audit.

## Claim guarantees

Repeated variants are grouped only when they make the same claim and read from the same guarantee.

| Changed claim-shaped copy | Surface | Exact guarantee |
| --- | --- | --- |
| “one sourced fact each”; “cited pub heritage”; “Every price and every fact shows where it came from”; “Cited history”; “Cited from Wikipedia” | About, historic pubs, crawls, discovery | `lib/aboutStats.ts` counts historic records with citations; `lib/heritageCrawls.ts` and historic venue records carry source URLs; rendered heritage provenance comes from those source fields. |
| “Listed pint prices with named sources”; “Listed pint prices on PUBMAXX”; “Listed pint prices on an interactive map” | About, map card, landing, onboarding | Current price rows expose their source through `VenuePrice.source`; community rows carry contributor provenance; `components/map/VenuePriceStory.tsx` renders that provenance. Copy says listed, not live or observed today. |
| “Nobody pays to rank”; “The order of pubs on your map is never for sale”; “sponsored items sit in their own labelled slots” | About, terms | Map and list ranking functions consume venue, price, distance, filter, and community-signal inputs, not payment fields. Sponsored content uses separately labelled slots rather than the venue ranking pipeline. |
| “Nothing in here nudges you to drink more” | About, terms | Product actions record prices, visits, plans, and memories. No reward or ranking input counts alcohol units; Round totals record spend only under `lib/rounds.ts`. |
| “No account needed to look”; “Free to browse”; “Browsing doesn’t need an account” | About, privacy, terms | Public map, venue, Today, Tonight, Near, crawl, historic, and Pint Index routes have no authentication gate. Contribution routes apply the account gate separately. |
| “Night Memories and private plans aren’t public unless you choose to share them” | Privacy | Memory and plan stores use private actor or member-token reads. Public exposure requires an explicit share artifact or share link. |
| “Choose a handle in your account first”; “Your public handle appears on every contribution”; account and profile contribution prompts | Check-ins, identity gates, activity, profile, We Are Out | `lib/contributionIdentity.server.ts` resolves the authenticated account, claimed handle, and completed private profile before current attributed contributions are accepted. |
| “Email sign-in works even when Google and Apple are unavailable” | Contribution gate | Email is an independent sign-in provider in the account flow; Google and Apple availability does not remove that route. |
| “Logging tonight’s price needs a signed-in account, a claimed handle and completed private profile” | Privacy, terms, contribution surfaces | `app/api/price-submit/route.ts` calls the shared contribution identity resolver before writing a current community price. |
| “one account can replace its own earlier entry”; “can’t confirm itself by changing devices or handles” | Privacy | `lib/communityPriceStore.ts` keys current contributor ownership to the stable profile actor, supersedes the actor’s earlier same-key row, and derives corroboration from independent actors. |
| “One report so far. It needs a second to move the map”; second independent drinker copy | Price submission, venue sheet, map legend | `lib/communityPrice.ts` defines the corroboration threshold and `components/map/communityPriceSignals.ts` admits only corroborated prices to price paint. |
| “It marks this pub’s pin straight away”; UK base pub “keeps only the dot” | Price submission, map legend | `provisionalCommunityPriceVenueIds` supplies the separate provisional mark seam; UK base GeoJSON only receives the provisional flag and never a price signal. |
| “Over 30 days old. This records that night, not tonight’s price” | Community price status | `MAX_COMMUNITY_PRICE_AGE_DAYS` and the freshness predicates in `lib/communityPrice.ts` exclude older reports from current map authority while retaining the dated record. |
| “It doesn’t set a food pin’s colour”; non-pub and selected-drink variants | Map legend | `mergeCommunityPriceSignals` and the map lens guards keep pint reports out of food, non-pub, and mismatched drink-category price bands. |
| “Other pub · no listed price”; split listed and other pub groups | Map list | Curated venues and UK base pubs remain separate datasets; base pub records have no price field. `components/map/MapVenueList.tsx` renders those groups separately. |
| “Lowest listed prices on record. Not necessarily tonight’s price”; “Not a live feed” | Discovery leaderboard | Rows derive from finite listed venue prices and sort by price. No live-price guarantee exists, so copy explicitly limits recency. |
| “Community prices logged in the last 24 hours, cheapest first” | Discover | The recent community lane filters contributor timestamps to its 24-hour window and sorts the retained prices ascending. |
| “Latest community-reported pint against the earlier price on record” | Discover then-and-now | `lib/thenVsNow.ts` selects the newest priced community drop and compares it with the venue baseline price. |
| “Compare listed pint prices near you, cheapest first”; Near result headings | Near | `lib/nearMeAnswer.ts` admits venues with finite positive listed `cheapestPrice` values and orders them by price, then distance. Copy makes no quality or per-price date claim. |
| “Keeps this pub for tonight …” | Near acceptance receipt | `acceptNearVenue` receives the selected `venueId`, active area, and `startsAt: null` from `components/nearme/NearMeNow.tsx`. The receipt no longer assigns the shared dataset month to an individual price. |
| “Lowest listed prices in central London”; Today collection date | Today | `app/today/todayPints.ts` reads listed venue prices for the central fallback. `PINT_DATASET_OBSERVED_AT` comes from the freshness registry and dates the bundled dataset, not each row. |
| “What’s on … from sourced listings”; quiz, sport, deals, and live music | Tonight, CityMCP listings | `lib/concierge/whatsOn.ts` returns only listing records with their source metadata; Tonight renders those returned kinds and source links. |
| “Pub and event picks show their source” | Pal metadata and responses | `lib/palChat.ts` attaches directory provenance to venue cards and requires source provenance for What’s On cards before returning them. |
| “No sourced listings”; “Found … sourced listings” | Concierge and What’s On helpers | `lib/concierge/whatsOn.ts` filters and counts the sourced listing records returned for the requested kind, place, and time. |
| “Choose a listed city” | Concierge and plan API errors | City IDs are accepted only when `parseCityId` resolves them against the city registry. Copy names the product choice, not the request field. |
| “Listed pubs are available to browse and search in this city”; city-specific price and listing availability copy | City capability helpers | `lib/cityCapabilities.ts` owns each city’s closed capability record. Surfaces read its availability state and explanation rather than inferring support. |
| “We haven’t yet collected pint prices for this city”; transport help not ready | City capability helpers | The matching city capability is explicitly unavailable. Copy is limited to that registered absence and does not claim city-wide non-existence. |
| “Pubs, prices and stories by area”; crawl stop and route copy | Borough and crawl pages | Crawl records contain listed stop IDs; route resolution joins those stops to venue records carrying names, coordinates, prices, and stories. |
| Glasgow Subcrawl six-stop description | Glasgow curated crawl | `lib/cities/glasgow/curatedCrawls.ts` supplies six stop IDs, one for each named subway area. “folklore” is descriptive framing, not a live or measured claim. |
| Merchant City route description | Glasgow story band | The copy is limited to the named curated streets, pubs, and route context in `lib/cities/glasgow/storyBands.ts`; it makes no current availability claim. |
| “Listed offers and other deals” | Deals lane | Deal cards render listing records supplied by the sourced What’s On data path. “Listed” limits the claim to returned records. |
| “Seeded only where we’ve got demo data” | Discover | Demo cards render only when their seed collection contains entries. |
| “Hand-picked crawls” | Landing and crawl surfaces | Crawl packs are static curated records, not generated rankings. |
| “Choosing Brandy or Vodka changes this page’s mood only. It doesn’t create a hidden map filter.” | Landing | Those controls update landing presentation state only and do not write map query or lens state. |
| “We only use your location to rank pubs nearby. Nothing is stored.” | Near | Browser coordinates stay in component state and feed `rankNearMe`; no Near persistence or coordinate write is called. |
| Unsupported-area coverage copy | Near and coverage preview | The branch reads actual slim-index coverage and nearest supported patches. Copy says “lightly mapped”, “haven’t mapped”, or “don’t have priced pubs” only for the matching derived state. |
| “Your route needs a refresh”; accepted stop unchanged; Plan link status copy | Plan handoff and API | Route revision, accepted venue ID, and signed member-token checks in Plan route helpers select these messages. |
| “No three-stop route … meets every must-have need”; “Not enough listed pubs” | Plan generation | `app/api/plans/generate/route.ts` evaluates must-have constraints against route evidence and checks `chosen.length < 3` before returning either message. |
| “An active warning means we cannot plan a route through this area right now” | Plan generation | Active area warning state is checked before route construction. |
| “Every stop is within the selected patch” | Plan route evidence | `lib/planRouteEvidence.ts` verifies each selected stop against the chosen patch boundary before emitting the message. |
| “Every stop has checked information for each access need at its visit time” | Plan route evidence | The evidence resolver requires a checked result for every required access constraint at every stop and visit time. |
| Group size did not shape order because capacity is unchecked | Plan route evidence | The route optimizer receives no checked capacity evidence and records that group size was not used as an ordering factor. |
| “Some prices are missing”; estimated per-person spend for one recorded pint per stop | Plan summary | Budget aggregation returns `estimatedPerPersonPence: null` when a stop price is missing; otherwise it sums one recorded pint price per stop. |
| Late-food checked count, unchecked closing times, and extra-spend copy | Plan endings | `lib/planEndings.ts` derives option counts from resolved food records, carries schedule trust, and includes spend only when a price exists. |
| “Live transport details were not checked or saved”; “Closing time was not checked” | Plan completion | Completion warnings are emitted when transport or schedule evidence is absent from the confirmed ending. |
| “Every listed area can be planned”; routes remain editable with missing-detail warnings | Plan composer | Plan generation accepts registered areas and returns editable route drafts; confidence and evidence helpers expose missing price and route fields as warnings. |
| “Referral rewards aren’t active”; milestones grant no paid features | Privacy, terms, account hub | Referral code stores private edges and milestones only. No entitlement or paid-feature grant reads those records. |
| Recommendation, Visit Report, contributor-count, and moderation claims | Privacy | The corresponding stores persist the stated fields, derive public counts from visible identity-backed rows, and hide rather than delete moderated rows. |
| Analytics off by default, remembered choice, one-tap Allow or No thanks | Privacy, terms, account hub | Consent state defaults unset; analytics load only after allow; the same preference store powers the prompt and account setting. |
| Analytics identifier, allow-listed events, proxy, and retention statements | Privacy, terms | Analytics client and server validation define the identifier and event schema; proxy route forwarding defines request metadata; configured processor retention values supply the stated periods. |
| No advertising or cross-site tracking cookies | Privacy | No ad network integration or advertising-cookie writer exists in the application; optional analytics is separately consent-gated. |
| Named processors and stored-data descriptions | Privacy | Supabase, Vercel, PostHog, Open-Meteo, TfL, MapTiler, and OpenRouter are the processors called by the named code paths; each description is limited to data sent on that path. |
| “Every current price names where it came from”; people-logged dates and dataset source date | Terms | Community rows carry their own `createdAt` and contributor provenance; bundled rows use the source and freshness registry. Historical rows are separately labelled and excluded from current-price authority. |
| “The app comes as it is”; availability not promised | Terms | This is the legal service boundary, not a factual claim about current availability. |
| Pint Index includes only prices with public source and date | Live and archived Pint Index pages, metadata, JSON-LD | `lib/pintIndex.ts` eligibility requires source URL and observation date before an observation enters the live snapshot, CSV, or JSON-LD. |
| Older map-only prices stay out of the public Index | Pint Index | Live snapshot construction excludes legacy baseline rows; published editions read only frozen eligible observations. |
| Dataset coverage counts and borough rankings | Pint Index | `pubCount`, `boroughCount`, average, and dearest rows are derived from the eligible `PintIndexSnapshot`; captions say published or eligible rather than live. |
| “Prices seen” observation window | Pint Index | `snapshot.observationWindow.start` and `.end` are derived from eligible observation dates. |
| Borough assignment and unclassified points | Pint Index | The index uses versioned Greater London polygons and leaves a point outside all shapes without a borough. |
| Zone median uses listed cheapest pints | Pint Index | Zone aggregation reads each venue’s listed cheapest pint and computes the median for the nearest-station fare-zone approximation. |
| Frozen monthly edition and empty-edition copy | Archived Pint Index | `lib/pintIndexArchive.ts` serves immutable published observations for the month; an empty `observations` array selects the no-eligible-price message. |
| “Source links appear beside prices and events when available” | Weekly digest | `DigestPriceObservation.source` is optional and price renderers add its link only when present; event sources are rendered from their required source. |
| “New prices logged” and weekly count | Weekly digest | `dropsLogged` is computed from the digest’s logged-price observations for its scope and week. |
| “Didn’t ask for this? Ignore this email. You won’t be added.” | Confirmation email | Subscription remains pending until the confirmation token route succeeds. Ignoring the email performs no activation. |
| “updates for tonight” push title | Push notification | `lib/pushSender.ts` derives the plural title from `highlights.length`; the body contains the corresponding published highlight items. |
| Moment photos remain private before save; saved Moments attach to account | Moment and feed prompts | Media stays in local draft state until submission; signed-in save writes the Moment under the current account. |
| Pal adult confirmation saves time, never date of birth | Pal setup | Pal setup persists the 18+ confirmation timestamp and has no date-of-birth field in that record. |
| Pal memories can be inspected, corrected, and deleted; fixed controls cannot be disabled | Pal setup | Memory management exposes those operations for approved memories; safety and factuality controls are fixed configuration rather than user toggles. |
| Weather fallback says no fresh read | Today | The fallback branch runs only when the weather request returns no fresh reading. |
| “No change from the earlier price” | Then-and-now cards and venue price story | The equality branch compares current and baseline GBP values before rendering this line. |
| Recap completion, stop, spend, and logged-pint copy | Recap and share helpers | `lib/recapView.ts` and `lib/shareArtifacts.ts` derive each phrase from recorded completion state, stops, finite spend totals, handle, venue, and price fields. |

## Indirect-source inventory

Every file listed below was inspected in this audit. Counts are unique files within each category. A file may belong to more than one category when it owns and consumes indirect copy.

### Verbatim-rendered API errors

Count: 45 files. Inspection confirmed: every listed file was inspected.

- `app/api/admin/community-prices/route.ts`
- `app/api/admin/import-notes/route.ts`
- `app/api/area-demand/route.ts`
- `app/api/check-ins/route.ts`
- `app/api/city-map-card/route.tsx`
- `app/api/citymcp/area/route.ts`
- `app/api/citymcp/buzz/route.ts`
- `app/api/citymcp/journey/route.ts`
- `app/api/citymcp/place/route.ts`
- `app/api/citymcp/places/route.ts`
- `app/api/concierge/route.ts`
- `app/api/crawls/route.ts`
- `app/api/email-subscribers/confirm/route.ts`
- `app/api/email-subscribers/unsubscribe/route.ts`
- `app/api/heritage/route.ts`
- `app/api/last-merseyrail/route.ts`
- `app/api/last-subway/route.ts`
- `app/api/last-train/route.ts`
- `app/api/last-tram/route.ts`
- `app/api/nearby-bus-departures/route.ts`
- `app/api/night-areas/route.ts`
- `app/api/night-out-places/route.ts`
- `app/api/operator-proposals/route.ts`
- `app/api/pint-drops/route.ts`
- `app/api/pint-drops/stats/route.ts`
- `app/api/plans/[id]/complete/route.ts`
- `app/api/plans/[id]/route.ts`
- `app/api/plans/[id]/session/route.ts`
- `app/api/plans/generate/route.ts`
- `app/api/plans/route.ts`
- `app/api/presence/route.ts`
- `app/api/price-confirm/route.ts`
- `app/api/price-submit/route.ts`
- `app/api/profiles/[handle]/follow/route.ts`
- `app/api/pub-pal/mastery/route.ts`
- `app/api/pub-pal/route.ts`
- `app/api/pub-pal/voice-token/route.ts`
- `app/api/rounds/[code]/route.ts`
- `app/api/saved-pubs/list-follows/route.ts`
- `app/api/saved-pubs/route.ts`
- `app/api/social-connections/[provider]/route.ts`
- `app/api/tfl-disruption/route.ts`
- `app/api/venue-operators/claim/route.ts`
- `app/api/visit-reports/route.ts`
- `app/api/weather-recommendations/route.ts`

### Shared fallback helpers

Count: 42 files. Inspection confirmed: every listed file was inspected.

- `lib/checkIn.ts`
- `lib/cities/glasgow/curatedCrawls.ts`
- `lib/cities/glasgow/storyBands.ts`
- `lib/cityCapabilities.ts`
- `lib/communityPrice.ts`
- `lib/communityVenueSignals.ts`
- `lib/concierge/whatsOn.ts`
- `lib/conciergeAskClient.ts`
- `lib/contributionIdentity.server.ts`
- `lib/curation.ts`
- `lib/dayGreeting.ts`
- `lib/emailConfirmation.ts`
- `lib/heritageCrawls.ts`
- `lib/importNotesStore.ts`
- `lib/mapPriceLegend.ts`
- `lib/mapVenueList.ts`
- `lib/nightAreas.ts`
- `lib/nightPlanning.ts`
- `lib/operatorProposals.ts`
- `lib/palChat.ts`
- `lib/pintDrops.ts`
- `lib/pintDropsStore.ts`
- `lib/planComposerHandoff.ts`
- `lib/planDraftArbitration.ts`
- `lib/planEndingSelection.server.ts`
- `lib/planEndings.ts`
- `lib/planGenerationRanking.ts`
- `lib/planRouteEvidence.ts`
- `lib/planRouteOptimizer.ts`
- `lib/planSigningHttp.server.ts`
- `lib/planTemplates.ts`
- `lib/profileStore.ts`
- `lib/pubPal.ts`
- `lib/pushTokenStore.ts`
- `lib/recapView.ts`
- `lib/shareArtifacts.ts`
- `lib/venueOperators.ts`
- `lib/vibeTally.ts`
- `lib/visitReports.ts`
- `lib/weatherRecommendationStore.ts`
- `lib/weatherRecommendations.ts`
- `lib/weeklyDigest.ts`

### Route and page metadata

Count: 19 files. Inspection confirmed: every listed file was inspected.

- `app/about/page.tsx`
- `app/borough/[slug]/page.tsx`
- `app/choose-city/page.tsx`
- `app/crawls/[slug]/page.tsx`
- `app/feed/page.tsx`
- `app/historic/[slug]/opengraph-image.tsx`
- `app/historic/page.tsx`
- `app/landmark/[id]/page.tsx`
- `app/layout.tsx`
- `app/ledger/[id]/page.tsx`
- `app/moment/page.tsx`
- `app/near/page.tsx`
- `app/pal/chat/page.tsx`
- `app/pint-index/[month]/page.tsx`
- `app/pint-index/page.tsx`
- `app/plan/page.tsx`
- `app/privacy/page.tsx`
- `app/terms/page.tsx`
- `app/tonight/page.tsx`

### Template and tooltip blurbs copied into other surfaces

Count: 5 files. Inspection confirmed: every listed file was inspected.

- `lib/planTemplates.ts`
- `components/plan/PlanComposer.tsx`
- `components/nav/SiteNavMore.tsx`
- `lib/routePacks.ts`
- `app/crawls/CrawlsPageClient.tsx`

### Notification and email copy

Count: 7 files. Inspection confirmed: every listed file was inspected.

- `lib/emailConfirmation.ts`
- `lib/weeklyDigest.ts`
- `lib/pushSender.ts`
- `app/api/email-subscribers/confirm/route.ts`
- `app/api/email-subscribers/unsubscribe/route.ts`
- `app/api/night-signals/route.ts`
- `app/api/push-tokens/route.ts`
