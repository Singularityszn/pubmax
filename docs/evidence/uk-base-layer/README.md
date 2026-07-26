# UK base layer — 390x844 evidence

Captured against a production build (`NEXT_DIST_DIR=.next-branch npm run build`)
at iPhone-class 390x844, dark theme. `data-uk-base-count` on `.mapCanvasWrap` is
the base layer's live feature count for the viewport.

| Shot | Camera | `uk-base-count` | What it shows |
| --- | --- | --- | --- |
| `london-overview-390x844.jpg` | `/map` default (z10.7) | **0** | The curated overview, unchanged: price-coloured cluster discs and their counts, and not one base pub. Below the zoom gate the layer does not exist — no manifest, no shards, no features. |
| `london-390x844.jpg` | `/map`, 3 zoom steps (~z14.5) | 1001 | Base pubs as small unfilled brass rings among the curated drink glasses. Clearly the lesser mark: no price colour, roughly half the footprint, and they lose every collision to a curated pin. |
| `manchester-390x844.jpg` | `/map/manchester`, 1 zoom step | 1924 | Clusters over a dense UK region at phone width — discs stay apart, counts stay legible. |
| `manchester-street-390x844.jpg` | `/map/manchester`, 3 zoom steps | 1924 | Curated wins: central Manchester is ~100% covered by the curated city pack (`dedupe_report.json`: 543 of 544 matched), so the base layer correctly adds nothing here. No double-pinning. |

The base layer's own coverage in Greater Manchester sits outside the curated
core — 23 base pubs in the Middleton/Blackley box alone — which is exactly the
gap it exists to fill.
