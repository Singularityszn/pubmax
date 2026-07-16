# THE LOCAL Gate Z — local handoff

Date: 16 July 2026

Branch: `codex/pubmaxx-mobile-ui-reset`

Baseline: `9c1182a3616f2de691451e6b51af435ea25aad1f`

Nothing in this handoff has been pushed, deployed, or promoted. Production must use the exact reviewed Gate Z tip; Vercel `READY` by itself is not release verification.

## Local implementation slices

1. `953363f1` — mobile activation, shell/camera orchestration, always-plan confidence.
2. `51226745` — grounded route totals and confirmation-gated endings.
3. `6bda6ab4` — deterministic social expiry regression.
4. `0dd43e5b` — secure crew invites, roles, constraints, votes, proposals, host decisions.
5. `029c5e3d` — live-night continuity, private recap, and approved Story flow.
6. `5a1a316d` — six-companion Pal cast and owned memory controls.
7. `07494b3e` — reviewed signals, cross-tab continuity, and store consolidation.
8. The Gate Z evidence commit contains final browser migrations, performance warmup, route render prioritisation, screenshots, traces, and this handoff.

## Browser and visual evidence

- Mobile geometry: 320×568, 375×812, 390×844, and 430×932 in light and dark.
- London map: z10, z12, z14, and z16 in light and dark.
- Shell: one compact top bar, one contextual rail, one bottom dock, and one shared sheet.
- Journeys: map activation, route, evidence warnings, Pal cast, private recap, and WebGL fallback.
- Camera trace: one route intent, with no competing route animation.

Artifacts:

- `mobile-reset/` — refreshed width/theme/zoom matrix.
- `the-local-gate-z/activation-route-390x844-light.png`
- `the-local-gate-z/activation-route-390x844.webm`
- `the-local-gate-z/pal-cast-320x568-light.png`
- `the-local-gate-z/pal-cast-320x568.webm`
- `the-local-gate-z/private-recap-320x568-light.png`
- `the-local-gate-z/private-recap-320x568.webm`
- `the-local-gate-z/webgl-fallback-390x844-light.png`
- `the-local-gate-z/camera-intents.json`
- `the-local-gate-z/performance-lab.json`

## Verification record

- Mobile shell and theme matrix: 14/14 passed.
- Mobile Playwright: 70/70 passed across the complete serial run and deterministic focused rerun.
- WebGL map and console health: 6/6 passed with SwiftShader.
- WebGL-disabled fallback: 1/1 passed.
- Journey/accessibility evidence rerun: 7/7 passed.
- Gate Z route, Pal, and recap evidence: 3/3 passed.
- Gate Z route, Pal, and recap interaction recordings: captured from the passing production-build runs.
- Full `npm run verify`: passed — 314 files, 2,921 tests, 74.74% statement coverage, 0 high-severity audit findings.
- Isolated `NEXT_DIST_DIR=.next-prod` production build: passed; the existing image-proxy NFT trace remains a warning only.

The performance artifact is an isolated local production-build lab, not production field p95 telemetry. It records LCP, CLS, interaction duration, cached useful pins, warm navigation, and visible route readiness using browser-side timestamps. The strict lab spec only runs when `PUBMAX_GATE_Z_PERF=1` so normal functional runs do not confuse unrelated host load with a deterministic regression. The final uncontended production-build sample passed every budget: 1,180 ms LCP, 0.0008 CLS, 104 ms interaction, 69 ms cached useful pins, 30 ms warm navigation, and 230.5 ms visible route readiness.

## Known risks and intentional boundaries

- The repository retains existing non-blocking complexity/lint warnings; Gate Z introduces no new lint errors.
- Turbopack reports the existing NFT trace warning for the image-proxy host loader. The build completes successfully.
- The Night Signal contract, validator, and scheduler are live, but the bundled reviewed snapshot remains empty until claims pass provenance and review rules.
- Supabase migrations `0034` and `0035` must be applied and verified in the target environment before production collaboration and continuity smoke tests.
- Local performance is release evidence, not a substitute for production RUM and p95 monitoring.
- Google and Microsoft identity remain explicitly deferred.
- The final spec audit classifies scheduled upstream signal acquisition, complete live-evidence scoring, late-food breadth, and metric aggregation as partial. They must not be represented as complete in release notes.

## Required external approvals

- Fable contract review before Wave 1: not evidenced in this repository.
- Fable activation/HUD evidence review: pending against this pack.
- Fable six-companion character-sheet approval: pending against `docs/PUB_PAL_CHARACTER_SHEETS_2026-07-16.md`.
- Fable final Gate Z review: pending.

These are explicit approval gates. No local commit, screenshot, or automated test substitutes for the named reviewer.

## Exact-commit production verification

After Karan approves the final exact commit:

1. Confirm the branch tip and clean tree; push that exact SHA without rewriting history.
2. Apply and verify Supabase migrations `0034` and `0035`.
3. Confirm required production secrets, including `RATE_LIMIT_SALT` and the optional dedicated `PLAN_IDEMPOTENCY_SECRET`.
4. Deploy and promote the exact SHA to production in Vercel.
5. Verify both `https://pubmaxxing.com` and `https://www.pubmaxxing.com` resolve to that deployment.
6. Smoke Landing → Map → Describe → three-stop route → invite/join → proposal/host decision → live actions → ending → private Memory → approved Story → You.
7. Verify Near me never prompts before interaction, route confidence never invents unknown evidence, and the camera trace contains at most one active animation.
8. Verify invite expiry/revocation/replay handling, guest mutation denial, Pal memory correction/export/delete/disable, Night Signal API freshness, WebGL fallback, and both themes.
9. Check production RUM against LCP <2.5 s, CLS <0.1, INP <200 ms, cached useful pubs <1.5 s p95, warm navigation <100 ms, and route readiness <1.5 s p95.
