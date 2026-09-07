# Plan layout fixes

Measured on 7 September 2026. Scope: #1534, #1535, #1538, #1539.

The branch starts at `6a759e0ac191d99f10c5e658bc8f2c3a6d3dd419`.
Production `/api/version` confirmed that commit. No production writes occurred.

## Before

The browser used the existing keyless server on port 3410, with one worker and no tracing.
Its reported commit was `1ad2e0a7a7b4000341fc96a9bf6fa57e0a88162c`.
The four changed product files have no differences between that commit and the branch baseline.
The audit owner confirmed `PUBMAX_E2E_KEYLESS=1` and empty Supabase server credentials.

A browser response stub supplied the composer route. A local API fixture supplied the saved Plan.
Each defect was reproduced before its source changed. The browser viewport was 390x844.

| Issue | Observed defect | Evidence |
| --- | --- | --- |
| #1534 | Lock was disabled. Its only supporting line described link sharing. | [Before lock](before-lock.png) |
| #1535 | The drinks value clipped. The budget input shrank to 49.9px and its label wrapped. | [Before controls](before-pills.png) |
| #1538 | The empty spacer between the stop and actions measured 206.2px. | [Before Night mode](before-night.png) |
| #1539 | The rail continued below the route and crossed the collaboration card. | [Before rail](before-rail.png) |

[Raw baseline measurements](before.json) record the dimensions and server version.
The earlier Android report also described budget text clipping. This Chromium run did not reproduce that specific text clipping.

## Changes

The lock now prints its current validation reason beside the button.
The button and submission handler read the same result. Existing capability rules stay unchanged.

Phone controls use one row each. Native selects retain room for their values and arrows.
Number inputs use character width and cannot shrink.

The Night hero no longer grows into unused screen space. Its spacer is 12px.
The stack still scrolls on short screens, and the hero cannot shrink over its actions.

Each route row draws its own connecting segment. The line starts and ends at the first and last markers.
The collaboration card and route editor no longer need a rail overlay workaround.

## After

The updated browser ran on isolated port 3426 with `.next-plan-layout` in this worktree.
The server used development mode, explicit keyless storage, and empty Supabase credentials.
Screenshots therefore include the Next.js development indicator. They are not production or native-shell screenshots.

| Check | Result | Evidence |
| --- | --- | --- |
| Empty host name | Visible and accessible `Add your name.` reason; filling the name enables lock. | [After lock](after-lock.png) |
| Edited context | Lock names the required route refresh. | [After controls](after-pills.png) |
| Selected values | Text fits at 320, 390, 430, and 1280px. The test includes `Alcohol-free`, `After work`, and `500`. | [Light controls](after-pills.png), [dark controls](after-pills-dark.png) |
| Night actions | Spacer is 12px. Both action centres remain tappable at 320, 390, and 430px. | [After Night mode](after-night.png) |
| Route rail | Segments join at row edges and end at the last marker, before collaboration. | [After route](after-route.png), [light collaboration](after-collaboration.png), [dark collaboration](after-collaboration-dark.png) |

The browser tests cover both themes at 390px, dark at 320 and 430px, and light at 1280px.

## Validation

- `PW_SKIP_WEBSERVER=1 PW_PORT=3426 npx playwright test e2e/plan-layout.spec.ts --project=chromium --workers=1 --trace=off`: 2 passed.
- `npx vitest run __tests__/planComposerCoverage.test.ts __tests__/planComposerRender.test.ts __tests__/planUi.test.ts __tests__/planSummaryMemberRoute.test.tsx __tests__/nightCrawlMode.test.ts --maxWorkers=1`: 85 passed across 5 files.
- `npx eslint components/plan/PlanComposer.tsx components/plan/PlanSummary.tsx e2e/plan-layout.spec.ts`: passed.
- `git diff --check`: passed.

The first development attempt failed because the canonical dependency installation lacked `@capacitor/browser`.
The worktree then used the audit checkout's installed dependencies. No dependency files changed.

A first geometry assertion reserved too much space for the desktop native arrow.
The assertion now reserves 20px. The final browser run passed in 16.3 seconds.

No full verification, production build, simulator, deployment, or GitHub mutation ran.
The isolated server was stopped after validation. Final integration checks remain with the parent.

## Review

Standards self-review: no remaining findings. Validation has one result; CSS changes remain within the existing plan modules.
Spec self-review: no remaining findings for these four issues. No new product direction or capability change was added.

The independent review and final merge gate remain with the parent.
