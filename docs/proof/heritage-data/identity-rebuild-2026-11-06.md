# Heritage identity rebuild, 6 November 2026

The historic index contains 292 records. The base commit contained 342 records.

A unique venue name retains its facts. A shared name requires one address, postcode or coordinate match.
A coordinate match must be within 150 metres.
Facts from the same cited source share its location evidence. Unresolved namesakes remain withheld.
The existing unlinked Barley Mow directory record retains no map identity.

The landing module was regenerated from this index. All twelve first-run choices retain cited historic records.
The earlier date and age grounding code remains unchanged.

## Removed records

These 50 base records are absent from the regenerated index.

- `unresolved-venue-identity` means the shared name has no unique address, postcode or coordinate match.
- `borough-stated-in-fact` means the fact names a borough different from the venue borough.
- `no-publishable-facts` means all facts failed the publication checks.

| Pub | Former slug | Reason |
| --- | --- | --- |
| The Queens Arms | the-queens-arms | unresolved-venue-identity |
| Camden Head | camden-head | unresolved-venue-identity |
| Coach and Horses | coach-and-horses | unresolved-venue-identity |
| Crown & Anchor | crown-anchor | unresolved-venue-identity |
| Duke of Wellington | duke-of-wellington | unresolved-venue-identity |
| Golden Lion | golden-lion | unresolved-venue-identity |
| Green Man | green-man | unresolved-venue-identity |
| Kings Arms | kings-arms | unresolved-venue-identity |
| Leather Bottle | leather-bottle | unresolved-venue-identity |
| Lord Nelson | lord-nelson | unresolved-venue-identity |
| Queen Adelaide | queen-adelaide | unresolved-venue-identity |
| Red Lion | red-lion | unresolved-venue-identity |
| Rising Sun | rising-sun | unresolved-venue-identity |
| Rose and Crown | rose-and-crown | unresolved-venue-identity |
| Royal Oak | royal-oak | unresolved-venue-identity |
| The Angel | the-angel | unresolved-venue-identity |
| The Britannia | the-britannia | unresolved-venue-identity |
| The Cross Keys | the-cross-keys | unresolved-venue-identity |
| The Crown | the-crown | unresolved-venue-identity |
| The Duke | the-duke | unresolved-venue-identity |
| The Duke of York | the-duke-of-york | unresolved-venue-identity |
| The Eight Bells | the-eight-bells | unresolved-venue-identity |
| The Elgin | the-elgin | unresolved-venue-identity |
| The Fox | the-fox | unresolved-venue-identity |
| The George | the-george | unresolved-venue-identity |
| The Globe | the-globe | unresolved-venue-identity |
| The Green Man | the-green-man | unresolved-venue-identity |
| The Gun | the-gun | unresolved-venue-identity |
| The Half Moon | the-half-moon | unresolved-venue-identity |
| The Harrow | the-harrow | unresolved-venue-identity |
| The Hope | the-hope | unresolved-venue-identity |
| The Kings Arms | the-kings-arms | unresolved-venue-identity |
| The Marquis of Granby | the-marquis-of-granby | unresolved-venue-identity |
| The Mitre | the-mitre | unresolved-venue-identity |
| The Old Bell | the-old-bell | unresolved-venue-identity |
| The Pineapple | the-pineapple | unresolved-venue-identity |
| The Rising Sun | the-rising-sun | unresolved-venue-identity |
| The Roebuck | the-roebuck | unresolved-venue-identity |
| The Ship | the-ship | unresolved-venue-identity |
| The Swan | the-swan | unresolved-venue-identity |
| The Victoria | the-victoria | unresolved-venue-identity |
| The Village Inn - JD Wetherspoon | the-village-inn-jd-wetherspoon | unresolved-venue-identity |
| The White Bear | the-white-bear | unresolved-venue-identity |
| The White Horse | the-white-horse | unresolved-venue-identity |
| The White Swan | the-white-swan | unresolved-venue-identity |
| Three Horseshoes | three-horseshoes | unresolved-venue-identity |
| Three Tuns | three-tuns | unresolved-venue-identity |
| Two Chairmen | two-chairmen | unresolved-venue-identity |
| Wheatsheaf | wheatsheaf | unresolved-venue-identity |
| White Swan | white-swan | unresolved-venue-identity |

## Reproduction commands

1. Run `node scripts/build_historic_index.mjs`.
2. Run `node scripts/landing/build-landing-map.mjs`.

Vitest is absent from PATH and the worktree has no installed Vitest executable. The Vitest regression cases could not run.
