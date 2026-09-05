import type { CSSProperties, ReactNode } from "react";

import { priceBandClass, type PriceBand } from "@/lib/priceBand";

import styles from "./PriceBadge.module.css";

export type PriceBadgeVariant = "baseline" | "current" | "cheap" | "increase" | "neutral";

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
    "price-plaque",
    "ink-stamp",
    "ink-stamp--tilt",
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
