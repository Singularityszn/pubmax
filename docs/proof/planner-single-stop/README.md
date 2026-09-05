# Planner: a one-pub meetup and a two-stop outing (F09 / J09)

Live-product audit finding F09: "Planner offers 3-6 stop buttons; verify
single-destination and two-stop outings have an obvious path."

Measured on a production build (`NEXT_DIST_DIR=.next-prod npm run build`,
`next start`, keyless stores) at 390x844, 768x1024 and 1440x900, light and dark.

## What was measured before the fix

`lib/planStopCount.ts` declared `PLAN_STOP_COUNTS = [3, 4, 5, 6]`, and every
gate in the tree reads that one table. So a one- or two-stop outing was
unreachable by construction, on every lane at once.

| Lane | Request | Answer before |
| --- | --- | --- |
| `POST /api/plans/generate` | `context.stopCount: 1` | 400 `MALFORMED_REQUEST` "Night Context is invalid." |
| `POST /api/plans/generate` | `context.stopCount: 2` | 400 `MALFORMED_REQUEST` "Night Context is invalid." |
| `POST /api/plans/generate` | `intake.stopCount: 2` | 400 `PLAN_INTAKE_MALFORMED` "Plan intake stop count is invalid." |
| `PATCH /api/plans/{id}` | two listed stops | 400 `PLAN_ROUTE_INVALID` "Choose three to six different listed stops…" |
| `POST /api/plans` | one or two listed stops | **200**. The store always accepted 1..8 |

That last row is the shape of the defect: the server could hold a two-stop
Plan, and nothing in the product could produce one or edit one while it stayed
two. A Plan created at two stops could be grown to three and never edited back.

Guided mode has the same floor: the wizard mounts the same picker. The
`before/plan-guided-group-size-390x844-light.png` shot is the confusion the
audit asked about. On "How many people?" three number rows stack, `Stops
3 4 5 6`, the step rail `1 2 3 4 5`, and the group row `1 2 3 4 5 6`. The
group row offers 1 and 2; the stops row does not.

## What was measured after

| Lane | Request | Answer after |
| --- | --- | --- |
| `POST /api/plans/generate` | `context.stopCount: 1` | 200, 1 stop (Lotus Bar) |
| `POST /api/plans/generate` | `context.stopCount: 2` | 200, 2 stops |
| `POST /api/plans/generate` | `context.stopCount: 3` | 200, 3 stops (unchanged) |
| `POST /api/plans/generate` | `context.stopCount: 6` | 200, 6 stops (unchanged) |
| `POST /api/plans/generate` | `intake.stopCount: 2` | 200, 2 stops |
| `PATCH /api/plans/{id}` | two listed stops | 200, route stays two stops |
| `PATCH /api/plans/{id}` | zero stops | 400 `PLAN_ROUTE_INVALID` "Choose one to six…" |

Three stays the default: `normalizePlanStopCount(undefined)` is 3, and the
picker still opens on 3, so a night nobody sized builds the crawl it always
built.

## Two layout defects fixed along the way, measured from the DOM

1. The picker sat BELOW the primary action on describe-first, so a reader met
   the control that decides what "Sort it" produces only after tapping it. It
   is now seated with the field, above the actions (`app/plan/plan.css`), and
   `e2e/plan-single-stop.spec.ts` asserts the geometry.
2. In the wizard the action row ran under the floating create control. Measured
   at 390px: Continue spanned x 199-368 while the control held x 322-378, so
   its right 46px was not tappable. The row now reserves that control's own
   published lane; re-measured, Continue ends at x=310 against the control's
   x=322.

## Files

`before/` and `after/` carry the same shots: `plan-describe-*` (the
describe-first surface) and `plan-guided-*` (the wizard), at each viewport in
both themes, plus `plan-guided-group-size-390x844-light.png` for the
number-row question. `after/plan-result-{1,2}stop-*` show the built routes.

## Pre-existing e2e reds, NOT from this change

Seven specs fail identically on `origin/main` (measured at `ca2053aa1`) and on
this branch: four in `plan-crawl-stops.spec.ts`, one in `plan-intake.spec.ts`,
two in `plan-loop.spec.ts`. All wait for a `Make a plan` button that the
describe-first surface no longer paints; its primary action is `Sort it`.
That belongs to whoever moved the plan landing surface, and the fix is a
locator change rather than a behaviour one.
