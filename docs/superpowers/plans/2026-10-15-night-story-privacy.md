# Night Story profile-clear privacy implementation plan

> For agentic workers: execute this plan serially with test-driven development. Preserve all existing checkouts and unfinished work.

**Goal:** Clearing a profile removes its former display names from public Night Story titles, summaries and surviving captions.

**Architecture:** Keep the existing emission-time redaction. A service-only profile-clear RPC captures names for affected Stories, withdraws contributions and clears the owned profile in one transaction. A private per-Story table supplies the existing public-read redaction step. Shared memory-only Story relation state gives the demo backend the same synchronous operation without circular store imports.

**Tech stack:** Next.js, TypeScript, Vitest, PostgreSQL 16.

**Spec:** User request in this chat, `lib/storyRedaction.ts` public privacy contract, `docs/agents/build-methodology.md`, and area AGENTS files. Scope is profile clearing, not full auth-account deletion.

## Constraints

- Fresh branch from current main. Preserve old work and recovery data.
- Serial validation, one Vitest worker and one PostgreSQL cluster where supported. Check memory between commands. No production database changes or deployment.
- Keep write-time ownership checks and existing profile-clear response outcomes. Refusal writes nothing.
- No departed names in public contributor or profile responses. Source Moments remain private and unchanged.
- Missing migration refuses clear; public redaction lookup failure stays unavailable.
- Names persist only for affected Stories and leave when Story or auth account is deleted. Repeated clears preserve earlier names.
- Required local verify and no-mistakes gate before PR. No direct origin push.

## Review focus

- Already-withdrawn contributor or consent owner retains redaction after profile clearing.
- Repeated clears with a new name preserve both names without affecting another Story.
- Wrong caller and a failed snapshot write leave profile and contributions whole.
- Private name rows cannot be read or written by browser roles.
- Public Story and recap share redaction; private source Moments remain unchanged.

## Task 1: Reproduce and repair profile-clear redaction

Files: `__tests__/profileDeleteRedaction.test.ts`, `__tests__/storyRedaction.test.ts`, `__tests__/profileImageReportRace.test.ts`, `lib/profileStore.ts`, `lib/nightMemoryStore.ts`, `lib/storyRedaction.ts`, new `lib/nightStoryMemory.ts`, profile DELETE route, migration 0178 plus rollback, effective PostgreSQL proof and suite inventory.

- [x] Run existing focused tests before edits. Expected: pass.
- [x] Extend route test with bare name in caption plus title and summary. Test already-withdrawn and repeated-clear cases. Expected before fix: former name remains.
- [x] Add effective database proof of service-only rows, atomic owned clear, refusal, rollback and Story/account cascade. Expected before migration: function absent.
- [x] Implement `clear_profile_for_caller(p_handle text, p_caller_user_id uuid) returns setof public.profiles`. No fallback to unsafe clear. Keep image cleanup in route.
- [x] Capture names in `private_story_redaction_names(story_id, account_id, display_name)`. Read only through current server-side redaction step; add optional `displayNames` to its internal departed input.
- [x] Run route, policy and database tests. Expected: all pass, including source ownership and failure cases.
- [x] Generate database types with repository generator. Update privacy disclosure and effective permission matrix.

## Task 2: Verify and publish

- [x] Review scoped diff independently, fix material findings with regression proof.
- [ ] Run required checks serially with resource samples. Record failures and limits honestly.
- [ ] Commit scoped changes. Run no-mistakes with full user intent, preserve its branch custody, and follow its publication gate.
- [ ] Open and attach PR only after required checks pass. Complete required PR review. Do not merge or deploy.

## Progress

Baseline: 2 focused files, 10 tests passed with 512 MiB Node heap and one worker.

Independent review: fixed acceptance interleaving using UPDATE RETURNING in one CTE. Regression observed one withdrawn row without a name before repair, zero after. Populated image-state proof added. Full auth-delete redaction remains outside this profile-clear repair.

Local verification: verify:no-mistakes passed, 22,049 coverage tests and 574 PostgreSQL tests. Later completeness guard reproduced RED then GREEN; final related run passed 268 tests and TypeScript. Final-head publication gate still pending. Original primary file/symlink preservation: 492 compared hashes unchanged, one previously deleted path has no blob.

Gate review repair retained in commit 4f56810b: contribution acceptance and consent writes lock the same profile row. Follow-up consent-only regression failed before repair, then passed in both stores. Final focused database and DELETE integration: 20 tests passed. Final-head gate remains pending.

Further review: preserve d4783b3b re-entry repair. Pending invitations and handle-only identities now retain redaction. Memory removes owned publication entries like SQL. RED: six failures; GREEN: all 25 focused tests pass. Public-read acceptance is requests begun after successful DELETE; overlapping old snapshots cannot be recalled. Final gate must use manual finding decisions.
