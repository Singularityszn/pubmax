import { describe, expect, it, vi } from "vitest";

// The account export: its shape (`lib/accountExport.ts`) and its assembly
// (`lib/accountExport.server.ts`, over fake stores).
//
// What is pinned: every lane the promise names is present; the caller's OWN
// messages are exported and the other side's words are not; a read that could
// not be run is `unavailable` rather than an empty lane; an account with no
// handle still gets its Memories; and the cap says so when it bites.

vi.mock("server-only", () => ({}));

import {
  ACCOUNT_EXPORT_LANE_CAP,
  ACCOUNT_EXPORT_LANES,
  accountExportFilename,
  boundedLane,
  unavailableExportLanes,
  unavailableLane,
} from "@/lib/accountExport";
import {
  buildAccountExport,
  type AccountExportDeps,
} from "@/lib/accountExport.server";
import type { CommunityPriceObservation } from "@/lib/communityPriceStore";
import type { ConversationDTO, MessageDTO } from "@/lib/messages";
import type { NightMemory, NightMoment } from "@/lib/nightMemory";
import type { PintDropDTO } from "@/lib/pintDropsStore";

const USER = "u0000000-0000-4000-8000-000000000001";
const PROFILE = "p0000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-09-05T18:30:00.000Z");

const memory: NightMemory = {
  id: "mem-1",
  ownerId: USER,
  title: "Friday",
  planCompletionId: null,
  visibility: "private",
  createdAt: "2026-09-04T22:00:00.000Z",
  updatedAt: "2026-09-04T23:00:00.000Z",
};

const moment: NightMoment = {
  id: "mom-1",
  memoryId: "mem-1",
  ownerId: USER,
  kind: "photo",
  caption: "first pint",
  pintDropId: null,
  venueId: "venue-1f5ygjb",
  mediaObjectKey: `night-moments/${USER}/mem-1/photo.jpg`,
  occurredAt: null,
  visibility: "private",
  altText: null,
  createdAt: "2026-09-04T22:30:00.000Z",
  altTextConfirmedAt: null,
};

const price: CommunityPriceObservation = {
  id: "price-1",
  venueId: "venue-1f5ygjb",
  drinkCategory: "beer",
  priceGbp: 4.8,
  submittedAt: Date.parse("2026-09-05T12:00:00.000Z"),
  actor: `profile:${PROFILE}`,
  hidden: false,
};

const drop = {
  id: "drop-1",
  venueId: "venue-1f5ygjb",
  handle: "night_owl",
  drink: "Beer",
  priceGbp: 4.8,
  passedDownNote: "",
  era: "",
  provenance: "own",
  status: "visible",
  visibility: "public",
  createdAt: "2026-09-05T12:00:00.000Z",
  pintPhotoUrl: null,
  venuePhotoUrl: null,
  confirmation: { confirmedAt: "2026-09-05T13:00:00.000Z" },
} as unknown as PintDropDTO;

const conversation: ConversationDTO = {
  id: "conv-1",
  otherHandle: "bobpm",
  lastAt: "2026-09-05T12:05:00.000Z",
  lastFromMe: false,
  unread: 0,
};

const thread: MessageDTO[] = [
  {
    id: "msg-1",
    conversationId: "conv-1",
    senderHandle: "night_owl",
    body: "see you at eight",
    createdAt: "2026-09-05T12:00:00.000Z",
    read: true,
    flagged: false,
  },
  {
    id: "msg-2",
    conversationId: "conv-1",
    senderHandle: "bobpm",
    body: "bob's own words, not the caller's to export",
    createdAt: "2026-09-05T12:05:00.000Z",
    read: true,
    flagged: false,
  },
  {
    id: "msg-3",
    conversationId: "conv-1",
    senderHandle: "Night_Owl",
    body: "",
    createdAt: "2026-09-05T12:06:00.000Z",
    read: false,
    flagged: false,
    attachment: { kind: "venue", venueId: "venue-xjf3n0", card: null },
  },
];

function fakeDeps(overrides: Partial<AccountExportDeps> = {}): AccountExportDeps {
  return {
    profileForUser: async () => ({ id: PROFILE, handle: "night_owl", displayName: "Night Owl" }),
    memories: async () => [memory],
    moments: async () => [moment],
    prices: async () => ({ observations: [price], degraded: false }),
    pintDrops: async () => [drop],
    conversations: async () => [conversation],
    messages: async () => thread,
    ...overrides,
  };
}

