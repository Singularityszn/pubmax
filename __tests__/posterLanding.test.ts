import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getPosterCode } from "@/app/get/[code]/route";
import { sanitizeEvent } from "@/lib/analyticsEvents";
import {
  mintPosterCode,
  parsePosterCodes,
  posterArrival,
  posterCodeHref,
  type PosterCode,
} from "@/lib/posterCodes";
import { securityProxy } from "@/proxy";
import {
  clearPosterLandingSession,
  isPosterLandingArrival,
  isPosterLandingSrc,
  posterLandingOrientation,
  posterNearHref,
  POSTER_LANDING_SESSION_KEY,
  POSTER_LANDING_SRC,
  readPosterLandingMedium,
  readPosterLandingSession,
  rememberPosterLandingSession,
  shouldKeepPosterLandingParam,
} from "@/lib/posterLanding";

const MINTED: PosterCode[] = vi.hoisted(() => [
  { code: "h4jyp", medium: "beermat", place: "red-lion-se1", campaign: "launch-2026-11" },
  { code: "kx7mp", medium: "poster", place: "the-crown" },
]);

vi.mock("@/lib/posterCodes.json", () => ({ default: MINTED }));

const homePage = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
const proxySource = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
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
  it("names the printed thing that was scanned", () => {
    expect(posterLandingOrientation()).toBe(
      "You scanned a pub poster. Listed pint prices near you are below.",
    );
    expect(posterLandingOrientation("beermat")).toBe(
      "You scanned a beer mat. Listed pint prices near you are below.",
    );
  });

  it("the proxy redirects poster arrivals through posterNearHref", () => {
    // The decision moved out of the home RSC when `/` became a prerendered
    // document: reading `?src=` there is per-request work, and a prerendered
    // page is handed an empty query. The proxy sees the real one.
    expect(proxySource).toMatch(/from "@\/lib\/posterLanding"/);
    expect(proxySource).toMatch(/isPosterLandingSrc/);
    expect(proxySource).toMatch(/posterNearHref/);
    expect(homePage).not.toMatch(/posterNearHref/);
  });

  it("sends a real poster arrival to /near and leaves an ordinary visit alone", () => {
    const scanned = securityProxy(
      new NextRequest(
        "https://pubmaxxing.com/?src=poster&utm_source=camden&junk=1",
        { headers: { host: "pubmaxxing.com" } },
      ),
    );
    expect(scanned.status).toBe(307);
    expect(scanned.headers.get("location")).toBe(
      "https://pubmaxxing.com/near?src=poster&utm_source=camden",
    );

    for (const url of [
      "https://pubmaxxing.com/",
      "https://pubmaxxing.com/?src=notposter",
      // The redirect belongs to the landing alone; no other route inherits it.
      "https://pubmaxxing.com/map?src=poster",
    ]) {
      expect(
        securityProxy(
          new NextRequest(url, { headers: { host: "pubmaxxing.com" } }),
        ).status,
        url,
      ).toBe(200);
    }
  });

  it("near page mounts the poster orientation note from src", () => {
    expect(nearClient).toMatch(/PosterLandingNote/);
    expect(nearClient).toMatch(/searchParams\.get\("src"\)/);
    expect(nearClient).toMatch(/clearPosterLandingSession/);
    expect(posterNote).toMatch(/posterLandingOrientation/);
    expect(posterNote).toMatch(/clearPosterLandingSession/);
    expect(posterNote).toMatch(/trackEvent\("poster_landing"/);
  });

  it("spec points the printed QR at /?src=poster landing on /near", () => {
    expect(posterSpec).toMatch(/\/\?src=poster/);
    expect(posterSpec).toMatch(/\/near/);
    expect(posterSpec).toMatch(/utm_\*/);
  });
});

describe("poster_landing analytics", () => {
  it("keeps a known medium and a minted code, and nothing else", () => {
    expect(sanitizeEvent("poster_landing")).toEqual({
      name: "poster_landing",
      props: {},
    });
    expect(
      sanitizeEvent("poster_landing", { medium: "beermat", code: "h4jyp" }),
    ).toEqual({ name: "poster_landing", props: { medium: "beermat", code: "h4jyp" } });
    expect(
      sanitizeEvent("poster_landing", {
        medium: "billboard",
        code: "not-minted",
        note: "free text",
        src: "poster",
      }),
    ).toEqual({ name: "poster_landing", props: {} });
    expect(sanitizeEvent("poster_landing", { code: "H4JYP" })).toEqual({
      name: "poster_landing",
      props: {},
    });
  });
});

