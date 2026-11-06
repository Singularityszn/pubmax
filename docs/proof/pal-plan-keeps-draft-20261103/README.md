# Plan keeps the Pub Pal's drafted pubs

Captain decision, 3 November 2026: when a reader taps "Open in Plan" on a Pub
Pal draft, Plan keeps the pubs the Pal drafted.

## Before

The Pal drafted The London and South Western, Junction (Clapham) and The
Pheonix. Plan then showed The Belle Vue, The Stonhouse and The Beehive.

- `before-pal-draft-phone.png`: the Pal's draft and "Open in Plan".
- `before-plan-other-pubs-phone.png`: the route Plan built, with other pubs.

There were two causes:

1. "Open in Plan" sent only the ask. Plan wrote the drafted pubs to the session
   but did not read them.
2. The draft was not walkable. The Pheonix is 2.8 km from the other two pubs.
   Plan's rule allows 1.6 km for each leg and 3 km for the route.

## After

The Pal drafts a crawl that obeys Plan's walking rule, and Plan keeps it.

- `after-pal-draft-phone.png`: "Proposed draft: The Pheonix → The Bread &
  Roses → The Coach & Horses. Open in Plan to keep these pubs. Plan checks every
  stop, and nothing is saved until you do."
- `after-plan-kept-phone.png`: the same three pubs, in the same order, with
  the line "Kept your Pub Pal's pubs: The Pheonix, The Bread & Roses and The
  Coach & Horses."

The first generate request carried the whole draft:
`{"venueId":"venue-ywzy0i","source":"pal","venueIds":["venue-ywzy0i","venue-l5qye7","venue-e7wfn7"]}`.

## How it was taken

The screens come from a keyless production build of this branch, served on a
private port. The phone viewport is 390 x 844 in the dark theme. The Pal is
the real keyless chat, with no stub. The "before" screens come from the same
journey on `main` at `7e90dcaf`, earlier on the same day.

`e2e/pal-plan-keeps-draft.spec.ts` checks three cases:

1. Plan keeps the whole draft and says so.
2. When Plan cannot walk a draft, it says so and does not claim to keep it.
3. A later visit to /plan does not use the old draft again.

All three tests passed against the same build.
