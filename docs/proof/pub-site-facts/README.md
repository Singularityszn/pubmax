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

## What ships in this commit

Review found three faults in what this run wrote:

- A site that only the price dataset gives was read with no address check. The
  Islington Two Brewers took the Clapham Two Brewers' page and its facts.
- A dataset venue that duplicates an OSM pub read that pub's page, so the chain
  list proved four single-pub pages chain-wide.
- Firecrawl reads were not fenced on the URL they landed on.

The harvest now fences the Firecrawl landing. A site that only the price
dataset gives must state the pub's postcode or street, as a located site must.
A dataset venue's read of a page another pub owns is a duplicate: it gives the
venue no evidence and proves nothing chain-wide. These checks also apply to a
page read again from the cache.

The rows from this run were withdrawn. The amenity evidence rows, the chain
list and the copy pack are at their `origin/main` content. The dataset and the slim
shards were stamped again from that evidence with `--restamp` and `build:slim`.
The restamp lifts 17 `live_sports` cells on 14 venues: the gate and chain list
on `origin/main` already refuse those quotes, so the stamps were stale.

| Measure | `origin/main` | This commit |
| --- | --- | --- |
| Venues with any amenity fact | 1,027 | 1,027 |
| Evidence rows | 1,047 | 1,047 |
| Pubs with a judged description | 515 | 515 |

The amenity evidence and the copy are regenerated from the cached page texts
under the new checks in a follow-up commit on this branch. That commit adds the
new figures and the API and screenshot proof. Gemini spent USD 0.21 on amenity
extraction and USD 0.29 on copy in the withdrawn run.

Hours and dog policy are not extracted in this change: the amenity vocabulary
and the copy judge do not hold them. They ship in the follow-up task
`pubmax-dogs-hours-from-cache`, built from the cached page texts under the
ignored `data-harvest/pub-website-amenities/pages`.
