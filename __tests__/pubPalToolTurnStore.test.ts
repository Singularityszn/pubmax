import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetPubPalToolTurnStore,
  appendOwnedPubPalUserTurn,
  appendPubPalToolTurn,
  consumePubPalToolTurn,
  PUB_PAL_TOOL_TURN_TTL_MS,
  PubPalToolTurnAccessError,
  readPubPalToolTurn,
  registerPubPalToolTurn,
  touchPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

const CONVERSATION_ID = "conv_storetest01";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER_ID = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

describe("pubPalToolTurnStore (memory backend)", () => {
  afterEach(() => {
    vi.useRealTimers();
    __resetPubPalToolTurnStore();
  });

  it("register, append, and consume round-trip cards for one conversation", async () => {
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

    const consumed = await consumePubPalToolTurn(CONVERSATION_ID);
    expect(consumed?.cards).toEqual([card]);
    expect(consumed?.toolsUsed).toEqual(["search_venues"]);
    expect(await readPubPalToolTurn(CONVERSATION_ID)).toBeNull();
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
    expect(await readPubPalToolTurn(CONVERSATION_ID)).toBeNull();
  });
});
