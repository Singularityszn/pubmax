# London outing recovery, integrated increment

Integration revision: `fd83de6a7`. Reviewed source increment: `bc42ca4bc`.
Local branch: `codex/london-outing-recovery-20260922`.

Date night now opens `/outings` with a shortlist before chat. Seven occasion
choices reuse existing venue ranking and sourced Out event cards. Area and day
remain in browse navigation and Ask or Plan handoffs. Editorial estimates show
their positive amenity basis and explicitly state that noise, seating and opening
hours are not confirmed. No new price claim is rendered on this surface. Venue
details continue to own prices.

The route is registered in path normalization, pageview analytics and the
performance budget inventory. Its conservative initial ceilings match the
measured `/out` route family without raising any existing ceiling. Metadata is
explicitly `noindex, follow` until the listing and planning lanes are complete,
so it is intentionally absent from the sitemap.

## Routing and listing evidence

Fresh baseline evidence reproduced the audited date and history failure:
`A date-night pub with some history, calm not loud` claimed `venue_heritage`
and used request fragments as a venue name. Generic date-night preferences now
stay on `search_venues`, including `Date night in Camden with some history`.
Named heritage still resolves an actual venue identity.

Dancing synonyms route to sourced Out events filtered to `Club night`. Live
music browse filters the same Out listing source to gigs. Publisher provenance
remains on event results, and missing providers or inventory render explicit
scarcity states instead of replacement pubs. Pub-stop planning and the existing
TfL or Safe Night handoff remain available around event browsing.

## Validation

- Fresh focused run: 8 files and 196 tests passed.
- Scoped ESLint and full `npm run typecheck` exited 0.
- Budget ratchet check recognized one new `/outings` row and no raised ceiling.
- Isolated `NEXT_DIST_DIR=.next-prod npm run build` completed and emitted
  dynamic `/outings`.
- Local production browser checks at 390 by 844 and 1440 by 1000 rendered six
  Camden date candidates, verified grounded Ask and Plan links, navigated to
  Live music, and reported no console or page errors.
- Screenshots: `.tmp-evidence/recovery/outings-date-390.png`,
  `.tmp-evidence/recovery/outings-date-768.png` and
  `.tmp-evidence/recovery/outings-date-1440.png`.
- CUA could not run because the Mac was locked. Screenshot and interaction proof
  above is headless Playwright evidence, not native CUA evidence.
- Jev advisory record: `.tmp-evidence/recovery/jev-outings-increment.json`.
  It returned `supports` with confidence 0.94. Deterministic evidence controls.

No full repository verify, migration, production request, remote write, push,
merge or deployment ran in this increment.

## Explicit limits

This is not a combined event-aware itinerary. Event identity persisted into a
shared plan, automatic before and after stop scheduling, timed home-journey
validation, group and budget controls, and alcohol-aware refinement remain
outstanding. Home destination stays with the external journey planner and is not
placed in a public plan URL.

Music Ask and browse still use different listing paths. Ask cards do not retain
event start and finish fields. Venue shortlist cards do not yet show result-level
source date or explicit price coverage or absence. Provider credentials are not
configured in the keyless proof environment, so real current listing density was
not established here.
