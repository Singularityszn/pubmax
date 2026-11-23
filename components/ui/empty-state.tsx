import type { ReactNode } from "react";

import PixelMascot from "@/components/brand/PixelMascot";
import type { MascotPose } from "@/lib/pixelMascot";

/**
 * An empty list that points forward.
 *
 * Three parts and no more: what this place is (the title), one line on how it
 * fills, and at most one way onward. A list that is empty because nobody has
 * used it yet may add one of the Regulars above the title; an error, a refusal
 * or a sign-in gate never does. The way onward is quiet on purpose. A
 * Screen already owns the one filled primary action, and a second filled
 * button in the middle of the page would make two.
 *
 * Voice: this is one of the places docs/VOICE.md lets a dry line live, so the
 * caller writes the words. Never "No results", never "check back later".
 */
export default function EmptyState({
  title,
  children,
  action,
  mascot,
  pageHeading = false,
  className,
}: {
  title: string;
  /** One line. Omit rather than repeat the title. */
  children?: ReactNode;
  /** One link or button, or nothing. */
  action?: ReactNode;
  /** A pose from lib/pixelMascot.ts, for a list nobody has filled yet. */
  mascot?: MascotPose;
  /**
   * True when this empty state is all the page shows, such as a not-found
   * route. The title is then the page's `h1`, so the page has a heading.
   */
  pageHeading?: boolean;
  className?: string;
}) {
  const classes = ["emptyState", className].filter(Boolean).join(" ");
  const Title = pageHeading ? "h1" : "p";
  return (
    <div className={classes}>
      {mascot ? <PixelMascot pose={mascot} flush /> : null}
      <Title className="emptyStateTitle">{title}</Title>
      {children ? <p className="emptyStateLine">{children}</p> : null}
      {action ? <div className="emptyStateAction">{action}</div> : null}
    </div>
  );
}
