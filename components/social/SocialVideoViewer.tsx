"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import SocialPostMedia from "@/components/social/SocialPostMedia";
import { Button } from "@/components/ui/button";
import SurfaceNav from "@/components/ui/surface-nav";
import { socialPostPhotos } from "@/lib/socialGallery";
import type { SocialPostDTO, SocialPostPhoto } from "@/lib/socialPosts";

import "./SocialVideoViewer.css";

export type SocialFeedVideo = {
  postId: string;
  revision: number;
  authorHandle: string;
  body: string;
  media: SocialPostPhoto;
};

export function socialFeedVideos(posts: readonly SocialPostDTO[]): SocialFeedVideo[] {
  return posts.flatMap(post => {
    const media = socialPostPhotos(post);
    return media.length === 1 && media[0].kind === "video" ? [{
      postId: post.id, revision: post.revision, authorHandle: post.author.handle,
      body: post.body, media: media[0],
    }] : [];
  });
}

type Props = { videos: readonly SocialFeedVideo[]; initialPostId: string; onClose: () => void };

function Viewer({ videos, initialPostId, onClose }: Props) {
  const titleId = useId();
  const trackId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState(() => Math.max(0, videos.findIndex(video => video.postId === initialPostId)));
  const current = useRef(active);
  const height = useRef(0);
  const selected = videos[active];

  useEffect(() => {
    const element = dialog.current;
    const scroller = track.current;
    if (!element || !scroller) return;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.querySelectorAll("video").forEach(video => video.pause());
    element.showModal();
    document.body.style.overflow = "hidden";
    close.current?.focus({ preventScroll: true });
    const align = () => {
      height.current = scroller.clientHeight;
      scroller.scrollTo({ top: current.current * scroller.clientHeight, behavior: "instant" });
    };
    align();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(align);
    observer?.observe(scroller);
    window.addEventListener("resize", align);
    return () => {
      element.querySelectorAll("video").forEach(video => video.pause());
      observer?.disconnect();
      window.removeEventListener("resize", align);
      element.close();
      document.body.style.overflow = previousOverflow;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  function activate(index: number) {
    const next = Math.max(0, Math.min(videos.length - 1, index));
    if (next === current.current) return;
    const scroller = track.current;
    scroller?.querySelectorAll("video").forEach(video => video.pause());
    if (scroller?.contains(document.activeElement)) scroller.focus({ preventScroll: true });
    current.current = next;
    setActive(next);
  }

  function select(index: number) {
    const scroller = track.current;
    if (!scroller || scroller.clientHeight <= 0) return;
    activate(index);
    height.current = scroller.clientHeight;
    scroller.scrollTo({ top: current.current * scroller.clientHeight, behavior: "instant" });
  }

  function onScroll() {
    const scroller = track.current;
    if (!scroller || scroller.clientHeight <= 0) return;
    if (height.current !== scroller.clientHeight) {
      height.current = scroller.clientHeight;
      scroller.scrollTo({ top: current.current * scroller.clientHeight, behavior: "instant" });
      return;
    }
    activate(Math.round(scroller.scrollTop / scroller.clientHeight));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // Native playback keeps its own seek, volume and fullscreen keys.
    if (event.target instanceof Element && event.target.closest("video, input, textarea, select, a")) return;
    const destinations: Record<string, number> = {
      ArrowUp: current.current - 1, ArrowDown: current.current + 1, Home: 0, End: videos.length - 1,
    };
    if (!Object.hasOwn(destinations, event.key)) return;
    event.preventDefault();
    select(destinations[event.key]);
  }

  return <dialog ref={dialog} className="socialVideoViewer" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={onKeyDown}>
    <header className="socialVideoViewer__header">
      <h2 id={titleId}>Feed videos</h2>
      <SurfaceNav backLabel={null} homeLabel="Close video viewer" onHome={onClose} closeRef={close} />
    </header>
    <div ref={track} id={trackId} className="socialVideoViewer__track" tabIndex={0} role="group"
      aria-label="Videos" aria-roledescription="carousel" aria-keyshortcuts="ArrowUp ArrowDown Home End" onScroll={onScroll}>
      {videos.map((video, index) => <div key={video.postId} className="socialVideoViewer__slide" role="group"
        aria-roledescription="slide" aria-label={`Video ${index + 1} of ${videos.length}`}
        aria-hidden={index !== active} inert={index !== active}>
        {index === active ? <SocialPostMedia media={video.media} /> : null}
      </div>)}
    </div>
    <footer className="socialVideoViewer__footer">
      <div className="socialVideoViewer__caption">
        <Link href={`/u/${encodeURIComponent(selected.authorHandle)}`} onClick={onClose}>@{selected.authorHandle}</Link>
        {selected.body ? <p>{selected.body}</p> : null}
      </div>
      <div className="socialVideoViewer__controls">
        <Button type="button" variant="ghost" aria-label="Previous video" aria-controls={trackId}
          disabled={active === 0} onClick={() => select(current.current - 1)}><ChevronUp size={20} aria-hidden="true" />Previous</Button>
        <span role="status" aria-live="polite" aria-atomic="true">Video {active + 1} / {videos.length}</span>
        <Button type="button" variant="ghost" aria-label="Next video" aria-controls={trackId}
          disabled={active === videos.length - 1} onClick={() => select(current.current + 1)}>Next<ChevronDown size={20} aria-hidden="true" /></Button>
      </div>
    </footer>
  </dialog>;
}

export default function SocialVideoViewer(props: Props) {
  if (!props.videos.some(video => video.postId === props.initialPostId)) return null;
  const key = JSON.stringify(props.videos.map(video => [video.postId, video.revision, video.media.mediaId]));
  return <Viewer key={key} {...props} />;
}
