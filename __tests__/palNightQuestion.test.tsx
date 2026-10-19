// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/pal",
}));

import PalNightQuestion from "@/components/pal/PalNightQuestion";
import { DEVICE_IDENTITY_LOCAL_KEYS } from "@/lib/deviceAccountIdentity";
import { inferNightContext } from "@/lib/nightPlanning";
import {
  msUntilPalNightBoundary,
  PAL_NIGHT_ANSWER_STORAGE_KEY,
  PAL_NIGHT_CHOICES,
  PAL_NIGHT_QUESTION,
  palNightChoice,
  palNightQuestionOpen,
  readPalNightAnswer,
  writePalNightAnswer,
} from "@/lib/palNightQuestion";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 19 October 2026 is British Summer Time, so London is UTC+1.
const LONDON_NOON = new Date("2026-10-19T11:00:00Z");
const LONDON_MORNING = new Date("2026-10-19T10:59:00Z");
const LONDON_LATE = new Date("2026-10-19T22:30:00Z");
const LONDON_SMALL_HOURS = new Date("2026-10-19T23:30:00Z");

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("the Pal's evening question", () => {
  it("asks from noon to midnight London time, and never in the small hours", () => {
    expect(palNightQuestionOpen(LONDON_MORNING)).toBe(false);
    expect(palNightQuestionOpen(LONDON_NOON)).toBe(true);
    expect(palNightQuestionOpen(LONDON_LATE)).toBe(true);
    expect(palNightQuestionOpen(LONDON_SMALL_HOURS)).toBe(false);
  });

  it("knows how long until the question next opens or closes", () => {
    // 11:59 London: one minute to noon. 23:30 London: half an hour to midnight.
    expect(msUntilPalNightBoundary(LONDON_MORNING)).toBe(60_000);
    expect(msUntilPalNightBoundary(LONDON_LATE)).toBe(30 * 60_000);
    expect(msUntilPalNightBoundary(LONDON_NOON)).toBe(12 * 60 * 60_000);
  });

  it("hands the planner a plan of the size it promises, cheapest first, for tonight", () => {
    const shapes = Object.fromEntries(PAL_NIGHT_CHOICES.map((choice) => {
      const { context } = inferNightContext(choice.plan, LONDON_NOON);
      return [choice.id, { stops: context.stopCount, budget: context.budget, daypart: context.daypart, atmosphere: context.atmosphere }];
    }));
    expect(shapes).toEqual({
      quiet: { stops: 2, budget: "value", daypart: "evening", atmosphere: ["quiet"] },
      sesh: { stops: 4, budget: "value", daypart: "evening", atmosphere: ["lively"] },
      carnage: { stops: 6, budget: "value", daypart: "evening", atmosphere: ["lively"] },
    });
  });

  it("is pub language with no swearing, no exclamation and never a drink count", () => {
    const lines = [PAL_NIGHT_QUESTION, ...PAL_NIGHT_CHOICES.flatMap((choice) => [choice.label, choice.hint, choice.reply])];
    for (const line of lines) {
      expect(line).not.toMatch(/!/);
      expect(line).not.toMatch(/[–—]/);
      expect(line).not.toMatch(/\b(?:fuck\w*|shit\w*|smashed|wasted|hammered)\b/i);
      // A plan of pubs, never a number of drinks or another round.
      expect(line).not.toMatch(/\b(?:drinks?|pints?|rounds?|shots?)\b/i);
    }
  });

  it("remembers the answer for the rest of the evening, and only that evening", () => {
    const storage = memoryStorage();
    writePalNightAnswer(storage, "sesh", LONDON_LATE);
    expect(readPalNightAnswer(storage, LONDON_LATE)?.id).toBe("sesh");
    // Half past midnight still belongs to the same night out.
    expect(readPalNightAnswer(storage, LONDON_SMALL_HOURS)?.id).toBe("sesh");
    expect(readPalNightAnswer(storage, new Date("2026-10-20T11:00:00Z"))).toBeNull();
    writePalNightAnswer(storage, null, LONDON_LATE);
    expect(readPalNightAnswer(storage, LONDON_LATE)).toBeNull();
  });

  it("leaves the device with the account, so the next person is asked afresh", () => {
    expect(DEVICE_IDENTITY_LOCAL_KEYS).toContain(PAL_NIGHT_ANSWER_STORAGE_KEY);
  });

  it("reads a damaged or unknown answer as no answer", () => {
    const storage = memoryStorage();
    storage.setItem(PAL_NIGHT_ANSWER_STORAGE_KEY, "{not json");
    expect(readPalNightAnswer(storage, LONDON_LATE)).toBeNull();
    storage.setItem(PAL_NIGHT_ANSWER_STORAGE_KEY, JSON.stringify({ evening: "2026-10-19", answer: "bender" }));
    expect(readPalNightAnswer(storage, LONDON_LATE)).toBeNull();
    expect(palNightChoice("bender")).toBeNull();
    expect(readPalNightAnswer(null, LONDON_LATE)).toBeNull();
  });
});

