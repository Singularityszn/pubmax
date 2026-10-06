// The inbox store knows handles; the face and the name come from one batch read
// of the public cards, joined on afterwards. A person who set a name and a photo
// is shown with both, a group is never lent a person's face, a withdrawn handle
// gets nothing, and a card read that fails leaves the inbox as it was.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationDTO } from "@/lib/messages";

const state = vi.hoisted(() => ({
  cards: new Map<string, { displayName?: string; avatarUrl?: string }>(),
  withdrawn: new Set<string>(),
  fails: false,
  asked: [] as string[][],
}));

vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({
    getPublicCardsByHandles: async (handles: readonly string[]) => {
      state.asked.push([...handles]);
      if (state.fails) throw new Error("store down");
      return state.cards;
    },
  }),
}));
vi.mock("@/lib/accountPublicAccess.server", () => ({
  withdrawnHandles: async (handles: readonly string[]) =>
    new Set(handles.filter((handle) => state.withdrawn.has(handle))),
}));

import { attachParticipantCards } from "@/lib/messageParticipantCards.server";

const direct = (id: string, otherHandle: string): ConversationDTO => ({
  id,
  otherHandle,
  lastAt: "2026-10-06T12:00:00Z",
  lastFromMe: false,
});

beforeEach(() => {
  state.cards = new Map([
    ["qa_bob", { displayName: "Bob Baker", avatarUrl: "/api/profiles/b/avatar?v=1" }],
    ["qa_cat", { displayName: "Cat Cole" }],
    ["qa_gone", { displayName: "Gone Gary", avatarUrl: "/api/profiles/g/avatar?v=1" }],
  ]);
  state.withdrawn.clear();
  state.fails = false;
  state.asked = [];
});

describe("attachParticipantCards", () => {
  it("adds the name and the face the person set, in one batch for the whole inbox", async () => {
    const rows = await attachParticipantCards([
      direct("c1", "qa_bob"),
      direct("c2", "qa_cat"),
      direct("c3", "qa_nobody"),
    ]);

    expect(rows[0]).toMatchObject({
      otherDisplayName: "Bob Baker",
      otherAvatarUrl: "/api/profiles/b/avatar?v=1",
    });
    expect(rows[1]).toMatchObject({ otherDisplayName: "Cat Cole" });
    expect(rows[1]).not.toHaveProperty("otherAvatarUrl");
    expect(rows[2]).toEqual(direct("c3", "qa_nobody"));
    expect(state.asked).toEqual([["qa_bob", "qa_cat", "qa_nobody"]]);
  });

  it("never lends a group row a person's name or face", async () => {
    const group: ConversationDTO = {
      ...direct("g1", "qa_bob"),
      kind: "group",
      title: "Friday",
      memberHandles: ["alice", "qa_bob"],
    };
    const [row] = await attachParticipantCards([group]);
    expect(row).toEqual(group);
    expect(state.asked).toEqual([]);
  });

  it("gives a withdrawn handle no card", async () => {
    state.withdrawn.add("qa_gone");
    const [row] = await attachParticipantCards([direct("c1", "qa_gone")]);
    expect(row).toEqual(direct("c1", "qa_gone"));
  });

  it("leaves the inbox as the store returned it when the card read fails", async () => {
    state.fails = true;
    const rows = [direct("c1", "qa_bob")];
    expect(await attachParticipantCards(rows)).toEqual(rows);
  });

  it("asks nobody for an empty inbox", async () => {
    expect(await attachParticipantCards([])).toEqual([]);
    expect(state.asked).toEqual([]);
  });
});
