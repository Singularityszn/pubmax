# Today and Tonight picks states, before and after

Audit F04, 5 Sep 2026: `/today`'s tonight-recommendations section rendered empty
with one map link under it. Two faults in one section. The state vocabulary
could not tell a quiet city from a read we could not run, and the honest half of
that pair still handed a new reader nothing to do.

`lib/picksState.ts` is the fix: one state vocabulary both surfaces read, with
the reason and the checked-at instant riding on the state.

## How these were taken

Both sides are **production builds** of this repository, served with
`npm run start` and shot with Playwright's Chromium at `deviceScaleFactor: 2`.

- **before**: `origin/main` at `09740c861`, built into `.next-prod-before`.
- **after**: this branch, built into `.next-prod-after`.

Both feeds are stubbed at the network edge with the fixtures in
`e2e/picks-states.spec.ts`; no live provider is contacted, so the two sides
differ only in the code under test. Each shot waits for the section to settle on
a terminal state before firing, because a screenshot is an instant and a
skeleton caught mid-hydration proves nothing. Both sides scroll the same anchor
into frame, so the two shots show the same part of the page.

Viewports: `390x844`, `768x1024`, `1440x900`.

`/today`'s picks are composed on the server, so its shot carries whatever the
keyless local build's bundled read answers; on this machine that is
`genuinely_empty`.

## What changed, per state

| state | before | after |
| --- | --- | --- |
| `ready` | cards | unchanged: cards, and nothing said about the read |
| `genuinely_empty` | the quiet-night sentence and one map link | the same sentence and map link, plus two clearly labelled non-event doors |
| `temporarily_unavailable` | not distinguishable from empty on `/today`; on `/tonight` an error box with a retry and no way onward | what happened to us, a retry, the same two doors, and never the empty-city sentence |
| `refreshing` | pressing Retry replaced the whole list with a skeleton | the last good picks stay on screen with the day they were checked |

The two doors carry the reader's own context: `/near?patch=<id>` and
`/plan?occasion=<id>`, both omitted rather than guessed when absent.

## Files

    before/<case>-<viewport>.png
    after/<case>-<viewport>.png

Cases: `tonight-ready`, `tonight-genuinely-empty`,
`tonight-temporarily-unavailable`, `tonight-refreshing`,
`today-genuinely-empty`.
