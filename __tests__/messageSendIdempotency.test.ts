// ONE SEND IS ONE MESSAGE (F-25 / fix task 13).
//
// The send path had no idempotency key at all. A connection reset AFTER the row
// committed answered the browser as a failure, the optimistic bubble was taken
// back, the text went into the field, and the drinker sent it again - so the
// conversation held the same line twice and nothing could tell the two apart.
// The browser now mints one uuid per attempt and sends it on every retry of
// that attempt; migration 0149's unique index turns the second arrival into a
// conflict this store answers with the row it already wrote.
//
// The durable half is fenced on a fake PostgREST client, in the shape
// __tests__/messagesInboxRead.test.ts uses, so the exact write and the exact
// recovery read are both visible. The memory half is fenced against the real
// in-process store, because a keyless dev server must behave the same way.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Recorded = {
  table: string;
  op: "select" | "update" | "insert" | "upsert";
  filters: Array<[string, ...unknown[]]>;
  payload?: Record<string, unknown>;
};

const state = vi.hoisted(() => ({
  queries: [] as Array<{
    table: string;
    op: string;
    filters: Array<[string, ...unknown[]]>;
    payload?: Record<string, unknown>;
  }>,
  answer: (() => ({ data: null, error: null })) as (q: {
    table: string;
    op: string;
    filters: Array<[string, ...unknown[]]>;
    payload?: Record<string, unknown>;
  }) => { data: unknown; error: { code?: string; message: string } | null },
}));

function builder(table: string) {
  const query: Recorded = { table, op: "select", filters: [] };
  const chain: Record<string, unknown> = {};
  const record = (name: string) => (...args: unknown[]) => {
    query.filters.push([name, ...args]);
    return chain;
  };
  chain.select = (...args: unknown[]) => {
    query.filters.push([query.op === "select" ? "select" : "returning", ...args]);
    return chain;
  };
  chain.insert = (...args: unknown[]) => {
    query.op = "insert";
    query.payload = args[0] as Record<string, unknown>;
    return chain;
  };
  chain.update = (...args: unknown[]) => {
    query.op = "update";
    query.payload = args[0] as Record<string, unknown>;
    return chain;
  };
  chain.upsert = (...args: unknown[]) => {
    query.op = "upsert";
    query.payload = args[0] as Record<string, unknown>;
    return chain;
  };
  for (const name of ["eq", "neq", "is", "in", "or", "order"]) chain[name] = record(name);
  chain.limit = () => chain;
  chain.maybeSingle = () => chain;
  chain.single = () => chain;
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
  memoryMessagesStore,
  readClientMessageId,
  supabaseMessagesStore,
} from "@/lib/messagesStore";
import { defined } from "@/__tests__/helpers/defined";

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PAIR = { handle_a: "ken", handle_b: "sam" };

function storedRow(id: string, body: string) {
  return {
    id,
    conversation_id: CONVERSATION,
    sender_handle: "ken",
    body,
    created_at: "2026-09-05T22:10:00Z",
    read_at: null,
    flagged_at: null,
  };
}

function insertQueries() {
  return state.queries.filter((q) => q.op === "insert" && q.table === "messages");
}

beforeEach(() => {
  state.queries = [];
});

describe("readClientMessageId", () => {
  it("takes a uuid and nothing else, so a forged key can never reach a uuid column", () => {
    expect(readClientMessageId(KEY)).toBe(KEY);
    expect(readClientMessageId(KEY.toUpperCase())).toBe(KEY);
    expect(readClientMessageId(` ${KEY} `)).toBe(KEY);
    expect(readClientMessageId("outbox-3")).toBeNull();
    expect(readClientMessageId("")).toBeNull();
    expect(readClientMessageId(undefined)).toBeNull();
    expect(readClientMessageId(42)).toBeNull();
  });
});

