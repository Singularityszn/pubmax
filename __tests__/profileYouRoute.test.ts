import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/profile/PubmaxxAccountHub", () => ({
  default: () => createElement("div", null, "account hub"),
}));
vi.mock("@/components/wanted/WantedList", () => ({
  default: () => createElement("div", null, "wanted list"),
}));

import {
  profileSurfaceFor,
  YouSignedOutSurface,
} from "@/app/u/[handle]/ProfilePageClient";

describe("signed-out /u/you surface", () => {
  it("keeps the account invitation ahead of a failed public read", () => {
    const surface = profileSurfaceFor({
      routeHandle: "you",
      identityResolved: true,
      hasUser: false,
      viewerHandle: "",
      state: "error",
    });
    const html = renderToStaticMarkup(
      createElement(YouSignedOutSurface, { nightMemoriesInvite: false }),
    );

    expect(surface).toBe("you-invitation");
    expect(html).toContain("Make the night yours.");
    expect(html).toContain("Claim your @handle");
    expect(html).not.toContain("@you");
    expect(html).not.toContain("Couldn&#x27;t load pints");
    expect(html).not.toContain("profileErrorState");
  });
});
