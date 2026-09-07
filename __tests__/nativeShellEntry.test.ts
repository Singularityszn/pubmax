// @vitest-environment jsdom

// THE SHELL'S COLD START, DECIDED BEFORE THE LANDING PAGE RENDERS.
//
// capacitor.config.ts is a remote-URL wrap, so a native launch always opens the
// site ROOT and lib/entryDecision.ts rewrites it from the client. That rewrite
// runs in an effect, which means the landing page has already been rendered and
// painted by the time it fires: measured on the iPhone 17 Pro simulator against
// production on 7 September 2026, the landing painted at 7.9s and the first-run
// screen replaced it at 9.2s (docs/proof/mobile-shells-refresh/). The reader's
// first screen was a page they never asked for, and the rewrite ALSO counted as
// them "reaching a second route", which is one of the answers
// lib/consentAnswerMoment.ts waits for — so the analytics consent card arrived
// on the first screen a new person ever saw, before the product had answered
// anything.
//
// public/native-entry-init.js is the fix: a render-blocking classic script,
// same shape as public/theme-init.js, that takes the ONE entry case it can
// decide exactly and navigates before the landing document is rendered at all.
// This file holds it to lib/entryDecision.ts rather than trusting the copy.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SESSION_ENTRY_CONSUMED_KEY,
  SHELL_START_PATH,
} from "@/lib/entryDecision";
import {
  CONSENT_ANSWER_MOMENT_KEY,
  CONSENT_FIRST_ROUTE_KEY,
  markConsentAnswerMoment,
  noteConsentRouteVisited,
  resetConsentWaitForEntryRewrite,
} from "@/lib/consentAnswerMoment";
import { NATIVE_FIRST_RUN_ROUTED_KEY } from "@/lib/nativeFirstRun";

const rootFile = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const ENTRY_INIT_SOURCE = rootFile("public/native-entry-init.js");

/** A memory Storage, so each case starts from a known device state. */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
  } as Storage;
}

type RunResult = {
  replaced: string[];
  session: Storage;
  local: Storage;
};

/**
 * Run the shipped script against a window of our own. The file touches nothing
 * but `window`, exactly so this fence can drive it rather than grep it.
 */
function runEntryInit(options: {
  native?: boolean;
  pathname?: string;
  session?: Record<string, string>;
  local?: Record<string, string>;
}): RunResult {
  const replaced: string[] = [];
  const session = memoryStorage(options.session ?? {});
  const local = memoryStorage(options.local ?? {});
  const win = {
    Capacitor:
      options.native === false
        ? undefined
        : { isNativePlatform: () => options.native !== false },
    location: {
      pathname: options.pathname ?? "/",
      replace: (href: string) => void replaced.push(href),
    },
    sessionStorage: session,
    localStorage: local,
  };
  new Function("window", ENTRY_INIT_SOURCE)(win);
  return { replaced, session, local };
}

describe("the native shell's pre-render entry decision", () => {
  it("sends a post-first-run cold start straight to Tonight", () => {
    const { replaced, session } = runEntryInit({
      local: { [NATIVE_FIRST_RUN_ROUTED_KEY]: "1" },
    });

    expect(replaced).toEqual([SHELL_START_PATH]);
    // The same stamp AppEntryRoute writes, so a later in-app tap on the
    // wordmark still reaches the landing page rather than bouncing back.
    expect(session.getItem(SESSION_ENTRY_CONSUMED_KEY)).toBe("1");
  });

  it("does nothing at all in a browser", () => {
    const { replaced, session } = runEntryInit({
      native: false,
      local: { [NATIVE_FIRST_RUN_ROUTED_KEY]: "1" },
    });

    expect(replaced).toEqual([]);
    expect(session.getItem(SESSION_ENTRY_CONSUMED_KEY)).toBeNull();
  });

  it("never rewrites a deep link", () => {
    const { replaced } = runEntryInit({
      pathname: "/map",
      local: { [NATIVE_FIRST_RUN_ROUTED_KEY]: "1" },
    });

    expect(replaced).toEqual([]);
  });

  it("leaves a later in-session arrival at the root on the landing page", () => {
    const { replaced } = runEntryInit({
      session: { [SESSION_ENTRY_CONSUMED_KEY]: "1" },
      local: { [NATIVE_FIRST_RUN_ROUTED_KEY]: "1" },
    });

    expect(replaced).toEqual([]);
  });

  it("leaves the genuine first run to the client, which owns the onboarding gate", () => {
    // The first-run branch needs readPreferredCity()'s enabled-city table, which
    // a static file cannot read. Rather than fork that table, the script decides
    // only the case it can decide exactly and stays out of the other.
    const { replaced, session } = runEntryInit({ local: {} });

    expect(replaced).toEqual([]);
    expect(session.getItem(SESSION_ENTRY_CONSUMED_KEY)).toBeNull();
  });

  it("is loaded render-blocking, ahead of the other pre-paint scripts", () => {
    const layout = rootFile("app/layout.tsx");
    const entry = layout.indexOf('<script src="/native-entry-init.js" />');
    const theme = layout.indexOf('<script src="/theme-init.js" />');

    expect(entry).toBeGreaterThan(-1);
    expect(theme).toBeGreaterThan(-1);
    expect(entry).toBeLessThan(theme);
    // No async/defer: the whole point is to navigate before the landing
    // document is rendered.
    expect(layout).not.toContain('<script async src="/native-entry-init.js"');
    expect(layout).not.toContain('<script defer src="/native-entry-init.js"');
  });

  it("reads the same keys and destination the TypeScript seams own", () => {
    for (const literal of [
      SESSION_ENTRY_CONSUMED_KEY,
      NATIVE_FIRST_RUN_ROUTED_KEY,
      SHELL_START_PATH,
    ]) {
      expect(ENTRY_INIT_SOURCE).toContain(literal);
    }
  });
});

describe("the entry rewrite is not the reader's own second route", () => {
  it("clears the wait the rewrite itself started", () => {
    const store = memoryStorage();
    noteConsentRouteVisited("/", store);
    noteConsentRouteVisited("/onboarding", store);
    expect(store.getItem(CONSENT_ANSWER_MOMENT_KEY)).toBe("second-route");

    resetConsentWaitForEntryRewrite(store);

    expect(store.getItem(CONSENT_ANSWER_MOMENT_KEY)).toBeNull();
    expect(store.getItem(CONSENT_FIRST_ROUTE_KEY)).toBeNull();
  });

  it("keeps an answer the product actually gave", () => {
    const store = memoryStorage();
    noteConsentRouteVisited("/", store);
    markConsentAnswerMoment("venue-sheet", store);

    resetConsentWaitForEntryRewrite(store);

    expect(store.getItem(CONSENT_ANSWER_MOMENT_KEY)).toBe("venue-sheet");
  });

  it("is called by the route that performs the rewrite", () => {
    const source = rootFile("components/native/AppEntryRoute.tsx");
    expect(source).toContain("resetConsentWaitForEntryRewrite");
  });
});
