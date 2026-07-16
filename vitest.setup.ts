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
// Deleting the platform vars here keeps the production guards at full
// strength in real runtimes while tests exercise the documented keyless
// (memory-store) behaviour. Tests that assert guard behaviour stub VERCEL_ENV
// explicitly via vi.stubEnv and are unaffected.
delete process.env.VERCEL_ENV;
delete process.env.VERCEL;
