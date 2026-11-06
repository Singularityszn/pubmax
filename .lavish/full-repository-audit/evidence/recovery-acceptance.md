# London outings recovery: decisions and acceptance

Status: approved product direction translated into implementation acceptance. Audit baseline: 04b73e834. This document adds no application changes and authorizes no deployment, migration or automatic restoration. Fixes remain separate work. Existing design system and current navigation/composer architecture remain implementation starting points.

## Locked decisions

- Serve all seven London outing jobs: dates, friends, dancing, music, quiet conversation, gardens and pub crawls. Preserve alcohol-optional choices and free drinker access.
- Date discovery opens a browsable shortlist first. Asking refines that shortlist; chat is not a prerequisite.
- Dancing covers a complete sourced evening and getting home, not merely an event label or generic lively pub list.
- Recover useful outcomes inside current design. Deleted duplicate panels and old routes are not restoration targets by themselves.
- Atmosphere estimates are allowed when clearly labelled editorial. Keep estimates distinguishable from sourced venue facts.
- Then-vs-Now compares matching drink and serving only. Otherwise show separate dated observations without a change claim.

## Shared acceptance contract

Every occasion is reachable from public discovery within two deliberate actions from Tonight or Map at desktop and 390px mobile. Signed-out visitors can inspect useful results before account prompts. Each result names its venue, area, relevant evidence, source/date where factual, and price coverage or explicit absence. Do not fill a requested count with unsupported venues.

The chosen London area, date/time, group size, budget and alcohol preference survive browse-to-ask, shortlist-to-plan and shared-plan reopening wherever supplied. Fixed Clapham/Camden demo presets must not silently replace chosen location. Back navigation preserves selection. Missing permission, stale supply, empty results and request failure remain distinguishable, with retry or an explicit alternative that does not quietly broaden constraints.

Atmosphere text displays "Editorial estimate" adjacent to the claim, with its factual basis accessible. Do not present measured noise, capacity, current crowd, dancing permission, opening hours or accessibility as known unless sourced. An unknown amenity stays unknown; it cannot become evidence of absence. Ranking can use labelled judgement while factual eligibility constraints remain enforceable.

## Acceptance by occasion

| Occasion | Required user outcome | Acceptance evidence and boundary cases | Reuse and dependencies |
| --- | --- | --- | --- |
| Date | Open a venue shortlist, compare atmosphere/food/drinks and select a venue or plan; optionally ask to refine. | "Date night" produces real venue cards, never a heritage card titled from request text. "History of The Lamb" still answers named-venue heritage. Test quiet, alcohol-free, budget and area refinements with model enabled, keyless and model timeout. Empty evidence yields fewer results or an honest empty state. | Existing date/quiet/heritage ranking and venue cards. Fix Ask routing and real-venue resolution before enabling chip handoff. Reuse composer after shortlist selection. |
| Friends | Find an outing suited to stated group and budget, save a plan and share one invitation. | Group size and budget survive invitation opening; second participant can respond without host privileges. Big one tonight must carry lively/group intent rather than silently filtering deals. Availability of seating/reservations is explicit unknown unless evidenced. | PlanComposer, plan invites/RSVP, crew and shared vibe contracts. Preserve existing identity and privacy boundaries. |
| Dancing | Select a sourced dance/club event, arrange before/after stops where supported, and inspect a get-home option for intended finish. | Disco/dancing/DJ/club-night browse and ask reach consistent dated listings. Venue, event date/start, available end/admission information and source are visible; absent facts remain unknown. Route timing flags unknown finish or unverified service instead of claiming journey feasibility. Home destination is user-provided or permission-based and is excluded from public invitations. Sold-out/cancelled/stale evidence cannot appear available. | Out club-night classifier and event supply, existing journey/get-home tools, Plan stops and late-food capability. Extend stop handling only where current pub-only contracts cannot represent sourced non-pub events safely. Never reuse pint prices as admission/cocktail prices. |
| Music | Choose between a confirmed live listing and a venue generally associated with music. | Tonight/date filter excludes other dates. "Live music tonight" returns verified events or absence, not an amenity flag posed as a current gig. General music-friendly venues may appear separately with labelled basis. Browse and ask retain area/time and point to same source. | Tonight music kind, Out gig labels, Discover MusicTonightLane, grounded Whats-On lookup. Requires current supply and cancellation/freshness policy. |
| Quiet conversation | Find a calm candidate with clear explanation of what is known versus estimated. | Quiet and chat queries respect area/time. Known scheduled loud events cannot be omitted from fit explanation. Food/history alone never becomes observed quiet; unknown music/sport does not mean none. Show editorial estimate when relying on proxy evidence, and allow user to inspect source basis. | Quiet preset, concierge ranking, quiet-pint modules and existing event data. Preserve unknown booleans and distinguish typical conditions from current reports. |
| Gardens | Compare evidenced outdoor options, with useful weather context where available. | Known garden/outdoor evidence is required for a factual garden claim. Weather age and area match are visible; stale/missing weather does not invent sun or hide otherwise evidenced gardens. Seasonal access/opening uncertainty is explicit. Area survives plan handoff. | GardenTonightCard, garden amenity ranking and weather freshness seam. Move/reuse public entry rather than duplicating Discover. |
| Pub crawls | Build, inspect, share and reopen a feasible sequence of real pubs, with honest price and travel information. | Selected stops/order survive URL hydration and shared reopening. Missing prices remain missing. Walking distances/times have a clear basis; opening-hours uncertainty prevents claims all stops are open. Reorder/remove/complete and recap preserve identity/privacy. Non-pub dance/food additions carry their own type and cannot contaminate pint totals. | Existing composer, crawl routes, heritage crawls, plan collaboration, invite, URL hydration, night completion and recap. Retain current single planning entry. |

