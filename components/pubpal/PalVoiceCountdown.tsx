"use client";

import { useEffect, useState } from "react";

/** The seconds a call has left. Mount it only for the call's last stretch. */
export default function PalVoiceCountdown({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(tick);
  }, []);
  const left = Math.max(0, Math.ceil((endsAt - now) / 1_000));
  return (
    <span className="palVoiceCountdown" role="timer" aria-label={`${left} seconds left in this call`}>
      0:{String(left).padStart(2, "0")}
    </span>
  );
}
