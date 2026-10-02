import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  readPubPalToolInvocationTurn,
  registerPubPalToolTurn,
  touchPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

const CONVERSATION_ID = "conv_storetest01";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER_ID = "22222222-2222-4222-8222-222222222222";

type DurableTestRow = {
  conversation_id: string;
  owner_id: string | null;
  payload: Record<string, unknown>;
  expires_at: string;
  created_at: string;
};

type DurableFilter = {
  column: string;
  operator: "eq" | "gt" | "lt" | "is";
  value: string | number | null;
};

type DurableStatement = {
  action: "select" | "delete" | "insert" | "update" | "upsert";
  body: Partial<DurableTestRow> | null;
  filters: DurableFilter[];
};

type DurableResult = {
  data: Partial<DurableTestRow> | Partial<DurableTestRow>[] | null;
  error: { code?: string; message: string } | null;
};

const durable = vi.hoisted(() => ({
  configured: false,
  deletes: [] as Array<{ table: string; column: string; value: string }>,
  rows: new Map<string, DurableTestRow>(),
  statements: [] as DurableStatement[],
  beforeWrite: null as ((statement: DurableStatement) => Promise<void>) | null,
  writeError: null as DurableResult["error"],
  zeroWriteRows: false,
}));

// Transport double only. Predicates are evaluated when a held statement commits;
// this models the store's request contract, not PostgreSQL/PostgREST execution.
class DurableQuery implements PromiseLike<DurableResult> {
  private action: DurableStatement["action"] = "select";
  private body: DurableStatement["body"] = null;
  private filters: DurableFilter[] = [];
  private returning = false;
  private columns: Array<keyof DurableTestRow> | null = null;
  private singular = false;
  private execution: Promise<DurableResult> | undefined;

  select(columns = "*") {
    this.returning = true;
    this.columns = columns === "*" ? null : columns.split(",").map((column) => column.trim() as keyof DurableTestRow);
    return this;
  }
  delete() { this.action = "delete"; return this; }
  insert(row: Omit<DurableTestRow, "created_at"> & { created_at?: string }) { this.action = "insert"; this.body = structuredClone(row); return this; }
  update(row: Partial<DurableTestRow>) { this.action = "update"; this.body = structuredClone(row); return this; }
  upsert(row: Omit<DurableTestRow, "created_at"> & { created_at?: string }) { this.action = "upsert"; this.body = structuredClone(row); return this; }
  eq(column: string, value: string | number) { this.filters.push({ column, operator: "eq", value }); return this; }
  gt(column: string, value: string) { this.filters.push({ column, operator: "gt", value }); return this; }
  lt(column: string, value: string) { this.filters.push({ column, operator: "lt", value }); return this; }
  is(column: string, value: null) { this.filters.push({ column, operator: "is", value }); return this; }
  maybeSingle() { this.singular = true; return this.execute(); }
  single() { this.singular = true; return this.execute(); }

  then<T = DurableResult, E = never>(
    fulfilled?: ((value: DurableResult) => T | PromiseLike<T>) | null,
    rejected?: ((reason: unknown) => E | PromiseLike<E>) | null,
  ): Promise<T | E> {
    return this.execute().then(fulfilled, rejected);
  }

  private matches(row: DurableTestRow): boolean {
    return this.filters.every(({ column, operator, value }) => {
      const jsonPath = /^(\w+)->(>?)(\w+)$/.exec(column);
      let actual: unknown = row[column as keyof DurableTestRow];
      if (jsonPath) {
        const payload = row[jsonPath[1] as keyof DurableTestRow] as Record<string, unknown>;
        const entry = payload[jsonPath[3]];
        // ->> returns SQL null for missing/JSON null; -> distinguishes JSON null.
        actual = jsonPath[2] === ">"
          ? entry == null ? null : String(entry)
          : entry === undefined ? null : entry === null ? "JSON_NULL" : entry;
      }
      if (operator === "is") return actual === null;
      if (operator === "eq") return actual === value;
      if (typeof actual !== "string" || typeof value !== "string") return false;
      return operator === "gt" ? actual > value : actual < value;
    });
  }

  private execute(): Promise<DurableResult> {
    this.execution ??= this.commit();
    return this.execution;
  }

