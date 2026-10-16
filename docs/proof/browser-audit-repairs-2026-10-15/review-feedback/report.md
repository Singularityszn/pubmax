# Planner review repairs, 15 October 2026

This round addresses review-1, review-3 and root-plan-feedback above starting HEAD `ce1cf48fcceb418d30c3a34e71fb585422f92f57`.

Before correction, executable API requests reproduced the independent-clause refusals and ignored structured limits. All 14 initial regression cases failed. Cross-clause steak budgets returned 200. Independently priced pints with later pizza returned 422. Accepted structured limits did not constrain the route.

The correction limits meal-price ownership to the relevant clause. A comma alone does not create a priced drink-and-food bundle. Explicit coordinated bundles still receive the meal limitation. Each query and foodNeeds field is parsed independently. Generation combines the typed amounts and retains the strictest pint ceiling and route total. Existing canonical evidence checks still filter candidates before selection.

The focused API tests check refused requests before paid consumption, retained context totals, candidate filtering, returned stops, alternatives and impossible-budget failures. Successful requests use enough canonical price evidence. The existing historical regressions remain enabled.

The generation failure path now requests the existing reveal effect. It focuses the populated error after the Tune sheet closes. The duplicate route status is empty. An empty route status is never revealed by this effect. Lock-form validation uses its existing focus path.

The before screenshots below come from a fresh production build of unchanged starting-HEAD source in this worktree. They reproduce a viewport ratio of zero for the meal limitation at 1440x1000 and 390x844. The after screenshots come from the rebuilt modified source listed below. They show the actual populated limitation after Make a plan, without scrolling after submission.

| Viewport | Before | After |
| --- | --- | --- |
| Desktop, 1440x1000 | [Before](desktop-before.png) | [After](desktop-after.png) |
| Phone, 390x844 | [Before](phone-before.png) | [After](phone-after.png) |

Earlier screenshots in the parent directory retain their original historical provenance. This round does not replace or relabel them.

Validation completed:

- `node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts __tests__/planRouteReveal.test.ts`: 303 tests passed across two files.
- The production build completed with `DEPLOYMENT_VERSION=local`, `NEXT_PUBLIC_SW_VERSION=local`, `NEXT_DIST_DIR=.next-review-feedback` and `PUBMAX_E2E_KEYLESS=1`. It ran through both restored-output wrappers.
- `PW_PORT=38473 PW_SKIP_WEBSERVER=1 PW_SKIP_KEYLESS_WEBSERVER=1 node_modules/.bin/playwright test --config artifacts/review-feedback/playwright.config.ts`: all eight focused browser tests passed.
- Installed Chrome ran `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` through a temporary configuration importing this worktree's Playwright configuration. It used private port 38473 and worktree-local outputs.
- Browser checks cover desktop and phone, reduced and ordinary motion, initial Sort it, repeated Make a plan, failed Tune-sheet regeneration, one populated alert, an empty duplicate status, error focus, and Escape focus restoration.
- `git diff --check` reported no whitespace errors.

The private server was stopped after verification. Full repository verification, pipeline Test and Lint, CI, external review and published-head acceptance remain with the outer executor. This local proof does not establish provider, authenticated Pub Pal or physical-device acceptance. No provider settings, migration, merge, deployment or publication changed.

The following SHA-256 values identify the modified source used by this local verification.

| File | SHA-256 |
| --- | --- |
| `lib/planGeneration.server.ts` | `dc9d4c9b2d3f11fc486cce41945d163cdf59b1e1617df4140c79ef4039678be4` |
| `lib/planPriceLimits.ts` | `6d5266f6404c11cfb9c3b1aae1ef3fe098329eec8d4627a6cf0572db9ac4027c` |
| `components/plan/PlanComposer.tsx` | `fb8b2831b27c551b9f6b82920b3ba4251b50aa72ac6f1d436243607080055f35` |
| `__tests__/planGenerateRoute.test.ts` | `c6673358b5c5472177647feaa58b35ddb50b2418201b4f004f6ebeea5a9f4391` |
| `__tests__/planRouteReveal.test.ts` | `56cdf14b19878c0183640762430fe5ec833f461dbfae1c6e3aa3af365cd1182a` |
| `e2e/plan-generation-feedback.spec.ts` | `e71eb6efdf9146966db9f6290fa3cb1ae9607033a82b1bfca3be6245097b0048` |
