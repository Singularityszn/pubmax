import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { sanitizeEvent } from "@/lib/analyticsEvents";
import {
  isPosterLandingArrival,
  isPosterLandingSrc,
  posterLandingOrientation,
  posterNearHref,
  POSTER_LANDING_SESSION_KEY,
  POSTER_LANDING_SRC,
  readPosterLandingSession,
  rememberPosterLandingSession,
  shouldKeepPosterLandingParam,
} from "@/lib/posterLanding";

const homePage = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
const nearClient = readFileSync(
  join(process.cwd(), "components/nearme/NearPageClient.tsx"),
  "utf8",
);
const posterNote = readFileSync(
  join(process.cwd(), "components/nearme/PosterLandingNote.tsx"),
  "utf8",
);
const posterSpec = readFileSync(
  join(process.cwd(), "docs/growth/POSTER_SPEC.md"),
  "utf8",
);

describe("poster landing redirect helpers", () => {
  it("accepts only the closed poster source", () => {
    expect(isPosterLandingSrc(POSTER_LANDING_SRC)).toBe(true);
    expect(isPosterLandingSrc("poster")).toBe(true);
    expect(isPosterLandingSrc("Poster")).toBe(false);
    expect(isPosterLandingSrc("landing")).toBe(false);
    expect(isPosterLandingSrc(null)).toBe(false);
    expect(isPosterLandingSrc(undefined)).toBe(false);
  });

  it("keeps src and utm_* query keys only", () => {
    expect(shouldKeepPosterLandingParam("src")).toBe(true);
    expect(shouldKeepPosterLandingParam("utm_source")).toBe(true);
    expect(shouldKeepPosterLandingParam("utm_campaign")).toBe(true);
    expect(shouldKeepPosterLandingParam("patch")).toBe(false);
    expect(shouldKeepPosterLandingParam("q")).toBe(false);
    expect(shouldKeepPosterLandingParam("note")).toBe(false);
  });

  it("builds /near with src=poster and preserved utm tags", () => {
    expect(posterNearHref({ src: "poster" })).toBe("/near?src=poster");
    expect(
      posterNearHref({
        src: "poster",
        utm_source: "bar-qr",
        utm_medium: "poster",
        junk: "drop-me",
      }),
    ).toBe("/near?src=poster&utm_source=bar-qr&utm_medium=poster");

    const params = new URLSearchParams(
      "src=poster&utm_campaign=soho&fbclid=tracked",
    );
    expect(posterNearHref(params)).toBe(
      "/near?src=poster&utm_campaign=soho",
    );
  });

  it("pins src=poster even when the inbound record omitted it", () => {
    expect(posterNearHref({ utm_source: "mat" })).toBe(
      "/near?utm_source=mat&src=poster",
    );
  });
});

describe("poster landing orientation", () => {
  it("ships one honest VOICE-clean orientation line", () => {
    const line = posterLandingOrientation();
    expect(line).toBe(
      "You scanned a pub poster. Compare listed pint prices near you, cheapest first.",
    );
    expect(line).not.toMatch(/—|–/);
    expect(line).not.toMatch(/!/);
    expect(line.toLowerCase()).not.toMatch(
      /experience|discover|seamless|curated|journey|partners?/,
    );
  });

  it("home RSC redirects poster arrivals through posterNearHref", () => {
    expect(homePage).toMatch(/from "@\/lib\/posterLanding"/);
    expect(homePage).toMatch(/isPosterLandingSrc/);
    expect(homePage).toMatch(/posterNearHref/);
    expect(homePage).toMatch(/redirect\(posterNearHref\(params\)\)/);
  });

  it("near page mounts the poster orientation note from src", () => {
    expect(nearClient).toMatch(/PosterLandingNote/);
    expect(nearClient).toMatch(/searchParams\.get\("src"\)/);
    expect(posterNote).toMatch(/posterLandingOrientation/);
    expect(posterNote).toMatch(/trackEvent\("poster_landing"\)/);
  });

  it("spec points the printed QR at /?src=poster landing on /near", () => {
    expect(posterSpec).toMatch(/\/\?src=poster/);
    expect(posterSpec).toMatch(/\/near/);
    expect(posterSpec).toMatch(/utm_\*/);
  });
});

describe("poster_landing analytics", () => {
  it("registers a closed no-prop event", () => {
    expect(sanitizeEvent("poster_landing")).toEqual({
      name: "poster_landing",
      props: {},
    });
    expect(sanitizeEvent("poster_landing", { note: "free text" })).toEqual({
      name: "poster_landing",
      props: {},
    });
    expect(sanitizeEvent("poster_landing", { src: "poster" })).toEqual({
      name: "poster_landing",
      props: {},
    });
  });
});

describe("poster landing session flag", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remembers and reads a same-tab session flag", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });

    expect(readPosterLandingSession()).toBe(false);
    expect(isPosterLandingArrival(null)).toBe(false);
    rememberPosterLandingSession();
    expect(store.get(POSTER_LANDING_SESSION_KEY)).toBe("1");
    expect(readPosterLandingSession()).toBe(true);
    expect(isPosterLandingArrival(null)).toBe(true);
    expect(isPosterLandingArrival("poster")).toBe(true);
  });
});
