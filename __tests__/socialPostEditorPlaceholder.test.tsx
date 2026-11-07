// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { SocialPostDTO } from "@/lib/socialPosts";

// The composer chunk is held until the test lets it go, so the card is read
// in the state a reader sees while that code is still downloading.
const composerChunk = vi.hoisted(() => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  return { held, release };
});
vi.mock("@/app/social/SocialComposer", async () => {
  await composerChunk.held;
  return {
    default: ({ triggerLabel }: { triggerLabel?: string }) =>
      createElement("button", { type: "button", className: "socialEditButton" }, triggerLabel ?? "Edit post"),
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/social",
  useRouter: () => ({ prefetch: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import { SocialPostCard } from "@/app/social/SocialPageClient";

const ownPost: SocialPostDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "standard",
  visibility: "public",
  body: "My own post",
  area: null,
  venueId: null,
  venueProjected: false,
  hashtags: [],
  commentPolicy: "open",
  nameHidden: false,
  photo: null,
  moderationState: "approved",
  featureRequest: null,
  revision: 0,
  mutationVersion: 0,
  editedAt: null,
  createdAt: "2026-10-30T12:00:00.000Z",
  updatedAt: "2026-10-30T12:00:00.000Z",
  author: { handle: "alice" },
  ownedByViewer: true,
  venueName: null,
};

it("keeps the edit door's own word while the composer code loads", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const buttonNames = () => [...host.querySelectorAll("button")].map((button) => button.textContent);
  try {
    await act(async () => {
      root.render(createElement(SocialPostCard, {
        post: ownPost,
        canEdit: true,
        draftScope: "a".repeat(43),
        onEdited: () => undefined,
      }));
    });
    // The page's primary door is named Post. A wait that borrowed that name
    // put a second filled Post inside the card until the code arrived.
    expect(buttonNames()).not.toContain("Post");
    const waiting = [...host.querySelectorAll("button")].find((button) => button.textContent === "Edit post");
    expect(waiting?.disabled).toBe(true);
    expect(waiting?.className).toBe("socialEditButton");
    expect(waiting?.hasAttribute("data-primary-action")).toBe(false);

    await act(async () => {
      composerChunk.release();
      await composerChunk.held;
    });
    await vi.waitFor(() => {
      const ready = [...host.querySelectorAll("button")].find((button) => button.textContent === "Edit post");
      expect(ready?.disabled).toBe(false);
    });
    expect(buttonNames()).not.toContain("Post");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
