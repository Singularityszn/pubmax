import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetPubPalToolTurnStore,
  appendOwnedPubPalUserTurn,
  bindPubPalToolTurn,
  hasStoredPubPalToolTurnForTest,
  appendPubPalToolTurn,
  PUB_PAL_TOOL_TURN_TTL_MS,
  PubPalToolTurnAccessError,
  purgeExpiredPubPalToolTurns,
  readOwnedPubPalToolTurn,
  readPubPalToolTurn,
  registerPubPalToolTurn,
  touchPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

const CONVERSATION_ID = "conv_storetest01";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER_ID = "22222222-2222-4222-8222-222222222222";

type FakeRow = Record<string, unknown> & { conversation_id: string; expires_at: string };

const durable = vi.hoisted(() => ({
  configured: false,
  deletes: [] as Array<{ table: string; column: string; value: string }>,
  rows: new Map<string, FakeRow>(),
}));

function matches(row: FakeRow, filters: Array<[string, string]>): boolean {
  return filters.every(([column, value]) => row[column] === value);
}

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => durable.configured,
    requiresSupabaseStore: () => false,
    requireSupabaseAdmin: () => ({
      from: (table: string) => ({
        delete: () => ({
          lt: async (column: string, value: string) => {
            durable.deletes.push({ table, column, value });
            return { error: null };
          },
        }),
        select: () => {
          const filters: Array<[string, string]> = [];
          const query = {
            eq: (column: string, value: string) => {
              filters.push([column, value]);
              return query;
            },
            gt: () => query,
            maybeSingle: async () => {
              const row = [...durable.rows.values()].find((candidate) =>
                matches(candidate, filters),
              );
              return { data: row ? structuredClone(row) : null, error: null };
            },
          };
          return query;
        },
        update: (values: Record<string, unknown>) => {
          const filters: Array<[string, string]> = [];
          const query = {
            eq: (column: string, value: string) => {
              filters.push([column, value]);
              return query;
            },
            select: async () => {
              const hits = [...durable.rows.values()].filter((row) => matches(row, filters));
              for (const row of hits) {
                durable.rows.set(row.conversation_id, { ...row, ...structuredClone(values) });
              }
              return { data: hits.map((row) => ({ conversation_id: row.conversation_id })), error: null };
            },
          };
          return query;
        },
        upsert: async (row: FakeRow) => {
          durable.rows.set(row.conversation_id, structuredClone(row));
          return { error: null };
        },
      }),
    }),
  };
});

describe("pubPalToolTurnStore (memory backend)", () => {
  afterEach(() => {
    vi.useRealTimers();
    __resetPubPalToolTurnStore();
  });

  it("register, append, and read round-trip cards for one conversation", async () => {
    await registerPubPalToolTurn(CONVERSATION_ID, {
      query: "quiet pubs in Clapham",
      cityId: "london",
      ownerId: OWNER_ID,
    });

    const card = {
      key: "venue-test",
      venueId: "london-test",
      title: "Test Arms",
      place: "Clapham",
      note: "Logged.",
      price: 5.5,
    };
    await appendPubPalToolTurn(CONVERSATION_ID, {
      cards: [card],
      toolsUsed: ["search_venues"],
    });

    const mid = await readPubPalToolTurn(CONVERSATION_ID);
    expect(mid?.cards).toEqual([card]);
    expect(mid?.toolsUsed).toEqual(["search_venues"]);

    const owned = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
    expect(owned?.query).toBe("quiet pubs in Clapham");
    expect(owned?.cards).toEqual([card]);
  });

  it("refuses another account the same conversation", async () => {
    await registerPubPalToolTurn(CONVERSATION_ID, {
      query: "quiet pubs in Clapham",
      cityId: "london",
      ownerId: OWNER_ID,
    });

    await expect(
      registerPubPalToolTurn(CONVERSATION_ID, {
        query: "stolen",
        cityId: "london",
        ownerId: OTHER_OWNER_ID,
      }),
    ).rejects.toBeInstanceOf(PubPalToolTurnAccessError);
    expect(await touchPubPalToolTurn(CONVERSATION_ID, OTHER_OWNER_ID)).toBe(false);
    expect(
      await appendOwnedPubPalUserTurn(
        CONVERSATION_ID,
        OTHER_OWNER_ID,
        { role: "user", content: "not mine" },
        "london",
      ),
    ).toBe(false);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OTHER_OWNER_ID)).toBeNull();
    expect((await readPubPalToolTurn(CONVERSATION_ID))?.query).toBe("quiet pubs in Clapham");
  });

  it("keeps only the newest voice lines and stores no session summary for a voice row", async () => {
    await bindPubPalToolTurn(CONVERSATION_ID, OWNER_ID, "london");
    for (let index = 1; index <= 8; index += 1) {
      expect(
        await appendOwnedPubPalUserTurn(
          CONVERSATION_ID,
          OWNER_ID,
          { role: "user", content: `ask ${index}` },
          "london",
        ),
      ).toBe(true);
    }

    const owned = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
    expect(owned?.turns.map((turn) => turn.content)).toEqual([
      "ask 3",
      "ask 4",
      "ask 5",
      "ask 6",
      "ask 7",
      "ask 8",
    ]);
    expect(owned?.summary).toBe("");
  });

  it("drops a turn once the retention window has passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00.000Z"));
    await registerPubPalToolTurn(CONVERSATION_ID, {
      query: "quiet pubs in Clapham",
      cityId: "london",
      ownerId: OWNER_ID,
    });
    vi.setSystemTime(new Date(Date.now() + PUB_PAL_TOOL_TURN_TTL_MS + 1));
    expect(hasStoredPubPalToolTurnForTest(CONVERSATION_ID)).toBe(true);
    await purgeExpiredPubPalToolTurns();
    expect(hasStoredPubPalToolTurnForTest(CONVERSATION_ID)).toBe(false);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toBeNull();
  });
});

