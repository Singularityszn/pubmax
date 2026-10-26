import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The committed pack answers here: no venue or menu reader double. Only auth,
// rate limiting, owner stores, paid spend, provider fetch and the socket stand in.
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  clientIp: () => "203.0.113.85",
  hashIp: (ip: string) => `hashed:${ip}`,
  isSupabaseConfigured: () => false,
  requiresSupabaseStore: () => false,
  checkRateLimitDurableDetailed: async () => ({ verdict: false, reason: "counted" }),
}));
vi.mock("@/lib/authServer", () => ({ callerUserId: async () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("@/lib/paidSpendBudget.server", () => ({
  paidSpendBudgetRefusal: vi.fn(async () => Response.json({ error: "Paid budget spent" }, { status: 429 })),
}));
vi.mock("@/lib/palConfirmedMemories.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/palConfirmedMemories.server")>()),
  readConfirmedPalMemories: vi.fn(),
}));
vi.mock("@/lib/palTaste.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/palTaste.server")>()),
  readPalTaste: vi.fn(),
}));

import { POST } from "@/app/api/pub-pal/chat/route";
import { readConfirmedPalMemories } from "@/lib/palConfirmedMemories.server";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { readPalTaste } from "@/lib/palTaste.server";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetPubPalToolTurnStore, readOwnedPubPalToolTurn } from "@/lib/pubPalToolTurnStore";

const OWNER = "11111111-1111-4111-8111-111111111111";
const deniedFetch = vi.fn(async () => { throw new Error("External services are denied"); });
const deniedSocket = vi.fn(function deniedSocket() { throw new Error("Provider conversations are denied"); });

// A committed record name beside the area that record is filed under, with its id.
const QUALIFIED_RECORDS: Array<[query: string, name: string, venueId: string]> = [
  ["Wine prices at The Lamb in Camden", "The Lamb", "venue-1yd70c7"],
  ["Menu at Sherlock Holmes in Westminster", "Sherlock Holmes", "venue-gk2fp9"],
];

function ask(query: string) {
  return POST(new Request("http://localhost/api/pub-pal/chat", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, cityId: "london" }),
  }));
}

async function expectProviderAdmission(response: Response) {
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: "Paid budget spent" });
  expect(paidSpendBudgetRefusal).toHaveBeenCalledOnce();
  expect(deniedFetch).not.toHaveBeenCalled();
  expect(deniedSocket).not.toHaveBeenCalled();
}

async function expectLocalRecords(response: Response) {
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ toolsUsed: ["venue_drinks"] });
  expect(paidSpendBudgetRefusal).not.toHaveBeenCalled();
  expect(deniedFetch).not.toHaveBeenCalled();
  expect(deniedSocket).not.toHaveBeenCalled();
  return body;
}

beforeEach(() => {
  __resetPintDrops();
  __resetPubPalToolTurnStore();
  for (const key of ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) vi.stubEnv(key, "");
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
  vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "agent-id");
  deniedFetch.mockClear();
  deniedSocket.mockClear();
  vi.stubGlobal("fetch", deniedFetch);
  vi.stubGlobal("WebSocket", deniedSocket);
  vi.mocked(readConfirmedPalMemories).mockReset().mockResolvedValue([]);
  vi.mocked(readPalTaste).mockReset().mockResolvedValue(null);
  vi.mocked(paidSpendBudgetRefusal).mockClear();
});

afterEach(() => {
  __resetPubPalToolTurnStore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("committed pub records over configured HTTP", () => {
  it.each(QUALIFIED_RECORDS)("answers only the record filed under the named area: %s", async (query, name, venueId) => {
    const body = await expectLocalRecords(await ask(query));
    expect(body.answer).toContain(name);
    expect(body.proposals).toMatchObject([{ kind: "open_venue", venueId }]);
    const bound = [...body.cards, ...body.proposals].map((item: { venueId?: string }) => item.venueId);
    expect(new Set(bound)).toEqual(new Set([venueId]));
    expect((await readOwnedPubPalToolTurn(body.conversationId, OWNER))?.query).toBe(query);
  });

  it("asks which listed pub an unqualified shared name means", async () => {
    const body = await expectLocalRecords(await ask("Wine prices at The Lamb"));
    expect(body).toMatchObject({ cards: [], proposals: [] });
    expect(body.answer).toMatch(/More than one listed pub is called (?:The )?Lamb\. Name its area to choose one\./);
  });

  it("keeps a listed name beside an area none of its records is filed under on the provider path", async () => {
    await expectProviderAdmission(await ask("Wine prices at The Lamb in Bloomsbury"));
  });

  it("keeps a pub search in Bloomsbury on the provider path", async () => {
    await expectProviderAdmission(await ask("Find four pubs in Bloomsbury"));
  });
});
