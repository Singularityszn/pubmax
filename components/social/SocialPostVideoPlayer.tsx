"use client";

import { Play } from "lucide-react";
import { useEffect, useRef } from "react";

import { formatSocialVideoDuration, type SocialPostVideo } from "@/lib/socialPostVideos";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * A reel in the feed: muted, looping, playing while most of it is on screen,
 * the way a photo app's feed does. With reduced motion it waits for a tap.
 * Tapping it opens the full-screen viewer.
 */
export default function SocialPostVideoPlayer({
  video,
  caption,
  onOpen,
}: {
  video: SocialPostVideo;
  caption: string;
  onOpen?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || prefersReducedMotion() || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && entry.intersectionRatio >= 0.6) void element.play().catch(() => {});
      else element.pause();
    }, { threshold: [0, 0.6, 1] });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const held = video.reviewState !== "approved";
  return (
    <figure className="socialPostVideo">
      <video
        ref={ref}
        src={video.url}
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={caption ? `Video: ${caption}` : "Video"}
      />
      {onOpen ? (
        <button type="button" className="socialPostVideo__open" onClick={onOpen} aria-label="Watch full screen">
          <Play size={18} aria-hidden="true" />
          {video.durationSeconds !== null ? <span>{formatSocialVideoDuration(video.durationSeconds)}</span> : null}
        </button>
      ) : null}
      {held ? (
        <figcaption className="socialPostVideo__held">
          {video.reviewState === "rejected"
            ? "This video was not approved. Only you can see it."
            : "Only you can see this video until we have watched it."}
        </figcaption>
      ) : null}
    </figure>
  );
}
