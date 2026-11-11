"use client";

import { useEffect, useState } from "react";
import { palVoiceSecondsLeft } from "@/lib/palVoiceCall";

/** The seconds a live call has left, shown only once its last stretch has begun. */
export default function PalVoiceCountdown({ live, endsAt }: { live: boolean; endsAt: number | null }) {
  return live && endsAt !== null ? <Ticker key={endsAt} endsAt={endsAt} /> : null;
}

function Ticker({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(tick);
  }, []);
  const left = palVoiceSecondsLeft(endsAt, now);
  return (
    <span className="palVoiceCountdown" role="timer" aria-label={`${left} seconds left in this call`}>
      0:{String(left).padStart(2, "0")}
    </span>
  );
}
