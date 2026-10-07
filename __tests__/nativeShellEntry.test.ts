// @vitest-environment jsdom

// THE SHELL'S COLD START, DECIDED BEFORE THE LANDING PAGE RENDERS.
//
// capacitor.config.ts is a remote-URL wrap. Newer binaries start at the static
// /app-entry document through server.appStartPath. Older binaries open the site
// ROOT, where lib/entryDecision.ts rewrites the launch from the client. That
// rewrite runs in an effect, which means the landing page has already been rendered and
// painted by the time it fires: measured on the iPhone 17 Pro simulator against
// production on 7 September 2026, the landing painted at 7.9s and the first-run
// screen replaced it at 9.2s (docs/proof/mobile-shells-refresh/). The reader's
// first screen was a page they never asked for, and the rewrite ALSO counted as
// them "reaching a second route", which is one of the answers
// lib/consentAnswerMoment.ts waits for — so the analytics consent card arrived
// on the first screen a new person ever saw, before the product had answered
// anything.
//
// The entry block at the top of public/theme-init.js is the fix: render-blocking,
// same shape as public/theme-init.js, that takes the ONE entry case it can
// decide exactly and navigates before the landing document is rendered at all.
// This file holds it to lib/entryDecision.ts rather than trusting the copy.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ONBOARDING_PATH,
  SESSION_ENTRY_CONSUMED_KEY,
  SHELL_START_PATH,
} from "@/lib/entryDecision";
import { PREFERRED_CITY_KEY } from "@/lib/cityPreference";
import {
  CONSENT_ANSWER_MOMENT_KEY,
  CONSENT_FIRST_ROUTE_KEY,
  markConsentAnswerMoment,
  noteConsentRouteVisited,
  resetConsentWaitForEntryRewrite,
} from "@/lib/consentAnswerMoment";
import {
  NATIVE_FIRST_RUN_HANDOFF_KEY,
  NATIVE_FIRST_RUN_ROUTED_KEY,
  NATIVE_FIRST_RUN_STEP_KEY,
} from "@/lib/nativeFirstRun";

const rootFile = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

// The decision rides theme-init.js now: see the "costs the website nothing"
// case below for why it is not a file of its own.
const ENTRY_INIT_SOURCE = rootFile("public/theme-init.js");

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
  storageUnavailable?: boolean;
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
    sessionStorage: options.storageUnavailable ? undefined : session,
    localStorage: local,
  };
  new Function("window", ENTRY_INIT_SOURCE)(win);
  return { replaced, session, local };
}

