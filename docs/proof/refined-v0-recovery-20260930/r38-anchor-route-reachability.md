# R38: planning-anchor route reachability

## Finding

Issue #1809's “zero callers” claim is accurate only for first-party HTTP callers in this repository. A source search in current Core and main `f33f77e42b8a045695529ec87f2ed1b6ed4cb719` found no in-repository request to `/api/plans/anchor` in `app/`, `components/`, `lib/`, `public/`, `e2e/`, or `scripts/`. Matches outside the route are its tests, route-tracing coverage, API contract, and documentation. This does not establish whether an external client calls it; no request telemetry or external consumer inventory was reviewed.

## Contract and related use

- `app/api/plans/anchor/route.ts` documents a read-only canonical display projection. It resolves city, venue, area, and budget, returns a no-store response, and rate-limits the endpoint. The route blob in `f33f77e` has SHA-256 `fcd60e11e8b1dff613940fcb98e5a12bf6c91447b4b77c6cc608bed54d3c0b1c`.
- `docs/API_CONTRACTS_THE_LOCAL.md` section “Plan anchor” records a keyless `GET /api/plans/anchor` contract, `plan-anchor` rate limit (60 per 60 seconds, hashed per client), and flat public error envelope. In current Core this section is near line 625; in `f33f77e` it is near line 628.
- `__tests__/planAnchorRoute.test.ts` imports and exercises the route directly, including conflicts and rate limiting. `__tests__/venueIndexTracing.test.ts` includes it in route-tracing coverage. These establish owned contract coverage, not a production HTTP caller.
- `lib/planGeneration.server.ts` calls `resolvePlanningAnchor` directly for anchored generation (around lines 49 and 118). The resolver therefore has a known first-party use; this is not evidence that the HTTP route is fetched by the app.
- `docs/evidence/cold-start-bundle.md` records historical direct curl requests and measured output. It says the experimental flag was retired while the endpoint remained reachable and rate-limited. That history demonstrates a documented external-style interface, not present-day live traffic.

## Classification and next step

Classify the endpoint as **no known first-party HTTP caller, but an explicit public contract with external use unknown**. Do not label it simply unused or remove it from the issue based on repository search alone. Before deletion, the contract owner should decide whether to retire the keyless endpoint and check available deployment access telemetry or known external consumers. If retirement is authorized, update the API contract, route tests, tracing coverage, and historical/current route documentation together. Keep direct resolver use in plan generation intact unless separately reviewed.

This was a source-only review. No runtime, tests, build, deployment, or external-traffic check was performed.
