// /onboarding is the native shell's one-time first-run surface, and the web
// reaches it only by a client navigation from the landing hero's primary
// (`?start=web`): FirstRunOnboardingGate consumes a native-only, session-scoped
// handoff, so any other web visit has always failed closed to "/".
//
// It did that in the browser, after rendering and discarding a whole document.
// Astra's live walk (7 Sep 2026, finding B6) measured the paint that followed
// the bounce as the worst LCP on the site: 4676 ms on Slow 4G, and the thing
// being measured was the homepage hero.
//
// This is the fence in both directions. A document request answers only to a
// navigation this origin started: Sec-Fetch-Site same-origin, or a same-host
// Referer when that header is absent. The shell's fresh install arrives that
// way. A typed, same-site or cross-site document request keeps the 307, and a
// client navigation is untouched.

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

  it("still turns away a typed or bookmarked visit that names its origin", () => {
    // `Sec-Fetch-Site: none` is the browser saying the reader started this
    // navigation themselves. That is the B6 visit, whatever Referer says.
    const response = ask(ONBOARDING_PATH, {
      "sec-fetch-site": "none",
      referer: "https://pubmaxxing.com/",
    });

    expect(response.status).toBe(307);
  });

  it("matches the route and nothing that merely starts like it", () => {
    for (const path of ["/", "/tonight", "/onboarding-notes"]) {
      const response = ask(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("location"), path).toBeNull();
    }
  });
});

// The shell's first launch does NOT arrive by a client navigation any more.
// public/theme-init.js decides the entry before first paint and calls
// `window.location.replace("/onboarding")` from "/", which is a DOCUMENT
// request. Turning that away sent every fresh install to the landing page and
// stamped the first-run mark on the way, so onboarding never ran at all.
//
// A navigation the page itself started on this origin is the shell's, never
// the B6 visit. The browser says so in `Sec-Fetch-Site`. WKWebView sends that
// header only from iOS 16.4 and the app targets 15.0, so when it is ABSENT a
// Referer on this same origin says the same thing.
describe("a document navigation this origin started still reaches /onboarding", () => {
  it("lets the browser's same-origin navigation through", () => {
    const response = ask(ONBOARDING_PATH, { "sec-fetch-site": "same-origin" });

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets an older WebView through on a same-origin Referer", () => {
    const response = ask(ONBOARDING_PATH, { referer: "https://pubmaxxing.com/" });

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("accepts the new static entry document as the same-origin referrer", () => {
    const response = ask(ONBOARDING_PATH, { referer: "https://pubmaxxing.com/app-entry" });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("reads the browser's word before the Referer when both are sent", () => {
    for (const site of ["cross-site", "same-site"]) {
      const response = ask(ONBOARDING_PATH, {
        "sec-fetch-site": site,
        referer: "https://pubmaxxing.com/",
      });
      expect(response.status, site).toBe(307);
    }
  });

  it("turns away a Referer from anywhere else, a lookalike host included", () => {
    for (const referer of [
      "https://example.com/",
      "https://pubmaxxing.com.example.com/",
      "https://www.pubmaxxing.com/",
      "not a url",
    ]) {
      const response = ask(ONBOARDING_PATH, { referer });
      expect(response.status, referer).toBe(307);
    }
  });
});
