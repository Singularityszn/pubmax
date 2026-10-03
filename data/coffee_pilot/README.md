# Shoreditch coffee pilot

Hand-checked counter prices for three drinks at cafes in one box: latitude
51.5215–51.5305, longitude −0.0835 to −0.0705. `shoreditch.json` is the file.
The map does not read it.

## What earns a row

All of these, or the drink stays absent:

- `venueId` is a `venue-osm-` cafe on the London venue layer, inside the box.
- `drink` is `flat white`, `latte`, or `matcha latte`. A blank "coffee" price
  is not a row.
- `priceGbp` is the figure the page stated, in pounds and pence.
- `sourceUrl` is the page that was opened.
- `observedAt` is the day that page was read.
- `standing` is `listed`.

A page that does not state one of the three drinks with a price adds nothing.
There is no estimate and no `cheapestPrice`.
