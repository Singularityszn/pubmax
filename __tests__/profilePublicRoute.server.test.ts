import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetMemoryProfileWithdrawals,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import { publicProfileRouteWithholdsNotFound } from "@/lib/profilePublicRoute.server";

describe("public profile route withholding", () => {
  beforeEach(() => {
    __resetMemoryProfileWithdrawals();
  });

  it("withholds identity-policy blocks such as karansdad", async () => {
    await expect(publicProfileRouteWithholdsNotFound("karansdad")).resolves.toBe(true);
  });

  it("withholds moderation-withdrawn handles", async () => {
    __setMemoryProfileWithdrawn("11111111-1111-4111-8111-111111111111", true, ["karansdad"]);
    await expect(publicProfileRouteWithholdsNotFound("karansdad")).resolves.toBe(true);
  });

  it("allows a normal unused handle", async () => {
    await expect(publicProfileRouteWithholdsNotFound("never_existed_qa9")).resolves.toBe(false);
  });

  it("does not withhold the you sentinel", async () => {
    await expect(publicProfileRouteWithholdsNotFound("you")).resolves.toBe(false);
  });
});
