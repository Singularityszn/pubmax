// Test-environment isolation.
//
// `npm run ci` executes vitest inside Vercel's build pipeline, where the
// platform exports deployment env vars (VERCEL_ENV=production on Production
// builds, =preview on Previews). The unit tests are not a deployment: letting
// VERCEL_ENV leak into the test process makes environment guards
// (lib/serverEnv.ts isDeployedProduction, lib/supabase.ts
// requiresSupabaseStore) treat the test run as a live production runtime —
// keyless route tests then 503 and the Production build fails, while Preview
// builds pass. First seen on the first Production build after #272.
//
// Production builds also expose the server-side Supabase credentials. Unit
// route tests must not spend the shared production rate-limit budget (or
// become order-dependent when two Vercel projects build concurrently), so the
// test baseline strips those credentials as well. Integration tests that need
// a durable client provide explicit stub credentials in their own setup.
//
// Deleting these vars here keeps the production guards at full strength in
// real runtimes while tests exercise the documented keyless (memory-store)
// behaviour. Tests that assert guard behaviour stub the relevant variables
// explicitly via vi.stubEnv and are unaffected.
delete process.env.VERCEL_ENV;
delete process.env.VERCEL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

// Same trap, different flag: the Production Vercel project sets
// NEXT_PUBLIC_DEMO_CONTENT=off, and `npm run ci` runs vitest inside that
// build. Seed-behaviour tests (demoPintDropsForCity and friends) assume the
// documented default (demo content ON), so letting the deployment flag leak
// in turns them red on Production builds only — Previews (no flag) stay
// green. First seen when the flag was set on Production after #395.
//
// Strip it here so the test baseline is the documented default regardless of
// ambient env. Tests that assert the off behaviour stub the flag explicitly
// (see __tests__/demoContent.test.ts) and are unaffected.
delete process.env.NEXT_PUBLIC_DEMO_CONTENT;

// Same trap again for the cron freshness plane (#485): the Vercel build env
// carries real provider keys (EXA_API_KEY on Production), and the cron route
// tests assert the documented keyless default (skip + warn). Letting ambient
// keys leak in turns those tests red only inside Vercel builds. Strip every
// ingest/event provider key; tests that assert key-present behaviour stub
// them explicitly via vi.stubEnv and are unaffected.
delete process.env.EXA_API_KEY;
delete process.env.FIRECRAWL_API_KEY;
delete process.env.TICKETMASTER_API_KEY;
delete process.env.SKIDDLE_API_KEY;

// Same trap for the road-route plane: the walk-route provider (lib/walkRouteProvider.ts)
// routes crawl legs through OpenRouteService when ORS_API_KEY is present. The
// provider + route tests assert the documented keyless default (return null →
// straight-line fallback). A leaked Production key would flip them to the
// key-present path only inside Vercel builds. Key-present behaviour is proven
// with an explicit apiKey / vi.stubEnv.
delete process.env.ORS_API_KEY;
