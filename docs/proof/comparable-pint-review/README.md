# Comparable pint review record

This record accompanies the A1 PR. It records the R6 source audit and the review fixes.

The invariant is that every cheapest-pint rank or claim uses its selected price's valid serving, publisher, and observation day.

R6 was a missing-boundary defect. Compass, borough summaries, facts, FAQs, metadata, and share images accepted numeric prices without the policy.
The audit also found sibling price decisions in the leaderboard, arrival links, fallback order, Pal hops, roulette, route scoring, and Tonight conditions.
These decisions now use the shared policy. The quiet pick uses a separate qualified price map for its price preference.

R7 was a duplicate serving-rule defect. The TypeScript reader and Node builders now share the existing drink-text interpretation.
Bottle and volume checks remain in the comparable-pint policy. Legacy rows with no stated measure retain their pint contract.
The slim producer retains refused serving text with its selected publisher and day. Last Orders withholds its price without hiding the venue.

R8 was a projection defect. Today and Tonight now supply qualified ranking prices alongside their existing display prices.
Grade and age retain priority. A cheaper qualified pint breaks their tie before the stable slug order.

Refused prices remain visible in ordinary venue rows. Area averages, medians, other drink rules, and the stronger hunt remain unchanged.
No published dataset was regenerated during this review phase.

## Consumer inventory

The audit searched every `cheapestPrice` reference under `lib`, `components`, `app`, and `scripts`.
The table includes transitive ranking owners that do not spell the field name.

Command: `rg -n cheapestPrice lib components app scripts --glob '!**/*.json'`

