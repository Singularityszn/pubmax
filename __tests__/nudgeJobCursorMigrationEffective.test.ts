import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startPostgres, type PostgresSession } from "./helpers/postgres";

let db: PostgresSession;
const root = join(process.cwd(), "supabase/migrations");
const name = "20261125091200_0270_nudge_job_cursors.sql";

beforeAll(async () => {
  db = await startPostgres({ label: "nudge-cursor" });
  db.sql("create role anon; create role authenticated; create role service_role bypassrls;");
});
afterAll(async () => { await db?.stop(); });

it("holds a lease, resumes a saved cursor and rolls back", async () => {
  expect(db.sql("select to_regclass('public.nudge_job_cursors') is null")).toBe("t");
  db.applyFile(join(root, name));
  const first = "00000000-0000-4000-8000-000000000001";
  const second = "00000000-0000-4000-8000-000000000002";
  expect(db.sql(`set role service_role; select count(*) from public.claim_nudge_job('step-out','${first}')`)).toBe("1");
  expect(db.sql(`set role service_role; select count(*) from public.claim_nudge_job('step-out','${second}')`)).toBe("0");
  expect(db.sql(`set role service_role; select public.advance_nudge_job('step-out','${first}','actor-a',true)`)).toBe("t");
  expect(db.sql(`set role service_role; select cursor from public.claim_nudge_job('step-out','${second}')`)).toBe("actor-a");
  expect(db.sql(`set role service_role; select public.advance_nudge_job('step-out','${first}',null,true)`)).toBe("f");
  expect(db.sql(`set role service_role; select public.advance_nudge_job('step-out','${second}',null,true)`)).toBe("t");
  expect((await db.attempt(`set role anon; select * from public.claim_nudge_job('step-out','${first}')`)).ok).toBe(false);
  db.applyFile(join(root, "rollback", name));
  expect(db.sql("select to_regclass('public.nudge_job_cursors') is null")).toBe("t");
});
