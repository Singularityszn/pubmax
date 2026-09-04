# Launch screens

The screen table for the September 2026 relaunch (issue #1354). One row per
route a visitor can reach from the phone chrome or a shared link. Each row
names the kicker, the heading, the ONE primary action and at most one
secondary, in the order the `Screen` primitive renders them
(`components/ui/screen.tsx`). The surface audit PR walks this table route by
route; `__tests__/coreUiAudit.test.ts` counts one primary action per route.

Rules the table obeys:

- Value first, account at the first kept action. No primary action on a
  public route is "Sign in".
- The primary is a verb. It is the thing a first-time visitor does inside 60
  seconds (the release metric).
- Kickers are sentence case and name the surface or the city. The brand word
  PUBMAXX keeps its capitals.
- British English, no em dashes, no exclamation marks.
- A route that is a list (Out, Social, Messages) keeps its primary in the
  head; its empty state uses `EmptyState` with at most one quiet way onward.
- Routes another track owns (Map canvas, nav) are listed so the table is
  complete; the design track sends those owners a note rather than editing.

| Route | Kicker | Heading | Primary action | Secondary |
|---|---|---|---|---|
| `/` | PUBMAXX | What a pint costs, pub by pub. | Still £X? (the pub on the card, its Pint Drop door `/map?sel=<id>&log=1`; the plain receipt door `/near?locate=1` when no card backs the document) | Meet your Pub Pal |
| `/map` and `/map/[city]` | London (the city name) | (no heading: the map is the surface) | Use my location | Choose an area |
| `/near` | Near you | Cheapest pints within a short walk. | Find my pint | Pick a patch |
| `/today` | Today in London | What's on across London today. | Find my pint | Open the map |
| `/tonight` | Tonight in London | What's on across London tonight. | Find my pint | Open the map |
| `/out` | Out in London | What's on, sourced. | Open the map | Plan a night |
| `/social` | Social | Crews and people who are already here. | Post | Find your lot |
| `/plan` | Sort the outing | Describe the outing. We'll put it in order. | Sort it (submit the ask) | Guide me instead |
| `/plan/[id]` | Your plan | (the plan's own name) | Send to the crew | Open the map |
| `/pal` | Your Pub Pal | A little signal that becomes yours. | Meet your Pub Pal | Back to the map |
| `/pal/chat` | Your Pub Pal | (the Pal's name) | Send | Plan with the Pal |
| `/u/you` and `/u/[handle]` | You (or the handle) | (the display name) | Edit profile (owner) or Follow (visitor) | Share |
| `/login` | Sign in | Welcome back (or: Make an account) | Send the link | Use a password |
| `/choose-city` | Places | Pick a city. | London | Browse pubs across the UK |
| `/discover` | Discover | Pint prices, pub stories and routes worth walking. | Open the map | Find my pint |
| `/pubs` | Pubs | Every pub on record. | Open the map | Find my pint |
| `/borough` | London | London, by the area you drink in. | Open the map | Find my pint |
| `/borough/[slug]` | (the borough) | Pubs in (the borough). | Open the map here | Find my pint |
| `/crawls` | Crawls | Pub stories mapped into walks. | Start a crawl | Open the map |
| `/crawls/[slug]` | Crawl | (the crawl's own name) | Start this crawl | Open the map |
| `/drinks` | Drinks | What each drink costs, pub by pub. | Open the map | Find my pint |
| `/drink/[slug]` | (the drink) | (the brand) prices across London. | Open the map | Find my pint |
| `/historic` | Historic pubs | London's historic pubs. | Open the map | Start a crawl |
| `/historic/[slug]` | Historic pub | (the pub's own name) | Open on the map | Plan a night here |
| `/pint-index` | Pint Index | London pint prices, month by month. | Open the map | Download the CSV |
| `/pint-index/[month]` | Pint Index | London pint prices, (month). | Open the map | Download the CSV |
| `/feed` | Stories | Stories. | Drop a pint | Open the map |
| `/rounds` | Rounds | Who bought the last round. | Start a round | Open a round code |
| `/messages` | Messages | Messages. | New message | Find your lot |
| `/activity` | Activity | Activity. | Open the map | Find your lot |
| `/moment` | Moment | Save a Moment. | Save this Moment | Back |
| `/about` | Our story | (the founder line) | Open the map | Contact |
| `/founders` | Founding members | The first hundred. | Open the map | Find your lot |
| `/contributors` | Contributors | Contributor record. | Drop a pint | Open the map |
| `/privacy` and `/terms` | Small print | How PUBMAXX handles your data. / The deal in plain English. | (none: a legal page has no action) | Contact |

Headings printed in parentheses are the route's own data and are not copy.
Routes that already carry the right heading keep it; the audit changes the
kicker, the action hierarchy and the decoration, not the sentence.
