"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import SocialPostMedia from "@/components/social/SocialPostMedia";
import type { SocialPostPhoto } from "@/lib/socialPosts";

import "./SocialPostGallery.css";

export type SocialPostGalleryProps = { photos: readonly SocialPostPhoto[] };

function Gallery({ photos }: SocialPostGalleryProps) {
  const trackId = useId();
  const track = useRef<HTMLDivElement>(null);
  const current = useRef(0);
  const width = useRef(0);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    width.current = element.clientWidth;
    const align = () => {
      if (element.clientWidth > 0) {
        width.current = element.clientWidth;
        element.scrollTo({ left: current.current * element.clientWidth, behavior: "instant" });
      }
    };
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(align);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", align);
    return () => window.removeEventListener("resize", align);
  }, []);

  function select(index: number) {
    const element = track.current;
    if (!element || element.clientWidth <= 0) return;
    const next = Math.max(0, Math.min(photos.length - 1, index));
    width.current = element.clientWidth;
    current.current = next;
    setActive(next);
    element.scrollTo({ left: next * element.clientWidth, behavior: "instant" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const destinations: Record<string, number> = {
      ArrowLeft: current.current - 1,
      ArrowRight: current.current + 1,
      Home: 0,
      End: photos.length - 1,
    };
    if (!Object.hasOwn(destinations, event.key)) return;
    event.preventDefault();
    select(destinations[event.key]);
  }

  function onScroll() {
    const element = track.current;
    if (!element || element.clientWidth <= 0) return;
    if (width.current !== element.clientWidth) {
      width.current = element.clientWidth;
      element.scrollTo({ left: current.current * element.clientWidth, behavior: "instant" });
      return;
    }
    const next = Math.max(0, Math.min(photos.length - 1, Math.round(element.scrollLeft / element.clientWidth)));
    if (current.current === next) return;
    current.current = next;
    setActive(next);
  }

  return <div className="socialPostGallery" role="group" aria-roledescription="carousel" aria-label="Post photos">
    <div id={trackId} ref={track} className="socialPostGallery__track" dir="ltr" tabIndex={0}
      role="group" aria-label="Photos" aria-keyshortcuts="ArrowLeft ArrowRight Home End"
      onKeyDown={onKeyDown} onScroll={onScroll}>
      {photos.map((photo, index) => <div key={`${photo.mediaId}:${index}`} className="socialPostGallery__slide"
        role="group" aria-roledescription="slide" aria-label={`Photo ${index + 1} of ${photos.length}`}
        aria-hidden={index !== active} inert={index !== active}>
        {Math.abs(index - active) <= 1 ? <SocialPostMedia media={photo} /> : <div className="socialPostGallery__placeholder" />}
      </div>)}
    </div>
    <div className="socialPostGallery__controls">
      <Button type="button" variant="ghost" size="icon" aria-label="Previous photo" aria-controls={trackId}
        disabled={active === 0} onClick={() => select(current.current - 1)}>
        <ChevronLeft size={20} aria-hidden="true" />
      </Button>
      <span className="socialPostGallery__position" role="status" aria-live="polite" aria-atomic="true">
        <span className="socialPostGallery__srOnly">Photo </span>{active + 1} / {photos.length}
      </span>
      <Button type="button" variant="ghost" size="icon" aria-label="Next photo" aria-controls={trackId}
        disabled={active === photos.length - 1} onClick={() => select(current.current + 1)}>
        <ChevronRight size={20} aria-hidden="true" />
      </Button>
    </div>
  </div>;
}

export function SocialPostGallery({ photos }: SocialPostGalleryProps) {
  if (photos.length === 0) return null;
  if (photos.length === 1) return <SocialPostMedia media={photos[0]} />;
  return <Gallery key={JSON.stringify(photos.map(photo => photo.mediaId))} photos={photos} />;
}

export default SocialPostGallery;
