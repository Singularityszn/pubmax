import { PAL_VOICE_MAX_SESSION_SECONDS, PAL_VOICE_MONTHLY_MINUTES } from "@/lib/palVoiceMetering";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const MIGRATION = "20260922002000_0157_pub_pal_prepaid_voice_grants";
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const MIGRATION_NAME = `${MIGRATION}.sql`;
const SESSION_FIXTURE = join(process.cwd(), "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < MIGRATION_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

let database: PostgresSession;

beforeAll(async () => {
  if (postgresSkipReason()) return;
  database = await startPostgres({ label: "voice-grants" });
  database.applyFile(SESSION_FIXTURE);
  for (const prerequisite of PREREQUISITES) database.applyFile(prerequisite);
  database.sql(`insert into auth.users(id) values('${OWNER_ID}'),('${OTHER_ID}');`);
  database.applyFile(join(process.cwd(), "supabase/migrations", `${MIGRATION}.sql`));
}, 180_000);

beforeEach(() => {
  database?.sql("truncate public.pub_pal_voice_provider_events,public.pub_pal_voice_grants,public.pub_pal_voice_usage;");
});

afterAll(async () => {
  await database?.stop();
});

function grant(grant: string, month = "2026-09-01") {
  return `set role service_role;select public.prepay_pub_pal_voice_grant('${OWNER_ID}','${month}','${grant}');`;
}

function grantId(n: number) {
  return `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;
}

describe.skipIf(postgresSkipReason() !== null)("prepaid voice grants", () => {
  it("serializes competing grants at the monthly ceiling", async () => {
    const results = await database.concurrentResults(
      Array.from({ length: 15 }, (_, index) => grant(grantId(index))),
    );

    expect(results.filter((result) => result.trim() === "t")).toHaveLength(10);
    expect(database.sql("select used_minutes from public.pub_pal_voice_usage")).toBe(
      String(PAL_VOICE_MONTHLY_MINUTES),
    );
    expect(database.sql("select count(*) from public.pub_pal_voice_grants")).toBe("10");
  });

  it("refuses replay and refunds exactly once to its original month", () => {
    expect(database.sql(grant(grantId(1)))).toBe("t");
    expect(database.sql(grant(grantId(1)))).toBe("f");
    expect(database.sql(grant(grantId(2), "2026-10-01"))).toBe("t");
    expect(
      database.sql(
        `set role service_role;select public.refund_pub_pal_voice_grant('${OTHER_ID}','${grantId(1)}')`,
      ),
    ).toBe("f");
    expect(
      database.sql(
        `set role service_role;select public.refund_pub_pal_voice_grant('${OWNER_ID}','${grantId(1)}')`,
      ),
    ).toBe("t");
    expect(
      database.sql(
        `set role service_role;select public.refund_pub_pal_voice_grant('${OWNER_ID}','${grantId(1)}')`,
      ),
    ).toBe("f");
    expect(database.sql(grant(grantId(1)))).toBe("f");
    expect(database.sql("select used_minutes from public.pub_pal_voice_usage order by usage_month")).toBe(
      "0\n3",
    );
  });

  it("denies browser-role grant, refund, and ledger reads", () => {
    for (const role of ["anon", "authenticated"]) {
      database.expectRefusal(
        `set role ${role};select public.prepay_pub_pal_voice_grant('${OWNER_ID}','2026-09-01','${grantId(1)}')`,
      );
      database.expectRefusal(
        `set role ${role};select public.refund_pub_pal_voice_grant('${OWNER_ID}','${grantId(1)}')`,
      );
      database.expectRefusal(`set role ${role};select * from public.pub_pal_voice_grants`);
    }
  });

  it("removes old client-duration quota RPCs from service role after the upgrade", () => {
    database.expectRefusal(
      `set role service_role;select public.consume_pub_pal_voice_trial('${OWNER_ID}','2026-09-01',10)`,
    );
    database.expectRefusal(
      `set role service_role;select public.release_pub_pal_voice_trial('${OWNER_ID}','2026-09-01')`,
    );
    database.expectRefusal(
      `set role service_role;select public.record_pub_pal_voice_minutes('${OWNER_ID}','2026-09-01',0)`,
    );
  });

  it("links provider conversation and reconciles one callback to the grant month", () => {
    expect(database.sql(grant(grantId(81), "2026-09-01"))).toBe("t");
    expect(database.sql(
      `set role service_role;select public.link_pub_pal_voice_conversation('${grantId(81)}','conv_81')`,
    )).toBe("t");
    const reconcile = `set role service_role;select public.reconcile_pub_pal_voice_conversation('conv_81',1790899200,'done',75)`;
    expect(database.sql(reconcile)).toBe("t");
    expect(database.sql(reconcile)).toBe("t");
    expect(database.sql("select usage_month || ':' || used_minutes from public.pub_pal_voice_usage")).toBe("2026-09-01:2");
    expect(database.sql("select provider_conversation_id || ':' || provider_status || ':' || settled_minutes from public.pub_pal_voice_grants")).toBe("conv_81:done:2");
    expect(database.sql("select count(*) from public.pub_pal_voice_provider_events")).toBe("1");
  });

  it("serializes concurrent replayed callbacks without over-crediting", async () => {
    expect(database.sql(grant(grantId(82), "2026-09-01"))).toBe("t");
    database.sql(`set role service_role;select public.link_pub_pal_voice_conversation('${grantId(82)}','conv_82')`);
    const callback = `set role service_role;select public.reconcile_pub_pal_voice_conversation('conv_82',1790899201,'done',75)`;
    const results = await database.concurrentResults(Array.from({ length: 8 }, () => callback));
    expect(results.every((result) => result.trim() === "t")).toBe(true);
    expect(database.sql("select used_minutes from public.pub_pal_voice_usage")).toBe("2");
    expect(database.sql("select count(*) from public.pub_pal_voice_provider_events")).toBe("1");
  });

  it("keeps already charged allowance through rollback", () => {
    database.sql(grant(grantId(1)));
    database.applyFile(
      join(process.cwd(), "supabase/migrations/rollback", `${MIGRATION}_rollback.sql`),
    );

    expect(database.sql("select used_minutes from public.pub_pal_voice_usage")).toBe(
      String(Math.ceil(PAL_VOICE_MAX_SESSION_SECONDS / 60)),
    );
    expect(database.sql("select to_regclass('public.pub_pal_voice_grants') is null")).toBe("t");
    expect(database.sql("select to_regclass('public.pub_pal_voice_provider_events') is null")).toBe("t");
    expect(database.sql("select has_function_privilege('service_role','public.consume_pub_pal_voice_trial(uuid,date,integer)','execute')")).toBe("t");
    expect(database.sql("select has_function_privilege('service_role','public.release_pub_pal_voice_trial(uuid,date)','execute')")).toBe("t");
    expect(database.sql("select has_function_privilege('service_role','public.record_pub_pal_voice_minutes(uuid,date,integer)','execute')")).toBe("t");
    database.applyFile(join(process.cwd(), "supabase/migrations", `${MIGRATION}.sql`));
  });
});
