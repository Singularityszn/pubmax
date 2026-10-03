// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TonightConditionsStrip from "@/app/tonight/TonightConditionsStrip";
import { NO_WEATHER_READING_LINE } from "@/lib/conditionsFormat";
import type { TonightConditionsSummary } from "@/lib/tonightConditions";
import { clearSurfaceCache, writeSurfaceSnapshot } from "@/lib/surfaceDataCache";

const summary: TonightConditionsSummary = {
  dateLabel: "Tuesday 29 Sep",
  factsLine: "12°C feels like, light cloud.",
  stale: true,
  checkedLabel: "Last checked 3 days ago",
  drinkLine: "",
  drinkSuggestion: "",
  drinkRuleId: null,
  venueClaim: null,
};

describe("Tonight conditions before hydration", () => {
  it("paints the supplied public reading in the initial document", () => {
    const html = renderToStaticMarkup(<TonightConditionsStrip initialSummary={summary} />);
    expect(html).toContain('data-testid="tonight-conditions"');
    expect(html).toContain(summary.factsLine);
    expect(html).toContain(summary.checkedLabel);
    expect(html).not.toContain("near you");
  });

  it("paints an honest unavailable reading when the server has none", () => {
    const html = renderToStaticMarkup(<TonightConditionsStrip initialSummary={null} />);
    expect(html).toContain('data-testid="tonight-conditions"');
    expect(html).toContain(NO_WEATHER_READING_LINE);
  });

  it("preserves the existing loading behaviour for hosts without an initial reading", () => {
    expect(renderToStaticMarkup(<TonightConditionsStrip />)).toBe("");
  });
});

describe("Tonight conditions across a returning visit", () => {
  let container: HTMLDivElement;
  let root: Root;
  let answer: (response: Response) => void;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    clearSurfaceCache();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    clearSurfaceCache();
    vi.unstubAllGlobals();
  });

  it("keeps the server reading while an older cached fallback revalidates", async () => {
    writeSurfaceSnapshot("/api/tonight-conditions", { summary: null });
    await act(async () => { root.render(<TonightConditionsStrip initialSummary={summary} />); });
    expect(container.textContent).toContain(summary.factsLine);
    const refreshed = { ...summary, factsLine: "13°C feels like, light cloud." };
    await act(async () => { answer(Response.json({ summary: refreshed })); });
    expect(container.textContent).toContain(refreshed.factsLine);
  });

  it("keeps a server fallback instead of replaying an older cached reading", async () => {
    writeSurfaceSnapshot("/api/tonight-conditions", { summary });
    await act(async () => { root.render(<TonightConditionsStrip initialSummary={null} />); });
    expect(container.textContent).toContain(NO_WEATHER_READING_LINE);
  });

  it("still uses a location-specific snapshot after the reader shares a point", async () => {
    const located = { ...summary, venueClaim: "4 gardens near you" };
    writeSurfaceSnapshot("/api/tonight-conditions?lat=51.5&lng=-0.1", { summary: located });
    await act(async () => {
      root.render(<TonightConditionsStrip initialSummary={summary} origin={{ lat: 51.5, lng: -0.1 }} />);
    });
    expect(container.textContent).toContain(located.venueClaim);
  });

  it("restores the public reading when location is removed while refresh is pending", async () => {
    const located = { ...summary, venueClaim: "4 gardens near you" };
    writeSurfaceSnapshot("/api/tonight-conditions", { summary: null });
    writeSurfaceSnapshot("/api/tonight-conditions?lat=51.5&lng=-0.1", { summary: located });
    await act(async () => {
      root.render(<TonightConditionsStrip initialSummary={summary} origin={{ lat: 51.5, lng: -0.1 }} />);
    });
    expect(container.textContent).toContain(located.venueClaim);
    await act(async () => { root.render(<TonightConditionsStrip initialSummary={summary} origin={null} />); });
    expect(container.textContent).toContain(summary.factsLine);
    expect(container.textContent).not.toContain("near you");
  });
});
