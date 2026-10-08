// @vitest-environment jsdom

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    createElement("a", { href, className }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/plan",
  useRouter: () => ({
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => Promise.resolve(),
  }),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null, loading: false, identityResolved: true }),
}));

vi.mock("@/components/plan/PlanIntake", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanCultureOpener", () => ({ default: () => null }));
vi.mock("@/components/wanted/WantedPlanChips", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));

vi.mock("@/lib/analytics", () => ({
  trackEvent: () => undefined,
  trackMeaningfulCoreAction: () => undefined,
  laneSourceFromSearch: () => null,
}));

import PlanComposer, { planComposerVenueIndexPath } from "@/components/plan/PlanComposer";
import { readPlanningIntent, writePlanningIntent } from "@/lib/planningIntent";
import { parsePlanGenerationRequest } from "@/lib/planGenerationRequest";

const GENERATED = {
  routeRevision: 1,
  groundingProof: "test-proof",
  stops: [
    { venueId: "venue-a", venueName: "Pub A", reason: "Close to the heart of the area." },
    { venueId: "venue-b", venueName: "Pub B", reason: "0.6 km from the area centre." },
  ],
  inferredContext: { nightArea: "clapham", daypart: "evening", groupSize: 4 },
};

let root: Root | null = null;
let host: HTMLElement | null = null;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new Response(JSON.stringify(url.includes("/api/plans/generate") ? GENERATED : []), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/plan");
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => { current.unmount(); });
  }
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  });
}

async function mountComposer(): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(createElement(PlanComposer));
  });
  await settle();
}

function venueIndexReads(): number {
  const path = planComposerVenueIndexPath();
  return fetchMock.mock.calls.filter(([input]) => String(input) === path).length;
}

async function sortIt(query: string): Promise<void> {
  const field = document.querySelector<HTMLInputElement>("#plan-describe-first-query")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, query);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Sort it")!.click();
    await Promise.resolve();
  });
  await settle();
  await vi.waitFor(() => {
    if (!document.querySelector(".planStop")) throw new Error("the stop cards have not mounted");
  }, { timeout: 4000 });
}

describe("the Plan result", () => {
  it("reads the venue index and draws its datalist only once the composer is up", async () => {
    await mountComposer();
    expect(document.querySelector("#plan-describe-first-query")).not.toBeNull();
    expect(document.querySelector("#plan-venue-options")).toBeNull();
    expect(venueIndexReads()).toBe(0);

    await sortIt("Quiet in Clapham for 4");

    expect(document.querySelector("#plan-composer #plan-venue-options")).not.toBeNull();
    expect(venueIndexReads()).toBe(1);
  });

  it("keeps the area the route was sorted for when the night's area is changed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    onTestFinished(() => { vi.useRealTimers(); });
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    const heading = () => document.querySelector("#plan-result-title")?.textContent;
    expect(heading()).toBe("Tonight in Clapham");

    const tune = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Tune details"))!;
    await act(async () => { tune.click(); });
    await vi.waitFor(() => {
      if (!document.querySelector("#plan-context-area")) throw new Error("Tune details has not mounted");
    }, { timeout: 4000 });
    const area = document.querySelector<HTMLSelectElement>("#plan-context-area")!;
    await act(async () => {
      area.value = "victoria";
      area.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(area.value).toBe("victoria");
    expect(heading()).toBe("Tonight in Clapham");
    const meta = [...document.querySelectorAll(".planStop__meta")].map((node) => node.textContent);
    expect(meta).toEqual(["Clapham", "Clapham"]);
  });
});

async function openTune(): Promise<void> {
  const tune = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Tune details"))!;
  // A real click focuses the button, so it is the focus the sheet returns to.
  await act(async () => { tune.focus(); tune.click(); });
  await vi.waitFor(() => {
    if (!document.querySelector("[role='dialog'] #plan-concierge-query")) throw new Error("Tune details has not mounted");
    // The sheet takes focus a frame after it opens. A press before that frame
    // would have its focus taken back, which no reader's tap can hit.
    if (document.activeElement?.getAttribute("role") !== "dialog") throw new Error("Tune details has not taken focus");
  }, { timeout: 4000 });
}

async function sortAgainFromTune(): Promise<void> {
  const again = [...document.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((button) => button.textContent === "Sort it again")!;
  await act(async () => { again.click(); });
  await settle();
  await settle();
}

describe("sorting again from Tune details", () => {
  it("closes the sheet and lands focus on the new route's status", async () => {
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    await openTune();

    await sortAgainFromTune();

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement?.id).toBe("plan-route-status");
  });

  it("keeps the busy button focusable while the sort is in flight, and a second press asks nothing", async () => {
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    await openTune();
    let answer: (response: Response) => void = () => undefined;
    fetchMock.mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.includes("/api/plans/generate")
        ? new Promise<Response>((resolve) => { answer = resolve; })
        : Promise.resolve(new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    });
    const generateCalls = () => fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/plans/generate")).length;
    const before = generateCalls();

    const again = [...document.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((button) => button.textContent === "Sort it again")!;
    await act(async () => { again.focus(); again.click(); });
    await settle();

    // A disabled button cannot hold focus, so the browser would drop it to the
    // page body while the sheet is still open.
    expect(again.textContent).toBe("Planning…");
    expect(again.disabled).toBe(false);
    expect(again.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(again);
    await act(async () => { again.click(); });
    await settle();
    expect(generateCalls()).toBe(before + 1);

    await act(async () => {
      answer(new Response(JSON.stringify(GENERATED), { status: 200, headers: { "content-type": "application/json" } }));
    });
    await settle();
    await settle();
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement?.id).toBe("plan-route-status");
  });

  it("closes the sheet on a failed sort, so the failure is not hidden behind it", async () => {
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    await openTune();
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.includes("/api/plans/generate")
        ? new Response(JSON.stringify({ error: { message: "Generator down" } }), { status: 500, headers: { "content-type": "application/json" } })
        : new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    });

    await sortAgainFromTune();

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector("#plan-composer .planComposer__error[role='alert']")).not.toBeNull();
  });
});