describe("durable send with an idempotency key", () => {
  it("writes the key with the row when the sender gives one", async () => {
    state.answer = (q) =>
      q.table === "conversations" && q.op === "select"
        ? { data: PAIR, error: null }
        : { data: storedRow("m1", "first"), error: null };

    const sent = await supabaseMessagesStore.send(CONVERSATION, "ken", "first", undefined, {
      clientMessageId: KEY,
    });

    expect(sent?.message.body).toBe("first");
    expect(defined(insertQueries()[0]).payload?.client_message_id).toBe(KEY);
  });

  it("hands back the pair the write already proved, so no caller re-reads it", async () => {
    state.answer = (q) =>
      q.table === "conversations" && q.op === "select"
        ? { data: PAIR, error: null }
        : { data: storedRow("m1", "first"), error: null };

    const sent = await supabaseMessagesStore.send(CONVERSATION, "ken", "first");

    expect(sent?.membership).toEqual({
      kind: "direct",
      handles: ["ken", "sam"],
      title: null,
    });
    // ONE conversations read for the whole send: the participant check's.
    expect(state.queries.filter((q) => q.table === "conversations" && q.op === "select")).toHaveLength(1);
  });

  it("answers a REPEATED attempt with the row it already wrote, never a second copy", async () => {
    let insertsSeen = 0;
    state.answer = (q) => {
      if (q.table === "conversations" && q.op === "select") return { data: PAIR, error: null };
      if (q.op === "insert") {
        insertsSeen += 1;
        return {
          data: null,
          error: { code: "23505", message: 'duplicate key value violates unique constraint "messages_conversation_client_message_id_idx"' },
        };
      }
      // The recovery read, keyed on the sender's own id.
      return { data: storedRow("already-stored", "the one that landed"), error: null };
    };

    const sent = await supabaseMessagesStore.send(CONVERSATION, "ken", "the one that landed", undefined, {
      clientMessageId: KEY,
    });

    expect(sent?.message.id).toBe("already-stored");
    expect(sent?.message.body).toBe("the one that landed");
    expect(insertsSeen).toBe(1);
    const recovery = state.queries.find(
      (q) =>
        q.table === "messages" &&
        q.op === "select" &&
        q.filters.some((f) => f[0] === "eq" && f[1] === "client_message_id"),
    );
    expect(recovery?.filters.find((f) => f[0] === "eq" && f[1] === "client_message_id")?.[2]).toBe(KEY);
  });

  it("still delivers the message when 0149 has not landed yet, keyless rather than lost", async () => {
    state.answer = (q) => {
      if (q.table === "conversations" && q.op === "select") return { data: PAIR, error: null };
      if (q.op === "insert") {
        const keyed = q.payload?.client_message_id !== undefined;
        return keyed
          ? {
              data: null,
              error: {
                code: "PGRST204",
                message: "Could not find the 'client_message_id' column of 'messages' in the schema cache",
              },
            }
          : { data: storedRow("m1", "delivered anyway"), error: null };
      }
      return { data: null, error: null };
    };

    const sent = await supabaseMessagesStore.send(CONVERSATION, "ken", "delivered anyway", undefined, {
      clientMessageId: KEY,
    });

    expect(sent?.message.body).toBe("delivered anyway");
    const inserts = insertQueries();
    expect(inserts).toHaveLength(2);
    expect(defined(inserts[1]).payload?.client_message_id).toBeUndefined();
  });

  it("a 23505 about some OTHER constraint is still a failure, not a silent replay", async () => {
    state.answer = (q) => {
      if (q.table === "conversations" && q.op === "select") return { data: PAIR, error: null };
      if (q.op === "insert") {
        return {
          data: null,
          error: { code: "23505", message: 'duplicate key value violates unique constraint "messages_pkey"' },
        };
      }
      return { data: null, error: null };
    };

    await expect(
      supabaseMessagesStore.send(CONVERSATION, "ken", "boom", undefined, { clientMessageId: KEY }),
    ).resolves.toBeNull();
  });

  it("sends no key at all when the caller gives none, so nothing changes for a legacy lane", async () => {
    state.answer = (q) =>
      q.table === "conversations" && q.op === "select"
        ? { data: PAIR, error: null }
        : { data: storedRow("m1", "plain"), error: null };

    await supabaseMessagesStore.send(CONVERSATION, "ken", "plain");

    expect("client_message_id" in (defined(insertQueries()[0]).payload ?? {})).toBe(false);
  });
});

describe("memory send with an idempotency key", () => {
  it("stores the same attempt once, however many times it arrives", async () => {
    const conversationId = (await memoryMessagesStore.openConversation("ken", "sam"))!;

    const first = await memoryMessagesStore.send(conversationId, "ken", "one round", undefined, {
      clientMessageId: KEY,
    });
    const replay = await memoryMessagesStore.send(conversationId, "ken", "one round", undefined, {
      clientMessageId: KEY,
    });

    expect(first?.message.id).toBe(replay?.message.id);
    const thread = await memoryMessagesStore.listMessages(conversationId, "ken");
    expect(thread?.filter((m) => m.body === "one round")).toHaveLength(1);
  });

  it("keys nothing when no key is sent, so two deliberate sends are two messages", async () => {
    const conversationId = (await memoryMessagesStore.openConversation("jen", "max"))!;

    await memoryMessagesStore.send(conversationId, "jen", "same words");
    await memoryMessagesStore.send(conversationId, "jen", "same words");

    const thread = await memoryMessagesStore.listMessages(conversationId, "jen");
    expect(thread?.filter((m) => m.body === "same words")).toHaveLength(2);
  });
});
