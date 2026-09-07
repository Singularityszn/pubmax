// WHICH DEPLOYMENT AN EVENT CAME FROM, AND WHICH BUILD.
//
// PostHog held one project for every environment and the two transports did not
// agree on how to tell them apart. The browser SDK stamps `$host`, so SDK web
// vitals and pageviews could be filtered by hostname. Named product events take
// the other road (trackEvent -> POST /api/events -> lib/posthogServer.ts), where
// the server calls the capture endpoint directly and no host is sent at all, so
// every one of them landed in the missing-$host bucket: `plan_created`,
// `plan_saved`, `plan_invite_opened`, `meaningful_core_action` and
// `near_answer_ready` among them. A preview journey, a local one and a browser
// test run were therefore indistinguishable from a drinker's real night, and no
// figure could name the build it was measured on.
//
// This module is the ONE rule for both. It gives every event two dimensions,
// `environment` and `release`, so ONE filter works across both transports, and
// a `schema_version` so old rows are read as what they are rather than
// reinterpreted.
//
// `$host` is deliberately NOT added to a named event. A preview host is
// generated per deployment, so it is high cardinality and names a machine
// rather than a lane; `environment` is the filter every dashboard uses, and
// docs/analytics/METRICS.md says so.
//
// Plain ESM with a .d.mts sidecar (the lib/buildInfo.mjs idiom), because
// next.config.mjs cannot import TypeScript and it is the build that knows the
// answer: VERCEL_ENV reaches no browser bundle, so the environment is decided
// once, at build time, and inlined for both sides to read.

import { normalizeCommitSha } from "./buildInfo.mjs";

/**
 * The closed set of lanes an event may claim. Four words, one meaning each.
 *
 * - `production`  the deployment drinkers use.
 * - `preview`     a deployment built for review, including a production-values
 *                 preview. It is a real deployment, so it is never `internal-test`.
 * - `development` a build no platform named: a laptop, a self-hosted build, a
 *                 unit-test process. Never a guess at production.
 * - `internal-test` our own automated browser suite, which drives real journeys
 *                 with an inert public token.
 */
export const ANALYTICS_ENVIRONMENTS = Object.freeze([
  "production",
  "preview",
  "development",
  "internal-test",
]);

/**
 * The version of the event envelope, not of any one event's props.
 *
 * 1 is every row written before this module: no `environment`, no `release` and
 * no `schema_version` of its own. A v1 row states nothing about where it came
 * from, so a query may not read it as production; it is read as unattributed
 * and reported separately. Raise this only when the envelope changes again, and
 * never rewrite what an older version meant.
 */
export const ANALYTICS_SCHEMA_VERSION = 2;

/** The environment a build gets when nothing named one. */
export const DEFAULT_ANALYTICS_ENVIRONMENT = "development";

/** How many characters of a commit a release stamp carries. */
export const ANALYTICS_RELEASE_LENGTH = 7;

/**
 * The three words the Vercel platform uses, mapped to ours. A table rather than
 * a set membership test, so an unexpected platform value is absence and never a
 * fifth lane invented by an environment variable.
 */
const VERCEL_ENVIRONMENTS = Object.freeze({
  production: "production",
  preview: "preview",
  development: "development",
});

/** True only for a word this module wrote. */
export function isAnalyticsEnvironment(value) {
  return typeof value === "string" && ANALYTICS_ENVIRONMENTS.includes(value);
}

