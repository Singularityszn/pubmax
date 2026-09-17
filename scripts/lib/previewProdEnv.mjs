// WHAT A PRODUCTION-ENVIRONMENT PREVIEW MAY CARRY, and what it may not.
//
// A verification preview is only honest if it was built with the values
// production is built with. `vercel pull --environment=production` is the one
// read-only way to get them, and MEASURED 5 September 2026 against the live
// project it answers three kinds of line, which this module keeps apart:
//
//  1. A real value. Forwarded to the deploy as build AND runtime environment,
//     because a NEXT_PUBLIC_* value is inlined at build time and read again at
//     runtime, and one half of that pair is worse than neither.
//  2. `[SENSITIVE]`. Vercel refuses to hand back a secret-typed variable and
//     writes that literal instead. 30 of 59 came back this way, six of them
//     NEXT_PUBLIC_*, and a build that forwards the placeholder INLINES IT: the
//     verifier's own preview shipped NEXT_PUBLIC_SUPABASE_URL="[SENSITIVE]" to
//     every browser, so nobody could sign in, and NEXT_PUBLIC_DEMO_CONTENT
//     ="[SENSITIVE]" read as "not off" and put demo rows on the landing page.
//     A placeholder is therefore DROPPED and NAMED, never forwarded.
//  3. A platform-owned variable. Vercel writes VERCEL_ENV, VERCEL_URL, the
//     VERCEL_GIT_* set and its own OIDC token into that file, and forwarding
//     them tells a preview it is production: `proxy.ts` and `app/robots.ts`
//     both key indexability on VERCEL_ENV === "production", so a forwarded copy
//     would publish an indexable duplicate of the whole site. Dropped, always,
//     whatever the value.
//
// The names it drops are the whole of the difference between this and the
// production environment, so the command PRINTS them: a preview that cannot
// carry a value falls back to the project's own Preview environment for it, and
// a verifier has to know which half of the answer they are reading.

/** Variable name prefixes the platform owns and a deploy may never restate. */
const PLATFORM_OWNED_PREFIXES = Object.freeze(["VERCEL_", "TURBO_", "NX_"]);

/** Exact platform-owned names that carry no prefix of their own. */
const PLATFORM_OWNED_NAMES = Object.freeze(["VERCEL", "CI"]);

/** What `vercel pull` writes where a secret-typed value would be. */
const SENSITIVE_PLACEHOLDER = "[SENSITIVE]";

/** Deploy flags this command refuses, with the reason each is refused. */
export const REFUSED_DEPLOY_FLAGS = Object.freeze({
  "--prod": "this command only ever makes a PREVIEW; promote separately.",
  "--production":
    "this command only ever makes a PREVIEW; promote separately.",
  "--prebuilt":
    "a macOS build ships darwin-only sharp binaries and a whole-project trace " +
    "the upload cannot satisfy; the build belongs in the cloud.",
});

export function isPlatformOwnedName(name) {
  if (PLATFORM_OWNED_NAMES.includes(name)) return true;
  return PLATFORM_OWNED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Parse a pulled `.vercel/.env.*.local` file. It is written by the CLI, so the
 * shape is narrow: `NAME="value"` lines, comments and blanks. A line this
 * cannot read is skipped rather than guessed at.
 */
export function parsePulledEnvFile(contents) {
  const entries = [];
  for (const rawLine of String(contents ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const name = line.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = line.slice(equals + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }
    entries.push([name, value]);
  }
  return entries;
}

/**
 * The three groups, decided once. `forwarded` is what the deploy carries;
 * `sensitive` and `platform` are what it reports it could not.
 */
export function classifyPulledEnv(contents) {
  const forwarded = [];
  const sensitive = [];
  const platform = [];
  for (const [name, value] of parsePulledEnvFile(contents)) {
    if (isPlatformOwnedName(name)) platform.push(name);
    else if (value === SENSITIVE_PLACEHOLDER) sensitive.push(name);
    else forwarded.push([name, value]);
  }
  return { forwarded, sensitive: sensitive.sort(), platform: platform.sort() };
}

/**
 * The flags that carry a forwarded value onto the deploy. Each goes to BOTH
 * environments: `-b` is read while Next inlines NEXT_PUBLIC_* into the client
 * bundle, `-e` is read by the running function.
 */
export function deployEnvFlags(forwarded) {
  return forwarded.flatMap(([name, value]) => [
    "--build-env",
    `${name}=${value}`,
    "--env",
    `${name}=${value}`,
  ]);
}

/** The refusal for a forbidden flag, or null when the arguments are allowed. */
export function refusedFlagReason(args) {
  for (const arg of args) {
    const flag = arg.split("=")[0];
    const reason = REFUSED_DEPLOY_FLAGS[flag];
    if (reason) return { flag, reason };
  }
  return null;
}
