// A CDN-cached document is a page file and a proxy entry, and the two are one
// list read two ways.
//
// proxy.ts names the paths that drop the per-request CSP nonce for
// `script-src 'unsafe-inline'` (CDN_CACHED_DOCUMENT_PATHS). A path there is
// only ever served from a CDN copy if its page declares `force-static`, because
// the root layout reads `headers()` for the nonce and that read pulls every
// other route back to dynamic rendering. The two halves fail in opposite
// directions when they drift, and neither failure is visible in a unit test of
// the other half:
//
//   - A path in the proxy list whose page is NOT force-static renders per
//     request under 'unsafe-inline' with no nonce: a function invocation on
//     every view, and the inline-script relaxation bought nothing.
//   - A page that IS force-static but is NOT in the proxy list is prerendered
//     with no nonce in its inline scripts, then answered with a policy that
//     demands one, so the browser blocks Next's own hydration bootstrap.
//
// So the invariant is bidirectional: every listed path is a force-static page,
// and every force-static page is a listed path. `__tests__/clerkProxyCsp.test.ts`
// holds the policy each path answers; this file holds the page files behind it.
//
// Captain decisions: 2026-08-09 (`/` and `/map`), 2026-09-05 ("Widen": the
// other logged-out pages, `/tonight`, `/today`, `/near`).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { CDN_CACHED_DOCUMENT_PATHS } from "@/proxy";

const REPO_ROOT = process.cwd();
const APP_DIR = join(REPO_ROOT, "app");

/**
 * The routes that resolve a session, print a handle or act as a moderator in
 * their document. They are the reason the list exists as a closed constant
 * rather than a predicate: whatever a CDN copy would buy, one of these handed
 * to the next stranger is an account leak.
 */
const SIGNED_IN_ROUTES: Record<string, string> = {
  "/u/you": "app/u/[handle]/page.tsx",
  "/messages": "app/messages/page.tsx",
  "/admin": "app/admin/page.tsx",
  "/onboarding": "app/onboarding/page.tsx",
  "/social": "app/social/page.tsx",
};

function pageFileFor(pathname: string): string {
  return pathname === "/" ? "app/page.tsx" : `app/${pathname.slice(1)}/page.tsx`;
}

function walkPages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkPages(full, out);
    } else if (entry === "page.tsx" || entry === "page.ts") {
      out.push(relative(REPO_ROOT, full));
    }
  }
  return out;
}

/** The page's code alone: a comment that names `headers()` is not a read. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function readsPerRequest(rawSource: string): string[] {
  const source = stripComments(rawSource);
  const findings: string[] = [];
  if (/from\s+["']next\/headers["']/.test(source)) findings.push("imports next/headers");
  if (/\bcookies\s*\(\s*\)/.test(source)) findings.push("calls cookies()");
  if (/\bheaders\s*\(\s*\)/.test(source)) findings.push("calls headers()");
  if (/\bdraftMode\s*\(\s*\)/.test(source)) findings.push("calls draftMode()");
  if (/\bsearchParams\b/.test(source)) findings.push("takes searchParams");
  if (/from\s+["']@\/lib\/adminAuth["']/.test(source)) findings.push("imports the admin gate");
  return findings;
}

describe("every CDN-cached document is a force-static page", () => {
  const listed = [...CDN_CACHED_DOCUMENT_PATHS].sort();

  it.each(listed)("%s is backed by a page that declares force-static and an ISR window", (pathname) => {
    const file = pageFileFor(pathname);
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    expect(source, file).toContain('export const dynamic = "force-static"');
    expect(source, file).toMatch(/export const revalidate = \d+;/);
  });

  it.each(listed)("%s reads nothing per request in its document", (pathname) => {
    const file = pageFileFor(pathname);
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    expect(readsPerRequest(source), file).toEqual([]);
  });

  it("names every force-static page under app/, so a page cannot prerender behind a nonce", () => {
    const forceStatic = walkPages(APP_DIR).filter((file) =>
      readFileSync(join(REPO_ROOT, file), "utf8").includes('export const dynamic = "force-static"'),
    );
    expect(forceStatic.sort()).toEqual(listed.map(pageFileFor).sort());
  });

  it("takes the London-clock pages on a short window and the shell pages on an hour", () => {
    // A page that composes off `now` (the greeting slot, the quiet-pint window)
    // must not hold a copy for an hour: a "Good morning" at ten past noon is
    // the cost. A page that reads only bundled data has nothing to refresh
    // for and takes the quiet ceiling `/map` already had.
    const window = (pathname: string): number => {
      const source = readFileSync(join(REPO_ROOT, pageFileFor(pathname)), "utf8");
      return Number(/export const revalidate = (\d+);/.exec(source)?.[1]);
    };
    expect(window("/tonight")).toBeLessThanOrEqual(300);
    expect(window("/today")).toBeLessThanOrEqual(300);
    expect(window("/near")).toBe(window("/map"));
  });
});

describe("a signed-in surface is never a cached document", () => {
  const routes = Object.entries(SIGNED_IN_ROUTES);

  it.each(routes)("%s is absent from the list", (pathname) => {
    expect(CDN_CACHED_DOCUMENT_PATHS.has(pathname)).toBe(false);
  });

  it.each(routes)("%s does not declare force-static", (_pathname, file) => {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    expect(source, file).not.toContain("force-static");
  });
});
