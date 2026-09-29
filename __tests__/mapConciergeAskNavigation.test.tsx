// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const askSession = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null }),
}));
vi.mock("@/components/pal/PubPalMascot", () => ({
  PubPalMascot: () => createElement("span", null, "Pal"),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/conciergeAskClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/conciergeAskClient")>()),
  createAskSession: () => askSession,
}));

import MapConciergeAsk from "@/components/map/MapConciergeAsk";

let container: HTMLDivElement;
let root: Root | null;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  router.push.mockReset();
  askSession.mockReset().mockResolvedValue({
    status: "answered",
    message: "A plan is ready to open.",
    cards: [],
    responseStatus: "ready",
    proposals: [{
      id: "draft-soho",
      kind: "draft_plan",
      label: "Open in Plan",
      query: "Plan a crawl in Soho for 4",
      stopIds: ["venue-a"],
      stopNames: ["The Anchor"],
    }],
  });
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(MapConciergeAsk, {
      cityId: "london",
      onSelectVenue: vi.fn(),
    }));
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
});

describe("map Ask proposal navigation", () => {
  it("writes the confirmed draft before client-side Plan navigation", async () => {
    const expand = container.querySelector<HTMLButtonElement>(".mapConciergeAskPill");
    if (!expand) throw new Error("Map Ask control not found");
    await act(async () => expand.click());

    const example = [...container.querySelectorAll<HTMLButtonElement>(".mapConciergeAskChip")]
      .find((button) => button.textContent === "Plan a crawl in Soho for 4");
    if (!example) throw new Error("Plan example not found");
    await act(async () => example.click());

    const confirm = container.querySelector<HTMLButtonElement>(".mapConciergeAskProposalConfirm");
    if (!confirm) throw new Error("Plan proposal not found");
    await act(async () => confirm.click());

    expect(router.push).toHaveBeenCalledWith("/plan");
    expect(sessionStorage.getItem("pubmax:ask-plan-draft:v1")).toContain("venue-a");
  });
});
