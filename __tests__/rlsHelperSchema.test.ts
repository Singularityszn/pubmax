import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * AN RLS HELPER LIVES IN `pubmax_private`, AND A COPY IN `public` IS READ BY
 * NOTHING.
 *
 * 0070 moved every `rls_*` helper out of `public` with `alter function ... set
 * schema pubmax_private`, and every policy written since resolves them there.
 * So a later `create or replace function public.rls_...` does not redefine the
 * helper the policies call: it creates a SECOND function in a schema no policy
 * reads, and the migration then applies cleanly while changing nothing. That
 * is exactly what 0124 did to `rls_is_plan_participant`, and a removed member
 * kept table SELECT on the Plan until 0144 dropped the stray copy and
 * redefined the real one in `pubmax_private`.
 *
 * The failure is silent in both directions, which is why this is a fence and
 * not a review note: the migration succeeds, the catalog gains a function, and
 * the security answer does not move.
 *
 * SCOPE. Forward migrations only. A file under `rollback/` may legitimately
 * recreate the `public` copy, because a rollback restores the catalog the way
 * it was, and 0144's rollback does exactly that.
 *
 * A DROP IS NOT THE TRAP. `drop function if exists public.rls_...` is the
 * remedy 0144 applied, so only a CREATE of one is refused here.
 */

/** The migration that moved the helpers; anything after it is held to the rule. */
const SCHEMA_MOVE_MIGRATION = "_0070_v1_release_security.sql";

/**
 * The one migration that redefined a helper in `public` after the move. It is
 * grandfathered because the file is applied history and cannot be edited; 0144
 * is the fix. This list may only ever SHRINK.
 */
const GRANDFATHERED_PUBLIC_RLS_REDEFINITIONS = [
  "20260830170000_0124_plan_invite_canonical_membership.sql",
] as const;

const CREATES_PUBLIC_RLS_HELPER =
  /create\s+(?:or\s+replace\s+)?function\s+public\.rls_/i;

function migrationFiles(): string[] {
  return readdirSync(join(process.cwd(), "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function schemaMoveTimestamp(files: readonly string[]): string {
  const mover = files.find((name) => name.endsWith(SCHEMA_MOVE_MIGRATION));
  if (!mover) throw new Error(`${SCHEMA_MOVE_MIGRATION} is missing`);
  return mover.slice(0, 14);
}

describe("an RLS helper is redefined where the policies read it", () => {
  it("finds the migration that moved the helpers into pubmax_private", () => {
    const files = migrationFiles();
    const timestamp = schemaMoveTimestamp(files);
    expect(timestamp).toMatch(/^\d{14}$/);
    const mover = readFileSync(
      join(process.cwd(), "supabase/migrations", `${timestamp}${SCHEMA_MOVE_MIGRATION}`),
      "utf8",
    );
    expect(mover).toMatch(/set schema pubmax_private/i);
  });

  it("refuses a public.rls_ definition in any migration after the move", () => {
    const files = migrationFiles();
    const moved = schemaMoveTimestamp(files);
    const grandfathered = new Set<string>(GRANDFATHERED_PUBLIC_RLS_REDEFINITIONS);
    const offenders: string[] = [];

    for (const name of files) {
      if (name.slice(0, 14) <= moved) continue;
      if (grandfathered.has(name)) continue;
      const source = readFileSync(
        join(process.cwd(), "supabase/migrations", name),
        "utf8",
      );
      if (CREATES_PUBLIC_RLS_HELPER.test(source)) offenders.push(name);
    }

    expect(
      offenders,
      "redefine a moved RLS helper in pubmax_private; a public copy is read by no policy",
    ).toEqual([]);
  });

  it("keeps the grandfathered list shrink-only and truthful", () => {
    for (const name of GRANDFATHERED_PUBLIC_RLS_REDEFINITIONS) {
      const source = readFileSync(
        join(process.cwd(), "supabase/migrations", name),
        "utf8",
      );
      expect(
        CREATES_PUBLIC_RLS_HELPER.test(source),
        `${name} no longer defines a public.rls_ helper; drop this row`,
      ).toBe(true);
    }
  });
});
