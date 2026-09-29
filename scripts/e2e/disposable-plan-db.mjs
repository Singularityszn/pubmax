/** Private, disposable Plan database for real listed-price browser journeys. */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startRlsSession } from "../rls/session-harness.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS = join(ROOT, "supabase/migrations");
const V1_RELEASE = "20260806035204_0070_v1_release_security.sql";
const LAST_MIGRATION = "20260929190000_0168_plan_listed_drink_evidence.sql";

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
      throw new Error("Disposable Plan fixture cannot find migration 0168");
    }
    for (const migration of laterMigrations) {
      session.sqlFile(join(MIGRATIONS, migration));
    }
    await session.reloadPostgrestSchema();

    return {
      restBaseUrl: session.restBaseUrl,
      serviceRoleKey: session.serviceRoleKey,
      sql: session.sql,
      stop: session.stop,
    };
  } catch (error) {
    if (session) await session.stop();
    throw error;
  }
}
