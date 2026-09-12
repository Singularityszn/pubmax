"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";

import HandleAvatar from "@/components/profile/HandleAvatar";
import SocialPostGallery from "@/components/social/SocialPostGallery";
import SocialVideoViewer, { socialFeedVideos } from "@/components/social/SocialVideoViewer";
import { Button } from "@/components/ui/button";
import { socialPostPhotos } from "@/lib/socialGallery";
import { getNightArea } from "@/lib/nightAreas";
import { relativeTime } from "@/lib/relativeTime";
import type { SocialPostDTO } from "@/lib/socialPosts";
import { venueMapUrl } from "@/lib/venueMapUrl";
import SocialComposer from "./SocialComposer";

const SocialPostActions = dynamic(() => import("@/components/social/SocialPostActions"));

export function SocialPostCard({ post, canEdit = false, canInteract = false, draftScope, onEdited, onOpenVideo }: { post: SocialPostDTO; canEdit?: boolean; canInteract?: boolean; draftScope?: string | null; onEdited?: (post?: SocialPostDTO) => void; onOpenVideo?: () => void }) {
  const photos = socialPostPhotos(post);
  const area = post.area ? getNightArea(post.area) : null;
  const exactVenueId = post.venueProjected ? post.venueId : null;
  const when = relativeTime(post.createdAt);
  return (
    <article className="socialPostCard">
      <header className="socialPostMeta">
        <HandleAvatar
          handle={post.author.handle}
          avatarUrl={post.author.avatarUrl}
          className="socialPostAvatar"
          imageClassName="socialPostAvatar"
          size={32}
        />
        <Link className="socialPostAuthor" href={`/u/${encodeURIComponent(post.author.handle)}`}>
          @{post.author.handle}
        </Link>
        {when ? <time dateTime={post.createdAt}>{when}</time> : null}
      </header>
      {post.kind === "feature_request" ? (
        <p className="socialPostKind">Feature request</p>
      ) : null}
      {photos.length > 0 ? (
        <figure className="socialPostPhoto">
          <SocialPostGallery photos={photos} />
          {post.photos === undefined && post.photo?.tags && post.photo.tags.length > 0 ? (
            <figcaption>{post.photo.tags.map((tag) => `@${tag.handle}`).join(" ")}</figcaption>
          ) : null}
        </figure>
      ) : null}
      {onOpenVideo && photos.length === 1 && photos[0].kind === "video" ? <Button type="button" variant="ghost"
        className="socialVideoViewerTrigger" onClick={onOpenVideo}>Open video viewer</Button> : null}
      {post.body ? <p className="socialPostBody">{post.body}</p> : null}
      {area || exactVenueId ? (
        <p className="socialPostPlace">
          {area ? <span>{area.name}</span> : null}
          {exactVenueId ? (
            <Link prefetch={false} href={venueMapUrl(exactVenueId)}>{post.venueName || "Open venue"}</Link>
          ) : null}
        </p>
      ) : null}
      {post.hashtags.length > 0 ? (
        <p className="socialPostTags">
          {post.hashtags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </p>
      ) : null}
      {post.editedAt ? <p className="socialPostEdited">Edited</p> : null}
      {canInteract ? <SocialPostActions post={post} /> : null}
      {canEdit && draftScope && onEdited ? <SocialComposer key={`${draftScope}:${post.id}`} post={post} draftScope={draftScope} onSaved={onEdited} /> : null}
    </article>
  );
}

export function SocialFeedPosts({ posts, draftScope, onEdited }: {
  posts: SocialPostDTO[];
  draftScope: string | null;
  onEdited: (post?: SocialPostDTO) => void;
}) {
  const [videoPostId, setVideoPostId] = useState<string | null>(null);
  const videos = socialFeedVideos(posts);
  return <div className="socialPostList">
    {videos.length > 0 ? <Button type="button" variant="ghost" className="socialVideoViewerTrigger"
      onClick={() => setVideoPostId(videos[0].postId)}>Watch videos</Button> : null}
    {posts.map(post => <SocialPostCard key={post.id} post={post} canEdit={post.ownedByViewer} canInteract
      draftScope={draftScope} onEdited={onEdited} onOpenVideo={() => setVideoPostId(post.id)} />)}
    {videoPostId ? <SocialVideoViewer videos={videos} initialPostId={videoPostId} onClose={() => setVideoPostId(null)} /> : null}
  </div>;
}

