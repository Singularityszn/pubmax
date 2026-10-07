import { describe, expect, it } from "vitest";

import { nearUrlNamesContent } from "@/lib/nearDesk";

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

describe("Near page mode for a link that names its content", () => {
  it("does not let the remembered mode change what a shared patch link shows", () => {
    expect(
      resolveNearPageMode({ hydrated: true, modeParam: null, rememberedMode: "desk", urlNamesContent: true }),
    ).toBe("pint");
  });

  it("still honours an explicit mode on such a link", () => {
    expect(
      resolveNearPageMode({ hydrated: true, modeParam: "desk", rememberedMode: "pint", urlNamesContent: true }),
    ).toBe("desk");
  });

  it("keeps the remembered mode for the bare page", () => {
    expect(
      resolveNearPageMode({ hydrated: true, modeParam: null, rememberedMode: "desk", urlNamesContent: false }),
    ).toBe("desk");
  });
});

describe("nearUrlNamesContent", () => {
  it("is true for a patch, a locate request or a poster scan", () => {
    expect(nearUrlNamesContent(new URLSearchParams("patch=soho"))).toBe(true);
    expect(nearUrlNamesContent(new URLSearchParams("locate=1"))).toBe(true);
    expect(nearUrlNamesContent(new URLSearchParams("src=poster"))).toBe(true);
  });

  it("is false for the bare page and for a mode alone", () => {
    expect(nearUrlNamesContent(new URLSearchParams(""))).toBe(false);
    expect(nearUrlNamesContent(new URLSearchParams("mode=desk"))).toBe(false);
  });
});
