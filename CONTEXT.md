# PubMaxing

PubMaxing helps people discover pubs and plan pub crawls using pint prices, location, and venue context.

## Language

**Venue**:
A place a user may visit during a crawl, such as a pub, bar, or restaurant-bar.
_Avoid_: Place, location, pub when the concept includes non-pub venues

**Pint Price**:
The observed price of a named pint at a venue.
_Avoid_: Drink cost, beer price

**Crawl Route**:
An ordered plan of venues for a user to visit in one outing.
_Avoid_: Itinerary, trip, journey

**Crawl Stop**:
One venue within a crawl route.
_Avoid_: Step, waypoint

**Home Area**:
The area a user starts from or cares about when discovering nearby crawl routes.
_Avoid_: Location, base, neighbourhood

**Visited Venue**:
A venue the user marks as having been to.
_Avoid_: Pin, check-in

**Venue Dataset**:
The source collection of venues, pint prices, map coordinates, and venue attributes used by the app.
_Avoid_: Scrape, CSV, data dump

**Crawl Preference**:
A user's chosen intent for a crawl route, such as cheap pints, historic venues, beautiful interiors, beer gardens, live sports, or friend-recommended stops.
_Avoid_: Filter, setting

**Crawl Score**:
The app's combined judgement of how well a crawl route matches the user's crawl preference.
_Avoid_: Ranking, rating

**Transport Mode**:
The way a user expects to move between crawl stops, currently walking or tube.
_Avoid_: Travel type, commute method

**Route Window**:
The maximum travel time a user is willing to spend between crawl stops or across a crawl route.
_Avoid_: Radius, distance limit

**Venue Heritage**:
The historical, architectural, cultural, or visual story that makes a venue interesting beyond price.
_Avoid_: History, beauty

**Visit Report**:
A user-submitted account of a visit to a venue, including beer quality, amenities, price observations, and qualitative notes.
_Avoid_: Review, check-in, pin

**Beer Quality**:
The user's judgement of how good a specific beer or pint was during a venue visit.
_Avoid_: Taste, drink score

**Amenity**:
A venue feature that affects crawl choice, such as beer garden, live sports, live music, darts, pool, food, or cocktails.
_Avoid_: Facility, feature

**Trusted Recommendation**:
A venue or crawl stop suggested through a friend, prior user preference, or app recommendation logic.
_Avoid_: Suggestion, tip

**Pint Drop**:
A single community contribution attached to a venue: an optional pint photo, an optional venue photo, an observed pint price, and an optional Passed-Down Note. The concrete form a Visit Report takes in the community layer.
_Avoid_: Post, check-in, upload

**Passed-Down Note**:
A short piece of personal or inherited knowledge about a venue — a memory from childhood, a story handed down from family, or local lore — tagged with the era it belongs to. The generational-bridge content, distinct from a rating.
_Avoid_: Review, comment, caption

**Provenance**:
Where a piece of venue knowledge came from, and how much it can be trusted. Every heritage or price claim is one of: Sourced (editorial, with a source link), Contributor (a user's Pint Drop), or Anecdote (an unverifiable Passed-Down Note). Provenance is always shown; it is never flattened away.
_Avoid_: Source (bare), reliability, trust score

**Contributor Handle**:
The lightweight identity a Pint Drop is attributed to, without requiring a full account in v1. A person, not a profile.
_Avoid_: User, account, username

**Production Store**:
The durable Supabase database and Storage bucket used for production Pint Drops, photos, and heritage cache data. Distinct from the in-memory demo store used when local credentials are absent.
_Avoid_: Backend (bare), database (when photos are included)

**Storage Object**:
A photo file saved in Supabase Storage and referenced from a Pint Drop by object key. The database stores the key, not an inline image or committed file.
_Avoid_: Image URL (when referring to the persisted record), blob

**Hidden Pint Drop**:
A Pint Drop removed from public reads after a report or moderation decision, while still retained for review.
_Avoid_: Deleted post, banned review

**Night Area**:
A curated public destination district used to plan a night, such as Clapham or Chiswick. Distinct from a user's private Home Area.
_Avoid_: Home Area, borough, neighbourhood when referring to the curated product boundary

**Daypart**:
The time-sensitive planning mode that changes recommendation weighting without changing Night Area geography: Daytime, After Work, Evening, Late Night, or Get Home.
_Avoid_: Session, opening period

**Night Context**:
The visible, editable set of inferred planning needs: Night Area, Daypart, party type, group size, budget, atmosphere, food, accessibility, and transport constraints.
_Avoid_: Hidden profile, prompt metadata

**Planned Night**:
A Crawl Route with a lifecycle from draft through completion, including explicit Crawl Stop actions and a Crawl Ending.
_Avoid_: Session, trip

**Crawl Ending**:
The user's explicit choice after a Crawl Route: Food, Get Home, or Keep Going.
_Avoid_: Conversion, exit state

**Pub Pal**:
A user-owned digital companion that combines a customizable cyber familiar, planning assistance, optional voice, confirmed structured memory, and cosmetic nightlife-mastery progression. Every Pub Pal uses the same factual, recommendation, price, moderation, and safety engine.
_Avoid_: Independent recommender, drinking-pressure mechanic, source-of-truth narrator

**Night Signal**:
One of six cinematic adult holographic guides—Beer, Gin, Rum, Whisky, Brandy, or Vodka—that establishes a visual alcohol world. Selecting one changes atmosphere and cosmetics; it becomes a planning preference only after explicit confirmation.
_Avoid_: Drink filter, real person, Pub Pal

**Pal Memory**:
A typed preference, correction, or completed-night outcome that the user has explicitly approved. Raw voice audio, transcripts, and generated character prose are never Pal Memory.
_Avoid_: Chat history, inferred profile, hidden memory

**Nightlife Mastery**:
Cosmetic progression earned through planning, discovery, verified contribution, heritage learning, crew coordination, and completed-night capture. Alcohol quantity never contributes.
_Avoid_: Drinking streak, consumption score, recommendation tier
