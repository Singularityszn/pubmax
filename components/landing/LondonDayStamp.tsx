"use client";

import { useEffect, useState } from "react";

import { londonDayLabel } from "@/lib/londonHour";

// The front door is static for an hour (app/page.tsx). `stamp` is the day at
// that render. The first paint keeps it, so hydration matches, and the effect
// then names London's current day when the hour crossed midnight.
export default function LondonDayStamp({ stamp }: { stamp: string }) {
  const [label, setLabel] = useState(stamp);

  useEffect(() => {
    setLabel(londonDayLabel(new Date()));
  }, []);

  return <span className="lpAnswerTileStamp">{label}</span>;
}
