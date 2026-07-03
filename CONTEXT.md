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
