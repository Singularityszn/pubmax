import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const caller = vi.hoisted(() => ({ id: "11111111-1111-4111-8111-111111111111" }));
const memoryStore = vi.hoisted(() => ({ list: null as null | typeof import("@/lib/pubPalStore").listPalMemoriesResult }));

vi.mock("@/lib/supabase", () => ({
  clientIp: () => "203.0.113.84",
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
  const actual = await importOriginal<typeof import("@/lib/pubPalStore")>();
  memoryStore.list = actual.listPalMemoriesResult;
  return { ...actual, listPalMemoriesResult: vi.fn(actual.listPalMemoriesResult) };
});

import { POST } from "@/app/api/pub-pal/chat/route";
import { refineRoutedAskQuery, resolveAskLocality } from "@/lib/ask/router";
import type { AskToolArgs } from "@/lib/ask/tools";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import type { PalTaste } from "@/lib/palTaste";
import { readPalTaste } from "@/lib/palTaste.server";
import { windowPalSessionTurns } from "@/lib/palSessionSummary";
import { __resetPintDrops } from "@/lib/pintDrops";
import { DEFAULT_PAL_DRAFT, type PubPalMemoryKind } from "@/lib/pubPal";
import { resolvePubPalToolQuery } from "@/lib/pubPalToolInvoke.server";
import { __resetPubPalStore, confirmPalMemoryResult, createPubPalResult, listPalMemoriesResult } from "@/lib/pubPalStore";
import { __resetPubPalToolTurnStore, registerPubPalToolTurn } from "@/lib/pubPalToolTurnStore";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const THREAD = "conv_ownercontext01";
const SOHO = "Find four pubs in Soho";
const EAC = "Find two pubs in Elephant and Castle";
const deniedFetch = vi.fn(async () => { throw new Error("External services are denied"); });

type Features = { garden?: boolean; food?: boolean; water?: boolean; story?: boolean };
type ChatCard = { venueId: string; price: number | null; provenance?: { label?: string } };
type ChatBody = { toolsUsed: string[]; cards: ChatCard[]; proposals: Array<{ kind: string; label?: string; query?: string }> };

function pub(id: string, name: string, area: string, searchText: string, at: readonly [number, number], price: number, features: Features = {}): ConciergeVenue {
  return {
    id, name, area, searchText, lat: at[0], lng: at[1],
    cheapestPrice: price, priceSource: `https://example.com/${id}/menu`, priceObservedAt: "2026-10-21",
    amenities: { beerGarden: features.garden === true, food: features.food === true, cocktails: false, liveSports: false, liveMusic: false },
    nearWater: features.water === true, hasStory: features.story === true, canonical: true,
  };
}

const SOHO_AT = [51.5136, -0.134] as const;
const CAMDEN_AT = [51.5392, -0.1426] as const;
const EAC_AT = [51.4946, -0.1003] as const;

const VENUES = [
  pub("soho-snug", "The Snug", "Westminster", "The Snug Greek Street Soho London", SOHO_AT, 3.8, { food: true, story: true }),
  pub("soho-ordinary", "The Corner House", "Westminster", "The Corner House Dean Street Soho London", SOHO_AT, 4.5, { food: true }),
  pub("soho-pricey", "The Old Vaults", "Westminster", "The Old Vaults Frith Street Soho London", SOHO_AT, 5.8, { food: true, story: true }),
  pub("soho-garden", "The Garden Gate", "Westminster", "The Garden Gate Wardour Street Soho London", SOHO_AT, 7.9, { garden: true }),
  pub("soho-water", "The Fountain", "Westminster", "The Fountain Old Compton Street Soho London", SOHO_AT, 6.5, { water: true }),
  pub("camden-local", "The Lock Tavern", "Camden", "The Lock Tavern Chalk Farm Road Camden Town London", CAMDEN_AT, 4.4, { food: true }),
  pub("camden-garden", "The Yard", "Camden", "The Yard Parkway Camden Town London", CAMDEN_AT, 6, { garden: true }),
  pub("eac-tap", "The Castle Tap", "Southwark", "The Castle Tap Newington Butts Elephant and Castle London", EAC_AT, 4.9, { food: true }),
  pub("eac-arms", "The Walworth Arms", "Southwark", "The Walworth Arms Walworth Road Elephant and Castle London", EAC_AT, 5.4),
  pub("eac-garden", "The Butts Garden", "Southwark", "The Butts Garden Elephant and Castle London", EAC_AT, 6.2, { garden: true }),
];

function ask(query: string, threadId?: string) {
  return POST(new Request("http://localhost/api/pub-pal/chat", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, cityId: "london", threadId }),
  }));
}

