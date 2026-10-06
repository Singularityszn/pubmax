// `public.record_pub_pal_voice_minutes`, proved on a cluster holding every
// migration.
//
// Pub Pal voice is paid for by the minute, so this is a meter. When a voice
// session ends, `app/api/pub-pal/voice-token/route.ts` hands the service-role
// RPC the caller's id, the usage month and the seconds spoken. The RPC must
// bill exactly what `billableVoiceMinutes` bills in TypeScript, add to the
// session's own row only (never create one, never touch another account or
// month), lose no minute when releases land at once, and refuse every browser
// role, because a client that could call it could rewind or burn anybody's
// allowance.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { billableVoiceMinutes } from "@/lib/palVoiceMetering";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startMigratedPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const NO_SESSION = "c0000000-0000-4000-8000-000000000003";
const MONTH = "2026-10-01";
const LAST_MONTH = "2026-09-01";

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL voice meter session did not start.");
  return session;
}

function record(ownerId: string, month: string, seconds: number | null): string {
  return `select public.record_pub_pal_voice_minutes('${ownerId}', date '${month}', ${seconds ?? "null"})`;
}

function usedMinutes(ownerId: string, month: string): number {
  return Number(
    db().sql(`
      select used_minutes from public.pub_pal_voice_usage
      where owner_id = '${ownerId}' and usage_month = date '${month}'
    `),
  );
}

function resetMinutes(ownerId: string, month: string): void {
  db().sql(`
    update public.pub_pal_voice_usage set used_minutes = 0
    where owner_id = '${ownerId}' and usage_month = date '${month}'
  `);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({
    label: "voice-minutes",
    database: "pubmax_voice_minutes",
  });
  db().sql(`
    insert into auth.users (id) values ('${ALICE}'), ('${BOB}'), ('${NO_SESSION}');
    insert into public.pub_pal_voice_usage (owner_id, usage_month, session_count, used_minutes) values
      ('${ALICE}', date '${MONTH}', 1, 0),
      ('${ALICE}', date '${LAST_MONTH}', 1, 7),
      ('${BOB}', date '${MONTH}', 1, 4);
  `);
}, 180_000);

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("record_pub_pal_voice_minutes", () => {
  it("bills what billableVoiceMinutes bills, second for second", () => {
    for (const seconds of [-30, 0, 1, 59, 60, 61, 119, 120, 121, 599, 3_600]) {
      resetMinutes(ALICE, MONTH);
      expect(db().sql(asServiceRole(record(ALICE, MONTH, seconds)))).toBe("t");
      expect(usedMinutes(ALICE, MONTH), `${seconds}s`).toBe(billableVoiceMinutes(seconds));
    }
  });

  it("bills nothing for a null duration", () => {
    resetMinutes(ALICE, MONTH);
    expect(db().sql(asServiceRole(record(ALICE, MONTH, null)))).toBe("t");
    expect(usedMinutes(ALICE, MONTH)).toBe(0);
  });

  it("answers false and creates no row for an owner with no reserved session", () => {
    expect(db().sql(asServiceRole(record(NO_SESSION, MONTH, 300)))).toBe("f");
    expect(db().sql(asServiceRole(record(ALICE, "2026-11-01", 300)))).toBe("f");
    expect(
      db().sql(`
        select count(*) from public.pub_pal_voice_usage
        where owner_id = '${NO_SESSION}' or usage_month = date '2026-11-01'
      `),
    ).toBe("0");
  });

  it("moves only the named owner's named month", () => {
    resetMinutes(ALICE, MONTH);
    expect(db().sql(asServiceRole(record(ALICE, MONTH, 180)))).toBe("t");
    expect(usedMinutes(ALICE, MONTH)).toBe(3);
    expect(usedMinutes(ALICE, LAST_MONTH)).toBe(7);
    expect(usedMinutes(BOB, MONTH)).toBe(4);
  });

  it("loses no minute when releases land at once", async () => {
    resetMinutes(ALICE, MONTH);
    await db().concurrent(Array.from({ length: 10 }, () => asServiceRole(record(ALICE, MONTH, 61))));
    expect(usedMinutes(ALICE, MONTH)).toBe(10 * billableVoiceMinutes(61));
  });

  it("refuses anon and a signed-in account, for its own meter or anybody else's", async () => {
    const aliceBefore = usedMinutes(ALICE, MONTH);
    for (const [role, sub, owner, seconds] of [
      ["anon", null, ALICE, 600],
      ["authenticated", ALICE, ALICE, -600],
      ["authenticated", ALICE, BOB, 600],
    ] as const) {
      const answer = await db().attempt(asBrowserRole(role, sub, record(owner, MONTH, seconds)));
      expect(answer.ok, `${role} must not move a voice meter`).toBe(false);
      expect(answer.said).toMatch(/permission denied for function record_pub_pal_voice_minutes/);
    }
    expect(usedMinutes(ALICE, MONTH)).toBe(aliceBefore);
    expect(usedMinutes(BOB, MONTH)).toBe(4);
  });

  it("lets a signed-in account read its own meter but not edit it or read another's", async () => {
    const own = await db().attempt(
      asBrowserRole("authenticated", ALICE, `select used_minutes from public.pub_pal_voice_usage`),
    );
    expect(own.ok, own.said).toBe(true);
    expect(
      db().sql(
        asBrowserRole(
          "authenticated",
          ALICE,
          `select string_agg(owner_id::text, ',') from public.pub_pal_voice_usage`,
        ),
      ),
    ).toBe(ALICE + "," + ALICE);

    const edit = await db().attempt(
      asBrowserRole("authenticated", ALICE, `update public.pub_pal_voice_usage set used_minutes = 0`),
    );
    expect(edit.ok).toBe(false);
    expect(edit.said).toMatch(/permission denied for table pub_pal_voice_usage/);

    const anon = await db().attempt(
      asBrowserRole("anon", null, `select count(*) from public.pub_pal_voice_usage`),
    );
    expect(anon.ok).toBe(false);
    expect(anon.said).toMatch(/permission denied for table pub_pal_voice_usage/);
  });
});
