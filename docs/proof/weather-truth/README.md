# Weather truth proof (2026-09-24)

## Independent reference (Open-Meteo, Piccadilly centroid)

At capture time (~14:30 London): ~20°C feels like, partly cloudy, 0 mm precipitation, light wind (~4 km/h), daylight, sunset ~18:54.

## Production before change (`pubmaxxing.com`)

Screenshots: `prod-mobile-*` and `prod-desktop-*`.

Live API at capture: `GET /api/tonight-conditions` returned 17°C cloudy, drink line "Mild and calm. Riverside pint weather." (not generic beer-garden copy).

## Local after change

Branch `fm/pubmax-weather-truth` adds `factsLine` on conditions surfaces (temp, rain %, wind, sunset, day/night), blocks beer-garden rules when `is_day=0`, and serves stale observations with explicit "Last read" copy instead of hiding the strip.

Full `npm run build` / `npm run verify` blocked on main by expired famous-venue data (#1814); weather unit tests and `tsc` pass on this branch.