describe("the question on /pal", () => {
  let root: Root | null = null;
  let host: HTMLElement;

  async function render(muted = false) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(PalNightQuestion, { muted })));
    await act(async () => { await Promise.resolve(); });
  }

  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(LONDON_LATE);
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    vi.useRealTimers();
  });

  it("asks, and each answer opens a plan of that shape", async () => {
    await render();
    expect(host.textContent).toContain(PAL_NIGHT_QUESTION);
    const links = [...host.querySelectorAll<HTMLAnchorElement>("a.palChoice")];
    expect(links.map((link) => link.textContent)).toEqual([
      "Quiet coupleTwo pubs, nothing pricey",
      "Proper seshFour pubs, cheapest first",
      "Absolute carnageSix pubs, cheapest first",
    ]);
    expect(links.map((link) => new URL(link.href).searchParams.get("query"))).toEqual(PAL_NIGHT_CHOICES.map((choice) => choice.plan));
    expect(links.every((link) => new URL(link.href).pathname === "/plan")).toBe(true);
  });

  it("answers back, keeps the plan one tap away, and lets the person change their mind", async () => {
    await render();
    const sesh = [...host.querySelectorAll<HTMLAnchorElement>("a.palChoice")][1]!;
    sesh.addEventListener("click", (event) => event.preventDefault());
    await act(async () => sesh.click());
    expect(host.querySelector("[role='status']")?.textContent).toBe("Proper sesh it is. Four pubs, cheapest first.");
    const open = [...host.querySelectorAll<HTMLAnchorElement>("a")].find((link) => link.textContent === "Open the plan")!;
    expect(new URL(open.href).searchParams.get("query")).toBe("4 pubs tonight, lively and cheap");
    expect(JSON.parse(window.localStorage.getItem(PAL_NIGHT_ANSWER_STORAGE_KEY) ?? "null")?.answer).toBe("sesh");

    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Change my mind")!.click());
    expect(host.textContent).toContain(PAL_NIGHT_QUESTION);
    expect(window.localStorage.getItem(PAL_NIGHT_ANSWER_STORAGE_KEY)).toBeNull();
  });

  it("does not ask twice in one evening", async () => {
    writePalNightAnswer(window.localStorage, "quiet", LONDON_LATE);
    await render();
    expect(host.textContent).not.toContain(PAL_NIGHT_QUESTION);
    expect(host.querySelector("[role='status']")?.textContent).toBe("A quiet couple it is. Two pubs, nothing pricey.");
  });

  it("starts asking at noon on a page left open since the morning", async () => {
    vi.setSystemTime(LONDON_MORNING);
    await render();
    expect(host.querySelector("[data-testid='pal-night-question']")).toBeNull();
    await act(async () => { vi.advanceTimersByTime(2 * 60_000); });
    expect(host.textContent).toContain(PAL_NIGHT_QUESTION);
  });

  it("stops asking at midnight on a page left open since the evening", async () => {
    await render();
    expect(host.textContent).toContain(PAL_NIGHT_QUESTION);
    await act(async () => { vi.advanceTimersByTime(31 * 60_000); });
    expect(host.querySelector("[data-testid='pal-night-question']")).toBeNull();
  });

  it("takes an answer given in another tab, so it never asks twice", async () => {
    await render();
    expect(host.textContent).toContain(PAL_NIGHT_QUESTION);
    writePalNightAnswer(window.localStorage, "carnage", LONDON_LATE);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: PAL_NIGHT_ANSWER_STORAGE_KEY }));
    });
    expect(host.textContent).not.toContain(PAL_NIGHT_QUESTION);
    expect(host.querySelector("[role='status']")?.textContent).toBe(
      "Absolute carnage it is. Six pubs, cheapest first, and mind the last train.",
    );
  });

  it("asks nothing in the morning, in the small hours, or while the Pal is asleep", async () => {
    vi.setSystemTime(LONDON_MORNING);
    await render();
    expect(host.querySelector("[data-testid='pal-night-question']")).toBeNull();
    act(() => root?.unmount());
    host.remove();

    vi.setSystemTime(LONDON_SMALL_HOURS);
    await render();
    expect(host.querySelector("[data-testid='pal-night-question']")).toBeNull();
    act(() => root?.unmount());
    host.remove();

    vi.setSystemTime(LONDON_LATE);
    await render(true);
    expect(host.querySelector("[data-testid='pal-night-question']")).toBeNull();
  });
});
