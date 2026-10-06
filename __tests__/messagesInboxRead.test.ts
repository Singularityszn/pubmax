// The durable messages store's READ SHAPE, fenced on a fake PostgREST client.
//
// The inbox used to ask ONE query per conversation (each pulling up to 200
// rows) to find the last message and the unread count, so a 30-conversation
// inbox was 31 serial round trips. The thread read asked for the pair and then
// the rows in sequence, and then WROTE a read_at update on every poll whether
// anything was unread or not. This file counts the queries.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));


type Recorded = {
  table: string;
  op: "select" | "update" | "insert" | "upsert";
  filters: Array<[string, ...unknown[]]>;
  limit?: number;
  single?: boolean;
};

const state = vi.hoisted(() => ({
  queries: [] as Array<{ table: string; op: string; filters: Array<[string, ...unknown[]]>; limit?: number; single?: boolean }>,
  answer: (() => ({ data: null, error: null })) as (q: {
    table: string;
    op: string;
    filters: Array<[string, ...unknown[]]>;
    limit?: number;
    single?: boolean;
  }) => { data: unknown; error: { message: string } | null },
}));

function builder(table: string) {
  const query: Recorded = { table, op: "select", filters: [] };
  const chain: Record<string, unknown> = {};
  const record = (name: string) => (...args: unknown[]) => {
    query.filters.push([name, ...args]);
    return chain;
  };
  chain.select = (...args: unknown[]) => {
    if (query.op === "select") query.filters.push(["select", ...args]);
    else query.filters.push(["returning", ...args]);
    return chain;
  };
  chain.update = (...args: unknown[]) => {
    query.op = "update";
    query.filters.push(["update", ...args]);
    return chain;
  };
  chain.insert = (...args: unknown[]) => {
    query.op = "insert";
    query.filters.push(["insert", ...args]);
    return chain;
  };
  chain.upsert = (...args: unknown[]) => {
    query.op = "upsert";
    query.filters.push(["upsert", ...args]);
    return chain;
  };
  for (const name of ["eq", "neq", "is", "in", "or", "order"]) chain[name] = record(name);
  chain.limit = (n: number) => {
    query.limit = n;
    return chain;
  };
  chain.maybeSingle = () => {
    query.single = true;
    return chain;
  };
  chain.single = () => {
    query.single = true;
    return chain;
  };
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
    state.queries.push(query);
    return Promise.resolve(state.answer(query)).then(resolve, reject);
  };
  return chain;
}

const fakeAdmin = { from: (table: string) => builder(table) };

vi.mock("@/lib/supabase", () => ({
  requireSupabaseAdmin: () => fakeAdmin,
  getSupabaseAdmin: () => fakeAdmin,
  isSupabaseConfigured: () => true,
}));

import {
  INBOX_LAST_MESSAGE_WINDOW,
  INBOX_UNREAD_SCAN_CAP,
  supabaseMessagesStore,
} from "@/lib/messagesStore";
import { defined } from "@/__tests__/helpers/defined";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";

function filterValue(q: { filters: Array<[string, ...unknown[]]> }, name: string): unknown[] | undefined {
  return q.filters.find((f) => f[0] === name)?.slice(1);
}

beforeEach(() => {
  state.queries = [];
});