  private async commit(): Promise<DurableResult> {
    const statement = structuredClone({ action: this.action, body: this.body, filters: this.filters });
    durable.statements.push(statement);
    const writes = this.action === "insert" || this.action === "update" || this.action === "upsert";
    if (writes) {
      await durable.beforeWrite?.(statement);
      if (durable.writeError) return { data: null, error: durable.writeError };
      if (durable.zeroWriteRows) return { data: null, error: null };
    }
    const matching = [...durable.rows.values()].filter((row) => this.matches(row));
    let affected: DurableTestRow[] = [];
    if (this.action === "select") affected = matching;
    if (this.action === "delete") {
      const cutoff = this.filters.find((filter) => filter.column === "expires_at" && filter.operator === "lt");
      if (cutoff) durable.deletes.push({ table: "pub_pal_tool_turns", column: cutoff.column, value: String(cutoff.value) });
      for (const row of matching) durable.rows.delete(row.conversation_id);
    }
    if (this.action === "update") {
      affected = matching.map((row) => ({ ...row, ...structuredClone(this.body) }));
      for (const row of affected) durable.rows.set(row.conversation_id, row);
    }
    if (this.action === "insert" || this.action === "upsert") {
      const input = structuredClone(this.body) as Omit<DurableTestRow, "created_at"> & { created_at?: string };
      const existing = durable.rows.get(input.conversation_id);
      if (this.action === "insert" && existing) {
        return { data: null, error: { code: "23505", message: "duplicate conversation_id" } };
      }
      // 0160 supplies created_at on INSERT. An UPDATE without it keeps the birth.
      const row = {
        ...input,
        created_at: input.created_at ?? existing?.created_at ?? new Date().toISOString(),
      };
      durable.rows.set(row.conversation_id, row);
      affected = [row];
    }
    const columns = this.columns;
    const projected = columns ? affected.map((row) => Object.fromEntries(columns.map((column) => {
      if (!Object.hasOwn(row, column)) throw new Error(`Unsupported durable projection: ${column}`);
      return [column, row[column]];
    })) as Partial<DurableTestRow>) : affected;
    const data = !this.returning ? null : this.singular ? projected[0] ?? null : projected;
    return { data: structuredClone(data), error: null };
  }
}

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => durable.configured,
    requiresSupabaseStore: () => false,
    requireSupabaseAdmin: () => ({
      from: (table: string) => {
        if (table !== "pub_pal_tool_turns") throw new Error(`Unexpected durable table: ${table}`);
        return new DurableQuery();
      },
    }),
  };
});

