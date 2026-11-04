"use client";

import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import HandleAvatar from "@/components/profile/HandleAvatar";
import ReviewStars from "@/components/social/ReviewStars";
import SocialPostActions from "@/components/social/SocialPostActions";
import SocialPostCarousel from "@/components/social/SocialPostCarousel";
import SocialPostVideoPlayer from "@/components/social/SocialPostVideoPlayer";
import { SOCIAL_SIGN_IN_HREF } from "@/components/social/SocialViewerState";
import { profilePath } from "@/lib/appLink";
import { getNightArea } from "@/lib/nightAreas";
import { relativeTime } from "@/lib/relativeTime";
import {
  HIDDEN_NAME_AUTHOR_LABEL,
  HIDDEN_NAME_CONTROL_LINE,
  HIDDEN_NAME_OWN_LINE,
  HIDDEN_NAME_READER_LINE,
} from "@/lib/socialHiddenName";
import { SOCIAL_LONDON_LANE_COPY } from "@/lib/socialLondonLane";
import type { SocialPostDTO } from "@/lib/socialPosts";
import {
  SOCIAL_POST_CONTROL_LINE,
  SOCIAL_POST_ORDER_LINE,
  SOCIAL_POST_REASON_SUMMARY,
  socialPostReason,
  socialPostReasonLine,
  type SocialPostLane,
} from "@/lib/socialPostReason";
import { socialTagHref } from "@/lib/socialShell";
import { venueMapUrl } from "@/lib/venueMapUrl";

// ONE POST CARD, read on /social and on a profile's Posts section. It lives
// here rather than inside the Social page so a profile can show a post without
// loading the whole Social page. Editing is the page's business, so the
// composer rides in through `editor` and this card never imports it.
//
// A HASHTAG IS A WAY IN: each one links to the Across-town lane filtered to it.
//
// A SIGNED-OUT CARD READS AND DOES NOTHING ELSE (the London lane, captain
// decision 7, 1 Nov 2026). Where a reader's cheer and comment row sits it
// prints one quiet way to sign in, and its hashtags are words rather than links,
// because the lane they lead to needs an account.

/**
 * What the card reads. A full `SocialPostDTO` is one; so is a London lane post
 * (`lib/socialLondonLane.ts`), which carries no word about its reader, no pub,
 * no score and no face.
 */
export type SocialPostCardPost = Pick<
  SocialPostDTO,
  "id" | "kind" | "visibility" | "body" | "area" | "hashtags" | "photo" | "nameHidden" | "createdAt" | "editedAt"
> & {
  author: { handle: string | null; avatarUrl?: string };
} & Partial<Pick<
  SocialPostDTO,
  "ownedByViewer" | "venueId" | "venueName" | "venueProjected" | "review" | "video" | "extraPhotos"
>>;

/** The post's media: a carousel, one photo, or a reel, edge to edge. */
function PostMedia({ post, onOpenVideo }: { post: SocialPostCardPost; onOpenVideo?: (postId: string) => void }) {
  return (
    <>
      {post.photo && post.extraPhotos && post.extraPhotos.length > 0 ? (
        <SocialPostCarousel
          caption={post.photo.tags && post.photo.tags.length > 0 ? post.photo.tags.map((tag) => `@${tag.handle}`).join(" ") : undefined}
          photos={[
            { key: post.photo.mediaId, src: `/api/social/media/${post.photo.mediaId}`, altText: post.photo.altText },
            ...post.extraPhotos.map((extra) => ({
              key: extra.mediaId,
              src: extra.url,
              altText: extra.altText,
              held: extra.moderationState !== "approved",
            })),
          ]}
        />
      ) : post.photo ? (
        <figure className="socialPostPhoto">
          {/* eslint-disable-next-line @next/next/no-img-element -- private signed delivery route. */}
          <img
            src={`/api/social/media/${post.photo.mediaId}`}
            alt={post.photo.altText}
            loading="lazy"
            decoding="async"
          />
          {post.photo.tags && post.photo.tags.length > 0 ? (
            <figcaption>{post.photo.tags.map((tag) => `@${tag.handle}`).join(" ")}</figcaption>
          ) : null}
        </figure>
      ) : null}
      {post.video ? (
        <SocialPostVideoPlayer video={post.video} caption={post.body} onOpen={onOpenVideo ? () => onOpenVideo(post.id) : undefined} />
      ) : null}
    </>
  );
}

/**
 * A disclosure, not a control: the lane rule that let this post in, read back
 * by `lib/socialPostReason.ts`. Nothing on the card is ranked.
 */
function PostWhy({ lane, post, areaName }: { lane: SocialPostLane; post: SocialPostCardPost; areaName: string | null }) {
  return (
    <details className="socialPostWhy">
      <summary>{SOCIAL_POST_REASON_SUMMARY}</summary>
      <p>
        {socialPostReasonLine(socialPostReason(lane, { ownedByViewer: post.ownedByViewer === true, visibility: post.visibility }), {
          handle: post.author.handle ?? HIDDEN_NAME_AUTHOR_LABEL,
          visibility: post.visibility,
          areaName,
        })}
      </p>
      <p>{SOCIAL_POST_ORDER_LINE}</p>
      {post.ownedByViewer ? null : <p>{post.author.handle ? SOCIAL_POST_CONTROL_LINE : HIDDEN_NAME_CONTROL_LINE}</p>}
    </details>
  );
}

