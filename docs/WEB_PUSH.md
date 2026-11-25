# Installed-web push runbook

VAPID Web Push uses the existing `PushProvider` seam. The public registry in
`lib/pushTokenStore.ts` remains identity-free. Native tokens and web subscriptions
can share it, but the manual daily brief targets only web registrations.
Private messages use a separate account-bound registry described under
[Message alerts](#message-alerts). [Price alerts](#price-alerts) also keep their
own account-bound subscriptions. Plan-scoped delivery remains unavailable.

## Owner activation

1. Generate one long-lived VAPID pair: `npx web-push generate-vapid-keys`.
2. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and optionally
   `VAPID_SUBJECT` in both production projects. Never commit the private key.
3. Apply additive migration
   `supabase/migrations/20260723121000_0052_web_push_subscriptions.sql`. It adds
   `web` to the existing identity-free registry and raises the opaque-token
   bound to 2048; existing native rows do not change.
4. Deploy only on the captain's instruction. The UI must call `registerWebPush()`
   only after a real user action. The installed-PWA prompt does so after a
   successful plan action in the current document. It participates in the shared
   prompt budget and never appears in an ordinary browser tab, the native shell,
   or on boot.

Without the VAPID pair the provider returns `vapid_not_configured` for every web
subscription and logs an actionable skip. Keyless app development remains
unchanged.

## Browser setup

The weekly nudge, London daily brief, and cheap-pint ping wait for the browser
to finish its first push subscription. After 60 seconds of subscription setup,
the disabled button shows **Still setting up notifications...**. The app keeps
waiting and does not show an error because subscription setup takes time.
When setup succeeds, the app registers the token and completes the requested
notification action. A subscription rejection, denied permission, or failed
token request can still produce an error.

The permission dialog also has no time limit. Service-worker readiness and the
existing-subscription read share a 10-second limit. The default public token
request has a separate 10-second limit. Leaving the control cancels the app's
wait and prevents a late subscription result from registering a token.
Cancellation does not stop the browser's own subscription work. Regression coverage is in
`__tests__/webPush.test.ts` and `__tests__/webPushPending.test.tsx`.

## Message alerts

The [Messages guide](../README.md#features) owns setup and preview controls.
Message alerts require the VAPID configuration above and migration
`supabase/migrations/20261116220000_0242_message_notifications.sql`.
Firstmate029 reports that migration 0242 from commit
`43d3a036208a51c0c0ae0526e8cb0690b4769003` is applied to production and verified.
Ordered presence updates additionally require
`supabase/migrations/20261117100000_0243_message_notification_presence_order.sql`.
Migration 0243 is not applied. Device binding writes additionally require
`supabase/migrations/20261125090000_0267_message_push_binding_order.sql`, which
requires 0243. Migration 0267 is not applied. Until it is applied, new device
bindings and releases fail with 503. Existing bindings keep delivering.
Application and deployment of each migration require the captain's separate
instructions. Each migration has its own rollback under
`supabase/migrations/rollback/`.

Every subscribe, restore and release carries the order in which this device
issued it. A binding write changes the stored binding only when it is newer than
the write that made that binding. A delayed release therefore cannot remove a
later restore, and a delayed restore cannot replace a later account's binding.
Browser cancellation does not stop a database write that is already running, so
the database enforces this order. The order is the device clock, capped at one
minute ahead of the database clock.

`registerWebPush()` accepts a `saveToken` callback for private registration.
Message alerts use that callback to register through `/api/message-notifications`
without adding a public-broadcast registration. The browser subscription can
still be shared with existing public alerts. The
[permission matrix](security/PERMISSION_MATRIX.md) owns account, session,
subscription-secret and preview access rules.
Private registration and settings writes use a three-second request limit.

Stored sends schedule `lib/messageNotifications.server.ts` alongside Realtime
signalling. Delivery failure does not fail the message send.
The sender must remain eligible, the message must remain visible, and the
recipient must have alerts enabled without a chat mute, sender mute or block.
Each recipient/message pair is claimed before delivery. A failed delivery is
not retried through that claim. A device viewing that conversation is excluded
while its presence is less than 30 seconds old. Visible clients renew every
20 seconds. A new client lifetime, visibility resume or rejected ordered write
requires an activity reservation through `presence-start`, scoped to the verified
account, session and exact subscription. Normal heartbeats reuse that reservation
and send one presence request. The store reports whether each ordered write
applied. A rejected write reserves again on the next heartbeat. A bearer refresh
within the same session keeps the reservation and uses the new bearer.
The server allocates this number beyond its stored ordering floor without
changing current presence. Heartbeats and clears carry `presenceVersion: 2`.
Older installed clients without this protocol receive 400 for presence writes.
They retain message delivery, consent and preview settings, but need a client
update for foreground suppression. Until migration 0243 is applied and an
activity reservation succeeds, foreground suppression is unavailable. Generic
message alerts still deliver. These failures do not drop private messages.

Each complete foreground attempt has a three-second limit, including credential
lookup, response bodies and notification tray reads. At most one native tray
read remains outstanding per mounted thread. Its expired result cannot close
notifications. A timeout permits recovery on the next heartbeat. Hiding or departing fences pending work. Account departure
pauses renewal until the exact original binding is confirmed restored. Settings
and visibility events cannot confirm restoration. Unmount and ownership loss
remain terminal.

The inbox and navigation badge share account-scoped reads and a private inbox
subscription. Each shared read has a three-second limit through response-body
completion. A timeout rejects its waiting readers and removes the pending entry,
so the next refresh can retry. Successful results remain shared for
250 milliseconds to cover readers rendering together. Arrival and read signals
invalidate the shared result. Visible tabs poll every 15 seconds when Realtime
is unavailable and every 60 seconds when it is live. Hidden tabs stop polling,
cancel pending badge reads and refresh when shown again. A completed message
read replaces a pending badge read. Aborted reads and replies from a previous
account cannot update the badge.

Transport payloads contain generic text and routing IDs. A preview-enabled
worker asks an open client for its current authorisation, then resolves the
preview through the permission checks above. Missing authorisation or a lookup
that exceeds 1.5 seconds leaves the generic alert. Notifications share a tag
per conversation so later alerts replace earlier ones without renotifying.

Sign-out and account switching attempt to detach the current message binding
and close its notifications. Failed detach requests remain queued for later
contact. Departure preserves the browser subscription used by public alerts.
A signed-in account with alerts enabled can restore its device binding without
another permission prompt. Revoked sessions are excluded when delivery targets
are read. Generic pushes already in flight can still appear after departure.

## Price alerts

The [feature guide](../README.md#features) owns setup, supported clients,
matching limits and browser subscription replacement. Price alerts require
the VAPID configuration above and migration
`supabase/migrations/20261120000000_0251_price_alerts.sql`.
Its rollback is `supabase/migrations/rollback/20261120000000_0251_price_alerts_rollback.sql`.
Migration application and deployment require the captain's separate instructions.

`registerWebPush()` obtains the subscription without adding a public-broadcast
registration. `/api/price-alert` stores it through `lib/priceAlertStore.ts`.
The [permission matrix](security/PERMISSION_MATRIX.md) owns access rules.
The [privacy notice](../app/privacy/page.tsx) owns storage and retention disclosures.

A Pint Drop triggers delivery only when it completes a second-reporter
confirmation. A single unchecked Pint Drop does not qualify. The sender reads
the pair back before dispatch, and the pair must still be the pub's standing
confirmation. Private, hidden and non-pint reports do not qualify. The
[cron runbook](CRON_PLANE_RUNBOOK.md#what-runs-when) owns the listed-price scan
schedule. The scan considers sourced, explicitly pint-sized beer rows
from the authoritative UK price bundle. The canonical `priceStandingFor`
decision must still classify each row as listed at dispatch time. Expired
listings and estimates do not qualify.

A pair qualifies only when its confirmation time follows the preference's
`enabled_at`. The notification keeps the selected report's observation date,
so a subscription can begin between the two reports and still qualify.

Enabling an alert records the current bundle as a baseline before saving the
preference. A listing qualifies only when its first discovery follows the
preference's `enabled_at`. Changing area resets that cutoff.
The source observation date remains the date disclosed in the notification.
An already claimed listing does not prevent the scan from trying later candidates.

Delivery claims prevent repeat events and enforce the feature guide's daily
limit across both sources. A failed delivery still consumes its
claim and is not retried. An invalid subscription removes only the preference
that still holds that token. Push work runs through `fireAndForgetPush()`.
Its failure does not fail a Pint Drop write or change the reconciliation
route's response. Regression coverage is in `__tests__/priceAlert*.test.ts`
and `__tests__/priceAlertPref.test.tsx`.

## Step Out weekly nudge

Separate from the city-wide daily brief. Step Out is **opt-in, default OFF**,
at most one place-bound push per week per subscription. Preference storage is
migration `0094` (`step_out_nudge_prefs`); delivery still uses the existing
web-push rails (`push_tokens` / VAPID). The You → Notifications control binds
the preference to a web subscription in a supported browser tab on a computer
or Android phone. An iPhone or iPad requires Home Screen install first. The
native app does not offer Step Out alerts yet. A browser with notifications
blocked directs the person to its site settings before another attempt.

Turning off the weekly nudge stops Step Out alerts. It preserves the shared
browser push subscription and its `push_tokens` registry entry, even when all
other notification preferences are off. Other notifications, including the
London daily brief and cheap-pint ping, can still use the shared subscription.

Operator / cron:

```sh
npm run push:step-out -- --dry-run
npm run push:step-out
```

Production schedule: `GET /api/cron/step-out-nudge` (Thursday 16:00 UTC) behind
`assertCronRequest`. Payload priority: Wanted near the night-area patch → open
Soft Plan → sourced deal ending tonight. Skip when nothing is owed — no filler.

## Manual daily brief

GitHub scheduled jobs remain blocked by the billing cap, so delivery is an
operator action:

```sh
npm run refresh:weather
npm run push:daily -- --dry-run
npm run push:daily
```

The script loads `.env.local`, reads the same `buildWeatherBrief`,
`rankTonightPicks`, and `toTonightPickDto` composition used by `/today`, and
sends no notification when weather is stale or there is no current sourced
Tonight pick. It also refuses to send without durable Supabase access because a
new process has no in-memory subscribers. Logs contain counts only, never push
endpoints or subscription keys.

The default send claims one durable budget per London calendar day before
delivery, preventing an accidental second operator run from spamming every
subscriber. Because the claim is consumed before network delivery, use
`npm run push:daily -- --force` only for a deliberate retry after checking the
first attempt's counts.

The service worker accepts only same-origin click-through paths. Malformed or
external URLs fall back to `/today`.

## Push-service destination allowlist

A browser-provided subscription endpoint becomes an outbound server request in
the VAPID provider, so it is treated as a stored-SSRF boundary. Registration,
storage, and delivery all require HTTPS on the default TLS port, an allowed
host, and a recognized path:

| Browser service | Allowed host | Accepted path |
| --- | --- | --- |
| Google FCM | `fcm.googleapis.com` | `/fcm/send/<token>` or `/wp/<token>` |
| Mozilla Autopush | `updates.push.services.mozilla.com` | `/wpush/<token>` |
| Apple Web Push | `web.push.apple.com` | `/<token>` |
| Microsoft WNS (Edge) | one label under `notify.windows.com` | `/w/?token=<token>` |

The Google endpoint forms are documented by the
[Chrome Web Push guide](https://developer.chrome.com/blog/push-notifications-on-the-open-web)
and [FCM reference](https://firebase.google.com/docs/reference/fcm/rest), the
Mozilla production host/path by the
[Autopush HTTP API](https://mozilla-services.github.io/autopush-rs/http.html),
and Apple documents using the endpoint returned by the subscription in
[Sending web push notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).

Edge subscribes through Windows Push Notification Services, whose regional
host varies (for example `wns2-par02p.notify.windows.com`). That row is the one
bounded pattern: exactly one DNS label before `notify.windows.com`, the fixed
`/w/` path and a non-empty `token` query (`lib/webPushSubscription.ts`).

Keep exact host matching for Google, Mozilla and Apple. Only WNS uses the
bounded host pattern above. Do not broaden it to arbitrary suffix or wildcard
matching. IP literals, localhost, arbitrary hosts, credentials, fragments,
non-HTTPS schemes, and custom ports stay rejected. Supporting a new push
service requires primary
browser/vendor evidence plus acceptance and rejection tests at the codec,
route/store, and provider-send boundaries.
