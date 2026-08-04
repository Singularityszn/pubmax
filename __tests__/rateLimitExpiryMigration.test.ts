import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../supabase/migrations/20260804120000_0065_rate_limit_expiry.sql",
  import.meta.url,
);

describe("durable rate-limit expiry migration", () => {
  it("removes expired rows from both durable limiter write paths", () => {
    expect(existsSync(migrationUrl)).toBe(true);
    if (!existsSync(migrationUrl)) return;

    const sql = readFileSync(migrationUrl, "utf8");
    expect(sql).toMatch(
      /add column if not exists expires_at timestamptz[\s\S]*alter column expires_at set not null/i,
    );
    expect(sql).toMatch(
      /delete from public\.rate_limits[\s\S]*where expires_at <= now\(\)/i,
    );
    expect(sql.match(/perform public\.prune_expired_rate_limits\(\)/gi)).toHaveLength(2);
    expect(sql.match(/expires_at = now\(\) \+ make_interval\(secs => p_window_ms \/ 1000\.0\)/gi)).toHaveLength(2);
  });
});
