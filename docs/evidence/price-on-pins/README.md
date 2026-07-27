# Price on pins — 390x844 evidence

Captured on a real Chrome at iPhone-class 390x844 against `npm run dev`, camera
jumped to fixed coordinates so the before/after pair is the same view twice.
Pin fill, cluster donuts and the provisional badge are unchanged throughout;
the only difference is the figure under the glyph.

| Shot | Camera | What it shows |
| --- | --- | --- |
| `dense-dark-before-390x844.jpg` | Piccadilly/Soho, z15, dark | The map as it was: a pin says "somewhere in this band" in colour and nothing more. Learning what a pint costs takes a tap. |
| `dense-dark-after-390x844.jpg` | same view | The same pins, now readable as prices — £6.15, £6.50, £6.05, £6.40, £6.20, £6.90. Pins with no sourced price (the pale glasses) stay bare, and a few priced pins have dropped their tag to a neighbour: that is `text-optional` yielding, the label going so the pin can stay. |
| `dense-light-after-390x844.jpg` | same view, light | Ink-on-paper halo carries the figure over the pale Positron basemap exactly as it carries it over night land. Same tag, both themes, no second colour system. |
| `sparse-dark-after-390x844.jpg` | Hampstead, z14.6, dark | The quiet case. One sourced price (£5.80) speaks; the unpriced pubs around it show a glyph and no placeholder — never a "£?". |
| `belowgate-dark-after-390x844.jpg` | Piccadilly/Soho, z13, dark | Below `PIN_PRICE_LABEL_MIN_ZOOM` the `text-field` evaluates to `""`, so the city overview is the map it was before labels existed: cluster donuts, counts, not one figure. |

The gate sits at z14 because that is measured, not guessed: at z13.5 this same
390px viewport over the West End resolved **three** individual pins (everything
else was still a cluster disc); at z14 it resolved **31** with no discs at all,
18 of them carrying a sourced price.
