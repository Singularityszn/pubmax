// The cheap-pint and Step Out crons claim a row before they send. Vercel can deliver
// a cron event twice and two runs can list the same ready rows, so the claim, not
// the list, decides who sends. A failed write after a send can no longer cause a
// second push, because nothing is written after the send.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  supabase: false,
  rows: new Map<string, Record<string, unknown>>(),
  failClaim: false,
}));

vi.mock("@/lib/supabase", async (original) => ({
  ...(await original<typeof import("@/lib/supabase")>()),
  isSupabaseConfigured: () => state.supabase,
  requiresSupabaseStore: () => state.supabase,
  requireSupabaseAdmin: () => ({ from: (table: string) => fakeQuery(table) }),
}));

const sends = vi.hoisted(() => ({ tokens: [] as string[], outcome: "sent" as string }));

vi.mock("@/lib/pushSender", () => {
  const send = async (token: string) => {
    // Hold the send open so overlapping runs interleave as they do on Vercel.
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (sends.outcome === "throw") throw new Error("push provider down");
    sends.tokens.push(token);
    const sent = sends.outcome === "sent" ? 1 : 0;
    return { targeted: 1, sent, skipped: 0, pruned: 0, errors: 1 - sent, results: [] };
  };
  return { sendCheapPintPing: vi.fn(send), sendStepOutNudge: vi.fn(send) };
});

vi.mock("@/lib/cheapPintPingSelect.server", () => ({
  accountIdForOwnerActor: async () => "account-1",
  selectCheapPintPing: async () => ({
    title: "Cheap pint nearby",
    body: "£4.50 at Example, about 5 min walk nearby.",
    url: "/map?sel=venue-1",
    venueId: "venue-1",
    priceLabel: "£4.50",
  }),
}));

vi.mock("@/lib/stepOutNudgeSelect.server", () => ({
  accountIdForOwnerActor: async () => "account-1",
  selectOwedStepOutNudge: async () => ({
    kind: "soft_plan_open",
    title: "Weekly nudge",
    body: "Your plan for tonight is still open.",
    url: "/tonight",
  }),
}));

import {
  defaultCheapPintPingDispatchDeps,
  dispatchCheapPintPings,
} from "@/lib/cheapPintPingDispatch.server";
import {
  defaultStepOutNudgeDispatchDeps,
  dispatchStepOutNudges,
} from "@/lib/stepOutNudgeDispatch.server";
import {
  __resetStepOutNudgeStore,
  memoryStepOutNudgeStore,
  stepOutNudgeStore,
} from "@/lib/stepOutNudgeStore";

// A PostgREST stand-in for step_out_nudge_prefs. Each statement checks its filters
// and writes in one step, as a database does, after a network-sized pause.
function matchesOr(row: Row, expr: string): boolean {
  const parts = expr.match(/(?:[^,"]|"[^"]*")+/g) ?? [];
  return parts.some((part) => {
    const [column, op, ...rest] = part.split(".");
    const raw = rest.join(".").replace(/^"|"$/g, "");
    const value = row[column!];
    if (op === "is" && raw === "null") return value === null;
    if (op === "lte") return value !== null && Date.parse(String(value)) <= Date.parse(raw);
    if (op === "lt") return value !== null && Date.parse(String(value)) < Date.parse(raw);
    throw new Error(`fake does not know or-filter ${part}`);
  });
}

function fakeQuery(table: string) {
  expect(table).toBe("step_out_nudge_prefs");
  let patch: Row | null = null;
  let selected = false;
  const filters: Array<(row: Row) => boolean> = [];
  const query = {
    select: () => { selected = true; return query; },
    update: (next: Row) => { patch = next; return query; },
    eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return query; },
    is: (column: string, value: null) => { filters.push((row) => row[column] === value); return query; },
    not: (column: string, op: string, value: null) => {
      expect(op).toBe("is");
      filters.push((row) => row[column] !== value);
      return query;
    },
    or: (expr: string) => { filters.push((row) => matchesOr(row, expr)); return query; },
    then: async (resolve: (value: unknown) => unknown) => {
      await new Promise((r) => setTimeout(r, 1));
      if (patch && state.failClaim) {
        return resolve({ data: null, error: { message: "connection reset" } });
      }
      const matched = [...state.rows.values()].filter((row) => filters.every((f) => f(row)));
      if (patch) for (const row of matched) Object.assign(row, patch);
      return resolve({ data: selected ? matched.map((row) => ({ ...row })) : null, error: null });
    },
  };
  return query;
}

const WED_5PM = new Date("2026-08-19T16:00:00.000Z");
const THU_5PM = new Date("2026-08-20T16:00:00.000Z");
const USERS = [
  { actor: "profile:11111111-1111-4111-8111-111111111111", token: "webpush:one" },
  { actor: "profile:22222222-2222-4222-8222-222222222222", token: "webpush:two" },
];

function dbRow(actor: string, token: string, fields: Row): Row {
  return {
    owner_actor: actor,
    enabled: false,
    subscription_token: token,
    last_sent_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    cheap_pint_qualified: false,
    cheap_pint_enabled: false,
    cheap_pint_declined: false,
    cheap_pint_sent_at: null,
    ...fields,
  };
}

async function seedCheapPint(backend: "memory" | "supabase") {
  for (const { actor, token } of USERS) {
    if (backend === "memory") {
      await memoryStepOutNudgeStore.qualifyCheapPint(actor);
      await memoryStepOutNudgeStore.optInCheapPint(actor, token);
    } else {
      state.rows.set(actor, dbRow(actor, token, { cheap_pint_qualified: true, cheap_pint_enabled: true }));
    }
  }
}

async function seedStepOut(backend: "memory" | "supabase") {
  for (const { actor, token } of USERS) {
    if (backend === "memory") {
      await memoryStepOutNudgeStore.put(actor, { enabled: true, subscriptionToken: token });
    } else {
      state.rows.set(actor, dbRow(actor, token, { enabled: true }));
    }
  }
}

function sendsPerToken(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const token of sends.tokens) counts[token] = (counts[token] ?? 0) + 1;
  return counts;
}

