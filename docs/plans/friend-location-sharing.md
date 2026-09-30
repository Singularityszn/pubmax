# Friend location sharing

Status: implementation in progress in isolated friend-location branch. Migration 0175, server routes, foreground controller and map marker integration are under local verification. No production migration or deployment. This extends the Social density work in [PLG strategy, wave 3](PLG_STRATEGY.md); it does not create a separate roadmap.

## User outcome

After two people add each other, either can choose to share their location with selected mutual friends. Adding somebody alone does not reveal either location. The recipient sees a named map marker only while sharing is valid. Both people keep the ability to stop at any time.

Agreed default: one hour of explicit, foreground-only sharing. Points use the existing three-decimal reduction before network egress. Accuracy is at least 110 metres to reflect that reduction.

## Current code

- `lib/followStore.ts`: mutual follows and mutual-handle list.
- `lib/socialRelationships.server.ts`: reciprocal relationship and blocking resolution, failing closed on unavailable storage.
- `lib/socialAccessServer.ts`: verified adult Social actor and account ownership.
- `lib/presence.ts`, `app/api/presence/route.ts`: explicit venue check-ins with a two-hour TTL. These are not GPS sharing and must not be repurposed as private coordinates.
- `components/PubMap.tsx`, `components/PubMapCanvas.tsx`: the existing map, with concurrent unshipped work in the v0 integration lane.
- `app/privacy/page.tsx`: says the app never tracks location in the background. Any live feature must preserve that promise and describe new recipient/retention behaviour before release.

## Flow

1. Open Friends from the map. Show mutual friends and an honest empty state with the existing add-friend door.
2. Select recipients. Explain: "Share your location with these mates for one hour. Updates pause when this page is hidden."
3. Tap Share my location. Only this explicit tap can request browser location permission. A denied request sends no coordinate to the server.
   If the start response is lost, server acceptance is unconfirmed. Stop local updates, clear the pending point and recheck authority. Keep another Share disabled until an authoritative read confirms whether a share exists. An existing share is shown as active with updates paused; reconciliation alone does not authorise another coordinate update.
4. After server confirmation, show selected recipients, end time, accuracy and Stop sharing. Existing friend shares appear on the map without moving the user's camera.
5. Pause the watcher on page hide. Clear friend markers when the page hides, the account changes, polling fails or their share expires. Resume by rechecking authority and sharing state, not by resurrecting a browser cache.
6. Stop sharing clears the browser watcher immediately, then requests revocation. Show a pending/error state until the server confirms. Do not claim revocation when the network request failed. Session tokens ensure a delayed update cannot restart a stopped share.

## Data and authority

Use a new private store. Do not add precise coordinates to profiles, public venue presence, social posts, analytics or URL parameters.

A share has an opaque session ID, owner profile ID, explicit recipient profile IDs, server-minted start and expiry, current coordinate, accuracy and server-observed update time. Retain only the latest point. Maximum 20 recipients. Reads require a live verified adult account, an explicit grant, current mutual relationship, no block in either direction, live owner, unexpired session and a recent point. Check those facts on every read. Missing relationship/storage answers reveal nothing.

Client roles receive no direct table access. Service-mediated operations still check the actor and recipient set. SQL constraints mirror coordinate bounds, bounded recipients and maximum lifetime. Foreign keys remove grants and coordinates when either identity is deleted. Expired points are physically purged on a documented schedule; hiding expired rows alone is not retention cleanup.

Create/update/revoke operations use session ID plus server revision. Updates can change only the latest point of a live session. They cannot replace recipients, extend expiry or create a session. Revocation removes coordinate access immediately, increments revision and refuses old updates. New sharing needs another explicit start operation. Serialise start/update/revoke in the database, not only in React.

