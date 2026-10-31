// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PubPal } from "@/lib/pubPal";

// The Pal's own usage events: the quest asked, the stamp landed, the passport
// opened and the lead begun. Each is a closed name with no props, and each
// counts the moment once. The mission, its form and the mascot are stood in
// for, so the test reads only when each event fires.

const state = vi.hoisted(() => ({
  pal: null as PubPal | null,
  track: [] as { name: string; props: unknown }[],
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: (name: string, props?: unknown) => state.track.push({ name, props }),
}));
vi.mock("@/components/pal/useOwnPal", () => ({ useOwnPal: () => state.pal }));
vi.mock("@/components/map/useCommunityPrices", () => ({ useCommunityPrices: () => ({}) }));
vi.mock("@/components/nearme/usePriceEvidenceMission", () => ({
  usePriceEvidenceMission: () => ({
    mission: { venueId: "venue-b", reason: "missing" },
    dismiss: vi.fn(),
    complete: vi.fn(),
  }),
}));
vi.mock("@/components/nearme/PriceEvidenceMissionSlot", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({ mission, onFulfilled }: { mission: { venueId: string }; onFulfilled: (m: unknown) => void }) =>
      h("button", { type: "button", className: "answer", onClick: () => onFulfilled(mission) }, "Log it"),
  };
});
vi.mock("@/components/pal/PubPalMascot", () => ({ PubPalMascot: () => null }));

import NearPriceEvidenceMission from "@/components/nearme/NearPriceEvidenceMission";
import PalQuestStamps from "@/components/pal/PalQuestStamps";
import { usePalLeadStarted } from "@/components/pal/usePalLeadStarted";
import { ANALYTICS_EVENTS, sanitizeEvent } from "@/lib/analyticsEvents";
import { LOCAL_PAL_KEY } from "@/lib/localPal";
import { PAL_QUEST_STAMPS_KEY } from "@/lib/palQuest";
import { londonDayKey } from "@/lib/pintContributions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAL_EVENTS = ["pal_quest_asked", "pal_quest_stamped", "pal_passport_viewed", "pal_lead_started"] as const;

const now = "2026-01-01T12:00:00.000Z";
const ripley = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001", ownerId: "owner-a", name: "Ripley", adultAttestedAt: now,
  appearance: { species: "robin", signalAffinity: "pint", material: "hologram", accessory: "none" },
  personality: { energy: 50, playfulness: 50, storytelling: 50, relationship: "guide" },
  voice: { id: "warm" }, muted: false, hidden: false, proposalPreferences: {}, masteryPoints: 0,
  createdAt: now, updatedAt: now,
} as unknown as PubPal;
const cards = [{ id: "venue-b", name: "The Crown" }] as never;

const sent = (name: string) => state.track.filter((event) => event.name === name).length;

describe("the Pal's usage events in the registry", () => {
  it("registers all four with no props", () => {
    for (const name of PAL_EVENTS) expect(ANALYTICS_EVENTS[name]).toEqual([]);
  });

  it("drops anything that would name a pub, an area, a count or a route", () => {
    for (const name of PAL_EVENTS) {
      expect(
        sanitizeEvent(name, { venueId: "venue-b", venueName: "The Crown", area: "Camden", stamps: 3, legKey: "a-b" }),
      ).toEqual({ name, props: {} });
    }
  });
});

describe("the Pal's usage events on screen", () => {
  let root: Root | null = null;
  let host: HTMLElement;

  async function render(element: React.ReactElement) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(element));
    for (let turn = 0; turn < 4; turn += 1) await act(async () => { await Promise.resolve(); });
  }

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCAL_PAL_KEY, JSON.stringify(ripley));
    state.pal = ripley;
    state.track = [];
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    window.localStorage.clear();
  });

  it("counts the ask once, and the stamp once when the answer lands it", async () => {
    await render(createElement(NearPriceEvidenceMission, { cards, enabled: true }));
    expect(sent("pal_quest_asked")).toBe(1);
    expect(sent("pal_quest_stamped")).toBe(0);
    await act(async () => host.querySelector<HTMLButtonElement>(".answer")!.click());
    expect(sent("pal_quest_stamped")).toBe(1);
    expect(sent("pal_quest_asked")).toBe(1);
    expect(state.track.every((event) => event.props === undefined)).toBe(true);
  });

  it("counts no stamp when the day was already stamped", async () => {
    const today = londonDayKey(new Date());
    window.localStorage.setItem(PAL_QUEST_STAMPS_KEY, JSON.stringify([{ day: today, venueId: "venue-a", venueName: "The Lamb" }]));
    await render(createElement(NearPriceEvidenceMission, { cards, enabled: true }));
    await act(async () => host.querySelector<HTMLButtonElement>(".answer")!.click());
    expect(sent("pal_quest_asked")).toBe(0);
    expect(sent("pal_quest_stamped")).toBe(0);
  });

  it("counts a passport view only when the book has a stamp", async () => {
    await render(createElement(PalQuestStamps, { pal: ripley, print: [] }));
    expect(host.querySelector("[data-testid='pal-stamp-book']")).not.toBeNull();
    expect(sent("pal_passport_viewed")).toBe(0);
    act(() => root?.unmount());
    host.remove();

    window.localStorage.setItem(
      PAL_QUEST_STAMPS_KEY,
      JSON.stringify([{ day: "2026-01-01", venueId: "venue-b", venueName: "The Crown", area: "Camden" }]),
    );
    await render(createElement(PalQuestStamps, { pal: ripley, print: [] }));
    expect(sent("pal_passport_viewed")).toBe(1);
  });

  it("counts a chosen way once across map rebuilds and counts a new choice without a payload", async () => {
    // Oracle: the PR contract counts one event per choice and none for a
    // rebuilt map walking that same choice. A duplicate or missing event fails.
    const callbacks = new Set<ReturnType<typeof usePalLeadStarted>>();
    function Lead({ choice, ready }: { choice: string; ready: boolean }) {
      const reportStarted = usePalLeadStarted();
      callbacks.add(reportStarted);
      useEffect(() => {
        if (ready) reportStarted(choice);
      }, [choice, ready, reportStarted]);
      return null;
    }

    await render(createElement(Lead, { choice: "lead:a>b:walk", ready: false }));
    expect(sent("pal_lead_started")).toBe(0);
    await act(async () => root!.render(createElement(Lead, { choice: "lead:a>b:walk", ready: true })));
    expect(sent("pal_lead_started")).toBe(1);

    // Keep the mounted canvas while its map is torn down and created again.
    await act(async () => root!.render(createElement(Lead, { choice: "lead:a>b:walk", ready: false })));
    await act(async () => root!.render(createElement(Lead, { choice: "lead:a>b:walk", ready: true })));
    expect(sent("pal_lead_started")).toBe(1);

    await act(async () => root!.render(createElement(Lead, { choice: "lead:a>b:bus", ready: true })));
    expect(state.track).toEqual([
      { name: "pal_lead_started", props: undefined },
      { name: "pal_lead_started", props: undefined },
    ]);

    // Selecting the earlier option again is a new choice, not a map rebuild.
    await act(async () => root!.render(createElement(Lead, { choice: "lead:a>b:walk", ready: true })));
    expect(state.track).toEqual([
      { name: "pal_lead_started", props: undefined },
      { name: "pal_lead_started", props: undefined },
      { name: "pal_lead_started", props: undefined },
    ]);
    expect(callbacks.size).toBe(1);
  });
});
