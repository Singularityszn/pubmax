// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PubPal } from "@/lib/pubPal";

// The Pal's price quest on /near (components/nearme/NearPriceEvidenceMission.tsx)
// while the page stays open: another tab stamping the day, and an account
// switch. The mission, its form and the Pal are stood in for, so the test
// reads only what the quest decides.

const state = vi.hoisted(() => ({ pal: null as PubPal | null }));

vi.mock("@/components/pal/useOwnPal", () => ({ useOwnPal: () => state.pal }));
vi.mock("@/components/map/useCommunityPrices", () => ({ useCommunityPrices: () => ({}) }));
vi.mock("@/components/nearme/usePriceEvidenceMission", () => ({
  usePriceEvidenceMission: () => ({
    mission: { venueId: "venue-b", reason: "missing" },
    dismiss: vi.fn(),
    complete: vi.fn(),
  }),
}));
// The mission's form: one button that answers it, as a logged price does.
vi.mock("@/components/nearme/PriceEvidenceMissionSlot", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({ mission, onFulfilled }: { mission: { venueId: string }; onFulfilled: (m: unknown) => void }) =>
      h("button", { type: "button", className: "answer", onClick: () => onFulfilled(mission) }, "Log it"),
  };
});
vi.mock("@/components/pal/PubPalMascot", () => ({ PubPalMascot: () => null }));

import NearPriceEvidenceMission from "@/components/nearme/NearPriceEvidenceMission";
import { PAL_QUEST_STAMPS_KEY } from "@/lib/palQuest";
import { londonDayKey } from "@/lib/pintContributions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = "2026-01-01T12:00:00.000Z";
function palOf(id: string, ownerId: string, name: string): PubPal {
  return {
    id, ownerId, name, adultAttestedAt: now,
    appearance: { species: "robin", signalAffinity: "pint", material: "hologram", accessory: "none" },
    personality: { energy: 50, playfulness: 50, storytelling: 50, relationship: "guide" },
    voice: { id: "warm" }, muted: false, hidden: false, proposalPreferences: {}, masteryPoints: 0,
    createdAt: now, updatedAt: now,
  } as unknown as PubPal;
}
const ripley = palOf("aaaaaaaa-aaaa-4aaa-8aaa-000000000001", "owner-a", "Ripley");
const moss = palOf("aaaaaaaa-aaaa-4aaa-8aaa-000000000002", "owner-b", "Moss");
const cards = [
  { id: "venue-a", name: "The Lamb" },
  { id: "venue-b", name: "The Crown" },
] as never;

describe("the Pal's price quest while /near stays open", () => {
  let root: Root | null = null;
  let host: HTMLElement;
  const today = () => londonDayKey(new Date());

  async function render() {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(NearPriceEvidenceMission, { cards, enabled: true })));
    await settle();
  }
  async function rerender() {
    await act(async () => root!.render(createElement(NearPriceEvidenceMission, { cards, enabled: true })));
    await settle();
  }
  async function settle() {
    for (let turn = 0; turn < 4; turn += 1) await act(async () => { await Promise.resolve(); });
  }
  const quest = () => host.querySelector<HTMLElement>("[data-testid='pal-quest']");
  const answer = () => act(async () => host.querySelector<HTMLButtonElement>(".answer")!.click());
  // Another tab writes the book; this tab hears the storage event.
  function stampInAnotherTab(venueId: string, venueName: string) {
    window.localStorage.setItem(PAL_QUEST_STAMPS_KEY, JSON.stringify([{ day: today(), venueId, venueName }]));
    window.dispatchEvent(new StorageEvent("storage", { key: PAL_QUEST_STAMPS_KEY }));
  }

  beforeEach(() => {
    window.localStorage.clear();
    state.pal = ripley;
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    window.localStorage.clear();
  });

  it("asks, then lands this answer's own stamp", async () => {
    await render();
    expect(quest()?.dataset.state).toBe("ask");
    expect(quest()?.textContent).toContain("nobody has logged a price at The Crown");
    await answer();
    expect(quest()?.dataset.state).toBe("done");
    expect(quest()?.textContent).toContain("Ripley stamped The Crown in your book.");
  });

  it("stops asking when another tab stamps the day, and never claims that tab's pub", async () => {
    await render();
    expect(quest()?.dataset.state).toBe("ask");
    await act(async () => stampInAnotherTab("venue-a", "The Lamb"));
    await settle();
    expect(quest()).toBeNull();
    await answer();
    expect(quest()).toBeNull();
    expect(host.textContent).not.toContain("The Lamb");
  });

  it("claims nothing when another tab stamped the day before this one heard of it", async () => {
    await render();
    // Written with no storage event yet, as a race between two open tabs.
    window.localStorage.setItem(PAL_QUEST_STAMPS_KEY, JSON.stringify([{ day: today(), venueId: "venue-a", venueName: "The Lamb" }]));
    await answer();
    expect(quest()).toBeNull();
    expect(host.textContent).not.toContain("The Lamb");
  });

  it("starts afresh for the next account: the old stamp leaves and the new Pal asks", async () => {
    await render();
    await answer();
    expect(quest()?.textContent).toContain("Ripley stamped The Crown");
    // The account changes on this device: its identity keys go, the book with them.
    window.localStorage.removeItem(PAL_QUEST_STAMPS_KEY);
    state.pal = moss;
    await rerender();
    expect(host.textContent).not.toContain("Ripley");
    expect(quest()?.dataset.state).toBe("ask");
    expect(quest()?.textContent).toContain("Moss's quest for today");
  });
});
