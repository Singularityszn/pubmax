# Listing count clarity, 7 October 2026

## Finding

The supplied review compared the map's `On tonight 132` chip with 56 Out listings.
Those figures describe different lists. They are not counts of pubs.

The map reads `/api/whats-on?window=tonight&limit=60` without `pubOnly`.
The store limits offer families and then expands their rows. The chip counts those rows.
The expanded row count can therefore exceed 60. It includes listings without a venue link.

Out reads `/api/out` for the selected city and day. It shows every served event row, up to 100.
Its accepted venue links come from the response's completed venue match.
A failed venue match cannot support a count of matched places.

The historical 132 and 56 responses were not available for replay.
This change does not claim that one historical total is a subset of the other.
It leaves source selection, grouping, matching, caps, and datasets unchanged.

## Change

The map chip now says `Tonight listings` beside its existing row count.
The phone accessible name says `Tonight listings: 3` for three rows. It keeps the visible label inside the name.
Its location qualifier still follows the existing read context.
The phone label wraps at narrow widths. It stays fully readable at 320 pixels.

Out now says `2 listings shown. 1 linked to a venue on our map.` for two rows with one accepted link.
The count describes listing rows, including repeated listings at one venue. It is not a distinct venue total.
When match metadata is unavailable or absent, Out only reports the number of listings shown.
Empty and loading lists add no count summary. Existing unmatched rows, notices, credits, and links remain visible.

## Evidence

Baseline: `origin/main` at `3bc62e232be88dcbfa564ecb01970aba68afa9de`.
Branch: `codex/grok-count-clarity`.
Private production server: `http://127.0.0.1:34721`.
Browser responses are local fixtures. They are not claims about live event supply.

The phone baseline displayed `On tonight` beside 3. Out displayed two rows and no count summary.
The live Out inspection also confirmed that rows and their venue links already render separately.
The live map chip was hidden behind its ambient banner priority, so it did not supply a reliable count reproduction.

Local evidence is in `artifacts/count/`:

- `map-phone-before.png` records the old phone chip at 390 by 844.
- `out-phone-before.png` records the old two-row Out surface at the same viewport.
- `map-phone-after-320.png`, `map-phone-after-390.png`, and `map-phone-after-430.png` record the updated phone chip.
- `out-phone-after.png` records the updated two-row Out summary at 390 by 844.
- The count browser spec checks the phone label at 320, 390, and 430 pixels.
- It also checks Out's row count, accepted link count, and unavailable-match wording.

## Checks

The baseline production build passed.
Six unit assertions failed before the implementation changed.
Both Out browser checks failed against the baseline build because the summary was absent.
The first phone browser attempt reached a loading frame and exceeded its five-second readiness wait.
The test now waits up to 30 seconds for the loaded map.
After the wording change, the phone browser check reproduced label truncation at 320 pixels.
The wrapping change fixed that failure.
After the implementation, six focused unit suites passed with 84 tests.
Focused ESLint passed with zero warnings. The final isolated production build passed.
All three browser checks passed against that build in 24.6 seconds.

Local command logs:

- `/tmp/pubmax-count-unit-final.log` records the 84 passing unit tests.
- `/tmp/pubmax-count-lint-final.log` records the clean focused lint run.
- `/tmp/pubmax-count-build-final.log` records the production build.
- `/tmp/pubmax-count-browser-final.log` records the three passing browser checks.

The parent task will verify the assembled final head and publish it through the repository's no-mistakes gate.
No production write, migration, merge, or deployment is part of this lane.