## Then-vs-Now and minimum evidence additions

Current `lib/thenVsNow.ts` compares venue cheapest price against most recent priced contribution. Venue identity alone does not establish a matching item. Replace comparison eligibility before displaying monetary/percentage movement.

A valid pair needs the same canonical venue, identifiable matching drink, matching serving/unit, two ordered observation dates and compatible price conditions. Regular price and a conditional deal cannot be collapsed without matching terms. Do not infer serving or brand from a bare price or venue minimum. Unknown equivalence produces two independent observations labelled with their sources/dates; omit delta, percentage, increase/decrease wording and trend ranking. Same-day duplicates are not a historical trend. Test brand mismatch, pint versus half-pint, unknown serving, reversed dates, distinct venues, promotion mismatch and a valid exact match.

Reuse existing price observation identity, source, time and serving fields first. If either input lacks drink/serving identity, carry those minimal fields through the comparison input rather than creating a second price store. Retain source references on both sides. Editorial atmosphere needs only a separately labelled estimate plus retrievable basis and review date where not already represented. Event/home planning needs existing event timing/source and typed stops; introduce missing fields only after identifying a concrete gap in those contracts.

## Delivery order and proof

1. Correct verified defects and evidence semantics: Date night Ask routing, nonexistent heritage titles, Then-vs-Now equivalence and unknown-versus-false atmosphere treatment. Add end-to-end chip-to-result tests, not only parser tests.
2. Restore public occasion visibility and shortlist-first date flow in current primitives. Verify desktop, 390px and keyboard use; keep existing listing-first decisions explicit in design review.
3. Join sourced dancing event, optional food/pub stages and private get-home planning. Prove timing uncertainty and non-pub price boundaries before presenting a complete evening.
4. Complete remaining occasion acceptance and preserve cross-journey state. Exercise populated, sparse, empty, stale, denied-permission, offline and failed-request fixtures; verify signed-out reads and authorized writes separately.
5. Re-run repository gate and affected browser suites on final implementation revision, then record actual results. Native parity needs simulator/device evidence; web success is insufficient. Production release remains a separate captain decision.

Historical reuse: TonightAgentPanel removed in #1278 to keep one planning entry, so restore unique outcomes through current composer. Nearby night-out-places API removed in #1127; reusable category/job/provenance contract remains. Compare that contract with current late-food/event/venue seams before adding any API. Do not resurrect duplicate endpoint simply because an old screenshot exposed a useful flow.

Completion proof pairs each criterion with current revision, fixture/source dates, test result and screenshots plus relevant network/action evidence. Missing data is a product state, not a reason to fabricate a passing result. This roadmap complements audit findings; it does not claim these outcomes already work.
