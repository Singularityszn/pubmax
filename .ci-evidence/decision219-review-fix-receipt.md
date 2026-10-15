# Decision219 review fix receipt

CURRENT GRANT219

The actor read both actual files before setup or source changes. Their SHA256 values match the supplied expectations.

| Actual instruction path | SHA256 |
| --- | --- |
| /Users/karanmanoharan/karan-agent-workspace/data/resume-20261015/decision219-review-input-and-preparation-instructions.txt | 6891e60e202dc68caf93d6373b4a92488f47a87619f5eb9b8b72783f94997194 |
| /Users/karanmanoharan/karan-agent-workspace/data/resume-20261015/decision218-joint-review-instructions.txt | 0ce9165739821cbf3c4bf4347669783b5616ba803c48b85543748ef05069c701 |

Both files remain unchanged. The actor read the literal CURRENT GRANT218 in the prior file. This receipt records a new assigned FIX under CURRENT GRANT219. It does not replace the prior failed attempt.

The starting HEAD was 45041f053cb3e425b9ad35e3e31aaa4fb16b0afe. The starting worktree was clean. This actor changed no refs or commits. It used only the assigned worktree. It did not enter another pipeline phase, invoke a pipeline control command, or inspect another checkout or the bare gate repository.

## Finding disposition and invariant

R1 remains visible and accepted under the original supervisor's semantic clarification. Its invariant is that original refs, original commit IDs, run custody, and inherited task patches remain preserved. This applies to the original PR2094 and PR2093 runs, their caller and Native copies, and the separately authorised candidate's patch continuity. The current candidate lacks exact e9c4778dddd5e740ac2cbe16386b618d41cdc3e2 ancestry. Decisions218 and219 accept the installed normal-base replay onto Main599252af3019f3776b5d78d297fae2d871fbd87f for this candidate. They report 85 equal range-diff rows. This actor did not independently reproduce that mapping or modify original refs. No fictitious ancestry repair was applied.

R2 and review-1 are one legitimate request-lifecycle ownership defect with a coverage gap. Their invariant is that every issued grant remains available for exactly one conversation-ID release, without connecting a cancelled attempt or changing another attempt. It applies to Cancel, the shared stop action, End, unmount, writing navigation, startup timeout, pending headers, pending JSON, controller cancellation, late cleanup, retry isolation, and ordinary success/error cleanup.

The old finalizer aborted the pending transport. Before headers, this discarded the issued response. During JSON parsing, releaseRequired became true before conversationId was known, so cleanup could latch a release without its ID. The old deferred mock ignored abort.

The correction removes the attempt's transport AbortController, its initialization, signal, and abort call. Local controller cancellation remains prompt. The grant parser sets releaseRequired only when JSON parsing settles. It records the conversation ID synchronously before control returns to controller cleanup. The existing controller already waits for grant settlement before invoking onCancelled, so lib/pubPalVoiceSession.ts needs no change.

## Reproduction and focused verification

The repository .no-mistakes.yaml config specifies npm ci --prefer-offline. The repository .npmrc sets ignore-scripts=true. The actor read the existing install-script allowlist and did not change it. PATH supplied Node v26.10.0 and npm 12.2.0. The exact configured dependency command ran once and exited 0. It added 728 packages. Tracked source remained clean after setup. The exact output is in decision219-dependency-setup.txt. Its audit reported five high severity vulnerabilities. No audit fix, dependency change, global configuration change, or setup retry occurred.

The mounted tests use the existing component and controller. The local network boundary follows a real Request signal and uses a streamed Response. Both pending headers and pending body reads reject AbortError when that signal aborts. The framework-link boundary executes onNavigate when the writing link is clicked. No provider, token, account, audio, quota, or customer operation ran.

The final pre-fix reproduction command was:

```sh
node node_modules/vitest/vitest.mjs run __tests__/pubPalVoice.test.tsx --maxWorkers=1 -t 'pending grant'
```

It exited 1 on unchanged product code. Ten cases failed and four passed. The other 27 cases were excluded by the explicit test-name filter, not skipped in source. Before headers, all four cancellation actions lost the ID release. During body parsing, all four actions released before parsing settled. Both retry cases failed the expected conversation-ID release. The two abort-boundary self-checks and two refused-grant cases passed. An earlier reproduction also identified an incomplete link mock. The actor corrected that mock before the final pre-fix run. Both runs failed before any product correction. decision219-voice-red.txt retains the final exact output. decision219-red-tests.patch retains the exact reproduction test diff.