describe("inbox read", () => {
  it("answers a whole inbox in one conversations read plus TWO batched message reads, in parallel", async () => {
    state.answer = (q) => {
      // Two DMs and no group, so the group lane finds nothing and costs the
      // inbox one read of the members table and nothing else.
      if (q.table === "conversation_members") return { data: [], error: null };
      if (q.table === "conversations") {
        return {
          data: [
            { id: C1, handle_a: "ken", handle_b: "sam", last_message_at: "2026-09-05T10:00:00Z" },
            { id: C2, handle_a: "jen", handle_b: "ken", last_message_at: "2026-09-05T09:00:00Z" },
          ],
          error: null,
        };
      }
      if (q.table === "messages" && q.filters.some((f) => f[0] === "is")) {
        return { data: [{ conversation_id: C1 }, { conversation_id: C1 }], error: null };
      }
      return {
        data: [
          { conversation_id: C1, sender_handle: "sam", body: "latest in c1", attachment_kind: null },
          { conversation_id: C1, sender_handle: "ken", body: "older in c1", attachment_kind: null },
          { conversation_id: C2, sender_handle: "ken", body: "latest in c2", attachment_kind: "photo" },
        ],
        error: null,
      };
    };

    const { conversations: inbox, status } = await supabaseMessagesStore.listConversations("ken");
    expect(status).toBe("ready");

    const messageReads = state.queries.filter((q) => q.table === "messages");
    expect(state.queries.filter((q) => q.table === "conversations")).toHaveLength(1);
    expect(messageReads).toHaveLength(2);
    for (const read of messageReads) {
      expect(read.op).toBe("select");
      expect(filterValue(read, "in")).toEqual(["conversation_id", [C1, C2]]);
    }
    const recent = messageReads.find((q) => !q.filters.some((f) => f[0] === "is"));
    expect(recent?.limit).toBe(2 * INBOX_LAST_MESSAGE_WINDOW);

    expect(inbox).toEqual([
      { id: C1, otherHandle: "sam", lastBody: "latest in c1", lastAt: "2026-09-05T10:00:00Z", lastFromMe: false, unread: 2 },
      { id: C2, otherHandle: "jen", lastBody: "latest in c2", lastAt: "2026-09-05T09:00:00Z", lastFromMe: true, unread: 0 },
    ]);
  });

  it("asks for a conversation's last message on its own only when the recent window filled up without it", async () => {
    const busyRows = Array.from({ length: 2 * INBOX_LAST_MESSAGE_WINDOW }, (_, i) => ({
      conversation_id: C1,
      sender_handle: "sam",
      body: `busy ${i}`,
      attachment_kind: null,
    }));
    state.answer = (q) => {
      if (q.table === "conversations") {
        return {
          data: [
            { id: C1, handle_a: "ken", handle_b: "sam", last_message_at: "2026-09-05T10:00:00Z" },
            { id: C2, handle_a: "jen", handle_b: "ken", last_message_at: "2026-09-05T09:00:00Z" },
          ],
          error: null,
        };
      }
      if (q.filters.some((f) => f[0] === "is")) return { data: [], error: null };
      if (q.single) {
        return { data: { conversation_id: C2, sender_handle: "jen", body: "quiet one", attachment_kind: null }, error: null };
      }
      return { data: busyRows, error: null };
    };

    const { conversations: inbox } = await supabaseMessagesStore.listConversations("ken");
    const singles = state.queries.filter((q) => q.single);
    expect(singles).toHaveLength(1);
    expect(filterValue(defined(singles[0]), "eq")).toEqual(["conversation_id", C2]);
    expect(inbox[1]).toMatchObject({ id: C2, lastBody: "quiet one", lastFromMe: false });
  });

  it("asks nothing more for an empty inbox", async () => {
    state.answer = () => ({ data: [], error: null });
    await expect(supabaseMessagesStore.listConversations("ken")).resolves.toEqual({
      conversations: [],
      status: "ready",
    });
    // TWO reads, and no more: a conversation's kind names its membership
    // authority, so the pair columns find every DM and the members table finds
    // every group. Neither decorates anything until there is a row to decorate.
    expect(state.queries).toHaveLength(2);
    expect(state.queries.map((q) => q.table).sort()).toEqual([
      "conversation_members",
      "conversations",
    ]);
  });
});

