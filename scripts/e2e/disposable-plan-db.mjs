/** Private, disposable price-bearing Plan browser fixture. */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startRlsSession } from "../rls/session-harness.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS = join(ROOT, "supabase/migrations");
const V1_RELEASE = "20260806035204_0070_v1_release_security.sql";
const LAST_MIGRATION = "20261001092200_0182_completion_group_active_accounts.sql";

// The Belle Vue occurs on the generated Clapham route for both queries. Each
// observation has an independent, non-null actor for corroboration.
const PLAN_PRICE_FIXTURES = [
  { venueId: "venue-11e0hkh", category: "wine", pence: 675 },
  { venueId: "venue-11e0hkh", category: "cocktail", pence: 895 },
  // Synthetic local fixture values only, corroborated by two distinct actors.
  { venueId: "venue-11e0hkh", category: "whisky", pence: 650 },
  { venueId: "venue-11e0hkh", category: "gin", pence: 625 },
  { venueId: "venue-11e0hkh", category: "vodka", pence: 600 },
  { venueId: "venue-11e0hkh", category: "rum", pence: 575 },
  { venueId: "venue-11e0hkh", category: "shot", pence: 400 },
];

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function assertLoopback(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new Error("Disposable Plan fixture requires loopback PostgREST");
  }
}

export async function startDisposablePlanDb() {
  let session;
  try {
    session = await startRlsSession();
    assertLoopback(session.restBaseUrl);

    const laterMigrations = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql") && name > V1_RELEASE && name <= LAST_MIGRATION)
      .sort();
    if (laterMigrations.at(-1) !== LAST_MIGRATION) {
      throw new Error("Disposable Plan fixture cannot find migration 0182");
    }
    for (const migration of laterMigrations) {
      session.sqlFile(join(MIGRATIONS, migration));
    }
    await session.reloadPostgrestSchema();

    const reportedAt = new Date(Date.now() - 60_000).toISOString();
    const rows = PLAN_PRICE_FIXTURES.flatMap((fixture) =>
      ["actor-one", "actor-two"].map((actor) =>
        `(${[
          fixture.venueId,
          fixture.category,
          fixture.pence,
          `disposable-plan-${actor}`,
          reportedAt,
        ].map(sqlLiteral).join(", ")})`,
      ),
    );
    const seeded = session.sql(`
      insert into public.community_prices
        (venue_id, drink_category, price_pennies, actor, submitted_at)
      values ${rows.join(", ")}
    `);
    if (!seeded.ok) throw new Error(`Disposable Plan seed failed: ${seeded.err}`);

    for (const fixture of PLAN_PRICE_FIXTURES) {
      const query = new URL("/community_prices", session.restBaseUrl);
      query.searchParams.set("select", "venue_id,drink_category,price_pennies,actor,submitted_at");
      query.searchParams.set("venue_id", `eq.${fixture.venueId}`);
      query.searchParams.set("drink_category", `eq.${fixture.category}`);
      const response = await fetch(query, {
        headers: { Authorization: `Bearer ${session.serviceRoleKey}` },
      });
      const rows = response.ok ? await response.json() : null;
      if (!Array.isArray(rows) || rows.length !== 2 ||
        new Set(rows.map((row) => row.actor)).size !== 2 ||
        !rows.every((row) => row.price_pennies === fixture.pence &&
          Date.parse(row.submitted_at) === Date.parse(reportedAt))) {
        throw new Error(`Disposable Plan PostgREST seed check failed for ${fixture.category} (HTTP ${response.status}, rows ${Array.isArray(rows) ? rows.length : "unavailable"})`);
      }
    }

    return {
      restBaseUrl: session.restBaseUrl,
      serviceRoleKey: session.serviceRoleKey,
      sql: session.sql,
      stop: session.stop,
      lastMigration: LAST_MIGRATION,
      fixtures: PLAN_PRICE_FIXTURES.map((fixture) => ({ ...fixture, reportedAt })),
    };
  } catch (error) {
    if (session) await session.stop();
    throw error;
  }
}
