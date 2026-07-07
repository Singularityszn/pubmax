import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SavedPubList from "@/components/profile/SavedPubList";
import type { FollowedSavedListDTO } from "@/lib/savedPubs";

describe("SavedPubList", () => {
  it("renders custom saved-pub groups instead of only the built-in list names", () => {
    const html = renderToStaticMarkup(
      createElement(SavedPubList, {
        ownerHandle: "sam",
        groups: {
          "my locals": [
            {
              venueId: "venue-1",
              venueName: "The Test Arms",
              venueMapUrl: "/map?sel=venue-1",
              listType: "my locals",
              savedAt: "2026-07-07T12:00:00.000Z",
            },
          ],
        },
      }),
    );

    expect(html).toContain("my locals");
    expect(html).toContain('href="/u/sam/lists/my%20locals"');
    expect(html).toContain("The Test Arms");
    expect(html).toContain('href="/map?sel=venue-1"');
  });

  it("surfaces followed authored lists with attribution, links, and counts", () => {
    const followedLists: FollowedSavedListDTO[] = [
      {
        ownerHandle: "sam",
        ownerProfileUrl: "/u/sam",
        listType: "my locals",
        listUrl: "/u/sam/lists/my%20locals",
        savedCount: 3,
        followerCount: 12,
        followedAt: "2026-07-07T12:00:00.000Z",
      },
    ];

    const html = renderToStaticMarkup(
      createElement(SavedPubList, { groups: {}, followedLists }),
    );

    expect(html).toContain("Followed lists");
    expect(html).toContain("my locals");
    expect(html).toContain("By @sam");
    expect(html).toContain("3 pubs");
    expect(html).toContain("12 followers");
    expect(html).toContain('href="/u/sam"');
    expect(html).toContain('href="/u/sam/lists/my%20locals"');
  });
});
