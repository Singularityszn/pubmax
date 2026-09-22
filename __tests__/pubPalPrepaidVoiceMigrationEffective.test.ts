import { PAL_VOICE_MAX_SESSION_SECONDS, PAL_VOICE_MONTHLY_MINUTES } from "@/lib/palVoiceMetering";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const MIGRATION = "20260922002000_0157_pub_pal_prepaid_voice_grants";

let database: PostgresSession;

beforeAll(async () => {
  if (postgresSkipReason()) return;
  database = await startPostgres({ label: "voice-grants" });
  database.sql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${OWNER_ID}'),('${OTHER_ID}');
    create table public.pub_pal_voice_usage(
      owner_id uuid references auth.users(id),
      usage_month date,
      session_count integer not null default 0,
      used_minutes integer not null default 0,
      primary key(owner_id,usage_month)
    );
    grant usage on schema public to anon,authenticated,service_role;
  `);
  database.applyFile(join(process.cwd(), "supabase/migrations", `${MIGRATION}.sql`));
}, 180_000);

beforeEach(() => {
  database?.sql("truncate public.pub_pal_voice_grants,public.pub_pal_voice_usage;");
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

  it("keeps already charged allowance through rollback", () => {
    database.sql(grant(grantId(1)));
    database.applyFile(
      join(process.cwd(), "supabase/migrations/rollback", `${MIGRATION}_rollback.sql`),
    );

    expect(database.sql("select used_minutes from public.pub_pal_voice_usage")).toBe(
      String(Math.ceil(PAL_VOICE_MAX_SESSION_SECONDS / 60)),
    );
    expect(database.sql("select to_regclass('public.pub_pal_voice_grants') is null")).toBe("t");
    database.applyFile(join(process.cwd(), "supabase/migrations", `${MIGRATION}.sql`));
  });
});

