/** @vitest-environment jsdom */

// One tap to a route. Most people who opened /plan left without typing, so the
// empty page offers one tap that plans tonight in a crawl-ready area: the one
// the device last chose, or the one the reader is standing in, asked for only
// on the tap. It submits a sentence through the typed path, so it can plan
// nothing a typed description could not, and never an area the app calls not
// crawl-ready.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/wanted/WantedPlanChips", () => ({ default: () => null }));

import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";
import { trackEvent } from "@/lib/analytics";
import { sanitizeEvent } from "@/lib/analyticsEvents";
import { NIGHT_AREAS, isNightAreaRouteReady } from "@/lib/nightAreas";
import { inferNightContext } from "@/lib/nightPlanning";
import {
  locatedOneTapArea,
  oneTapLabel,
  oneTapMessage,
  oneTapQuery,
  rememberedOneTapArea,
} from "@/lib/planOneTap";

const NOW = new Date("2026-10-17T18:00:00Z");
const CLAPHAM_COMMON = { lat: 51.4613, lng: -0.1386 };
const OXFORD = { lat: 51.752, lng: -1.2577 };
const readyLondon = NIGHT_AREAS.filter((area) => area.cityId === "london" && isNightAreaRouteReady(area, NOW));

describe("the sentence a tap submits", () => {
  it("is read back as the same area by the parser typed text goes through", () => {
    expect(readyLondon.length).toBeGreaterThan(0);
    for (const area of readyLondon) {
      expect(inferNightContext(oneTapQuery(area)).context.nightArea).toBe(area.slug);
    }
  });

  it("names the remembered area, or offers near me", () => {
    expect(oneTapLabel(null)).toBe("Tonight near me");
    expect(oneTapLabel(readyLondon[0]!)).toBe(`Tonight in ${readyLondon[0]!.name}`);
  });
});

describe("which area a tap plans", () => {
  it("plans the patch this device last chose when it maps to a crawl-ready area", () => {
    expect(rememberedOneTapArea({ kind: "patch", id: "clapham" }, NOW)?.slug).toBe("clapham");
    expect(rememberedOneTapArea({ kind: "patch", id: "soho" }, NOW)?.slug).toBe("piccadilly-soho");
  });

  it("never offers an area that is not crawl-ready, a borough, or nothing", () => {
    expect(rememberedOneTapArea({ kind: "patch", id: "brixton" }, NOW)).toBeNull();
    expect(rememberedOneTapArea({ kind: "patch", id: "hackney" }, NOW)).toBeNull();
    expect(rememberedOneTapArea({ kind: "borough", name: "Lambeth" }, NOW)).toBeNull();
    expect(rememberedOneTapArea(null, NOW)).toBeNull();
  });

  it("plans the crawl-ready area the reader is standing in", () => {
    expect(locatedOneTapArea(CLAPHAM_COMMON.lat, CLAPHAM_COMMON.lng, NOW)?.slug).toBe("clapham");
  });

  it("does not call somewhere far away near", () => {
    expect(locatedOneTapArea(OXFORD.lat, OXFORD.lng, NOW)).toBeNull();
  });

  it("says why it could not, and names the areas that can be typed", () => {
    const message = oneTapMessage("out-of-range", NOW);
    expect(message).toMatch(/^No crawl-ready area near you yet\. Type one of /);
    for (const area of readyLondon) expect(message).toContain(area.name);
    for (const reason of ["denied", "timeout", "position", "unsupported", "out-of-range"] as const) {
      expect(oneTapMessage(reason, NOW)).not.toMatch(/[—!]/);
    }
  });
});

describe("plan_one_tap", () => {
  it("carries one outcome from a closed set, and fails closed without one", () => {
    expect(sanitizeEvent("plan_one_tap", { outcome: "located" })).toEqual({ name: "plan_one_tap", props: { outcome: "located" } });
    expect(sanitizeEvent("plan_one_tap", { outcome: "Clapham" })).toBeNull();
    expect(sanitizeEvent("plan_one_tap", {})).toBeNull();
  });
});

describe("the tap on the empty page", () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = null;
    host?.remove();
    host = null;
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function mount() {
    const onSubmit = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(PlanDescribeFirst, { onSubmit, onGuideMeInstead: () => undefined }));
    });
    const button = () => host!.querySelector<HTMLButtonElement>(".planDescribeFirst__chip--oneTap");
    return { onSubmit, button };
  }

  function stubLocation(result: { coords: { latitude: number; longitude: number } } | { code: number }) {
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: {
        getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) => {
          if ("coords" in result) ok(result as GeolocationPosition);
          else fail(result as GeolocationPositionError);
        },
      },
    });
  }

  it("plans the remembered area at once, without asking for location", async () => {
    window.localStorage.setItem("pubmax:nightPatch:v1", JSON.stringify({ kind: "patch", id: "clapham" }));
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition } });
    const { onSubmit, button } = await mount();

    expect(button()?.textContent).toBe("Tonight in Clapham");
    await act(async () => button()!.click());

    expect(onSubmit).toHaveBeenCalledWith("Clapham tonight", expect.any(Number));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(trackEvent).toHaveBeenCalledWith("plan_one_tap", { outcome: "remembered" });
  });

  it("asks for location only on the tap, then plans where the reader is", async () => {
    stubLocation({ coords: { latitude: CLAPHAM_COMMON.lat, longitude: CLAPHAM_COMMON.lng } });
    const { onSubmit, button } = await mount();

    expect(button()?.textContent).toBe("Tonight near me");
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => button()!.click());

    expect(onSubmit).toHaveBeenCalledWith("Clapham tonight", expect.any(Number));
    expect(trackEvent).toHaveBeenCalledWith("plan_one_tap", { outcome: "located" });
  });

  it("says so, plans nothing, and hands the caret to the field when location is refused", async () => {
    stubLocation({ code: 1 });
    const { onSubmit, button } = await mount();
    await act(async () => button()!.click());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(host!.querySelector(".planDescribeFirst__oneTapNote")?.textContent).toMatch(/^Location access was denied\. Type one of /);
    expect(document.activeElement?.id).toBe("plan-describe-first-query");
    expect(trackEvent).toHaveBeenCalledWith("plan_one_tap", { outcome: "no-location" });
  });

  it("says so when the reader is nowhere near a crawl-ready area", async () => {
    stubLocation({ coords: { latitude: OXFORD.lat, longitude: OXFORD.lng } });
    const { onSubmit, button } = await mount();
    await act(async () => button()!.click());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(host!.querySelector(".planDescribeFirst__oneTapNote")?.textContent).toMatch(/^No crawl-ready area near you yet\./);
    expect(trackEvent).toHaveBeenCalledWith("plan_one_tap", { outcome: "out-of-range" });
  });

  it("steps aside once the reader types", async () => {
    const { button } = await mount();
    const input = host!.querySelector<HTMLInputElement>("#plan-describe-first-query")!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input, "quiet in Victoria");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(button()).toBeNull();
  });
});
