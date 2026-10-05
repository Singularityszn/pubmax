// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TonightConditionsStrip from "@/app/tonight/TonightConditionsStrip";
import { NO_WEATHER_READING_LINE } from "@/lib/conditionsFormat";
import type { TonightConditionsSummary } from "@/lib/tonightConditions";

// The summary is the clock's, because /feed and the desktop map chip read the
// same answer. A 09:30 reading in October says "morning".
const MORNING_SUMMARY: TonightConditionsSummary = {
  dateLabel: "Saturday 3 Oct",
  factsLine: "11°C feels like, cloudy, 0% chance of rain, 5 km/h wind.",
  stale: false,
  checkedLabel: "Checked 30 minutes ago",
  drinkLine: "Crisp autumn morning. Amber ale weather.",
  drinkRuleId: "crisp-autumn",
  drinkSuggestion: "an amber ale",
  venueClaim: null,
};

let served: TonightConditionsSummary = MORNING_SUMMARY;
// "answer" serves the summary, "hang" never settles, "fail" settles unanswered.
let read: "answer" | "hang" | "fail" = "answer";

vi.mock("@/lib/surfaceDataCache", () => ({
  loadSurfaceJson: async (
    _key: string,
    _options: unknown,
    apply: (value: { summary: TonightConditionsSummary }) => void,
  ) => {
    await Promise.resolve();
    if (read === "hang") return new Promise<never>(() => undefined);
    if (read === "fail") return "failed";
    apply({ summary: served });
    return "network";
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T08:30:00.000Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  served = MORNING_SUMMARY;
  read = "answer";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(props: { tonightMode?: boolean }): Promise<string> {
  await act(async () => {
    root.render(createElement(TonightConditionsStrip, props));
  });
  return container.textContent ?? "";
}

describe("the Tonight conditions strip", () => {
  it("names the evening on Tonight when the clock is still morning", async () => {
    const text = await render({ tonightMode: true });
    expect(text).toContain("Crisp autumn evening. Amber ale weather.");
    expect(text).not.toContain("morning");
  });

  it("keeps the clock's line where it is not under the Tonight switch", async () => {
    const text = await render({});
    expect(text).toContain("Crisp autumn morning. Amber ale weather.");
  });

  it("keeps the clock once the evening has come, and names the night after it", async () => {
    vi.setSystemTime(new Date("2026-10-03T22:30:00.000Z"));
    served = { ...MORNING_SUMMARY, drinkLine: "Crisp autumn night. Amber ale weather." };
    const text = await render({ tonightMode: true });
    expect(text).toContain("Crisp autumn night. Amber ale weather.");
  });

  it("prints the reading's age instead of a drink line when it is stale", async () => {
    served = { ...MORNING_SUMMARY, stale: true, checkedLabel: "Last checked 2 days ago" };
    const text = await render({ tonightMode: true });
    expect(text).toContain("Last checked 2 days ago.");
    expect(text).not.toContain("Amber ale");
  });

  it("holds its own room, unpainted and unread, while the read runs", async () => {
    read = "hang";
    const text = await render({ tonightMode: true });
    expect(text).toBe("");
    const hold = container.querySelector(".tonightConditions");
    expect(hold?.classList.contains("tonightConditionsHold")).toBe(true);
    expect(hold?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("[data-testid='tonight-conditions']")).toBeNull();
  });

  it("says there is no reading when the read fails, so the room is never blank", async () => {
    read = "fail";
    const text = await render({ tonightMode: true });
    expect(text).toContain(NO_WEATHER_READING_LINE);
    expect(container.querySelector(".tonightConditionsHold")).toBeNull();
  });

  it("holds no room in the feed's desktop rail while the read runs", async () => {
    read = "hang";
    await render({});
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing in the feed's desktop rail when the read fails", async () => {
    read = "fail";
    await render({});
    expect(container.innerHTML).toBe("");
  });
});
