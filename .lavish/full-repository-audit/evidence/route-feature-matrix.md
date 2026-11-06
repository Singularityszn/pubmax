# Route to feature matrix

All 62 page entrypoints inventoried and source delegation inspected. Test paths are candidates, not passed checks. No signed-in write or native-runtime validation claimed here.

| Route | Feature group | Source dependency | Runtime |
| --- | --- | --- | --- |
| /about | landing-legal | @/lib/brandNaming, @/lib/aboutStats, @/lib/pintIndex, @/lib/publicPintIndexSnapshot.server, @/lib/siteContact | Untested by this reviewer |
| /account/delete | account-lifecycle | @/lib/accountDeletion, @/lib/brandNaming, @/lib/siteContact | Untested by this reviewer |
| /activity | social-media-stories | ./ActivityClient | Untested by this reviewer |
| /add/[handle] | profile-privacy | @/lib/addLink, @/lib/avatarResolve, @/lib/profiles, @/lib/profileStore, @/lib/socialLaunch, @/lib/supabase, ./AddPageShell | Untested by this reviewer |
| /admin | administration | @/lib/adminAuth, ./AdminClient | Untested by this reviewer |
| /area/[slug]/drink/[brand] | price-discovery | @/lib/drinkBrandAreaLanding.server, @/lib/mapEagerVenueIndex.server, @/lib/pricedLanding, @/lib/venues | Untested by this reviewer |
| /bar-tab/[id] | heritage-venue-proof | @/lib/feed, @/lib/shareArtifacts, @/lib/supabase, @/lib/pintDropsStore, @/lib/venueAliases, @/lib/venueIndex, @/lib/venues | Untested by this reviewer |
| /borough/[slug] | price-discovery | @/lib/priceBand, @/lib/venuePriceLane, @/lib/venueIndex, @/lib/pintFacts, @/lib/dataFreshness, @/lib/venues, @/lib/pintPriceLandingDataset.s | Untested by this reviewer |
| /borough | price-discovery | @/lib/priceBand, @/lib/venues, @/lib/boroughIndex.server, ./BoroughScreen | Untested by this reviewer |
| /contributors | profile-privacy | @/lib/contributorLeaderboardStore | Untested by this reviewer |
| /crawls/[slug] | social-media-stories | @/lib/crawlStoryStore, @/lib/formatGbp, ./CrawlStoryPoster | Untested by this reviewer |
| /crawls | social-media-stories | ./CrawlsPageClient | Untested by this reviewer |
| /discover | occasion-discovery-ai | @/lib/cityRivalry, @/lib/heritageCrawls, ./DiscoverPageClient | Untested by this reviewer |
| /drink/[slug] | price-discovery | @/lib/drinkBrandLanding.server, @/lib/drinkBrandAreaLanding.server, @/lib/mapEagerVenueIndex.server, @/lib/pricedLanding, @/lib/venues | Untested by this reviewer |
| /drinks | price-discovery |  | Untested by this reviewer |
| /feed | social-media-stories | ./FeedPageClient, ./feedSightings.server | Untested by this reviewer |
| /founders | profile-privacy | @/lib/foundingMembers, @/lib/handleDisplay, @/lib/profileStore | Untested by this reviewer |
| /historic/[slug] | heritage-venue-proof | @/lib/historic, ./HistoricPubDetail | Untested by this reviewer |
| /historic | heritage-venue-proof | @/lib/historic, @/lib/brandNaming, @/lib/boroughHeritage, @/lib/boroughs, @/lib/historicFilter, @/lib/pageFilters, @/lib/venueDataset, ./His | Untested by this reviewer |
| /how-we-estimate | price-discovery | @/lib/brandNaming, @/lib/priceTier, @/lib/priceEstimate, @/lib/priceEstimateBaselines | Untested by this reviewer |
| /invite/[token] | plans-crews-rounds | @/lib/planInvite, @/lib/planInviteRsvpStore, @/lib/plan, @/lib/planStore, @/lib/reactions, @/lib/shareArtifacts, @/lib/venues, @/lib/venueDe | Untested by this reviewer |
| /landmark/[id] | heritage-venue-proof | @/lib/brandNaming, @/lib/landmarks, @/lib/landmarkVenueProximity, @/lib/mapLogIntent, @/lib/venues | Untested by this reviewer |
| /ledger/[id] | heritage-venue-proof | @/lib/heritageListings, @/lib/ledger, @/lib/pintDrops, @/lib/pintDropViewer, @/lib/venueAliases, @/lib/venueIndex, @/lib/venues, @/lib/supab | Untested by this reviewer |
| /login | account-lifecycle | @/lib/arrivalWelcome | Untested by this reviewer |
| /map/[city] | map-place-discovery | @/lib/cities, @/lib/cityShare | Untested by this reviewer |
| /map/arrival | map-place-discovery | @/lib/cityShare, @/lib/londonMapMetadata, @/lib/ukPlaceIndex.server, @/lib/ukNationalBrowse, @/lib/ukPlaceSearch | Untested by this reviewer |
| /map | map-place-discovery | @/lib/londonMapMetadata | Untested by this reviewer |
| /messages/[id] | messaging |  | Untested by this reviewer |
| /messages | messaging | ./MessagesInboxClient | Untested by this reviewer |
| /moment | social-media-stories |  | Untested by this reviewer |
| /near | map-place-discovery |  | Untested by this reviewer |
| /onboarding | account-lifecycle | @/lib/nightAreas | Untested by this reviewer |
| /out | occasion-discovery-ai | @/lib/outListings, @/lib/brandNaming, ./OutClient | Untested by this reviewer |
| /p/[id] | social-media-stories | @/lib/pintDropViewer, @/lib/handleDisplay, @/lib/pintDropLookup, @/lib/shareArtifacts, @/lib/pintDrops, @/lib/formatGbp, @/lib/apiErrorMessa | Untested by this reviewer |
| / | landing-legal | @/lib/landingAnswers.server, @/lib/landingPubCard.server, @/lib/trustedHandoffFlags.server | Untested by this reviewer |
| /pal/chat | occasion-discovery-ai |  | Untested by this reviewer |
| /pal | occasion-discovery-ai |  | Untested by this reviewer |
| /pint-index/[month] | price-discovery | @/lib/pintIndex, @/lib/pintIndexArchive, @/lib/pintIndexSnapshot.server, @/lib/venues | Untested by this reviewer |
| /pint-index | price-discovery | @/lib/boroughCoverageStatus.server, @/lib/nationalPintBenchmarks, @/lib/pintIndex, @/lib/pintIndexArchive, @/lib/pintIndexArrival, @/lib/pin | Untested by this reviewer |
| /places | map-place-discovery | @/lib/brandNaming, @/lib/places, ./PlacesClient | Untested by this reviewer |
| /plan/[id] | plans-crews-rounds | @/lib/plan, @/lib/planPrivacy, @/lib/planCollaborationStore, @/lib/planStore, @/lib/shareArtifacts, @/lib/vibeChips, @/lib/vibeTally | Untested by this reviewer |
| /plan/[id]/recap | plans-crews-rounds | @/lib/plan, @/lib/planPrivacy, @/lib/planStore | Untested by this reviewer |
| /plan | plans-crews-rounds | @/lib/brandNaming | Untested by this reviewer |
| /privacy | landing-legal | @/lib/siteContact, @/lib/brandNaming | Untested by this reviewer |
| /profile | profile-privacy |  | Untested by this reviewer |
| /pubs | price-discovery | @/lib/brandNaming, @/lib/scrapedPubs, @/lib/scrapedPubs.server, @/lib/pageFilters, @/lib/zones | Untested by this reviewer |
| /recap/[storyId] | social-media-stories | @/lib/analyticsEvents, @/lib/nightMemoryStore, @/lib/nightMomentMedia, @/lib/pintDropsStore, @/lib/pintDropShared, @/lib/venueDetailIndex, @ | Untested by this reviewer |
| /rounds/[code] | plans-crews-rounds | ./RoundPageClient | Untested by this reviewer |
| /rounds | plans-crews-rounds |  | Untested by this reviewer |
| /signin | account-lifecycle |  | Untested by this reviewer |
| /social/crews/[crewId] | plans-crews-rounds | @/lib/socialCrewsUi | Untested by this reviewer |
| /social | social-media-stories | @/lib/brandNaming, @/lib/cityRivalry, @/lib/heritageCrawls, @/lib/socialShell, @/lib/socialLaunch, @/lib/trustedHandoffFlags.server, ./Socia | Untested by this reviewer |
| /soft-drinks-and-water | price-discovery | @/lib/drinkSubtypeObservedPrice, @/lib/drinkSubtypes, @/lib/drinkSubtypePricedView.server | Untested by this reviewer |
| /spoons-value | price-discovery | @/lib/spoonsValue, @/lib/spoonsValue.server, ./SpoonsValueTable | Untested by this reviewer |
| /terms | landing-legal | @/lib/siteContact, @/lib/brandNaming | Untested by this reviewer |
| /today | occasion-discovery-ai | @/lib/dayGreeting, @/lib/dealsDigest, @/lib/todayBrief, @/lib/historic, @/lib/nightAreas, @/lib/pubOfTheDay, @/lib/quietPint, @/lib/tonightC | Untested by this reviewer |
| /tonight | occasion-discovery-ai | @/lib/historic, @/lib/hypedPubs, @/lib/hypedPubs.server, @/lib/mapEagerVenueIndex.server, @/lib/quietPint, @/lib/spoonsValue.server, @/lib/t | Untested by this reviewer |
| /u/[handle]/lists/[listType] | profile-privacy | @/lib/profiles, @/lib/savedListPresentation, @/lib/savedListUrl, @/lib/socialLaunch, @/lib/savedPubsStore | Untested by this reviewer |
| /u/[handle] | profile-privacy | @/lib/identityHandleStore, @/lib/profiles, ./ProfilePageClient | Untested by this reviewer |
| /u/[handle]/people/[relation] | profile-privacy | @/lib/profiles, ./PeopleListClient | Untested by this reviewer |
| /we-are-out | plans-crews-rounds | @/lib/trustedHandoffFlags.server, ./WeAreOutClient | Untested by this reviewer |
| /webmcp | occasion-discovery-ai |  | Untested by this reviewer |
