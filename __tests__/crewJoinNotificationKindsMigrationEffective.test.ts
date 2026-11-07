import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const directory = join(process.cwd(), "supabase/migrations");
const name = "20261107210000_0223_crew_join_notification_kinds.sql";
let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("No test cluster"); return session; }

function insert(kind: string): string {
  try {
    db().sql(`insert into public.notifications(recipient_handle, actor_handle, kind, subject_ref, subject_label)
      values ('soho_host', 'new_face', '${kind}', '4f6b0c1e-2a7d-4c55-9a3e-1b2c3d4e5f60', 'Thursday in Soho')`);
    return "inserted";
  } catch {
    return "refused";
  }
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "crew-join-kinds-0223", database: "pubmax_crew_join_kinds" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".sql") && entry < name).sort()) db().applyFile(join(directory, file));
  } catch (error) { await session.stop(); session = null; throw error; }
}, 180_000);
afterAll(async () => { await session?.stop(); });

describe.skipIf(skipReason !== null)("0223 crew join notification kinds", () => {
  it("refuses the two crew kinds before the migration", () => {
    expect(insert("crew_join_request")).toBe("refused");
    expect(insert("crew_join_accepted")).toBe("refused");
  });

  it("accepts them after it, keeps the old kinds, and still refuses an invented one", () => {
    db().applyFile(join(directory, name));
    db().applyFile(join(directory, name));
    expect(insert("crew_join_request")).toBe("inserted");
    expect(insert("crew_join_accepted")).toBe("inserted");
    expect(insert("follow")).toBe("inserted");
    expect(insert("crew_join_declined")).toBe("refused");
    expect(db().sql("select has_table_privilege('anon','public.notifications','SELECT')")).toBe("f");
    expect(db().sql("select has_table_privilege('authenticated','public.notifications','SELECT')")).toBe("f");
  });

  it("rollback deletes only the crew rows and refuses the crew kinds again", () => {
    db().applyFile(join(directory, "rollback/20261107210000_0223_crew_join_notification_kinds_rollback.sql"));
    expect(db().sql("select count(*) from public.notifications where kind like 'crew_join_%'")).toBe("0");
    expect(db().sql("select count(*) from public.notifications where kind = 'follow'")).toBe("1");
    expect(insert("crew_join_request")).toBe("refused");
  });
});
