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

type DurableTestRow = {
  conversation_id: string;
  owner_id: string | null;
  payload: unknown;
  expires_at: string;
};

const durable = vi.hoisted(() => ({
  configured: false,
  deletes: [] as Array<{ table: string; column: string; value: string }>,
  rows: new Map<string, DurableTestRow>(),
}));

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
            for (const [id, row] of durable.rows) {
              if (row.expires_at < value) durable.rows.delete(id);
            }
            return { error: null };
          },
        }),
        select: () => ({
          eq: (_column: string, conversationId: string) => ({
            gt: (_expiryColumn: string, cutoff: string) => ({
              maybeSingle: async () => {
                const row = durable.rows.get(conversationId);
                return {
                  data: row && row.expires_at > cutoff ? structuredClone(row) : null,
                  error: null,
                };
              },
            }),
          }),
        }),
        upsert: async (row: DurableTestRow) => {
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

describe.each(["memory", "durable"] as const)("Pub Pal last-line retention (%s)", (backend) => {
  afterEach(() => {
    vi.useRealTimers();
    durable.configured = false;
    durable.deletes = [];
    durable.rows.clear();
    __resetPubPalToolTurnStore();
  });

  async function registerLine(): Promise<number> {
    durable.configured = backend === "durable";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00.000Z"));
    const started = Date.now();
    await registerPubPalToolTurn(CONVERSATION_ID, {
      query: "quiet pubs in Clapham",
      cityId: "london",
      ownerId: OWNER_ID,
    });
    return started;
  }

  function rowExists(): boolean {
    return backend === "durable"
      ? durable.rows.has(CONVERSATION_ID)
      : hasStoredPubPalToolTurnForTest(CONVERSATION_ID);
  }

  it.each(["touch", "bind"] as const)("%s without a user line keeps the original purge deadline", async (action) => {
    const started = await registerLine();
    vi.setSystemTime(started + 90_000);
    if (action === "touch") {
      expect(await touchPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toBe(true);
    } else {
      await bindPubPalToolTurn(CONVERSATION_ID, OWNER_ID, "london");
    }
    expect((await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID))?.expiresAt)
      .toBe(started + PUB_PAL_TOOL_TURN_TTL_MS);
    vi.setSystemTime(started + PUB_PAL_TOOL_TURN_TTL_MS + 1);
    expect(rowExists()).toBe(true);
    await purgeExpiredPubPalToolTurns();
    expect(rowExists()).toBe(false);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toBeNull();
    expect(await touchPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toBe(false);
  });

  it("a new user line renews retention and still expires after its own two minutes", async () => {
    const started = await registerLine();
    vi.setSystemTime(started + 90_000);
    expect(await appendOwnedPubPalUserTurn(
      CONVERSATION_ID, OWNER_ID, { role: "user", content: "Under six pounds in Soho." }, "london",
    )).toBe(true);
    vi.setSystemTime(started + PUB_PAL_TOOL_TURN_TTL_MS + 1);
    await purgeExpiredPubPalToolTurns();
    expect(rowExists()).toBe(true);
    expect((await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID))?.query)
      .toBe("Under six pounds in Soho.");
    vi.setSystemTime(started + 90_000 + PUB_PAL_TOOL_TURN_TTL_MS + 1);
    await purgeExpiredPubPalToolTurns();
    expect(rowExists()).toBe(false);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toBeNull();
  });

  it.each([
    { role: "assistant", content: "A tool result." },
    { role: "user", content: "   " },
  ] as const)("refuses a non-user-line append without changing retention (%s)", async (turn) => {
    const started = await registerLine();
    vi.setSystemTime(started + 90_000);
    expect(await appendOwnedPubPalUserTurn(CONVERSATION_ID, OWNER_ID, turn, "london"))
      .toBe(false);
    const stored = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
    expect(stored?.query).toBe("quiet pubs in Clapham");
    expect(stored?.turns).toEqual([]);
    expect(stored?.expiresAt).toBe(started + PUB_PAL_TOOL_TURN_TTL_MS);
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
