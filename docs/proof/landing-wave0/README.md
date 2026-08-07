# Landing wave 0 proof

Browser evidence for the map-first acquisition landing (`landingFindMyPint`
flag off, the shipped default).

## How the shots were made

```bash
NEXT_DIST_DIR=.next-prod npm run build
NEXT_DIST_DIR=.next-prod npm run start
```

`chrome-devtools-axi open http://localhost:3100`, `emulate --viewport` for
each size, theme toggle via the nav button, `screenshot`.

## Shots

| File | State |
|---|---|
| `01-desktop-1440-light.png` | 1440px, light theme |
| `02-desktop-1440-dark.png` | 1440px, dark theme |
| `03-mobile-390-light.png` | 390px, light theme |
| `04-mobile-390-dark.png` | 390px, dark theme |

## What they show

- Primary CTA is "Open the map" (`primaryCtaHref`), no geolocation gate.
  "Find my pint" and "Plan with friends" are secondary text links.
- H1 carries the price pain figure, footer rhythm reused for the hero.
- ThamesHero keeps the DrinkGlyph identity, adds a warm basemap wash and
  band-colour rims as decoration only. The figcaption states example prices
  are not live listed prices.
- Mobile shots show the product frame (`.lpHeroMap`) entering the first
  390x844 viewport; the stats-chip readout (`.lpLiveReadout`) sits below it.

A pre-existing, out-of-scope cookie-consent banner overlaps the lower part
of both mobile shots. Not part of this change.
