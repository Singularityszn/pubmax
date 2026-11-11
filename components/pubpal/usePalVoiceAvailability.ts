"use client";

import { useEffect, useState } from "react";

import { discardBody } from "@/lib/responseBody";

// Whether this deployment offers voice: one GET that reads no account. It
// is TRI-STATE: while the answer is still coming a control claims neither,
// because "voice is off" is a statement we must have checked. No SDK here, so
// the map chip can ask without loading the call.
export type PalVoiceAvailability = "asking" | "available" | "unavailable";
const PAL_VOICE_AVAILABILITY_TIMEOUT_MS = 8_000;

/**
 * Read the probe's answer.
 *
 * Anything short of an explicit `available: true` is treated as off. That is
 * the safe half here and only here: the two states differ by which door the
 * Pal offers, and offering the writing door when voice was in fact available
 * costs a tap, while offering a Start button that answers 503 reads as broken.
 */
export function palVoiceAvailabilityFrom(
  ok: boolean,
  body: unknown,
): PalVoiceAvailability {
  if (!ok) return "unavailable";
  const available =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { available?: unknown }).available
      : undefined;
  return available === true ? "available" : "unavailable";
}

export function usePalVoiceAvailability(): PalVoiceAvailability {
  const [state, setState] = useState<PalVoiceAvailability>("asking");
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState("unavailable");
      controller.abort();
    }, PAL_VOICE_AVAILABILITY_TIMEOUT_MS);
    void fetch("/api/pub-pal/voice-token", { signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted) {
          discardBody(response);
          return;
        }
        if (!response.ok) {
          discardBody(response);
          setState("unavailable");
          return;
        }
        const body: unknown = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        setState(palVoiceAvailabilityFrom(true, body));
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("unavailable");
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);
  return state;
}