const ONCE_EACH = { "webpush:one": 1, "webpush:two": 1 };

beforeEach(() => {
  __resetStepOutNudgeStore();
  state.supabase = false;
  state.rows.clear();
  state.failClaim = false;
  sends.tokens = [];
  sends.outcome = "sent";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(["memory", "supabase"] as const)("claim before send (%s store)", (backend) => {
  beforeEach(() => {
    state.supabase = backend === "supabase";
  });

  it("two overlapping cheap-pint runs send exactly once per user", async () => {
    await seedCheapPint(backend);
    const [a, b] = await Promise.all([
      dispatchCheapPintPings(WED_5PM),
      dispatchCheapPintPings(WED_5PM),
    ]);
    expect(sendsPerToken()).toEqual(ONCE_EACH);
    expect(a.sent + b.sent).toBe(2);
    expect(a.skippedNotReady + b.skippedNotReady).toBe(2);
  });

  it("two overlapping Step Out runs send exactly once per user", async () => {
    await seedStepOut(backend);
    const [a, b] = await Promise.all([
      dispatchStepOutNudges(WED_5PM),
      dispatchStepOutNudges(WED_5PM),
    ]);
    expect(sendsPerToken()).toEqual(ONCE_EACH);
    expect(a.sent + b.sent).toBe(2);
    expect(a.skippedFrequency + b.skippedFrequency).toBe(2);
  });

  it("skips a cheap-pint row another run claimed after the list was read", async () => {
    await seedCheapPint(backend);
    const stale = await stepOutNudgeStore().listCheapPintSendReady();
    for (const { actor } of USERS) {
      expect(await stepOutNudgeStore().claimCheapPintSend(actor, WED_5PM.toISOString())).toBe(true);
    }
    const summary = await dispatchCheapPintPings(WED_5PM, {
      ...defaultCheapPintPingDispatchDeps(),
      listSendReady: async () => stale,
    });
    expect(sends.tokens).toEqual([]);
    expect(summary.skippedNotReady).toBe(2);
  });

  it("skips a Step Out row another run claimed after the list was read", async () => {
    await seedStepOut(backend);
    const stale = await stepOutNudgeStore().listEnabled();
    const resendBefore = new Date(WED_5PM.getTime() - 7 * 86_400_000).toISOString();
    for (const { actor } of USERS) {
      expect(
        await stepOutNudgeStore().claimSend(actor, WED_5PM.toISOString(), resendBefore),
      ).toBe(true);
    }
    const summary = await dispatchStepOutNudges(WED_5PM, {
      ...defaultStepOutNudgeDispatchDeps(),
      listEnabled: async () => stale,
    });
    expect(sends.tokens).toEqual([]);
    expect(summary.skippedFrequency).toBe(2);
  });

  it("Step Out sends again only once the week has passed", async () => {
    await seedStepOut(backend);
    await dispatchStepOutNudges(WED_5PM);
    await dispatchStepOutNudges(new Date(WED_5PM.getTime() + 6 * 86_400_000));
    expect(sendsPerToken()).toEqual(ONCE_EACH);
    await dispatchStepOutNudges(new Date(WED_5PM.getTime() + 7 * 86_400_000));
    expect(sendsPerToken()).toEqual({ "webpush:one": 2, "webpush:two": 2 });
  });

  it("a failing claim sends nothing", async () => {
    await seedCheapPint(backend);
    const claim = vi.fn(async () => {
      throw new Error("connection reset");
    });
    const summary = await dispatchCheapPintPings(WED_5PM, {
      ...defaultCheapPintPingDispatchDeps(),
      claim,
    });
    expect(claim).toHaveBeenCalledTimes(2);
    expect(sends.tokens).toEqual([]);
    expect(summary.errors).toBe(2);
  });
});

describe("a failed write cannot cause a second send", () => {
  it("the lifetime cheap-pint ping stays sent when the after-send stamp write fails", async () => {
    await seedCheapPint("memory");
    // The old order wrote this stamp after the send; a failure here meant a resend.
    vi.spyOn(memoryStepOutNudgeStore, "markCheapPintSent").mockRejectedValue(new Error("write failed"));
    await dispatchCheapPintPings(WED_5PM);
    await dispatchCheapPintPings(THU_5PM);
    expect(sendsPerToken()).toEqual(ONCE_EACH);
  });

  it("the weekly Step Out nudge stays sent when the after-send stamp write fails", async () => {
    await seedStepOut("memory");
    vi.spyOn(memoryStepOutNudgeStore, "markSent").mockRejectedValue(new Error("write failed"));
    await dispatchStepOutNudges(WED_5PM);
    await dispatchStepOutNudges(new Date(WED_5PM.getTime() + 3_600_000));
    expect(sendsPerToken()).toEqual(ONCE_EACH);
  });

  it("a durable claim error sends nothing and leaves the row for the next run", async () => {
    state.supabase = true;
    await seedCheapPint("supabase");
    state.failClaim = true;
    const first = await dispatchCheapPintPings(WED_5PM);
    expect(sends.tokens).toEqual([]);
    expect(first.errors).toBe(2);
    state.failClaim = false;
    await dispatchCheapPintPings(THU_5PM);
    expect(sendsPerToken()).toEqual(ONCE_EACH);
  });

  it("a send that throws keeps the claim, so the next run does not resend", async () => {
    await seedCheapPint("memory");
    sends.outcome = "throw";
    const first = await dispatchCheapPintPings(WED_5PM);
    expect(first.errors).toBe(2);
    sends.outcome = "sent";
    await dispatchCheapPintPings(THU_5PM);
    expect(sends.tokens).toEqual([]);
  });

  it("a send that delivered nothing releases the claim, so the next run retries", async () => {
    await seedCheapPint("memory");
    sends.outcome = "undelivered";
    await dispatchCheapPintPings(WED_5PM);
    expect((await memoryStepOutNudgeStore.get(USERS[0]!.actor))?.cheapPintSentAt).toBeNull();
    sends.outcome = "sent";
    sends.tokens = [];
    await dispatchCheapPintPings(THU_5PM);
    expect(sendsPerToken()).toEqual(ONCE_EACH);
  });

  it("an undelivered Step Out send puts the prior stamp back", async () => {
    await seedStepOut("memory");
    const prior = "2026-08-01T12:00:00.000Z";
    for (const { actor } of USERS) await memoryStepOutNudgeStore.markSent(actor, prior);
    sends.outcome = "undelivered";
    await dispatchStepOutNudges(WED_5PM);
    expect((await memoryStepOutNudgeStore.get(USERS[0]!.actor))?.lastSentAt).toBe(prior);
  });

  it("a failed release keeps the claim: a missed ping, never a second one", async () => {
    await seedCheapPint("memory");
    sends.outcome = "undelivered";
    const summary = await dispatchCheapPintPings(WED_5PM, {
      ...defaultCheapPintPingDispatchDeps(),
      release: async () => {
        throw new Error("write failed");
      },
    });
    expect(summary.errors).toBe(4);
    sends.outcome = "sent";
    sends.tokens = [];
    await dispatchCheapPintPings(THU_5PM);
    expect(sends.tokens).toEqual([]);
  });
});