Uncertain starts also need a durable account generation. An empty read alone cannot prove that a submitted POST will never arrive. Start carries the generation last confirmed by the server and compares it under the existing actor lock. Reconciliation fences that pending generation atomically and returns the current share plus generation. If start wins the lock first, reconciliation returns that active share with local updates paused. If reconciliation wins first, the late start is refused. A later explicit Share uses the new generation. Confirmed Stop advances the generation so an already-submitted replacement cannot recreate sharing after revoke. Point cleanup preserves the generation, which contains no coordinates. Client mutation receipts advance its generation; stale reads or receipts cannot lower it or restore an older share. This stays within the existing route and RPC: start adds `expectedGeneration`; uncertainty uses POST `{ action: "reconcile", expectedGeneration }`. GET remains read-only. The protocol has local implementation and regression evidence; final verification and browser proof remain required.

All endpoints use the existing API error envelope, verified Social actor, bounded JSON and dedicated rate limits. Responses use `Cache-Control: private, no-store`; clients use `cache: no-store`. Service workers and offline outboxes must never retain the points. Poll only while visible, with bounded retry/backoff; evaluate private realtime only after the poll path is measured.

## UI and map ownership

Use the existing launch tokens and button primitives. Friend markers have a name, last-update time and accuracy indicator, distinct from venue price pins. Old points say "Last seen" and disappear after the freshness limit. No camera move occurs on arrival or heartbeat. A separate explicit Show on map action may centre a selected friend. Signing out clears all coordinates from memory. Avoid saving exact points in localStorage.

## Verification required before shipping

| Scenario | Required result |
| --- | --- |
| One-sided follow, stranger or anonymous read | No point or recipient list disclosed. |
| Mutuals, but no explicit share | No point disclosed. |
| Selected mutual, live share | Named point and accuracy shown. |
| Block, unfollow, account deletion or expiry | Next read refuses; map removes point. |
| Delayed update after Stop sharing | Update refused and no point restored. |
| Network failure during revoke | Watcher stops; UI reports pending revoke rather than success. |
| Lost start response or failed authority reconciliation | Watcher stays stopped; start remains unconfirmed; another start cannot replace a possibly active share. |
| Denied/missing geolocation, hidden page | No automatic permission prompt or background update. |
| Different signed-in account in same tab | Old account coordinates disappear before new data arrives. |
| Offline revisit | No cached friend location or queued coordinate write. |
| Desktop 1440, tablet 768, phone 390 | Controls accessible; no overlap; markers do not move camera. |

Use two controlled identities and a third denied identity in disposable local PostgreSQL/browser tests. Supply SQL and rollback together. Captain applies migrations and decides deployment. Browser proof requires actual granted/simulated browser permission and two independently authorised sessions, not a unit-test mock alone.

`node docs/proof/friend-location-local-backend.mjs` starts the disposable PostgreSQL/PostgREST proof backend. Its loopback GoTrue fixture validates signed tokens for three separate seeded identities. This proves local route/store authority with a controlled authentication seam; it does not prove OAuth or production authentication. The ignored `artifacts/friend-location-proof/fixture.json` manifest has mode 0600. Stop the helper with SIGINT to remove its cluster.

## Release order

Finish active v0 integration and establish its final head. Add private store/migration and prove access/revocation. Add authenticated routes and foreground sharing client. Connect map controls/markers without changing venue cache ownership. Update privacy wording and permission matrix. Run repository gate, relevant security/SQL tests, responsive browser walkthrough and current-head review. Publish through the repository's no-mistakes gate. No production migration or deployment is authorised by this specification alone.

Before applying 0175 or enabling any external analytics or warehouse sync, keep `public.private_friend_location_sessions`, `public.private_friend_location_grants` and `public.private_friend_location_generations` excluded from exports. Browser masking and the analytics sanitiser do not protect database exports. This is a deployment requirement, not a claim that these tables exist in production or that a connector has been changed.

## Retention operations

`GET /api/cron/purge-friend-locations` checks the cron credential, then deletes expired and revoked sessions with cascading grant deletion. `vercel.json` schedules it every minute. Every read refuses expired points even if cleanup is delayed. Captain must apply 0175 and configure `CRON_SECRET` before release. No point history exists.
