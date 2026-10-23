# map-pin-tokens (2026-10-17)

Record of its day. A /map cause from the #2106 ranking: `readTokens()`, which
reads every map colour from the theme, forces a style recalc of the whole page.
It reads about 30 custom properties from `<html>` and resolves five colours
through a hidden probe span that it adds to `<html>`. The pins effect, the
rendered-state publish and the scene build call it, but the tokens only change
when the theme does.

## The change

`readTokens()` holds one read per set of theme inputs. The key is read without
a recalc:

- every attribute on `<html>` (`data-theme`, `data-mode`, `data-legacy`, class,
  style);
- the number of stylesheets in the page;
- `prefers-color-scheme: dark`.

A read made before the theme stylesheet applies (`--ink` is empty, so every
token is its fallback) is not held.

## Rig

Two local production builds of the same base commit (876b6960) on private ports,
keyless `next start`: `.next-before` (origin/main) and `.next-after` (this branch).
Playwright Chromium with SwiftShader, 390x844 phone, 4x CPU, Chrome Slow 4G,
basemap stubbed as in `e2e/helpers/mapNetworkFixtures.ts`.

`lab/tokens.mjs`: load /map and settle 20 s, open a pub from the peek's answer
row, wait 8 s, close the sheet, then pan four times, 2.5 s apart. An init script
counts each full token read (each adds the hidden probe span to `<html>`) and
times every custom-property read (`getPropertyValue("--…")`) and the probe's
`color` read, where the browser pays the forced recalc. Run it with
`node docs/proof/map-pin-tokens/lab/tokens.mjs <base> <out.json>`;
`CHROMIUM_PATH` points it at a preinstalled Chromium. Raw runs: `results/`.

## Results

10 pairs: runs 1 to 5 before then after, runs 6 to 10 after then before.
Mann-Whitney U, exact two-sided.

| | before (median) | after (median) | p |
| --- | --- | --- | --- |
| full token reads, load | 10 | 3 | < 0.001 |
| token read time, load | 90 ms | 32 ms | < 0.001 |
| full token reads, pub open + 8 s | 2 | 1 | 0.003 |
| token read time, pub open + 8 s | 35 ms | 27 ms | 0.22 |
| full token reads, four pans | 0 | 0 | |
| long-task total, load | 7,430 ms | 7,655 ms | 0.39 |
| long-task total, pub open + 8 s | 3,437 ms | 3,827 ms | 0.11 |
| long-task total, four pans | 1,154 ms | 1,203 ms | 0.73 |

- The reads that remain follow a new stylesheet (a lazy chunk's CSS). The cache
  reads again then, which is correct, because a new sheet can define tokens.
- In runs 1 to 5 the long-task total after a pub open was higher on the after
  build in every pair (p = 0.008). With the order reversed in runs 6 to 10 the
  gap went away (p = 0.69). It is a run-order effect, not this change.
- The earlier estimate, about 95 ms on every pin rebuild, does not hold. Pans
  rebuild the pins with no full token read on either build. The saving is at
  load: about 60 ms of forced style work on this rig.