/** Where a post was: the pub, which opens its page, and the area. */
function PostPlace({ venueId, venueName, areaName }: { venueId: string | null; venueName: string | null; areaName: string | null }) {
  if (!venueName && !areaName) return null;
  return (
    <span className="socialPostMeta__place">
      {venueId && venueName ? <Link prefetch={false} href={`/pubs/${encodeURIComponent(venueId)}` as Route}>{venueName}</Link> : null}
      {venueId && venueName && areaName ? " · " : null}
      {areaName}
    </span>
  );
}

/** Each hashtag is a way into Across town, or a plain word on a signed-out card. */
function PostTags({ hashtags, signedOut }: { hashtags: string[]; signedOut: boolean }) {
  if (hashtags.length === 0) return null;
  return (
    <p className="socialPostTags">
      {hashtags.map((tag) => signedOut
        ? <span key={tag}>#{tag}</span>
        : <Link key={tag} prefetch={false} href={socialTagHref(tag)}>#{tag}</Link>)}
    </p>
  );
}

/** The row under a post: a reader's cheers and comments, or one quiet way to sign in. */
function PostActionRow({ postId, interactive, signedOut }: { postId: string; interactive: boolean; signedOut: boolean }) {
  if (signedOut) {
    return (
      <p className="socialPostSignIn">
        <Link prefetch={false} href={SOCIAL_SIGN_IN_HREF}>{SOCIAL_LONDON_LANE_COPY.signIn}</Link>
      </p>
    );
  }
  return interactive ? <SocialPostActions postId={postId} /> : null;
}

export default function SocialPostCard({ post, lane, editor = null, interactive = false, signedOut = false, onOpenVideo }: { post: SocialPostCardPost; lane?: SocialPostLane; editor?: ReactNode; interactive?: boolean; signedOut?: boolean; onOpenVideo?: (postId: string) => void }) {
  const area = post.area ? getNightArea(post.area) : null;
  const exactVenueId = post.venueProjected ? post.venueId ?? null : null;
  const venueName = exactVenueId ? post.venueName ?? null : null;
  const review = exactVenueId && post.review ? post.review : null;
  const when = relativeTime(post.createdAt);
  return (
    <article className="socialPostCard" data-has-media={post.photo || post.video ? "true" : undefined}>
      <header className="socialPostMeta">
        <HandleAvatar
          handle={post.author.handle ?? HIDDEN_NAME_AUTHOR_LABEL}
          avatarUrl={post.author.avatarUrl}
          className="socialPostAvatar"
          imageClassName="socialPostAvatar"
          size={36}
        />
        <div className="socialPostMeta__who">
          <strong>
            {post.author.handle ? (
              <Link prefetch={false} href={profilePath(post.author.handle)}>
                @{post.author.handle}
              </Link>
            ) : HIDDEN_NAME_AUTHOR_LABEL}
          </strong>
          {post.nameHidden ? (
            <span className="socialPostMeta__hidden">
              {post.ownedByViewer ? HIDDEN_NAME_OWN_LINE : HIDDEN_NAME_READER_LINE}
            </span>
          ) : null}
          <PostPlace venueId={exactVenueId} venueName={venueName} areaName={area?.name ?? null} />
        </div>
        <div className="socialPostMeta__context">
          {when ? <time dateTime={post.createdAt}>{when}</time> : null}
          <span className="socialPostAudience">{post.visibility === "friends" ? "Mutual friends" : post.visibility === "private" ? "Only you" : "Public"}</span>
        </div>
      </header>
      {post.kind === "feature_request" ? (
        <p className="socialPostKind">Feature request</p>
      ) : null}
      <PostMedia post={post} onOpenVideo={onOpenVideo} />
      {review ? (
        <p className="socialPostReview">
          <ReviewStars rating={review.rating} label={`${post.author.handle ? `@${post.author.handle}` : HIDDEN_NAME_AUTHOR_LABEL} scored ${venueName ?? "this pub"} ${review.rating} out of 5`} />
          {venueName ? <span>{venueName}</span> : null}
        </p>
      ) : null}
      {post.body ? <p className="socialPostBody">{post.body}</p> : null}
      {exactVenueId ? (
        <p className="socialPostPlace">
          <Link prefetch={false} href={venueMapUrl(exactVenueId)}>Open venue</Link>
        </p>
      ) : null}
      <PostTags hashtags={post.hashtags} signedOut={signedOut} />
      <PostActionRow postId={post.id} interactive={interactive} signedOut={signedOut} />
      {post.editedAt ? <p className="socialPostEdited">Edited</p> : null}
      {lane ? <PostWhy lane={lane} post={post} areaName={area?.name ?? null} /> : null}
      {editor}
    </article>
  );
}
