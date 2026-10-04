"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/authContext";
import ProfileCoverImage from "@/components/profile/ProfileCoverImage";
import {
  coverCarouselRotates,
  nextCoverIndex,
  PROFILE_COVER_ROTATION_MS,
} from "@/lib/profileCovers";
import { profileImageOutputBox } from "@/lib/profileImageSlots";

// The banner band behind a name: one cover, or up to five taking turns.
//
// THREE things this component is careful about.
//
// 1. IT STARTS STILL. `reducedMotion` begins true, because a server render
//    cannot ask the reader's setting and a page that starts moving and then
//    stops is worse than one that starts still and then moves. The first paint
//    is therefore cover #1 alone, on every reader's machine, and the rotation
//    only begins once the browser has answered.
//
// 2. REDUCED MOTION MEANS NO ROTATION AT ALL. Not a slower one, not a fade
//    without a timer: the first cover, static, and the other four are never
//    even fetched. `coverCarouselRotates` is the one predicate that decides it.
//
// 3. A REFUSED, BROKEN OR EXHAUSTED IMAGE LEAVES THIS READER'S ROTATION.
//    Temporary storage or network failures get bounded retries first. A new
//    reader or session starts with no exclusions. The brass band remains
//    underneath even when no cover can be shown.
//
// Tapping does nothing: this is a backdrop, not a gallery. It is `aria-hidden`
// through its parent for the same reason the single cover always was.

const BOX = profileImageOutputBox("cover");

const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia?.(REDUCE);
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function reducedMotionSnapshot(): boolean {
  return window.matchMedia?.(REDUCE).matches ?? false;
}

/** A server render cannot ask, so it answers "still" and the page starts still. */
function reducedMotionServerSnapshot(): boolean {
  return true;
}

export default function ProfileCoverCarousel({
  covers,
}: {
  covers: readonly string[];
}) {
  const { accountRevision, providerAuthState, session, user } = useAuth();
  const readerKey = `${accountRevision}:${user?.id ?? ""}:${providerAuthState}`;
  const [failedState, setFailed] = useState<{ readerKey: string; session: typeof session; urls: string[] }>({ readerKey, session, urls: [] });
  const failed = failedState.readerKey === readerKey && failedState.session === session ? failedState.urls : [];
  const [active, setActive] = useState(0);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    reducedMotionSnapshot,
    reducedMotionServerSnapshot,
  );

  const usable = covers.filter((url) => url && !failed.includes(url));
  const rotates = coverCarouselRotates({ count: usable.length, reducedMotion });

  useEffect(() => {
    if (!rotates) return;
    const timer = window.setInterval(() => {
      setActive((current) => nextCoverIndex(current, usable.length));
    }, PROFILE_COVER_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [rotates, usable.length]);

  if (usable.length === 0) return null;

  // Only what is actually in the rotation is rendered, so a reader who asked
  // for less motion never downloads the four photos they will not be shown.
  const frames = rotates ? usable : usable.slice(0, 1);
  const shown = frames.length > 0 ? active % frames.length : 0;

  return (
    <div className="profileCoverFrames" data-cover-count={frames.length}>
      {frames.map((url, index) => (
        <ProfileCoverImage
          key={url}
          className={`profileCoverImage${index === shown ? " profileCoverImageActive" : ""}`}
          src={url}
          alt=""
          width={BOX.width}
          height={BOX.height}
          priority={index === 0}
          onError={() => setFailed((prev) => {
            const urls = prev.readerKey === readerKey && prev.session === session ? prev.urls : [];
            return { readerKey, session, urls: urls.includes(url) ? urls : [...urls, url] };
          })}
        />
      ))}
    </div>
  );
}
