// /onboarding is the native shell's one-time first-run surface, and the web has
// no first-run surface at all: FirstRunOnboardingGate consumes a native-only,
// session-scoped handoff, so a web visit has always failed closed to "/".
//
// It did that in the browser, after rendering and discarding a whole document.
// Astra's live walk (7 Sep 2026, finding B6) measured the paint that followed
// the bounce as the worst LCP on the site: 4676 ms on Slow 4G, and the thing
// being measured was the homepage hero.
//
// This is the fence in both directions. A plain document request never gets a
// document. A client navigation, which is how the shell really arrives, is
// untouched.

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

// Imported from the decision module rather than the leaf behind it, because
// what this fence is about is the route, not where its path is written down.
import { ONBOARDING_PATH } from "@/lib/entryDecision";
import { securityProxy } from "@/proxy";

/** What a browser sends when it navigates to a page. */
const DOCUMENT_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

function ask(path: string, headers: Record<string, string> = {}): Response {
  return securityProxy(
    new NextRequest(`https://pubmaxxing.com${path}`, {
      headers: { host: "pubmaxxing.com", accept: DOCUMENT_ACCEPT, ...headers },
    }),
  );
}

describe("a web document request never reaches /onboarding", () => {
  it("turns the document away at the edge, before any render", () => {
    const response = ask(ONBOARDING_PATH);

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/");
  });

  it("is temporary, so one browser cannot cache the first run away", () => {
    // The shell is a remote-URL wrap of this same origin. A 308 would be held
    // by the browser and would take the first run off every later install on
    // that device.
    expect(ask(ONBOARDING_PATH).status).not.toBe(308);
  });

  it("drops the query rather than carrying it home", () => {
    const response = ask(`${ONBOARDING_PATH}?utm_source=poster`);

    expect(new URL(response.headers.get("location") ?? "").search).toBe("");
  });

  it("leaves the shell's own arrival alone: a client navigation still renders", () => {
    // components/native/AppEntryRoute.tsx reaches this route with
    // router.replace from "/", which asks for the RSC payload rather than a
    // document. Measured on a production build: every RSC navigation and
    // prefetch sends `*/*`, and only a document navigation asks for text/html.
    const response = ask(ONBOARDING_PATH, { accept: "*/*" });

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("matches the route and nothing that merely starts like it", () => {
    for (const path of ["/", "/tonight", "/onboarding-notes"]) {
      const response = ask(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("location"), path).toBeNull();
    }
  });
});
