import type { ReactNode } from "react";

import styles from "./PriceBadge.module.css";

export type PriceBadgeVariant = "baseline" | "current" | "cheap" | "increase" | "neutral";

type PriceBadgeProps = {
  children: ReactNode;
  variant?: PriceBadgeVariant;
  className?: string;
};

const variantClass: Record<PriceBadgeVariant, string> = {
  baseline: styles.baseline,
  current: styles.current,
  cheap: styles.cheap,
  increase: styles.increase,
  neutral: styles.neutral,
};

export default function PriceBadge({
  children,
  variant = "neutral",
  className,
}: PriceBadgeProps) {
  const classes = [
    "priceBadge",
    `priceBadge--${variant}`,
    styles.badge,
    variantClass[variant],
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <span className={classes}>{children}</span>;
}