describe("a refresh that comes back with no route", () => {
  it.each([
    ["no pubs match", { stops: [] }, "No venues matched that ask. Try a nearby area or a broader mood."],
    ["the kept pub is in the way", { outcome: "anchor-conflict", message: "That pub is shut at that time." }, "That pub is shut at that time."],
  ])("keeps the route and says why when %s", async (_case, answer, said) => {
    await mountComposer();
    await sortIt("Quiet in Clapham for 4");
    await openTune();
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(JSON.stringify(url.includes("/api/plans/generate") ? answer : []), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await sortAgainFromTune();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector("#plan-route-status")?.textContent).toBe(said);
    expect([...document.querySelectorAll(".planStop__name")].map((node) => node.textContent)).toEqual(["Pub A", "Pub B"]);
  });
});

describe("an accepted place the venue index has no name for", () => {
  const HELD = "venue-held";

  function holdAcceptedPlace(): void {
    writePlanningIntent({
      source: "near",
      cityId: "london",
      acceptedVenueId: HELD,
      acceptedArea: { kind: "night-patch", id: "soho" },
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });
  }

  function serveIndex(...reads: Array<unknown[] | number>): void {
    const path = planComposerVenueIndexPath("london");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== path) return new Response("{}", { status: 404 });
      const read = reads.length > 1 ? reads.shift()! : reads[0]!;
      return typeof read === "number"
        ? new Response("<html></html>", { status: read })
        : new Response(JSON.stringify(read), { status: 200, headers: { "content-type": "application/json" } });
    }));
  }

  const firstStop = () => document.querySelectorAll<HTMLLIElement>("li.planStop")[0]!;
  const stopNames = () => [...document.querySelectorAll("li.planStop")].map((card) =>
    card.querySelector(".planStop__name")?.textContent ?? card.querySelector<HTMLInputElement>(".planStop__find")?.getAttribute("aria-label"));
  const panel = () => document.querySelector("[aria-label='Accepted plan context']");
  const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`)!;

  async function click(target: HTMLElement): Promise<void> {
    await act(async () => { target.click(); });
    await settle();
  }

  // The cards are their own chunk. Wait for them, so a test never passes only
  // because an earlier test in the file had already loaded it.
  async function mountHeld(): Promise<void> {
    await mountComposer();
    await vi.waitFor(() => {
      if (!document.querySelector("li.planStop")) throw new Error("the stop cards have not mounted");
    }, { timeout: 4000 });
  }

  it("shows a held place that is not a pub as a card, and Swap releases it for a pub of the reader's choosing", async () => {
    holdAcceptedPlace();
    serveIndex([
      { id: HELD, name: "The Cocktail Den", kind: "bar" },
      { id: "venue-anchor", name: "The Anchor", kind: "pub" },
    ]);
    await mountHeld();

    expect(stopNames()).toEqual(["Your chosen place"]);
    expect(panel()).not.toBeNull();
    const swap = button("Swap stop 1, currently your chosen place");
    expect(swap.disabled).toBe(false);

    await click(swap);

    const finder = firstStop().querySelector<HTMLInputElement>(".planStop__find")!;
    expect(finder.getAttribute("aria-label")).toBe("Find a pub for stop 1");
    expect(document.activeElement).toBe(finder);
    expect(panel()).toBeNull();
    expect(readPlanningIntent()).toBeNull();

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(finder, "The Anchor");
      finder.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
    });
    await settle();

    expect(stopNames()).toEqual(["The Anchor"]);
    expect(document.querySelector("#plan-route-status")?.textContent).toBe("Stop chosen. Refresh the route before locking.");
  });

  it("releases a held place that is not a pub into a pub finder, and the next pick is kept", async () => {
    holdAcceptedPlace();
    serveIndex([
      { id: HELD, name: "The Cocktail Den", kind: "bar" },
      { id: "venue-anchor", name: "The Anchor", kind: "pub" },
    ]);
    await mountHeld();
    expect(stopNames()).toEqual(["Your chosen place"]);

    await click([...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Release this pub")!);

    expect(stopNames()).toEqual(["Find a pub for stop 1"]);
    expect(panel()).toBeNull();
    expect(readPlanningIntent()).toBeNull();

    const finder = firstStop().querySelector<HTMLInputElement>(".planStop__find")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(finder, "The Anchor");
      finder.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
    });
    await settle();

    expect(stopNames()).toEqual(["The Anchor"]);
    expect(document.querySelector("#plan-route-status")?.textContent).toBe("Stop chosen. Refresh the route before locking.");
  });

  it("removes a held place that is not a pub, and the acceptance goes with it", async () => {
    holdAcceptedPlace();
    serveIndex([{ id: HELD, name: "The Cocktail Den", kind: "bar" }]);
    await mountHeld();

    await click([...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Add another stop")!);
    const remove = button("Remove stop 1");
    expect(remove.disabled).toBe(false);

    await click(remove);

    expect(stopNames()).toEqual(["Find a pub for stop 1"]);
    expect(panel()).toBeNull();
    expect(readPlanningIntent()).toBeNull();
    expect(document.querySelector("#plan-route-status")?.textContent).toBe("Stop 1 removed. Refresh the route before locking.");
  });

  it("keeps the held place locked while the venue index is still being read", async () => {
    holdAcceptedPlace();
    const path = planComposerVenueIndexPath("london");
    let deliver: ((response: Response) => void) | null = null;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== path) return new Response("{}", { status: 404 });
      return new Promise<Response>((resolve) => { deliver = resolve; });
    }));
    await mountHeld();
    await click([...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Add another stop")!);

    expect(stopNames()).toEqual(["Your chosen place", "Find a pub for stop 2"]);
    const swap = button("Your chosen place is the accepted Stop 1. Swap is not available.");
    const remove = button("Your chosen place is the accepted Stop 1. Remove is not available.");
    expect(swap.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    await act(async () => {
      firstStop().querySelector<HTMLElement>(".planStop__open")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(stopNames()).toEqual(["Your chosen place", "Find a pub for stop 2"]);

    expect(deliver).not.toBeNull();
    await act(async () => {
      deliver!(new Response(JSON.stringify([{ id: HELD, name: "The Held Arms" }]), { status: 200, headers: { "content-type": "application/json" } }));
    });
    await settle();

    expect(stopNames()).toEqual(["The Held Arms", "Find a pub for stop 2"]);
    expect(button("The Held Arms is the accepted Stop 1. Swap is not available.").disabled).toBe(true);
    expect(panel()?.textContent).toContain("The Held Arms");
    expect(readPlanningIntent()?.acceptedVenueId).toBe(HELD);
  });

  it("keeps a pub released while the index was still loading released when the index arrives", async () => {
    holdAcceptedPlace();
    const path = planComposerVenueIndexPath("london");
    let deliver: ((response: Response) => void) | null = null;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== path) return new Response("{}", { status: 404 });
      return new Promise<Response>((resolve) => { deliver = resolve; });
    }));
    await mountHeld();

    await click([...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Release this pub")!);
    expect(stopNames()).toEqual(["Find a pub for stop 1"]);

    await act(async () => {
      deliver!(new Response(JSON.stringify([{ id: HELD, name: "The Held Arms" }]), { status: 200, headers: { "content-type": "application/json" } }));
    });
    await settle();

    expect(stopNames()).toEqual(["Find a pub for stop 1"]);
    expect(panel()).toBeNull();
  });

  it("says when the venue index did not load, and a retry names the held pub and keeps it held", async () => {
    holdAcceptedPlace();
    serveIndex(503, [{ id: HELD, name: "The Held Arms" }]);
    await mountHeld();

    const alert = document.querySelector("#plan-composer [role='alert']");
    expect(alert?.textContent).toContain("The pub list did not load.");
    expect(stopNames()).toEqual(["Your chosen place"]);

    await click([...alert!.querySelectorAll("button")].find((node) => node.textContent === "Try again")!);

    expect(document.querySelector("#plan-composer [role='alert']")).toBeNull();
    expect(stopNames()).toEqual(["The Held Arms"]);
    expect(button("The Held Arms is the accepted Stop 1. Swap is not available.").disabled).toBe(true);
    expect(firstStop().querySelector(".planStop__remove")).toBeNull();
    expect(panel()?.textContent).toContain("The Held Arms");
  });

  it("makes a plan from a typed description while a pub is held", async () => {
    holdAcceptedPlace();
    const path = planComposerVenueIndexPath("london");
    const generated = { ...GENERATED, stops: [{ venueId: HELD, venueName: "The Held Arms", reason: "Your pick." }, GENERATED.stops[1]] };
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === path) {
        return new Response(JSON.stringify([{ id: HELD, name: "The Held Arms" }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (!url.includes("/api/plans/generate")) return new Response("{}", { status: 404 });
      sent.push(JSON.parse(String(init?.body)));
      // The route's own request parser, so the composer is held to what the API accepts.
      const parsed = await parsePlanGenerationRequest(new Request("http://localhost/api/plans/generate", { method: "POST", body: init?.body }));
      return parsed.ok
        ? new Response(JSON.stringify(generated), { status: 200, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify({ error: { code: parsed.code, message: parsed.message } }), { status: parsed.status, headers: { "content-type": "application/json" } });
    }));
    await mountHeld();

    const field = document.querySelector<HTMLInputElement>("#plan-concierge-query")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "quiet pints after work");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click([...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Make a plan")!);
    await vi.waitFor(() => {
      if (stopNames().length < 2) throw new Error(`the generated route has not mounted: ${document.querySelector("#plan-composer [role='alert']")?.textContent ?? ""}`);
    }, { timeout: 4000 });

    expect(stopNames()).toEqual(["The Held Arms", "Pub B"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      query: "quiet pints after work",
      anchor: { venueId: HELD, acceptedArea: { kind: "night-patch", id: "soho" } },
      intake: {
        area: { kind: "night-patch", id: "soho" },
        timeWindow: null,
        groupSize: null,
        budget: null,
        skipped: ["time-window", "group-size", "budget", "accessibility"],
      },
    });
    expect(panel()?.textContent).toContain("The Held Arms");
  });

  it("does not call a held pub on its own a route that needs a refresh when the sort fails", async () => {
    // A pub accepted from the map carries no area, and the description names none.
    writePlanningIntent({
      source: "near",
      cityId: "london",
      acceptedVenueId: HELD,
      acceptedArea: null,
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });
    const path = planComposerVenueIndexPath("london");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === path) {
        return new Response(JSON.stringify([{ id: HELD, name: "The Held Arms" }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: { code: "NIGHT_AREA_REQUIRED", message: "Choose an area." } }), { status: 422, headers: { "content-type": "application/json" } });
    }));
    await mountHeld();

    const field = document.querySelector<HTMLInputElement>("#plan-concierge-query")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Three quiet pints for 4");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click([...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Make a plan")!);
    await vi.waitFor(() => {
      if (!document.querySelector("#plan-composer [role='alert']")) throw new Error("the failure has not been shown");
    }, { timeout: 4000 });

    expect(document.querySelector("#plan-composer [role='alert']")?.textContent).toBe("Choose an area.");
    expect(document.querySelector("#plan-route-status")?.textContent).toBe("Choose an area.");
    expect(document.querySelector(".planComposer__routeStale")).toBeNull();
    expect(stopNames()).toEqual(["The Held Arms"]);
  });
});
