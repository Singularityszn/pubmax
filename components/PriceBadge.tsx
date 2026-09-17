import type { CSSProperties, ReactNode } from "react";

import { priceBandClass, type PriceBand } from "@/lib/priceBand";

import styles from "./PriceBadge.module.css";

type PriceBadgeVariant = "baseline" | "current" | "cheap" | "increase" | "neutral";

type PriceBadgeProps = {
  children?: ReactNode;
  variant?: PriceBadgeVariant;
  /**
   * The price band the figure wears (lib/priceBand.ts): red expensive, yellow
   * average, green cheap. Absent or null, the plaque stays neutral, which is
   * what a non-pint figure and a figure nobody banded look like.
   */
  band?: PriceBand | null;
  /**
   * The band's own sentence (`priceBandNote`), naming the third, the count and
   * WHOSE terciles the figure was cut against. Review finding F-21: the note
   * was written and read by nothing, so a figure banded against another city's
   * numbers had no way to say so.
   */
  title?: string;
  className?: string;
  style?: CSSProperties;
};

export default function PriceBadge({
  children,
  variant = "neutral",
  band = null,
  title,
  className,
  style,
}: PriceBadgeProps) {
  const classes = [
    "priceBadge",
    `priceBadge--${variant}`,
    priceBandClass(band),
    // `.price-plaque` is the whole shape and face. The `.ink-stamp` pair left
    // with the bevel and the tilt (captain 6 Sep 2026): every declaration they
    // added here was already overridden by the plaque, apart from the two
    // inset shadows and the lean, which were the defect.
    "price-plaque",
    styles.badge,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} style={style} title={title}>
      {children}
    </span>
  );
}
