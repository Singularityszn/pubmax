import { describe, expect, it, vi } from "vitest";

// Plan completion has both durable and keyless backends. Pin this unit test to
// the keyless seam so Vercel credentials cannot turn it into a live database
// integration test during `npm run ci`.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
  };
});

import { completePlan, getPlanCompletion } from "@/lib/planCompletion";

describe("Plan Completion", () => {
  it("is idempotent for a Plan and does not expose the member capability", async () => {
    const planId = crypto.randomUUID();
    const first = await completePlan({ planId, ending: "get_home", memberToken: "secret-capability" });
    const second = await completePlan({ planId, ending: "keep_going", memberToken: "different-capability" });
    expect(second).toEqual(first);
    expect(first.actorMemberId).toHaveLength(24);
    expect(JSON.stringify(first)).not.toContain("secret-capability");
    expect(await getPlanCompletion(planId)).toEqual(first);
  });
});