Before correction, the component SHA256 was ce35f0b757d6aef72d31f0b1c77e39f5770a84a4925509bd36c9fee852415267. The unchanged controller SHA256 was 357aa58254b9994e1052e8272794283376157135c0ab14e2f8a215f0ebc2a928. The final reproduction test SHA256 was b1c8724ee8de18b848a1a7549af20f1eb59bfe4b35318f16108a791af69fb3b1.

After all source corrections, the actor traced each cancellation route through stop or unmount, finalizeSession, issueGrant, controller settlement, and onCancelled. Pending cancellation returns without latching release. A late successful parse records its ID and releases once without connecting. Retry cleanup keeps its own attempt and ID. Normal startup still reaches connect, onConnect, tool-turn sync, End, cap, disconnect, and error cleanup. Parsed refusal and failed transport do not invent a grant. Malformed successful JSON retains the existing uncertain-grant cleanup. Microphone denial still issues no grant. The removed AbortController has no remaining references. No helper, parameter, or branch became unreachable.

The focused post-fix command was:

```sh
node node_modules/vitest/vitest.mjs run __tests__/pubPalVoice.test.tsx __tests__/pubPalVoiceSession.test.ts __tests__/pubPalVoiceSdkRetry.test.tsx --maxWorkers=1
```

It exited 0. All 49 tests passed across three files. This includes the real installed React SDK startup/retry coverage. The new matrix covers Cancel, unmount, writing, timeout, pending headers/body, refused grants, and a later connected retry. The retry's visible End control releases its own ID after the cancelled attempt releases its ID. decision219-voice-green.txt retains the exact output.

The focused lint command was:

```sh
node node_modules/eslint/bin/eslint.js components/pubpal/PubPalVoiceSession.tsx __tests__/pubPalVoice.test.tsx
```

It exited 0 with no output. decision219-voice-lint.txt is the empty exact output. git diff --check also passed. No complete repository test or lint suite ran. decision219-voice-fix.patch retains the tested source and test diff. The corrected component SHA256 is e86ea9f68a58a58f13485e661430abbd8e9b8fba8a93468797c2a5371f3c311d.

## Capacity, release, and remaining acceptance

Before dependency setup, memory_pressure reported 70 percent free of 36 GiB, or 25.2 GiB. A 2 GiB focused forecast leaves 23.2 GiB, above the 9 GiB floor. df reported 66919828 KiB available. Before focused reproduction, the same memory percentage and 65738696 KiB disk remained. Before final focused verification, memory_pressure reported 68 percent, or 24.48 GiB. The focused forecast leaves 22.48 GiB. Disk availability was 65734668 KiB, above the 3 GiB floor even after the 16 GiB family forecast.

All dependency, Vitest, and lint processes started by this actor exited. The actor started no server, port listener, PostgreSQL cluster, agent, controller, or recurring job. There is no live owned process family to release. Worktree-local dependencies remain available for the outer executor. This is no claim of whole-host quiet or formal performance proof.

This receipt proves only the assigned FIX and focused working-tree verification. HEAD remains the starting commit until the outer executor records these changes. No later committed-head, configured full, Test, publication, CI, private-production, or final-published-head acceptance is claimed. No ensuing consumer readback has occurred in this actor's phase. The ensuing verifier and private acceptance owner must actually read the Decision219 input and grant evidence. The same-owner Decision217 final-published-head acceptance remains separate.

The seven mounted consent cases, geometry16, complexity ceiling35, and inherited product assertions remain unchanged. The exact New Inn vegan AND underGBP10 AND publisher-below500-kcal conjunction and Eagle three-scoop positive remain required. This transport fix does not establish those results. Conversation-ID continuity beyond these disposable lifecycle fixtures remains subject to its assigned acceptance.

All eight external cases, binding191/privacy, Profile original-account/physical/signing/Mail, Doc208 redaction, formal performance, native, historical201 authority, and review/CI/release holds remain. The coordinator retains report ownership. No merge, closure, deployment, migration, live binding probe, or external operation occurred. This receipt does not approve any later gate.
