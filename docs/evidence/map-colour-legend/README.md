# Map colour key evidence

Review target: Manchester landing view at zoom 11.2.

## Decision

Desktop keeps a small Key control on the map. Phone puts Key first in the existing More sheet. The phone map stays unchanged until someone opens the sheet, and returns in one tap. No control was added to the top bar.

The desktop cluster donut already showed its known price mix at zoom 11.2. Individual pins begin at zoom 12, 0.8 above the landing view. Phones and large cluster sets used solid circles whose colour meant cluster size. They now use the most common known price band inside each cluster. Grey means that cluster has no known price. Cluster radius, count, zoom limits and collision rules did not change.

## Current map language

- Green fill: pub pint is £5.50 or less. Other venues are low within their type.
- Amber fill: pub pint is over £5.50 and no more than £7. Other venues are middle within their type.
- Red fill: pub pint is over £7. Other venues are high within their type.
- Grey fill: no price that the current view can show is on the map.
- Split cluster ring: mix of known price bands inside a desktop cluster. Centre number counts every pub, including pubs without a known price.
- Solid cluster: most common known price band inside a fallback cluster. Centre number counts every pub. Grey means none has a known price.
- Pint, wine, cocktail or spirit glass: pub. Glass follows its recorded drinks or selected drink view.
- Coupe glass: bar.
- Skewer: late-food venue.
- Fork: restaurant.
- Hollow brass circle and dot: UK base pub. It never gets a map price, band or price label.
- Brass pictogram: landmark, not a pub.
- Blue centre with a pulse: your approximate location.
- Small blue dot beside a pin: one recent pint report. A second independent drinker agreeing can let that figure set the pin band.
- Blue ring: visible Pint Drop at that pub.
- Amber ring: quiz tonight.
- Bright blue ring: live sport tonight.
- Bright brass ring: deal tonight.
- Dark blue ring: live music tonight.
- Thin brass ring: pub added from a public listing.
- Double brass ring: selected pub. A selected UK base pub uses its quieter single-ring treatment.
- Coloured outer ring: pub inside the selected place story.
- Numbered dark circle: crawl stop.
- Solid route line: walking route along roads.
- Dashed route line: straight estimate while a road route is unavailable.
- No-alcohol view: no separate pin shape. Alcohol-free or soft-drink price sets the band; missing price stays grey.
- Confirmed community price: no separate map badge. Two independent drinkers must agree within the policy window before the figure can affect map colour. Its dated badge lives on the pub sheet.

## Similar marks with different meanings

- Blue centre with a pulse means your location. Small blue dot beside a pin means one recent, unconfirmed pint report. Blue ring means a visible Pint Drop.
- Thin brass ring means a public-listing source. Double brass ring means selection.
- Desktop split clusters show price mix. Solid fallback clusters show one dominant known band.
- A confirmed community figure changes the ordinary price band. It does not add a confirmed badge to the map.
- No-alcohol view changes price meaning but adds no distinct pin shape.

## Captures

Before:

- [Desktop dark, 1440 by 900](before-desktop-dark.png)
- [Phone dark, 390 by 844 at 3x](before-mobile-dark.png)

After, map key open:

- [Desktop dark, 1440 by 900](after-desktop-dark.png)
- [Desktop light, 1440 by 900](after-desktop-light.png)
- [Phone dark, 390 by 844 at 3x](after-mobile-dark.png)
- [Phone light, 390 by 844 at 3x](after-mobile-light.png)

After, unobscured phone map at the same landing zoom:

- [Phone dark, 390 by 844 at 3x](after-mobile-dark-map.png)
- [Phone light, 390 by 844 at 3x](after-mobile-light-map.png)

The after phone captures measure 390 CSS pixels wide with a 390-pixel document width. All five sheet tabs fit between x=4 and x=388. Tabs and disclosure controls have 44-pixel touch targets. Accessibility snapshots expose Map controls as a dialog, Key as the selected tab, price bands as text, and Pin shapes, Dots and rings, and Routes as disclosures. The desktop Key is a native button; Escape closes it and Enter reopens it with focus retained.

Code authorities: `components/map/canvas/buildScene.ts`, `components/map/canvas/filters.ts`, `components/map/canvas/geojson.ts`, `components/map/canvas/donutClusters.ts`, `lib/mapIcons.ts`, `lib/mapPriceLegend.ts`, `lib/communityPrice.ts`, `components/map/communityPriceSignals.ts`, and `lib/cities.ts`.
