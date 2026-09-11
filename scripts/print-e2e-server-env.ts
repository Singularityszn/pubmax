/**
 * The E2E server environment, printed as JSON, read from the ONE place that
 * owns it.
 *
 * `playwright.config.ts` decides what a production build measured by this suite
 * is built and served with: the keyless stores, the fake but correctly shaped
 * Supabase and PostHog values, the pinned service-worker version. The
 * interleaved A/B (scripts/perf-ab.mjs) has to build the MERGE BASE with the
 * identical environment, because two builds made with two environments are two
 * different products and the difference would arrive wearing the branch's name.
 *
 * So it is read rather than copied. A second hand-written list is a second
 * build waiting to drift.
 */
import config from "../playwright.config";

const servers = Array.isArray(config.webServer)
  ? config.webServer
  : config.webServer
    ? [config.webServer]
    : [];

process.stdout.write(JSON.stringify(servers[0]?.env ?? {}));
