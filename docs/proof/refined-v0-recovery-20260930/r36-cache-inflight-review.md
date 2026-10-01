# R36 surface-cache in-flight identity review

Status: SOURCE REVIEW ONLY. No tests, browser, server, build, install, database access or network requests executed for this review. Production and tests unchanged. Every proposed check below is UNRUN. Current integration source includes the account-bound transport work in `lib/authedFetch.ts`; this review does not propose edits to that separate owner’s AuthProvider/API changes.

## Finding: clearing does not retire outstanding cache reads

The existing contract says the whole surface store leaves with an account (`lib/surfaceDataCache.ts:20`). The same-tab identity listener clears memory and the session-storage namespace (`:226`), and exported `clearSurfaceCache` does the same (`:277`). Neither clears or marks obsolete the separate `inFlight` map (`:311`).

An existing same-key request remains joinable after either clear (`:406`). Its first caller’s `init`, transport and validator still shape that shared read (`:436`). On completion, `loadSurfaceJson` checks only its caller’s abort signal and validator (`:386`), calls `apply`, then caches unless `apply` explicitly returns `false` (`:397`). The request carries no identity generation, and `writeSurfaceSnapshot` has no boundary check (`:264`). Therefore a live pre-boundary caller can repopulate both memory and session storage after clearing, and a post-boundary same-key caller can join that old request. This contradicts the stated cache lifetime even without demonstrating private disclosure.

The per-entry equality checks in completion and release are useful safeguards (`:420`, `:431`): an old entry cannot delete a different replacement entry. Keep these in any repair. The current implementation simply never creates that replacement on a boundary. Validation and session-storage size/age bounds remain independent safeguards, not account ownership checks.

One related callback detail matters: silently rejecting an answer with `return;` still permits caching. Only `return false` prevents the network write. This is relevant to the revision guard in `app/u/[handle]/ProfilePageClient.tsx:824`, but does not itself prove a stale answer wins the abort/cleanup race.

## Reachable authenticated reads and safeguards

### Cover-photo editor

`components/profile/ProfileCoverPhotosEditor.tsx:88` keys its read by `/api/profiles/<handle>/covers`, without an account revision in the key. Its effect depends only on that URL (`:137`), uses `loadSurfaceJson` with `authedActionFetch(..., { requiresIdentity: true })` (`:111`), and aborts its own controller on cleanup (`:132`). Its callback also refuses UI updates once inactive (`:123`).

The GET is genuinely owner-only: `lib/profileCoverPhotoRoute.server.ts:138` authenticates the handle action, requires a caller user ID (`:142`), then compares it with the profile owner (`:157`). The response is `jsonNoStore` (`:244`) and returns approved cover IDs, positions and public serve URLs, never storage keys (`:170`). HTTP no-store does not disable this separate application snapshot cache. Approved profile-image public serving is intentional (`lib/profileImageServe.server.ts:3`); an owner-only listing is not evidence that all image bytes are secret.

Current transport protects more than the cache helper itself. `lib/authedFetch.ts:186` binds strict actions to the provider account signal and revision. Native fetch receives that composite signal (`:331`), and the native Response retains it through body consumption (`:332`). `lib/authProviderRevision.ts:93` aborts the prior account controller when provider identity changes. In normal Supabase updates, `components/auth/AuthProvider.tsx:397` changes provider identity before it emits the device/cache boundary (`:405`) and before the session state update (`:423`). A delayed native response body should therefore abort before normal account-switch clearing completes.

The actual parent also gates editing on the canonical viewer owning the route handle (`app/u/[handle]/ProfilePageClient.tsx:894`, `:1272`). Switching to a different account normally removes the old editor, triggering its caller abort; opening the new owner’s profile uses a different cover URL. A straightforward A-cover-to-B-editor journey is not established by this source review. Do not force B to own A’s handle through a fixture and call that product proof.

One narrower interval needs a real regression: after a native body has already decoded, but before its cache continuation applies/writes, provider-signal abortion alone is not a post-decode identity check. The cache’s own controller is distinct from the provider composite signal. Cover reads use `authedActionFetch`, which returns the native Response (`lib/authedFetch.ts:354`), rather than `authedActionJson`, whose post-decode signal/revision checks explicitly close that interval (`:402`). Whether the real editor cleanup wins this interval is not proved here.

### Profile card and follow projection

`app/u/[handle]/ProfilePageClient.tsx:776` is the other identified bearer-bearing cached read. Its key includes the viewer handle (`:781`, `:811`); bearer auth supplies the actual server authority (`:795`, `:814`). It uses plain fetch, its own controller, captured account revision, a revision guard in `apply` (`:824`), and abort cleanup on an effect that depends on account revision (`:878`).

