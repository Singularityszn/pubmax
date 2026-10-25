import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const caller = vi.hoisted(() => ({ id: "11111111-1111-4111-8111-111111111111" }));
const actual = vi.hoisted(() => ({
  list: null as null | typeof import("@/lib/pubPalStore").listPalMemoriesResult,
  pal: null as null | typeof import("@/lib/pubPalStore").getPubPalResult,
  register: null as null | typeof import("@/lib/pubPalToolTurnStore").registerPubPalToolTurn,
}));

vi.mock("@/lib/supabase", () => ({
  clientIp: () => "203.0.113.85",
  hashIp: (ip: string) => `hashed:${ip}`,
  isSupabaseConfigured: () => false,
  requiresSupabaseStore: () => false,
  checkRateLimitDurableDetailed: async () => ({ verdict: false, reason: "counted" }),
}));
vi.mock("@/lib/authServer", () => ({ callerUserId: async () => caller.id }));
vi.mock("@/lib/paidSpendBudget.server", () => ({
  paidSpendBudgetRefusal: vi.fn(async () => Response.json({ error: "Paid budget spent" }, { status: 429 })),
}));
vi.mock("@/lib/concierge/venues.server", () => ({ loadConciergeVenues: vi.fn() }));
vi.mock("@/lib/palTaste.server", () => ({ readPalTaste: vi.fn(async () => null) }));
vi.mock("@/lib/pubPalStore", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/pubPalStore")>();
  actual.list = real.listPalMemoriesResult;
  actual.pal = real.getPubPalResult;
  return {
    ...real,
    listPalMemoriesResult: vi.fn(real.listPalMemoriesResult),
    getPubPalResult: vi.fn(real.getPubPalResult),
  };
});
vi.mock("@/lib/pubPalToolTurnStore", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/pubPalToolTurnStore")>();
  actual.register = real.registerPubPalToolTurn;
  return { ...real, registerPubPalToolTurn: vi.fn(real.registerPubPalToolTurn) };
});

import { POST } from "@/app/api/pub-pal/chat/route";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { PAL_CHAT_STREAM_TYPE } from "@/lib/palChatStream";
import type { PalTaste } from "@/lib/palTaste";
import { readPalTaste } from "@/lib/palTaste.server";
import { __resetPintDrops } from "@/lib/pintDrops";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import { __resetPubPalStore, confirmPalMemoryResult, createPubPalResult, getPubPalResult, listPalMemoriesResult } from "@/lib/pubPalStore";
import { __resetPubPalToolTurnStore, readOwnedPubPalToolTurn, registerPubPalToolTurn } from "@/lib/pubPalToolTurnStore";

const OWNER = "11111111-1111-4111-8111-111111111111";
const LOCAL = "Find four pubs in Soho";
const deniedFetch = vi.fn(async () => { throw new Error("External services are denied"); });
const socket = vi.fn();

const SOHO_AT = [51.5136, -0.134] as const;

function pub(id: string, name: string, searchText: string, price: number, garden = false): ConciergeVenue {
  return {
    id, name, area: "Westminster", searchText, lat: SOHO_AT[0], lng: SOHO_AT[1],
    cheapestPrice: price, priceSource: `https://example.com/${id}/menu`, priceObservedAt: "2026-10-21",
    amenities: { beerGarden: garden, food: !garden, cocktails: false, liveSports: false, liveMusic: false },
    nearWater: false, hasStory: false, canonical: true,
  };
}

const VENUES = [
  pub("soho-snug", "The Snug", "The Snug Greek Street Soho London", 3.8),
  pub("soho-ordinary", "The Corner House", "The Corner House Dean Street Soho London", 4.5),
  pub("soho-garden", "The Garden Gate", "The Garden Gate Wardour Street Soho London", 7.9, true),
];

const TASTE: PalTaste = {
  visits: 9,
  distinctPubs: 5,
  lastVisit: { name: "The Snug", on: "2026-10-18" },
  patches: ["Soho"],
  regulars: ["The Snug"],
  loved: ["The Snug"],
  notKeen: [],
  drinks: ["Lager"],
  usualPintGbp: null,
  vibes: ["riverside"],
  style: "regular",
  favouriteNight: "Fridays",
  wishlist: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function post(query: string, options: { stream?: boolean; signal?: AbortSignal } = {}) {
  return POST(new Request("http://localhost/api/pub-pal/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...(options.stream ? { accept: PAL_CHAT_STREAM_TYPE } : {}) },
    body: JSON.stringify({ query, cityId: "london" }),
    signal: options.signal,
  }));
}

function expectNoWorkAfterAbort() {
  expect(deniedFetch).not.toHaveBeenCalled();
  expect(socket).not.toHaveBeenCalled();
  expect(registerPubPalToolTurn).not.toHaveBeenCalled();
  expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
}

