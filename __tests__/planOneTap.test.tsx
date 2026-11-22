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
import { getNightArea, NIGHT_AREAS, isNightAreaRouteReady } from "@/lib/nightAreas";
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
    for (const area of [getNightArea("clapham"), getNightArea("victoria")]) {
      expect(inferNightContext(oneTapQuery(area)).context.nightArea).toBe(area.slug);
    }
  });

  it("names the remembered area, or offers near me", () => {
    expect(oneTapLabel(null)).toBe("Tonight near me");
    expect(oneTapLabel(getNightArea("clapham"))).toBe("Tonight in Clapham");
  });
});

describe("which area a tap plans", () => {
  it("does not plan the remembered patch without reviewed evidence", () => {
    expect(rememberedOneTapArea({ kind: "patch", id: "clapham" }, NOW)).toBeNull();
  });

  it("never offers an area that is not crawl-ready, a borough, or nothing", () => {
    expect(rememberedOneTapArea({ kind: "patch", id: "brixton" }, NOW)).toBeNull();
    // Piccadilly & Soho is reviewed with its pint prices still missing.
    expect(rememberedOneTapArea({ kind: "patch", id: "soho" }, NOW)).toBeNull();
    expect(rememberedOneTapArea({ kind: "patch", id: "hackney" }, NOW)).toBeNull();
    expect(rememberedOneTapArea({ kind: "borough", name: "Lambeth" }, NOW)).toBeNull();
    expect(rememberedOneTapArea(null, NOW)).toBeNull();
  });

  it("does not select an unreviewed area from a location", () => {
    expect(locatedOneTapArea(CLAPHAM_COMMON.lat, CLAPHAM_COMMON.lng, NOW)).toBeNull();
  });

  it("does not call somewhere far away near", () => {
    expect(locatedOneTapArea(OXFORD.lat, OXFORD.lng, NOW)).toBeNull();
  });

  it("says why it could not, and names the areas that can be typed", () => {
    const message = oneTapMessage("out-of-range", NOW);
    expect(message).toBe("No crawl-ready area near you yet. Type an area instead.");
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

  async function mount(props: Partial<Parameters<typeof PlanDescribeFirst>[0]> = {}) {
    const onSubmit = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(PlanDescribeFirst, { onSubmit, onGuideMeInstead: () => undefined, ...props }));
    });
    const button = () => host!.querySelector<HTMLButtonElement>(".planDescribeFirst__chip--oneTap");
    return { onSubmit, button };
  }

  async function type(value: string) {
    const input = host!.querySelector<HTMLInputElement>("#plan-describe-first-query")!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const planIt = () => host!.querySelector<HTMLButtonElement>("[data-primary-action] button")!;
  const STARTER = {
    starter: {
      ask: "cheap pints tonight in Shoreditch",
      heading: "Cheap pints in Shoreditch",
      summary: "1 stop · £3.50 each for pints",
      stops: [{ venueId: "venue-a", venueName: "The Old George", estimatedPintPricePence: 350 }],
    },
  };

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

  it("does not plan an unreviewed remembered area", async () => {
    window.localStorage.setItem("pubmax:nightPatch:v1", JSON.stringify({ kind: "patch", id: "clapham" }));
    stubLocation({ coords: { latitude: CLAPHAM_COMMON.lat, longitude: CLAPHAM_COMMON.lng } });
    const { onSubmit, button } = await mount();
    expect(button()?.textContent).toBe("Tonight near me");
    await act(async () => button()!.click());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(host!.querySelector(".planDescribeFirst__oneTapNote")?.textContent).toContain("Type an area instead.");
    expect(document.activeElement?.id).toBe("plan-describe-first-query");
  });

  it("asks for location on tap and falls back to typing when the area is unreviewed", async () => {
    stubLocation({ coords: { latitude: CLAPHAM_COMMON.lat, longitude: CLAPHAM_COMMON.lng } });
    const { onSubmit, button } = await mount();
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => button()!.click());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(host!.querySelector(".planDescribeFirst__oneTapNote")?.textContent).toContain("Type an area instead.");
    expect(trackEvent).toHaveBeenCalledWith("plan_one_tap", { outcome: "out-of-range" });
  });

  it("says so, plans nothing, and hands the caret to the field when location is refused", async () => {
    stubLocation({ code: 1 });
    const { onSubmit, button } = await mount();
    await act(async () => button()!.click());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(host!.querySelector(".planDescribeFirst__oneTapNote")?.textContent).toBe("Location access was denied. Type an area instead.");
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
    await type("quiet in Victoria");
    expect(button()).toBeNull();
  });

  it("plans the priced route on screen when Plan it is tapped on an empty field", async () => {
    const { onSubmit } = await mount(STARTER);
    await act(async () => planIt().click());

    expect(onSubmit).toHaveBeenCalledWith(STARTER.starter.ask, undefined);
    expect(trackEvent).toHaveBeenCalledWith("plan_one_tap", { outcome: "starter" });
    expect(sanitizeEvent("plan_one_tap", { outcome: "starter" })).not.toBeNull();
  });

  it("carries the chosen options onto the route on screen", async () => {
    const { onSubmit } = await mount(STARTER);
    const four = [...host!.querySelectorAll<HTMLButtonElement>("[aria-label='Number of pub stops'] button")]
      .find((choice) => choice.textContent === "4")!;
    await act(async () => four.click());
    await act(async () => planIt().click());

    expect(onSubmit).toHaveBeenCalledWith(STARTER.starter.ask, 4);
  });

  it("plans the reader's own words over the route on screen", async () => {
    const { onSubmit } = await mount(STARTER);
    await type("quiet in Victoria");
    await act(async () => planIt().click());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toBe("quiet in Victoria");
    expect(trackEvent).not.toHaveBeenCalledWith("plan_one_tap", { outcome: "starter" });
  });

  it("still asks for words when the page holds no route", async () => {
    const { onSubmit } = await mount();
    await act(async () => planIt().click());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(host!.querySelector("#plan-describe-first-empty")).not.toBeNull();
  });
});
