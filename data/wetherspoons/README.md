# J D Wetherspoon pub directory (first-party)

Scraped via **Firecrawl** from the official WP REST API:

`https://www.jdwetherspoon.com/wp-json/wp/v2/pubs`

## What we have

| File | Purpose |
|------|---------|
| `pubs.json` | Normalised directory (824 pubs): name, address, lat/lng, phone, hours, facilities, booking/hotel links |
| `pubs.geojson` | Same pins as a FeatureCollection for map overlays |
| `facilities.json` / `region.json` / `pub_status.json` | Taxonomy lookups |

Published copies also live under `public/data/wetherspoons/` for the app.

## What we do **not** have (honest)

Per-pub **food/drink item prices are not published on the website**.

- `/pub-menus/{slug}/` pages link to a **chain-wide** table-menu PDF (no extractable per-pub prices).
- `pub-menus` WP REST `acf` is empty.
- Live prices sit in the Order & Pay mobile app backend — out of scope (we do not reverse private APIs).

`menuPricesAvailableOnWeb` is always `false` on each pub until a first-party priced feed appears.

## Refresh

Requires `FIRECRAWL_API_KEY` in `.env` (gitignored). Direct curl to the WP API is Cloudflare-cached; Firecrawl scrapes bypass that.

```bash
set -a; source .env; set +a
node scripts/fetch_wetherspoons_pubs.mjs
```