async function rememberGarden() {
  expect(await createPubPalResult(OWNER, { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Morrow" })).toMatchObject({ ok: true });
  expect(await confirmPalMemoryResult(OWNER, { kind: "venue_preference", value: "garden" })).toMatchObject({ ok: true });
}

function holdTaste(value: PalTaste | null) {
  const reached = deferred<void>();
  const held = deferred<void>();
  vi.mocked(readPalTaste).mockImplementation(async () => {
    reached.resolve();
    await held.promise;
    return value;
  });
  return { reached: reached.promise, release: () => held.resolve() };
}

function holdRegistration() {
  const reached = deferred<string>();
  const held = deferred<void>();
  vi.mocked(registerPubPalToolTurn).mockImplementation(async (id, input) => {
    reached.resolve(id);
    await held.promise;
    return actual.register!(id, input);
  });
  return { reached: reached.promise, release: () => held.resolve() };
}

const MODES = [["JSON", false], ["stream", true]] as const;

beforeEach(() => {
  __resetPintDrops();
  __resetPubPalToolTurnStore();
  __resetPubPalStore();
  caller.id = OWNER;
  for (const key of ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) vi.stubEnv(key, "");
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
  vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "agent-id");
  deniedFetch.mockClear();
  socket.mockClear();
  vi.stubGlobal("fetch", deniedFetch);
  vi.stubGlobal("WebSocket", socket);
  vi.mocked(loadConciergeVenues).mockResolvedValue(VENUES);
  vi.mocked(paidSpendBudgetRefusal).mockClear();
  vi.mocked(readPalTaste).mockReset();
  vi.mocked(readPalTaste).mockResolvedValue(null);
  vi.mocked(listPalMemoriesResult).mockReset();
  vi.mocked(listPalMemoriesResult).mockImplementation(actual.list!);
  vi.mocked(getPubPalResult).mockReset();
  vi.mocked(getPubPalResult).mockImplementation(actual.pal!);
  vi.mocked(registerPubPalToolTurn).mockReset();
  vi.mocked(registerPubPalToolTurn).mockImplementation(actual.register!);
});

afterEach(() => {
  __resetPubPalToolTurnStore();
  __resetPubPalStore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a caller that goes away during owned personal-read preparation", () => {
  it.each(MODES)("starts nothing after an abort while the taste read waits (%s)", async (_mode, stream) => {
    const taste = holdTaste(null);
    const controller = new AbortController();
    const pending = post(LOCAL, { stream, signal: controller.signal });
    await taste.reached;
    controller.abort();
    taste.release();
    const response = await pending;
    await response.text();
    expectNoWorkAfterAbort();
  });

  it.each(MODES)("starts nothing after an abort while the confirmed memory read waits (%s)", async (_mode, stream) => {
    await rememberGarden();
    const reached = deferred<void>();
    const held = deferred<void>();
    vi.mocked(listPalMemoriesResult).mockImplementation(async (...args) => {
      reached.resolve();
      await held.promise;
      return actual.list!(...args);
    });
    const controller = new AbortController();
    const pending = post(LOCAL, { stream, signal: controller.signal });
    await reached.promise;
    controller.abort();
    held.resolve();
    const response = await pending;
    await response.text();
    expectNoWorkAfterAbort();
  });

  it.each(MODES)("spends nothing on a provider turn aborted while the taste read waits (%s)", async (_mode, stream) => {
    const taste = holdTaste(TASTE);
    const controller = new AbortController();
    const pending = post(LOCAL, { stream, signal: controller.signal });
    await taste.reached;
    controller.abort();
    taste.release();
    const response = await pending;
    await response.text();
    expectNoWorkAfterAbort();
  });

  it.each(MODES)("reads nothing for an already-aborted request (%s)", async (_mode, stream) => {
    const controller = new AbortController();
    controller.abort();
    const response = await post(LOCAL, { stream, signal: controller.signal });
    await response.text();
    expectNoWorkAfterAbort();
    expect(readPalTaste).not.toHaveBeenCalled();
    expect(listPalMemoriesResult).not.toHaveBeenCalled();
  });

  it("persists no opening after an abort while the opening read waits", async () => {
    const reached = deferred<void>();
    const held = deferred<void>();
    vi.mocked(getPubPalResult).mockImplementationOnce(async (...args) => {
      reached.resolve();
      await held.promise;
      return actual.pal!(...args);
    });
    const controller = new AbortController();
    const pending = post("Hello", { signal: controller.signal });
    await reached.promise;
    controller.abort();
    held.resolve();
    const response = await pending;
    await response.text();
    expectNoWorkAfterAbort();
  });
});

describe("a caller that goes away while registration waits", () => {
  it.each(MODES)("stores no local record turn after an abort (%s)", async (_mode, stream) => {
    const registration = holdRegistration();
    const controller = new AbortController();
    const pending = post(LOCAL, { stream, signal: controller.signal });
    const id = await registration.reached;
    controller.abort();
    registration.release();
    await (await pending).text();
    expect(await readOwnedPubPalToolTurn(id, OWNER)).toBeNull();
    expect(deniedFetch).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
  });

  it("stores no greeting opening after an abort", async () => {
    const registration = holdRegistration();
    const controller = new AbortController();
    const pending = post("Hello", { signal: controller.signal });
    const id = await registration.reached;
    controller.abort();
    registration.release();
    await (await pending).text();
    expect(await readOwnedPubPalToolTurn(id, OWNER)).toBeNull();
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});

describe("ordinary turns without an abort", () => {
  it("answers the local JSON turn and keeps its thread once the read is released", async () => {
    const taste = holdTaste(null);
    const pending = post(LOCAL);
    await taste.reached;
    taste.release();
    const response = await pending;
    expect(response.status).toBe(200);
    const body = await response.json() as { cards: unknown[]; conversationId: string };
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.conversationId).toBeTruthy();
    expect(registerPubPalToolTurn).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
  });

  it("streams the local turn to its final event", async () => {
    await rememberGarden();
    const response = await post(LOCAL, { stream: true });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("final");
    expect(registerPubPalToolTurn).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
  });

  it("still checks the spend ceiling for an ordinary provider turn", async () => {
    const taste = holdTaste(TASTE);
    const pending = post(LOCAL);
    await taste.reached;
    taste.release();
    const response = await pending;
    expect(response.status).toBe(429);
    expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
  });

  it("persists the opening for an ordinary greeting", async () => {
    const response = await post("Hello");
    expect(response.status).toBe(200);
    const body = await response.json() as { answer: string; conversationId: string };
    expect(body.answer).toBeTruthy();
    expect(body.conversationId).toBeTruthy();
    expect(registerPubPalToolTurn).toHaveBeenCalledOnce();
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});
