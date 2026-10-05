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

478 page texts were cached. Robots, the source policy and the chain list
applied to every read. In this run the landing fence applied only to plain
reads: a Firecrawl read was checked against the URL asked for, not the URL
Firecrawl landed on. 1,399 of the account's 1,400 Firecrawl credits were used;
no call was sent past that.

## Review faults and the rebuild

Review found three faults in the first write of this run:

- A site that only the price dataset gives was read with no address check. The
  Islington Two Brewers took the Clapham Two Brewers' page and its facts.
- A dataset venue that duplicates an OSM pub read that pub's page, so the chain
  list proved four single-pub pages chain-wide.
- Firecrawl reads were not fenced on the URL they landed on.

The harvest now fences the Firecrawl landing. A site that only the price
dataset gives must state the pub's postcode or street, as a located site must.
A dataset venue's read of a page another pub owns is a duplicate: it gives the
venue no evidence and proves nothing chain-wide. These checks also apply to a
page read again from the cache. A cached Firecrawl page whose landing was not
recorded is asked again with a plain request that follows redirects and reads
no body; a landing outside the fence, one robots refuses, or one that cannot be
checked leaves the cached text unused.

The first write was withdrawn. The evidence, chain list, dataset stamps, slim
shards and copy were then rebuilt from the 478 cached page texts under these
checks, starting from the `origin/main` evidence and chain list. No Firecrawl
request was sent. The Two Brewers in Islington no longer carries the Clapham
page, and no single-pub page is on the chain list because of a duplicate
reader.

| Measure | `origin/main` | This branch |
| --- | --- | --- |
| Venues with any amenity fact | 1,027 | 1,100 |
| Evidence rows | 1,047 | 1,193 |
| Pubs with a judged description | 515 | 602 |
| Pubs that lost a description | - | 0 |

The restamp also lifts stale stamps on `origin/main` that its own gate and chain
list already refuse. Six earlier rows drop out. Five are chain-site rows whose
boilerplate new readers on the same chain site also state: "dart boards" and
"pool tables" (Craft Union, Brook House), "Dartboard" (Greene King, Golden
Lion), "Our food is all about great value" (Great Local Pubs, Goose
Walthamstow), and "serve food and drinks" and "prepare and cook food" (two
J D Wetherspoon pubs). The sixth is The Hat and Tun, whose only quote, "Major
Sporting Events", the live-sports gate refuses. A further 54 kept rows lose 55
stale quotes, 49 of them for live sport.

Gemini spend for this work: USD 0.21 extraction and USD 0.29 copy in the
withdrawn write, then USD 0.16 extraction and USD 0.02 copy in the rebuild,
USD 0.68 in all. The rebuild reuses judge-approved copy whose stored facts did
not change.

## Proof

`api-after.jsonl` is `/api/venue/<id>` for two pubs the `origin/main` pack
skipped as `insufficient-stored-facts`. `after-mobile.png` is The Coach & Horses
at 390 px with its new description and tags. Both descriptions are unchanged in
the rebuilt pack.

Hours and dog policy are not extracted in this change: the amenity vocabulary
and the copy judge do not hold them. A later change reads them from the cached
page texts under the ignored `data-harvest/pub-website-amenities/pages`; see
[`../pub-site-hours-dogs/README.md`](../pub-site-hours-dogs/README.md).
