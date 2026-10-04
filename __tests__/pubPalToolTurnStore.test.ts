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

const durable = vi.hoisted(() => ({
  configured: false,
  deletes: [] as Array<{ table: string; column: string; value: string }>,
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
            return { error: null };
          },
        }),
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
