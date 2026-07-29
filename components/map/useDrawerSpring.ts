"use client";

import { useEffect, type CSSProperties } from "react";

import { useSpringValue } from "@/lib/useSpringValue";

export function useDrawerSpring(
  open: boolean,
  side: "left" | "right",
  enabled: boolean,
): CSSProperties | undefined {
  const closedPosition = side === "left" ? -100 : 100;
  const { value, running, animateTo, jumpTo } = useSpringValue(
    closedPosition,
    { response: 0.38, dampingRatio: 1 },
  );

  useEffect(() => {
    if (!enabled) {
      jumpTo(open ? 0 : closedPosition);
      return;
    }
    animateTo(open ? 0 : closedPosition, { dampingRatio: 1 });
  }, [animateTo, closedPosition, enabled, jumpTo, open]);

  if (!enabled) return undefined;
  return {
    transform: `translate3d(${value}%, 0, 0)`,
    transition: "none",
    willChange: running ? "transform" : "auto",
  };
}
