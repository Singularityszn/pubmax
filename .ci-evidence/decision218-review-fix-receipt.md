# Decision218 review fix receipt

CURRENT GRANT218

The actor read the Decision218 text supplied in the review prompt. The absolute instruction-file path was absent. The actor requested that path. No instruction-file SHA256 or file readback is claimed.

The starting HEAD was de9f147f12972653c0fcbdd0db2a177fcd257e86. The starting worktree was clean. No source, history, refs, pipeline, provider, account, or device changes occurred.

R1 is accepted under the supplied Decision218 disposition. The candidate uses the normal Main base, 599252af3019f3776b5d78d297fae2d871fbd87f. Exact ancestry from e9c4778dddd5e740ac2cbe16386b618d41cdc3e2 is not claimed. Decision218 reports 85 equal range-diff rows and zero changed, dropped, or added task patches. This phase did not independently reproduce that mapping or inspect other checkouts. The original refs and runs remain outside this actor's mutation scope. No candidate delivery prose claiming exact e9 ancestry was found in the inspected worktree text.

R2 is legitimate on source inspection and remains unresolved. Its invariant is: every issued grant response must remain available to its cancelled attempt for exactly one release, without connecting or changing another attempt. This invariant applies to Cancel, stop, writing navigation, unmount, startup timeout, pending response headers, pending response JSON, controller cancellation, and late cleanup. Successful startup and ordinary error cleanup must retain their existing behavior.

The defect is local request-lifecycle ownership. finalizeSession aborts requestAbort before issueGrant can observe response.ok and conversationId. A real aborted fetch rejects, so releaseRequired can remain false. The existing deferred-response test does not reject on abort and therefore misses this sequence. The smallest proposed correction removes local cancellation of the pending grant transport while retaining controller cancellation and attempt ownership checks. No product correction was applied because the mandatory pre-fix reproduction could not run.

Read-only checks found no node_modules directory and no vitest executable on PATH. Node and npm are available. The repository config assigns npm ci --prefer-offline to the preparation phase. The user assigns other phases to the outer executor and requires stopping when a necessary tool is unavailable. This actor did not install dependencies, search the host, or execute another phase.

No tests ran. There is no RED/GREEN result. The seven mounted consent cases, geometry16, complexity ceiling35, inherited assertions, and acceptance requirements were not changed. Configured full validation, Test, publication, CI, final-head acceptance, and all external release requirements remain unproven by this phase. No ensuing consumer readback is claimed.

Before the blocked focused run, memory_pressure reported 69 percent free, equivalent to 24.84 GiB of 36 GiB. A 2 GiB focused forecast would leave 22.84 GiB, above the 9 GiB floor. df reported 67010688 KiB available, approximately 63.91 GiB. No heavy process, server, port, PostgreSQL resource, agent, controller, or recurring job was started. This actor has no owned process family to release. These observations do not establish whole-host quiet or performance proof.
