# R39: Night Signal feed cache regression preparation

Added two focused, **UNRUN** cases to `__tests__/nightSignalFeedApproved.test.ts`:

1. A keyless in-memory approved claim appears before expiry, then disappears when fake system time reaches its exact `expiresAt`. Both direct `GET` responses must carry `Cache-Control: no-store`.
2. A pending claim is absent, the real memory store approves it with `operations` authority, and the next same-process `GET` includes it. Both responses must carry `Cache-Control: no-store`.

The test setup stubs only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VERCEL_ENV`, and `PUBMAX_E2E_KEYLESS` so the existing real memory store is selected without inspecting environment values or secret files. Each case asserts the state transition before checking exact `Cache-Control: no-store`, so a future RED first shows whether feed contents changed. The existing historical cache-window test remains unchanged. It expects `s-maxage=300` for the keyless branch and will conflict with the new no-store expectations when run. Keep that conflict visible until the focused RED is observed and the intended contract is reviewed; no GREEN claim is made here.

Source inspection shows `GET` combines the deployment snapshot with `nightSignalCandidateStore().approved(Date.now())`, but selects `jsonCached` whenever `nightSignalStoreIsDurable()` is false. The new cases encode the intended mutable-feed boundary; their expected RED is inferred from that source, not observed by execution. They invoke the handler directly and inspect response headers. They do not exercise a CDN, prove cache replay, or establish deployed behavior.

Future focused command, **UNRUN**:

```sh
./node_modules/.bin/vitest run __tests__/nightSignalFeedApproved.test.ts
```

Test source SHA-256: `3c0ff73951e4afa205ba61cbe0e1671a55e4bf27f250555955916e601cd37aca`.
