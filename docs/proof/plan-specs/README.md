# Plan specs: the Night Mode pill and the create action

Measured while making the red plan e2e specs green (branch
`fm/plan-specs-strict-mode`).

## The defect

`.nightPill` — the way back into a plan that is on tonight — is a fixed
right-edge control that parks on the same band as the floating create action.
It was the one member of the right-edge floating stack that published its
geometry in its OWN stylesheet (`components/night/nightMode.css`) instead of
the stack's table in `components/nav/mobileNav.css`, so the create action never
read it and parked straight on top of it.

`e2e/mobile-plan-recap.flag-on.spec.ts` is what surfaced it. Its tap on the
pill was refused for the whole assertion budget with Playwright reporting
`<button class="createFab" …> from <div class="createFabRoot"> subtree
intercepts pointer events`.

## Method

Two production builds of the same commit range, served on private ports and
driven by a headless Chromium at `deviceScaleFactor: 2`:

- **before** — `origin/main` at `2a5350cd5`, built in a throwaway worktree,
  served on `:3182`.
- **after** — this branch, served on `:3181`.

Each frame is `/tonight` with an active-plan pointer seeded, so both controls
are on screen. The numbers are the two elements' own
`getBoundingClientRect()` values read in the page.

## Measured

| width | before | after |
| --- | --- | --- |
| 320 | pill top 726, create bottom 768 — **overlapping** | pill top 724, create bottom 712 — 12px clear |
| 390 | pill top 726, create bottom 768 — **overlapping** | pill top 724, create bottom 712 — 12px clear |
| 768 | pill top 842, no create action | pill top 842, no create action |
| 1440 | pill top 842, no create action | pill top 842, no create action |

The create action is phone-only (`max-width: 640px` in
`components/nav/createFab.css`), so 768 and 1440 are unchanged in both
directions: the fix cannot reach a width the control does not exist at.

At 390 the before frame shows the coral `+` covering the pill with only the
"T" of "Tonight" escaping; the after frame reads the whole word with the
create action one gap above it.

## Frames

`night-pill-create-fab-<width>-<before|after>.png`, at 320, 390, 768 and 1440.
