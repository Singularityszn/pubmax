# Deferred night previews, 3 November 2026

Status: dated record. These previews did not meet the approved data contracts.
No implementation was added for them in this record.

The review used main `35cc1a7d786d3e71cdc0a942aa6b85ec89418d15` and draft plan
[PR 2479](https://github.com/Singularityszn/pubmax/pull/2479) at head
`36e52d22cbe2ca046ee9ff1b34cbb6d791157c70`. The Pub Tarot check used worktree
head `d5b040559a14232eb253670ddfda2d34f1c65c59`, which includes A1
`05e19cb24bf980987d54cf47024df39072db5182` and the two preview selector commits.

## Missing contracts

- **B1, Last Tube Clock.** `lib/lastTrain.server.ts` accepts origin coordinates.
  It ignores the destination. A destination-specific journey and leave-by time
  need a destination-aware transport contract. The destination must remain on
  the person's device unless they explicitly choose otherwise.
- **B2, Latecomer Beacon.** The invite does not receive an authorised live
  current stop. The Night mode cursor belongs to one device. A shared current
  stop needs an explicit member-authorised read and an unknown state.
- **B4, Pub Tarot.** The roulette's `SlimVenue` price has a publisher label and
  date but no source URL or serving. A1's `comparablePint` accepts an absent
  measure. Neither contract proves a full pint for the selected price row.
  On 3 November, `public/data/uk_prices/rows.json` held explicit pint serving
  rows for `venue-fla5g9` and `venue-uk-n1707216586`. Neither ID appeared in
  the London `public/data/venues_slim.json` roulette pool. The examined rows
  did not establish three eligible pubs in that pool. A later reader needs one
  selected price row with its own full-pint serving, publisher, source URL,
  observation day, venue identity and location. It must apply the existing
  roulette eligibility, budget and distance rules to those same facts.
- **B5, Crew Tube Line.** `RecapDetail` reads one member-gated completed plan.
  It does not provide a crew-wide history of completed nights. The poster needs
  a crew-scoped history read with a server-enforced membership boundary.
- **B7, rain B-side.** `TonightConditionsStrip` reads a weather observation, not
  a forecast for the night's window. Sliding Doors compares straight-line
  estimates and does not have covered-path evidence. The rain claim needs a
  time-bounded forecast. A covered-path claim needs route coverage evidence.

The existing browser preview selector is not an access control. A preview must
still enforce the privacy boundary of every underlying read.
