// Real PostgreSQL and PostgREST named RPC dispatch. Auth JWTs are local harness
// tokens; this proves neither GoTrue nor Storage byte access.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason } from "../scripts/rls/postgresHost.mjs";

type Session = {
  sql(statement: string, opts?: { asRole?: string; sub?: string }): { ok: boolean; out: string; err: string };
  sqlFile(path: string): void;
  reloadPostgrestSchema(): Promise<void>;
  rest(path: string, opts?: { sub?: string }): Promise<{ status: number; body: unknown; text: string }>;
  restBaseUrl: string;
  serviceRoleKey: string;
  stop(): Promise<void>;
};
type Reply = { status: number; body: unknown };
type Owner = {
  id: string; price_pennies: number; submitted_at: string;
  round_spend_id: string | null; round_line_index: number | null;
  source_became_owner: boolean;
  receipt_became_owner?: boolean;
  receipt_photo_key?: string | null;
  previous_receipt_photo_key?: string | null;
};
const migrations = join(process.cwd(), "supabase/migrations");
const forwardName = "20261003180000_0187_community_price_receipts.sql";
const forward = join(migrations, forwardName);
const rollback = join(migrations, "rollback/20261003180000_0187_community_price_receipts_rollback.sql");
const v1 = "20260806035204_0070_v1_release_security.sql";
const skipReason = postgresSkipReason();
const actorA = "profile:00000000-0000-4000-8000-0000000000a1";
const actorB = "profile:00000000-0000-4000-8000-0000000000b2";
const early = "2026-10-03T17:00:00Z";
const later = "2026-10-03T20:00:00Z";
const legacyFields = ["id", "price_pennies", "round_line_index", "round_spend_id", "source_became_owner", "submitted_at"];
const signature = "public.upsert_attributed_community_price_if_newer(text,text,integer,text,text,timestamptz,uuid,integer)";
let session: Session | null = null;
let originalFunction = "";
let originalHelpers = "";
let appliedForward = false;
function db(): Session {
  if (!session) throw new Error("Receipt PostgreSQL session unavailable");
  return session;
}
function sql(statement: string): string {
  const result = db().sql(statement);
  expect(result.ok, result.err).toBe(true);
  return result.out;
}
function helpers(): string {
  return sql(`select coalesce(jsonb_agg(jsonb_build_object('name', p.proname,
    'definition', pg_get_functiondef(p.oid), 'acl', p.proacl::text)
    order by p.proname, p.oid)::text, '[]') from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    and p.proname in ('reconcile_round_price_keys', 'transition_round_price_lines', 'charge_round_price_line')`);
}
function args(venue: string, category = "wine", pennies = 550, stamp = early, actor = actorA): Record<string, unknown> {
  return { p_venue_id: `venue-receipt-sql-${venue}`, p_drink_category: category,
    p_price_pennies: pennies, p_actor: actor, p_contributor_handle: "receipt_owner",
    p_submitted_at: stamp, p_round_spend_id: null, p_round_line_index: null };
}
async function rpc(parameters: Record<string, unknown>, service = true): Promise<Reply> {
  const response = await fetch(`${db().restBaseUrl}/rpc/upsert_attributed_community_price_if_newer`, {
    method: "POST", headers: { "Content-Type": "application/json",
      ...(service ? { Authorization: `Bearer ${db().serviceRoleKey}` } : {}) },
    body: JSON.stringify(parameters),
  });
  return { status: response.status, body: await response.json() };
}
function owner(reply: Reply): Owner {
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);
  expect(Array.isArray(reply.body)).toBe(true);
  expect(reply.body).toHaveLength(1);
  return (reply.body as Owner[])[0];
}
function retained(venue: string, actor = actorA): Record<string, unknown> {
  return JSON.parse(sql(`select jsonb_build_object('id', id, 'price', price_pennies,
    'key', receipt_photo_key, 'hidden', hidden_at, 'note', moderator_note,
    'round', round_spend_id, 'line', round_line_index)::text
    from public.community_prices where venue_id = 'venue-receipt-sql-${venue}' and actor = '${actor}'`));
}

