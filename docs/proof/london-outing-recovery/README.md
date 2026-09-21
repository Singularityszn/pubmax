# London outing recovery, first increment

Base revision: 04b73e834. Local branch: codex/recovery-outings-20260922.

Date night now opens /outings with a shortlist before chat. Seven occasion choices reuse existing venue ranking and sourced event cards. Area/day remain in navigation and ask/plan text. Editorial estimates show their positive amenity basis and explicitly state noise, seating and opening uncertainty. No new price claims are rendered here; venue details own prices.

Date/history routing regression: shipped Date chip previously called named-venue heritage and rendered request fragments as venue names. Five new routing/tool checks failed before correction; named heritage now resolves actual venue identity. A sixth judged-router check failed before adding its guard against model-selected heritage for a generic preference.

Validation: 111 focused tests passed across askRouter, askRouterJudged, askConciergeToolHandlers, outingOccasions and outingPage. Changed TypeScript/TSX lint passed. Full repository TypeScript check reported one optional heritage-card id mismatch; corrected by retaining the card contract’s empty-id fallback. Recheck pending. No full suite, production deployment or migration run. Browser evidence belongs to integration review, not these source/render tests.

Dancing synonyms route to sourced Out events filtered to Club night, excluding other event kinds. Results keep publisher provenance. Shortlist also offers pub-stop planning and existing TfL/Safe Night handoff. This is not a combined event-aware itinerary: automated before/after stop scheduling, event identity persisted inside shared plans and timed home-journey validation remain outstanding. Home destination is entered with the external journey planner, not placed in public plan URLs.

Other limits: no explicit budget/group controls added to browse in this increment; these can be refined in ask/planning. Provider outages and empty inventory stay visible. Read-only browser checks at desktop/390px and complete date/event handoff tests remain integration work.