describe("the native shell's pre-render entry decision", () => {
  it("routes a fresh install from the lightweight entry document with a handoff", () => {
    const { replaced, session, local } = runEntryInit({ pathname: "/app-entry" });
    expect(replaced).toEqual([ONBOARDING_PATH]);
    expect(session.getItem(NATIVE_FIRST_RUN_HANDOFF_KEY)).toMatch(/^\d+$/);
    expect(local.getItem(NATIVE_FIRST_RUN_ROUTED_KEY)).toBe("1");
  });

  it("opens Tonight on a returning app-entry boot even if the session stamp survives", () => {
    expect(runEntryInit({
      pathname: "/app-entry",
      local: { [NATIVE_FIRST_RUN_ROUTED_KEY]: "1" },
      session: { [SESSION_ENTRY_CONSUMED_KEY]: "1" },
    }).replaced).toEqual([SHELL_START_PATH]);
  });

  it("opens Tonight from app-entry for a stored city without stamping first-run", () => {
    const { replaced, session, local } = runEntryInit({
      pathname: "/app-entry", local: { [PREFERRED_CITY_KEY]: "london" },
    });
    expect(replaced).toEqual([SHELL_START_PATH]);
    expect(session.getItem(SESSION_ENTRY_CONSUMED_KEY)).toBe("1");
    expect(session.getItem(NATIVE_FIRST_RUN_HANDOFF_KEY)).toBeNull();
    expect(local.getItem(NATIVE_FIRST_RUN_ROUTED_KEY)).toBeNull();
  });

  it("opens Tonight from app-entry for a disabled or unparseable stored city", () => {
    // Tonight reads the value through readPreferredCity(), which answers null
    // for these, so the city-aware chrome falls back to London.
    for (const stored of ["atlantis", "{not json", ""]) {
      const { replaced, local } = runEntryInit({
        pathname: "/app-entry", local: { [PREFERRED_CITY_KEY]: stored },
      });
      expect(replaced).toEqual([SHELL_START_PATH]);
      expect(local.getItem(NATIVE_FIRST_RUN_ROUTED_KEY)).toBeNull();
    }
  });

  it("opens Tonight from app-entry for a stored city even if the session stamp survives", () => {
    const { replaced, local } = runEntryInit({
      pathname: "/app-entry",
      local: { [PREFERRED_CITY_KEY]: "london" },
      session: { [SESSION_ENTRY_CONSUMED_KEY]: "1" },
    });
    expect(replaced).toEqual([SHELL_START_PATH]);
    expect(local.getItem(NATIVE_FIRST_RUN_ROUTED_KEY)).toBeNull();
  });

  it("leaves the static document when storage or the bridge is unavailable", () => {
    expect(runEntryInit({ pathname: "/app-entry", storageUnavailable: true }).replaced).toEqual(["/"]);
    expect(runEntryInit({ pathname: "/app-entry", native: false }).replaced).toEqual(["/"]);
  });

  it("sends a post-first-run cold start straight to Tonight", () => {
    const { replaced, session } = runEntryInit({
      local: { [NATIVE_FIRST_RUN_ROUTED_KEY]: "1" },
    });

    expect(replaced).toEqual([SHELL_START_PATH]);
    // The same stamp AppEntryRoute writes, so a later in-app tap on the
    // wordmark still reaches the landing page rather than bouncing back.
    expect(session.getItem(SESSION_ENTRY_CONSUMED_KEY)).toBe("1");
  });

  it("resumes unfinished onboarding after a new session, even with London already chosen", () => {
    const { replaced, session } = runEntryInit({
      local: {
        [NATIVE_FIRST_RUN_STEP_KEY]: "location",
        [PREFERRED_CITY_KEY]: "london",
      },
    });

    expect(replaced).toEqual([ONBOARDING_PATH]);
    expect(session.getItem(NATIVE_FIRST_RUN_HANDOFF_KEY)).toMatch(/^\d+$/);
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

  it("takes the genuine first run to onboarding, with its eligibility already issued", () => {
    // A GENUINE FIRST LAUNCH IS THE ONE LAUNCH THE READER JUDGES THE APP ON,
    // and it was the launch that still painted the landing page first. Measured
    // on the iPhone 17 Pro simulator against a local production build on
    // 7 September 2026: the landing painted at 2951ms and the first-run screen
    // replaced it at 4403ms (docs/proof/mobile-shells-refresh/).
    //
    // The branch is decidable here after all. It needs `readPreferredCity()`
    // to answer null, and with NO stored city value at all that answer is null
    // under every possible enabled-city table — so this reads the ABSENCE of
    // the key, never its contents, and forks no table.
    const { replaced, session, local } = runEntryInit({ local: {} });

    expect(replaced).toEqual([ONBOARDING_PATH]);
    expect(session.getItem(SESSION_ENTRY_CONSUMED_KEY)).toBe("1");
    // The onboarding route is guarded by a session handoff, so the script has
    // to issue the same eligibility AppEntryRoute would have issued.
    expect(session.getItem(NATIVE_FIRST_RUN_HANDOFF_KEY)).toMatch(/^\d+$/);
    expect(local.getItem(NATIVE_FIRST_RUN_ROUTED_KEY)).toBeNull();
    expect(local.getItem(NATIVE_FIRST_RUN_STEP_KEY)).toBe("london");
  });

  it("leaves a stored city to the client, which owns the enabled-city table", () => {
    // A STORED CITY VALUE IS THE ONE CASE A STATIC FILE MAY NOT JUDGE. Whether
    // it counts depends on whether lib/cities.ts still has that city enabled,
    // and forking that table here would be a second place for the city list to
    // be wrong. The whole decision goes back to AppEntryRoute untouched.
    const { replaced, session, local } = runEntryInit({
      local: { [PREFERRED_CITY_KEY]: "london" },
    });

    expect(replaced).toEqual([]);
    expect(session.getItem(SESSION_ENTRY_CONSUMED_KEY)).toBeNull();
    expect(session.getItem(NATIVE_FIRST_RUN_HANDOFF_KEY)).toBeNull();
    expect(local.getItem(NATIVE_FIRST_RUN_ROUTED_KEY)).toBeNull();
  });

  it("costs the website nothing, because it rides a script every route already loads", () => {
    // A NATIVE-ONLY SCRIPT MAY NOT COST A WEB READER A REQUEST. Shipped as its
    // own file in <head> it was fetched on every route, and the perf gate on
    // PR 1632 caught it: /discover and /drinks each measured 57 requests
    // against a budget of 56. The decision is a no-op in every browser, so the
    // request bought a web reader nothing at all.
    //
    // public/map-first-paint-init.js is the house answer to a script only one
    // surface needs, and it is loaded by that surface's own page. This one
    // cannot follow it: the head is the layout's, the decision has to land
    // before the browser does any work on the document, and a page-level script
    // is already too late. So it rides theme-init.js, which every route loads
    // render-blocking in that same head. NO CEILING MOVED.
    const layout = rootFile("app/layout.tsx");
    expect(layout).not.toContain("native-entry-init");
    expect(layout).toContain('<script src="/theme-init.js?v=splash-1" />');
    // No async/defer on the file that now carries it: the whole point is to
    // navigate before the landing document is rendered.
    expect(layout).not.toContain('<script async src="/theme-init.js');
    expect(layout).not.toContain('<script defer src="/theme-init.js');
    // The file it used to be is gone, not merely unreferenced.
    expect(existsSync(join(process.cwd(), "public/native-entry-init.js"))).toBe(false);
  });

  it("runs before the theme work it now shares a file with", () => {
    // It navigates away, so anything this file does after it is work on a
    // document that is being replaced. First statement in, first decision out.
    const capacitorProbe = ENTRY_INIT_SOURCE.indexOf("isNativePlatform");
    const themeWork = ENTRY_INIT_SOURCE.indexOf('getItem("pubmax-theme")');
    expect(capacitorProbe).toBeGreaterThan(-1);
    expect(themeWork).toBeGreaterThan(-1);
    expect(capacitorProbe).toBeLessThan(themeWork);
  });

  it("reads the same keys and destination the TypeScript seams own", () => {
    for (const literal of [
      SESSION_ENTRY_CONSUMED_KEY,
      NATIVE_FIRST_RUN_ROUTED_KEY,
      NATIVE_FIRST_RUN_HANDOFF_KEY,
      PREFERRED_CITY_KEY,
      SHELL_START_PATH,
      ONBOARDING_PATH,
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

    resetConsentWaitForEntryRewrite("/onboarding", store);

    expect(store.getItem(CONSENT_ANSWER_MOMENT_KEY)).toBeNull();
    expect(store.getItem(CONSENT_FIRST_ROUTE_KEY)).toBeNull();
  });

  it("swallows the route the rewrite leaves, whichever effect runs first", () => {
    // THE FIX HAD TO ASSUME AN EFFECT ORDER, AND THE DEVICE RUNS THE OTHER ONE.
    // AppEntryRoute is inside {children} in app/layout.tsx and
    // AnalyticsConsentPrompt is mounted after it, so React fires the reset
    // BEFORE the landing route has been recorded at all. The reset then cleared
    // an empty slot, the landing recorded itself as the first route anyway, and
    // the destination read as the reader's own second route. Measured on the
    // iPhone 17 Pro simulator against a local production build on 7 September
    // 2026: the consent card sat on the first-run screen from 4403ms
    // (docs/proof/mobile-shells-refresh/).
    const store = memoryStorage();

    resetConsentWaitForEntryRewrite(ONBOARDING_PATH, store);
    noteConsentRouteVisited("/", store);
    noteConsentRouteVisited(ONBOARDING_PATH, store);

    expect(store.getItem(CONSENT_ANSWER_MOMENT_KEY)).toBeNull();
    // The destination is the arrival, so the reader's NEXT route is their first
    // real second route and the wait ends exactly one screen later.
    expect(store.getItem(CONSENT_FIRST_ROUTE_KEY)).toBe(ONBOARDING_PATH);
    noteConsentRouteVisited("/tonight", store);
    expect(store.getItem(CONSENT_ANSWER_MOMENT_KEY)).toBe("second-route");
  });

  it("keeps an answer the product actually gave", () => {
    const store = memoryStorage();
    noteConsentRouteVisited("/", store);
    markConsentAnswerMoment("venue-sheet", store);

    resetConsentWaitForEntryRewrite("/onboarding", store);

    expect(store.getItem(CONSENT_ANSWER_MOMENT_KEY)).toBe("venue-sheet");
  });

  it("is called by the route that performs the rewrite", () => {
    const source = rootFile("components/native/AppEntryRoute.tsx");
    expect(source).toContain("resetConsentWaitForEntryRewrite");
  });
});
