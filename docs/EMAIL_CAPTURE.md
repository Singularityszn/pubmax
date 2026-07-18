# Early email capture (identity nudge)

The Cycle-2 locked owner decision — *"push identity harder … early email
capture"* — gives a signed-out user a **lightweight** alternative to full OAuth:
leave just an email to receive the weekly pint digest. Full OAuth remains the
richer path; this is the one-field option next to it on the identity nudge sheet.

Privacy-first, GDPR-sane: **one purpose, stated at capture** (the weekly digest),
and **double opt-in** — a captured address is stored *unconfirmed* and is never
mailed until the recipient confirms.

## Pieces

| Concern | File |
|---|---|
| Validation / normalisation / token minting (browser-safe) | `lib/emailSubscribers.ts` |
| Dual-backend store (memory ↔ Supabase `email_subscribers`) | `lib/emailSubscribersStore.ts` |
| Migration (RLS service-role only) | `supabase/migrations/20260718150000_0042_email_subscribers.sql` |
| Capture route (envelope, per-IP + global durable limits, 503 on hard write fail) | `app/api/email-subscribers/route.ts` |
| Confirm / unsubscribe endpoints (token-gated GET) | `app/api/email-subscribers/confirm/route.ts`, `.../unsubscribe/route.ts` |
| Provider-gated confirmation email (inert until keys) | `lib/emailConfirmation.ts` |
| Surface (email path on the identity nudge) | `components/identity/IdentityNudge.tsx` |

## Data model

`public.email_subscribers`: `email` (unique, lower-cased, validated),
`source` (allowlist — `'identity-nudge'` today), `confirmed` (default `false`),
`unsubscribe_token` (unique, opaque; backs both the confirm and unsubscribe
links), `created_at` / `updated_at` / `confirmed_at`. **RLS enabled with no
public policy** — the service-role route is the only reader/writer; emails and
tokens never leave the API boundary.

## Double opt-in flow

1. **Capture** → `POST /api/email-subscribers { email, source }`. The address is
   stored `confirmed = false` (a *pending* subscriber). Idempotent by email: a
   re-submit returns the existing row without re-confirming or rotating the token.
2. **Confirm email** → `lib/emailConfirmation.ts` builds a single-purpose email
   with a confirm link carrying the token. Sending is **provider-gated and inert
   today** (noop until `RESEND_API_KEY` + `EMAIL_FROM` exist — the same seam as
   `lib/emailProvider.ts` on `feat/email-digest`). The route reports
   `confirmationSent: false` today, and the UI copy stays honest — it never
   claims an email that did not go out.
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
