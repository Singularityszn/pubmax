import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20260929190000_0168_plan_listed_drink_evidence.sql";
const forward = join(migrations, name);
const rollback = join(
  migrations,
  "rollback/20260929190000_0168_plan_listed_drink_evidence_rollback.sql",
);
const prerequisites = readdirSync(migrations)
  .filter((entry) => entry.endsWith(".sql") && entry < name)
  .sort()
  .map((entry) => join(migrations, entry));
const planId = "10000000-0000-4000-8000-000000000168";
const listed = {
  category: "wine",
  pence: 525,
  serving: "125ml",
  source: "listed",
  sourceUrl: "https://example.org/menu",
  observedAt: "2026-09-29T10:40:17.846Z",
};
const community = {
  category: "wine",
  pence: 550,
  serving: null,
  source: "community",
  reportedAt: "2026-09-25T12:00:00.000Z",
};
let session: PostgresSession | null = null;
function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL session unavailable");
  return session;
}
function save(evidence: unknown): string {
  return `update public.plan_stops set selected_drink_price_evidence = '${JSON.stringify(evidence)}'::jsonb where plan_id = '${planId}' and position = 0`;
}
function saved(): unknown {
  const value = db().sql(
    `select selected_drink_price_evidence::text from public.plan_stops where plan_id = '${planId}' and position = 0`,
  );
  return value ? JSON.parse(value) : null;
}
function communitySaved(): unknown {
  const value = db().sql(
    `select selected_drink_price_evidence::text from public.plan_stops where plan_id = '${planId}' and position = 1`,
  );
  return value ? JSON.parse(value) : null;
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({
    label: "plan-listed-evidence-0168",
    database: "pubmax_plan_listed_evidence",
  });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const path of prerequisites) db().applyFile(path);
    db()
      .sql(`insert into public.plans (id, title, start_time) values ('${planId}', 'Wine night', '2026-09-30T19:00:00Z');
      insert into public.plan_stops (plan_id, venue_id, venue_name, position) values ('${planId}', 'venue-a', 'A', 0);
      insert into public.plan_stops (plan_id, venue_id, venue_name, position, selected_drink_price_evidence)
      values ('${planId}', 'venue-b', 'B', 1, '${JSON.stringify(community)}'::jsonb);`);
  } catch (error) {
    await session.stop();
    session = null;
    throw error;
  }
}, 600_000);
afterAll(async () => {
  await session?.stop();
  session = null;
});

describe.skipIf(skipReason !== null)(
  "0168 listed Plan evidence storage",
  () => {
    it("reproduces listed evidence refusal before migration", () => {
      expect(db().expectRefusal(save(listed))).toContain(
        "plan_stops_selected_drink_price_evidence_check",
      );
      db().sql(save(community));
      expect(saved()).toEqual(community);
    });

    it("round trips listed citation and explicit or unknown serving without widening community", () => {
      db().applyFile(forward);
      for (const evidence of [
        listed,
        { ...listed, serving: null },
        community,
      ]) {
        db().sql(save(evidence));
        expect(saved()).toEqual(evidence);
      }
      expect(
        db().sql(
          "select has_column_privilege('authenticated','public.plan_stops','selected_drink_price_evidence','update')",
        ),
      ).toBe("f");
    });

    it("rejects fabricated fields, unsafe citation, bad date, and source-shape crossing", () => {
      for (const invalid of [
        { ...listed, contributor: "private" },
        { ...listed, sourceUrl: "https://person:secret@example.org/menu" },
        { ...listed, sourceUrl: "javascript:alert(1)" },
        { ...listed, sourceUrl: "https://example.org/" + "x".repeat(2048) },
        { ...listed, observedAt: "2026-09-29" },
        { ...listed, serving: "x".repeat(49) },
        { ...community, sourceUrl: listed.sourceUrl },
        { ...community, serving: "125ml" },
      ]) {
        expect(db().expectRefusal(save(invalid))).toContain(
          "plan_stops_selected_drink_price_evidence_check",
        );
      }
    });

    it("rollback clears only listed evidence and restores community-only constraint", () => {
      db().sql(save(listed));
      db().applyFile(rollback);
      expect(saved()).toBeNull();
      expect(communitySaved()).toEqual(community);
      expect(db().expectRefusal(save(listed))).toContain(
        "plan_stops_selected_drink_price_evidence_check",
      );
      db().sql(save(community));
      expect(saved()).toEqual(community);
    });
  },
);
