# R36 pending-read boundary regressions

Status: SOURCE PREPARED, UNRUN. No production changes or runtime verification. Tests, builds, browser/server, database, installs and Git publication remain held for the runtime owner's handoff. Project `.agents/skills/tdd/SKILL.md` read; the required failing-before run must happen before any production fix.

Changed files only:

- `__tests__/surfaceReadDedupe.test.ts`: extend its existing deferred fetch with an explicit request-entered barrier; add seven behavioral cases in the boundary group starting at line 132. Existing within-boundary joining, per-joiner abort and CityMCP ownership assertions remain intact.
- This proof note.

The local browser fixture supplies an EventTarget and session Storage, matching the existing cache unit suite's Node idiom. Each case settles all requests in `finally`, clears its held namespace, and restores its stubbed browser. No real account/provider/server claim is made by a cover-shaped key and a deferred native Response.

## Prepared schedules

Three actual invalidation paths are exercised: same-tab `DEVICE_IDENTITY_CHANGED_EVENT`, exported `clearSurfaceCache`, and cross-tab `storage` carrying the real `DEVICE_ACCOUNT_OWNER_KEY`. The event test does not rely on a missing/null key being treated as a clear.

1. **Delayed write, three cases** (`surfaceReadDedupe.test.ts:171`): wait for the earlier fetch to enter; seed and verify a held/persisted control; cross the boundary and verify both tiers empty; release the earlier response. Require no reconstructed memory or session-storage snapshot and no readable old answer.
2. **Join/finalizer ownership, three cases** (`:201`): keep the earlier fetch pending; cross the boundary; start a new same-key read and require its own fetch to begin while the old one is still held. Settle the old read and require no snapshot recreation. Join a third reader to the still-pending new request, then release it. Require one new fetch, both current callbacks receiving the current body, no unexpected third fetch, and the current snapshot in both tiers. This protects the new entry against an obsolete completion/release deleting it.
3. **Still-mounted public reader** (`:254`): a public what's-on reader remains live through the same-tab identity boundary. Its actual pending response must still apply once and finish as `network`, without storing the pre-boundary result. A blanket abort/drop fix would strand this mounted reader and fail this control. This does not make the old response account authority; it is a public listing response.

Request arrival uses the deferred fetch's entry promise, and response order uses explicit release barriers. The bounded `vi.waitFor` checks the observable new-fetch invocation; there are no finite microtask counts used to approximate that arrival. The third reader is started before releasing the current fetch, preserving joining while it is pending. Existing two-turn waits in the older tests were not changed.

## Expected current failures, not executed results

Current `lib/surfaceDataCache.ts` clears only stored snapshots, not pending requests. Source therefore predicts:

- Three delayed-write cases recreate one old memory/persistent entry after release instead of leaving both tiers empty.
- Three join cases see zero current-fetch calls because the new reader joins the old request. Cleanup releases both barriers even when this assertion fails.
- The public callback still receives its network body, but its old snapshot is incorrectly stored, so the public control's cache-empty assertion fails.

These are seven **expected** failures, not a RED receipt. They prove the helper boundary contract if executed; they do not prove another real account can view owner-only cover data. Current transport cancellation, owner UI unmount, viewer-specific keys and decoded-body timing are analysed separately in [the source review](r36-cache-inflight-review.md).

Source review found no obvious fixture/settlement race. The cover-shaped cases use a no-op callback and therefore make no assertion that a private response cannot reach a mounted reader. Their contract is request lookup and snapshot lifetime. The public control deliberately retains its callback. Private caller cancellation and the post-decode ownership interval need their own reachable reproduction before claiming a privacy repair.

## Next execution, only after handoff

Focused failing-before command from the integration root:

```sh
npm test -- __tests__/surfaceReadDedupe.test.ts
```

Record the actual assertion failures before considering the bounded production repair. Nearby validation after an authorised fix should include `surfaceDataCache.test.ts`, authenticated native-body/revision tests, real cover-editor cancellation/ownership tests and mounted public-reader behavior. No generation implementation, private caller change or auth timing change is included here.
