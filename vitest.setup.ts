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
