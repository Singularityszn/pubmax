import type { PriceReadAllowance } from "./cheapestPriceReadFence";

// Reviewed function allowances for the explicit A1 raw-read contract.
// Counts are local to each function. A policy import never grants an allowance.
export const PRICE_READ_ALLOWANCES: Record<string, readonly PriceReadAllowance[]> = {
  "lib/ask/conciergeTools.server.ts": [
    {"owner": "toPricedPoints", "count": 1, "reason": "Carries the selected slim evidence into the Near ranker."},
    {"owner": "toolCheapestPintNear", "count": 5, "reason": "Prints and transports cards returned by the qualified Near rankers, and joins each card to its own venue evidence only when the amounts match."},
    {"owner": "venueDrinkAnswerHint", "count": 3, "reason": "Describes a named venue rather than selecting a cheapest winner."},
    {"owner": "toolVenueDrinks", "count": 6, "reason": "Displays a requested venue and its recorded drink evidence."},
  ],
  "lib/ask/tools.ts": [
    {"owner": "venueCard", "count": 3, "reason": "Prints a selected venue and its receipt."},
    {"owner": "toolSearchVenues", "count": 1, "reason": "Transports results after the pint policy and budget filter."},
    {"owner": "toolVenuePrices", "count": 6, "reason": "Displays the requested venue record and corroborated reports."},
    {"owner": "toolProposePlan", "count": 1, "reason": "Transports stops after the shared concierge ranker."},
  ],
  "lib/boroughNeighbourhoodLinks.ts": [
    {"owner": "nightAreaBoroughSlugs", "count": 1, "reason": "Counts listed coverage to offer area links without choosing a cheapest pub."},
  ],
  "lib/cheapPintPingSelect.server.ts": [
    {"owner": "selectCheapPintPing", "count": 1, "reason": "Prints the winning card returned by the qualified Near ranker."},
  ],
  "lib/cheapestHunt.ts": [
    {"owner": "londonHuntPints", "count": 1, "reason": "Uses the separately owned stronger hunt evidence contract."},
  ],
  "lib/cityMapCoverage.ts": [
    {"owner": "summarizeCityPubCoverage", "count": 1, "reason": "Counts ordinary priced coverage without ranking."},
  ],
  "lib/comparablePint.mjs": [
    {"owner": "comparablePint", "count": 1, "reason": "Owns the shared refusal policy and validates the destructured input."},
  ],
  "lib/comparableVenuePint.ts": [
    {"owner": "selectedVenuePintEvidence", "count": 1, "reason": "Pairs the selected baseline figure with its own row evidence."},
    {"owner": "selectedComparableVenuePint", "count": 2, "reason": "Preserves contributor and sourced update precedence before the policy runs."},
  ],
  "lib/concierge/venues.server.ts": [
    {"owner": "toVenue", "count": 4, "reason": "Validates and transports slim prices with their serving and evidence."},
  ],
  "lib/conciergeAskClient.ts": [
    {"owner": "answerFromBody", "count": 1, "reason": "Decodes the server response without choosing winners."},
  ],
  "lib/discoverBoard.ts": [
    {"owner": "discoverBoardFromVenues", "count": 2, "reason": "Publishes qualified leaderboard winners and separate historical baselines."},
    {"owner": "parseRow", "count": 2, "reason": "Validates persisted board output."},
    {"owner": "parseBaseline", "count": 2, "reason": "Validates historical baseline output without ranking."},
  ],
  "lib/drinkCoverage.ts": [
    {"owner": "mapDrinkCoverage", "count": 2, "reason": "Counts ordinary drink coverage without selecting prices."},
  ],
  "lib/drinks.ts": [
    {"owner": "venueCheapestPintRow", "count": 2, "reason": "Finds the evidence row matching the displayed amount."},
  ],
  "lib/harvest/tavilyNightlyPass.ts": [
    {"owner": "toNightlyVenue", "count": 1, "reason": "Decodes harvest input without producing cheapest answers."},
  ],
  "lib/hypedPubs.ts": [
    {"owner": "hypedPubPriceIndex", "count": 1, "reason": "Keeps ordinary display prices for editorial picks."},
  ],
  "lib/landingPubCard.ts": [
    {"owner": "buildLandingPubCard", "count": 4, "reason": "Filters through comparableVenuePint before choosing the landing price."},
    {"owner": "spanYears", "count": 1, "reason": "Measures archive span for an already selected venue."},
    {"owner": "buildLandingArchiveIndex", "count": 3, "reason": "Builds historical comparisons without choosing a current winner."},
    {"owner": "buildLandingAnchorRail", "count": 3, "reason": "Filters through comparableVenuePint before the rail price order."},
  ],
  "lib/lastRideRoute.ts": [
    {"owner": "nearestPubsToStation", "count": 2, "reason": "Chooses pubs by distance and carries their ordinary display prices."},
  ],
  "lib/lazyVenueDetail.ts": [
    {"owner": "mergeLazyDetailPins", "count": 3, "reason": "Carries a priced slim pin's complete evidence onto an unpriced detail without ranking."},
  ],
  "lib/lastTrain.server.ts": [
    {"owner": "nearestPubsToStation", "count": 1, "reason": "Chooses pubs by distance and carries their ordinary display prices."},
  ],
  "lib/leaderboard.ts": [
    {"owner": "hasPrice", "count": 1, "reason": "Narrows an ordinary display type and grants no ranking authority."},
    {"owner": "leaderboardStandingFor", "count": 1, "reason": "Builds the selected price receipt."},
    {"owner": "sharedPriceListKey", "count": 1, "reason": "Builds a cache key without choosing winners."},
    {"owner": "cheapestPints", "count": 2, "reason": "Filters with the comparable policy before sorting."},
    {"owner": "cheapestByArea", "count": 6, "reason": "Filters with the comparable policy before selecting area winners."},
  ],
  "lib/listedDrinkCoverage.ts": [
    {"owner": "listedDrinkCoverage", "count": 1, "reason": "Counts listed drink coverage without ranking prices."},
  ],
  "lib/mapExperienceLens.ts": [
    {"owner": "sourcedAnchorPrice", "count": 1, "reason": "Preserves other drink lens anchor display and serving contracts."},
  ],
  "lib/mapLogIntent.ts": [
    {"owner": "priceLabelFor", "count": 3, "reason": "Formats a requested venue price without ranking."},
  ],
  "lib/mapResume.ts": [
    {"owner": "validRow", "count": 3, "reason": "Validates persisted map resume state."},
  ],
  "lib/mapSearchIndexLoader.ts": [
    {"owner": "packFromSlim", "count": 2, "reason": "Builds general search data with ordinary display prices."},
    {"owner": "packWithCurrentVenues", "count": 2, "reason": "Updates general search data with ordinary display prices."},
  ],
  "lib/mapSearchSuggest.ts": [
    {"owner": "mapSearchVerifiedPrice", "count": 2, "reason": "Retains reader-driven general search price preference outside cheapest answers."},
  ],
  "lib/mapVenueList.ts": [
    {"owner": "mapVenueListPintPrice", "count": 1, "reason": "Keeps display prices separate from the qualified cheapest ranking figure."},
  ],
  "lib/messageAttachmentCards.server.ts": [
    {"owner": "resolveMessageVenueCard", "count": 4, "reason": "Displays the explicitly attached venue without ranking."},
  ],
  "lib/namedRoutes.ts": [
    {"owner": "stopPint", "count": 1, "reason": "Estimates a predetermined named route without choosing a cheapest winner."},
  ],
  "lib/nearCheapestAnything.ts": [
    {"owner": "nearPintRows", "count": 1, "reason": "Applies comparablePint before publishing pint tuples."},
  ],
  "lib/nearMeAnswer.ts": [
    {"owner": "venueToPricedPoint", "count": 2, "reason": "Carries the selected serving and evidence across the map boundary."},
    {"owner": "byPriceThenDistance", "count": 4, "reason": "Sorts Near cards created only from qualified points."},
    {"owner": "nearSavingLine", "count": 3, "reason": "Compares two already qualified Near cards."},
    {"owner": "pricedWithinWalk", "count": 1, "reason": "Filters with the policy before collecting budget figures."},
    {"owner": "rankBoroughCheapest", "count": 2, "reason": "Filters with the policy before borough sorting."},
    {"owner": "rankCityCheapest", "count": 2, "reason": "Filters with the policy before city sorting."},
    {"owner": "toCheapestCard", "count": 1, "reason": "Copies figures for the qualified city and borough rankers."},
    {"owner": "cheapestGuinnessNearby", "count": 3, "reason": "Preserves the public priced-venue subset while qualifying the separate Guinness row."},
  ],
  "lib/nearPriceTrust.ts": [
    {"owner": "resolveNearPriceTrust", "count": 2, "reason": "Matches the selected card to its receipt without ranking."},
  ],
  "lib/ogCityPriceBands.server.ts": [
    {"owner": "isOgCityPriceBandVenue", "count": 2, "reason": "Counts map band membership without cheapest selection."},
    {"owner": "countOgCityPriceBands", "count": 1, "reason": "Counts map bands without cheapest selection."},
  ],
  "lib/overviewDisplayablePint.ts": [
    {"owner": "overviewDisplayablePintGbp", "count": 1, "reason": "Preserves ordinary venue-sheet display prices."},
  ],
  "lib/palChat.ts": [
    {"owner": "venueCard", "count": 1, "reason": "Decodes a server-selected card."},
  ],
  "lib/palGlance.ts": [
    {"owner": "cheapestGlanceLine", "count": 2, "reason": "Formats a qualified Near card and its actual scope."},
  ],
  "lib/passportTopTenCard.server.ts": [
    {"owner": "readTopTenCard", "count": 1, "reason": "Prints a member of the qualified leaderboard."},
  ],
  "lib/patchCapabilities.ts": [
    {"owner": "countPatchEvidence", "count": 1, "reason": "Counts listed area coverage without ranking."},
  ],
  "lib/pintFacts.ts": [
    {"owner": "pintFactStats", "count": 2, "reason": "Excludes explicit non-pints from the average and carries each qualified extreme's own evidence."},
  ],
  "lib/pintRouletteFacts.server.ts": [
    {"owner": "pintRouletteFacts", "count": 2, "reason": "Builds facts for a selected venue without selecting a winner."},
  ],
  "lib/planGenerationDto.ts": [
    {"owner": "planAlternativeDto", "count": 2, "reason": "Serialises prices after plan selection."},
    {"owner": "buildPlanGenerationStops", "count": 2, "reason": "Serialises prices after plan selection."},
  ],
  "lib/planGenerationEndings.server.ts": [
    {"owner": "planGenerationEndings", "count": 2, "reason": "Displays estimated prices for distance-selected ending choices."},
  ],
  "lib/planRoundForecast.ts": [
    {"owner": "listedPintFor", "count": 4, "reason": "Forecasts the selected stop with its own price lane and freshness contract."},
  ],
  "lib/planRouteEvidence.server.ts": [
    {"owner": "readPriceIndex", "count": 1, "reason": "Carries price evidence into the qualified route boundary."},
  ],
  "lib/planningAnchor.server.ts": [
    {"owner": "priceEvidenceFor", "count": 2, "reason": "Builds receipts for an explicitly chosen anchor."},
    {"owner": "resolvePlanningAnchor", "count": 4, "reason": "Resolves an explicit anchor and its ordinary price without cheapest selection."},
  ],
  "lib/pricedPubCount.ts": [
    {"owner": "listedPriceCohort", "count": 3, "reason": "Preserves listed cohort membership except explicit non-pint serving contradictions."},
    {"owner": "listedPriceCohortPrices", "count": 1, "reason": "Collects ordinary cohort statistics without choosing winners."},
  ],
  "lib/pubListImport.server.ts": [
    {"owner": "loadCatalog", "count": 2, "reason": "Loads ordinary venue prices for list import matching."},
  ],
  "lib/pubMap.ts": [
    {"owner": "builtStopsNeedingHydration", "count": 4, "reason": "Detects stops needing detail evidence without ranking."},
    {"owner": "peekPriceChip", "count": 2, "reason": "Displays a selected venue price lane."},
  ],
  "lib/quietPint.ts": [
    {"owner": "quietPintPriceEvidence", "count": 1, "reason": "Carries an ordinary displayed amount into venuePriceEvidence without ranking."},
  ],
  "lib/savedListShare.server.ts": [
    {"owner": "savedListCardPubs", "count": 1, "reason": "Displays reader-selected saved pubs."},
  ],
  "lib/scrapedPubs.server.ts": [
    {"owner": "readScrapedPubs", "count": 1, "reason": "Transports ordinary scraped venue display data."},
  ],
  "lib/slimListingPrices.mjs": [
    {"owner": "applySlimListingPrices", "count": 4, "reason": "Fills only unpriced pins and selects the minimum listing after comparablePint admits its complete evidence."},
  ],
  "lib/slimPins.ts": [
    {"owner": "slimVenueToPin", "count": 1, "reason": "Preserves price and evidence during projection."},
    {"owner": "pinToSlimVenue", "count": 1, "reason": "Preserves price and evidence during reverse projection."},
  ],
  "lib/thenVsNow.ts": [
    {"owner": "computeThenVsNow", "count": 1, "reason": "Compares historical baselines with community reports."},
    {"owner": "selectedPriceRecord", "count": 1, "reason": "Builds a selected venue history without choosing a cheapest winner."},
  ],
  "lib/tonightAnswers.ts": [
    {"owner": "tonightCheapestAnswer", "count": 2, "reason": "Prints the qualified nearby winner."},
  ],
  "lib/tonightCheapPints.ts": [
    {"owner": "tonightCheapPints", "count": 4, "reason": "Orders the stronger hunt output and preserves chain diversity."},
  ],
  "lib/venueFoodMenu.ts": [
    {"owner": "anchorFoodItem", "count": 3, "reason": "Preserves non-pint food display and serving contracts."},
  ],
  "lib/venueIndex.ts": [
    {"owner": "buildVenueIndexFromSlim", "count": 4, "reason": "Validates and transports slim price evidence."},
  ],
  "lib/venueListedPint.ts": [
    {"owner": "venueListedPint", "count": 1, "reason": "Resolves the displayed price row and its receipt."},
  ],
  "lib/venuePintShare.ts": [
    {"owner": "listedCheapPintShare", "count": 2, "reason": "Checks the selected lane for share presentation."},
    {"owner": "nearTopPintShare", "count": 1, "reason": "Matches an already qualified Near winner to its receipt."},
  ],
  "lib/venuePriceEvidence.ts": [
    {"owner": "venuePriceEvidence", "count": 1, "reason": "Checks the selected display amount before attributing its own evidence."},
  ],
  "lib/venuePriceLane.ts": [
    {"owner": "venuePriceLane", "count": 3, "reason": "Preserves ordinary price lane precedence and display."},
    {"owner": "venuePriceLaneObservedGbp", "count": 3, "reason": "Reads an ordinary selected display lane without ranking."},
  ],
  "lib/venues.ts": [
    {"owner": "mergeVenueDrops", "count": 2, "reason": "Preserves contributor overlay and ordinary visibility."},
    {"owner": "scoreVenue", "count": 1, "reason": "Preserves other drink lens scoring while beer uses the policy."},
    {"owner": "crawlSummary", "count": 1, "reason": "Totals reader-selected route stops without choosing winners."},
  ],
  "lib/venuesSlim.ts": [
    {"owner": "hasValidAnchor", "count": 4, "reason": "Validates ordinary non-pint anchors."},
    {"owner": "isValidSlimVenue", "count": 1, "reason": "Validates the slim transport shape."},
    {"owner": "normalizeRows", "count": 1, "reason": "Transports ordinary prices with evidence."},
  ],
  "lib/wildPriceGlass.ts": [
    {"owner": "boroughMedians", "count": 1, "reason": "Computes area medians outside cheapest-answer scope."},
  ],
  "lib/zonePintIndex.server.ts": [
    {"owner": "load", "count": 1, "reason": "Transports ordinary zone statistics inputs."},
  ],
  "lib/zones.ts": [
    {"owner": "computeZonePintIndex", "count": 1, "reason": "Computes zone medians outside cheapest-answer scope."},
  ],
  "components/discovery/LeaderboardTable.tsx": [
    {"owner": "LeaderboardTable", "count": 2, "reason": "Renders qualified board output and historical comparisons."},
  ],
  "components/landing/LandingHero.tsx": [
    {"owner": "nearAnswer", "count": 2, "reason": "Prints a qualified Near card."},
    {"owner": "LandingHero", "count": 2, "reason": "Displays the qualified Near answer and its receipt."},
  ],
  "components/landing/LandingLondonCollage.tsx": [
    {"owner": "CollageTile", "count": 2, "reason": "Prints the qualified area minimum."},
  ],
  "components/ledger/LedgerLive.tsx": [
    {"owner": "LedgerPublishedPriceRecord", "count": 2, "reason": "Displays the requested venue price and receipt."},
    {"owner": "LedgerPriceRecord", "count": 1, "reason": "Projects the selected venue price lane for display."},
  ],
  "components/map/MapFallbackCard.tsx": [
    {"owner": "MapFallbackCard", "count": 2, "reason": "Displays ordinary map fallback venue prices."},
  ],
  "components/map/RoutePanel.tsx": [
    {"owner": "RoutePanel", "count": 2, "reason": "Displays reader-selected route prices."},
  ],
  "components/map/canvas/geojson.ts": [
    {"owner": "pinPriceStack", "count": 1, "reason": "Preserves ordinary pin price display and other lenses."},
  ],
  "components/map/canvas/hoverCard.ts": [
    {"owner": "hoverPriceLine", "count": 4, "reason": "Preserves ordinary hover prices and other drink lenses."},
    {"owner": "hoverCardCopy", "count": 2, "reason": "Displays a selected hover card without ranking."},
  ],
  "components/map/inspector/VenueOverviewTab.tsx": [
    {"owner": "VenuePriceSummary", "count": 5, "reason": "Displays a selected venue price lane."},
    {"owner": "VenueOverviewTab", "count": 2, "reason": "Passes selected display prices to history and share views."},
  ],
  "components/map/inspector/useVenueShare.ts": [
    {"owner": "useVenueShare", "count": 1, "reason": "Shares the explicitly selected venue price."},
  ],
  "components/map/route/RouteList.tsx": [
    {"owner": "RouteList", "count": 1, "reason": "Displays prices for selected route stops."},
    {"owner": "stopPriceLine", "count": 1, "reason": "Formats the selected stop price."},
  ],
  "components/map/route/VenuePicker.tsx": [
    {"owner": "VenuePicker", "count": 1, "reason": "Preserves user-selected general venue browsing."},
  ],
  "components/nearme/NearMeNow.tsx": [
    {"owner": "trustLabelForCard", "count": 1, "reason": "Matches the qualified card to its own receipt."},
    {"owner": "nearSavingSource", "count": 1, "reason": "Matches the qualified comparison card to its receipt."},
    {"owner": "NearMeCardBody", "count": 2, "reason": "Renders an already qualified Near card."},
  ],
  "components/night/NightModeCard.tsx": [
    {"owner": "KeepGoingPicker", "count": 2, "reason": "Displays distance-selected extensions and ordinary prices."},
  ],
  "components/onboarding/FirstRunOnboarding.tsx": [
    {"owner": "FirstRunOnboarding", "count": 1, "reason": "Displays the qualified onboarding Near answer."},
  ],
  "components/onboarding/OnboardingPanels.tsx": [
    {"owner": "ResultPanel", "count": 2, "reason": "Renders qualified onboarding cards."},
  ],
  "components/pal/PalChat.tsx": [
    {"owner": "PalChatBody", "count": 1, "reason": "Matches a qualified Near glance to its source venue."},
  ],
  "components/pubs/PubsGallery.tsx": [
    {"owner": "PubsGallery", "count": 5, "reason": "Preserves user-selected general gallery browsing, and joins each card to its own price evidence only when the amounts match."},
  ],
  "components/tonight/useTonightAnswerReads.ts": [
    {"owner": "useTonightNearbyVenues", "count": 1, "reason": "Carries serving and evidence into the Tonight ranker."},
  ],
  "components/wild/PalHop.tsx": [
    {"owner": "beerFor", "count": 2, "reason": "Names the beer for an already chosen hop without price ranking."},
  ],
  "app/api/plans/generate/route.ts": [
    {"owner": "POST", "count": 2, "reason": "Serialises selected plan stop prices."},
  ],
  "app/api/social/rankings/route.ts": [
    {"owner": "venueFacts", "count": 1, "reason": "Displays venue facts for social rankings without choosing cheapest pints."},
  ],
  "app/borough/[slug]/page.tsx": [
    {"owner": "BoroughPubRow", "count": 1, "reason": "Preserves ordinary venue row display and explicit non-pint labels."},
  ],
  "app/invite/[token]/opengraph-image.tsx": [
    {"owner": "loadStops", "count": 4, "reason": "Displays the explicitly shared plan stops."},
  ],
  "app/ledger/[id]/page.tsx": [
    {"owner": "LedgerPage", "count": 1, "reason": "Passes the requested venue price lane to its ledger."},
  ],
  "app/today/page.tsx": [
    {"owner": "pricedVenuePriceById", "count": 2, "reason": "Keeps ordinary display prices separate from qualified quiet-pick prices."},
  ],
  "app/tonight/page.tsx": [
    {"owner": "TonightPage", "count": 3, "reason": "Keeps ordinary display and nearby evidence separate from qualified quiet-pick prices."},
  ],
  "scripts/build_last_orders_pack.mjs": [
    {"owner": "buildLastOrdersPacks", "count": 1, "reason": "Publishes price rows only after isSourcedPint applies the shared policy."},
  ],
  "scripts/build_price_bands.mjs": [
    {"owner": "readCityPintPrices", "count": 4, "reason": "Computes ordinary price band statistics outside cheapest-answer scope."},
  ],
  "scripts/lib/slimShards.mjs": [
    {"owner": "pricedRatio", "count": 2, "reason": "Measures shard coverage without ranking."},
  ],
  "scripts/report_borough_coverage.mjs": [
    {"owner": "hasUsablePrice", "count": 2, "reason": "Counts ordinary listed coverage without choosing winners."},
  ],
  "scripts/validate-data.mjs": [
    {"owner": "validateSlimVenues", "count": 7, "reason": "Validates generated transport parity without ranking."},
    {"owner": "validateCityPackRow", "count": 2, "reason": "Validates the unpriced city transport contract."},
    {"owner": "validateSlimShardRows", "count": 3, "reason": "Validates shard prices and parity without ranking."},
  ],
};
