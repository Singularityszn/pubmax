# Pubs people are talking about

The rows `/tonight` leads with. One file per city, published by
`npm run ingest:hyped-pubs` (`scripts/hyped-pubs-ingest.mjs`) from a research
file at `data/hyped-pubs-research/<city>.json`. The repo-wide dataset rules are
in [data/AGENTS.md](../../../data/AGENTS.md).

## What earns a row

A pub people are actually talking about somewhere public, right now. Reddit
threads, a paper, a listings site, a local newsletter. Every row states:

| Field | What it is |
| --- | --- |
| `name` | The pub, spelled the way it spells itself. |
| `area` | The London area a drinker would name, e.g. "Peckham". |
| `venueId` | Our own id when the pub is on the map, else `null`. |
| `whyLine` | ONE sentence saying what is being said. |
| `sources` | `{label, url, observedAt}`, the day each page was read. |
| `score` | The researcher's own weight. Orders the list; never printed. |
| `mentions` | How many separate mentions the row was built from. Never printed. |

## What the ingest refuses

A row with no name, no area or no sentence; a paragraph where one sentence was
asked for; a row whose sources carry no http link or no readable day; a reading
dated in the future; and a stated `venueId` no curated venue answers to. Every
refusal is counted in the run report, so a research file gets better rather
than quietly shorter.

The ingest fills in a `venueId` only when name and area match one curated venue's name and borough.
It normalises case, punctuation and a leading "The" before matching.
A neighbourhood or name alias needs an explicit curated ID, verified during research.
An ambiguous or mismatched area stays unmatched, even when the index holds only one pub with that name.
The row still shows and says it is not on our map yet.

## Rules a reader should know

- **No figure from this file is ever printed.** `score` and `mentions` are one
  researcher's reading of how loud a pub is, and a number on a screen reads as
  a measurement.
- **Every row prints one credit.** The publisher, the day it was read, and the
  link, so a reader who doubts the line can go and read it.
- **An empty file is honest.** No rows means nothing was published today, and
  `/tonight` leads with the listings instead. The ingest refuses to publish an
  empty file over a full one unless `--allow-empty` says it is meant.
