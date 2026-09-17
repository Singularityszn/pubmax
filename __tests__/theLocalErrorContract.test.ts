import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("..", import.meta.url).pathname;

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === "route.ts" ? [path] : [];
  });
}

const ALL_ROUTES = routeFiles(join(ROOT, "app/api"));
// ---------------------------------------------------------------------------
// Static call scanner: find JSON-emitting calls that carry an `error:` payload
// field and a 4xx/5xx status, without executing the route.
// ---------------------------------------------------------------------------

// Call names that produce a JSON Response. Local wrappers (json, jsonResponse,
// privateJson) are included so a new route cannot mint a fresh rogue envelope
// behind a helper name the sweep has seen before.
const EMITTERS =
  /\b(?:jsonNoStore|privateJson|jsonResponse|json|(?:NextResponse|Response)\.json)\s*\(/g;

type ErrorEmission = { line: number; call: string };

/** Balanced-paren capture of every JSON-emitting call in `source`. */
function jsonCalls(source: string): Array<{ index: number; call: string }> {
  const calls: Array<{ index: number; call: string }> = [];
  EMITTERS.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EMITTERS.exec(source))) {
    let depth = 1;
    let i = match.index + match[0].length;
    let inString: string | null = null;
    while (depth > 0 && i < source.length) {
      const c = source[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === inString) inString = null;
      } else if (c === '"' || c === "'" || c === "`") inString = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    calls.push({ index: match.index, call: source.slice(match.index, i) });
  }
  return calls;
}

/**
 * A call is an ERROR RESPONSE when its payload carries a top-level `error:`
 * field and its status is not a known-2xx literal: a 4xx/5xx literal, a
 * positional 4xx/5xx number, or a dynamic `status` expression (a gate that
 * decided the status upstream). 2xx fail-soft payloads that carry an `error`
 * field beside real data (citymcp degrade answers, the freshness-audit cron
 * body) are exactly the shape this sweep must NOT flag.
 */
function rogueErrorEmissions(source: string): ErrorEmission[] {
  const found: ErrorEmission[] = [];
  for (const { index, call } of jsonCalls(source)) {
    if (!/[{,]\s*error\s*:/.test(call)) continue;
    const status =
      call.match(/status\s*:\s*(\d{3})/)?.[1] ??
      call.match(/\}\s*,\s*(\d{3})\s*\)\s*$/)?.[1] ??
      null;
    const dynamicStatus = /status\s*:\s*[a-zA-Z_$]|\bstatus\s*[,}]/.test(call);
    if (status === null && !dynamicStatus) continue; // no status → 200 payload
    if (status !== null && Number(status) < 400) continue; // explicit 2xx/3xx
    found.push({ line: source.slice(0, index).split("\n").length, call });
  }
  return found;
}

/** One level of local helper imports, so delegated envelopes stay fenced. */
function importedLibModules(source: string): string[] {
  const modules = new Set<string>();
  for (const match of source.matchAll(/from "@\/(lib\/[\w/.-]+)"/g)) {
    for (const suffix of ["", ".ts", ".tsx"]) {
      const candidate = join(ROOT, match[1] + suffix);
      if (candidate.endsWith(".ts") || candidate.endsWith(".tsx") || candidate.endsWith(".mjs")) {
        if (existsSync(candidate)) {
          modules.add(candidate);
          break;
        }
      }
    }
  }
  return [...modules];
}

// Documented exemptions from the flat-envelope sweep. Each names what it emits
// instead and why. This list may only shrink; it is not a mute button.
const ENVELOPE_EXEMPT_FILES = new Set<string>([
  // Defines both the flat envelope and the legacy nested Heritage envelope
  // (a shipped consumer still reads the nested shape).
  "lib/apiError.ts",
]);

