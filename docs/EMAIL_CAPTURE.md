# Dormant email digest capture infrastructure

Public digest capture is retired. The identity nudge now has one email action:
functional magic-link sign-in. It must not collect a second email address or
promise a digest until confirmation and delivery work end to end.

Existing routes and subscriber rows remain in place as dormant infrastructure.
No existing pending row is deleted, confirmed, or added to a mailing audience
by this retirement. A future launch still requires one stated purpose at
capture and double opt-in before any address becomes mailable.

## Current product state

- `components/identity/IdentityNudge.tsx` offers social sign-in when configured
  and one magic-link email field.
- No current product surface posts to `/api/email-subscribers`.
- `email_subscribed` remains in the analytics registry for historical
  compatibility, but the identity nudge no longer emits it.
- Confirmation delivery, confirmed audience loading, provider delivery, and
  the weekly schedule remain inactive. Do not restore capture until all four
  are operational and proved in production.

## Pieces

| Concern | File |
|---|---|
| Validation / normalisation / token minting (browser-safe) | `lib/emailSubscribers.ts` |
| Dual-backend store (memory ↔ Supabase `email_subscribers`) | `lib/emailSubscribersStore.ts` |
| Migration (RLS service-role only) | `supabase/migrations/20260718150000_0042_email_subscribers.sql` |
| Capture route (envelope, per-IP + global durable limits, 503 on hard write fail) | `app/api/email-subscribers/route.ts` |
| Confirm / unsubscribe endpoints (token-gated GET) | `app/api/email-subscribers/confirm/route.ts`, `.../unsubscribe/route.ts` |
| Provider-gated confirmation email (inert until keys) | `lib/emailConfirmation.ts` |
| Retired public surface boundary | `components/identity/IdentityNudge.tsx` |

## Data model

`public.email_subscribers`: `email` (unique, lower-cased, validated),
`source` (allowlist — `'identity-nudge'` today), `confirmed` (default `false`),
`unsubscribe_token` (unique, opaque; backs both the confirm and unsubscribe
links), `created_at` / `updated_at` / `confirmed_at`. **RLS enabled with no
public policy** — the service-role route is the only reader/writer; emails and
tokens never leave the API boundary.

## Dormant double opt-in flow

1. **Capture** → `POST /api/email-subscribers { email, source }`. No current
   product surface calls this route. If a future launch restores capture, the
   address is stored `confirmed = false` (a *pending* subscriber). Idempotent by
   email: a re-submit returns the existing row without re-confirming or rotating
   the token.
2. **Confirm email** → `lib/emailConfirmation.ts` builds a single-purpose email
   with a confirm link carrying the token. Sending is **provider-gated and inert
   today** (noop until `RESEND_API_KEY` + `EMAIL_FROM` exist — the same seam as
   `lib/emailProvider.ts` on `feat/email-digest`). The route reports
   `confirmationSent: false` today, so any future caller can report delivery
   truthfully.
3. **Confirm** → the recipient follows the link → `GET /api/email-subscribers/
   confirm?token=…` flips the row to `confirmed = true`. This is the *only* way an
   address becomes mailable.
4. **Unsubscribe / erasure** → `GET /api/email-subscribers/unsubscribe?token=…`
   deletes the row.

## Digest recipient seam (#327 — do NOT edit `feat/email-digest`)

`feat/email-digest` resolves recipients through
`resolveDigestRecipients(members: DigestAudienceMember[])`, mailing a member only
when `optIn === true && optOut !== true` (`isDigestOptedIn`). This capture concept
wires in **without changing that predicate**:

- `emailSubscribersStore().listConfirmedSubscribers()` yields the set of
  **confirmed** emails (unconfirmed rows are never yielded).
- When the branches meet, the digest's audience loader maps each confirmed
  subscriber to a member as `{ id, email, optIn: true, optOut: false }`. An
  unconfirmed subscriber is simply absent, so `optIn` stays effectively false and
  double opt-in holds end-to-end.

This module owns the confirmed/unconfirmed truth; the digest owns the send. The
seam is `listConfirmedSubscribers()` — no edit to `#327`'s branch is required.

## Failure posture (house rules)

- Durable rate limits on **two axes** (per-IP + global) in production; degraded
  budget on transient limiter failure; in-memory limiter for keyless dev.
- A hard durable-store write failure answers **503** (degraded dependency, never
  a fake success).
- Before migration 0042 lands, the store fails soft to process-memory so capture
  keeps working and becomes durable the moment the table exists.
