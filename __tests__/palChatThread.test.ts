// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_IDENTITY_CHANGED_EVENT } from "@/lib/deviceAccountIdentity";
import { readPalChatThread, savePalChatThread, clearPalChatThread, type PalChatEntry } from "@/lib/palChatThread";
import { clearSurfaceCache, SURFACE_CACHE_NAMESPACE, writeSurfaceSnapshot } from "@/lib/surfaceDataCache";
import { refineRoutedAskQuery } from "@/lib/ask/router";
import { resolvePalLocality } from "@/lib/palLocality";
import type { AskTurn } from "@/lib/ask/types";

const NOW = Date.parse("2026-10-20T00:00:00Z");
const transcript: AskTurn[] = [{ role: "user", content: "Find me four pubs in Soho" }, { role: "assistant", content: "A listed Soho pub." }];
const entries = (): PalChatEntry[] => [
  { kind: "user", id: "t-7", text: "Find me four pubs in Soho" },
  { kind: "answer", id: "t-8", answer: { status: "answered", message: "A listed Soho pub.", cards: [
    { key: "soho", venueId: "venue-e1srzr", title: "Shakespeares Head (Soho)", place: "Westminster", note: "", price: 6.25, provenance: { kind: "directory", label: "Pint Prices. Source read 2 October 2026.", url: "https://example.com/price" } },
  ] }, locality: null, proposals: [], recall: null },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  clearSurfaceCache();
  sessionStorage.clear();
});
afterEach(() => { clearSurfaceCache(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("the current Pal conversation in a tab", () => {
  it("restores sourced facts and the context for the next question", () => {
    savePalChatThread("owner-a", entries(), "conv_returntest1", NOW, transcript);
    const restored = readPalChatThread("owner-a")!;
    expect(restored.entries[1]).toMatchObject({ answer: { cards: [{ title: "Shakespeares Head (Soho)", price: 6.25, provenance: { label: "Pint Prices. Source read 2 October 2026." } }] } });
    expect(restored.turns).toEqual([{ role: "user", content: "Find me four pubs in Soho" }, { role: "assistant", content: "A listed Soho pub." }]);
    expect(restored.priorAsks).toEqual(["Find me four pubs in Soho"]);
    expect(restored.conversationId).toBe("conv_returntest1");
  });
  it("restores the area after raw refinements exceed the history window", () => {
    const turns: AskTurn[] = [...transcript];
    for (const budget of [7, 6.8, 6.6, 6.4]) {
      turns.push({ role: "user", content: `Same area, under £${budget} a pint` }, { role: "assistant", content: "Listed choices." });
    }
    savePalChatThread("owner-a", entries(), "", 0, turns);
    const restored = readPalChatThread("owner-a")!;
    expect(restored.turns).toHaveLength(6);
    const query = refineRoutedAskQuery("Same area, under £6 a pint", restored.priorAsks.at(-1), restored.priorAsks);
    expect(resolvePalLocality(query, null).label).toBe("Soho");
  });
  it("does not give another account or an anonymous viewer the conversation", () => {
    savePalChatThread("owner-a", entries(), "", 0, transcript);
    expect(readPalChatThread("owner-b")).toBeNull();
    expect(readPalChatThread("anonymous")).toBeNull();
  });
  it("keeps navigation receipts out of the next provider request", () => {
    const timeline: PalChatEntry[] = [...entries(), { kind: "user", id: "t-9", text: "Take me there" }, {
      kind: "answer", id: "t-10", answer: { status: "answered", message: "Opening the pub", cards: [] }, locality: null, proposals: [], recall: null,
    }];
    savePalChatThread("owner-a", timeline, "", 0, transcript);
    const restored = readPalChatThread("owner-a")!;
    expect(restored.entries).toHaveLength(4);
    expect(restored.turns).toEqual(transcript);
    expect(restored.priorAsks).toEqual(["Find me four pubs in Soho"]);
  });
  it("retains menu and event evidence without confirming a pending memory", () => {
    const request = vi.spyOn(globalThis, "fetch");
    const thread = entries();
    const answer = thread[1];
    if (answer?.kind !== "answer") throw new Error("Expected the fixture answer");
    answer.answer.cards[0]!.when = "2026-10-20T19:00:00Z";
    answer.answer.cards[0]!.confidence = "confirmed";
    answer.answer.cards[0]!.menuEvidence = {
      kind: "published-menu", itemId: "ale", itemName: "Cask ale", menu: "drink", category: "beer", currency: "GBP", serving: "pint",
      caloriesKcal: 180, caloriesProvenance: { source: "Pub menu", licence: "Published menu", observedAt: "2026-10-02", sourceUrl: "https://example.com/menu" },
      dietary: [], dietaryProvenance: null, observedAt: "2026-10-02", source: "Pub menu", sourceUrl: "https://example.com/menu", licence: "Published menu", availability: "unknown",
    };
    answer.proposals = [{ id: "remember:ale", kind: "remember_memory", label: "Remember cask ale", memoryKind: "drink_preference", value: "Cask ale" }];
    savePalChatThread("owner-a", thread, "", 0, transcript);
    const restored = readPalChatThread("owner-a")!;
    expect(restored.entries[1]).toMatchObject({
      answer: { cards: [{ when: "2026-10-20T19:00:00Z", confidence: "confirmed", menuEvidence: { caloriesKcal: 180, caloriesProvenance: { sourceUrl: "https://example.com/menu" } } }] },
      proposals: [{ kind: "remember_memory", value: "Cask ale" }],
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("drops the conversation at the existing account boundary", () => {
    savePalChatThread("owner-a", entries(), "", 0, transcript);
    window.dispatchEvent(new Event(DEVICE_IDENTITY_CHANGED_EVENT));
    expect(readPalChatThread("owner-a")).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
  it("ages out rather than becoming permanent memory", () => {
    savePalChatThread("owner-a", entries(), "", 0, transcript);
    vi.advanceTimersByTime(3 * 60_000);
    expect(readPalChatThread("owner-a")).toBeNull();
  });
  it("starts a fresh provider thread when its correlation id is old or future dated", () => {
    for (const timestamp of [NOW - 3 * 60_000, NOW + 1]) {
      savePalChatThread("owner-a", entries(), "conv_returntest1", timestamp, transcript);
      const restored = readPalChatThread("owner-a")!;
      expect(restored.entries).toHaveLength(2);
      expect(restored.conversationId).toBe("");
    }
  });
  it("lets the person explicitly start a new conversation", () => {
    savePalChatThread("owner-a", entries(), "", 0, transcript);
    clearPalChatThread("owner-a");
    expect(readPalChatThread("owner-a")).toBeNull();
  });
  it("rejects damaged tab state and never restores an executable source URL", () => {
    const unsafe = entries();
    if (unsafe[1]?.kind === "answer") unsafe[1].answer.cards[0]!.provenance.url = "javascript:alert(1)";
    savePalChatThread("owner-a", unsafe, "", 0, transcript);
    const restored = readPalChatThread("owner-a")!;
    expect(restored.entries[1]?.kind === "answer" && restored.entries[1].answer.cards[0]?.provenance.url).toBeUndefined();
    const storageKey = Object.keys(sessionStorage).find((name) => name.startsWith(SURFACE_CACHE_NAMESPACE))!;
    writeSurfaceSnapshot(storageKey.slice(SURFACE_CACHE_NAMESPACE.length), { version: 2, entries: "damaged", turns: [] });
    expect(readPalChatThread("owner-a")).toBeNull();
  });
});
