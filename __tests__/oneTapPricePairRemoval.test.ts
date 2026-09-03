// #1292: public.create_one_tap_price_pair builds its Pint Drop from whatever
// row the shared newer-wins upsert RETURNS, so a stored newer row makes it
// report a price the drinker never submitted. Migration 0139 withdraws the
// function. It was live in production and called by nothing, and the honest
// two-phase lane in app/api/price-submit/route.ts already writes the drop from
// the request's own figure.
//
// This file is the source-side fence. The effective PostgreSQL proof, which
// reproduces the wrong price on a real server and then proves it gone, is
// __tests__/oneTapPricePairRemovalEffective.test.ts.
//
// The no-caller sweep below is a documented door, not a mute button. Reviving
// the pairing lane for its atomicity is a live option; this test says only that
// reviving it means deleting this fence deliberately, and the fence's own name
// points at the receipt gap that has to close first: the shared upsert must
// report whether it WROTE the request or KEPT an existing row, or the next
// caller is free to make the same assumption this one made.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FORWARD = join(
  ROOT,
  "supabase/migrations/20260903160000_0139_one_tap_price_pair_removal.sql",
);
const ROLLBACK = join(
  ROOT,
  "supabase/migrations/rollback/20260903160000_0139_one_tap_price_pair_removal_rollback.sql",
);
const RECORDED = join(
  ROOT,
  "supabase/migrations/20260831142500_0132_one_tap_price_pair.sql",
);

const SIGNATURE =
  "text, text, integer, text, text, timestamptz, uuid, text, text, text, text, text";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function bodyOf(source: string): string {
  const start = source.indexOf(
    "create or replace function public.create_one_tap_price_pair(",
  );
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start).trim();
}

describe("0139 withdraws the one-tap price pair RPC", () => {
  it("drops exactly the recorded signature and creates nothing", () => {
    const forward = read(FORWARD);

    expect(forward).toContain(
      `drop function if exists public.create_one_tap_price_pair(\n  ${SIGNATURE}\n);`,
    );
    // A migration that dropped and re-created would be a silent repair of a
    // live RPC under a withdrawal name.
    expect(forward).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
  });

  it("restores 0132's exact body and grants on rollback", () => {
    // Byte-for-byte, so a later edit to the withdrawn body cannot ride in on a
    // rollback file and reach production as something 0132 never recorded.
    expect(bodyOf(read(ROLLBACK))).toBe(bodyOf(read(RECORDED)));
  });

  it("keeps the pairing RPC unreachable from application code", () => {
    // git grep exits 1 with no output when nothing matches, so a throw carrying
    // no stdout is the clean answer and any other throw is a real tooling
    // failure that must not read as a pass.
    let hits: string;
    try {
      hits = execFileSync(
        "git",
        [
          "grep",
          "-l",
          "create_one_tap_price_pair",
          "--",
          "app",
          "components",
          "lib",
          "scripts",
        ],
        { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      if (failure.status !== 1) throw error;
      hits = failure.stdout ?? "";
    }

    expect(hits.trim()).toBe("");
  });
});