describe("poster short links", () => {
  function get(code: string) {
    return getPosterCode(new Request(`https://pubmaxxing.com/get/${code}`), {
      params: Promise.resolve({ code }),
    });
  }

  it("sends a minted code to /near with its campaign tags", async () => {
    const response = await get("h4jyp");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://pubmaxxing.com/near?src=poster&utm_source=red-lion-se1&utm_medium=beermat&utm_campaign=launch-2026-11&utm_content=h4jyp",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toMatch(/noindex/);
  });

  it("reads a code typed in capitals or with spaces as the same code", async () => {
    expect((await get("H4JYP")).headers.get("location")).toContain("utm_content=h4jyp");
    expect(posterCodeHref(" kx7mp ", MINTED)).toBe(
      "/near?src=poster&utm_source=the-crown&utm_medium=poster&utm_content=kx7mp",
    );
  });

  it("lands an unknown code on /near as a plain poster arrival", async () => {
    for (const code of ["nope1", "../admin", "a%20b"]) {
      expect((await get(code)).headers.get("location"), code).toBe(
        "https://pubmaxxing.com/near?src=poster",
      );
    }
  });

  it("tells analytics only what a minted code or a known medium says", () => {
    const read = (query: string) => posterArrival(new URLSearchParams(query), MINTED);
    expect(read("src=poster&utm_medium=poster&utm_content=h4jyp")).toEqual({
      medium: "beermat",
      code: "h4jyp",
    });
    expect(read("src=poster&utm_medium=beermat&utm_content=forged")).toEqual({
      medium: "beermat",
    });
    expect(read("src=poster&utm_medium=billboard")).toEqual({ medium: "poster" });
    expect(read("src=poster")).toEqual({ medium: "poster" });
  });
});

describe("poster code registry", () => {
  it("refuses a registry that would mislabel a scan", () => {
    expect(parsePosterCodes(MINTED)).toEqual(MINTED);
    expect(() => parsePosterCodes({})).toThrow(/array/);
    expect(() => parsePosterCodes([MINTED[0], MINTED[0]])).toThrow(/twice/);
    expect(() => parsePosterCodes([{ ...MINTED[0], medium: "flyer" }])).toThrow(/medium/);
    expect(() => parsePosterCodes([{ ...MINTED[0], code: "Red Lion" }])).toThrow(/code/);
    expect(() => parsePosterCodes([{ ...MINTED[0], place: "" }])).toThrow(/place/);
    expect(() => parsePosterCodes([{ ...MINTED[0], campaign: "x@y" }])).toThrow(/campaign/);
  });

  it("mints a fresh code and skips one already taken", () => {
    const candidates = ["h4jyp", "BAD!", "n3wcd"];
    const minted = mintPosterCode(
      MINTED,
      { place: "the-ship", medium: "beermat" },
      () => candidates.shift() ?? "",
    );
    expect(minted).toEqual({ code: "n3wcd", medium: "beermat", place: "the-ship" });
  });

  it("keeps a chosen code and campaign, and refuses bad input", () => {
    const random = () => "zzzzz";
    expect(
      mintPosterCode(
        MINTED,
        { place: "the-ship", medium: "poster", campaign: "launch-2026-11", code: "ship" },
        random,
      ),
    ).toEqual({ code: "ship", medium: "poster", place: "the-ship", campaign: "launch-2026-11" });
    expect(() => mintPosterCode(MINTED, { place: "the-ship", medium: "poster", code: "kx7mp" }, random)).toThrow(/already minted/);
    expect(() => mintPosterCode(MINTED, { place: "the-ship", medium: "flyer" }, random)).toThrow(/medium/);
    expect(() => mintPosterCode(MINTED, { place: "The Ship", medium: "poster" }, random)).toThrow(/place/);
    expect(() => mintPosterCode(MINTED, { place: "the-ship", medium: "poster" }, () => "h4jyp")).toThrow(/free code/);
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
    expect(store.get(POSTER_LANDING_SESSION_KEY)).toBe("poster");
    expect(readPosterLandingSession()).toBe(true);
    rememberPosterLandingSession("beermat");
    expect(readPosterLandingMedium()).toBe("beermat");
    store.set(POSTER_LANDING_SESSION_KEY, "1");
    expect(readPosterLandingMedium()).toBe("poster");
    store.set(POSTER_LANDING_SESSION_KEY, "junk");
    expect(readPosterLandingSession()).toBe(false);
    rememberPosterLandingSession();
    expect(isPosterLandingArrival(null)).toBe(true);
    expect(isPosterLandingArrival("poster")).toBe(true);
  });

  it("clears a stale session so organic /near visits are not poster-oriented", () => {
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

    rememberPosterLandingSession();
    expect(isPosterLandingArrival(null)).toBe(true);

    clearPosterLandingSession();
    expect(store.has(POSTER_LANDING_SESSION_KEY)).toBe(false);
    expect(readPosterLandingSession()).toBe(false);
    expect(isPosterLandingArrival(null)).toBe(false);
    expect(isPosterLandingArrival("poster")).toBe(true);
  });
});
