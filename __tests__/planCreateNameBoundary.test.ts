import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import { POST as CREATE } from "@/app/api/plans/route";
import { CREW_NAME_MAX } from "@/lib/crew";
import { __resetMemoryPlans } from "@/lib/planStore";
import type { PlanState } from "@/lib/plan";

const URL = "http://localhost/api/plans";

// Battle-test defect D03: `POST /api/plans` answered 503 PLAN_CREATE_UNAVAILABLE
// for a 39-letter name ending in one emoji. `cleanText` capped by UTF-16 code
// unit, so the cut landed inside the surrogate pair and the stored name ended in
// a lone `\ud83c`, which is not valid UTF-8 and which Postgres refuses. The
// route owes a 400 or a trimmed name, never a retryable 503.
//
// `plan_crew_members.name` carries `check (char_length(name) between 1 and 40)`
// and Postgres `char_length` counts CODE POINTS, so a name this route accepts is
// only really accepted when it is well formed AND inside 40 code points. Both are
// asserted here, because the keyless memory store cannot raise the check itself.

const BEER = "\u{1F37A}";
const UK_FLAG = "\u{1F1EC}\u{1F1E7}";
const ZWJ = "\u200D";
const FAMILY = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`;
const COMBINING_ACUTE = "\u0301";

function codePoints(value: string): number {
  return [...value].length;
}

/** TextEncoder turns an unpaired surrogate into U+FFFD, so the round trip fails. */
function isWellFormedUtf8(value: string): boolean {
  return new TextDecoder().decode(new TextEncoder().encode(value)) === value;
}

async function createWithName(creatorName: string): Promise<{
  status: number;
  code?: string;
  crewName?: string;
}> {
  const response = await CREATE(new Request(URL, {
    method: "POST",
    headers: { "idempotency-key": `plan-name-boundary-${crypto.randomUUID()}` },
    body: JSON.stringify({
      title: "Friday near Bank",
      startTime: "2026-07-11T17:30:00.000Z",
      creatorName,
      stops: [
        { venueId: "venue-xjf3n0", venueName: "Fabricated client name" },
        { venueId: "venue-16pnwmm", venueName: "Another fabricated name" },
      ],
    }),
  }));
  const body = await response.json() as { plan?: PlanState; code?: string };
  return {
    status: response.status,
    ...(body.code ? { code: body.code } : {}),
    ...(body.plan ? { crewName: body.plan.crew[0]?.name } : {}),
  };
}

beforeEach(() => {
  __resetMemoryPlans();
});

describe("POST /api/plans creator name at the cap boundary", () => {
  const NAMES: Array<[label: string, name: string]> = [
    ["39 letters and one emoji", `${"a".repeat(39)}${BEER}`],
    ["39 letters and one flag", `${"a".repeat(39)}${UK_FLAG}`],
    ["39 letters and one ZWJ family", `${"a".repeat(39)}${FAMILY}`],
    ["39 letters, a letter and a combining mark", `${"a".repeat(39)}e${COMBINING_ACUTE}`],
    ["an all-emoji name well past the cap", BEER.repeat(60)],
    ["a name of flags well past the cap", UK_FLAG.repeat(60)],
  ];

  it.each(NAMES)("stores %s without a 503", async (_label, name) => {
    const result = await createWithName(name);
    expect(result.status).toBe(201);
    expect(result.code).toBeUndefined();
    expect(result.crewName).toBeDefined();
    expect(isWellFormedUtf8(result.crewName as string)).toBe(true);
    expect(codePoints(result.crewName as string)).toBeLessThanOrEqual(CREW_NAME_MAX);
    expect(codePoints(result.crewName as string)).toBeGreaterThan(0);
  });

  it("keeps the whole emoji when the name is exactly the cap", async () => {
    const name = `${"a".repeat(39)}${BEER}`;
    const result = await createWithName(name);
    expect(result.crewName).toBe(name);
  });

  it("refuses a name that cleans away to nothing with 400, never 503", async () => {
    const result = await createWithName("   ");
    expect(result.status).toBe(400);
    expect(result.code).toBe("PLAN_CREATE_INVALID");
  });

  it("leaves an ordinary name untouched", async () => {
    const result = await createWithName("Karan");
    expect(result.status).toBe(201);
    expect(result.crewName).toBe("Karan");
  });
});
