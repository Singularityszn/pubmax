import type { ReactNode } from "react";

import "./emptyState.css";

/**
 * An empty list that points forward.
 *
 * Three parts and no more: what this place is (the title), one line on how it
 * fills, and at most one way onward. The way onward is quiet on purpose. A
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
  className,
}: {
  title: string;
  /** One line. Omit rather than repeat the title. */
  children?: ReactNode;
  /** One link or button, or nothing. */
  action?: ReactNode;
  className?: string;
}) {
  const classes = ["emptyState", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <p className="emptyStateTitle">{title}</p>
      {children ? <p className="emptyStateLine">{children}</p> : null}
      {action ? <div className="emptyStateAction">{action}</div> : null}
    </div>
  );
}
