"use client";

import { useSyncExternalStore } from "react";

import { londonDayLabel } from "@/lib/londonHour";

const noSubscription = () => () => {};

// The front door is static for an hour (app/page.tsx). `stamp` is the day at
// that render. Hydration keeps it, and the browser then names London's current
// day, so a copy held across midnight never shows yesterday.
export default function LondonDayStamp({ stamp }: { stamp: string }) {
  const label = useSyncExternalStore(noSubscription, () => londonDayLabel(Date.now()), () => stamp);
  return <span className="lpAnswerTileStamp">{label}</span>;
}
