# D01: a host could not read their own plan

Core-loop battle test, 5 September 2026, defect D01. The member projection sat
behind `PUBMAX_FRIEND_MEMBER_REHYDRATION_V2`, which CI and the screenshot
scripts set and no deployment did. Every read of `/api/plans/[id]` therefore
answered the anonymous preview.

Both deployments below carry the same isolated Supabase database
(`pubmax-pentest`, `qdojzkgrpujqetgcimfy`) and **neither sets that variable**.
No production data was touched.

| | Deployment | Commit | The variable |
|---|---|---|---|
| Before | `dpl_7pExm1ransVAzGy2cbDzyNmvyexp` | `c6cdb0301` (main) | absent from the environment |
| After | `dpl_J6NwhCuN8HzBS99zfMLLc5c1hQyb` | `f1c52639f` (this branch) | deleted from the code |

## The API answer

A host holding the HttpOnly member cookie their own `POST /api/plans` set,
reading their own plan back.

Before:

```json
{
  "visibility": "preview",
  "hostDisplayName": "Host",
  "stopCount": 3,
  "routeReady": true,
  "inviteToken": "d1cd1867c05665ad51a8fddda5ecae1c"
}
```

No stops, no crew, no title: the same body a stranger gets.

After, on the preview, every reader in one pass:

| Reader | `visibility` | Route | Crew |
|---|---|---|---|
| Host, own cookie | absent, so the raw `PlanState` | 3 stops | Alice |
| Stranger, no cookie | `preview` | absent | absent, and no title leak |
| Guest, after `POST /join` 200 | absent, so the raw `PlanState` | 3 stops | Alice |
| Host, after that join | | | Alice, Bob |

Bodies: `after-api.json`, `after-stranger-api.json`, `after-guest-api.json`.

## The screens

Captured through CDP at three viewports, with the Night mode dialog and the
analytics consent bar dismissed on both sides so the pages compare like for
like.

| Viewport | Before | After |
|---|---|---|
| 390x844 | `before-host-plan-390x844.png` | `after-host-plan-390x844.png` |
| 768x1024 | `before-host-plan-768x1024.png` | `after-host-plan-768x1024.png` |
| 1440x900 | `before-host-plan-1440x900.png` | `after-host-plan-1440x900.png` |

At 1440 the same region reads, before: "The route", then "You've been invited",
"Alice is planning a night out", "The full route reveals once you join the
crew", "Join the crew". After: "The route", the numbered three-stop map, and
"Edit route". At 390 the Night mode dialog reads "Your night out. No stops yet"
before and "Friday near Bank. Stop 1 of 3. Now, Arnos Arms" after.

## One finding this fix uncovered, for the plan UI lane

`after-guest-client-reveal-gap-390x844.png`. After a guest joins through the
product UI (`/plan/<id>#invite=<token>`, a name, "I'm in"), the SERVER now
serves them the route: that browser's own `GET /api/plans/<id>` answers the
member projection with all three stops, and the crew section updates to show
them. The route section still renders "You've been invited". A reload does not
clear it, and it reproduces identically on a local production build, so it is
not environmental.

That is M02 of the same battle test, "the plan re-read after `/join` does not
carry the new capability", and it was invisible while D01 stood, because the
server refused every reader. It is a client-side reveal defect in the plan page,
not in this boundary, and it is not this PR's change. The host path, which is
what D01 was about, reveals correctly.

## What decides it now

`resolvePlanProjection` (`lib/planPrivacyBoundary.server.ts`) reads no
environment variable. It still fails closed, so a stranger still gets the
preview.
