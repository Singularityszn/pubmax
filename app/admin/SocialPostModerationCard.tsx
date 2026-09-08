"use client";

import Image from "next/image";
import { useState } from "react";
import type { SocialPostAdminHeldItem } from "@/lib/socialPostConsentStore";

import "./socialPostModerationCard.css";

type Decision = "approve" | "hide";
type Props = {
  post: SocialPostAdminHeldItem;
  pendingAction: { postId: string; action: Decision } | null;
  onDecision: (post: SocialPostAdminHeldItem, action: Decision) => void;
};

export function socialPostReviewKey(post: SocialPostAdminHeldItem): string {
  return JSON.stringify([post.postId, post.revision, post.mediaId, post.media, post.photoAltText, post.photos]);
}

function policyLabel(value: string): string {
  const words = value.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export default function SocialPostModerationCard({ post, pendingAction, onDecision }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [previews, setPreviews] = useState<Record<string, "ready" | "failed">>({});
  const video = post.photos === undefined && post.media?.contentType === "video/mp4";
  const media = post.photos ?? (post.mediaId ? [{ mediaId: post.mediaId, altText: post.photoAltText ?? (video ? "Social post video" : "Social post photo") }] : []);
  const keyFor = (mediaId: string) => `${attempt}:${mediaId}`;
  const allReady = media.every(photo => previews[keyFor(photo.mediaId)] === "ready");
  const failed = media.some(photo => previews[keyFor(photo.mediaId)] === "failed");
  const record = (key: string, state: "ready" | "failed") => setPreviews(current => ({ ...current, [key]: state }));
  const approveLabel = pendingAction?.postId === post.postId && pendingAction.action === "approve" ? "Approving…" : "Approve";
  const hideLabel = pendingAction?.postId === post.postId && pendingAction.action === "hide" ? "Hiding…" : "Hide";

  return <article className="admin-card">
    <div className="admin-card-head">
      <span className="admin-handle">@{post.authorHandle}</span>
      <span className="admin-report">Revision {post.revision}</span>
    </div>
    <p className="admin-note">{post.body}</p>
    {media.length > 0 && <>
      <div className="adminSocialPreviews">
        {media.map((photo, index) => {
          const key = keyFor(photo.mediaId);
          const source = `/api/admin/social-posts/media/${encodeURIComponent(photo.mediaId)}?revision=${post.revision}&attempt=${attempt}`;
          return <figure key={key} aria-label={`${video ? "Video" : "Photo"} ${index + 1} of ${media.length}`}>
            {video ? <video src={source} aria-label={photo.altText} controls playsInline preload="auto"
              onLoadedData={() => record(key, "ready")} onError={() => record(key, "failed")} />
              : <Image src={source} alt={photo.altText} width={640} height={480} unoptimized loading="eager"
                onLoad={() => record(key, "ready")} onError={() => record(key, "failed")} />}
            <figcaption>{photo.altText}</figcaption>
          </figure>;
        })}
      </div>
      {failed ? <p role="alert">{video ? "Video preview failed." : "Photo preview failed."} Reload previews before approval.</p>
        : !allReady ? <p role="status">Load every preview before approval.</p> : null}
      {failed && <button type="button" className="admin-retry" disabled={pendingAction !== null}
        onClick={() => { setAttempt(current => current + 1); setPreviews({}); }}>Reload previews</button>}
    </>}
    <div className="admin-meta">
      <span>Area: {post.area ?? "None"}</span>
      <span>Venue: {post.venueId ?? "None"}</span>
      <span>Visibility: {policyLabel(post.visibility)}</span>
      <span>Comments: {policyLabel(post.commentPolicy)}</span>
      <span>State: {policyLabel(post.moderationState)}</span>
    </div>
    <p className="admin-note">Reason: {post.moderationClaim}</p>
    <div className="admin-meta">
      <span>Created: <time dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleString()}</time></span>
      <span>Updated: <time dateTime={post.updatedAt}>{new Date(post.updatedAt).toLocaleString()}</time></span>
    </div>
    <div className="admin-actions">
      <button type="button" className="admin-btn admin-restore" disabled={pendingAction !== null || !allReady}
        onClick={() => { if (allReady) onDecision(post, "approve"); }}>{approveLabel}</button>
      <button type="button" className="admin-btn admin-keep" disabled={pendingAction !== null}
        onClick={() => onDecision(post, "hide")}>{hideLabel}</button>
    </div>
  </article>;
}
