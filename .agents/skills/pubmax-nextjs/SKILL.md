---
name: pubmax-nextjs
description: PubMaxxing's own Next.js 16 conventions. Use when adding or changing a route handler, page, layout, proxy rule, CSP, caching or file tracing in this repo (app/, proxy.ts, next.config.mjs). Read before writing App Router code here, because this Next.js version differs from training data.
---

# Next.js in PubMaxxing

This skill points at the files that own each rule. The rule text lives there, not here. Read the owner before you change code in that area.

## First reads

- `app/AGENTS.md` indexes every route rule. Its detail files are under `docs/rules/app-*.md`.
- This is Next.js 16 with React 19. APIs and file names differ from older versions. Read the guide in `node_modules/next/dist/docs/` before you use an API you are not sure of.
- The request edge is `proxy.ts`. There is no `middleware.ts`.

## Route handlers

Copy the shape of a small existing route, such as `app/api/night-memories/route.ts`:

1. Rate limit a mutating handler first. Use `isLimited` from `lib/pintDrops.ts` with a key built from `hashIp(clientIp(request))`.
2. Resolve the caller with `callerUserId` or `callerAuthIdentity` from `lib/authServer.ts`. They read the bearer JWT and fail closed to `null`.
3. Answer success with `jsonNoStore` or `jsonCached` from `lib/apiResponses.ts`.
4. Answer every 4xx and 5xx with `publicApiError` from `lib/apiError.ts`. Do not invent an error shape.

A cron route authenticates with `assertCronRequest` (`lib/cronAuth.ts`) instead of a limiter. `__tests__/theLocalErrorContract.test.ts` fails a route that emits its own error shape or mutates without a limit.

Most handlers that touch Node APIs or Supabase set `export const runtime = "nodejs"`.

## Server and client code

- A module that must never reach the browser starts with `import "server-only";`. Many such modules use a `.server.ts` suffix.
- Server secrets are read only in server modules. Browser code reads `NEXT_PUBLIC_*` values only.
- Import with the `@/` alias, as the rest of the tree does.

## Documents, CSP and caching

- `proxy.ts` sets a per-request CSP nonce. `CDN_CACHED_DOCUMENT_PATHS` names the only documents that skip it, and each one must be `force-static`. See `docs/rules/app-proxy-csp-caching-and-file-tracing.md`.
- A prerendered document may read nothing per request and carry nothing personal.

## Files a route opens at runtime

Next traces only paths it can see statically. If a route builds a file path at request time, declare the file in `next.config.mjs` `outputFileTracingIncludes`. Derive that list from its registry (`lib/venueIndexTracing.mjs`, `lib/cityVenuePacks.mjs`). `__tests__/venueIndexTracing.test.ts` fails an undeclared reader.

## Budgets

Route and API ceilings live in `perf/AGENTS.md` and `lib/apiBudgets.mjs`. A ceiling only comes down. Raising one needs a measured figure in the same commit.

## Local runs

- `npm run dev` works with no secrets.
- `next dev`, `next build` and `next typegen` rewrite `next-env.d.ts`. The file is ignored, so it never needs a checkout before you commit.
- For a production build beside a running dev server, use `NEXT_DIST_DIR=.next-prod`.
- Drive the app in a browser as `e2e/AGENTS.md` describes.

## Proof

`npm run verify` is the merge bar. Run the route's own tests with `npx vitest run __tests__/<name>.test.ts` while you work.