/**
 * Which lane this build belongs to. The order is the rule.
 *
 * 1. The answer a build already decided and inlined, so the browser and the
 *    server read one value rather than two opinions. A build OUR OWN SUITE
 *    MADE is already that answer: it sets NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT so
 *    its inert token reaches the real transport, and playwright.config.ts puts
 *    `npm run build` inside the same `env` block, so `internal-test` is inlined
 *    into the bundle it drives and nothing about that lane changes.
 *    IT IS A CLAIM ABOUT THE BUILD, NOT ABOUT THE RUN: the browser transport
 *    reads a value inlined at BUILD time, so a suite pointed at a PREBUILT
 *    preview (PW_SKIP_WEBSERVER=1, BASE=...) stamps that preview's own lane on
 *    every $pageview, whatever the runner's environment says. Only the server
 *    transport, which reads the environment per request, could be told
 *    otherwise, and rule 2 is the one thing it may not be told.
 * 2. The platform's word for a PRODUCTION deployment, which no escape may
 *    overrule. `currentAnalyticsAttribution` reads the live `process.env` on the
 *    server, so a bare runtime read of the browser-suite variable would relabel
 *    every real drinker event `internal-test` and empty every production figure,
 *    silently. The production check therefore comes above the escape, the same
 *    ordering lib/supabase's store guard follows.
 * 3. Our own browser suite, for a run whose build inlined nothing.
 * 4. The platform's own word for any other deployment.
 * 5. `development`, because a build nobody named is a local one.
 */
export function resolveAnalyticsEnvironment(env = {}) {
  const inlined = env.PUBMAX_ANALYTICS_ENVIRONMENT;
  if (isAnalyticsEnvironment(inlined)) return inlined;

  const platform = typeof env.VERCEL_ENV === "string"
    ? VERCEL_ENVIRONMENTS[env.VERCEL_ENV.trim()]
    : undefined;
  if (platform === "production") return platform;

  if (env.NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT === "1") return "internal-test";

  if (platform) return platform;

  return DEFAULT_ANALYTICS_ENVIRONMENT;
}

/**
 * The build a figure was measured on, as a short commit. The commit itself is
 * lib/buildInfo.mjs's answer, so there is one rule for what a sha is and a
 * release can never name a commit /api/version would not.
 *
 * A build that cannot name its own commit carries no release rather than a
 * placeholder: "unknown" would group every unstamped build into one release.
 */
export function normalizeAnalyticsRelease(value) {
  const sha = normalizeCommitSha(value);
  return sha ? sha.slice(0, ANALYTICS_RELEASE_LENGTH) : null;
}

/**
 * The attribution read back out of the environment a build inlined it into.
 * Both fields are normalized here too, so a hand-set variable cannot make an
 * event claim a lane or a commit that is not one.
 */
export function readAnalyticsAttribution(env = {}) {
  return {
    environment: resolveAnalyticsEnvironment(env),
    release: normalizeAnalyticsRelease(env.PUBMAX_BUILD_COMMIT_SHA),
  };
}

/**
 * The properties every event carries, whichever transport sent it. `release` is
 * omitted rather than null when the build could not name its commit, because an
 * absent property and an unknown one read the same way in a query and a null
 * would need its own rule.
 */
export function analyticsAttributionProps(attribution) {
  return {
    environment: attribution.environment,
    ...(attribution.release ? { release: attribution.release } : {}),
    schema_version: ANALYTICS_SCHEMA_VERSION,
  };
}

/**
 * What next.config.mjs inlines. One name, because the release is derived from
 * the commit the build stamp already carries and two names for one commit could
 * disagree.
 */
export function analyticsBuildEnv(env = {}) {
  return { PUBMAX_ANALYTICS_ENVIRONMENT: resolveAnalyticsEnvironment(env) };
}

/**
 * This running build's own attribution. Each name is read as a STATIC member
 * expression, because that is the form Next replaces with the build-time
 * literal; a variable key would read an empty object in the browser.
 */
export function currentAnalyticsAttribution() {
  return readAnalyticsAttribution({
    NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: process.env.NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT,
    PUBMAX_ANALYTICS_ENVIRONMENT: process.env.PUBMAX_ANALYTICS_ENVIRONMENT,
    VERCEL_ENV: process.env.VERCEL_ENV,
    PUBMAX_BUILD_COMMIT_SHA: process.env.PUBMAX_BUILD_COMMIT_SHA,
  });
}

/** This running build's attribution, ready to spread into an event's props. */
export function currentAnalyticsAttributionProps() {
  return analyticsAttributionProps(currentAnalyticsAttribution());
}
