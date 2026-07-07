import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("ratings migration RLS posture", () => {
  it("keeps raw rating rows API-only, not public-readable", () => {
    const sql = readFileSync("supabase/migrations/0020_ratings.sql", "utf8");

    expect(sql).toMatch(/alter table public\.drink_ratings enable row level security;/);
    expect(sql).toMatch(/alter table public\.venue_ratings enable row level security;/);
    expect(sql).toMatch(/drop policy if exists drink_ratings_public_read/);
    expect(sql).toMatch(/drop policy if exists venue_ratings_public_read/);
    expect(sql).not.toMatch(/create policy drink_ratings_public_read/);
    expect(sql).not.toMatch(/create policy venue_ratings_public_read/);
  });
});