describe("thread read", () => {
  const pairAnswer = { handle_a: "ken", handle_b: "sam" };

  it("asks for the pair and the rows together, and WRITES nothing", async () => {
    state.answer = (q) => {
      if (q.table === "conversations") return { data: pairAnswer, error: null };
      return {
        data: [
          { id: "m2", conversation_id: C1, sender_handle: "sam", body: "two", created_at: "2026-09-05T10:00:01Z", read_at: null, flagged_at: null },
          { id: "m1", conversation_id: C1, sender_handle: "ken", body: "one", created_at: "2026-09-05T10:00:00Z", read_at: "2026-09-05T10:00:02Z", flagged_at: null },
        ],
        error: null,
      };
    };

    const thread = await supabaseMessagesStore.listMessages(C1, "ken");

    expect(state.queries.map((q) => `${q.table}:${q.op}`)).toEqual([
      "conversations:select",
      "messages:select",
    ]);
    expect(thread?.map((m) => m.body)).toEqual(["one", "two"]);
  });

  it("still answers null to a non-participant, whatever the rows read said", async () => {
    state.answer = (q) =>
      q.table === "conversations"
        ? { data: pairAnswer, error: null }
        : { data: [{ id: "m1", conversation_id: C1, sender_handle: "ken", body: "secret", created_at: "x" }], error: null };
    await expect(supabaseMessagesStore.listMessages(C1, "mallory")).resolves.toBeNull();
  });

  it("markRead updates only the viewer's received unread rows, behind the participant check, and counts them", async () => {
    state.answer = (q) => {
      if (q.table === "conversations") return { data: pairAnswer, error: null };
      return { data: [{ id: "m2" }, { id: "m3" }], error: null };
    };
    await expect(supabaseMessagesStore.markRead(C1, "ken")).resolves.toBe(2);
    const update = state.queries.find((q) => q.op === "update");
    expect(update?.table).toBe("messages");
    expect(filterValue(update!, "eq")).toEqual(["conversation_id", C1]);
    expect(filterValue(update!, "neq")).toEqual(["sender_handle", "ken"]);
    expect(filterValue(update!, "is")).toEqual(["read_at", null]);

    state.queries = [];
    await expect(supabaseMessagesStore.markRead(C1, "mallory")).resolves.toBe(0);
    expect(state.queries.some((q) => q.op === "update")).toBe(false);
  });

  it("membership answers the pair, and null for an unknown conversation", async () => {
    state.answer = () => ({ data: pairAnswer, error: null });
    await expect(supabaseMessagesStore.membership(C1)).resolves.toEqual({
      kind: "direct",
      handles: ["ken", "sam"],
      title: null,
    });
    state.answer = () => ({ data: null, error: null });
    await expect(supabaseMessagesStore.membership(C1)).resolves.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-9 / F-10 / fix task 23 - a failed read may never read as absence, and a
// truncated scan may never read as a confident zero.
// ─────────────────────────────────────────────────────────────────────────────
/** What a per-conversation HEAD re-ask answers, so the assertions can name it. */
const RE_ASKED_COUNT = 1_234;

describe("inbox read is honest about what it could not do", () => {
  const conversationRows = {
    data: [
      { id: C1, handle_a: "ken", handle_b: "sam", last_message_at: "2026-09-05T10:00:00Z" },
      { id: C2, handle_a: "jen", handle_b: "ken", last_message_at: "2026-09-05T09:00:00Z" },
    ],
    error: null,
  };

  it("orders the unread scan, so its cap is a WINDOW rather than a silent filter", async () => {
    state.answer = (q) => (q.table === "conversations" ? conversationRows : { data: [], error: null });
    await supabaseMessagesStore.listConversations("ken");

    const unreadScan = state.queries.find(
      (q) => q.table === "messages" && q.filters.some((f) => f[0] === "is"),
    );
    expect(filterValue(unreadScan!, "order")).toEqual(["conversation_id", { ascending: true }]);
    expect(unreadScan?.limit).toBe(INBOX_UNREAD_SCAN_CAP);
  });

  it("re-asks per conversation for every count the filled scan could have cut short", async () => {
    // The whole budget spent on C1, so C1's own count may be incomplete and C2
    // was never reached at all. Both are re-asked; neither is reported as 0.
    const truncated = Array.from({ length: INBOX_UNREAD_SCAN_CAP }, () => ({
      conversation_id: C1,
    }));
    state.answer = (q) => {
      if (q.table === "conversations") return conversationRows;
      const isUnreadLane = q.filters.some((f) => f[0] === "is");
      if (!isUnreadLane) {
        return {
          data: [{ conversation_id: C1, sender_handle: "sam", body: "hi", attachment_kind: null }],
          error: null,
        };
      }
      // A HEAD count carries no rows, only a count.
      const asksOneConversation = q.filters.some(
        (f) => f[0] === "eq" && f[1] === "conversation_id",
      );
      if (asksOneConversation) {
        return { data: null, error: null, count: RE_ASKED_COUNT } as never;
      }
      return { data: truncated, error: null };
    };

    const { conversations, status } = await supabaseMessagesStore.listConversations("ken");

    const reAsks = state.queries.filter(
      (q) =>
        q.table === "messages" &&
        q.filters.some((f) => f[0] === "is") &&
        q.filters.some((f) => f[0] === "eq" && f[1] === "conversation_id"),
    );
    expect(reAsks.map((q) => filterValue(q, "eq")?.[1])).toEqual([C1, C2]);
    expect(status).toBe("ready");
    expect(conversations.find((c) => c.id === C1)?.unread).toBe(RE_ASKED_COUNT);
    expect(conversations.find((c) => c.id === C2)?.unread).toBe(RE_ASKED_COUNT);
  });

  it("keeps the conversations when the unread scan fails, and SAYS the read is degraded", async () => {
    state.answer = (q) => {
      if (q.table === "conversations") return conversationRows;
      if (q.filters.some((f) => f[0] === "is")) {
        return { data: null, error: { message: "canceling statement due to statement timeout" } };
      }
      return {
        data: [{ conversation_id: C1, sender_handle: "sam", body: "still here", attachment_kind: null }],
        error: null,
      };
    };

    const { conversations, status } = await supabaseMessagesStore.listConversations("ken");

    expect(status).toBe("degraded");
    expect(conversations.map((c) => c.id)).toEqual([C1, C2]);
    expect(defined(conversations[0]).lastBody).toBe("still here");
    // UNCOUNTED IS NOT ZERO: the field is absent, so no surface can print a
    // confident nothing over a message that is waiting.
    for (const conversation of conversations) {
      expect(conversation.unread).toBeUndefined();
    }
  });

  it("keeps the conversations when the recent window fails, and says so", async () => {
    state.answer = (q) => {
      if (q.table === "conversations") return conversationRows;
      if (q.filters.some((f) => f[0] === "is")) {
        return { data: [{ conversation_id: C1 }], error: null };
      }
      return { data: null, error: { message: "connection reset" } };
    };

    const { conversations, status } = await supabaseMessagesStore.listConversations("ken");

    expect(status).toBe("degraded");
    expect(conversations.map((c) => c.id)).toEqual([C1, C2]);
    expect(defined(conversations[0]).lastBody).toBeUndefined();
    expect(defined(conversations[0]).unread).toBe(1);
  });

  it("only the CONVERSATIONS read may empty the inbox, and even then it says degraded", async () => {
    state.answer = (q) =>
      q.table === "conversations"
        ? { data: null, error: { message: "statement timeout" } }
        : { data: [], error: null };

    await expect(supabaseMessagesStore.listConversations("ken")).resolves.toEqual({
      conversations: [],
      status: "degraded",
    });
  });
});
