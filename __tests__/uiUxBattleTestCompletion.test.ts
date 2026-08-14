import { describe, expect, it } from "vitest";

import { assertCompleteUiUxAudit } from "../scripts/lib/uiUxBattleTestCompletion.mjs";

const completionInput = {
  originNames: ["local"],
  viewportNames: ["mobile-390", "desktop-1440"],
  routeNames: ["home", "map"],
  flowDefinitions: [
    { name: "near-answer" },
    { name: "map-pan-zoom", desktopOnly: true },
  ],
  pages: [
    { origin: "local", viewport: "mobile-390", routeName: "home", cls: 0 },
    { origin: "local", viewport: "mobile-390", routeName: "map", cls: 0.01 },
    { origin: "local", viewport: "desktop-1440", routeName: "home", cls: 0 },
    { origin: "local", viewport: "desktop-1440", routeName: "map", cls: 0.02 },
  ],
  flowResults: [
    { name: "near-answer", origin: "local", viewport: "mobile-390", status: "passed" },
    {
      name: "map-pan-zoom",
      origin: "local",
      viewport: "mobile-390",
      status: "not-applicable",
    },
    { name: "near-answer", origin: "local", viewport: "desktop-1440", status: "passed" },
    { name: "map-pan-zoom", origin: "local", viewport: "desktop-1440", status: "passed" },
  ],
};

describe("UI UX audit completion", () => {
  it("accepts a complete page and flow matrix", () => {
    expect(() => assertCompleteUiUxAudit(completionInput)).not.toThrow();
  });

  it("rejects missing pages, CLS records, and failed applicable flows", () => {
    expect(() => assertCompleteUiUxAudit({
      ...completionInput,
      pages: completionInput.pages.filter(({ routeName, viewport }) =>
        routeName !== "map" || viewport !== "desktop-1440",
      ),
    })).toThrow("Missing page record: local/desktop-1440/map");

    expect(() => assertCompleteUiUxAudit({
      ...completionInput,
      pages: completionInput.pages.map((page) =>
        page.routeName === "map" && page.viewport === "mobile-390"
          ? { ...page, cls: undefined }
          : page,
      ),
    })).toThrow("Missing CLS record: local/mobile-390/map");

    expect(() => assertCompleteUiUxAudit({
      ...completionInput,
      flowResults: completionInput.flowResults.map((flow) =>
        flow.name === "map-pan-zoom" && flow.viewport === "desktop-1440"
          ? { ...flow, status: "failed", error: "Map did not move" }
          : flow,
      ),
    })).toThrow("Failed applicable flow: local/desktop-1440/map-pan-zoom");

    expect(() => assertCompleteUiUxAudit({
      ...completionInput,
      pages: [
        ...completionInput.pages,
        { origin: "local", viewport: "desktop-1440", routeName: "extra", cls: 0 },
      ],
    })).toThrow("Unexpected page record: local/desktop-1440/extra");

    expect(() => assertCompleteUiUxAudit({
      ...completionInput,
      flowResults: [
        ...completionInput.flowResults,
        {
          name: "extra-flow",
          origin: "local",
          viewport: "desktop-1440",
          status: "passed",
        },
      ],
    })).toThrow("Unexpected flow record: local/desktop-1440/extra-flow");
  });

  it("accepts only declared unavailable reasons for an applicable flow", () => {
    const input = {
      originNames: ["local"],
      viewportNames: ["desktop-1440"],
      routeNames: ["home"],
      flowDefinitions: [{
        name: "login-sheet-open",
        desktopOnly: true,
        allowedNotApplicableReasons: ["sign-in-trigger-unavailable"],
      }],
      pages: [{
        origin: "local",
        viewport: "desktop-1440",
        routeName: "home",
        cls: 0,
      }],
      flowResults: [{
        name: "login-sheet-open",
        origin: "local",
        viewport: "desktop-1440",
        status: "not-applicable",
        reason: "sign-in-trigger-unavailable",
      }],
    };

    expect(() => assertCompleteUiUxAudit(input)).not.toThrow();
    expect(() => assertCompleteUiUxAudit({
      ...input,
      flowResults: [{ ...input.flowResults[0], reason: "unknown" }],
    })).toThrow("Failed applicable flow: local/desktop-1440/login-sheet-open");
  });
});
