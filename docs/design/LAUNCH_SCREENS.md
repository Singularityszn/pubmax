# Launch screens

The screen table for the September 2026 relaunch (issue #1354). One row per
route a visitor can reach from the phone chrome or a shared link. Each row
names the kicker, the heading, the ONE primary action and at most one
secondary, in the order the `Screen` primitive renders them
(`components/ui/screen.tsx`). The surface audit PR walks this table route by
route; `__tests__/coreUiAudit.test.ts` counts one primary action per route.

Rules the table obeys:

- Value first, account at the first kept action. No primary action on a
  public route is "Sign in", except Messages and the Social posts tab while
  `PUBMAX_SOCIAL_FRIENDS_LAUNCH=1`. On those private surfaces the
  body a signed-out reader meets IS the sign-in boundary, so there is no value
  left to paint and the door is the first kept action; the boundary under it
  then prints its line alone rather than repeating the same link. The rule
  stands unchanged wherever the body answers with something a stranger can use:
  `/social?tab=discover` paints the map, not the door, and so does the
  invite-only rollback. Fences: `__tests__/launchRoutes.b.test.tsx` and
  `e2e/design-taste-wave-1.spec.ts`.
- The primary is a verb. It is the thing a first-time visitor does inside 60
  seconds (the release metric).
- Kickers are sentence case and name the surface or the city. The brand word
  PUBMAXX keeps its capitals.
- British English, no em dashes, no exclamation marks.
- A route that is a list (Out, Social, Messages) keeps its primary in the
  head; its empty state uses `EmptyState` with at most one quiet way onward.
- A FORM SCREEN PAINTS NO HEAD PRIMARY (captain, 7 September 2026). Its one
  painted control is the form's own submit, beside the field it submits,
  carrying `data-primary-action` itself, so `Screen`'s `primary` is omitted.
  `/login` painted "Send the link" above the email field with the form's own
  disabled submit under it, and `/pal/chat` painted "Send" above the
  transcript while the composer's Ask circle was the submit: two doors for one
  action, and the painted one was the far one.
- Routes another track owns (Map canvas, nav) are listed so the table is
  complete; the design track sends those owners a note rather than editing.
- A ROUTE THE ROUTER REDIRECTS IS NOT A SCREEN. `next.config.mjs` permanently
  308s `/discover`, `/drinks` and `/feed` to `/social`, so they render no
  document and have no primary action to count. They held full rows here until
  17 September 2026, and the surface audit reported coverage for all three
  because two launch-route tests rendered page components no reader can reach.
  Where a redirected address used to land is recorded under the table rather
  than as a row, and `__tests__/coreUiAudit.test.ts` fails on a row whose route
  the router redirects.

| Route | Kicker | Heading | Primary action | Secondary |
|---|---|---|---|---|
| `/` | PUBMAXX | What a pint costs, pub by pub. | [Front-door action contract](../rules/components-design-system-and-launch-primitives.md#the-front-door-shows-london-then-answers-in-one-tap) | See the same contract |
| `/map` and `/map/[city]` | London (the city name) | (no heading: the map is the surface) | Use my location | Choose an area |
| `/near` | Near you | Cheapest pints within a short walk. | Find my pint | Pick a patch |
| `/today` | Today in London | What's on across London today. | Find my pint | Open the map |
| `/tonight` | Tonight in London | What's on across London tonight. | Find my pint | Open the map |
| `/out` | Out in London | What's on (tonight, tomorrow or the weekend). | Open the map | Plan a night |
| `/social` | Social | Crews and people who are already here. | Post (a verified account); Sign in (a stranger on the posts tab); Open the map (a stranger on `?tab=discover`, and a stranger while `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0`) | Find your lot |
| `/plan` | Sort the outing | Describe the outing. We'll put it in order. | Sort it (submit the ask) | Guide me instead |
| `/plan/[id]` | Your plan | (the plan's own name) | Send to the crew | Open the map |
| `/pal` | Your Pub Pal | A little signal that becomes yours. | Meet your Pub Pal | Back to the map |
| `/pal/chat` | Your Pub Pal | (the Pal's name) | the composer's own submit (Ask), beside the field; the head paints none | Back to your Pub Pal |
| `/u/you` and `/u/[handle]` | You (or the handle) | (the display name) | Edit profile (owner) or Follow (visitor) | Share |
| `/login` | Sign in | Welcome back (or: Make an account) | the email form's own submit (Email me a sign-in link), beside the field; the head paints none while the form is on screen | Use a password |
| `/places` | Places | Pick a city. | Open London | Browse pubs across the UK |
| `/pubs` | Pubs | Every pub on record. | Open the map | Find my pint |
| `/borough` | London | London, by the area you drink in. | Open the map | Find my pint |
| `/borough/[slug]` | (the borough) | Pubs in (the borough). | Open the map here | Find my pint |
| `/crawls` | Crawls | Pub stories mapped into walks. | Start a crawl | Open the map |
| `/crawls/[slug]` | Crawl | (the crawl's own name) | Start this crawl | Open the map |
| `/drink/[slug]` | (the drink) | (the brand) prices across London. | Open the map | Find my pint |
| `/historic` | Historic pubs | London's historic pubs. | Open the map | Start a crawl |
| `/historic/[slug]` | Historic pub | (the pub's own name) | Open on the map | Plan a night here |
| `/pint-index` | Pint Index | London pint prices, month by month. | Open the map | Download the CSV |
| `/pint-index/[month]` | Pint Index | London pint prices, (month). | Open the map | Download the CSV |
| `/rounds` | Rounds | Who bought the last round. | the start form's own submit (Start a Round), no head primary | Open a round code |
| `/messages` | (none) | Messages | New message (signed in); Sign in (signed out) | (none) |
| `/activity` | Activity | Activity. | Open the map | Find your lot |
| `/moment` | Moment | Save a Moment. | Save this Moment | Back |
| `/about` | About | (the founder line) | Open the map | Contact |
| `/founders` | Founding members | The first hundred. | Open the map | Find your lot |
| `/contributors` | Contributors | Contributor record. | Drop a pint | Open the map |
| `/privacy` and `/terms` | Small print | How PUBMAXX handles your data. / The deal in plain English. | (none: a legal page has no action) | Contact |

Headings printed in parentheses are the route's own data and are not copy.
Routes that already carry the right heading keep it; the audit changes the
kicker, the action hierarchy and the decoration, not the sentence.

## Retired addresses

Three addresses the table used to hold rows for. The router answers each with a
permanent redirect, so they are here rather than in the table: a reader who
follows an old link still lands somewhere sensible, and nothing in this file
claims a screen behind them.

| Address | Where the router sends it | What answers instead |
|---|---|---|
| `/discover` | `/social?tab=discover` | the public Pubs and pints tab of `/social` |
| `/drinks` | `/social?tab=discover` | the same tab |
| `/feed` | `/social` | the posts tab of `/social` |
