import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchFollowedListsForHandle } from "@/lib/savedPubs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchFollowedListsForHandle", () => {
  it("normalizes followed-list author handles and regenerates canonical links", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        followedLists: [
          {
            ownerHandle: "@@Sam Pub!",
            ownerProfileUrl: "/u/@@Sam%20Pub!",
            listType: "Date Night",
            listUrl: "/u/@@Sam%20Pub!/lists/Date%20Night",
            savedCount: 2,
            followerCount: 5,
            followedAt: "2026-07-07T12:00:00.000Z",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchFollowedListsForHandle("@Ken")).resolves.toEqual([
      {
        ownerHandle: "sampub",
        ownerProfileUrl: "/u/sampub",
        listType: "Date Night",
        listUrl: "/u/sampub/lists/Date%20Night",
        savedCount: 2,
        followerCount: 5,
        followedAt: "2026-07-07T12:00:00.000Z",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/saved-pubs/list-follows?follower=%40Ken",
      { signal: undefined },
    );
  });
});
