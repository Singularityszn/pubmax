import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetMemoryProfileWithdrawals,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import { publicProfileRouteWithholdsNotFound } from "@/lib/profilePublicRoute.server";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";

describe("public profile route withholding", () => {
  beforeEach(() => {
    __resetMemoryProfiles();
    __resetMemoryProfileWithdrawals();
  });

  it("withholds identity-policy blocks such as karansdad", () => {
    expect(publicProfileRouteWithholdsNotFound("karansdad")).toBe(true);
  });

  it("does not withhold a moderation-withdrawn handle", () => {
    const withdrawn = __seedMemoryOwnedProfile("suspendedbob", "user-suspended");
    __setMemoryProfileWithdrawn(withdrawn.id, true);
    expect(publicProfileRouteWithholdsNotFound("suspendedbob")).toBe(false);
  });

  it("allows a founder contributor handle with a live profile", () => {
    expect(publicProfileRouteWithholdsNotFound("karan")).toBe(false);
  });

  it("allows a normal unused handle", () => {
    expect(publicProfileRouteWithholdsNotFound("never_existed_qa9")).toBe(false);
  });

  it("does not withhold the you sentinel", () => {
    expect(publicProfileRouteWithholdsNotFound("you")).toBe(false);
  });
});
