// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_IDENTITY_CHANGED_EVENT } from "@/lib/deviceAccountIdentity";
import { readPalChatThread, savePalChatThread, clearPalChatThread, palChatMapAnswer, type PalChatEntry } from "@/lib/palChatThread";
import { clearSurfaceCache, SURFACE_CACHE_NAMESPACE, writeSurfaceSnapshot } from "@/lib/surfaceDataCache";
import { refineRoutedAskQuery } from "@/lib/ask/router";
import { palLocalityLine, resolvePalLocality, type PalLocality } from "@/lib/palLocality";
import { windowPalSessionTurns } from "@/lib/palSessionSummary";
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
  it("preserves an unresolved locality when an ambiguous conversation is restored", () => {
    const timeline = entries();
    timeline[0] = { kind: "user", id: "t-7", text: "Find four pubs in Soho or Camden in the same area" };
    savePalChatThread("owner-a", timeline, "", 0, [
      { role: "user", content: "Find pubs in Soho or Camden" },
      { role: "user", content: "Pints under £6.50 in the same area" },
    ]);
    const restored = readPalChatThread("owner-a")!;
    expect(restored.entries[1]).toMatchObject({ kind: "answer", locality: null });
    const query = "Find four pubs in the same area";
    expect(refineRoutedAskQuery(query, restored.priorAsks.at(-1), restored.priorAsks)).toBe(query);
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


describe("the current chat recommendation map", () => {
  it.each(["search_venues", "cheapest_pint_near"] as const)("retains %s across acknowledgements and detail answers, including a tab restore", (tool) => {
    const timeline = entries();
    const search = timeline[1];
    if (search?.kind !== "answer") throw new Error("Expected the answer fixture");
    search.answer.toolsUsed = [tool];
    timeline.push({ ...search, id: "ack", answer: { status: "empty", message: "You are welcome.", cards: [], toolsUsed: [] } });
    timeline.push({ ...search, id: "detail", answer: { ...search.answer, toolsUsed: ["venue_drinks"] } });
    timeline.push({ ...search, id: "unattested", answer: { status: "answered", message: "Other detail", cards: search.answer.cards } });
    expect(palChatMapAnswer(timeline)?.id).toBe(search.id);
    savePalChatThread("owner-a", timeline, "", 0, transcript);
    const restored = readPalChatThread("owner-a")!;
    expect(palChatMapAnswer(restored.entries)?.answer.cards[0]?.venueId).toBe("venue-e1srzr");
  });
  it.each(["search_venues", "cheapest_pint_near"] as const)("an empty %s replacement clears the earlier map, including after restore", (tool) => {
    const timeline = entries();
    const search = timeline[1];
    if (search?.kind !== "answer") throw new Error("Expected the answer fixture");
    search.answer.toolsUsed = [tool];
    timeline.push({ ...search, id: "empty", answer: { status: "empty", message: "Nothing sourced.", cards: [], toolsUsed: [tool] } });
    expect(palChatMapAnswer(timeline)?.answer.cards).toEqual([]);
    savePalChatThread("owner-a", timeline, "", 0, transcript);
    expect(palChatMapAnswer(readPalChatThread("owner-a")!.entries)?.answer.cards).toEqual([]);
  });
});

describe("a restored answer for a named place without a planning area", () => {
  type AnswerEntry = Extract<PalChatEntry, { kind: "answer" }>;
  const EAC_LINE = "In Elephant and Castle, the area you named.";
  const scoped = (label: string): PalLocality => ({ scope: "query", area: null, label, grounded: true });
  // A synthetic listing, so the card is not evidence for any real pub, place or price.
  const answerFor = (id: string, message: string, locality: PalLocality, place: string | null): AnswerEntry => ({
    kind: "answer", id, locality, proposals: [], recall: null,
    answer: place
      ? { status: "answered", message, toolsUsed: ["search_venues"], cards: [
        { key: "listing-" + id, venueId: "venue-listing-" + id, title: "Test Listing Tavern", place, note: "", price: null, provenance: { kind: "directory", label: "On record" } },
      ] }
      : { status: "empty", message, toolsUsed: ["search_venues"], cards: [] },
  });
  // The session hands the thread its windowed turns, which the save windows again.
  const historyFor = (timeline: PalChatEntry[]): AskTurn[] => windowPalSessionTurns("", timeline.flatMap((entry): AskTurn[] =>
    entry.kind === "user" ? [{ role: "user", content: entry.text }]
      : entry.kind === "answer" ? [{ role: "assistant", content: entry.answer.message }] : [])).turns;
  const restoredLocality = (index: number): PalLocality | null | undefined => {
    const entry = readPalChatThread("owner-a")?.entries[index];
    return entry?.kind === "answer" ? entry.locality : undefined;
  };

  it.each([
    ["find two pubs in elephant and castle", "Elephant and Castle", "Elephant and Castle", EAC_LINE],
    ["Find two pubs in Elephant and castle", "Elephant and Castle", "Elephant and Castle", EAC_LINE],
    ["Find two pubs in Dalston", "Dalston", null, "In Dalston, the area you named."],
  ] as Array<[string, string, string | null, string]>)("keeps %s scoped to %s with no planning area", (query, label, place, line) => {
    const timeline: PalChatEntry[] = [{ kind: "user", id: "t-1", text: query }, answerFor("t-2", "Listed pubs for " + label + ".", scoped(label), place)];
    savePalChatThread("owner-a", timeline, "", 0, historyFor(timeline));
    const locality = restoredLocality(1);
    expect(locality).toEqual({ scope: "query", area: null, label, grounded: true });
    expect(locality ? palLocalityLine(locality) : null).toBe(line);
  });

  it("keeps Elephant and Castle for a same-area follow-up instead of replaying its words London-wide", () => {
    const eac = scoped("Elephant and Castle");
    const timeline: PalChatEntry[] = [
      { kind: "user", id: "t-1", text: "Find four pubs in Elephant and Castle" },
      answerFor("t-2", "Listed pubs in Elephant and Castle.", eac, "Elephant and Castle"),
      { kind: "user", id: "t-3", text: "Find four pubs in the same area, not in Camden" },
      answerFor("t-4", "More listed pubs in Elephant and Castle.", eac, "Elephant and Castle"),
    ];
    savePalChatThread("owner-a", timeline, "", 0, historyFor(timeline));
    expect(readPalChatThread("owner-a")?.turns).toHaveLength(4);
    const localities = [1, 3].map((index) => restoredLocality(index));
    expect(localities).toEqual([
      { scope: "query", area: null, label: "Elephant and Castle", grounded: true },
      { scope: "query", area: null, label: "Elephant and Castle", grounded: true },
    ]);
    expect(localities.map((locality) => locality ? palLocalityLine(locality) : null)).toEqual([EAC_LINE, EAC_LINE]);
  });

  it("keeps a visible navigation receipt from moving an older same-area answer away from Elephant and Castle", () => {
    const eac = scoped("Elephant and Castle");
    const initial: PalChatEntry[] = [
      { kind: "user", id: "t-1", text: "Find four pubs in Elephant and Castle" },
      answerFor("t-2", "Listed pubs in Elephant and Castle.", eac, "Elephant and Castle"),
    ];
    // Navigation is shown in the thread but is never a provider turn.
    const navigation: PalChatEntry[] = [
      { kind: "user", id: "t-3", text: "Take me to The Lock Tavern in Camden" },
      { kind: "answer", id: "t-4", answer: { status: "answered", message: "Opening The Lock Tavern", cards: [] }, locality: null, proposals: [], recall: null },
    ];
    const followUp: PalChatEntry[] = [
      { kind: "user", id: "t-5", text: "Find four pubs in the same area" },
      answerFor("t-6", "More listed pubs in Elephant and Castle.", eac, "Elephant and Castle"),
    ];
    const providerTurns = historyFor([...initial, ...followUp]);
    expect(providerTurns).toHaveLength(4);
    expect(providerTurns.map((turn) => turn.content).join(" | ")).not.toMatch(/Lock Tavern|Camden/);
    savePalChatThread("owner-a", [...initial, ...navigation, ...followUp], "", 0, providerTurns);
    const restored = readPalChatThread("owner-a")!;
    expect(restored.entries).toHaveLength(6);
    expect(restored.turns).toHaveLength(4);
    expect(restored.turns.map((turn) => turn.content).join(" | ")).not.toMatch(/Lock Tavern|Camden/);
    expect(restored.priorAsks).toHaveLength(2);
    expect(restored.priorAsks[0]).toBe("Find four pubs in Elephant and Castle");
    expect(restoredLocality(3)).toBeNull();
    expect(restoredLocality(1)).toEqual({ scope: "query", area: null, label: "Elephant and Castle", grounded: true });
    const latest = restoredLocality(5);
    expect(latest).toEqual({ scope: "query", area: null, label: "Elephant and Castle", grounded: true });
    expect(latest ? palLocalityLine(latest) : null).toBe(EAC_LINE);
  });

  it.each([
    "Find four pubs in Oxford",
    "Find four pubs in Soho or Camden",
  ])("does not restore a copied Elephant and Castle label saved for %s", (query) => {
    const timeline: PalChatEntry[] = [{ kind: "user", id: "t-1", text: query }, answerFor("t-2", "Nothing listed for that.", scoped("Elephant and Castle"), null)];
    savePalChatThread("owner-a", timeline, "", 0, historyFor(timeline));
    const locality = restoredLocality(1);
    expect(locality).not.toBeUndefined();
    expect(locality?.area ?? null).toBeNull();
    expect(locality?.grounded ?? false).toBe(false);
    const line = locality ? palLocalityLine(locality) : null;
    expect(line === null || line.startsWith("Across London.")).toBe(true);
  });

  // A resolved canonical locality, saved as if the tab cache had copied it onto the answer.
  const copied = (place: string): PalLocality => resolvePalLocality("Find four pubs in " + place, null);
  const expectFailClosed = (locality: PalLocality | null | undefined, ...copies: PalLocality[]) => {
    expect(locality).not.toBeUndefined();
    expect(locality?.area ?? null).toBeNull();
    expect(locality?.grounded ?? false).toBe(false);
    for (const copy of copies) expect(locality?.label ?? null).not.toBe(copy.label);
    const line = locality ? palLocalityLine(locality) : null;
    expect(line === null || line.startsWith("Across London.")).toBe(true);
  };

  it.each([
    { kind: "a number", routedQuery: 42, place: "Soho" },
    { kind: "an array holding a Soho ask", routedQuery: ["Find four pubs in Soho"], place: "Soho" },
    // Far longer than any ask, so it is damage: a kept prefix would name Camden.
    { kind: "an oversized ask that opens in Camden and excludes it late", routedQuery: "Find four pubs in Camden" + ", near the river".repeat(300) + ", but not in Camden", place: "Camden" },
    { kind: "an ambiguous Soho or Camden ask", routedQuery: "Find four pubs in Soho or Camden", place: "Soho" },
    { kind: "an unresolved same-area ask", routedQuery: "Find four pubs in the same area", place: "Camden" },
  ] as Array<{ kind: string; routedQuery: unknown; place: string }>)("gives a same-area ask with no history no area from a saved routed query of $kind", ({ routedQuery, place }) => {
    const copy = copied(place);
    expect(copy.grounded).toBe(true);
    expect(copy.area).not.toBeNull();
    const timeline: PalChatEntry[] = [
      { kind: "user", id: "t-1", text: "Find four pubs in the same area" },
      Object.assign(answerFor("t-2", "Nothing listed for that.", copy, null), { routedQuery }),
    ];
    savePalChatThread("owner-a", timeline, "", 0, historyFor(timeline));
    expectFailClosed(restoredLocality(1), copy);
  });

  it("fails a repeated same-area pair closed instead of guessing which saved exchange it was", () => {
    const soho = copied("Soho");
    const camden = copied("Camden");
    const reply = "More listed pubs nearby.";
    const timeline: PalChatEntry[] = [
      { kind: "user", id: "t-1", text: "Find four pubs in Elephant and Castle" },
      answerFor("t-2", "Listed pubs in Elephant and Castle.", scoped("Elephant and Castle"), "Elephant and Castle"),
      { kind: "user", id: "t-3", text: "Find four pubs in the same area" },
      answerFor("t-4", reply, soho, null),
      { kind: "user", id: "t-5", text: "Find four pubs in the same area" },
      answerFor("t-6", reply, camden, null),
    ];
    savePalChatThread("owner-a", timeline, "conv_returntest1", NOW, historyFor(timeline));
    const restored = readPalChatThread("owner-a")!;
    expect(restored.entries).toHaveLength(6);
    expect(restored.turns).toHaveLength(6);
    expect(restored.turns.at(-1)).toEqual({ role: "assistant", content: reply });
    expect(restored.priorAsks[0]).toBe("Find four pubs in Elephant and Castle");
    expect(restored.conversationId).toBe("conv_returntest1");
    expect(readPalChatThread("owner-b")).toBeNull();
    const named = restoredLocality(1);
    expect(named).toEqual({ scope: "query", area: null, label: "Elephant and Castle", grounded: true });
    expect(named ? palLocalityLine(named) : null).toBe(EAC_LINE);
    expectFailClosed(restoredLocality(3), soho, camden);
    expectFailClosed(restoredLocality(5), soho, camden);
  });

  it("binds no history when the visible pairs cross the order of the saved exchanges", () => {
    const eac = scoped("Elephant and Castle");
    const namedPair: PalChatEntry[] = [
      { kind: "user", id: "t-1", text: "Find four pubs in Elephant and Castle" },
      answerFor("t-2", "Listed pubs in Elephant and Castle.", eac, "Elephant and Castle"),
    ];
    const sameAreaPair: PalChatEntry[] = [
      { kind: "user", id: "t-3", text: "Find four pubs in the same area" },
      answerFor("t-4", "More listed pubs nearby.", eac, null),
    ];
    // The provider was asked the named place first; the visible thread shows the pairs the other way round.
    savePalChatThread("owner-a", [...sameAreaPair, ...namedPair], "conv_returntest1", NOW, historyFor([...namedPair, ...sameAreaPair]));
    const restored = readPalChatThread("owner-a")!;
    expect(restored.entries.map((entry) => entry.kind === "user" ? entry.text : entry.kind))
      .toEqual(["Find four pubs in the same area", "answer", "Find four pubs in Elephant and Castle", "answer"]);
    expect(restored.turns).toHaveLength(4);
    expect(restored.turns.at(-1)).toEqual({ role: "assistant", content: "More listed pubs nearby." });
    expect(restored.priorAsks[0]).toBe("Find four pubs in Elephant and Castle");
    expect(restored.conversationId).toBe("conv_returntest1");
    expect(readPalChatThread("owner-b")).toBeNull();
    expectFailClosed(restoredLocality(1), eac);
    const named = restoredLocality(3);
    expect(named).toEqual({ scope: "query", area: null, label: "Elephant and Castle", grounded: true });
    expect(named ? palLocalityLine(named) : null).toBe(EAC_LINE);
  });
});