describe("buildAccountExport", () => {
  it("carries every lane the promise names, with the caller's own rows", async () => {
    const document = await buildAccountExport(USER, fakeDeps(), NOW);

    expect(document.version).toBe(1);
    expect(document.exportedAt).toBe("2026-09-05T18:30:00.000Z");
    expect(document.account).toEqual({ userId: USER, handle: "night_owl", displayName: "Night Owl" });
    for (const lane of ACCOUNT_EXPORT_LANES) expect(document[lane].status).toBe("complete");

    expect(document.memories.items).toEqual([{ ...memory, moments: [moment] }]);
    expect(document.prices.items).toEqual([
      {
        id: "price-1",
        venueId: "venue-1f5ygjb",
        drinkCategory: "beer",
        priceGbp: 4.8,
        submittedAt: "2026-09-05T12:00:00.000Z",
        hidden: false,
      },
    ]);
    expect(document.pintDrops.items).toEqual([
      {
        id: "drop-1",
        venueId: "venue-1f5ygjb",
        drink: "Beer",
        priceGbp: 4.8,
        passedDownNote: "",
        era: "",
        visibility: "public",
        createdAt: "2026-09-05T12:00:00.000Z",
        confirmedAt: "2026-09-05T13:00:00.000Z",
      },
    ]);
    expect(unavailableExportLanes(document)).toEqual([]);
  });

  it("exports the caller's own messages and never the other side's words", async () => {
    const document = await buildAccountExport(USER, fakeDeps(), NOW);

    expect(document.messages.items).toEqual([
      {
        id: "conv-1",
        otherHandle: "bobpm",
        messages: [
          {
            id: "msg-1",
            conversationId: "conv-1",
            body: "see you at eight",
            createdAt: "2026-09-05T12:00:00.000Z",
            attachment: null,
          },
          {
            id: "msg-3",
            conversationId: "conv-1",
            body: "",
            createdAt: "2026-09-05T12:06:00.000Z",
            attachment: { kind: "venue", venueId: "venue-xjf3n0" },
          },
        ],
      },
    ]);
    expect(JSON.stringify(document)).not.toContain("bob's own words");
  });

  it("asks the stores for the caller as author and viewer, under the profile's actor", async () => {
    const asked: string[] = [];
    const deps = fakeDeps({
      prices: async (actor) => {
        asked.push(`prices:${actor}`);
        return { observations: [], degraded: false };
      },
      pintDrops: async (handle) => {
        asked.push(`drops:${handle}`);
        return [];
      },
      conversations: async (handle) => {
        asked.push(`inbox:${handle}`);
        return [];
      },
    });

    await buildAccountExport(USER, deps, NOW);

    expect(asked).toEqual([`prices:profile:${PROFILE}`, "drops:night_owl", "inbox:night_owl"]);
  });

  it("still exports Memories for an account that never claimed a handle, and asks no handle lane", async () => {
    const deps = fakeDeps({
      profileForUser: async () => null,
      prices: async () => {
        throw new Error("must not be asked without a profile");
      },
      pintDrops: async () => {
        throw new Error("must not be asked without a handle");
      },
      conversations: async () => {
        throw new Error("must not be asked without a handle");
      },
    });

    const document = await buildAccountExport(USER, deps, NOW);

    expect(document.account).toEqual({ userId: USER, handle: null, displayName: null });
    expect(document.memories.items).toHaveLength(1);
    expect(document.prices).toEqual({ status: "complete", truncated: false, items: [] });
    expect(document.pintDrops).toEqual({ status: "complete", truncated: false, items: [] });
    expect(document.messages).toEqual({ status: "complete", truncated: false, items: [] });
  });

  it("marks a lane unavailable when its read could not be run, rather than emptying it", async () => {
    const degraded = await buildAccountExport(
      USER,
      fakeDeps({ prices: async () => ({ observations: [], degraded: true }) }),
      NOW,
    );
    expect(degraded.prices).toEqual(unavailableLane());
    expect(unavailableExportLanes(degraded)).toEqual(["prices"]);

    const threw = await buildAccountExport(
      USER,
      fakeDeps({
        memories: async () => {
          throw new Error("night_memories unreadable");
        },
      }),
      NOW,
    );
    expect(unavailableExportLanes(threw)).toEqual(["memories"]);

    // The inbox named the thread as the caller's, so a refused thread read is
    // a failed read and not "not theirs".
    const refused = await buildAccountExport(USER, fakeDeps({ messages: async () => null }), NOW);
    expect(unavailableExportLanes(refused)).toEqual(["messages"]);
  });

  it("says when the cap bit rather than presenting a window as the whole", async () => {
    const many = Array.from({ length: ACCOUNT_EXPORT_LANE_CAP + 1 }, (_, i) => ({
      ...price,
      id: `price-${i}`,
    }));
    const document = await buildAccountExport(
      USER,
      fakeDeps({ prices: async () => ({ observations: many, degraded: false }) }),
      NOW,
    );

    expect(document.prices.truncated).toBe(true);
    expect(document.prices.items).toHaveLength(ACCOUNT_EXPORT_LANE_CAP);
    expect(document.pintDrops.truncated).toBe(false);
  });
});

describe("the export's own helpers", () => {
  it("names the file after the handle and the day, and falls back to the account", () => {
    expect(accountExportFilename("Night_Owl", "2026-09-05T18:30:00.000Z")).toBe(
      "pubmaxx-night_owl-2026-09-05.json",
    );
    expect(accountExportFilename(null, "2026-09-05T18:30:00.000Z")).toBe(
      "pubmaxx-account-2026-09-05.json",
    );
  });

  it("bounds a lane to the cap and says so", () => {
    expect(boundedLane([1, 2, 3])).toEqual({ status: "complete", truncated: false, items: [1, 2, 3] });
    const over = boundedLane(Array.from({ length: ACCOUNT_EXPORT_LANE_CAP + 5 }, (_, i) => i));
    expect(over.truncated).toBe(true);
    expect(over.items).toHaveLength(ACCOUNT_EXPORT_LANE_CAP);
  });
});