| Owner | Decision |
| --- | --- |
| `app/api/plans/generate/route.ts` | Plan output or forecast. Price-based selection reads the qualified scoring and ceiling boundaries. |
| `app/api/social/rankings/route.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `app/borough/[slug]/opengraph-image.tsx` | Qualified borough order, minimum, maximum, FAQ, metadata, or share claim. All venue rows and area averages remain. |
| `app/borough/[slug]/page.tsx` | Qualified borough order, minimum, maximum, FAQ, metadata, or share claim. All venue rows and area averages remain. |
| `app/crawls/routeSummary.ts` | Predetermined or reader-chosen route display and estimates. No cheapest-pint winner selection. |
| `app/invite/[token]/opengraph-image.tsx` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `app/ledger/[id]/page.tsx` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `app/today/page.tsx` | Supplies separate display prices and qualified quiet-pick ranking prices. |
| `app/today/todayPints.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `app/tonight/page.tsx` | Supplies separate display prices and qualified quiet-pick ranking prices. Tonight hunt and A5 row presentation remain unchanged. |
| `components/PubMap.tsx` | Selected serving, publisher, and day survive the existing projection. Venue visibility remains separate. |
| `components/compass/PintCompass.tsx` | Passes complete slim rows to rankCompassTargets and renders qualified targets. |
| `components/discovery/LeaderboardTable.tsx` | Discover producer consumes qualified cheapestPints. Table renders its result. Comparison baselines remain unchanged. |
| `components/landing/LandingHero.tsx` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/landing/LandingLondonCollage.tsx` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/ledger/LedgerLive.tsx` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/map/ControlRail.tsx` | Existing policy call remains the ranking boundary. |
| `components/map/MapFallbackCard.tsx` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/map/RoutePanel.tsx` | Predetermined or reader-chosen route display and estimates. No cheapest-pint winner selection. |
| `components/map/UnverifiedPubSheet.tsx` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/map/canvas/geojson.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/map/canvas/hoverCard.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/map/canvas/types.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/map/inspector/VenueOverviewTab.tsx` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/map/inspector/useVenueShare.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/map/route/RouteList.tsx` | Predetermined or reader-chosen route display and estimates. No cheapest-pint winner selection. |
| `components/map/route/VenuePicker.tsx` | User-selected venue browsing or anchor. No cheapest-pint winner selection. |
| `components/map/usePintDrops.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/nearme/NearMeNow.tsx` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/night/NightModeCard.tsx` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/night/nightModeSheetModel.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/onboarding/FirstRunOnboarding.tsx` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/onboarding/OnboardingPanels.tsx` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/pal/PalChat.tsx` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/pubs/PubsGallery.tsx` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/tonight/useTonightAnswerReads.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/wild/PalHop.tsx` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `components/wild/palHopPlan.ts` | Qualified price ranking, target, or cap. Fallback browsing retains refused rows. |
| `lib/areaButton.ts` | Existing policy call remains the ranking boundary. |
| `lib/ask/conciergeTools.server.ts` | Existing policy call remains the ranking boundary. |
| `lib/ask/tools.ts` | Existing policy call remains the ranking boundary. |
| `lib/boroughNeighbourhoodLinks.ts` | Coverage or link availability. No numerical cheapest winner. |
| `lib/boroughs.ts` | Qualified borough order, minimum, maximum, FAQ, metadata, or share claim. All venue rows and area averages remain. |
| `lib/cheapPintPingSelect.server.ts` | Existing policy call remains the ranking boundary. |
| `lib/cheapestHunt.ts` | A5 ownership. Stronger drink-name and corroboration rules remain unchanged. |
| `lib/cityMapCoverage.ts` | Coverage or link availability. No numerical cheapest winner. |
| `lib/comparablePint.d.mts` | Shared policy and selected-price boundary. |
| `lib/comparablePint.mjs` | Shared policy and selected-price boundary. |
| `lib/comparableVenuePint.ts` | Shared policy and selected-price boundary. |
| `lib/concierge/rank.ts` | Existing policy call remains the ranking boundary. |
| `lib/concierge/venues.server.ts` | Selected serving, publisher, and day survive the existing projection. Venue visibility remains separate. |
| `lib/conciergeAskClient.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `lib/discoverBoard.ts` | Discover producer consumes qualified cheapestPints. Table renders its result. Comparison baselines remain unchanged. |
| `lib/drinkCoverage.ts` | Coverage or link availability. No numerical cheapest winner. |
| `lib/drinks.ts` | Read-day or drink conversion. Ranking qualification uses legacyPriceEvidence and the shared policy first. |
| `lib/drinkMeasure.ts`, `lib/drinkMeasureText.mjs` | One shared serving-text interpretation for the TypeScript reader and Node policy. |
| `lib/harvest/tavilyNightlyPass.ts` | Harvest input validation. No public cheapest-pint answer. |
| `lib/hypedPubs.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `lib/landingLondonCollage.ts` | Existing policy call remains the ranking boundary. |
| `lib/landingPubCard.ts` | Existing policy call remains the ranking boundary. |
| `lib/lastRideRoute.ts` | Station-distance ranking. Price is display data, not the ordering key. |
| `lib/lastTrain.server.ts` | Station-distance ranking. Price is display data, not the ordering key. |
| `lib/leaderboard.ts` | Qualified price ranking, target, or cap. Fallback browsing retains refused rows. |
| `lib/legacyPriceEvidence.d.mts` | Selected serving, publisher, and day survive the existing projection. Venue visibility remains separate. |
| `lib/legacyPriceEvidence.mjs` | Selected serving, publisher, and day survive the existing projection. Venue visibility remains separate. |
| `lib/listedDrinkCoverage.ts` | Coverage or link availability. No numerical cheapest winner. |
| `lib/mapExperienceLens.ts` | Serving, menu, lane, or evidence display. Other drink serving rules remain unchanged. |
| `lib/mapFallbackVenues.ts` | Qualified price ranking, target, or cap. Fallback browsing retains refused rows. |
| `lib/mapLogIntent.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `lib/mapPeek.ts` | Uses the qualified map-list cheapest answer. |
| `lib/mapResume.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `lib/mapSearchIndexLoader.ts` | Name and area relevance search. Priced-pub preference remains general browsing, with no numerical cheapest ordering. |
| `lib/mapSearchSuggest.ts` | Name and area relevance search. Priced-pub preference remains general browsing, with no numerical cheapest ordering. |
| `lib/mapSplitList.ts` | Existing policy call remains the ranking boundary. |
| `lib/mapVenueList.ts` | Existing policy call remains the ranking boundary. |
| `lib/messageAttachmentCards.server.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `lib/namedRoutes.ts` | Predetermined or reader-chosen route display and estimates. No cheapest-pint winner selection. |
| `lib/nearCheapestAnything.ts` | Existing policy call remains the ranking boundary. |
| `lib/nearMeAnswer.ts` | Existing policy call remains the ranking boundary. |
| `lib/nearPriceTrust.ts` | Serving, menu, lane, or evidence display. Other drink serving rules remain unchanged. |
| `lib/ogCityPriceBands.server.ts` | Area statistics, price bands, or shard statistics. Outside cheapest-answer scope. |
| `lib/overviewDisplayablePint.ts` | Serving, menu, lane, or evidence display. Other drink serving rules remain unchanged. |
| `lib/palChat.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `lib/palGlance.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `lib/passportTopTenCard.server.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `lib/patchCapabilities.ts` | Coverage or link availability. No numerical cheapest winner. |
| `lib/pintCompass.ts` | Qualified price ranking, target, or cap. Fallback browsing retains refused rows. |
| `lib/pintFacts.ts` | Qualified borough order, minimum, maximum, FAQ, metadata, or share claim. All venue rows and area averages remain. |
| `lib/pintIndexArrival.ts` | Qualified price ranking, target, or cap. Fallback browsing retains refused rows. |
| `lib/pintRoulette.ts` | Qualified price ranking, target, or cap. Fallback browsing retains refused rows. |
| `lib/pintRouletteFacts.server.ts` | Historic fact lookup for potential roulette venues. The pool owns price qualification. |
| `lib/planGeneration.server.ts` | Plan output or forecast. Price-based selection reads the qualified scoring and ceiling boundaries. |
| `lib/planGenerationDto.ts` | Plan output or forecast. Price-based selection reads the qualified scoring and ceiling boundaries. |
| `lib/planGenerationEndings.server.ts` | Plan output or forecast. Price-based selection reads the qualified scoring and ceiling boundaries. |
| `lib/planGenerationRanking.ts` | Qualified pint scoring, route ceiling, or under-price claim. |
| `lib/planRoundForecast.ts` | Plan output or forecast. Price-based selection reads the qualified scoring and ceiling boundaries. |
| `lib/planRouteEvidence.server.ts` | Qualified pint scoring, route ceiling, or under-price claim. |
| `lib/planningAnchor.server.ts` | User-selected venue browsing or anchor. No cheapest-pint winner selection. |
| `lib/priceReadDay.d.mts` | Read-day or drink conversion. Ranking qualification uses legacyPriceEvidence and the shared policy first. |
| `lib/priceReadDay.mjs` | Read-day or drink conversion. Ranking qualification uses legacyPriceEvidence and the shared policy first. |
| `lib/priceUpdates.ts` | Serving, menu, lane, or evidence display. Other drink serving rules remain unchanged. |
| `lib/pricedPubCount.ts` | Area statistics, price bands, or shard statistics. Outside cheapest-answer scope. |
| `lib/pubListImport.server.ts` | Coverage or link availability. No numerical cheapest winner. |
| `lib/pubMap.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `lib/quietPint.ts` | Grade, age, qualified price, then slug decide order. Display prices remain separate. |
| `lib/savedListShare.server.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `lib/scrapedPubs.server.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `lib/scrapedPubs.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `lib/slimPins.ts` | Selected serving, publisher, and day survive the existing projection. Venue visibility remains separate. |
| `lib/thenVsNow.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `lib/tonightAnswers.ts` | Existing policy call remains the ranking boundary. |
| `lib/tonightCheapPints.ts` | Existing policy call remains. Hunt order, chain cap, and A5 presentation remain unchanged. |
| `lib/tonightConditions.ts` | Qualified pint scoring, route ceiling, or under-price claim. |
| `lib/venueDetailIndex.ts` | Serving, menu, lane, or evidence display. Other drink serving rules remain unchanged. |
| `lib/venueFoodMenu.ts` | Serving, menu, lane, or evidence display. Other drink serving rules remain unchanged. |
| `lib/venueIndex.ts` | Selected serving, publisher, and day survive the existing projection. Venue visibility remains separate. |
| `lib/venueListedPint.ts` | Serving, menu, lane, or evidence display. Other drink serving rules remain unchanged. |
| `lib/venueMenu.ts` | Serving, menu, lane, or evidence display. Other drink serving rules remain unchanged. |
| `lib/venuePintShare.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `lib/venuePriceIndex.ts` | Display, transport, persistence, or typed data. No numerical cheapest-pint selection at this consumer. |
| `lib/venuePriceLane.ts` | Serving, menu, lane, or evidence display. Other drink serving rules remain unchanged. |
| `lib/venues.ts` | Qualified maximum-price filter and crawl scoring. Grouping and ordinary display retain original prices. |
| `lib/venuesSlim.ts` | Selected serving, publisher, and day survive the existing projection. Venue visibility remains separate. |
| `lib/wildPriceGlass.ts` | Area statistics, price bands, or shard statistics. Outside cheapest-answer scope. |
| `lib/zonePintIndex.server.ts` | Area statistics, price bands, or shard statistics. Outside cheapest-answer scope. |
| `lib/zones.ts` | Area statistics, price bands, or shard statistics. Outside cheapest-answer scope. |
| `scripts/build_city_slim_index.d.mts` | Dataset validation or unpriced city producer. No cheapest-pint winner selection. |
| `scripts/build_city_slim_index.mjs` | Dataset validation or unpriced city producer. No cheapest-pint winner selection. |
| `scripts/build_discover_board.mjs` | Uses discoverBoardFromVenues, whose leaderboard now qualifies selected prices. |
| `scripts/build_last_orders_pack.d.mts` | Builder uses the shared comparable-pint policy. |
| `scripts/build_last_orders_pack.mjs` | Builder uses the shared comparable-pint policy. |
| `scripts/build_price_bands.mjs` | Area statistics, price bands, or shard statistics. Outside cheapest-answer scope. |
| `scripts/build_slim_index.mjs` | Producer retains same-row serving, publisher, and day without removing displayed prices. |
| `scripts/lib/slimShards.d.mts` | Area statistics, price bands, or shard statistics. Outside cheapest-answer scope. |
| `scripts/lib/slimShards.mjs` | Area statistics, price bands, or shard statistics. Outside cheapest-answer scope. |
| `scripts/report_borough_coverage.mjs` | Coverage or link availability. No numerical cheapest winner. |
| `scripts/validate-data.mjs` | Dataset validation or unpriced city producer. No cheapest-pint winner selection. |

