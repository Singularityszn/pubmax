import { describe, expect, it } from "vitest";

import {
  resolveNearAutoLocate,
  resolveNearPageMode,
} from "@/components/nearme/NearPageClient";

describe("Near page auto-location", () => {
  it("starts location only for the explicit landing request", () => {
    expect(resolveNearAutoLocate(new URLSearchParams("locate=1"))).toBe(true);
    expect(resolveNearAutoLocate(new URLSearchParams("locate=true"))).toBe(false);
    expect(resolveNearAutoLocate(new URLSearchParams(""))).toBe(false);
  });
});

describe("Near page mode", () => {
  it("renders the prerendered Pint surface until hydration ends, whatever the query", () => {
    expect(resolveNearPageMode({ hydrated: false, modeParam: "desk", rememberedMode: null })).toBe("pint");
    expect(resolveNearPageMode({ hydrated: false, modeParam: null, rememberedMode: "desk" })).toBe("pint");
  });

  it("lets the query lead the remembered mode once hydrated", () => {
    expect(resolveNearPageMode({ hydrated: true, modeParam: "desk", rememberedMode: "pint" })).toBe("desk");
    expect(resolveNearPageMode({ hydrated: true, modeParam: "pint", rememberedMode: "desk" })).toBe("pint");
    expect(resolveNearPageMode({ hydrated: true, modeParam: "bogus", rememberedMode: "desk" })).toBe("desk");
    expect(resolveNearPageMode({ hydrated: true, modeParam: null, rememberedMode: null })).toBe("pint");
  });
});
