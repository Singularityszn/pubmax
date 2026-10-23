# map-resume-idle (2026-10-17)

Record of its day. Third /map cause from the #2106 ranking: after a pub opens,
or after any pan, the map rewrote its whole resume snapshot (the last camera and
every resident pin, kept so the next visit paints at once) to localStorage and
IndexedDB, 250 ms after each settled camera move. A sheet close or in-sheet tap
in that window queued behind it (real users: 552 ms close taps on /map).

## What it cost

In London the snapshot is 620 KB. Each write:

- re-compacted every resident pin (`pinsToSlimVenues`) and re-serialised it;
- wrote the 620 KB string to localStorage;
- handed the row objects to IndexedDB, which structured-cloned them one by one.

An open settled the camera two or three times, so it paid this two or three
times; four pans paid it five times.

## The change

- The camera and the rows are separate records: `map-resume:v2:<city>:view`
  (about 150 bytes) and `map-resume:v2:<city>:rows`.
- `createMapResumeWriter` writes the rows once per pins array, the camera on a
  move, and nothing for a move onto the camera it already wrote.
- Both stores hold the same JSON text, so IndexedDB copies one string.
- The write waits for idle time (`requestIdleCallback`, 2 s at most; a 250 ms
  timer where the browser has none).
- The writer removes the one-record v1 snapshot it replaces. A device with only
  a v1 snapshot opens cold once, as on a first visit.

## Rig

Two local production builds of the same base commit (666d588a) on private ports,
keyless `next start`: `.next-before` (origin/main) and `.next-after` (this branch).
Playwright Chromium with SwiftShader, 390x844 phone, 4x CPU, Chrome Slow 4G,
basemap stubbed as in `e2e/helpers/mapNetworkFixtures.ts`.

`lab/resume.mjs`: load /map, settle 20 s, close the arrival strip, open a pub from
the peek's answer row, wait 8 s, close the sheet, then pan four times, 2.5 s
apart. An init script times every large `JSON.stringify` (over 20,000 chars) and
every map-resume `localStorage.setItem` and IndexedDB `put`, on the main thread.
Run it with `node docs/proof/map-resume-idle/lab/resume.mjs <base> <out.json>`;
`CHROMIUM_PATH` points it at a preinstalled Chromium. Raw runs: `results/`.

## Results

5 interleaved runs per arm. Mann-Whitney U, exact two-sided.

| | before (median) | after (median) | U | p |
| --- | --- | --- | --- | --- |
| resume write time, open + 8 s | 285 ms | 0 ms | 25 | 0.008 |
| resume write time, four pans | 649 ms | 17 ms | 25 | 0.008 |
| bytes written per move | 620 KB | 151 B | | |
| long-task total, open + 8 s | 4,110 ms | 3,370 ms | 20 | 0.15 |
| long-task total, four pans | 1,955 ms | 1,449 ms | 21 | 0.10 |

Per run, before: 205 to 363 ms after an open and 532 to 857 ms over the pans.
After: 0 to 2 ms and 3 to 19 ms. The long-task totals move the same way but
other work on the busy thread hides it at n = 5.

The rows record is still written when the resident pins change, which is when
a shard of pins loads. That write now runs in idle time.
