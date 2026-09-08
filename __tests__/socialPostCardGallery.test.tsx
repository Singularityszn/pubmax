import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SocialPostDTO, SocialPostPhoto } from "@/lib/socialPosts";

vi.mock("next/navigation", () => ({ usePathname: () => "/social", useRouter: () => ({ prefetch: () => {} }), useSearchParams: () => new URLSearchParams() }));
const gallery = vi.hoisted(() => vi.fn());
vi.mock("@/components/social/SocialPostGallery", () => ({
  default: ({ photos }: { photos: readonly SocialPostPhoto[] }) => { gallery(photos); return createElement("div", { "data-gallery": true }); },
}));

import { SocialFeedPosts, SocialPostCard } from "@/app/social/SocialPageClient";

const primary: SocialPostPhoto = { mediaId: "photo-a", altText: "Outside", tags: [{ handle: "bob" }] };
const post: SocialPostDTO = {
  id: "post-a", kind: "standard", body: "Evening", photo: primary, visibility: "friends", commentPolicy: "open",
  area: null, venueId: null, hashtags: [], moderationState: "approved", featureRequest: null,
  revision: 1, mutationVersion: 1, editedAt: null, createdAt: "2026-09-07T20:00:00Z", updatedAt: "2026-09-07T20:00:00Z",
  author: { handle: "alice" }, ownedByViewer: false, venueName: null, venueProjected: false,
};

describe("post card gallery integration", () => {
  it("passes the whole gallery in order without showing legacy primary tags", () => {
    const photos = [primary, { mediaId: "photo-b", altText: "By the river" }];
    const html = renderToStaticMarkup(createElement(SocialPostCard, { post: { ...post, photos } }));
    expect(gallery).toHaveBeenLastCalledWith(photos);
    expect(html).not.toContain("<figcaption>");
  });
  it("retains legacy tags and video metadata", () => {
    const video: SocialPostPhoto = { ...primary, kind: "video", contentType: "video/mp4" };
    const html = renderToStaticMarkup(createElement(SocialPostCard, { post: { ...post, photo: video } }));
    expect(gallery).toHaveBeenLastCalledWith([video]);
    expect(html).toContain("<figcaption>@bob</figcaption>");
  });
  it("does not fall back to a legacy primary for an explicitly empty gallery", () => {
    gallery.mockClear();
    const html = renderToStaticMarkup(createElement(SocialPostCard, { post: { ...post, photos: [] } }));
    expect(gallery).not.toHaveBeenCalled();
    expect(html).not.toContain("<figure");
  });

  it("offers the video viewer only when this feed contains current video posts", () => {
    const video = { ...post, photo: { ...primary, kind: "video" as const, contentType: "video/mp4" as const } };
    const render = (posts: SocialPostDTO[]) => renderToStaticMarkup(createElement(SocialFeedPosts, {
      posts, draftScope: null, onEdited: () => {},
    }));
    const html = render([post, { ...video, id: "video-a" }, { ...video, id: "video-b" }]);
    expect(html.match(/Watch videos/g)).toHaveLength(1);
    expect(html.match(/Open video viewer/g)).toHaveLength(2);
    expect(html).not.toContain("<dialog");
    for (const posts of [[], [post], [{ ...video, photos: [] }]]) {
      expect(render(posts)).not.toContain("Watch videos");
      expect(render(posts)).not.toContain("Open video viewer");
    }
  });
});