async function receiptOrigin() {
  const invocation = await readPubPalToolInvocationTurn(CONVERSATION_ID);
  if (!invocation) throw new Error("Receipt requires its live owned context before computation.");
  return invocation.origin;
}

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

    const origin = await receiptOrigin();
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
    }, origin);

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

  it("keeps a pending receipt through a live same-owner register without exposing its origin", async () => {
    vi.useFakeTimers();
    const started = Date.parse("2026-10-02T12:00:00.000Z");
    vi.setSystemTime(started);
    await registerPubPalToolTurn(CONVERSATION_ID, {
      query: "Quiet pubs in Soho.", cityId: "london", ownerId: OWNER_ID,
    });
    const origin = await receiptOrigin();
    vi.setSystemTime(started + 10_000);
    await registerPubPalToolTurn(CONVERSATION_ID, {
      query: "Food in Clapham.", cityId: "london", ownerId: OWNER_ID,
      turns: [{ role: "user", content: "Food in Clapham." }],
    });
    await appendPubPalToolTurn(CONVERSATION_ID, {
      hints: ["Sourced result."], toolsUsed: ["search_venues"],
    }, origin);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toEqual({
      query: "Food in Clapham.", cityId: "london",
      turns: [{ role: "user", content: "Food in Clapham." }],
      expiresAt: started + 10_000 + PUB_PAL_TOOL_TURN_TTL_MS,
      cards: [], proposals: [], hints: ["Sourced result."], toolsUsed: ["search_venues"],
    });
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

function holdWrites(count: number) {
  let ready!: () => void;
  const allPending = new Promise<void>((resolve) => { ready = resolve; });
  const pending: Array<{ statement: DurableStatement; resume: () => void }> = [];
  let observed = 0;
  durable.beforeWrite = async (statement) => {
    if (observed++ >= count) return;
    await new Promise<void>((resume) => {
      pending.push({ statement, resume });
      if (pending.length === count) ready();
    });
  };
  return {
    allPending,
    resumeWhere: (matches: (statement: DurableStatement) => boolean) => {
      const held = pending.find(({ statement }) => matches(statement));
      if (!held) throw new Error("Expected write was not held at the durable boundary");
      held.resume();
    },
  };
}

describe("Pub Pal durable mutation interleavings (transport double)", () => {
  const STARTED = Date.parse("2026-10-02T12:00:00.000Z");
  const FIRST_QUERY = "Quiet pubs in Clapham.";
  const NEXT_QUERY = "Under six pounds in Soho.";

  beforeEach(() => {
    durable.configured = true;
    durable.rows.clear();
    durable.deletes = [];
    durable.statements = [];
    durable.beforeWrite = null;
    durable.writeError = null;
    durable.zeroWriteRows = false;
    __resetPubPalToolTurnStore();
    vi.useFakeTimers();
    vi.setSystemTime(STARTED);
  });

  afterEach(() => {
    durable.configured = false;
    durable.rows.clear();
    durable.deletes = [];
    durable.statements = [];
    durable.beforeWrite = null;
    durable.writeError = null;
    durable.zeroWriteRows = false;
    __resetPubPalToolTurnStore();
    vi.useRealTimers();
  });

  function receipt(label: string, tool = "search_venues") {
    return {
      cards: [{ key: label, venueId: `venue-${label}`, title: label, place: "Soho", note: "Logged.", price: 5 }],
      proposals: [{ id: label, kind: "open_venue" as const, label, venueId: `venue-${label}` }],
      hints: [label],
      toolsUsed: [tool],
    };
  }

  function registerFirstLine() {
    return registerPubPalToolTurn(CONVERSATION_ID, {
      query: FIRST_QUERY,
      cityId: "london",
      ownerId: OWNER_ID,
      turns: [{ role: "user", content: FIRST_QUERY }],
    });
  }

  it.each(["user-first", "receipt-first"] as const)(
    "preserves a genuine new line and a sourced receipt with %s commit order",
    async (order) => {
      await registerFirstLine();
      const origin = await receiptOrigin();
      vi.setSystemTime(STARTED + 90_000);
      const held = holdWrites(2);
      const user = appendOwnedPubPalUserTurn(
        CONVERSATION_ID, OWNER_ID, { role: "user", content: NEXT_QUERY }, "london",
      );
      const result = appendPubPalToolTurn(CONVERSATION_ID, receipt("A"), origin);
      await held.allPending;
      const userWrite = (statement: DurableStatement) => statement.body?.payload?.query === NEXT_QUERY;
      const resultWrite = (statement: DurableStatement) => {
        const hints = statement.body?.payload?.hints;
        return Array.isArray(hints) && hints.includes("A");
      };
      held.resumeWhere(order === "user-first" ? userWrite : resultWrite);
      await (order === "user-first" ? user : result);
      // A conflict retry is not another user line and cannot renew retention.
      vi.setSystemTime(STARTED + 95_000);
      held.resumeWhere(order === "user-first" ? resultWrite : userWrite);
      expect(await user).toBe(true);
      await result;
      const stored = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
      expect(stored?.query).toBe(NEXT_QUERY);
      expect(stored?.turns).toEqual([
        { role: "user", content: FIRST_QUERY },
        { role: "user", content: NEXT_QUERY },
      ]);
      expect(stored?.cards).toEqual(receipt("A").cards);
      expect(stored?.proposals).toEqual(receipt("A").proposals);
      expect(stored?.hints).toEqual(["A"]);
      expect(stored?.toolsUsed).toEqual(["search_venues"]);
      expect(stored?.expiresAt).toBe(STARTED + 90_000 + PUB_PAL_TOOL_TURN_TTL_MS);
      const filters = JSON.stringify(durable.statements.map((statement) => statement.filters));
      expect(filters).not.toContain(FIRST_QUERY);
      expect(filters).not.toContain(NEXT_QUERY);
    },
  );

  it("merges two distinct tool receipts without replacing history or renewing its clock", async () => {
    await registerFirstLine();
    const origin = await receiptOrigin();
    vi.setSystemTime(STARTED + 20_000);
    const held = holdWrites(2);
    const first = appendPubPalToolTurn(CONVERSATION_ID, receipt("A"), origin);
    const second = appendPubPalToolTurn(CONVERSATION_ID, receipt("B", "venue_prices"), origin);
    await held.allPending;
    const hasHint = (hint: string) => (statement: DurableStatement) => {
      const hints = statement.body?.payload?.hints;
      return Array.isArray(hints) && hints.includes(hint);
    };
    held.resumeWhere(hasHint("B"));
    await second;
    vi.setSystemTime(STARTED + 30_000);
    held.resumeWhere(hasHint("A"));
    await first;
    const stored = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
    expect(stored?.cards.map((card) => card.key).sort()).toEqual(["A", "B"]);
    expect(stored?.proposals.map((proposal) => proposal.id).sort()).toEqual(["A", "B"]);
    expect(stored?.hints.slice().sort()).toEqual(["A", "B"]);
    expect(stored?.toolsUsed.slice().sort()).toEqual(["search_venues", "venue_prices"]);
    expect(stored?.query).toBe(FIRST_QUERY);
    expect(stored?.turns).toEqual([{ role: "user", content: FIRST_QUERY }]);
    expect(stored?.expiresAt).toBe(STARTED + PUB_PAL_TOOL_TURN_TTL_MS);
  });

  it("an insert conflict cannot replace the account that already claimed a row", async () => {
    // Defensive store case, not evidence that a provider reuses IDs across users.
    const held = holdWrites(2);
    const first = bindPubPalToolTurn(CONVERSATION_ID, OWNER_ID, "london");
    const second = bindPubPalToolTurn(CONVERSATION_ID, OTHER_OWNER_ID, "london")
      .then(() => null, (error: unknown) => error);
    await held.allPending;
    held.resumeWhere((statement) => statement.body?.owner_id === OWNER_ID);
    await first;
    held.resumeWhere((statement) => statement.body?.owner_id === OTHER_OWNER_ID);
    expect(await second).toBeInstanceOf(PubPalToolTurnAccessError);
    expect(durable.rows.get(CONVERSATION_ID)?.owner_id).toBe(OWNER_ID);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OTHER_OWNER_ID)).toBeNull();
  });

  it("a same-owner bind losing the insert race preserves the winner's user line and expiry", async () => {
    const held = holdWrites(2);
    const line = registerFirstLine();
    const bind = bindPubPalToolTurn(CONVERSATION_ID, OWNER_ID, "london");
    await held.allPending;
    held.resumeWhere((statement) => statement.body?.payload?.query === FIRST_QUERY);
    await line;
    vi.setSystemTime(STARTED + 10_000);
    held.resumeWhere((statement) => statement.body?.payload?.query === "");
    await bind;
    const stored = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
    expect(stored?.query).toBe(FIRST_QUERY);
    expect(stored?.turns).toEqual([{ role: "user", content: FIRST_QUERY }]);
    expect(stored?.expiresAt).toBe(STARTED + PUB_PAL_TOOL_TURN_TTL_MS);
  });

  it("a receipt read before expiry cannot recreate a row deleted by the purge", async () => {
    await registerFirstLine();
    const origin = await receiptOrigin();
    vi.setSystemTime(STARTED + PUB_PAL_TOOL_TURN_TTL_MS - 1);
    const held = holdWrites(1);
    const result = appendPubPalToolTurn(CONVERSATION_ID, receipt("late"), origin);
    await held.allPending;
    vi.setSystemTime(STARTED + PUB_PAL_TOOL_TURN_TTL_MS + 1);
    await purgeExpiredPubPalToolTurns();
    expect(durable.rows.has(CONVERSATION_ID)).toBe(false);
    held.resumeWhere(() => true);
    await result;
    expect(durable.rows.has(CONVERSATION_ID)).toBe(false);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toBeNull();
  });

  it("refuses a user line and receipt whose initial read is already expired", async () => {
    await registerFirstLine();
    const origin = await receiptOrigin();
    vi.setSystemTime(STARTED + PUB_PAL_TOOL_TURN_TTL_MS + 1);
    durable.statements = [];
    expect(await appendOwnedPubPalUserTurn(
      CONVERSATION_ID, OWNER_ID, { role: "user", content: NEXT_QUERY }, "london",
    )).toBe(false);
    await appendPubPalToolTurn(CONVERSATION_ID, receipt("late"), origin);
    expect(durable.rows.has(CONVERSATION_ID)).toBe(false);
    expect(durable.statements.some((statement) => ["insert", "upsert", "update"].includes(statement.action)))
      .toBe(false);
  });

  it("surfaces transport write errors without reporting a successful user append", async () => {
    await registerFirstLine();
    durable.writeError = { code: "08006", message: "durable write interrupted" };
    await expect(appendOwnedPubPalUserTurn(
      CONVERSATION_ID, OWNER_ID, { role: "user", content: NEXT_QUERY }, "london",
    )).rejects.toThrow("durable write interrupted");
    durable.writeError = null;
    expect((await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID))?.query).toBe(FIRST_QUERY);
  });

  it("merges a legacy unversioned row when two real receipt writes overlap", async () => {
    await registerFirstLine();
    const origin = await receiptOrigin();
    const row = durable.rows.get(CONVERSATION_ID)!;
    delete row.payload.revision;
    const held = holdWrites(2);
    const first = appendPubPalToolTurn(CONVERSATION_ID, receipt("A"), origin);
    const second = appendPubPalToolTurn(CONVERSATION_ID, receipt("B"), origin);
    await held.allPending;
    const hasHint = (hint: string) => (statement: DurableStatement) => {
      const hints = statement.body?.payload?.hints;
      return Array.isArray(hints) && hints.includes(hint);
    };
    held.resumeWhere(hasHint("A"));
    await first;
    held.resumeWhere(hasHint("B"));
    await second;
    const stored = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
    expect(stored?.cards.map((card) => card.key).sort()).toEqual(["A", "B"]);
    expect(stored?.hints.slice().sort()).toEqual(["A", "B"]);
    expect(stored?.toolsUsed).toEqual(["search_venues"]);
    expect(stored?.expiresAt).toBe(STARTED + PUB_PAL_TOOL_TURN_TTL_MS);
    expect(stored).not.toHaveProperty("revision");
  });

  it.each(["register", "user", "receipt"] as const)(
    "surfaces bounded conflict exhaustion for %s without a success or partial write",
    async (operation) => {
      await registerFirstLine();
      const origin = await receiptOrigin();
      const before = structuredClone(durable.rows.get(CONVERSATION_ID));
      durable.zeroWriteRows = true;
      let attempts = 0;
      durable.beforeWrite = async () => {
        if (++attempts > 10) throw new Error("Unbounded conflict retry");
      };
      const pending = operation === "register"
        ? registerPubPalToolTurn(CONVERSATION_ID, { query: NEXT_QUERY, cityId: "london", ownerId: OWNER_ID })
        : operation === "user"
          ? appendOwnedPubPalUserTurn(CONVERSATION_ID, OWNER_ID, { role: "user", content: NEXT_QUERY }, "london")
          : appendPubPalToolTurn(CONVERSATION_ID, receipt("A"), origin);
      await expect(pending).rejects.toThrow("conversation changed while saving");
      expect(attempts).toBeGreaterThan(1);
      expect(attempts).toBeLessThanOrEqual(10);
      expect(durable.rows.get(CONVERSATION_ID)).toEqual(before);
    },
  );

  it.each([null, "1", -1, 1.5])("refuses malformed stored revision %s instead of resetting it", async (revision) => {
    await registerFirstLine();
    const origin = await receiptOrigin();
    const row = durable.rows.get(CONVERSATION_ID)!;
    row.payload.revision = revision;
    const before = structuredClone(row);
    await expect(appendPubPalToolTurn(CONVERSATION_ID, receipt("A"), origin))
      .rejects.toThrow("Invalid Pub Pal conversation revision");
    expect(durable.rows.get(CONVERSATION_ID)).toEqual(before);
  });

  it("an older delayed user line cannot replace the latest genuine user query or clock", async () => {
    await registerFirstLine();
    const held = holdWrites(2);
    vi.setSystemTime(STARTED + 90_000);
    const older = appendOwnedPubPalUserTurn(
      CONVERSATION_ID, OWNER_ID, { role: "user", content: "Older line." }, "london",
    );
    // Wait until the first snapshot has reached its held write before the newer ask.
    let observed!: () => void;
    const olderPending = new Promise<void>((resolve) => { observed = resolve; });
    const hold = durable.beforeWrite!;
    durable.beforeWrite = async (statement) => {
      if (statement.body?.payload?.query === "Older line.") observed();
      await hold(statement);
    };
    await olderPending;
    vi.setSystemTime(STARTED + 95_000);
    const newer = appendOwnedPubPalUserTurn(
      CONVERSATION_ID, OWNER_ID, { role: "user", content: NEXT_QUERY }, "london",
    );
    await held.allPending;
    held.resumeWhere((statement) => statement.body?.payload?.query === NEXT_QUERY);
    expect(await newer).toBe(true);
    vi.setSystemTime(STARTED + 100_000);
    held.resumeWhere((statement) => statement.body?.payload?.query === "Older line.");
    expect(await older).toBe(true);
    const stored = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
    expect(stored?.query).toBe(NEXT_QUERY);
    expect(stored?.turns.map((turn) => turn.content).sort()).toEqual([
      FIRST_QUERY, "Older line.", NEXT_QUERY,
    ].sort());
    expect(stored?.expiresAt).toBe(STARTED + 95_000 + PUB_PAL_TOOL_TURN_TTL_MS);
  });

  async function establishFreshContext() {
    // Explicit future B1 same-CID reset fixture, not evidence of provider ID reuse.
    vi.setSystemTime(STARTED + 125_000);
    await purgeExpiredPubPalToolTurns();
    expect(durable.rows.has(CONVERSATION_ID)).toBe(false);
    await bindPubPalToolTurn(CONVERSATION_ID, OWNER_ID, "london");
    expect(await appendOwnedPubPalUserTurn(
      CONVERSATION_ID, OWNER_ID, { role: "user", content: "Fresh context line." }, "london",
    )).toBe(true);
    const origin = await receiptOrigin();
    await appendPubPalToolTurn(CONVERSATION_ID, receipt("fresh", "venue_prices"), origin);
    expect(durable.rows.get(CONVERSATION_ID)?.created_at)
      .toBe(new Date(STARTED + 125_000).toISOString());
  }

  async function expectFreshContextOnly() {
    const stored = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
    expect(stored?.query).toBe("Fresh context line.");
    expect(stored?.turns).toEqual([{ role: "user", content: "Fresh context line." }]);
    expect(stored?.cards).toEqual(receipt("fresh").cards);
    expect(stored?.proposals).toEqual(receipt("fresh").proposals);
    expect(stored?.hints).toEqual(["fresh"]);
    expect(stored?.toolsUsed).toEqual(["venue_prices"]);
    expect(stored?.expiresAt).toBe(STARTED + 125_000 + PUB_PAL_TOOL_TURN_TTL_MS);
    expect(stored).not.toHaveProperty("created_at");
    expect(stored).not.toHaveProperty("createdAt");
    expect(stored).not.toHaveProperty("revision");
  }

  it("refuses a receipt captured before replacement even when append starts after the fresh context", async () => {
    await registerFirstLine();
    const origin = await receiptOrigin();
    await establishFreshContext();
    const freshBefore = structuredClone(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID));
    await appendPubPalToolTurn(CONVERSATION_ID, receipt("old-computation", "venue_heritage"), origin);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toEqual(freshBefore);
    await expectFreshContextOnly();
  });

  it("a late old-context receipt cannot retry into a fresh same-owner conversation row", async () => {
    await registerFirstLine();
    const origin = await receiptOrigin();
    expect(durable.rows.get(CONVERSATION_ID)?.created_at).toBe(new Date(STARTED).toISOString());
    vi.setSystemTime(STARTED + 119_000);
    const held = holdWrites(1);
    const late = appendPubPalToolTurn(CONVERSATION_ID, receipt("expired", "venue_heritage"), origin);
    const settled = late.then(() => null, (error: unknown) => error);
    await held.allPending;
    await establishFreshContext();
    held.resumeWhere(() => true);
    const error = await settled;
    expect(error === null || error instanceof PubPalToolTurnAccessError).toBe(true);
    await expectFreshContextOnly();
  });

  it.each(["user", "register"] as const)(
    "an old owned %s mutation cannot overwrite a fresh context after its held write conflicts",
    async (operation) => {
      await registerFirstLine();
      vi.setSystemTime(STARTED + 119_000);
      const held = holdWrites(1);
      const pending = operation === "user"
        ? appendOwnedPubPalUserTurn(
          CONVERSATION_ID, OWNER_ID, { role: "user", content: "Expired context line." }, "london",
        )
        : registerPubPalToolTurn(CONVERSATION_ID, {
          query: "Expired context line.", cityId: "london", ownerId: OWNER_ID,
          turns: [{ role: "user", content: "Expired context line." }],
        });
      const settled = pending.then(() => null, (error: unknown) => error);
      await held.allPending;
      await establishFreshContext();
      held.resumeWhere(() => true);
      const error = await settled;
      expect(error === null || error instanceof PubPalToolTurnAccessError).toBe(true);
      await expectFreshContextOnly();
    },
  );

  it("keeps raw microsecond birth in live CAS guards without exposing it", async () => {
    await registerFirstLine();
    const birth = "2026-10-02T12:00:00.123456+00:00";
    durable.rows.get(CONVERSATION_ID)!.created_at = birth;
    const origin = await receiptOrigin();
    durable.statements = [];
    vi.setSystemTime(STARTED + 90_000);
    expect(await appendOwnedPubPalUserTurn(
      CONVERSATION_ID, OWNER_ID, { role: "user", content: NEXT_QUERY }, "london",
    )).toBe(true);
    await appendPubPalToolTurn(CONVERSATION_ID, receipt("A"), origin);
    const updates = durable.statements.filter((statement) => statement.action === "update");
    expect(updates).toHaveLength(2);
    for (const update of updates) {
      expect(update.filters).toContainEqual({ column: "created_at", operator: "eq", value: birth });
      expect(update.body).not.toHaveProperty("created_at");
    }
    const stored = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
    expect(stored?.query).toBe(NEXT_QUERY);
    expect(stored?.cards).toEqual(receipt("A").cards);
    expect(stored?.expiresAt).toBe(STARTED + 90_000 + PUB_PAL_TOOL_TURN_TTL_MS);
    expect(stored).not.toHaveProperty("createdAt");
    expect(stored).not.toHaveProperty("created_at");
    expect(stored).not.toHaveProperty("revision");
    const row = durable.rows.get(CONVERSATION_ID)!;
    expect(row.created_at).toBe(birth);
    expect(row.payload).not.toHaveProperty("createdAt");
    expect(row.payload).not.toHaveProperty("created_at");
  });

  it.each(["", "not-a-timestamp"])("refuses malformed birth %s instead of losing generation identity", async (birth) => {
    await registerFirstLine();
    const origin = await receiptOrigin();
    const row = durable.rows.get(CONVERSATION_ID)!;
    row.created_at = birth;
    const before = structuredClone(row);
    await expect(appendPubPalToolTurn(CONVERSATION_ID, receipt("A"), origin))
      .rejects.toThrow("Invalid Pub Pal conversation creation time");
    expect(durable.rows.get(CONVERSATION_ID)).toEqual(before);
  });

  it("an old observed register cannot insert again after its context vanishes", async () => {
    await registerFirstLine();
    vi.setSystemTime(STARTED + 119_000);
    const held = holdWrites(1);
    const pending = registerPubPalToolTurn(CONVERSATION_ID, {
      query: "Expired context line.", cityId: "london", ownerId: OWNER_ID,
    }).then(() => null, (error: unknown) => error);
    await held.allPending;
    vi.setSystemTime(STARTED + 125_000);
    await purgeExpiredPubPalToolTurns();
    expect(durable.rows.has(CONVERSATION_ID)).toBe(false);
    held.resumeWhere(() => true);
    expect(await pending).toBeInstanceOf(PubPalToolTurnAccessError);
    expect(durable.rows.has(CONVERSATION_ID)).toBe(false);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toBeNull();
  });
});
