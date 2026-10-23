"use client";

import { useState } from "react";

import type { TonightListingsStatus } from "@/lib/tonightOutListings";

/**
 * Whether the page's FIRST listings read is still running.
 *
 * A retry puts the listings back to `idle` too, but by then the head already
 * shows whatever the first answer settled on, so only the first read may hold
 * room for the lede. Once the status has left `idle` this stays false.
 */
export function useFirstListingsRead(status: TonightListingsStatus): boolean {
  const [settled, setSettled] = useState(false);
  if (!settled && status !== "idle") setSettled(true);
  return !settled && status === "idle";
}
