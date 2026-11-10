import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const directory = join(process.cwd(), "supabase/migrations");
const name = "20261110100000_0229_presence_one_pub_per_person.sql";
const rollback = join(directory, "rollback/20261110100000_0229_presence_one_pub_per_person_rollback.sql");
let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("No test cluster"); return session; }

function mark(actor: string, venue: string, minutesAgo: number, handle = actor): "ok" | "refused" {
  try {
    db().sql(`insert into public.pub_presence(handle, venue_id, actor_hash, created_at)
      values ('${handle}', '${venue}', '${actor}', now() - interval '${minutesAgo} minutes')`);
    return "ok";
  } catch {
    return "refused";
  }
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "presence-one-pub-0229", database: "pubmax_presence_one_pub" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".sql") && entry < name).sort()) db().applyFile(join(directory, file));
  } catch (error) { await session.stop(); session = null; throw error; }
}, 180_000);
afterAll(async () => { await session?.stop(); });

describe.skipIf(skipReason !== null)("0229 one pub per person", () => {
  it("lets one person be live at two pubs before the migration", () => {
    expect(mark("ann", "venue-crown", 30)).toBe("ok");
    expect(mark("ann", "venue-anchor", 5)).toBe("ok");
    expect(mark("ann-mobile", "venue-new", 1, "ann")).toBe("ok");
    expect(mark("bob", "venue-crown", 10)).toBe("ok");
  });

  it("keeps each person's newest mark, then refuses a second pub", () => {
    db().applyFile(join(directory, name));
    db().applyFile(join(directory, name));
    expect(db().sql("select string_agg(actor_hash || ':' || venue_id, ',' order by actor_hash) from public.pub_presence"))
      .toBe("ann-mobile:venue-new,bob:venue-crown");
    expect(mark("bob", "venue-anchor", 0)).toBe("refused");
    // The server's refresh upsert on (actor_hash, venue_id) still works.
    db().sql(`insert into public.pub_presence(handle, venue_id, actor_hash) values ('bob', 'venue-crown', 'bob')
      on conflict (actor_hash, venue_id) do update set expires_at = excluded.expires_at`);
    expect(db().sql("select count(*) from public.pub_presence where actor_hash = 'bob'")).toBe("1");
  });

  it("rollback drops the rule and keeps the rows", () => {
    db().applyFile(rollback);
    expect(db().sql("select count(*) from public.pub_presence")).toBe("2");
    expect(mark("bob", "venue-anchor", 0)).toBe("ok");
  });
});
