/* @vitest-environment jsdom */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({
  default: () => null,
}));
vi.mock("@/components/nav/NowSegment", () => ({
  default: () => null,
}));
// Signed out: no handle, on the server and on the first client paint.
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => null,
}));

import TodayClient from "@/app/today/TodayClient";
import { TODAY_PINTS_DEFAULT_PATCH_ID } from "@/app/today/todayPints";
import { buildDayGreeting } from "@/lib/dayGreeting";

let root: Root | null = null;
function render(element: ReactNode) {
  const target = document.createElement("div");
  document.body.append(target);
  root = createRoot(target);
  act(() => root!.render(element));
}
const screen = { getByTestId: (id: string) => document.querySelector(`[data-testid="${id}"]`)! };
function cleanup() { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; }

const MORNING = new Date("2026-10-17T08:00:00.000Z");
const DATE_LABEL = "Saturday 17 October";

function decode(markup: string): string {
  return markup.replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

function page() {
  return createElement(TodayClient, {
      dateLabel: DATE_LABEL,
      nowIso: MORNING.toISOString(),
      greeting: buildDayGreeting({
        now: MORNING,
        weather: null,
        dateLabel: DATE_LABEL,
        name: null,
      }),
      weather: null,
      weatherByArea: {},
      fact: null,
      pintsIndex: {
        [TODAY_PINTS_DEFAULT_PATCH_ID]: {
          patchId: TODAY_PINTS_DEFAULT_PATCH_ID,
          areaName: "Central London",
          rows: [],
        },
      },
      quietPint: null,
    });
}

function serverGreetingMarkup(): string {
  const html = renderToString(page());
  const match = html.match(/data-testid="today-greeting">([\s\S]*?)<\/span>/);
  expect(match, "the greeting line renders on the server").not.toBeNull();
  return decode(match?.[1] ?? "");
}


vi.mock("@/app/today/TodayTubeCard", () => ({ default: ({ slot }: { slot: string }) => <div data-testid="tube-slot">{slot}</div> }));
vi.mock("@/app/today/TodayGetThereStrip", () => ({ default: () => null }));
vi.mock("@/components/loop/useLoopMoment", () => ({ useLoopMoment: () => undefined }));

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Today uses the reader's clock after hydration", () => {
  it("replaces an ISR morning greeting and Tube label with the current afternoon", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T15:20:00.000Z"));
    expect(serverGreetingMarkup()).toContain("Good morning");
    render(page());
    expect(screen.getByTestId("today-greeting").textContent).toBe("Good afternoon. Friday 23 Oct.");
    expect(screen.getByTestId("tube-slot").textContent).toBe("afternoon");
  });

  it("updates the daypart as an open tab crosses into evening", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T15:59:30.000Z"));
    render(page());
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByTestId("today-greeting").textContent).toBe("Good evening. Friday 23 Oct.");
    expect(screen.getByTestId("tube-slot").textContent).toBe("evening");
  });

  it("replaces a warm ISR date across London midnight on launch day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T23:59:30+01:00"));
    expect(serverGreetingMarkup()).toContain("Saturday 17 October");
    render(page());
    expect(screen.getByTestId("today-greeting").textContent).toBe("Still up. Saturday 24 Oct.");
    expect(screen.getByTestId("brief-prepared-at").querySelector("time")?.dateTime).toBe(MORNING.toISOString());
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByTestId("today-greeting").textContent).toBe("Still up. Sunday 25 Oct.");
    expect(screen.getByTestId("brief-prepared-at").querySelector("time")?.dateTime).toBe(MORNING.toISOString());
  });

  it.each(["2026-10-25T01:30:00+01:00", "2026-10-25T01:30:00+00:00"])("keeps the correct day in the repeated hour at %s", (instant) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    render(page());
    expect(screen.getByTestId("today-greeting").textContent).toBe("Still up. Sunday 25 Oct.");
    expect(screen.getByTestId("tube-slot").textContent).toBe("night");
  });
});
