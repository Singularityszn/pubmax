# Production smoke suite: first runs, 5 October 2026

Two read-only runs of `npm run test:prod-smoke`. No smoke account existed, so
the five signed-in journeys skipped.

## Production, https://pubmaxxing.com

Production was serving `2290063d5` (#1930), built on 3 October.

```
✓ landing page loads with its hero and a way onto the map (5.1s)
✓ London map paints pins (22.3s)
✓ Manchester map paints pins (12.6s)
✓ searching a pub opens its sheet (24.5s)
✘ a venue sheet shows Google Places hours and address (1.0m)
✘ the coffee lens shows a cafe's listed prices (34.3s)
- signed-in journeys (5 skipped)
2 failed, 5 skipped, 4 passed (2.7m)
```

Both failures are real. The deployed commit predates the Google Places copy
(#1964, merged 4 October) and the Shoreditch coffee pilot. The sheet has no
`.venuePlacesDetails`, and `/map?drink=coffee&sel=venue-osm-w271641406` opens no
cafe sheet (`prod-coffee-lens-failed.jpg`).

## The branch head, built locally on port 3400

```
✓ landing page loads with its hero and a way onto the map (4.6s)
✓ London map paints pins (27.0s)
✓ Manchester map paints pins (14.8s)
✓ searching a pub opens its sheet (30.7s)
✓ a venue sheet shows Google Places hours and address (33.7s)
✓ the coffee lens shows a cafe's listed prices (27.4s)
- signed-in journeys (5 skipped)
5 skipped, 6 passed (2.3m)
```

So the two journeys go green on the next production deploy of main.