async function expectProviderRefusal(response: Response) {
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: "Paid budget spent" });
  expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
  expect(deniedFetch).not.toHaveBeenCalled();
}

async function localAnswer(response: Response): Promise<ChatBody> {
  expect(response.status).toBe(200);
  expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
  expect(deniedFetch).not.toHaveBeenCalled();
  return await response.json() as ChatBody;
}

function ids(body: ChatBody): string[] {
  return body.cards.map((card) => card.venueId);
}

async function remember(ownerId: string, kind: PubPalMemoryKind, value: string) {
  expect(await createPubPalResult(ownerId, { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Morrow" })).toMatchObject({ ok: true });
  expect(await confirmPalMemoryResult(ownerId, { kind, value })).toMatchObject({ ok: true });
}

beforeEach(() => {
  __resetPintDrops();
  __resetPubPalToolTurnStore();
  __resetPubPalStore();
  caller.id = OWNER;
  for (const key of ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) vi.stubEnv(key, "");
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
  vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "agent-id");
  deniedFetch.mockClear();
  vi.stubGlobal("fetch", deniedFetch);
  vi.mocked(loadConciergeVenues).mockResolvedValue(VENUES);
  vi.mocked(paidSpendBudgetRefusal).mockClear();
  vi.mocked(readPalTaste).mockReset();
  vi.mocked(readPalTaste).mockResolvedValue(null);
  vi.mocked(listPalMemoriesResult).mockReset();
  vi.mocked(listPalMemoriesResult).mockImplementation(memoryStore.list!);
});

afterEach(() => {
  __resetPubPalToolTurnStore();
  __resetPubPalStore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const UNSUPPORTED_CONSTRAINTS = [
  "Find four dog-friendly pubs in Soho",
  "Find four pubs in Soho that are dog friendly",
  "Find four pubs in Soho with alcohol-free beer",
  "Find four pubs in Soho with non-alcoholic drinks",
  "Find four pubs in Soho that suit my preferences",
  "Find four pubs in Soho that match my notes",
  "Find four exceptionally welcoming pubs in Soho",
  "A pub crawl in Soho for three with dog-friendly pubs",
  "Plan a crawl in Soho with three alcohol-free pubs",
  "Plan a crawl in Soho that suits my preferences",
  "Plan a crawl in Soho with three exceptionally welcoming pubs",
  "Cheap pints near Soho in dog-friendly pubs",
  "Find four alcohol-free pubs in Soho under £6 a pint",
  "Find four dog-friendly pubs in Soho under £6 a pint",
  "Find four pubs in Soho for vegan drinkers under £6 a pint",
  "Cheap pints near Soho that match my notes",
];

describe("asks naming a constraint no local tool implements", () => {
  it.each(UNSUPPORTED_CONSTRAINTS)("keeps the direct ask on the configured provider path: %s", async (query) => {
    await expectProviderRefusal(await ask(query));
  });

  it.each(UNSUPPORTED_CONSTRAINTS)("keeps the owned same-area ask on the configured provider path: %s", async (query) => {
    await registerPubPalToolTurn(THREAD, { query: SOHO, cityId: "london", ownerId: OWNER, turns: [] });
    await expectProviderRefusal(await ask(query.replace(/ (?:in|near) Soho/, " in the same area"), THREAD));
  });

  it.each(UNSUPPORTED_CONSTRAINTS)("keeps a short refinement of the owned ask on the configured provider path: %s", async (query) => {
    await registerPubPalToolTurn(THREAD, { query, cityId: "london", ownerId: OWNER, turns: [] });
    await expectProviderRefusal(await ask("please", THREAD));
  });

  it("answers the ordinary three-stop Soho crawl locally with grounded prices", async () => {
    const query = "A pub crawl in Soho for three, not pricey";
    const body = await localAnswer(await ask(query));
    expect(body.toolsUsed).toEqual(["propose_plan"]);
    expect(body.cards).toHaveLength(3);
    for (const card of body.cards) {
      expect(card.venueId.startsWith("soho-")).toBe(true);
      expect(typeof card.price === "number" && card.price > 0).toBe(true);
      expect(card.provenance?.label).toBeTruthy();
    }
    expect(body.proposals.find((proposal) => proposal.kind === "draft_plan")).toMatchObject({ label: "Open in Plan", query });
  });
});

describe("cheap pints with an unsupported drink comparison", () => {
  const REFUSAL = "I can compare listed pint prices, but not other drinks across pubs yet. Name a pub and I'll check its recorded drinks.";

  it("refuses the comparison directly without claiming an alcohol-free filter", async () => {
    const body = await localAnswer(await ask("Cheap pints near Soho with alcohol-free options")) as ChatBody & { answer: string };
    expect(body.answer).toBe(REFUSAL);
    expect(body.cards).toEqual([]);
    expect(body.proposals).toEqual([]);
  });

  it("refuses the comparison for the owned same-area ask without claiming an alcohol-free filter", async () => {
    await registerPubPalToolTurn(THREAD, { query: SOHO, cityId: "london", ownerId: OWNER, turns: [] });
    const body = await localAnswer(await ask("Cheap pints in the same area with alcohol-free options", THREAD)) as ChatBody & { answer: string };
    expect(body.answer).toBe(REFUSAL);
    expect(body.cards).toEqual([]);
    expect(body.proposals).toEqual([]);
  });
});

describe("Elephant and Castle as one supported place", () => {
  it.each([
    "Find two pubs in Elephant and Castle",
    "find two pubs in elephant and castle",
    "Find two pubs in Elephant and Castle for three under £6",
  ])("resolves %s to the one place", (query) => {
    const locality = resolveAskLocality(query);
    expect(locality.kind).toBe("supported");
    expect("area" in locality ? locality.area.toLocaleLowerCase("en-GB") : null).toBe("elephant and castle");
  });

  it.each(["Find two pubs in Elephant and Castle or Soho", "Find two pubs in Soho or Camden"])("keeps real alternatives ambiguous: %s", (query) => {
    expect(resolveAskLocality(query)).toEqual({ kind: "ambiguous" });
  });

  it("keeps unsupported, missing and excluded places apart", () => {
    expect(resolveAskLocality("Find two pubs in Oxford")).toMatchObject({ kind: "unsupported" });
    expect(resolveAskLocality("Find two pubs")).toEqual({ kind: "missing" });
    expect(resolveAskLocality("Find two pubs, not in Elephant and Castle")).toEqual({ kind: "missing" });
  });

  it("carries the place into same-area and short follow-ups", () => {
    expect(refineRoutedAskQuery("Find two pubs in the same area", EAC, [EAC])).toBe(EAC);
    expect(refineRoutedAskQuery("Four quiet pubs", EAC, [EAC])).toBe("Four quiet pubs in Elephant and Castle");
    expect(windowPalSessionTurns("", [
      { role: "user", content: EAC },
      { role: "assistant", content: "Two picks." },
      { role: "user", content: "Find two pubs in the same area" },
    ]).turns.at(-1)?.content).toBe(EAC);
    expect(resolvePubPalToolQuery({ turnQuery: "Find two pubs in the same area", args: {} as AskToolArgs, turns: [{ role: "user", content: EAC }] })).toBe(EAC);
  });

  it("does not resolve a same-area follow-up after real alternatives", () => {
    const prior = "Find two pubs in Elephant and Castle or Soho";
    expect(refineRoutedAskQuery("Find two pubs in the same area", prior, [prior])).toBe("Find two pubs in the same area");
    expect(resolvePubPalToolQuery({ turnQuery: "Find two pubs in the same area", args: {} as AskToolArgs, turns: [{ role: "user", content: prior }] })).toBe("Find two pubs in the same area");
  });

  it("answers the named place locally from its own venues", async () => {
    const body = await localAnswer(await ask(EAC));
    expect(body.toolsUsed).toEqual(["search_venues"]);
    expect(body.cards.length).toBeGreaterThan(0);
    expect(ids(body).every((id) => id.startsWith("eac-"))).toBe(true);
  });

  it.each(["Find two pubs in the same area", "Four quiet pubs"])("answers an owned follow-up in the same place: %s", async (query) => {
    await registerPubPalToolTurn(THREAD, { query: EAC, cityId: "london", ownerId: OWNER, turns: [] });
    const body = await localAnswer(await ask(query, THREAD));
    expect(body.toolsUsed).toEqual(["search_venues"]);
    expect(body.cards.length).toBeGreaterThan(0);
    expect(ids(body).every((id) => id.startsWith("eac-"))).toBe(true);
  });

  it("keeps real alternatives on the provider path", async () => {
    await expectProviderRefusal(await ask("Find two pubs in Elephant and Castle or Soho"));
  });
});

const RIVERSIDE_TASTE: PalTaste = {
  visits: 9,
  distinctPubs: 5,
  lastVisit: { name: "The Fountain", on: "2026-10-18" },
  patches: ["Soho"],
  regulars: ["The Fountain"],
  loved: ["The Fountain"],
  notKeen: [],
  drinks: ["Lager"],
  usualPintGbp: null,
  vibes: ["riverside"],
  style: "regular",
  favouriteNight: "Fridays",
  wishlist: [],
};

describe("confirmed owner context in a later plain recommendation", () => {
  it("answers a plain Soho ask with no context from records without leading on the garden pub", async () => {
    const body = await localAnswer(await ask(SOHO));
    expect(body.toolsUsed).toEqual(["search_venues"]);
    expect(ids(body).every((id) => id.startsWith("soho-"))).toBe(true);
    expect(body.cards.every((card) => typeof card.price === "number" && card.price > 0)).toBe(true);
    expect(ids(body)[0]).not.toBe("soho-garden");
  });

  it("ranks the garden pub first for a confirmed garden preference", async () => {
    await remember(OWNER, "venue_preference", "garden");
    const body = await localAnswer(await ask(SOHO));
    expect(body.toolsUsed).toEqual(["search_venues"]);
    expect(ids(body)[0]).toBe("soho-garden");
    expect(ids(body).every((id) => id.startsWith("soho-"))).toBe(true);
  });

  it("keeps one owner's confirmed preference away from another owner", async () => {
    await remember(OTHER, "venue_preference", "garden");
    expect(ids(await localAnswer(await ask(SOHO)))[0]).not.toBe("soho-garden");
    caller.id = OTHER;
    expect(ids(await localAnswer(await ask(SOHO)))[0]).toBe("soho-garden");
  });

  it("lets the current place win over a remembered preference", async () => {
    await remember(OWNER, "venue_preference", "garden");
    const body = await localAnswer(await ask("Find two pubs in Camden"));
    expect(body.cards.length).toBeGreaterThan(0);
    expect(ids(body).every((id) => id.startsWith("camden-"))).toBe(true);
  });

  it("lets the current mood win over a remembered preference", async () => {
    await remember(OWNER, "venue_preference", "garden");
    const body = await localAnswer(await ask("Find four quiet pubs in Soho"));
    expect(ids(body)[0]).toBe("soho-snug");
  });

  it("lets the current budget lead a remembered preference", async () => {
    await remember(OWNER, "venue_preference", "garden");
    const body = await localAnswer(await ask("Find four pubs in Soho under £5"));
    expect(new Set(ids(body).slice(0, 2))).toEqual(new Set(["soho-snug", "soho-ordinary"]));
  });

  it("follows an earlier owned garden recommendation in a plain Soho ask", async () => {
    await registerPubPalToolTurn(THREAD, { query: "Find four garden pubs in Camden", cityId: "london", ownerId: OWNER, turns: [] });
    const body = await localAnswer(await ask(SOHO, THREAD));
    expect(ids(body)[0]).toBe("soho-garden");
    expect(ids(body).every((id) => id.startsWith("soho-"))).toBe(true);
  });

  it("carries an earlier owned budget into a plain Soho ask", async () => {
    await registerPubPalToolTurn(THREAD, { query: "Find four pubs in Camden under £5", cityId: "london", ownerId: OWNER, turns: [] });
    const body = await localAnswer(await ask(SOHO, THREAD));
    expect([...ids(body)].sort()).toEqual(["soho-ordinary", "soho-snug"]);
    for (const card of body.cards) {
      expect(card.price).not.toBeNull();
      expect(card.price!).toBeLessThanOrEqual(5);
    }
    expect(ids(body).every((id) => id.startsWith("soho-"))).toBe(true);
  });

  it("carries an earlier owned budget while the current mood still wins", async () => {
    await registerPubPalToolTurn(THREAD, { query: "Find four pubs in Camden under £5", cityId: "london", ownerId: OWNER, turns: [] });
    const body = await localAnswer(await ask("Find four quiet pubs in Soho", THREAD));
    expect([...ids(body)].sort()).toEqual(["soho-ordinary", "soho-snug"]);
    for (const card of body.cards) {
      expect(card.price).not.toBeNull();
      expect(card.price!).toBeLessThanOrEqual(5);
    }
    expect(ids(body).every((id) => id.startsWith("soho-"))).toBe(true);
  });

  it("keeps the current explicit budget over an earlier owned budget", async () => {
    await registerPubPalToolTurn(THREAD, { query: "Find four pubs in Camden under £5", cityId: "london", ownerId: OWNER, turns: [] });
    const body = await localAnswer(await ask("Find four pubs in Soho under £8", THREAD));
    expect(ids(body)).toContain("soho-pricey");
    for (const card of body.cards) {
      expect(card.price).not.toBeNull();
      expect(card.price!).toBeLessThanOrEqual(8);
    }
    expect(ids(body).every((id) => id.startsWith("soho-"))).toBe(true);
  });

  it.each([
    ["venue_preference", "pubs with a big garden and a dog bowl"],
    ["atmosphere_preference", "never somewhere with a garden"],
    ["venue_preference", "dog friendly"],
  ] as const)("keeps unsupported stored context on the provider path: %s %s", async (kind, value) => {
    await remember(OWNER, kind, value);
    await expectProviderRefusal(await ask(SOHO));
  });

  it("keeps a failed memory read off a local answer", async () => {
    await remember(OWNER, "venue_preference", "garden");
    vi.mocked(listPalMemoriesResult).mockResolvedValue({ ok: false, error: "error" });
    await expectProviderRefusal(await ask(SOHO));
  });

  it("never answers a plain ask silently past a taste read that changes the pick", async () => {
    const projected = await localAnswer(await ask("Find four riverside pubs in Soho"));
    expect(ids(projected)[0]).toBe("soho-water");
    vi.mocked(paidSpendBudgetRefusal).mockClear();
    vi.mocked(readPalTaste).mockResolvedValue(RIVERSIDE_TASTE);
    const response = await ask(SOHO);
    expect(deniedFetch).not.toHaveBeenCalled();
    if (response.status === 429) {
      expect(await response.json()).toEqual({ error: "Paid budget spent" });
      expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
      return;
    }
    expect(response.status).toBe(200);
    expect(ids(await response.json() as ChatBody)[0]).toBe("soho-water");
  });

  it("never answers past the trailing pint ceiling of a 500-character ask after a confirmed preference", async () => {
    await remember(OWNER, "venue_preference", "garden");
    const query = `${SOHO}${" please".repeat(67)} under £5`;
    expect(query).toHaveLength(500);
    const response = await ask(query);
    expect(deniedFetch).not.toHaveBeenCalled();
    if (response.status === 429) {
      expect(await response.json()).toEqual({ error: "Paid budget spent" });
      expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
      return;
    }
    expect(response.status).toBe(200);
    const body = await response.json() as ChatBody;
    expect(body.cards.length).toBeGreaterThan(0);
    for (const card of body.cards) {
      expect(card.price).not.toBeNull();
      expect(card.price!).toBeLessThanOrEqual(5);
    }
  });

  it("answers a factual drink-price lookup from records without a personal read", async () => {
    await remember(OWNER, "venue_preference", "garden");
    vi.mocked(listPalMemoriesResult).mockClear();
    const response = await ask("Wine prices at Fox and Anchor");
    expect(response.status).toBe(200);
    expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
    expect(listPalMemoriesResult).not.toHaveBeenCalled();
    expect(readPalTaste).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });
});
