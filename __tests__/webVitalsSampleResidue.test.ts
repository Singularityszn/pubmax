// @vitest-environment jsdom
import type { Page } from "@playwright/test";
import { beforeEach, describe, expect, it } from "vitest";

import { clearSampleResidue } from "../e2e/helpers/webVitals";
import { MOBILE_MAP_SESSION_KEY } from "../lib/mobileShell";

const page = {
  evaluate: async (callback: (argument: unknown) => unknown, argument: unknown) =>
    callback(argument),
} as unknown as Page;

beforeEach(() => {
  window.localStorage.clear();
});

describe("clearSampleResidue", () => {
  it("clears only saved map sheet from the sample's More action", async () => {
    const session = {
      version: 1,
      savedAt: "2026-09-24T12:00:00.000Z",
      cityId: "london",
      viewport: { center: [-0.21, 51.54], zoom: 14, pitch: 22, bearing: -8 },
      filters: { stopCount: 5, requireBeerGarden: true },
      rows: [{ id: "venue-1", name: "Saved row" }],
      selectedVenueId: "venue-1",
      openSheet: "layers",
    };
    window.localStorage.setItem(MOBILE_MAP_SESSION_KEY, JSON.stringify(session));
    window.localStorage.setItem("unrelated-preference", "keep-me");

    await clearSampleResidue(page, "/map");

    expect(JSON.parse(window.localStorage.getItem(MOBILE_MAP_SESSION_KEY) ?? "null")).toEqual({
      ...session,
      openSheet: null,
    });
    expect(window.localStorage.getItem("unrelated-preference")).toBe("keep-me");
  });

  it("preserves a saved sheet that did not come from the sample's More action", async () => {
    const session = {
      version: 1,
      cityId: "london",
      openSheet: "tonight",
      viewport: { center: [-0.21, 51.54], zoom: 14, pitch: 22, bearing: -8 },
    };
    window.localStorage.setItem(MOBILE_MAP_SESSION_KEY, JSON.stringify(session));

    await clearSampleResidue(page, "/map");

    expect(JSON.parse(window.localStorage.getItem(MOBILE_MAP_SESSION_KEY) ?? "null")).toEqual(session);
  });

  it.each([
    ["malformed JSON", "{"],
    ["array JSON", "[]"],
    ["null JSON", "null"],
    ["primitive JSON", "7"],
  ])("leaves %s and unrelated storage intact", async (_label, raw) => {
    window.localStorage.setItem(MOBILE_MAP_SESSION_KEY, raw);
    window.localStorage.setItem("unrelated-preference", "keep-me");

    await clearSampleResidue(page, "/map");

    expect(window.localStorage.getItem(MOBILE_MAP_SESSION_KEY)).toBe(raw);
    expect(window.localStorage.getItem("unrelated-preference")).toBe("keep-me");
  });

  it("leaves an absent map session absent without clearing other storage", async () => {
    window.localStorage.setItem("unrelated-preference", "keep-me");

    await clearSampleResidue(page, "/map");

    expect(window.localStorage.getItem(MOBILE_MAP_SESSION_KEY)).toBeNull();
    expect(window.localStorage.getItem("unrelated-preference")).toBe("keep-me");
  });

  it("does not apply map cleanup to a non-exact route path", async () => {
    const session = { version: 1, cityId: "london", openSheet: "layers" };
    window.localStorage.setItem(MOBILE_MAP_SESSION_KEY, JSON.stringify(session));

    await clearSampleResidue(page, "/map/");

    expect(JSON.parse(window.localStorage.getItem(MOBILE_MAP_SESSION_KEY) ?? "null")).toEqual(session);
  });

  it("keeps existing Pub Pal prefix cleanup scoped to that route", async () => {
    window.localStorage.setItem("pubmaxx.pub-pal-onboarding.anonymous", "sample-draft");
    window.localStorage.setItem("unrelated-preference", "keep-me");

    await clearSampleResidue(page, "/pal");

    expect(window.localStorage.getItem("pubmaxx.pub-pal-onboarding.anonymous")).toBeNull();
    expect(window.localStorage.getItem("unrelated-preference")).toBe("keep-me");
  });
});
