"use client";

import { useEffect, useRef, useState } from "react";

import { authedActionFetch } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import type { SocialPostPhoto } from "@/lib/socialPosts";

function Media({ media }: { media: SocialPostPhoto }) {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [nearby, setNearby] = useState(() => typeof IntersectionObserver === "undefined");
  const [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!container.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setNearby(true);
    }, { rootMargin: "400px" });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!nearby) return;
    const controller = new AbortController();
    const requestSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    let localUrl: string | null = null;
    async function resolveMedia() {
      try {
        const path = `/api/social/media/${encodeURIComponent(media.mediaId)}`;
        const response = await authedActionFetch(`${path}?format=json`, {
          signal: requestSignal, cache: "no-store",
        }, { requiresIdentity: true });
        if (!response.ok) { discardBody(response); throw new Error("Media unavailable"); }
        const result: unknown = await response.json();
        if (!result || typeof result !== "object" || !("url" in result) || typeof result.url !== "string") {
          throw new Error("Media unavailable");
        }
        const url = new URL(result.url, window.location.origin);
        if (url.protocol !== "https:" && url.origin !== window.location.origin) throw new Error("Media unavailable");
        let resolved = url.href;
        // The local memory store has no signed object host. Its bytes still
        // use the caller's bearer, then stay in a revocable browser object URL.
        if (url.origin === window.location.origin && url.pathname === path) {
          const bytes = await authedActionFetch(path, { signal: requestSignal, cache: "no-store" }, { requiresIdentity: true });
          if (!bytes.ok) { discardBody(bytes); throw new Error("Media unavailable"); }
          const blob = await bytes.blob();
          if (controller.signal.aborted) return;
          localUrl = URL.createObjectURL(blob);
          resolved = localUrl;
        }
        if (!controller.signal.aborted) setSource(resolved);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void resolveMedia();
    return () => {
      controller.abort();
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [nearby, media.mediaId, attempt]);

  useEffect(() => {
    const player = video.current;
    if (!player) return;
    const pauseHidden = () => { if (document.hidden) player.pause(); };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) player.pause();
    });
    observer?.observe(player);
    document.addEventListener("visibilitychange", pauseHidden);
    return () => {
      player.pause();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", pauseHidden);
    };
  }, [source, failed]);

  return <div ref={container} className="socialMediaFrame">
    {failed ? <div className="socialMediaUnavailable" role="status">
      <p>{media.kind === "video" ? "Video unavailable." : "Photo unavailable."}</p>
      <button type="button" onClick={() => { setFailed(false); setSource(null); setAttempt(value => value + 1); }}>Try again</button>
    </div> : source ? media.kind === "video" ? (
      <video ref={video} src={source} controls playsInline preload="metadata" aria-label={media.altText} onError={() => setFailed(true)} />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element -- authorized private media URL, refreshed on an explicit retry.
      <img src={source} alt={media.altText} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    ) : <div className="socialMediaPlaceholder" role="status" aria-label={media.kind === "video" ? "Loading video" : "Loading photo"} />}
  </div>;
}

export default function SocialPostMedia({ media }: { media: SocialPostPhoto }) {
  return <Media key={media.mediaId} media={media} />;
}
