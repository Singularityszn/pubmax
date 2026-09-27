import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetPubPalToolTurnStore,
  appendPubPalToolTurn,
  consumePubPalToolTurn,
  readPubPalToolTurn,
  registerPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

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
    __resetPubPalToolTurnStore();
  });

  it("register, append, and consume round-trip cards for one conversation", async () => {
    await registerPubPalToolTurn("conv-live-test", {
      query: "quiet pubs in Clapham",
      cityId: "london",
    });

    const card = {
      key: "venue-test",
      venueId: "london-test",
      title: "Test Arms",
      place: "Clapham",
      note: "Logged.",
      price: 5.5,
    };
    await appendPubPalToolTurn("conv-live-test", { cards: [card] });

    const mid = await readPubPalToolTurn("conv-live-test");
    expect(mid?.cards).toEqual([card]);

    const consumed = await consumePubPalToolTurn("conv-live-test");
    expect(consumed?.cards).toEqual([card]);
    expect(await readPubPalToolTurn("conv-live-test")).toBeNull();
  });
});
