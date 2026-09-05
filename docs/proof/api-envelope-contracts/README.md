# Two API contract slips, measured and closed

Proof for verification scout verify-preview-4, section 7.3 and observation 9,
5 September 2026.

## What was wrong

| Item | The defect |
| --- | --- |
| Observation 9 | A multipart `POST /api/avatar` (a mistyped `/api/avatar/<profileId>`) answered a 500 HTML error page rather than a 404 in the house envelope. It was the only error-level runtime log line on preview C in 75 minutes. |
| Section 7.3 | A repeat `DELETE /api/account` with the same bearer answered 401 `UNAUTHENTICATED`, not the 410 `already-gone` the route's own comment and #1548's README promise. The scout's runtime log: `DELETE 200 at 21:02:17, DELETE 401 at 21:02:31`. |

## 1. An unknown address answered 500 because of its content type

The typo is not what broke. Next treats a form-encoded or multipart POST to a
path NO route handler claims as a Server Action invocation, looks the action id
up in the body, finds none and throws. So the CONTENT TYPE decided whether an
unknown address answered 404 or 500.

Reproduced on this branch by taking the new route out and putting it back on one
running server, `pint.jpg` being a three-byte file with a JPEG magic number:

```
BEFORE  (app/api/[[...unmatched]] moved aside)
$ curl -X POST -F "photo=@pint.jpg;type=image/jpeg" http://127.0.0.1:3988/api/avatar
status=500 type=text/html; charset=utf-8
<!DOCTYPE html>... Failed to find Server Action ...
server log: Failed to find Server Action. This request might be from an older or newer deployment.

AFTER   (the same server, route restored)
$ curl -X POST -F "photo=@pint.jpg;type=image/jpeg" http://127.0.0.1:3988/api/avatar
status=404 type=application/json
{"error":"That endpoint doesn't exist.","code":"NOT_FOUND","retryable":false}
```

`app/api/[[...unmatched]]/route.ts` is an optional catch-all: it sits below
every real route, claims `/api` itself and every unmatched path under it, and
answers one `publicApiError(..., 404)` whatever the method. Because a route
handler now MATCHES the path, the Server Action lookup never runs.

### The production build, probed

`NEXT_DIST_DIR=.next-prod npm run build && NEXT_DIST_DIR=.next-prod PORT=3987 npm run start`.
The build lists `ƒ /api/[[...unmatched]]` beside every real route.

| Request | Answer |
| --- | --- |
| `POST /api/avatar` (multipart) | 404 `application/json`, the envelope above |
| `POST /api/nope` (urlencoded) | 404 `application/json` |
| `GET /api/nope` | 404 `application/json` |
| `DELETE /api/deep/unknown/path` | 404 `application/json` |
| `GET /api`, `PATCH /api` | 404 `application/json` |
| `GET /api/freshness` | 200 (control, a static route) |
| `GET /api/venue/venue-1vle947` | 200 (control, a dynamic route) |
| `GET /api/out?city=london` | 200 (control) |
| `DELETE /api/freshness` | 405 (a wrong method on a real route is unchanged) |
| `GET /not-a-page` | 404 `text/html` (a document keeps the house 404 page) |

Scope is `/api` alone. The flat JSON envelope is a contract with a CALLER; a
browser asking for a page it can read is owed the house 404 page instead.

## 2. The repeat delete could not name a caller whose auth row had gone

`DELETE /api/account` resolved its caller with `callerUserId`, which asks GoTrue
for the ACCOUNT (`accountMetadata: true`). The first delete removes the auth
row, so every later request carrying that same unexpired bearer read as
`user_not_found` and the route answered 401 before it could reach the
`already-gone` branch. The documented 410 was unreachable in production for the
whole life of that door.

The token can still name the account without a live auth row: `verifyCallerAuth`
with no options checks the signature and the expiry against the project JWKS and
takes `sub` from the verified claims (`lib/authServer.ts`, pinned by
`__tests__/authServerVerification.test.ts`). The route now asks that, so a
deleted account is still NAMED by its own token, `deleteOwnAccount` answers
`already-gone`, and the route answers 410 with `deleted: true` as promised.
Nothing here trusts a claim it did not verify, and the target is still the token
rather than a request field.

Two things fall out of it, both deliberate:

- A verification we could not RUN is now its own answer, a retryable 503
  `AUTH_UNAVAILABLE`. `callerUserId` collapsed absent, invalid and unavailable
  into one null, and telling somebody who is signed in that they are not is the
  one thing this door may not say.
- The client needs no change: `DeleteAccountCard` already reads `deleted: true`
  as the answer whatever the status.

`__tests__/accountDeletionRoute.test.ts` holds both halves at the route: the
bearer seam records the options it was asked with, so a return to account
metadata fails there, and the second delete still answers 410 carrying
`deleted: true`.

This half is proved at the route rather than against a live cluster: a keyless
worktree has no GoTrue and no project JWKS, so there is no local way to sign a
token whose account has been removed. The production measurement is the scout's
own log line above.

## Where the promise is written down

`docs/proof/account-deletion-real/README.md` already said "A second DELETE is
410 Gone carrying `deleted: true`". That sentence is now true.