describe("pubPalToolTurnStore (durable backend purge)", () => {
  afterEach(() => {
    vi.useRealTimers();
    durable.configured = false;
    durable.deletes = [];
    durable.rows.clear();
    __resetPubPalToolTurnStore();
  });

  it("keeps both results when two tools append to one turn at once", async () => {
    durable.configured = true;
    await registerPubPalToolTurn(CONVERSATION_ID, {
      query: "Plan me a 3 pub crawl in Shoreditch tonight",
      cityId: "london",
      ownerId: OWNER_ID,
    });
    const card = (venueId: string) => ({
      key: venueId,
      venueId,
      title: venueId,
      place: "Shoreditch",
      note: "Logged.",
      price: null,
    });

    await Promise.all([
      appendPubPalToolTurn(CONVERSATION_ID, {
        cards: [card("london-a")],
        toolsUsed: ["search_venues"],
      }),
      appendPubPalToolTurn(CONVERSATION_ID, {
        cards: [card("london-b")],
        toolsUsed: ["propose_plan"],
      }),
    ]);

    const turn = await readPubPalToolTurn(CONVERSATION_ID);
    expect(turn?.toolsUsed.sort()).toEqual(["propose_plan", "search_venues"]);
    expect(turn?.cards.map((stored) => stored.venueId).sort()).toEqual(["london-a", "london-b"]);
  });

  it("keeps a tool result when the owner's line and a keep-alive write at the same time", async () => {
    durable.configured = true;
    await registerPubPalToolTurn(CONVERSATION_ID, {
      query: "Plan me a 3 pub crawl in Shoreditch tonight",
      cityId: "london",
      ownerId: OWNER_ID,
    });

    await Promise.all([
      touchPubPalToolTurn(CONVERSATION_ID, OWNER_ID),
      appendOwnedPubPalUserTurn(
        CONVERSATION_ID,
        OWNER_ID,
        { role: "user", content: "somewhere cheaper" },
        "london",
      ),
      appendPubPalToolTurn(CONVERSATION_ID, {
        hints: ["Proposed draft."],
        toolsUsed: ["propose_plan"],
      }),
    ]);

    const turn = await readPubPalToolTurn(CONVERSATION_ID);
    expect(turn?.toolsUsed).toEqual(["propose_plan"]);
    expect(turn?.hints).toEqual(["Proposed draft."]);
    expect(turn?.query).toBe("somewhere cheaper");
  });

  it("deletes every row whose expires_at has passed", async () => {
    durable.configured = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00.000Z"));

    await purgeExpiredPubPalToolTurns();

    expect(durable.deletes).toEqual([
      { table: "pub_pal_tool_turns", column: "expires_at", value: "2026-10-02T12:00:00.000Z" },
    ]);
  });
});
