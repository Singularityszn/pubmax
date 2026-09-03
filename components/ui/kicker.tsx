import type { ReactNode } from "react";

import "./kicker.css";

/**
 * The small line above a heading.
 *
 * PUBMAXX keeps its kickers: they name the surface or the city before the
 * heading makes its claim ("Tonight in London", then "What's on."). One
 * primitive means one size, one weight and one colour for all of them, where
 * today twenty files each restate an eyebrow of their own.
 *
 * Sentence case, never uppercase: docs/DESIGN_SYSTEM.md "Caps policy" reserves
 * capitals for stamps, and a kicker is prose. A brand word such as PUBMAXX
 * keeps its own capitals because the word is spelt that way, not because the
 * style shouts.
 *
 * No "//" prefix, no dot, no rule beside it. The decoration read as a code
 * comment and is on the template-pattern ban list (docs/VOICE.md).
 */
export type KickerTone = "accent" | "muted";

export default function Kicker({
  children,
  tone = "accent",
  as: Tag = "p",
  id,
  className,
}: {
  children: ReactNode;
  /** Accent (coral) by default; muted for a dense list where coral would shout. */
  tone?: KickerTone;
  as?: "p" | "span" | "div";
  id?: string;
  className?: string;
}) {
  const classes = ["kicker", tone === "muted" ? "kickerMuted" : null, className]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={classes} id={id}>
      {children}
    </Tag>
  );
}
