# Context.dev London pub observations

`scripts/whatson/contextDevHarvest.mjs` reads permitted OSM-stated pub websites, then follows their published events, offers, and contact links.
The reader checks the existing source policy and live robots rules before each paid request.
It makes one request at a time and reads at most four pages per venue.
The harvest is a one-shot read. It has no provider monitor and no refresh command.

`plan.json` records the candidates and credit allowance before the harvest.
`report.json` records page outcomes, source URLs, observation dates, content hashes, rejected records, publication counts, and the remaining balance.
Raw Markdown and resumable state remain in the ignored `data-harvest/contextdev-whats-on/` directory.

The publisher writes events and happy-hour slots into `public/data/whats_on/events_london.json`.
A successful read of a page replaces every row that the lane held from that page.
A held row whose time has passed leaves the file.
A slot that several pages of one pub list publishes once. A sport slot is also its fixture, because a pub screens several fixtures at once.
A run of date and clock lines directly above a listing heading dates that listing, as fixture lists lay them out.
The events refresh and the venue events harvest keep the current own-site rows when they rewrite the file.

Greene King timed fixtures come from its FANZO partner through gated booking links, so they are not first-party.
The reader does not publish them. The Greene King live-sport attribute row stays as it is.

The publisher writes matched opening hours into `data/amenities/london_pub_website_hours_dogs.json`.
It applies the amenity writer's rules to the old and new rows together.
A page that also states a dog policy publishes that policy beside the hours, as the amenity writer does.
An hours passage that more than one pub on one host states is the chain's, so no row keeps it.
A row read on a later day stays when the other writer reads an older page for the same pub.
Hours do not replace a row with a dog-policy observation because both fields share one source and date.

Every fact keeps its source and observation date. The existing readers control freshness and exclude expired listings.
Ambiguous shared websites, conflicting hours, unsupported schedules, and records without stated times produce no facts.

`monitor-deletions.json` records the deletion of the ten provider monitors that an earlier version of this harvest created.
It lists each monitor ID, its page, the confirmation that the provider no longer holds it, and the live balance. It stores no secret.

The caller supplies `CONTEXT_DEV_API_KEY` through the environment.
The commands are:

```sh
npm run harvest:contextdev-whats-on -- --plan
npm run harvest:contextdev-whats-on -- --read --limit=100
npm run harvest:contextdev-whats-on -- --publish
```

The harvest reserves 50 credits.
The saved plan records the original allowance, and a second `--plan` keeps it.
`--publish` also works without a key when the raw observations and state remain available.

`proof/data-before-after.json` contains the dataset counts after the final publish.
`proof/venue-hours-response.json` contains the venue response that shows published opening hours.
The browser captures are in [`docs/proof/contextdev-whats-on/`](../../../docs/proof/contextdev-whats-on/README.md).
