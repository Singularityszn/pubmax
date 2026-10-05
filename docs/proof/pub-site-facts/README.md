# Pub site facts from Firecrawl reads, 5 October 2026

The pub copy pack skipped 1,266 London pubs for insufficient stored facts and
135 more whose drafts failed review. This run read the own sites of those pubs
and fed what each page states into the existing amenity harvest, gate, copy
generator and grounding judge.

## What was read

| Step | Pubs | How |
| --- | --- | --- |
| Known website (OSM or price dataset) | 372 thin pubs | Plain read first; Firecrawl when the network or a script kept the page from it |
| No website | 787 thin pubs | Firecrawl search by name and postcode, or street when no postcode; kept only when the host carries a distinctive word of the name and the page states that postcode or street |
| Firecrawl-first re-reads | 197 pubs without copy, then the 60 thinnest plain reads | Firecrawl before the plain read, PDFs excluded |

478 page texts were cached. Robots, the source policy, the chain list and the
landing fence apply to every read, exactly as in the plain harvest. 1,399 of the
account's 1,400 Firecrawl credits were used; no call was sent past that.

## Outcome

| Measure | `origin/main` | This branch |
| --- | --- | --- |
| Venues with any amenity fact | 1,027 | 1,114 |
| Evidence rows | 1,047 | 1,218 |
| Pubs with a judged description | 515 | 614 |
| Pubs that lost a description | - | 0 |

Gemini spend for this work: USD 0.21 for amenity extraction and USD 0.29 for
copy, USD 0.49 in all.

Four earlier evidence rows no longer pass the gate. Three state chain
boilerplate that new readers on the same chain site also state ("dart boards"
and "Dartboard" on Craft Union and Greene King pages, "prepare and cook food" on
J D Wetherspoon). The fourth, The Hat and Tun, is already refused by the gate on
`origin/main`; its row was stale. Hours and dog policy are not extracted: the
amenity vocabulary and the copy judge do not hold them. The cached page text
stays under the ignored `data-harvest/pub-website-amenities/pages` for that
follow-up.

## Proof

`api-after.jsonl` is `/api/venue/<id>` for two pubs the `origin/main` pack
skipped as `insufficient-stored-facts`. `after-mobile.png` is The Coach & Horses
at 390 px with its new description and tags.
