// GROUP THREADS: the rule, the store and the door.
//
// The store was 1:1 in its own type (`participants(): Promise<HandlePair>`) and
// the table said so in SQL. This holds the three halves of widening it
// (docs/adr/0015-group-message-threads.md): the pure policy, the membership
// seam every courtesy check now asks, and the two doors — opening a group whole
// and leaving one.
//
// THE LOAD-BEARING CLAIM is that a DIRECT conversation did not move. Its
// membership is still its own pair columns, nothing was backfilled into the
// members table, and every refusal a 1:1 made it still makes.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanGroupTitle,
  GROUP_EMPTY_NAME,
  GROUP_MAX_MEMBERS,
  GROUP_MEMBER_FLOOR_LINE,
  GROUP_MIN_MEMBERS,
  GROUP_TITLE_MAX,
  groupMemberCountLine,
  groupThreadName,
  isConversationKind,
  isGroupMember,
  normalizeGroupMembers,
} from "@/lib/messageGroupThread";
import {
  conversationRowName,
  isMember,
  membershipFromPair,
  otherMembers,
  type ConversationDTO,
} from "@/lib/messages";
import {
  __resetMemoryMessages,
  memoryMessagesStore,
} from "@/lib/messagesStore";

beforeEach(() => {
  __resetMemoryMessages();
});

describe("the group vocabulary is a closed set with two caps", () => {
  it("names exactly direct and group", () => {
    expect(isConversationKind("direct")).toBe(true);
    expect(isConversationKind("group")).toBe(true);
    expect(isConversationKind("crew")).toBe(false);
    expect(isConversationKind(undefined)).toBe(false);
  });

  it("floors at three, because two in a group is a DM wearing a title", () => {
    expect(GROUP_MIN_MEMBERS).toBe(3);
    // Two people already key uniquely as a pair, so a two-person group would
    // be a SECOND row for one pair and a reply could land in either.
    expect(normalizeGroupMembers("ken", ["sam"])).toBeNull();
    expect(normalizeGroupMembers("ken", ["sam", "jen"])).toEqual(["ken", "sam", "jen"]);
  });

  it("puts the creator first and never twice", () => {
    expect(normalizeGroupMembers("ken", ["@Ken", "sam", "SAM", "jen"])).toEqual([
      "ken",
      "sam",
      "jen",
    ]);
  });

  it("refuses a list past the ceiling rather than collecting it first", () => {
    const many = Array.from({ length: GROUP_MAX_MEMBERS + 4 }, (_, i) => `mate${i}`);
    expect(normalizeGroupMembers("ken", many)).toBeNull();
    const exact = Array.from({ length: GROUP_MAX_MEMBERS - 1 }, (_, i) => `mate${i}`);
    expect(normalizeGroupMembers("ken", exact)).toHaveLength(GROUP_MAX_MEMBERS);
  });

  it("refuses anything that is not a list of handles", () => {
    expect(normalizeGroupMembers("ken", "sam,jen")).toBeNull();
    expect(normalizeGroupMembers("", ["sam", "jen"])).toBeNull();
    expect(normalizeGroupMembers("ken", ["", "  ", "!!"])).toBeNull();
  });

  it("cleans a title to the cap, and nothing is a real answer", () => {
    expect(cleanGroupTitle("  Friday session  ")).toBe("Friday session");
    expect(cleanGroupTitle("   ")).toBeNull();
    expect(cleanGroupTitle(undefined)).toBeNull();
    expect((cleanGroupTitle("x".repeat(200)) ?? "").length).toBe(GROUP_TITLE_MAX);
  });
});

describe("a group is NAMED, never called Group", () => {
  it("prefers the title", () => {
    expect(groupThreadName("Friday session", ["ken", "sam", "jen"], "ken")).toBe(
      "Friday session",
    );
  });

  it("falls back to the people, leaving the viewer out", () => {
    expect(groupThreadName(null, ["ken", "sam", "jen"], "ken")).toBe("@sam, @jen");
  });

  it("counts the rest rather than turning an inbox row into a paragraph", () => {
    const handles = ["ken", "a", "b", "c", "d", "e"];
    expect(groupThreadName(null, handles, "ken")).toBe("@a, @b, @c +2");
  });

  it("says so when there is nobody else left", () => {
    expect(groupThreadName(null, ["ken"], "ken")).toBe(GROUP_EMPTY_NAME);
  });

  it("counts people in words a heading can carry", () => {
    expect(groupMemberCountLine(1)).toBe("1 person");
    expect(groupMemberCountLine(4)).toBe("4 people");
  });

  it("names an inbox row through ONE rule for both kinds", () => {
    const direct: ConversationDTO = {
      id: "c1",
      otherHandle: "sam",
      lastAt: "2026-09-17T10:00:00Z",
      lastFromMe: false,
    };
    const group: ConversationDTO = {
      ...direct,
      id: "c2",
      kind: "group",
      memberHandles: ["ken", "sam", "jen"],
    };
    expect(conversationRowName(direct, "ken")).toBe("@sam");
    expect(conversationRowName(group, "ken")).toBe("@sam, @jen");
    expect(conversationRowName({ ...group, title: "Friday" }, "ken")).toBe("Friday");
  });
});