beforeAll(async () => {
  if (skipReason) return;
  // @ts-expect-error Existing executable session harness has no declarations.
  const mod = await import("../scripts/rls/session-harness.mjs") as { startRlsSession(): Promise<Session> };
  session = await mod.startRlsSession();
  try {
    for (const name of readdirSync(migrations).filter((name) => name.endsWith(".sql") && name > v1 && name < forwardName).sort()) {
      db().sqlFile(join(migrations, name));
    }
    originalFunction = sql(`select pg_get_functiondef('${signature}'::regprocedure)`);
    originalHelpers = helpers();
    // The same assertions run against the actual baseline before the producer
    // exists. Missing ninth-argument support must fail at HTTP, not in setup.
    appliedForward = existsSync(forward);
    if (appliedForward) db().sqlFile(forward);
    await db().reloadPostgrestSchema();
  } catch (error) {
    await session.stop();
    session = null;
    throw error;
  }
}, 600_000);
afterAll(async () => { await session?.stop(); session = null; });

describe.skipIf(skipReason !== null)("community price receipt ownership", { concurrent: false }, () => {
  it("keeps legacy eight named arguments and exactly six result fields", async () => {
    const result = owner(await rpc(args("legacy")));
    expect(Object.keys(result).sort()).toEqual(legacyFields);
    expect(result).toMatchObject({ price_pennies: 550, round_spend_id: null, round_line_index: null, source_became_owner: true });
  });

  it.each(["wine", "cocktail", "whisky"])("retains %s bill on its observation without a Pint Drop", async (category) => {
    const key = `receipts/${category}/first.jpg`;
    const result = owner(await rpc({ ...args(category, category), p_receipt_photo_key: key }));
    expect(result).toMatchObject({ price_pennies: 550, receipt_became_owner: true, receipt_photo_key: key, previous_receipt_photo_key: null });
    expect(retained(category)).toMatchObject({ id: result.id, price: 550, key });
    expect(sql(`select count(*) from public.pint_drops where venue_id = 'venue-receipt-sql-${category}'`)).toBe("0");
  });

  it("corrects same account in place and returns only its superseded bill", async () => {
    const first = owner(await rpc({ ...args("correction"), p_receipt_photo_key: "receipts/correction/first.jpg" }));
    const second = owner(await rpc({ ...args("correction", "wine", 650, later), p_receipt_photo_key: "receipts/correction/second.jpg" }));
    expect(second).toMatchObject({ id: first.id, price_pennies: 650, receipt_became_owner: true,
      receipt_photo_key: "receipts/correction/second.jpg", previous_receipt_photo_key: "receipts/correction/first.jpg" });
    expect(retained("correction")).toMatchObject({ id: first.id, price: 650, key: "receipts/correction/second.jpg" });
    const retry = owner(await rpc({ ...args("correction", "wine", 650, later), p_receipt_photo_key: "receipts/correction/second.jpg" }));
    expect(retry.previous_receipt_photo_key).toBeNull();
  });

  it("rejects stale bill while preserving existing equal-timestamp correction", async () => {
    const first = owner(await rpc({ ...args("time", "wine", 650, later), p_receipt_photo_key: "receipts/time/current.jpg" }));
    const stale = owner(await rpc({ ...args("time"), p_receipt_photo_key: "receipts/time/stale.jpg" }));
    expect(stale).toMatchObject({ id: first.id, price_pennies: 650, source_became_owner: true,
      receipt_became_owner: false, receipt_photo_key: "receipts/time/current.jpg", previous_receipt_photo_key: null });
    expect(retained("time")).toMatchObject({ price: 650, key: "receipts/time/current.jpg" });
    const equal = owner(await rpc({ ...args("time", "wine", 700, later), p_receipt_photo_key: "receipts/time/equal.jpg" }));
    expect(equal).toMatchObject({ id: first.id, price_pennies: 700, receipt_became_owner: true,
      receipt_photo_key: "receipts/time/equal.jpg", previous_receipt_photo_key: "receipts/time/current.jpg" });
  });

  it("keeps newest observation and bill together during same-account contention", async () => {
    const replies = await Promise.all([
      rpc({ ...args("race"), p_receipt_photo_key: "receipts/race/old.jpg" }),
      rpc({ ...args("race", "wine", 750, later), p_receipt_photo_key: "receipts/race/new.jpg" }),
    ]);
    replies.forEach(owner);
    expect(retained("race")).toMatchObject({ price: 750, key: "receipts/race/new.jpg" });
    expect(sql("select count(*) from public.community_prices where venue_id = 'venue-receipt-sql-race'")).toBe("1");
  });

  it("isolates competing accounts' bills at same venue and category", async () => {
    const replies = await Promise.all([
      rpc({ ...args("accounts"), p_receipt_photo_key: "receipts/account-a.jpg" }),
      rpc({ ...args("accounts", "wine", 850, later, actorB), p_receipt_photo_key: "receipts/account-b.jpg" }),
    ]);
    const a = owner(replies[0]); const b = owner(replies[1]);
    expect(a.id).not.toBe(b.id);
    expect(a.previous_receipt_photo_key).toBeNull(); expect(b.previous_receipt_photo_key).toBeNull();
    expect(retained("accounts", actorA)).toMatchObject({ price: 550, key: "receipts/account-a.jpg" });
    expect(retained("accounts", actorB)).toMatchObject({ price: 850, key: "receipts/account-b.jpg" });
  });

  it("clears superseded bill on accepted legacy writes, never on stale legacy writes", async () => {
    const first = owner(await rpc({ ...args("legacy-clear", "wine", 650, later), p_receipt_photo_key: "receipts/legacy/current.jpg" }));
    owner(await rpc(args("legacy-clear")));
    expect(retained("legacy-clear")).toMatchObject({ id: first.id, price: 650, key: "receipts/legacy/current.jpg" });
    const accepted = owner(await rpc(args("legacy-clear", "wine", 700, later)));
    expect(Object.keys(accepted).sort()).toEqual(legacyFields);
    expect(retained("legacy-clear")).toMatchObject({ id: first.id, price: 700, key: null });
  });

  it("preserves round promotion and supersession while replacing bill associations", async () => {
    const first = owner(await rpc({ ...args("round"), p_receipt_photo_key: "receipts/round/direct.jpg" }));
    const round = "00000000-0000-4000-8000-0000000000c3";
    const spend = "00000000-0000-4000-8000-0000000000d4";
    sql(`insert into public.rounds(id, code, title, created_by_handle) values ('${round}', 'RCTSQL', 'Receipt regression', 'receipt_owner');
insert into public.round_spends(id, round_id, client_ref, payer_handle, recorded_by_handle, venue_id, venue_name, total_pence, items, recorded_at, promotion_actor)
values ('${spend}', '${round}', 'receipt-round', 'receipt_owner', 'receipt_owner', 'venue-receipt-sql-round', 'Receipt pub', 700,
'[{"source":"round","drinkCategory":"wine","promotionStatus":"ready"}]', '${later}', '${actorA}')`);
    const promoted = owner(await rpc({ ...args("round", "wine", 700, later), p_round_spend_id: spend, p_round_line_index: 0 }));
    expect(promoted).toMatchObject({ id: first.id, round_spend_id: spend, round_line_index: 0, source_became_owner: true });
    expect(retained("round")).toMatchObject({ price: 700, key: null, round: spend, line: 0 });
    expect(sql(`select items->0->>'promotionStatus' from public.round_spends where id = '${spend}'`)).toBe("promoted");
    const laterBill = owner(await rpc({ ...args("round", "wine", 800, "2026-10-03T21:00:00Z"), p_receipt_photo_key: "receipts/round/after.jpg" }));
    expect(laterBill).toMatchObject({ id: first.id, receipt_became_owner: true, round_spend_id: null, receipt_photo_key: "receipts/round/after.jpg" });
    expect(sql(`select items->0->>'promotionStatus' from public.round_spends where id = '${spend}'`)).toBe("superseded");
    expect(helpers()).toBe(originalHelpers);
    const foreign = await rpc({ ...args("round", "wine", 900, "2026-10-03T22:00:00Z", actorB),
      p_round_spend_id: spend, p_round_line_index: 0, p_receipt_photo_key: "receipts/round/foreign.jpg" });
    expect(foreign.status).toBe(200); expect(foreign.body).toEqual([]);
    expect(retained("round")).toMatchObject({ id: first.id, price: 800, key: "receipts/round/after.jpg" });
  });

  it("keeps moderated row hidden during price and bill correction", async () => {
    const first = owner(await rpc({ ...args("hidden"), p_receipt_photo_key: "receipts/hidden/first.jpg" }));
    sql(`update public.community_prices set hidden_at = '${early}', moderated_at = '${early}', moderator_note = 'Held for review' where id = '${first.id}'`);
    const corrected = owner(await rpc({ ...args("hidden", "wine", 700, later), p_receipt_photo_key: "receipts/hidden/second.jpg" }));
    expect(corrected.id).toBe(first.id);
    const stored = retained("hidden");
    expect(stored).toMatchObject({ price: 700, key: "receipts/hidden/second.jpg", note: "Held for review" });
    expect(Date.parse(String(stored.hidden))).toBe(Date.parse(early));
    const reader = await db().rest(`/community_prices?select=id&venue_id=eq.venue-receipt-sql-hidden`, { sub: "00000000-0000-4000-8000-0000000000a1" });
    expect(reader.status).toBe(200); expect(reader.body).toEqual([]);
  });

  it("keeps ninth argument required and bill column and both RPCs service-only", async () => {
    const result = owner(await rpc({ ...args("private"), p_receipt_photo_key: "receipts/private/first.jpg" }));
    expect(result.receipt_became_owner).toBe(true);
    const nine = `${signature.slice(0, -1)},text)`;
    expect(sql(`select pronargdefaults from pg_proc where oid = '${nine}'::regprocedure`)).toBe("0");
    expect(sql("select count(*) from pg_publication_tables where schemaname = 'public' and tablename = 'community_prices'")).toBe("0");
    for (const sig of [signature, nine]) {
      expect(sql(`select count(*) from pg_proc p cross join lateral
        aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
        where p.oid = '${sig}'::regprocedure and privilege.grantee = 0
        and privilege.privilege_type = 'EXECUTE'`)).toBe("0");
    }
    for (const role of ["anon", "authenticated"]) {
      expect(sql(`select has_column_privilege('${role}', 'public.community_prices', 'receipt_photo_key', 'SELECT')`)).toBe("false");
      for (const sig of [signature, nine]) {
        expect(sql(`select has_function_privilege('${role}', '${sig}', 'EXECUTE')`)).toBe("false");
      }
      const denied = db().sql("select receipt_photo_key from public.community_prices", { asRole: role });
      expect(denied.ok).toBe(false); expect(denied.err).toMatch(/permission denied/);
    }
    expect(sql("select has_column_privilege('service_role', 'public.community_prices', 'receipt_photo_key', 'SELECT')")).toBe("true");
    const tableRead = await db().rest("/community_prices?select=receipt_photo_key&venue_id=eq.venue-receipt-sql-private", { sub: "00000000-0000-4000-8000-0000000000a1" });
    expect(tableRead.status).toBe(403);
    expect(JSON.stringify(tableRead.body)).not.toContain("receipts/private/first.jpg");
    const denied = await rpc({ ...args("private", "wine", 900, later), p_receipt_photo_key: "receipts/private/injected.jpg" }, false);
    expect([401, 403, 404]).toContain(denied.status);
    expect(JSON.stringify(denied.body)).not.toContain("receipts/private/first.jpg");
    expect(retained("private")).toMatchObject({ price: 550, key: "receipts/private/first.jpg" });
  });

  it("rollback restores original eight-argument function and helpers, preserves prices", async () => {
    const before = sql("select coalesce(jsonb_agg(jsonb_build_object('id', id, 'price', price_pennies, 'actor', actor, 'category', drink_category, 'stamp', submitted_at) order by id)::text, '[]') from public.community_prices");
    if (appliedForward) db().sqlFile(rollback);
    await db().reloadPostgrestSchema();
    expect(sql(`select pg_get_functiondef('${signature}'::regprocedure)`)).toBe(originalFunction);
    expect(helpers()).toBe(originalHelpers);
    expect(sql("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'community_prices' and column_name = 'receipt_photo_key'")).toBe("0");
    expect(sql("select coalesce(jsonb_agg(jsonb_build_object('id', id, 'price', price_pennies, 'actor', actor, 'category', drink_category, 'stamp', submitted_at) order by id)::text, '[]') from public.community_prices")).toBe(before);
    const legacy = owner(await rpc(args("rollback")));
    expect(Object.keys(legacy).sort()).toEqual(legacyFields);
    const unavailable = await rpc({ ...args("rollback"), p_receipt_photo_key: "receipts/rollback.jpg" });
    expect(unavailable.status).toBe(404);
  });
});
