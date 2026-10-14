# Active-provider map credits

These captures record the production build on 8 October 2026. The before build
uses published commit `8911fadc12798665056418c0eefe42aefc4c4a93`. The after build
includes the provider correction in this commit.

The browser loaded the real OpenFreeMap and CARTO styles. For the fallback
scenario, it refused only OpenFreeMap style requests. The map then loaded CARTO
through its existing recovery path. Both runs used Chromium with SwiftShader,
blocked service workers, and reduced motion on a private local server.

The phone's Key sheet previously named OpenFreeMap and OpenMapTiles on the CARTO
map. It now names CARTO and OpenStreetMap contributors. The pub-data ODbL line
remains present. Desktop attribution still follows the map's own source credits.
The provider remains unknown until a style loads.

## Phone credits at 390×844

| Theme and provider | Before | After |
| --- | --- | --- |
| Light, OpenFreeMap | [Before](before/390-light-openfreemap-credits.png) | [After](after/390-light-openfreemap-credits.png) |
| Light, CARTO fallback | [Before](before/390-light-carto-credits.png) | [After](after/390-light-carto-credits.png) |
| Dark, OpenFreeMap | [Before](before/390-dark-openfreemap-credits.png) | [After](after/390-dark-openfreemap-credits.png) |
| Dark, CARTO fallback | [Before](before/390-dark-carto-credits.png) | [After](after/390-dark-carto-credits.png) |

## Map surface

| Viewport, theme and provider | Before | After |
| --- | --- | --- |
| 390×844, light, OpenFreeMap | [Before](before/390-light-openfreemap-map.png) | [After](after/390-light-openfreemap-map.png) |
| 390×844, light, CARTO fallback | [Before](before/390-light-carto-map.png) | [After](after/390-light-carto-map.png) |
| 390×844, dark, OpenFreeMap | [Before](before/390-dark-openfreemap-map.png) | [After](after/390-dark-openfreemap-map.png) |
| 390×844, dark, CARTO fallback | [Before](before/390-dark-carto-map.png) | [After](after/390-dark-carto-map.png) |
| 1440×900, light, OpenFreeMap | [Before](before/1440-light-openfreemap-map.png) | [After](after/1440-light-openfreemap-map.png) |
| 1440×900, light, CARTO fallback | [Before](before/1440-light-carto-map.png) | [After](after/1440-light-carto-map.png) |
| 1440×900, dark, OpenFreeMap | [Before](before/1440-dark-openfreemap-map.png) | [After](after/1440-dark-openfreemap-map.png) |
| 1440×900, dark, CARTO fallback | [Before](before/1440-dark-carto-map.png) | [After](after/1440-dark-carto-map.png) |

[Before output](before/results.json) and [after output](after/results.json) record
the successful style URL and rendered credits for each case. CARTO's source
TileJSON supplies `© CARTO, © OpenStreetMap contributors`. Its provider link is
`https://carto.com/about-carto/`.

## Regression checks

The unit suite covers OpenFreeMap, CARTO, and the state before any style loads.
The four deterministic browser tests use both themes and exercise the actual
primary-style failure path. The real-CDN captures above provide separate visual
proof. The clock regression fixes time at day 29 and day 30 after a dismissal,
without changing the product's 30-day quiet window.

The production build passed. The focused unit suites passed all 12 tests, and
the provider browser suite passed all four tests. `npm run verify:no-mistakes`
passed, including 21,460 main unit tests, 554 database tests, and 10 PostgreSQL
harness tests. The main suite retained one existing skip. The gates also passed
lint, type checking, data validation, and the dependency audit.

These are local production-browser results. They do not establish native-device
behaviour, deployment, or production release status.
