# Dark-mode pin edge — 390x844 evidence

Captured on a real Chrome at iPhone-class 390x844 (DPR 3) against `npm run dev`,
camera jumped to fixed coordinates so each before/after pair is the same view
twice, and the default `<=£8.00` price cap cleared so every band paints. The
`dense-dark-*`, `city-dark-*` and `dense-light-*` shots hide the app's own
overlays so the whole viewport is map and the pins can be measured;
`chrome-dark-*` is the same view with the overlays on, as the product ships it.

Band fills, band thresholds, pin sizes, the price tag and every ring are
unchanged. The only difference is the glass's EDGE: in dark mode the rim was
`--paper`, which resolves to the near-black `--ink-deep` there, so the rim
documented as "light on saturated glasses" was a black rim inside 1.1:1 of dark
land — no separation, and the stroke-only stems, feet and handles erased. It is
now the cream `--ink` at a hairline weight over an `--ink-deep` casing: the same
two tones the price tag beside the pin already pairs.

| Shot | Camera | What it shows |
| --- | --- | --- |
| `dense-dark-before-390x844.jpg` | Soho, z16, dark | Bucket-2 (`>£7`) and bucket-0 (`<=£5.50`) pins as faint smudges on dark buildings. The `£8.10` tag at the top is legible while its pin is not, which is the defect the price-label PR flagged: the label had become the only thing making those pins findable. |
| `dense-dark-after-390x844.jpg` | same view | Same pins, same colours, same sizes — now each glass has an edge, and the stems and feet are back. |
| `city-dark-before-390x844.jpg` | Bank/Cornhill, z16, dark | The `£8` cocktail: a dull rose triangle with no stem, best pixel **3.06:1** against the 3-D massed building roof under it. |
| `city-dark-after-390x844.jpg` | same view | The same pin at **8.23:1**. Also the `£3.49` bucket-0 pint and the `£7` bucket-1 cocktail beside it. |
| `chrome-dark-before-390x844.jpg` / `-after-` | Soho, z16, dark, app chrome on | The product view, so the change can be judged against the real Tonight Arc / control rail rather than a stripped canvas. |
| `dense-light-before-390x844.jpg` / `-after-` | Soho, z16, light | The light check. Light publishes no rim or casing, so light pins are drawn exactly as before; the one visible difference is the coupe, whose bowl was a ~1.5-unit lens that its own rim consumed and which now holds its band colour in both themes. |

Rendered contrast, measured off these frames (best pin pixel against the basemap
immediately around it, averaged per band, `n` = pins fully on open map):

| Band | Soho before | Soho after | Bank before | Bank after |
| --- | --- | --- | --- | --- |
| 0 `<=£5.50` | 4.93 | 12.06 | 5.20 | 11.66 |
| 1 `<=£7.00` | 5.42 | 11.31 | 6.41 | 11.91 |
| 2 `>£7.00` | (none in view) | — | 3.06 | 8.23 |
| 3 unpriced | 11.32 | 11.67 | 10.11 | 11.75 |

The unpriced band barely moves, and that is the tell: it was the only band whose
rim was already the cream `--ink` (`bucket === 3 ? t.ink : t.paper`), so in dark
mode the polarity was exactly backwards — the band that carries the least
information was the only one wearing a visible edge.

`__tests__/mapPinBandContrast.test.ts` holds the token-level half of this, read
from the shipped `app/theme.css` rather than a restated copy.
