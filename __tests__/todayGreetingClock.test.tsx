/* @vitest-environment jsdom */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
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
import { buildWeatherBrief } from "@/lib/todayBrief";
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

function page(overrides: Partial<ComponentProps<typeof TodayClient>> = {}) {
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
      ...overrides,
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

it("ages cached weather and derives quietness from the same Sunday clock as the greeting", () => {
  vi.useFakeTimers();
  const prepared = new Date("2026-11-14T05:40:00Z");
  vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
  const observation = {
    nightArea: "piccadilly-soho", observedAt: "2026-11-14T05:00:00Z",
    expiresAt: "2026-11-14T08:00:00Z", condition: "Clear", feelsLikeC: 8,
    precipitationProbabilityPct: 0, windKph: 5,
    source: { publisher: "Open-Meteo", sourceUrl: "https://api.open-meteo.com/", publishedAt: "2026-11-14T05:00:00Z" },
  };
  render(page({
    nowIso: prepared.toISOString(),
    weather: buildWeatherBrief({ version: 1, generatedAt: observation.observedAt, observations: [observation] }, prepared),
    quietPint: { weekdayName: "Saturday", rows: [{ id: "test", name: "Test Arms", heritageLine: "Listed pub",
      eraLabel: null, gradeLabel: null, provenanceLabel: "Sourced", sourceLabel: "Historic England", sourceRef: null,
      quietLabel: "Usually quiet on a Saturday", priceLabel: null, mapHref: "/map?sel=test" }] },
  }));
  expect(screen.getByTestId("today-greeting").textContent).toContain("Sunday 15 Nov");
  expect(document.body.textContent).toContain("Usually quiet on a Sunday");
  expect(document.body.textContent).not.toContain("Usually quiet on a Saturday");
  expect(screen.getByTestId("today-weather").textContent).toContain("Last checked yesterday");
  expect(screen.getByTestId("today-weather").textContent).not.toMatch(/\bnight\b|Checked 40 minutes ago/);
  expect(document.body.textContent).toContain("Old page snapshot");
  act(() => { vi.setSystemTime(new Date("2026-11-15T20:00:00Z")); vi.advanceTimersByTime(60_000); });
  expect(document.body.textContent).not.toContain("Usually quiet");
  expect(document.body.textContent).toContain("No current weather reading");
});
