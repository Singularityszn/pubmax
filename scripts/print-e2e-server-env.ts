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

const env = servers[0]?.env;

// AN EMPTY ENVIRONMENT IS REFUSED RATHER THAN PRINTED. `{}` would build the
// merge base with none of the keyless, Supabase-shaped or pinned service-worker
// values the branch build was given, which is the very drift this file exists
// to stop, and the difference would arrive wearing the branch's name.
// PW_SKIP_WEBSERVER=1 in the calling shell is the way to get here.
if (!env || Object.keys(env).length === 0) {
  throw new Error(
    "playwright.config.ts declared no web server environment to read, so the merge base " +
      "cannot be built with the environment the branch was built with. PW_SKIP_WEBSERVER " +
      "removes that declaration: run the A/B without it.",
  );
}

process.stdout.write(JSON.stringify(env));
