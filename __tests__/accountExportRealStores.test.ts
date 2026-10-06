import { beforeEach, describe, expect, it, vi } from "vitest";

// F15 of the signed-in QA pass, end to end over the REAL keyless stores rather
// than fakes: an account that filled in its profile, wrote a post and gave a
// crowd reading gets all three back in its own export. The fakes in
// `accountExport.test.ts` pin the shape; this pins that the default seams
// (`storeDeps`) are wired to the stores that actually hold those rows.

vi.mock("server-only", () => ({}));

import { buildAccountExport } from "@/lib/accountExport.server";
import { __resetMemoryOccupancyReports, occupancyStore } from "@/lib/occupancyStore";
import { profileStore } from "@/lib/profileStore";
import { socialPostStore } from "@/lib/socialPostStore";
import { validateSocialPostCreate } from "@/lib/socialPosts";

const USER = "11111111-2222-4333-8444-555555555555";
const HANDLE = "export_probe";

describe("account export over the real keyless stores", () => {
  beforeEach(() => {
    __resetMemoryOccupancyReports();
  });

  it("returns the profile fields, the posts and the crowd reports the account made", async () => {
    const profile = await profileStore().createOwned(HANDLE, USER);
    await profileStore().update(HANDLE, {
      bio: "Cask ale and quiet snugs.",
      homeCity: "London",
      favouriteDrink: "Best bitter",
      interests: "folk sessions",
      workplace: "A bakery in Peckham",
    });
    const fields = validateSocialPostCreate({
      kind: "standard",
      visibility: "friends",
      body: "The back room is calm tonight",
      area: "camden",
      hashtags: [],
      commentPolicy: "open",
    });
    if (!fields.ok) throw new Error(fields.error);
    await socialPostStore().create(
      { accountId: USER, profileId: profile.id, handle: HANDLE },
      fields.value,
    );
    await occupancyStore().report({
      venueId: "venue-1f5ygjb",
      level: "some-seats",
      reporterUserId: USER,
    });

    const file = await buildAccountExport(USER);

    expect(file.profile.status).toBe("complete");
    expect(file.profile.items[0]).toMatchObject({
      bio: "Cask ale and quiet snugs.",
      homeCity: "London",
      favouriteDrink: "Best bitter",
      interests: "folk sessions",
      workplace: "A bakery in Peckham",
    });
    expect(file.socialPosts.items.map((post) => post.body)).toEqual(["The back room is calm tonight"]);
    expect(file.socialPosts.items[0]?.visibility).toBe("friends");
    expect(file.crowdReports.items).toEqual([
      expect.objectContaining({ venueId: "venue-1f5ygjb", level: "some-seats", hidden: false }),
    ]);
  });
});
