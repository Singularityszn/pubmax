"use client";

import type { ReactNode } from "react";

import { SHEET_REVEAL_IN_ENABLED_ATTRIBUTE } from "@/lib/springMotion";

import "./sheetStepReveal.css";

/**
 * Wraps sheet step bodies so a step key change plays the shared reveal-in entrance.
 * Reduced motion disables the animation; layout is unchanged (transform-only motion).
 */
export default function SheetStepReveal({
  stepKey,
  children,
  className,
}: {
  stepKey: string;
  children: ReactNode;
  className?: string;
}) {
  const classes = ["sheetStepReveal", className].filter(Boolean).join(" ");
  return (
    <div
      key={stepKey}
      className={classes}
      data-reveal-in={SHEET_REVEAL_IN_ENABLED_ATTRIBUTE}
    >
      {children}
    </div>
  );
}
