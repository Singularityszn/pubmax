# Paid request-cap warnings

Base: 184eabedd59f91f399f458e8413577a936f263a1
Branch: agent/request-cap-warnings-1020

## Before

At 14:48:27 on 2026-10-20, the new executable public-seam test ran before the implementation.

Command: `npx vitest run __tests__/paidSpendWarnings.test.ts`

Result: exit 1, one test failed. At 8 admitted requests from a 10-request budget, the webhook output was `[]`. The expected output contained `ask: 8/10 requests in the rolling 24-hour window (80% warning, 2 requests remaining)`.

## After

Command: `npx vitest run __tests__/paidSpendWarnings.test.ts __tests__/paidSpendBudget.test.ts __tests__/rateLimit.test.ts __tests__/alertSink.test.ts __tests__/rateLimitFailOpen.test.ts`

Result at 14:53:21: exit 0, five files passed, 61 tests passed, 982 ms. This includes 19 warning tests.

Command: `npx vitest run __tests__/rateLimitRefusalsUnchargedMigrationEffective.test.ts`

Result at 14:50:35: exit 0, six tests passed, 2.66 s. The new real PostgreSQL proof admitted one warning claim and refused eleven concurrent claims. The next threshold used a separate claim. An expired cooldown admitted another claim.

Command: `npx vitest run __tests__/paidSpendWarnings.test.ts __tests__/paidSpendBudget.test.ts __tests__/rateLimit.test.ts __tests__/alertSink.test.ts __tests__/rateLimitFailOpen.test.ts __tests__/pubPalVoiceTokenRoute.test.ts __tests__/anonymousPaidRoutes.test.ts __tests__/planGenerateRoute.test.ts`

Result at 14:51:31: exit 0, eight files passed, 15637 tests passed, 102.72 s. The final focused run above includes the later monitoring-read and webhook-failure cases.

Command: `npx eslint lib/paidSpendBudget.ts lib/paidSpendBudget.server.ts lib/supabase.ts __tests__/paidSpendWarnings.test.ts __tests__/rateLimitRefusalsUnchargedMigrationEffective.test.ts`

Result: exit 0.

Command: `npm run typecheck`

Result: exit 0. Next.js generated route types and TypeScript reported no errors.

Command: `git diff --check`

Result: exit 0.

## Limits

These are request-cap warnings. They contain no dollar estimate.

Monitoring reads the durable timestamp row. It never substitutes an instance-local usage count or cooldown claim. It runs without delaying the admission response. Read failures, claim failures, missing webhook configuration and webhook failures do not change request admission. Existing fail-closed budget enforcement remains in place.

The highest reached 80% or 90% threshold warns while a request remains. Thresholds round up to a whole request. Each lane and threshold uses the existing durable RPC for a 15-minute cooldown. The existing alert sink applies its process cooldown, hourly cap and timeout.

Warnings are best effort. A burst can exhaust the cap before the asynchronous read observes remaining capacity. The existing exhausted-budget alert remains active. Atomic threshold-crossing receipts would require a change to the existing deployed boolean RPC contract.

No new migrations, live schema changes, real alerts, paid provider requests, environment changes, deployments, pushes or PR creation occurred. The PostgreSQL proof applied existing migrations only to a disposable local cluster.

Fresh npm ci installed 731 packages. It reported five high-severity dependency advisories in the unchanged dependency tree. Dependencies were not changed.

The parent owns the final combined verify gate and publication.

## Existing production prerequisite

A read-only production check on 20 October 2026 confirmed migration
`0181_rate_limit_refusals_uncharged`, recorded as version `20261017221918`.
The live `public.check_rate_limit(text, integer, integer)` definition also matches
its admitted-only behavior. A refused claim retains the pruned hit array and
keeps `expires_at` unchanged. The check read only metadata and the function definition.
It did not call the limiter, alter a row, or send an alert.
