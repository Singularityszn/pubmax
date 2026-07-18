import { afterEach, describe, expect, it, vi } from "vitest";

// Exercises the SUPABASE backend of emailSubscribersStore against a fluent,
// in-memory mock of the admin client — proving the durable path's idempotent
// UPSERT, confirm, unsubscribe, and confirmed-only recipient scan match the
// process-memory contract (emailSubscribers.test.ts). isSupabaseConfigured is
// forced true so emailSubscribersStore() selects the Supabase implementation.

type Row = {
  email: string;
  source: string;
  confirmed: boolean;
  unsubscribe_token: string;
};

const db = vi.hoisted(() => ({ rows: new Map<string, Row>() }));

vi.mock("@/lib/supabase", () => {
  function makeQuery() {
    let op: "upsert" | "update" | "delete" | "select" | null = null;
    let pending: Row | null = null;
    let ignoreDuplicates = false;
    let patch: Partial<Row> = {};
    const filters: { column: string; value: unknown }[] = [];

    function filterVal(col: string): unknown {
      return filters.find((f) => f.column === col)?.value;
    }

    function resolveMutation(): { data: unknown; error: null } {
      if (op === "upsert" && pending) {
        if (db.rows.has(pending.email)) {
          // ON CONFLICT DO NOTHING → no inserted row returned.
          return ignoreDuplicates ? { data: [], error: null } : { data: [db.rows.get(pending.email)], error: null };
        }
        db.rows.set(pending.email, pending);
        return { data: [pending], error: null };
      }
      if (op === "update") {
        const token = filterVal("unsubscribe_token");
        const wantUnconfirmed = filters.some((f) => f.column === "confirmed" && f.value === false);
        const updated: { email: string }[] = [];
        for (const row of db.rows.values()) {
          if (row.unsubscribe_token !== token) continue;
          if (wantUnconfirmed && row.confirmed) continue;
          Object.assign(row, patch);
          updated.push({ email: row.email });
        }
        return { data: updated, error: null };
      }
      if (op === "delete") {
        const token = filterVal("unsubscribe_token");
        const removed: { email: string }[] = [];
        for (const [email, row] of db.rows) {
          if (row.unsubscribe_token === token) {
            removed.push({ email });
            db.rows.delete(email);
          }
        }
        return { data: removed, error: null };
      }
      return { data: [], error: null };
    }

    const query = {
      upsert(row: Row, opts?: { ignoreDuplicates?: boolean }) {
        op = "upsert";
        pending = row;
        ignoreDuplicates = Boolean(opts?.ignoreDuplicates);
        return query;
      },
      update(next: Partial<Row>) {
        op = "update";
        patch = next;
        return query;
      },
      delete() {
        op = "delete";
        return query;
      },
      select() {
        if (op === "upsert" || op === "update" || op === "delete") {
          return Promise.resolve(resolveMutation());
        }
        op = "select";
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push({ column, value });
        return query;
      },
      maybeSingle() {
        const email = filterVal("email");
        const row = typeof email === "string" ? db.rows.get(email) ?? null : null;
        return Promise.resolve({ data: row, error: null });
      },
      limit() {
        const wantConfirmed = filters.some((f) => f.column === "confirmed" && f.value === true);
        const data = [...db.rows.values()].filter((r) => (wantConfirmed ? r.confirmed : true));
        return Promise.resolve({ data, error: null });
      },
    };
    return query;
  }

  const admin = { from: () => makeQuery() };
  return {
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => admin,
    getSupabaseAdmin: () => admin,
    requiresSupabaseStore: () => false,
  };
});

// Import AFTER the mock is registered.
import {
  __resetEmailSubscribers,
  emailSubscribersStore,
} from "@/lib/emailSubscribersStore";

afterEach(() => {
  db.rows.clear();
  __resetEmailSubscribers();
});

describe("emailSubscribersStore (Supabase backend)", () => {
  it("inserts a new address as created + unconfirmed", async () => {
    const out = await emailSubscribersStore().subscribe({ email: "New@Example.com" });
    expect(out.status).toBe("created");
    expect(out.confirmed).toBe(false);
    expect(out.unsubscribeToken).toMatch(/\S/);
    expect(db.rows.get("new@example.com")?.confirmed).toBe(false);
  });

  it("is idempotent by email: a conflict returns the existing row, not a duplicate", async () => {
    const first = await emailSubscribersStore().subscribe({ email: "dup@example.com" });
    const again = await emailSubscribersStore().subscribe({ email: " DUP@example.com " });
    expect(again.status).toBe("existing");
    expect(again.unsubscribeToken).toBe(first.unsubscribeToken);
    expect(db.rows.size).toBe(1);
  });

  it("confirm(token) flips the row once; a second confirm is a no-op", async () => {
    const sub = await emailSubscribersStore().subscribe({ email: "confirm@example.com" });
    expect(await emailSubscribersStore().confirm(sub.unsubscribeToken)).toBe(true);
    expect(db.rows.get("confirm@example.com")?.confirmed).toBe(true);
    expect(await emailSubscribersStore().confirm(sub.unsubscribeToken)).toBe(false);
  });

  it("listConfirmedSubscribers returns ONLY confirmed rows", async () => {
    await emailSubscribersStore().subscribe({ email: "pending@example.com" });
    const ready = await emailSubscribersStore().subscribe({ email: "ready@example.com" });
    await emailSubscribersStore().confirm(ready.unsubscribeToken);
    const confirmed = await emailSubscribersStore().listConfirmedSubscribers();
    expect(confirmed.map((c) => c.email)).toEqual(["ready@example.com"]);
  });

  it("unsubscribe(token) deletes the row", async () => {
    const sub = await emailSubscribersStore().subscribe({ email: "gone@example.com" });
    expect(await emailSubscribersStore().unsubscribe(sub.unsubscribeToken)).toBe(true);
    expect(db.rows.size).toBe(0);
    expect(await emailSubscribersStore().unsubscribe(sub.unsubscribeToken)).toBe(false);
  });
});
