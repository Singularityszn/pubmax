import { describe, expect, it } from "vitest";

import {
  revealForm,
  venuePriceRevealMotion,
  venuePriceRevealMotionClass,
  venueRevealRootClasses,
  VENUE_REVEAL_STALE_MS,
} from "@/lib/venueReveal";

const NOW = Date.UTC(2026, 7, 25, 20, 0, 0);

describe("revealForm", () => {
  it("returns full when there is no prior reveal", () => {
    expect(revealForm(NOW, null)).toBe("full");
  });

  it("returns full when the last reveal is stale", () => {
    expect(revealForm(NOW, NOW - VENUE_REVEAL_STALE_MS)).toBe("full");
  });

  it("returns short when the last reveal is recent", () => {
    expect(revealForm(NOW, NOW - 2_000)).toBe("short");
  });
});

describe("venuePriceRevealMotion", () => {
  const established = {
    corroborations: 2,
    submittedAt: NOW - 60_000,
    mapCandidate: null,
  };

  const provisional = {
    corroborations: 1,
    submittedAt: NOW - 60_000,
    mapCandidate: null,
  };

  it("drops only corroborated in-window community figures", () => {
    expect(
      venuePriceRevealMotion({ communityLead: established }, NOW),
    ).toBe("drop");
  });

  it("slides provisional in-window figures flat", () => {
    expect(
      venuePriceRevealMotion({ communityLead: provisional }, NOW),
    ).toBe("slide");
  });

  it("stays static when there is no community lead", () => {
    expect(venuePriceRevealMotion({ communityLead: null }, NOW)).toBe("static");
  });

  it("stays static when the only row is aged out", () => {
    expect(
      venuePriceRevealMotion(
        {
          communityLead: {
            ...established,
            submittedAt: NOW - 31 * 24 * 60 * 60 * 1000,
          },
        },
        NOW,
      ),
    ).toBe("static");
  });
});

describe("venuePriceRevealMotionClass", () => {
  it("maps motion to chrome classes, never the figure node", () => {
    expect(venuePriceRevealMotionClass("drop")).toBe(
      "venueRevealPriceChrome--drop",
    );
    expect(venuePriceRevealMotionClass("slide")).toBe(
      "venueRevealPriceChrome--slide",
    );
    expect(venuePriceRevealMotionClass("static")).toBe(
      "venueRevealPriceChrome--static",
    );
  });
});

describe("venueRevealRootClasses", () => {
  it("omits entrance classes when interrupted", () => {
    expect(
      venueRevealRootClasses({ active: true, form: "full", interrupted: true }),
    ).toBe("");
  });

  it("names the active form when running", () => {
    expect(
      venueRevealRootClasses({ active: true, form: "short", interrupted: false }),
    ).toBe("venueReveal venueReveal--short");
  });
});

describe("price figure animation fence", () => {
  it("keeps keyframe selectors on chrome wrappers only", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(
      join(__dirname, "../components/map/venueSheet.css"),
      "utf8",
    );
    const motionBlock = css.slice(
      css.indexOf("/* Venue reveal choreography"),
      css.indexOf("/* Venue reveal choreography") + 4_000,
    );
    expect(motionBlock).not.toMatch(/PriceBadge/);
    expect(motionBlock).not.toMatch(/venueDrinkPriceFigure/);
    expect(motionBlock).not.toMatch(/strong\s*\{/);
    expect(motionBlock).toContain("venueRevealPriceChrome");
    expect(motionBlock).toContain("prefers-reduced-motion: no-preference");
  });
});
