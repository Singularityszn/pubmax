# App routes, pages and the request edge

Routes, pages, documents and the request edge: `app/`, `proxy.ts` and `next.config.mjs`. Repo-wide rules are in the root [AGENTS.md](../AGENTS.md).

## Traps

- **An API error is one envelope.** Every 4xx and 5xx JSON body from `app/api` goes through `publicApiError` in `lib/apiError.ts`. An unknown `/api` address answers the same envelope.
- **Every mutating route is rate limited.** It calls `isLimited`. A cron route authenticates with `assertCronRequest` in `lib/cronAuth.ts` instead.
- **A route stays thin.** Decode the input, call one store or service function, and map its errors to the envelope.
- **A file a route opens at runtime must ship with the function.** Keep a literal path at the filesystem call, or declare it in `outputFileTracingIncludes` in `next.config.mjs`.
- **The nonce exemption is two lists in `proxy.ts`.** Only `CDN_CACHED_DOCUMENT_PATHS` and `CDN_CACHED_DOCUMENT_ROUTES` skip the per-request nonce. Every other document keeps it.
- **A static asset never runs the proxy.** `lib/staticAssetPrefixes.mjs` is the one list of public folders the matcher skips.
- **The host redirect is for readers.** `proxy.ts` sends `*.vercel.app` to `pubmaxxing.com`, but never redirects `/api`, because the cron dispatcher does not follow redirects.
- **Auth.** A moderator page refuses the whole document. A password is created behind a session. An account leaves in two phases: the storage API removes the files, then the database trigger removes the rows.
- **Daily price cap:** see the [API contract](../docs/rules/app-api-contract-and-rate-limits.md#the-daily-price-cap-has-two-enforcers-and-it-is-a-route-s-rule-rather-than-the-t).
- **Pages show grounded evidence.** A landing or shared card shows only a figure it holds, with its source and its day.

## Detail

Read a detail file only for the rule you change. Each holds the full rules, pins and history:

- Auth and account routes: [`docs/rules/app-auth-and-account-routes.md`](../docs/rules/app-auth-and-account-routes.md)
- Landing, city and listing pages: [`docs/rules/app-landing-city-and-listing-pages.md`](../docs/rules/app-landing-city-and-listing-pages.md)
- API contract and rate limits: [`docs/rules/app-api-contract-and-rate-limits.md`](../docs/rules/app-api-contract-and-rate-limits.md)
- Proxy, CSP, caching and file tracing: [`docs/rules/app-proxy-csp-caching-and-file-tracing.md`](../docs/rules/app-proxy-csp-caching-and-file-tracing.md)
