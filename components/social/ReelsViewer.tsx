"use client";

import Link from "next/link";
import { Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import ReviewStars from "@/components/social/ReviewStars";
import { profilePath } from "@/lib/appLink";
import type { SocialPostDTO } from "@/lib/socialPosts";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { venueMapUrl } from "@/lib/venueMapUrl";

/**
 * Reels: every video post on the page, full screen, one per swipe. The one in
 * view plays; the rest wait. Sound starts off and one tap turns it on for
 * the whole stack. Escape or the close button hands focus back.
 */
export default function ReelsViewer({
  posts,
  startPostId,
  onClose,
}: {
  posts: SocialPostDTO[];
  startPostId: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [muted, setMuted] = useState(true);
  useDismissOnEscape(true, onClose, dialogRef);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    document.getElementById(`reel-${startPostId}`)?.scrollIntoView({ block: "start" });
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
      opener?.focus?.();
    };
  }, [startPostId]);

  useEffect(() => {
    const container = dialogRef.current;
    if (!container || typeof IntersectionObserver === "undefined") return;
    const videos = [...container.querySelectorAll("video")];
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLVideoElement;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.7) void element.play().catch(() => {});
        else element.pause();
      }
    }, { root: container.querySelector(".reels__track"), threshold: [0, 0.7, 1] });
    for (const element of videos) observer.observe(element);
    return () => observer.disconnect();
  }, [posts]);

  // On the body, so no transformed ancestor in the feed can trap the layer
  // under the page chrome.
  return createPortal(
    <div ref={dialogRef} className="reels" role="dialog" aria-modal="true" aria-label="Reels">
      <div className="reels__chrome">
        <button ref={closeRef} type="button" className="reels__button" onClick={onClose} aria-label="Close reels">
          <X size={22} aria-hidden="true" />
        </button>
        <button type="button" className="reels__button" onClick={() => setMuted((value) => !value)} aria-pressed={!muted} aria-label={muted ? "Sound on" : "Sound off"}>
          {muted ? <VolumeX size={22} aria-hidden="true" /> : <Volume2 size={22} aria-hidden="true" />}
        </button>
      </div>
      <div className="reels__track">
        {posts.map((post) => post.video ? (
          <section key={post.id} id={`reel-${post.id}`} className="reels__slide" aria-label={`Reel by @${post.author.handle}`}>
            <video src={post.video.url} muted={muted} loop playsInline preload="metadata" aria-label={post.body ? `Video: ${post.body}` : "Video"} />
            <div className="reels__caption">
              <Link prefetch={false} href={profilePath(post.author.handle)} className="reels__handle">@{post.author.handle}</Link>
              {post.venueProjected && post.venueId ? (
                <p className="reels__place">
                  <Link prefetch={false} href={venueMapUrl(post.venueId)}>{post.venueName ?? "Open venue"}</Link>
                  {post.review ? <ReviewStars rating={post.review.rating} size={14} /> : null}
                </p>
              ) : null}
              {post.body ? <p className="reels__body">{post.body}</p> : null}
            </div>
          </section>
        ) : null)}
      </div>
    </div>,
    document.body,
  );
}
