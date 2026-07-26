# AGENTS.md

## Cursor Cloud specific instructions

PubMaxing is a single Next.js 16 (App Router, React 19, TypeScript) web app — a price-aware London pub-crawl planner with a MapLibre 3-D map. There is one service.

- **Runs keyless.** `npm run dev` (Next dev on webpack, http://localhost:3000) works with no secrets: Pint Drops use an in-memory store and `/api/heritage` (The Landlord) returns grounded structured-only answers. Supabase / `OPENROUTER_API_KEY` in `.env.local` are only needed to exercise durable persistence, browser auth, admin moderation, and narrated heritage replies — not required to run or demo the app. See `.env.example`.
- **Standard commands** live in `package.json` scripts and `README.md`: `npm run dev`, `npm run lint`, `npm run typecheck`, `npm test` (Vitest), `npm run verify` (validate-data · lint · typecheck · coverage — the pre-push gate), `npm run ci` (verify + build).
- **`npm run test:e2e`** (Playwright) needs browsers installed first: `npx playwright install --with-deps chromium`. The e2e config builds and starts the app itself.
- **Pre-push hook** (`.githooks/pre-push`) runs `npm run verify` but is only active after `npm run setup` (sets `core.hooksPath=.githooks`); it is not enabled by default in a fresh clone.
- **Map density is a contract, not a styling choice.** The pin/cluster zoom boundaries, supercluster radius, and the symbol-collision policy that stops labels and pins ever overlapping are the constants at the top of `components/map/canvas/buildScene.ts` (and the layers below them), asserted in `__tests__/mapSymbolCollision.test.ts`. Change them there, and keep every app symbol layer inside MapLibre's collision index.
- **Do not commit tooling churn.** `next dev` rewrites `next-env.d.ts`'s route-types import to the dev path (`./.next/dev/types/routes.d.ts`) and `npm install-scripts approve` adds an `allowScripts` block to `package.json`. Both are local artifacts of running the app, not changes: `git checkout --` them before committing.
- **Shared-worktree build gotcha:** a concurrent `next dev` and `next build` can clobber `.next` mid-build and leave `BUILD_ID` missing (the `prestart` guard will refuse to `next start`). For isolated production QA, build/serve with `NEXT_DIST_DIR=.next-prod` so it doesn't collide with a running dev server.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