The server derives private-card entitlement from authenticated identity, never the self-asserted `?viewer` parameter (`lib/profileVisibilityBoundary.server.ts:37`, `:49`). Different canonical viewer handles normally produce distinct keys, and account changes reset the profile state. A late old-key snapshot could violate cache lifetime if it passes the timing window, but direct delivery of a private A projection to B is not established. The callback’s revision-only early return would not prevent a cache write unless it returns `false`; normal caller abortion remains a separate guard.

### Public reads and cross-tab ordering

Other inspected cache consumers use public reads. For example, `components/profile/ContributionLanesCard.tsx:199` caches public lane stats; its authenticated `/api/price-impact` read is separate (`:222`) and that prefix is denied by the cache. Public profile-card, people-list, venue, weather and transit reads must not be relabelled private solely because their components also import auth helpers.

The identity subscription also reacts to relevant cross-tab storage changes (`lib/deviceAccountIdentity.ts:177`, `:182`). It does not itself advance the provider account controller. Thus cache clearing and provider cancellation need not be atomic for that signal. Actual browser ordering remains unmeasured. Public readers can remain mounted through an identity change, making blanket cancellation or suppression a product regression risk even when their late response contains no private data.

## Existing proof stops short of this schedule

- `__tests__/surfaceDataCache.test.ts:95` and `:340` prove already-held memory/persistent snapshots are cleared. Cross-tab coverage at `:369` also starts from held entries, not pending responses.
- `__tests__/surfaceReadDedupe.test.ts:39` proves same-boundary joining. Its clear/re-read case (`:67`) clears after the first read has settled. Its one-joiner-aborts case (`:88`) protects the remaining public reader.
- `__tests__/authedFetch.test.ts:456` covers a deferred native response body aborted by provider change. Its parsed-body account-switch test (`:476`) uses `authedActionJson`, not the cover editor/cache combination.
- The painted-read fence deliberately includes the cover editor (`__tests__/surfaceReadFence.test.ts:93`). Removing it from the cache without addressing that contract is not an approved bypass.

No outstanding-read boundary or real cover-editor account-switch test was executed during this review.

## Small deterministic regression design, UNRUN

Extend the existing cache/dedupe tests using explicit deferred-fetch entry and completion barriers, rather than fixed numbers of microtasks:

1. Begin a live same-key read, wait until fetch has entered, then dispatch the real device-identity event. Verify memory and persisted namespace empty at the boundary.
2. Start a new same-key read after that event. Require its own fetch instead of joining the pre-boundary request. Resolve the old request and require its answer not to recreate either snapshot. Resolve the new request and require the new snapshot survives the old entry’s completion/release.
3. Cover exported `clearSurfaceCache` and a relevant cross-tab storage event, retaining the unrelated-storage-event safeguard. Preserve existing within-boundary single fetch, one-joiner abortion, retry, validation, maximum age and storage-size behavior.
4. Separately exercise the parsed-body interval with the real account-revision store and native Response/body behavior. Include real cover component cleanup and the profile revision rejection path. An injected fetch or provider fixture can prove those local contracts; it cannot prove real SDK sign-in/account switching.
5. Keep a public-reader control: changing identity must not silently blank or strand a still-mounted weather/venue surface. Decide callback behavior from that evidence, rather than blindly suppressing every old public answer.

## Native proof boundary, UNRUN

Reuse the existing account-switch UI and profile-editor controls. `e2e/account-switch-identity.spec.ts:20` explicitly says the keyless fixture doubles provider sessions and owner reads. Report that authority honestly. For a stronger local proof, hold an actual authorized local owner GET response unchanged, switch accounts through native account controls, reopen the new owner’s editor, then release the old response. Capture request cancellation, identity-event order, actual visible cover identity and only sanitized snapshot contents. Do not record tokens or capability values.

Require an authorized local ownership fixture before relying on a real owner-only GET; do not invent a successful owner response through route fulfilment and label it server proof. Different owners’ handles should remain different. A same-owner logout/re-entry control can exercise same-key joining across revisions, but is not cross-account disclosure. If no real same-key private journey is reachable, retain the helper contract finding without upgrading it to a user-visible leak.

## Bounded next action

Run the deterministic boundary regression first under Core’s next runtime grant. If RED confirms this schedule, put one invalidation generation in the existing cache owner, retire old join lookup on both identity events and explicit clearing, and prevent obsolete reads from repopulating memory/session storage. Keep existing entry-identity cleanup and per-joiner cancellation. No new cache framework, transport delay or auth startup change is justified.

Aborting transport alone is insufficient as a post-decode ownership check. Conversely, silently discarding every public callback can strand mounted surfaces. Settle that distinction in focused controls, then reproduce any suspected private journey before claiming or fixing disclosure. PR1880 transport protections and owner UI guards must remain intact.
