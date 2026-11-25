# Payday pint email

The payday pint email is disabled by default.
See the [signup instructions](../README.md#payday-pint-email) for the steps.
Confirmation links expire after 48 hours. Opening a confirmation link does not
confirm the signup until the visitor submits the confirmation form.
Weekly emails have an unsubscribe link and one-click unsubscribe headers.
Opening an unsubscribe link shows a form. Submitting that form or a one-click
unsubscribe request records the withdrawal. A pending signup requested before
the latest withdrawal cannot reactivate delivery.

Signup offers only stations that have at least one listed pint price within
1 km, and the signup route refuses any other station.

The server stores the email address, station, consent wording and times, and
unsubscribe state. The [permission matrix](security/PERMISSION_MATRIX.md) owns
database access rules. The weekly job uses only confirmed, non-withdrawn
subscriptions. It runs on Fridays and tracks one weekly delivery per subscriber.
Migration 0267 adds delivery state and an immutable provider request to each
weekly claim. A retryable failure permits at most three attempts for the same week,
including the first send. A later invocation must still fall on Friday.
Each attempt rechecks consent and reuses the stored sender, content and provider
idempotency key. An invalid recipient or exhausted attempts stops that week's delivery.
The cron returns HTTP 503 for retryable failures or exhausted retries and
reports them separately from skipped subscribers. This adds no retry schedule.
The initial request selects up to three listed prices within 1 km
of the station, cheapest first. Eligibility uses `priceStandingFor` in
`lib/priceTier.ts` when that request is prepared. Each price shows its source and date.
If no eligible prices remain, the email says so.

The preview route requires `PAYDAY_PINT_PREVIEW=1` and an exact station name in
`/api/payday-pint/preview?station=Bank`. It renders the email content without a
recipient, unsubscribe link or sender address. Signup and delivery require
`PAYDAY_PINT_ENABLED=1`, `PAYDAY_PINT_DELIVERY_ENABLED=1`, `RESEND_API_KEY`, a
verified `EMAIL_FROM` and `PAYDAY_PINT_POSTAL_ADDRESS`. A missing setting keeps
signup and delivery unavailable. The [signup instructions](../README.md#payday-pint-email)
own the entry route. A sender and its credentials need the captain's decision.
The migration needs a separate
apply instruction. Unsubscribe remains available when signup is disabled.

The older `email_subscribers` table is separate. No payday email uses its rows.
The [older weekly digest](EMAIL_DIGEST.md) also remains separate.