describe("membership is the seam, and a pair is still a pair", () => {
  it("reads a direct conversation's membership off its own pair", () => {
    const membership = membershipFromPair({ handleA: "ken", handleB: "sam" });
    expect(membership).toEqual({ kind: "direct", handles: ["ken", "sam"], title: null });
    expect(isMember(membership, "@KEN")).toBe(true);
    expect(isMember(membership, "mallory")).toBe(false);
    expect(otherMembers(membership, "ken")).toEqual(["sam"]);
  });

  it("matches a group member through the same normalisation", () => {
    expect(isGroupMember(["ken", "sam"], "@Sam")).toBe(true);
    expect(isGroupMember(["ken", "sam"], "")).toBe(false);
  });
});

describe("the store opens a group whole and lets anybody leave", () => {
  it("opens with its members and names itself by kind", async () => {
    const opened = await memoryMessagesStore.openGroupConversation(
      "ken",
      ["ken", "sam", "jen"],
      "Friday session",
    );
    expect(opened.status).toBe("opened");
    const id = opened.status === "opened" ? opened.conversationId : "";
    await expect(memoryMessagesStore.membership(id)).resolves.toEqual({
      kind: "group",
      handles: ["ken", "sam", "jen"],
      title: "Friday session",
    });
  });

  it("refuses a list the caps would not admit, before any row is written", async () => {
    await expect(
      memoryMessagesStore.openGroupConversation("ken", ["ken", "sam"], null),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      memoryMessagesStore.openGroupConversation("ken", ["sam", "jen"], null),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("lets every member read and send, and nobody else", async () => {
    const opened = await memoryMessagesStore.openGroupConversation(
      "ken",
      ["ken", "sam", "jen"],
      null,
    );
    const id = opened.status === "opened" ? opened.conversationId : "";
    const sent = await memoryMessagesStore.send(id, "jen", "we on for Friday?");
    expect(sent?.membership.kind).toBe("group");
    expect(sent?.membership.handles).toEqual(["ken", "sam", "jen"]);
    await expect(memoryMessagesStore.listMessages(id, "sam")).resolves.toHaveLength(1);
    // THE COURTESY CHECK IS THE SAME ONE, widened past two.
    await expect(memoryMessagesStore.listMessages(id, "mallory")).resolves.toBeNull();
    await expect(memoryMessagesStore.send(id, "mallory", "hi")).resolves.toBeNull();
  });

  it("puts the group in every member's inbox and nobody else's", async () => {
    const opened = await memoryMessagesStore.openGroupConversation(
      "ken",
      ["ken", "sam", "jen"],
      "Friday",
    );
    const id = opened.status === "opened" ? opened.conversationId : "";
    await memoryMessagesStore.send(id, "ken", "pub?");
    for (const handle of ["ken", "sam", "jen"]) {
      const inbox = await memoryMessagesStore.listConversations(handle);
      expect(inbox.conversations.map((c) => c.id)).toContain(id);
      const row = inbox.conversations.find((c) => c.id === id);
      expect(row?.kind).toBe("group");
      expect(row?.title).toBe("Friday");
      expect(row?.memberHandles).toEqual(["ken", "sam", "jen"]);
    }
    await expect(memoryMessagesStore.listConversations("mallory")).resolves.toEqual({
      conversations: [],
      status: "ready",
    });
  });

  it("lets a member leave, and refuses at the floor", async () => {
    const opened = await memoryMessagesStore.openGroupConversation(
      "ken",
      ["ken", "sam", "jen", "ali"],
      null,
    );
    const id = opened.status === "opened" ? opened.conversationId : "";
    await expect(memoryMessagesStore.leaveGroupConversation(id, "ali")).resolves.toBe("left");
    // The words stay; the way in does not.
    await expect(memoryMessagesStore.listMessages(id, "ali")).resolves.toBeNull();
    const inbox = await memoryMessagesStore.listConversations("ali");
    expect(inbox.conversations).toHaveLength(0);
    // THREE LEFT IS THE FLOOR: the last three are a DM with extra steps.
    await expect(memoryMessagesStore.leaveGroupConversation(id, "jen")).resolves.toBe("floor");
    expect(GROUP_MEMBER_FLOOR_LINE).toMatch(/one to one/i);
  });

  it("refuses to let anybody leave a DIRECT conversation", async () => {
    const id = (await memoryMessagesStore.openConversation("ken", "sam"))!;
    // Half of two people's record of talking to each other is not the leaver's
    // to take away, so it answers exactly as an outsider's attempt does.
    await expect(memoryMessagesStore.leaveGroupConversation(id, "ken")).resolves.toBe(
      "not-member",
    );
    await expect(memoryMessagesStore.leaveGroupConversation(id, "mallory")).resolves.toBe(
      "not-member",
    );
  });
});

describe("the group door", () => {
  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import("@/app/api/messages/route");
    return POST(
      new Request("http://localhost/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  };

  beforeEach(() => {
    vi.resetModules();
  });

  it("refuses an unsigned caller before it reads a participant list", async () => {
    const res = await post({ action: "open-group", handle: "ken", participants: ["sam", "jen"] });
    expect(res.status).toBe(401);
  });
});