describe("app/api public error envelope (tree-wide)", () => {
  it("routes every 4xx/5xx JSON error through publicApiError, in routes and their one-level helpers", () => {
    const failures: string[] = [];
    const helperFiles = new Set<string>();

    for (const file of ALL_ROUTES) {
      const source = readFileSync(file, "utf8");
      for (const emission of rogueErrorEmissions(source)) {
        failures.push(
          `${relative(ROOT, file)}:${emission.line}: ${emission.call.replace(/\s+/g, " ").slice(0, 120)}`,
        );
      }
      for (const helper of importedLibModules(source)) helperFiles.add(helper);
    }

    // A route may delegate its envelope to a lib helper; the helper then owes
    // the same contract, so sweep one level of local imports too.
    for (const helper of [...helperFiles].sort()) {
      if (ENVELOPE_EXEMPT_FILES.has(relative(ROOT, helper))) continue;
      const source = readFileSync(helper, "utf8");
      for (const emission of rogueErrorEmissions(source)) {
        failures.push(
          `${relative(ROOT, helper)}:${emission.line}: ${emission.call.replace(/\s+/g, " ").slice(0, 120)}`,
        );
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps the exemption list honest: every entry still exists", () => {
    for (const file of ENVELOPE_EXEMPT_FILES) {
      expect(existsSync(join(ROOT, file)), file).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Rate-limit fence: every non-cron mutating route must reference a limiter or
// a named delegation whose helper rate-limits for it.
// ---------------------------------------------------------------------------

// Tokens that prove a route (or its named gate) consults a rate limiter.
// `preparePlanGeneration` is a delegation: lib/planGeneration.server.ts
// rate-limits generation before loading planning data. `socialCrewActor` is a delegation: lib/socialCrewHttp.ts rate-limits every
// write actor before the route body runs. `handleProfileImage*` are the same
// shape: lib/profileImageRoute.server.ts owns the per-actor budget for the
// avatar and cover slots, which take one identical journey.
// `handleProfileCoverPhoto*` is that same delegation for the cover ROTATION:
// lib/profileCoverPhotoRoute.server.ts spends a per-actor budget on every add,
// remove and reorder, and a per-actor budget on every reader flag.
// A COMMENT IS NOT A LIMITER AND NEITHER IS AN IMPORT. The sweep below decides
// on code, and on a CALL, so a route that only NAMES a limiter in prose or on
// its import line cannot answer for a call it does not make.
//
// The stripper tracks quote state and drops `//` and `/* */`. It does NOT model
// regex literals, so a `/` inside a character class can be read as the start of
// a comment, and a regex holding an odd number of quote characters opens a
// quote that never closes.
//
// IT IS RED BY CONSTRUCTION. A source it cannot read to the end in a balanced
// state is a source it FAILED to strip, and it answers null rather than handing
// back text it did not understand. The sweep then reports that route as an
// offender. Everything else it does is deletion, and the sweep asks whether a
// limiter CALL is present in what is left, so no route with no limiter can
// pass, whether the stripper understood it or gave up.
function codeWithoutComments(source: string): string | null {
  let out = "";
  let quote: string | null = null;
  let i = 0;

  while (i < source.length) {
    const character = source[i];
    const next = source[i + 1];

    if (quote) {
      if (character === "\\") {
        out += character + (next ?? "");
        i += 2;
        continue;
      }
      if (character === quote) quote = null;
      out += character;
      i += 1;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      out += character;
      i += 1;
      continue;
    }

    if (character === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }

    if (character === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }

    out += character;
    i += 1;
  }

  return quote === null ? out : null;
}

/** True when the CODE of `source` consults a limiter or a named delegation. */
function consultsLimiter(source: string): boolean {
  const code = codeWithoutComments(source);
  return code !== null && LIMITER_TOKENS.test(code);
}

const LIMITER_TOKENS =
  /(?:\bisLimited|[a-zA-Z]+RateLimited|\bis[A-Z][a-zA-Z]*Limited|\bpreparePlanGeneration|\bsocialCrewActor|\bhandleProfileImage(?:Upload|Delete|Report)|\bhandleProfileCoverPhoto(?:Upload|Delete|Move|Report))\s*\(/;

// A ROUTE THAT ONLY EVER REFUSES SPENDS NO BUDGET.
//
// `app/api/[[...unmatched]]` is the API tree's own 404: it writes nothing, so
// there is nothing for a limiter to protect, and a durable budget read on an
// unknown address would make a typo cost more than a real request. The
// exemption is proved rather than listed -
// `__tests__/writeSurfaceCertification.test.ts` holds that route to one import
// and one refusal call per method - so it cannot hide a write. Like the
// envelope exemptions above, this list may only shrink.
const LIMITER_EXEMPT_REFUSAL_ROUTES = new Set([
  "app/api/[[...unmatched]]/route.ts",
]);

// A MUTATING ROUTE OUTSIDE app/api IS STILL A MUTATING ROUTE. `/ingest` is the
// owned PostHog proxy: anyone may POST up to 1 MB into the billed EU project
// through it, and it shipped unlimited because the sweep read `app/api` and
// nothing else, so no fence ever looked at it. The sweep now walks the whole
// `app` tree, so a mutating route cannot escape it by living outside `app/api`
// and nothing has to be listed by hand. `/ingest` is NOT an envelope route: a
// browser SDK reads its status, never a JSON body.
const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

// ONE ANSWER TO "DOES THIS ROUTE MUTATE": the handlers the module really
// exports. A source scan would miss a handler exported indirectly.
async function exportsMutatingHandler(load: () => Promise<unknown>): Promise<boolean> {
  const mod = (await load()) as Record<string, unknown>;
  return MUTATING_METHODS.some((method) => typeof mod[method] === "function");
}

describe("app/api rate limiting (tree-wide)", () => {
  it("gates every cron route with assertCronRequest instead of a limiter", () => {
    for (const file of ALL_ROUTES.filter((path) => path.includes("/cron/"))) {
      const source = readFileSync(file, "utf8");
      expect(source, relative(ROOT, file)).toMatch(/assertCronRequest\s*\(/);
    }
  });

  it("keeps the refusal exemption honest: every entry still exists", () => {
    for (const file of LIMITER_EXEMPT_REFUSAL_ROUTES) {
      expect(existsSync(join(ROOT, file)), file).toBe(true);
    }
  });

  it("references a rate limiter (or a named delegation) in every non-cron mutating route", async () => {
    const failures: string[] = [];
    for (const file of routeFiles(join(ROOT, "app"))) {
      if (file.includes("/cron/")) continue;
      if (LIMITER_EXEMPT_REFUSAL_ROUTES.has(relative(ROOT, file))) continue;
      if (!(await exportsMutatingHandler(() => import(file)))) continue;
      if (consultsLimiter(readFileSync(file, "utf8"))) continue;
      failures.push(relative(ROOT, file));
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("refuses a route whose regex literal leaves the stripper mid-quote", () => {
    const quotesInClass = [
      "// The durable limiter (`isLimited`) is NOT used on purpose.",
      'const quoted = /["\']/;',
      "export async function POST(): Promise<Response> {",
      "  return new Response(null, { status: 204 });",
      "}",
    ].join("\n");
    const apostrophe = [
      "// The durable limiter (`isLimited`) is NOT used on purpose.",
      "const contraction = /don't/;",
      "export async function POST(): Promise<Response> {",
      "  return new Response(null, { status: 204 });",
      "}",
    ].join("\n");

    expect(consultsLimiter(quotesInClass)).toBe(false);
    expect(consultsLimiter(apostrophe)).toBe(false);
  });

  it("keeps a real call and a URL inside a string readable to the sweep", () => {
    const withCall = [
      'const origin = "https://eu.i.posthog.com";',
      "if (ingestRateLimited(key, Date.now(), 240, 60_000)) return refusal(429);",
    ].join("\n");

    expect(consultsLimiter(withCall)).toBe(true);
  });

  it("refuses a proxy whose limiter call is gone but whose comment still names one", () => {
    const lines = [
      "// The durable limiter (`isLimited`) is NOT used on purpose: this route",
      "// must make no Supabase call at request time.",
      'import { ingestRateLimited } from "@/lib/ingestRateLimit";',
      "export async function POST(request: Request): Promise<Response> {",
      "  if (ingestRateLimited(key(request), Date.now(), 240, 60_000)) return refusal(429);",
      "  return forward(request);",
      "}",
    ];

    expect(consultsLimiter(lines.join("\n"))).toBe(true);
    // An IMPORT IS NOT A CALL either: the proxy below still names the limiter
    // on its import line and never spends a budget, so it must be refused.
    expect(consultsLimiter(lines.filter((line) => !line.includes("if (")).join("\n"))).toBe(false);
    expect(consultsLimiter(lines.filter((line) => !line.includes("ingestRateLimited")).join("\n")))
      .toBe(false);
  });
});

describe("THE LOCAL public error envelope", () => {
  it("routes every documented THE LOCAL error through the flat public helper", () => {
    const files = [
      ...routeFiles(join(ROOT, "app/api/plans")),
      ...routeFiles(join(ROOT, "app/api/night-areas")),
      join(ROOT, "app/api/late-food/route.ts"),
      join(ROOT, "app/api/me/night-profile/route.ts"),
    ];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(
        /jsonNoStore\s*\(\s*(?:\{\s*error\b|publicError\s*\(|PLAN_IDEMPOTENCY_ERROR\b|failure\.body\b)/,
      );
      expect(source, file).not.toMatch(/Response\.json\s*\(\s*\{\s*error\b/);
      if (/\berror\s*:|publicApiError|collaborationErrorResponse/.test(source)) {
        expect(source, file).toMatch(/publicApiError|collaborationErrorResponse/);
      }
    }
  });

  it("keeps the flat helper's stable human and machine fields", async () => {
    const { publicApiError } = await import("@/lib/apiError");
    const response = publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
    expect(await response.json()).toEqual({
      error: "That Plan doesn't exist.",
      code: "PLAN_NOT_FOUND",
      retryable: false,
    });
  });

  it("derives the conventional generic code and retryability from a bare status", async () => {
    const { publicApiErrorFromStatus } = await import("@/lib/apiError");
    const forbidden = publicApiErrorFromStatus("You're not in this Round.", 403);
    expect(await forbidden.json()).toEqual({
      error: "You're not in this Round.",
      code: "FORBIDDEN",
      retryable: false,
    });
    const outage = publicApiErrorFromStatus("Profile storage is unavailable.", 503);
    expect(await outage.json()).toEqual({
      error: "Profile storage is unavailable.",
      code: "UNAVAILABLE",
      retryable: true,
    });
  });
});
