// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/pal",
}));
const crew = vi.hoisted(() => ({
  token: "0123456789abcdef0123456789abcdef" as string | null,
  // When set, the token read waits on this until the test resolves it.
  pending: null as Promise<string | null> | null,
  outcome: "shared" as "shared" | "cancelled" | "whatsapp" | "failed",
  shared: [] as Array<{ title: string; text: string; url: string }>,
}));
vi.mock("@/lib/planInviteTokenClient", () => ({ ensurePlanInviteToken: async () => (crew.pending ? await crew.pending : crew.token) }));
vi.mock("@/lib/shareSheet", () => ({
  shareNightObject: async (input: { title: string; text: string; url: string }) => {
    crew.shared.push(input);
    return crew.outcome;
  },
}));

import PalNightQuestion from "@/components/pal/PalNightQuestion";
import { writeActivePlan } from "@/lib/activePlan";
import { DEVICE_IDENTITY_LOCAL_KEYS } from "@/lib/deviceAccountIdentity";
import { inferNightContext } from "@/lib/nightPlanning";
import {
  msUntilPalNightBoundary,
  PAL_NIGHT_ANSWER_STORAGE_KEY,
  PAL_NIGHT_CHOICES,
  PAL_NIGHT_QUESTION,
  palNightChoice,
  palNightInviteText,
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

  it("lands on London noon on both clock-change days", () => {
    // 29 March 2026, 00:30 GMT: the clocks go forward at 01:00, so noon BST is 10.5 hours away.
    const spring = new Date("2026-03-29T00:30:00Z");
    expect(msUntilPalNightBoundary(spring)).toBe(10.5 * 60 * 60_000);
    expect(new Date(spring.getTime() + msUntilPalNightBoundary(spring)).toISOString()).toBe("2026-03-29T11:00:00.000Z");
    // 25 October 2026, 00:30 BST: the clocks go back at 02:00, so noon GMT is 12.5 hours away.
    const autumn = new Date("2026-10-24T23:30:00Z");
    expect(msUntilPalNightBoundary(autumn)).toBe(12.5 * 60 * 60_000);
    expect(new Date(autumn.getTime() + msUntilPalNightBoundary(autumn)).toISOString()).toBe("2026-10-25T12:00:00.000Z");
    // The evening before each change still closes at London midnight.
    expect(msUntilPalNightBoundary(new Date("2026-03-28T23:30:00Z"))).toBe(30 * 60_000);
    expect(msUntilPalNightBoundary(new Date("2026-10-24T22:30:00Z"))).toBe(30 * 60_000);
  });

  it("hands the planner a plan of the size, mood and value budget it promises, for tonight", () => {
    const shapes = Object.fromEntries(PAL_NIGHT_CHOICES.map((choice) => {
      const { context } = inferNightContext(choice.plan, LONDON_NOON);
      return [choice.id, { stops: context.stopCount, budget: context.budget, daypart: context.daypart, atmosphere: context.atmosphere }];
    }));
    expect(shapes).toEqual({
      quiet: { stops: 2, budget: "value", daypart: "evening", atmosphere: ["quiet"] },
      big: { stops: 4, budget: "value", daypart: "evening", atmosphere: ["lively"] },
      loud: { stops: 4, budget: "value", daypart: "evening", atmosphere: ["lively", "music"] },
    });
  });

  it("is pub language with no swearing, no exclamation and never a drink count", () => {
    const lines = [
      PAL_NIGHT_QUESTION,
      ...PAL_NIGHT_CHOICES.flatMap((choice) => [choice.label, choice.hint, choice.reply]), palNightInviteText("Ripley"),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/!/);
      expect(line).not.toMatch(/[–—]/);
      expect(line).not.toMatch(/\b(?:fuck\w*|shit\w*|smashed|wasted|hammered|carnage|sesh|session)\b/i);
      // A plan of pubs, never a number of drinks or another round. "Quiet
      // pint" is the approved CAP label for the calm night, not a count.
      expect(line.replace(/\bquiet pint\b/gi, "")).not.toMatch(/\b(?:drinks?|pints?|rounds?|shots?)\b/i);
    }
  });

  it("never offers a night of more than four pubs", () => {
    for (const choice of PAL_NIGHT_CHOICES) {
      expect(inferNightContext(choice.plan, LONDON_NOON).context.stopCount).toBeLessThanOrEqual(4);
    }
  });

  it("remembers the answer for the rest of the evening, and only that evening", () => {
    const storage = memoryStorage();
    writePalNightAnswer(storage, "big", LONDON_LATE);
    expect(readPalNightAnswer(storage, LONDON_LATE)?.id).toBe("big");
    // Half past midnight still belongs to the same night out.
    expect(readPalNightAnswer(storage, LONDON_SMALL_HOURS)?.id).toBe("big");
    expect(readPalNightAnswer(storage, new Date("2026-10-20T11:00:00Z"))).toBeNull();
    writePalNightAnswer(storage, null, LONDON_LATE);
    expect(readPalNightAnswer(storage, LONDON_LATE)).toBeNull();
  });

  it("invites the crew to tonight in the Pal's name, never to a price, a count or the evening's answer", () => {
    expect(palNightInviteText("Ripley")).toBe("Ripley's got a plan for tonight. Open the link and tap Going.");
    expect(palNightInviteText("  ")).toBe("My Pal's got a plan for tonight. Open the link and tap Going.");
    expect(palNightInviteText("Ripley")).not.toMatch(/\d|£/);
    // The saved plan may not be the one the answer made, so the words never name the answer.
    for (const choice of PAL_NIGHT_CHOICES) expect(palNightInviteText("Ripley").toLowerCase()).not.toContain(choice.label.toLowerCase());
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
    await act(async () => root!.render(createElement(PalNightQuestion, { muted, palName: "Ripley" })));
    await act(async () => { await Promise.resolve(); });
  }

  beforeEach(() => {
    window.localStorage.clear();
    crew.token = "0123456789abcdef0123456789abcdef";
    crew.outcome = "shared";
    crew.shared = [];
    crew.pending = null;
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
      "Quiet pintTwo quiet pubs, on a budget",
      "Big one tonightFour lively pubs, on a budget",
      "Live and loudFour pubs with music or a lively crowd, on a budget",
    ]);
    expect(links.map((link) => new URL(link.href).searchParams.get("query"))).toEqual(PAL_NIGHT_CHOICES.map((choice) => choice.plan));
    expect(links.every((link) => new URL(link.href).pathname === "/plan")).toBe(true);
  });

  it("answers back, keeps the plan one tap away, and lets the person change their mind", async () => {
    await render();
    const bigOne = [...host.querySelectorAll<HTMLAnchorElement>("a.palChoice")][1]!;
    bigOne.addEventListener("click", (event) => event.preventDefault());
    await act(async () => bigOne.click());
    expect(host.querySelector("[role='status']")?.textContent).toBe("A big one it is. Four lively pubs, on a budget, and mind the last train.");
    const open = [...host.querySelectorAll<HTMLAnchorElement>("a")].find((link) => link.textContent === "Open the plan")!;
    expect(new URL(open.href).searchParams.get("query")).toBe("4 pubs tonight, lively and cheap");
    expect(JSON.parse(window.localStorage.getItem(PAL_NIGHT_ANSWER_STORAGE_KEY) ?? "null")?.answer).toBe("big");

    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Change my mind")!.click());
    expect(host.textContent).toContain(PAL_NIGHT_QUESTION);
    expect(window.localStorage.getItem(PAL_NIGHT_ANSWER_STORAGE_KEY)).toBeNull();
  });

  describe("Who's coming?", () => {
    const PLAN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const whoButton = () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Who's coming?");
    const whoLink = () => [...host.querySelectorAll<HTMLAnchorElement>("a")].find((link) => link.textContent === "Who's coming?");

    function tonightsPlan(role: "host" | "guest" | null = "host") {
      writeActivePlan({ id: PLAN_ID, startTime: new Date(LONDON_LATE.getTime() - 60 * 60_000).toISOString(), stopIndex: 0, role });
    }

    it("holds Who's coming? until the crew link is read, so a quick tap never takes the fallback", async () => {
      writePalNightAnswer(window.localStorage, "big", LONDON_LATE);
      let resolveToken: (token: string | null) => void = () => undefined;
      crew.pending = new Promise((resolve) => { resolveToken = resolve; });
      tonightsPlan();
      await render();
      expect(whoLink()).toBeUndefined();
      const held = whoButton()!;
      expect(held.disabled).toBe(true);
      expect(held.getAttribute("aria-busy")).toBe("true");
      await act(async () => held.click());
      expect(crew.shared).toHaveLength(0);
      await act(async () => {
        resolveToken("0123456789abcdef0123456789abcdef");
        await Promise.resolve();
        await Promise.resolve();
      });
      const ready = whoButton()!;
      expect(ready.disabled).toBe(false);
      expect(ready.hasAttribute("aria-busy")).toBe(false);
      await act(async () => ready.click());
      expect(crew.shared).toHaveLength(1);
      expect(new URL(crew.shared[0]!.url).pathname).toBe("/invite/0123456789abcdef0123456789abcdef");
    });

    it("opens the plan's own invite tools when the crew link read fails", async () => {
      writePalNightAnswer(window.localStorage, "big", LONDON_LATE);
      crew.pending = Promise.reject(new Error("offline"));
      tonightsPlan();
      await render();
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(whoButton()).toBeUndefined();
      expect(new URL(whoLink()!.href).hash).toBe("#share");
    });

    it("is not offered before tonight's plan is saved", async () => {
      writePalNightAnswer(window.localStorage, "big", LONDON_LATE);
      await render();
      expect(whoButton()).toBeUndefined();
      expect(whoLink()).toBeUndefined();
    });

    it("shares tonight's real crew link in the Pal's words", async () => {
      writePalNightAnswer(window.localStorage, "big", LONDON_LATE);
      tonightsPlan();
      await render();
      await act(async () => { await Promise.resolve(); });
      await act(async () => whoButton()!.click());
      expect(crew.shared).toHaveLength(1);
      expect(crew.shared[0]!.text).toBe("Ripley's got a plan for tonight. Open the link and tap Going.");
      // ONE LINK: the same public invite page every host share sends.
      expect(new URL(crew.shared[0]!.url).pathname).toBe("/invite/0123456789abcdef0123456789abcdef");
      expect(new URL(crew.shared[0]!.url).hash).toBe("");
      expect(host.textContent).toContain("Sent. Now they tap Going.");
      // With tonight's plan saved, Open the plan goes to it, never to a fresh one.
      const open = [...host.querySelectorAll<HTMLAnchorElement>("a")].find((link) => link.textContent === "Open the plan")!;
      expect(new URL(open.href).pathname).toBe(`/plan/${PLAN_ID}`);
      expect(new URL(open.href).search).toBe("");
    });

    it("opens the plan's own invite tools when there is no crew link to hand out", async () => {
      crew.token = null;
      writePalNightAnswer(window.localStorage, "loud", LONDON_LATE);
      tonightsPlan("guest");
      await render();
      await act(async () => { await Promise.resolve(); });
      expect(whoButton()).toBeUndefined();
      expect(new URL(whoLink()!.href).pathname).toBe(`/plan/${PLAN_ID}`);
      expect(new URL(whoLink()!.href).hash).toBe("#share");
    });

    it("points to the plan when the share does not go, and says nothing for a closed sheet", async () => {
      writePalNightAnswer(window.localStorage, "quiet", LONDON_LATE);
      tonightsPlan();
      crew.outcome = "cancelled";
      await render();
      await act(async () => { await Promise.resolve(); });
      await act(async () => whoButton()!.click());
      expect(host.textContent).not.toContain("Sent.");
      crew.outcome = "failed";
      await act(async () => whoButton()!.click());
      const fallback = [...host.querySelectorAll<HTMLAnchorElement>("a")].find((link) => link.textContent === "Send it from the plan")!;
      expect(new URL(fallback.href).hash).toBe("#share");
    });

    it("says a WhatsApp draft is ready to send, never that it was sent", async () => {
      writePalNightAnswer(window.localStorage, "big", LONDON_LATE);
      tonightsPlan();
      crew.outcome = "whatsapp";
      await render();
      await act(async () => { await Promise.resolve(); });
      await act(async () => whoButton()!.click());
      expect(host.textContent).not.toContain("Sent.");
      expect(host.textContent).toContain("Ready in WhatsApp. Send it, then they tap Going.");
    });

    it("forgets the last share when another tab swaps tonight's plan", async () => {
      writePalNightAnswer(window.localStorage, "big", LONDON_LATE);
      tonightsPlan();
      await render();
      await act(async () => { await Promise.resolve(); });
      await act(async () => whoButton()!.click());
      expect(host.textContent).toContain("Sent. Now they tap Going.");
      await act(async () => {
        writeActivePlan({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", startTime: new Date(LONDON_LATE.getTime() - 60 * 60_000).toISOString(), stopIndex: 0, role: "host" });
        await Promise.resolve();
      });
      await act(async () => { await Promise.resolve(); });
      expect(whoButton()).toBeDefined();
      expect(host.textContent).not.toContain("Sent.");
    });

    it("stops offering last night's plan on a page left open past its window", async () => {
      writePalNightAnswer(window.localStorage, "big", LONDON_LATE);
      tonightsPlan();
      await render();
      expect(whoButton()).toBeDefined();
      // To the next London noon: the plan's window closed at 05:30 and the question opens again.
      await act(async () => { vi.advanceTimersByTime(13 * 60 * 60_000); });
      await act(async () => { await Promise.resolve(); });
      expect(host.textContent).toContain(PAL_NIGHT_QUESTION);
      const bigOne = [...host.querySelectorAll<HTMLAnchorElement>("a.palChoice")][1]!;
      bigOne.addEventListener("click", (event) => event.preventDefault());
      await act(async () => bigOne.click());
      expect(whoButton()).toBeUndefined();
      expect(whoLink()).toBeUndefined();
      const open = [...host.querySelectorAll<HTMLAnchorElement>("a")].find((link) => link.textContent === "Open the plan")!;
      expect(new URL(open.href).pathname).toBe("/plan");
    });

    it("drops a plan whose window closes while its crew link is still being read", async () => {
      writePalNightAnswer(window.localStorage, "big", LONDON_LATE);
      let resolveToken: (token: string | null) => void = () => undefined;
      crew.pending = new Promise((resolve) => { resolveToken = resolve; });
      // The plan's window closes at 23:35 London, five minutes from now.
      writeActivePlan({ id: PLAN_ID, startTime: new Date(LONDON_LATE.getTime() - (8 * 60 - 5) * 60_000).toISOString(), stopIndex: 0, role: "host" });
      await render();
      expect(whoButton()?.disabled).toBe(true);
      await act(async () => { vi.advanceTimersByTime(6 * 60_000); });
      expect(whoLink()).toBeUndefined();
      await act(async () => {
        resolveToken("0123456789abcdef0123456789abcdef");
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(whoButton()).toBeUndefined();
      expect(whoLink()).toBeUndefined();
    });

    it("starts offering the crew link when tonight's plan window opens on a page left open", async () => {
      writePalNightAnswer(window.localStorage, "big", LONDON_LATE);
      // The plan starts at 02:40 London, so its window opens at 23:40.
      writeActivePlan({ id: PLAN_ID, startTime: new Date(LONDON_LATE.getTime() + (3 * 60 + 10) * 60_000).toISOString(), stopIndex: 0, role: "host" });
      await render();
      expect(whoButton()).toBeUndefined();
      await act(async () => { vi.advanceTimersByTime(11 * 60_000); });
      await act(async () => { await Promise.resolve(); });
      expect(whoButton()).toBeDefined();
    });

    it("is not offered for a plan with no seat on it", async () => {
      writePalNightAnswer(window.localStorage, "big", LONDON_LATE);
      tonightsPlan(null);
      await render();
      expect(whoButton()).toBeUndefined();
      expect(whoLink()).toBeUndefined();
    });
  });

  it("does not ask twice in one evening", async () => {
    writePalNightAnswer(window.localStorage, "quiet", LONDON_LATE);
    await render();
    expect(host.textContent).not.toContain(PAL_NIGHT_QUESTION);
    expect(host.querySelector("[role='status']")?.textContent).toBe("A quiet pint it is. Two quiet pubs, on a budget.");
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
    writePalNightAnswer(window.localStorage, "loud", LONDON_LATE);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: PAL_NIGHT_ANSWER_STORAGE_KEY }));
    });
    expect(host.textContent).not.toContain(PAL_NIGHT_QUESTION);
    expect(host.querySelector("[role='status']")?.textContent).toBe(
      "Live and loud it is. Four pubs with music or a lively crowd, on a budget, and mind the last train.",
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
