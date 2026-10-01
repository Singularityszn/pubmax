# Discover failure diagnosis before correction

Actual R23 failure at `mobile-discover-coverage.spec.ts:23` is a strict-locator error: `.nightAreaCoverage` resolves to two sections, with the first hidden. The page snapshot contains the expected visible Night Area region, heading, evidence sentence, planner link and counts. Later category/copy assertions did not run.

The route redirects to `/social?tab=discover`; source renders one embedded DiscoverBody and one NightAreaCoverage there. The captured context does not identify the hidden duplicate's origin, so no product duplication cause is claimed. Proposed one-line correction selects the intended visible region by accessible name, retaining every existing scoped assertion. No `.first()`, forced visibility or count waiver. Proposal is unrun before the frozen suite ends.
