# Context.dev London pub observations

`scripts/whatson/contextDevHarvest.mjs` reads permitted OSM-stated pub websites, then follows their published events, offers, and contact links.
The reader checks the existing source policy and live robots rules before each paid request.
It makes one request at a time and reads at most four pages per venue.

`plan.json` records the candidates and credit allowance before the harvest.
`report.json` records page outcomes, source URLs, observation dates, content hashes, rejected records, publication counts, and the remaining balance.
Raw Markdown and resumable state remain in the ignored `data-harvest/contextdev-whats-on/` directory.

The publisher writes events and happy-hour slots into `public/data/whats_on/events_london.json`.
It writes matched opening hours into `data/amenities/london_pub_website_hours_dogs.json`.
Every fact keeps its source and observation date. The existing readers control freshness and exclude expired listings.
Ambiguous shared websites, conflicting hours, unsupported schedules, and records without stated times produce no facts.
Hours do not replace a row with a dog-policy observation because both fields share one source and date.

`monitors.json` records this harvest's ten provider monitors and completed baselines.
The provider checks those pages weekly. Each page check costs one credit.
The refresh command requests fresh Markdown only after an unseen provider change.
An unchanged page keeps its original observation date.
The refresh command requires an operator to run it. Remote monitors do not publish product data themselves.

The caller supplies `CONTEXT_DEV_API_KEY` through the environment.
The commands are:

```sh
npm run harvest:contextdev-whats-on -- --plan
npm run harvest:contextdev-whats-on -- --read --limit=100
npm run harvest:contextdev-whats-on -- --monitor
npm run harvest:contextdev-whats-on -- --refresh --publish
```

The initial harvest reserves 50 credits plus ten monitor baselines.
The saved plan bounds total spending even when the account refills.
`--publish` also works without a key when the raw observations and state remain available.
