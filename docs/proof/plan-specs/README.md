# Plan specs: the Night Mode pill and the create action

Measured while making the red plan e2e specs green (branch
`fm/plan-specs-strict-mode`).

## The defect

`.nightPill` - the way back into a plan that is on tonight - is a fixed
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

- **before** - `origin/main` at `2a5350cd5`, built in a throwaway worktree,
  served on `:3182`.
- **after** - this branch, served on `:3181`.

Each frame is `/tonight` with an active-plan pointer seeded, so both controls
are on screen. The numbers are the two elements' own
`getBoundingClientRect()` values read in the page.

## Measured

| width | before | after |
| --- | --- | --- |
| 320 | pill top 726, create bottom 768 - **overlapping** | pill top 724, create bottom 712 - 12px clear |
| 390 | pill top 726, create bottom 768 - **overlapping** | pill top 724, create bottom 712 - 12px clear |
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

---

# The Night Mode card's read, and why the recap was unreachable

`e2e/mobile-plan-recap.spec.ts` went red again once `#1525` / `#1526` / `#1527`
landed. The first reading was that the recap control had fallen below a sheet
whose scroll `#1525` had shrunk. Measuring it says otherwise, and the honest
answer is a different defect.

## What is actually wrong

The control is not off screen. It is not rendered at all, because the card never
gets past the privacy-safe preview.

`NightModeCard` reads `GET /api/plans/[id]` and its get-in report once, at
mount, keyed on the plan id alone. Both are capability-gated through
`resolvePlanProjection`, and the capability is the ordinary case of arriving
late: `restorePlanCapability` has to exchange the stored member token for the
path-scoped session first. When the mount read goes out before that cookie
lands, it comes back the preview, which carries no stops and no ending, and the
card has no way to ask again. It sits on "Loading tonight's route..." for the
life of the page.

`#1521` made every plan surface re-read when the capability changes under it
(battle test M01/M02) and gave `PlanSummary` and `PlanCrew` that rule through
`usePlanMemberRead`. This card was missed.

## Why it looked like a sheet defect

It is a race, so it presents differently each run. On one measurement the card
had upgraded and the recap control sat at y=782 inside a 484px-tall card, which
reads exactly like a scroll problem. The card scrolls perfectly well: setting
`scrollTop = 400` moves the control to y=382, and `scrollIntoView` puts it at
y=232. The Playwright call log is what settles it - it never resolved the
locator at all, so the control was absent rather than unreachable.

## Method

The journey is driven the way a real host's browser drives it: the plan is
created, arrived at and completed through a SEPARATE API context, so the page
holds no member cookie and the capability has to arrive through the token
exchange. That is the ordering the defect lives in; sharing one cookie jar hides
it. Five runs per viewport per build, ten seconds of settle each.

| build | 320x568 | 390x844 |
| --- | --- | --- |
| before (`6212c9089`, this branch without the card fix) | stuck 1/5 | stuck 1/5 |
| after (`6c57e6a43`) | stuck 0/5 | stuck 0/5 |

"Stuck" means the card still showed `.nightCard__loading` or had no recap
control after ten seconds.

## Frames

`night-card-recap-<viewport>-<before|after>.png`, at 320x568 and 390x844. The
before frames are from a run that lost the race: the sheet reads "On tonight"
and "Loading tonight's route..." over a night that is already complete.

## The other red of that batch

`landing-find-my-pint:113` was red on `4e9b325bd` and needed nothing from this
branch: `#1529` mounted the phone sheet's stylesheet before the dynamic shell,
and the assertion passes again on `b1d74eab0`. The copy in `lib/spill.ts` was
right all along and is unchanged.