## Behaviour and verification

The regressions use the captain's contract as their oracle. A valid £5 pint must beat a refused cheaper figure.
They cover serving, publisher, full dates, future dates, prices, same-row ties, retained visibility, and the published Moon & Stars record.
They also exercise borough metadata, share-image content, fact prose, FAQs, and unchanged area averages.
Serving regressions include hyphenated halves, underscored halves, fractions, and the existing brewery-name exceptions.
Producer tests execute the slim evidence projection and Last Orders builder. Page tests execute both Today and Tonight server pages.

The review permits one final focused test command. Full verification and browser acceptance belong to the outer executor.
The final command and result appear in the phase tool transcript. This record does not claim release acceptance.

The previous round's focused run completed with 417 passing tests and one failure across 21 files.
All new discovery regressions passed. The failure concerned an existing alcohol-free scoring fixture.
A broad fixture edit gave only one comparison row price evidence. That fixture edit is now removed.
The alcohol-free crawl score also retains its original pint tiebreak, as required by the other-drink constraint.
Those corrections were traced through the callers but were not tested again in that round.
The current round's final scoped check passed all 213 tests across nine files. It ran after all source and test edits.
The command exited with code 0. Full verification remains with the outer executor.

```sh
node node_modules/vitest/vitest.mjs run __tests__/comparablePint.test.ts __tests__/comparablePintDiscovery.test.tsx __tests__/comparablePintRankingBoundaries.test.ts __tests__/comparablePintProducer.test.ts __tests__/legacyPriceEvidence.test.ts __tests__/drinkMeasure.test.ts __tests__/quietPint.test.ts __tests__/quietPintPages.test.tsx __tests__/tonightQuietPint.test.ts
```
