# Spoons value: the imported SpoonMe ranking

What a tenner buys in a Wetherspoon, ranked, for 805 UK pubs.

The bytes, the licence status and the refresh command live beside the data in
[`public/data/spoonme/SOURCE.md`](../../public/data/spoonme/SOURCE.md). This
file is the map of the lane.

## The files

| File | What it is | Who reads it |
|---|---|---|
| `public/data/spoonme/rows.json` | The full edition: every pub, its round, its provenance | The server, once per process (`lib/spoonsValue.server.ts`) |
| `public/data/spoonme/map.json` | The slim map lane, `[venueId, milliunits, pence, rank]` | The browser, and only once the lens is switched on (`lib/spoonsValueLane.ts`) |

The split is the point. The edition is 640 KB and the map lane is 29 KB, and the
map lane is fetched by nothing until a reader turns the lens on, so a cold
`/map` pays nothing for this lane at all.

## The rules

The policy is [`lib/spoonsValue.ts`](../../lib/spoonsValue.ts) and it owns the
whole vocabulary. Three things worth knowing before touching it.

**The band is cut against the modal round, and terciles were measured and
rejected.** 488 of the 805 pubs, 60.6 per cent, hand over exactly the same
round, so the first and second terciles are both 12.785 units and a tercile band
cannot cut this distribution. `__tests__/spoonsValue.test.ts` runs the shared
tercile rule over the shipped figures and proves it. The threshold is therefore
the round most pubs pour, derived from the rows rather than typed, and it gives
three bands with three real populations: 189 above, 488 on it, 128 below.

**It is not a price lane.** A basket cost is a basket cost. Nothing here reaches
pin price colour, the cheapest-pint buckets, a price band, a standing or the
Pint Index, and a source fence holds every price-authority module to never
naming this one.

**Identity is a postcode, then a pin.** A row is joined to our Wetherspoon
directory by postcode, with name similarity used only to break a tie, and then
to a map pin by the nearest base pub inside 250 m that either shares the name or
is close enough that nothing else could be meant. 803 of 805 rows joined the
directory and 788 joined a map pin; the misses are Republic of Ireland pubs,
which sit outside the UK base layer, plus a handful of OSM gaps.

## Surfaces

- `/spoons-value`, the ranking, with cuts for each country, the London zones and
  the airports.
- The map's Spoons value lens, under the drink lanes.
- One row on a ranked pub's own Overview.
