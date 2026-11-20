# Payday pint email

The payday pint email is disabled by default. A visitor chooses a home station,
confirms they are 18 or over, and asks for the weekly email. The signup stays
pending until the visitor confirms through the link sent to their address.
Every email has an unsubscribe link and one-click unsubscribe headers.

The server stores the email address, station, consent wording and times, and
unsubscribe state. Browser roles cannot read or write these records. The weekly
job uses only confirmed, non-withdrawn subscriptions. It runs on Fridays and
claims each subscriber once per week. If delivery fails after a claim, that
week is not retried. The email shows a source and date for each price.

The preview route requires `PAYDAY_PINT_PREVIEW=1` and an exact station name in
`/api/payday-pint/preview?station=Bank`. It renders the email content without a
recipient, unsubscribe link or sender address. Signup and delivery require
`PAYDAY_PINT_ENABLED=1`, `PAYDAY_PINT_DELIVERY_ENABLED=1`, `RESEND_API_KEY`, a
verified `EMAIL_FROM` and `PAYDAY_PINT_POSTAL_ADDRESS`. A missing setting keeps
signup and delivery unavailable. The homepage link is decided at build time.
Changing the flags requires a new build to show or hide that link. A sender and
its credentials need the captain's decision. The migration needs a separate
apply instruction. Unsubscribe remains available when signup is disabled.

The older `email_subscribers` table is separate. No payday email uses its rows.
