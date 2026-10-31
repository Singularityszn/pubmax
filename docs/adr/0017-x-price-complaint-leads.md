# ADR 0017: X price complaints are leads, never prices

## Status

Accepted on 2026-10-17 (captain's decision: option (a), leads only). Not built.
The lane is blocked until an X API search credential and a monthly read cap
exist, and the source table records the permission (see "Before it is built").

## Context

People post on X when a pub charges too much: "£8.40 a pint at The X", "£4.80
for a Diet Coke, robbery". That is the supply gap this tree keeps finding.
The site harvest reads only the pubs whose own sites publish a menu, and the
soft-drink lenses (Lucia 🐐, zero-sugar cola, still water) are thin because few
menus state a Coke Zero or a Diet Coke at all.

The tree already rules on everything such a post touches:

- A price on a price surface is read verbatim from a venue's own page or is a
  reviewed submission (`docs/UK_PRICE_HARVEST.md`, `lib/ukPriceBundle.ts`). A post
  is neither. It is one person's report of one visit.
- Nothing is fetched without a row in `lib/harvest/sourceRegistry.ts`. X has none.
  Scraping x.com is outside its terms and behind a login, so the only
  permissible read is X's own API.
- The anti-goals rule out a Twitter-for-pubs growth engine
  (`AGENTS.md`, `docs/plans/PLG_STRATEGY.md`). Reading posts to find work is
  allowed. Showing posts in the product is not.
- A lane with no producer is a promise of supply, and the tree deletes those
  (`data/AGENTS.md`, "a lane nobody writes is retired").

## Decision

**An X post that names a London venue, a drink and a pound figure becomes a
LEAD for a curator. It never becomes a price.** It writes nothing to
`public/data/uk_prices`, `public/data/drink_price_updates`, community prices or
Supabase.

1. **What is searched.** X API recent search, scoped to London, for price
   complaints about pints and beer, and about soft drinks by name: Coke, Coca-Cola,
   Diet Coke, Coke Zero, Pepsi Max, lemonade, J2O, tonic, and "soft drink". The
   query terms live in one module beside the lane and are tested.
2. **What is kept.** A post is kept only when its own text states a pound figure
   beside a drink word and names a venue the tree can match to one curated or
   UK base pub (name plus place, the same matching `lib/outerLondonOwnership.mjs`
   uses). Everything else is counted under the reason it was dropped, because a
   skip is a finding.
3. **What a lead holds.** Venue id, drink as written, the stated figure, the
   post's date and its URL, and a verbatim excerpt of at most 280 characters.
   No username, display name, profile, follower count or image. These are
   personal posts, and the lead needs none of that to be acted on.
4. **What a lead does.** It joins a gitignored curator queue, the same shape the
   Tavily nightly pass uses (`docs/TAVILY_NIGHTLY_PASS.md`), and it puts that
   venue's own website first in the next `harvest:uk-prices` run. If the venue's
   menu states the price, the menu row publishes through the site-harvest lane
   with the menu as its source. If it does not, the lead stays a lead. A curator
   may drop it. Nobody may publish the post's figure.
5. **What it costs.** A monthly read cap is enforced in code, and a run stops
   when the month's allowance is spent, as the Tavily pass does. The key comes
   from the environment (`X_BEARER_TOKEN`) and never from a committed file.
   `X_CLIENT_ID` and `X_CLIENT_SECRET` belong to social sign-in
   (`lib/socialOAuth.ts`) and are not this lane's credential.

| Do | Do not |
|---|---|
| Read X through its API under a source-table row | Scrape x.com or read it through a renderer |
| Keep the venue, drink, figure, date, URL and a short excerpt | Keep a handle, a name, a profile or an image |
| Queue a lead for a curator and re-read the venue's own menu | Publish the post's figure, even as "reported" |
| Count every dropped post by its reason | Show posts, a feed or a complaint count in the product |
| Cap reads per month in code | Run unbounded or on a key held in a file |

## Before it is built

- An X API plan that includes recent search, its bearer token set as
  `X_BEARER_TOKEN` in the environment that runs the lane, and a monthly read cap
  from the captain.
- A `sourceRegistry.ts` row for the X API with the terms read live on the day,
  its evidence and its `checkedOn`, as the open-data rows carry.
- Tests beside the lane for the keep rule, the venue match, the field allow-list
  (no personal fields can reach the queue) and the budget stop.

## Consequences

- Soft-drink and pint coverage can grow where drinkers complain, without one
  figure from a post reaching a pin, a lens or the Pint Index.
- A curator spends time on venues people are talking about, not a random walk
  through the estate.
- If we later want a drinker's report to publish as a dated "reported" price,
  that is a new ADR that supersedes decision 4, not a flag on this lane.
