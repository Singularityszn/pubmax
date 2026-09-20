# First tappable pin, before and after

Measured 7 September 2026 on one MacBook, against two local production builds:
`origin/main` at `a28e3f0ed` and this branch. Both served by `next start`, both
read by the same rig, which asks the map's own painted-pin probe
(`components/map/canvas/paintedPinProbe.ts`) every 100ms and stops at the first
answer. The probe only counts a mark that is drawn, has survived symbol
collision, and carries no app chrome on top of it, so it answers the question a
reader actually has: can I tap a pub yet.

Rigs: `scripts/first-pin.mjs` (one build) and `scripts/first-pin-paired.mjs`
(both builds alternated within one run).

## Fast profile: the walk's defect, and its repair

| | run 1 | run 2 | run 3 | median |
| --- | --- | --- | --- | --- |
| before (`origin/main`) | none | none | none | none |
| after (this branch) | 1678ms | 1800ms | 1790ms | **1790ms** |

"none" is literal: three runs of three found ZERO tappable pins inside a 20
second budget. This is walk finding B1 measured on a local build. The
first-visit card held the map `inert`, so `elementFromPoint` answered the
ancestor at every point on the canvas and no mark was reachable anywhere.
Removing the lock is what the number changes.

## Slow 4G profile: no difference this rig can see

Six pairs, alternating which build goes first within each pair.

| | samples (ms) | median |
| --- | --- | --- |
| before | 8920, 8363, 9854, 8357, 9383, 9241 | 9241ms |
| after | 9542, 8581, 8761, 9576, 10486, 9620 | 9576ms |

The 335ms between the medians is inside this rig's own noise, and the noise is
larger than the difference. Two controls say so.

1. `origin/main` measured 8553ms early in the session and 9372ms an hour later,
   a 819ms swing on identical code, because the machine was also building.
2. The branch with `prefers-reduced-motion` set, which makes NO opening turn at
   all, measured 9679ms: the slowest of every condition. If the turn were the
   cost, that run would have been the fastest.

An earlier pass reported the branch 816ms slower and was wrong. The rig ran the
two servers in a fixed order, so `after` always went second and always carried
the other context's teardown. Alternating the order removed most of the gap;
`first-pin-paired.mjs` now alternates, and the comment there says why.
