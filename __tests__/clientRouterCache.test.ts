import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The client Router Cache window (experimental.staleTimes in next.config.mjs)
// is what makes a return to a tab instant: the browser reuses a route it
// already holds instead of paying a fresh RSC round trip and a fresh server
// render for a page it just left.
//
// It is only safe because of two invariants, and this file is the fence on
// both. Break either and the window has to be re-derived in the same commit.
//
//   1. NO page server-renders per-account content. Every route in this app is
//      a shell plus client reads; identity is resolved from the live session in
//      the browser (components/auth/useViewerHandle.ts). A held payload can
//      therefore never name the previous account.
//   2. NOTHING expects a server surface to change after a mutation. Every
//      mutable surface owns its own /api read, so a held payload cannot hide a
//      write that has landed.

const REPO_ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(REPO_ROOT, "app");

/** The ceiling this window may take without a fresh argument for it. */
const MAX_DYNAMIC_STALE_SECONDS = 300;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

const routeFiles = walk(APP_DIR).filter(
  (file) => !file.includes(`${path.sep}api${path.sep}`),
);

function relative(file: string): string {
  return path.relative(REPO_ROOT, file);
}

describe("the router cache window", () => {
  it("is declared, positive, and inside its ceiling", () => {
    const config = readFileSync(path.join(REPO_ROOT, "next.config.mjs"), "utf8");
    const match = /staleTimes:\s*\{\s*dynamic:\s*(\d+)/.exec(config);
    expect(match, "next.config.mjs must declare experimental.staleTimes.dynamic").toBeTruthy();
    const dynamic = Number(match?.[1]);
    expect(dynamic).toBeGreaterThan(0);
    expect(dynamic).toBeLessThanOrEqual(MAX_DYNAMIC_STALE_SECONDS);
  });
});

describe("invariant 1 — no page renders per-account content on the server", () => {
  it("reads no cookie and no draft mode outside the API", () => {
    const offenders = routeFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      if (source.includes('"use client"') || source.includes("'use client'")) return false;
      return /\bcookies\s*\(\s*\)/.test(source) || /\bdraftMode\s*\(\s*\)/.test(source);
    });
    expect(
      offenders.map(relative),
      "a server page that reads the request's cookies renders one account's page; the router cache would then hand it to the next",
    ).toEqual([]);
  });
});

describe("invariant 2 — no surface expects the server to re-render after a write", () => {
  it("has no router.refresh() call site", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components"]) {
      for (const file of walk(path.join(REPO_ROOT, dir))) {
        if (file.includes(`${path.sep}api${path.sep}`)) continue;
        if (/\brouter\s*\.\s*refresh\s*\(/.test(readFileSync(file, "utf8"))) {
          offenders.push(relative(file));
        }
      }
    }
    expect(
      offenders,
      "router.refresh() is not forbidden — but reaching for it means a server surface has started carrying mutable state, and the staleTimes window in next.config.mjs must be re-derived in the same commit",
    ).toEqual([]);
  });
});
