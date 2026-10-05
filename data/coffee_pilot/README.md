# Shoreditch coffee pilot

Hand-checked counter prices for three drinks at cafes in one box: latitude
51.5215–51.5305, longitude −0.0835 to −0.0705. `shoreditch.json` is the file.
The map's coffee lane draws these cafes and opens each one's prices in its
own sheet (`lib/coffeePilot.ts`). No pint band, pin colour, cheapest bucket or
Pint Index reads it.

## What earns a row

All of these, or the drink stays absent:

- `venueId` is a `venue-osm-` cafe on the London venue layer, inside the box.
- `venueName` names that cafe.
- `drink` is `flat white`, `latte`, or `matcha latte`. A blank "coffee" price
  is not a row.
- `priceGbp` is the figure the page stated, in pounds and pence.
- `sourceUrl` is the page that was opened.
- `observedAt` is the day that page was read.
- `standing` is `listed`.

A page that does not state one of the three drinks with a price adds nothing.
There is no estimate and no `cheapestPrice`.

## Doors checked on 2026-10-03

Every cafe in the box on the London venue layer, and what its own site showed.
A chain's own menu page counts for its door in the box. Delivery apps, Google
Places, review sites and menu aggregators were not used.

| Cafe | Outcome |
| --- | --- |
| Crosstown, 157 Brick Lane | Row: flat white, latte, matcha latte (chain drink pages) |
| Shoreditch Artist Cafe, 311 Old Street | Row: flat white, latte, matcha latte |
| Santo Remedio, 55 Great Eastern Street | Row: flat white, latte (menu PDF) |
| Love Churros, Boxpark | Row: flat white, latte (chain menu image) |
| Franzè & Evans, 101 Redchurch Street | Row: flat white, latte, matcha latte (menu PDF, hot prices) |
| Vintage Cafe, 17 Cheshire Street | Row: flat white, latte, matcha latte ("Green Matcha Latte") |
| Jujuhome Cha, Boxpark | Row: matcha latte |
| gram'n degrees, 93 Kingsland Road | Row: flat white, latte. Drink named "Matcha" not logged. The row's `venueName` is `Gramndegrees`, the name OSM gives the cafe since the 2026-10-04 layer refresh |
| The Bike Shed, 384 Old Street | Row: flat white, latte (drinks PDF, figures without £) |
| Gecko Coffeehouse, 49 Bethnal Green Road | Row: flat white, latte, matcha latte (figures without £). The row's `venueId` is `venue-osm-w373262267`: on the 2026-10-04 layer refresh OSM maps the cafe as a way, not node `n13684996801` |
| Urban Baristas, 6 Richmix Square | Row: flat white, latte, matcha latte (chain PDF, small size, figures without £). The row's `venueId` is `venue-osm-w756604573`: on the 2026-10-04 layer refresh OSM maps the door as a way, not node `n14022302823` |
| Holy Shot, 155 Bethnal Green Road | Row: flat white, latte, matcha latte (shown once the page loads in a browser) |
| Black Sheep Coffee, 10 Hearn Street | Site opened, no price: ordering is app or delivery only; door not on the chain's store list |
| Blank Street Coffee, 3 Redchurch Street | Site opened, no price: menu page names the drinks without prices |
| Allpress Espresso Bar | Site opened, no price; door not in the cafe finder |
| Origin Coffee, Charlotte Road | Site opened, no price |
| Old Spike | Site opened, no price; no Shoreditch door listed |
| Attendant, Great Eastern Street | Site opened, no price; door not on the locations page |
| FWD:Coffee | Site opened, no price |
| Dark Arts Coffee | Site opened, no price |
| Flying Horse Coffee | Site opened, no price |
| Kybelle | Site opened, no price: menu names the drinks without prices |
| Coffee Shop, 100 Shoreditch High Street | Site opened, no price |
| Devi Dhaba Curry Cafe | Site opened, no price for the three drinks |
| barrio | Site opened, no price for the three drinks (cocktail bar) |
| Leila's Cafe | Site opened, no price |
| Nkora | Site opened, no price |
| Rise & Bloom | Site opened, no price |
| HOKO Hong Kong Cafe | Site opened, no price for the three drinks |
| Katsute100 | Site opened, no price |
| Clara's | Site opened, no price for the three drinks |
| Artful Blend | Site opened, holding page only |
| Kahaila | Site opened, menu hosted off its own domain, not read |
| Cake Hole Cafe | Site opened, menu PDF from 2020, not logged |
| Lift Coffee, Oat Coffee, Oat, Long White Cloud, Bell Boi, Charista, The Yard, Quaker Street Coffee & Bubble Tea, Beans & Beyond, Mookies, Paper & Cup, Beans Love Greens, Franco's Take Away, Cafe Di Ross, Junkies, Damsel Collective, White Rabbit Cafe, Essence Cuisine, Jimmy Jacks, Corner Savoy, Savoy, First Step, Lower Eastside Deli, Clifton's Cafe, The Leaf, Small Square Cafe, Project 44 | No site of their own |
