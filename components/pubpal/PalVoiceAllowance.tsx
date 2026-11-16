"use client";

import { useEffect, useState } from "react";
import { authedActionFetch } from "@/lib/authedFetch";

export default function PalVoiceAllowance() {
  const [minutes, setMinutes] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void authedActionFetch("/api/pub-pal/voice-token?allowance=1", { signal: controller.signal }, { requiresIdentity: true })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body: { remainingMinutes?: unknown } | null) => {
        const value = body?.remainingMinutes;
        if (!controller.signal.aborted && typeof value === "number" && Number.isFinite(value) && value >= 0) {
          setMinutes(value);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (minutes === null) return null;
  return <p className="palVoiceHint">{minutes} voice {minutes === 1 ? "minute" : "minutes"} left this month.</p>;
}
