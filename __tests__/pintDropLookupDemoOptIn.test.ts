import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A demo seed resolves by id only where demo content is on (lib/demoContent.ts).
// The permalink /p/<id>, its API and its OG card all read getPintDropById. With
// no database, and when a configured database has no row or errors, that read
// falls back to findPintDropsByIds over the memory store. The fallback used to add every seed whatever the switch
// said, so /p/seed-prospect-1 resolved on a deployment with demo content off.

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, getSupabaseAdmin: () => null };
});

import { getPintDropById } from "@/lib/pintDropLookup";
import { __resetPintDrops, addPintDrop, findPintDropsByIds } from "@/lib/pintDrops";
import { demoPintDrops } from "@/lib/pintDropSeeds";
import type { PintDrop } from "@/lib/pintDrops";
import { defined } from "@/__tests__/helpers/defined";

const SEED = defined(demoPintDrops[0]);
const ORGANIC: PintDrop = { ...SEED, id: "organic-lookup-1", provenance: "contributor" };

beforeEach(() => {
  __resetPintDrops();
  addPintDrop(ORGANIC);
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_DEMO_CONTENT;
});

describe("a demo seed by id follows the demo switch", () => {
  it.each([
    ["unset", undefined],
    ["off", "off"],
  ])("does not resolve a seed when the switch is %s", async (_label, value) => {
    if (value === undefined) delete process.env.NEXT_PUBLIC_DEMO_CONTENT;
    else process.env.NEXT_PUBLIC_DEMO_CONTENT = value;

    expect(await getPintDropById(SEED.id)).toBeNull();
  });

  it("resolves a seed when the switch is on", async () => {
    process.env.NEXT_PUBLIC_DEMO_CONTENT = "on";

    expect((await getPintDropById(SEED.id))?.id).toBe(SEED.id);
  });

  it("still resolves an organic drop with demo content off", async () => {
    expect((await getPintDropById(ORGANIC.id))?.id).toBe(ORGANIC.id);
  });
});

describe("findPintDropsByIds, the one seam every id lookup falls back to", () => {
  // A configured database that has no row, or errors, falls through to this
  // same call, so gating it here closes the permalink, its API and its OG card.
  it("returns a seed only when demo content is on, and organic drops always", () => {
    delete process.env.NEXT_PUBLIC_DEMO_CONTENT;
    expect([...findPintDropsByIds([SEED.id, ORGANIC.id]).keys()]).toEqual([ORGANIC.id]);

    process.env.NEXT_PUBLIC_DEMO_CONTENT = "off";
    expect([...findPintDropsByIds([SEED.id, ORGANIC.id]).keys()]).toEqual([ORGANIC.id]);

    process.env.NEXT_PUBLIC_DEMO_CONTENT = "on";
    expect(new Set(findPintDropsByIds([SEED.id, ORGANIC.id]).keys())).toEqual(
      new Set([SEED.id, ORGANIC.id]),
    );
  });
});
