# Plan invite flow: the read follows the capability, and the token is live

Four defects from the core-loop battle test of 5 September 2026 (M01, M02, M04,
L05), plus one thing the invitee teaser drew over its own copy. This directory
holds the measurements and the before/after frames.

- **before/** is `origin/main` at `4a435c464`.
- **after/** is this branch.
- Both were built and served from the same keyless production environment the
  Playwright config uses. The "before" side carried
  `PUBMAX_FRIEND_MEMBER_REHYDRATION_V2=1`, which was still what unlocked the
  member projection then; #1519 has since retired that switch, so the "after"
  side needs nothing. Frames at 390x844, 768x1024 and 1440x900.

## What each defect was, and what the frames show

### M01 - a claimed seat did not reach the route

A host opening their own plan on a second device read `/api/plans/[id]` before
the account session had resolved, so the read carried no capability. The seat
claim landed a moment later, and nothing on screen changed: they were left
looking at "You've been invited" on their own plan until they reloaded.

The read now follows the capability (`components/plan/usePlanMemberRead.ts`).

### M02 - a fresh guest saw the crew row and not the route

Tapping "I'm in" put the guest's name in the crew and left the route beside it
saying "The full route reveals once you join the crew" until a reload.

| | before | after |
|---|---|---|
| 390x844 | `before/plan-route-after-join-390x844.png` | `after/plan-route-after-join-390x844.png` |
| 768x1024 | `before/plan-route-after-join-768x1024.png` | `after/plan-route-after-join-768x1024.png` |
| 1440x900 | `before/plan-route-after-join-1440x900.png` | `after/plan-route-after-join-1440x900.png` |

Every "after" frame is the same page instance the join happened on: no reload.

### M04 - the share href kept the retired token

"New link" answered "New link ready. The old one stopped working." while the
Send on WhatsApp href beside it still carried the old token, which the server
already refuses. Measured on the before build:

```
apiToken  = the rotated token from GET /api/plans/<id>
hrefToken = the token still in the Send on WhatsApp href
before: hrefToken !== apiToken   (the href needed a reload to catch up)
after:  hrefToken === apiToken   (same frame, no reload)
```

The token is not a copy any surface keeps now: `lib/planInviteTokenClient.ts`
holds one live value per plan, the rotate writes it, and every share href reads
it. `e2e/plan-invite-surface.spec.ts` asserts the equality above.

### L05 - the public host name was the email

"Your name" in the composer defaulted to the account's email local part, and
that name is then the host name on the plan, on the share card and in the
unfurler. Measured with the e2e fixture account (handle `karansznx`, email
`karanmanoharann@example.test`, no provider display name):

| viewport | before | after |
|---|---|---|
| 390x844 | `karanmanoharann` | `karansznx` |
| 768x1024 | `karanmanoharann` | `karansznx` |
| 1440x900 | `karanmanoharann` | `karansznx` |

Frames: `*/plan-composer-name-<viewport>.png`.

### The teaser drew a route rail over its own copy

The rail is the route's spine. The invitee teaser has no route, and at 390 the
rail landed inside the text column and struck through the host's name and the
join control. Measured on the before build, page coordinates:

| viewport | rail x | teaser copy x | overlaps heading | overlaps join |
|---|---|---|---|---|
| 390 | 66 | 43 | yes | yes |
| 768 | 93 | 150 | no | no |
| 1440 | 219 | 265 | no | no |

Frames: `*/plan-route-before-join-390x844.png`. The rail is no longer drawn on
the teaser, and `e2e/plan-invite-surface.spec.ts` measures the boxes at 390.

## Observed and NOT fixed here

**The same rail overshoots the stops on the member route.** It is positioned
against the whole `.planSummary` section (`app/plan/plan.css`, `bottom: 56px`),
so once the Round card renders below the stops the rail runs straight through
it. Measured on this branch, distance from the last stop marker's centre to the
bottom of the rail:

| viewport | overshoot | what it crosses |
|---|---|---|
| 390 | 1439px | the Round card and its heading |
| 768 | 1649px | the Round card and its heading |
| 1440 | 1094px | the Round card, 1px off its heading's left edge |

Visible in `after/plan-route-after-join-1440x900.png`. It is a pre-existing
defect on a surface none of the four battle-test items touch, and correcting it
is a taste call about how far the spine should run, so it is handed over with
these numbers rather than changed here.

## How to reproduce

```
# one keyless production build per side, then
npm run start -- --port 3150
PW_PORT=3150 PW_SKIP_WEBSERVER=1 npx playwright test --project=chromium \
  plan-join-reveal plan-invite-surface plan-host-name
```
