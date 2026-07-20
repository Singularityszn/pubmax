# Installed-web push runbook

Wave 1.3 adds VAPID Web Push behind the existing `PushProvider` seam. It does
not add user or Plan identity. Native APNs tokens and web subscriptions can
share the registry, but the manual daily brief deliberately targets only web
registrations. Plan/person targeting remains closed until Wave 1.4.

## Owner activation

1. Generate one long-lived VAPID pair: `npx web-push generate-vapid-keys`.
2. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and optionally
   `VAPID_SUBJECT` in both production projects. Never commit the private key.
3. Apply additive migration
   `supabase/migrations/20260720160000_0046_web_push_subscriptions.sql`. It adds
   `web` to the existing identity-free registry and raises the opaque-token
   bound to 2048; existing native rows do not change.
4. Deploy. The UI must call `registerWebPush()` only after a real user action;
   the library never requests permission on boot.

Without the VAPID pair the provider returns `vapid_not_configured` for every web
subscription and logs an actionable skip. Keyless app development remains
unchanged.

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
