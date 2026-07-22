# Fable handoff ledger: personalization Waves A and B

Status: **implemented in integration; fixed-point review and full gate pending**

Baseline: `origin/main@a3fde784` on 2026-07-22
Release roles: Karan owns product rulings; Fable owns architecture review, green-gate review, merge order, and rollout verdict.

## Scope and ownership

Wave A makes the existing `/today` brief respond deterministically to already-available preference context. It may personalize existing composition, ordering, or presentation through a new pure resolver. It does not add a preference-capture flow, a data source, an account write, or an ungrounded recommendation. Wave B adds only a pure Surprise Drink resolver and its focused tests; UI wiring is explicitly deferred.

| Lane | Exact ownership | Branch / worktree |
| --- | --- | --- |
| Wave A: Personalized Today | `lib/todayPersonalization.ts`, `__tests__/todayPersonalization.test.ts`, minimum wiring in `app/today/page.tsx`, `app/today/TodayClient.tsx`, the area-specific weather option in `lib/todayBrief.ts`, and its existing focused test | `codex/wave-personalized-today-20260722` / `.codex-worktrees/wave-personalized-today` |
| Wave B: Surprise Drink | `lib/surpriseDrink.ts` and `__tests__/surpriseDrink.test.ts` only. No UI wiring. | `codex/wave-surprise-drink-20260722` / `.codex-worktrees/wave-surprise-drink` |
| Integration / handoff | This ledger and later conflict review only after both lane SHAs and touched-file manifests exist. This ledger commit contains no product code. | `codex/wave-personalization-integration-20260722` / `.codex-worktrees/wave-personalization-integration` |

All three local branches started at the same baseline and tracked `origin/main`; no lane-specific commit, remote lane ref, or PR number was locally available when this ledger was opened.

## Overlap exclusions

Personalized Today must not edit any existing file outside its declared manifest. Explicit exclusions are:

- `app/today/today.css` and all other existing `/today` cards/helpers;
- PlanComposer, auth, generation, account-hub, or preference-capture surfaces;
- PubMap, `usePersonaTonight`, mobile nav, shared nav, or other active map files;
- Tonight, check-ins, plan-page, and Cursor-owned files, including `app/tonight/TonightClient.tsx`;
- Fable-owned landing, metadata, and walk-route lanes;
- Wave B files `lib/surpriseDrink.ts` and `__tests__/surpriseDrink.test.ts`; Wave A has no ownership there.

If either lane needs an excluded file, stop and return the proposed file plus reason to Fable. Do not broaden ownership implicitly during rebase or conflict resolution.

## Acceptance criteria

- The resolver is pure and deterministic: explicit inputs in, decision out; no React, fetch, storage, ambient clock, randomness, or mutation.
- Resolver inputs, precedence, tie-breaking, and output effect are named in code and pinned by tests. Unsupported, absent, or corrupt preference context produces the current baseline `/today` behaviour exactly.
- Personalization uses only existing grounded content. It preserves source labels, freshness/staleness language, honest empty states, the current pick cap, and existing remembered-area continuity.
- No new API route, migration, secret, analytics identifier, auth dependency, or durable write is introduced. Any such need is a scope change requiring a new ruling.
- Existing Today contracts remain green, including `todayBrief`, patch continuity, Today area/pints, quiet-pint, deals-digest, and weather read-through coverage.
- Keyboard and screen-reader semantics remain intact; both themes are visually checked at 390x844 and desktop width with reduced motion enabled once.
- `npm run verify` and the Vercel gate pass on the integrated SHA. Production rollout waits for Fable's diff review and visual verdict.
- Wave B changes exactly `lib/surpriseDrink.ts` and `__tests__/surpriseDrink.test.ts`; it has no component, page, style, route, or other UI integration.

## Test and review evidence

Fill every field before merge; `TBD` is not release evidence.

| Lane | Commit / PR | Touched-file manifest | Focused tests | `npm run verify` | Visual / live evidence | Fable verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Wave A: Personalized Today | lane `155a2769`; integrated `671437f3` | `lib/todayPersonalization.ts`; `__tests__/todayPersonalization.test.ts`; `app/today/page.tsx`; `app/today/TodayClient.tsx`; `lib/todayBrief.ts`; `__tests__/todayBrief.test.ts` | 78/78 across six Today/profile/intake files; typecheck passed; lane lint passed with 37 pre-existing warnings and no errors | Integration gate pending | Browser evidence pending after review | Pending |
| Wave B: Surprise Drink | lane `7ca77b74`; integrated `649c4439` | `lib/surpriseDrink.ts`; `__tests__/surpriseDrink.test.ts` | 33/33 across Surprise + persona datasets; typecheck passed; lane lint passed with 37 pre-existing warnings and no errors | Integration gate pending | Not applicable until a separately approved UI wave | Pending |
| Integrated Waves A and B | current `649c4439` | Nine files including this ledger; feature manifests are disjoint | Focused integration rerun pending | Pending | 390x844 light/dark, desktop light/dark, reduced motion: pending for Wave A | Pending |

## Rollout

1. Freeze each wave at a reviewed SHA and attach `git diff --name-only <baseline>...<sha>` to this ledger or the PR.
2. Fable compares both manifests before choosing merge order. A shared product file is a coordination event, not an automatic conflict resolution.
3. Rebase each lane on the then-current `origin/main`, rerun focused tests and `npm run verify`, then run the integrated gate. Use `NEXT_DIST_DIR=.next-prod` for production QA if a dev server is active elsewhere.
4. Ship without new environment or data activation. Check the baseline/no-preference path first, then one supported preference path, browser-console hydration errors, provenance, empty states, and both themes.
5. Record the deployed SHA and live-check result in the evidence table. Do not call the wave complete while any field remains `TBD`.

## Rollback

- Keep Waves A and B as separate squash commits so either can be reverted independently.
- For a personalization regression, revert its merge commit or remove only the resolver wiring; the no-preference path must immediately return to the pre-wave ordering and content.
- For a Surprise Drink regression, revert only Wave B; its two-file boundary contains no UI or persisted-state cleanup.
- No database or account cleanup should be needed. If implementation creates persisted state, migrations, or new external dependencies, stop rollout because the accepted scope has changed.

## Evidence inspected

- `AGENTS.md` and the current `FABLE_HANDOFF.md`, including Fable's reviewer/merger protocol, current Cursor ownership exclusions, and the 2026-07-22 close-out through #548.
- `docs/SOL_SYNC_2026-07-22.md`, including active file-collision rules and the recorded Cursor/Fable lane boundaries.
- Local refs, worktree registry, branch tracking, and history for the integration branch plus Waves A and B at `a3fde784`; no lane-specific local or remote PR evidence existed at ledger creation.
- Existing Today lineage: #414 morning brief, #429 remembered-area ordering, #527 deal diversity, #528 Tube/pints modules, #533 quiet-pint module, and #540 weather read-through.
