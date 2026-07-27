# Price archaeology — what a pint here used to cost

`london.json` holds dated, sourced **historical** pint prices for London venues:
what a pint cost at a named pub on a named day, cited to a page anyone can open.

It is the one price layer on this product that cannot be re-scraped from a live
source. Nobody publishes what a pub charged in 2013; the only way to hold that
fact is to have gone and found it. That is why the set is small, hand-reviewed
and grows slowly rather than being generated.

## The hard rule

**A historical price is history. It never answers "what does a pint cost here now".**

It may not enter price bands, pin colour, the pin price label, cheapest-pint
buckets, the Pint Index, the freshness registry's current-price feeds, the
community price merge, or the drink/food price-update overlays. The rule and its
reasoning live at the top of `lib/priceHistory.ts`; `__tests__/priceHistory.test.ts`
pins the import fence, the data fence and the row schema.

The only consumer is `components/map/VenuePriceThen.tsx`, the venue sheet's
"What it used to cost" block, fed at runtime by `lib/priceHistoryLoader.ts`.

## Schema

```jsonc
{
  "version": 1,
  "generatedAt": "2026-07-27",     // the day the file was last curated
  "observations": [
    {
      "venueId": "venue-1w54puk",  // a venue the app ships (lib/venues stableVenueIdFromKey)
      "venueName": "Fountains Abbey", // for legibility in review; the UI reads the venue
      "priceGbp": 4.14,
      "observedOn": "2014-03-31",  // calendar DAY, never a timestamp
      "quote": "…but at £4.14 a pint, even more expensive than the station pub.",
      "source": { "label": "…", "url": "https://…", "licence": "…" }
    }
  ]
}
```

`observedOn` is a day rather than a timestamp on purpose: archival evidence is
dated to the day at best, and a fabricated hour would be a lie in the schema.

## What earns a row

Every one of these, or the row does not ship:

- **A source URL** anyone can open, and a **day** the price was published or seen.
- **A price somebody paid for a pint.** Not a hedge ("around £4 a pint"), not a
  price band, not a movement ("they put £1 a pint on"), not a promotion (happy
  hour, a festival weekend, a mis-ordered barrel), not a food or half or bottle
  price, and not a price named at a different pub in the same sentence.
- **An identity that holds.** The venue was matched by name and area and then
  checked against the archived pub address: an exact postcode match, or a
  street/locality inside the venue's own borough. A match that did not hold was
  dropped, not guessed.

At most one figure per venue per day, the cheapest named that day, so the
comparison lines up with the cheapest-pint price the sheet already shows.

## Where wave one came from

Archived user reviews on `beerintheevening.com`, which carry a per-comment date
and, often, the price the reviewer paid. The pub index was read from the Wayback
Machine (a CDX sweep of `/pubs/s/*`), matched to this app's venue index by name
plus nearby locality, and the pub addresses used to verify identity came from
archived captures of the same site.

Every candidate figure was then read by a human before it shipped. The PR that
introduced this file records the attempt-to-evidence ratio: it is the number that
says whether this stream is worth continuing.

## Adding to it

Curate, do not generate. A new row needs the same three things above and a human
who read the sentence it came from. Wave one is deliberately not a pipeline: if
the data proves itself, that is the argument for building one, and the argument
comes first.
