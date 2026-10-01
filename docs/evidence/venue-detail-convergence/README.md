# Venue detail on the Bar Tab and the Ledger

1 October 2026. Issue 1646. Both pages now call `lookupVenueDetail` in `lib/venueDetailIndex.ts`. These shots are the Prospect of Whitby, `venue-16pnwmm`, before that switch and after it. Local `next dev` on port 3216. Each shot is a full page at a viewport of 390 by 844, 768 by 1024, or 1440 by 900.

| | 390 | 768 | 1440 |
| --- | --- | --- | --- |
| Bar Tab before | [before/bar-tab-390.png](before/bar-tab-390.png) | [before/bar-tab-768.png](before/bar-tab-768.png) | [before/bar-tab-1440.png](before/bar-tab-1440.png) |
| Bar Tab after | [after/bar-tab-390.png](after/bar-tab-390.png) | [after/bar-tab-768.png](after/bar-tab-768.png) | [after/bar-tab-1440.png](after/bar-tab-1440.png) |
| Ledger before | [before/ledger-390.png](before/ledger-390.png) | [before/ledger-768.png](before/ledger-768.png) | [before/ledger-1440.png](before/ledger-1440.png) |
| Ledger after | [after/ledger-390.png](after/ledger-390.png) | [after/ledger-768.png](after/ledger-768.png) | [after/ledger-1440.png](after/ledger-1440.png) |

## Header

Unchanged at all three widths. Both routes still head with Prospect of Whitby, 57 Wapping Wall, E1W 3SH, Tower Hamlets. The Ledger still shows the Grade II listed line and the Historic England link.

## Price rows

Unchanged. The Bar Tab still shows From £6.10, then the three pint tiles at £6.40, £6.10, and £6.30. The Ledger still shows those same three figures as Paid lines in the logbook. They are pint drops. Neither page draws the dataset price list, so menu enrichment on the venue object does not appear here.

## Photo wall

Unchanged. Both routes still say there are no photos on this wall yet. The wall asks for photos by venue id on its own request.

## What did change

The pages no longer keep their own copy of the venue read. A missing id still renders the existing not-found card. An unavailable read still renders the existing read-unavailable surface, and that failure is not cached.

A famous-venue seed the old dataset index did not hold now opens. Before the switch, `bar-american-bar-savoy` rendered "This pub isn't on the tab" and "This pub isn't in the ledger". After it, both pages render American Bar at The Savoy, Strand, London WC2R 0EZ, Westminster. That difference is in `__tests__/venuePageReadUnavailable.test.tsx`. These six shots are the pub that already had a page.

## Cold-process timing

One fresh Vitest process per route. The clock starts when that process imports the page module and stops after the first server render of `venue-16pnwmm`, including the markup.

| Route | Cold render |
| --- | ---: |
| `/bar-tab/venue-16pnwmm` | 894.6 ms |
| `/ledger/venue-16pnwmm` | 819.8 ms |

Single sample, 1 October 2026. The dev server above was already warm, so these figures are the cold process, not that server.
