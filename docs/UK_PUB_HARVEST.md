# All-UK pub harvest

A two-stage gather of every UK pub. Stage 1 reads OpenStreetMap. Stage 2
reads Exa search results. Both stages store observations only: every fact
carries `sourceUrl` and `fetchedAt`. The harvest never invents a website,
a history sentence, a social handle, a menu URL or a price.

This is not the London first-party harvest. That lane stays at
`npm run harvest:run` and `docs/LONDON_HARVEST.md`.

This is not the priced map index. Harvest rows do not enter
`venues_slim.json` or pin colour.

## Command

```bash
npm run harvest:uk-pubs
# same as:
node --max-old-space-size=2048 scripts/harvest/uk-pubs/run.mjs
```

The run resumes by default.

| Flag | Effect |
|---|---|
| `--enumerate` | Overpass only |
| `--enrich` | Exa only (needs the seed file) |
| `--mock` | Exa mock mode, no network |
| `--from-osm-raw` | Build the seed from `data/osm/uk/raw` (pubs already on disk) |
| `--refresh` | Refetch every Overpass chunk |
| `--allow-stale` | Accept an Overpass snapshot older than 48 hours |
| `--limit N` | Cap rows (tests and dry runs) |
| `--chunk=lat50.80_lon-0.70` | One grid cell |

With no stage flag, the command enumerates then enriches.

## Stage 1: enumerate

The Overpass client is `scripts/lib/overpassClient.mjs`. The UK grid and
area clip are `scripts/lib/ukOsmSeed.mjs`. The harvest query asks for
`amenity=pub` and `amenity=bar` in each 1° cell, clipped to OSM relation
62149 (United Kingdom).

A bar is kept only when OSM states `real_ale`, `microbrewery=yes` or a
`brewery` tag. A name that contains "pub" is not evidence. Plain bars are
dropped and counted.

Output:

- `data-harvest/raw/chunk_*.json` - raw Overpass responses (gitignored)
- `data-harvest/uk_pubs_seed.jsonl` - canonical seed (gitignored)
- `data-harvest/uk_pubs_seed.sample.jsonl` - first 100 rows (committed)

Each seed row carries osm id, name, lat/lng, stated `addr:*` tags,
website and social tags when OSM states them, ODbL licence, attribution,
`sourceUrl` (the OSM object) and `fetchedAt`.

Licence: Open Database Licence 1.0. Attribution: © OpenStreetMap
contributors.

## Stage 2: enrich

Per pub, Exa search + contents. Stored facts are copies of what the
result page stated, with that page's URL. Kinds: `website`, `history`,
`social`, `menu`, `coverage`. A hit with no https URL is dropped.

Output:

- `data-harvest/enriched/shard_NNNN.jsonl` - 500 pubs per shard, atomic
  writes. Resume starts after the last complete shard.
- `data-harvest/progress.json` - counts, rate, ETA.

`EXA_API_KEY` is read from `.env.local` or the process environment. When
the key is absent the enrich stage runs mock mode and prints
`blocked: needs-decision [key=exa-key]`. Mock mode writes empty
observation lists except for a tiny named fixture, so a dry run cannot
invent coverage.

Rate limit: 1.5 s between live Exa calls. 429 uses exponential backoff
and honours `Retry-After`.

## Honesty rules

- Observations only. Never synthesise or infer a fact into the data.
- A failed Exa read is an empty observation list for that pub, not a
  guessed website.
- Harvest data is not committed. Rebuild it with the command above.
