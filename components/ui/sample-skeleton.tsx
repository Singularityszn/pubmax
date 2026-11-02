"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { SampleSkeletonContext } from "./sample-skeleton-context";
import "./sampleSkeleton.css";

/**
 * A loading state drawn from the real card.
 *
 * The caller renders the card it is waiting for, with SAMPLE data, as the
 * children. The stylesheet turns every line of text into a bar and every
 * image, icon and control into a block in its own shape, so the wait has the
 * card's exact size and nothing moves when the answer arrives. Nothing is
 * measured: the card lays itself out.
 *
 * The sample is never read. It is transparent, `inert` (no tap, no focus) and
 * `aria-hidden`, so keep its values neutral all the same: no price, no real
 * name. What a screen reader hears is `label`, in a status line BESIDE the
 * busy region rather than inside it, because `aria-busy` holds back a live
 * region beneath it, and the line fills after mount, because a live region
 * speaks a change and not the text it was born with (the sign-in skeleton
 * found both, __tests__/loginSkeletonAnnouncement.test.ts).
 *
 * The shapes wait 600 ms before they show, the grace the listings wait uses,
 * so a fast read never flashes a skeleton. Under reduced motion they hold
 * still.
 */
export default function SampleSkeleton({
  label,
  className,
  children,
}: {
  /** What the reader is waiting for, in plain words: "Loading your activity". */
  label: string;
  /** The real container's class, so the sample lays out exactly as it will. */
  className?: string;
  /** The real card or cards, rendered with sample data. */
  children: ReactNode;
}) {
  const announcement = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    const node = announcement.current;
    if (node) node.textContent = label;
  }, [label]);

  const classes = ["sampleSkeleton", className].filter(Boolean).join(" ");
  return (
    <>
      <p ref={announcement} className="sr-only" role="status" />
      <div className={classes} aria-busy="true" data-sample-skeleton="">
        <div className="sampleSkeletonSample" inert aria-hidden="true">
          <SampleSkeletonContext value>{children}</SampleSkeletonContext>
        </div>
      </div>
    </>
  );
}
