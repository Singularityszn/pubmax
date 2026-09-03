# Editorial RSS overlay

390x844 screenshots of the credited link-out rail on `/out` and `/tonight`, plus a sample of the stored overlay JSON.

Captured 2026-08-27 against a live `npm run editorial:poll -- --all` (292 items, 14 allowlisted feeds, status `ready`).

- `out-390-light.png` - `/out` phone rail with real fetched items and `via {Publisher}` chips.
- `tonight-390-light.png` - same rail on `/tonight`.
- `latest.sample.json` - first three stored items. Closed keys only. Full pack is `public/data/editorial/latest.json`.

Tap is `target="_blank"` with `rel="noopener noreferrer"`. No start times. GLA rows use the linked attribution "Contains public sector information licensed under the Open Government Licence v3.0." ([licence](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)) when a GLA row is in this week. A `ready` snapshot older than 48 hours is withheld, and the rail says `No fresh picks to show just now. Last checked 15 Aug.` when the snapshot carries a printable day. It keeps `No fresh picks to show just now.` when it does not.
