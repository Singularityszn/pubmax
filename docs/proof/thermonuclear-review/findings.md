# Thermo-Nuclear Review Findings

Fixed point: `origin/main` at `d19b05cf8`.

Reviewed candidate heads:

- London v0 PR #1237 at `0a4ec594e`.
- Native at `c56ad7b46`.
- TfL D1 at `eeb663635`.
- Voice D2 at `a57b0c55d` and `9e51fc398`.

## Standards review

### Open

1. **P1: Mobile price publisher status is missing.** `components/PubMap.tsx` renders the selected Venue price and a freshness label in the mobile peek, but it does not name and link a known source or state that no publisher is recorded. Contributor attribution is also absent. `docs/VOICE.md` requires every price to show publisher status beside its figure. Test baseline with known source, baseline without source, contributor, and sourced-refresh lanes.
2. **P2: Out matching policy is duplicated.** `lib/out/venueMatch.ts` adds `heldVenueMatchesRow` beside the canonical resolver and scans the full Venue index for each row. Move by-ID lookup into the canonical resolver index and keep one matcher.
3. **P3: Locality generator has a weak executable seam.** `scripts/gen_london_localities.mjs` adds a one-line distance wrapper and changes direct-run failure behavior through `arguments.length`. Extract pure generator behavior from the executable entry point.

### Closed

- `VenueOverviewTab` no longer renders the broken sentence boundary `price. as of ...`.
- `ArrivalWelcome` now clears the phone Day/Tonight switch. The rendered `390 x 844` test proves separated geometry and centre-point hit ownership for both destinations.
- D2 voice rewrite has no safe selective port. Main contains stronger current voice law and evolved copy. The old branch includes misleading price and error copy.

## Spec review

### Open acceptance gaps

1. **London end-to-end proof is incomplete.** Two-browser host and guest completion, real persisted Pint Drop, moderation, Map authority, and exact release SHA proof remain required.
2. **Native store readiness is incomplete.** Simulator build, Android debug build, physical-device checks, London rebase, signed artefacts, and store upload are not complete. Toolchains, enrolment, signing data, and shared London checkpoint remain external blockers.

### Closed

- D1 TfL repeated fall-back-hour work is patch-equivalent to main commit `36f05dd05`. Current main preserves `serviceHour`, distinguishes `25:xx`, and has exact route regression coverage. Do not cherry-pick `eeb663635`.
- Native install name `PUBMAXXING` follows current `CONTEXT.md`. One stale plan line that says `PUBMAXX` must not override product terminology.
- Native browser-equivalent evidence now includes a README and four verified `390 x 844` PNG captures under `docs/proof/native-v0-browser/`. Measured Map client width and scroll width are both 390px, with every visible Map button at least 44px high. Codex browser could not inject the Capacitor bridge before page scripts, so this evidence does not claim native-runtime coverage. The clean Tonight capture was refreshed at `c56ad7b46` after the one-shot arrival greeting retired.

## Security and correctness review

### Open merge blockers

1. **P1: Repair rollback erases an earlier capability.** `20260827172414_align_one_tap_pint_drop_price_rollback.sql` drops `create_one_tap_price_pair`. Rolling back only the repair must restore the `20260827123131` function. It must not remove a still-applied prior migration. Test rollback behavior, then let the original rollback remove the function.
2. **P1: Mobile selected-price disclosure remains incomplete.** Freshness provenance is now correct, but publisher and contributor disclosure is not.

### Closed

- One-tap Supabase pairing now uses authoritative winning `v_price_pennies` for both rows.
- RPC writer now validates `price_id`, integer pennies, timestamp, and matching drop ID.
- Named RPC arguments and newer-existing-row parity have effective tests.
- Memory fallback now uses compare-and-restore rollback and covers failure plus equal concurrent writes.
- Mobile freshness helper now selects sourced observation time, contributor time when that price owns the figure, non-pub anchor time, or baseline dataset time.
- Legacy duplicate Plan memberships now fail before unique-index creation with deterministic reconciliation output. Effective proof keeps both legacy rows unchanged and confirms the index is absent.
- Signed-in Plan joins now create and claim one seat atomically for classic and collaboration invites. Current head also binds memory invite replays to the account, so a second account cannot receive the first account's member capability.
- No confirmed auth bypass, RLS exposure, or native iOS/Android security defect was found in reviewed diffs.

## Maintainability review

1. **P3: `ActivePlanMarker` owns too much.** It now performs auth mutation, durable claim retries, and timer orchestration. Extract a focused account-claim reconciliation hook or service with explicit outcome state.
2. No changed source file crossed the 1,000-line boundary. Existing very large owners remain a risk, especially `components/PubMap.tsx`, `lib/communityPriceStore.ts`, and `lib/planStore.ts`.

## Verification evidence

- `git diff --check` passed for London and native candidate diffs.
- Price-focused London repair suite passed at `3325c3446`: 6 files, 33 tests.
- Plan-focused London suite passed at `3325c3446`: 4 files, 17 tests with one worker. Targeted ESLint and three-dot diff validation passed.
- Native branch passed the latest focused suite at `eb25c04cf`: 8 files, 57 tests, plus targeted ESLint and diff validation. Browser-equivalent proof was added at `1e2a24c15`. It remains blocked from final compile and store proof by missing toolchains and shared release checkpoint.
- GitHub PR #1237 is open. Hosted checks show 3 passed, 13 failed before hosted execution, and 1 skipped. Human review remains required because Cursor Bugbot exhausted usage.

## Merge decision

Do not merge PR #1237 yet. Do not rebase native branch yet. Do not deploy or build signed native artefacts. Re-review exact replacement SHA after both remaining merge blockers are fixed and focused plus full available gates pass.
