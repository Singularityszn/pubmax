# Installed-web push runbook

Wave 1.3 adds VAPID Web Push behind the existing `PushProvider` seam. It does
not add user or Plan identity. The registry in `lib/pushTokenStore.ts` is
identity-free by design. Native APNs tokens and web subscriptions can share it,
but the manual daily brief deliberately targets only web registrations.
Plan/person targeting remains unavailable.

## Owner activation

1. Generate one long-lived VAPID pair: `npx web-push generate-vapid-keys`.
2. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and optionally
   `VAPID_SUBJECT` in both production projects. Never commit the private key.
3. Apply additive migration
   `supabase/migrations/20260723121000_0052_web_push_subscriptions.sql`. It adds
   `web` to the existing identity-free registry and raises the opaque-token
   bound to 2048; existing native rows do not change.
4. Deploy. The UI must call `registerWebPush()` only after a real user action;
   the installed-PWA prompt does so only after a successful plan action in the
   current document. It participates in the shared prompt budget and never
   appears in an ordinary browser tab, the native shell, or on boot.

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
existing-subscription read share a 10-second limit. The token request has a
separate 10-second limit. Leaving the control cancels the app's wait and prevents
a late subscription result from registering a token. Cancellation does not stop
the browser's own subscription work. Regression coverage is in
`__tests__/webPush.test.ts` and `__tests__/webPushPending.test.tsx`.

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
