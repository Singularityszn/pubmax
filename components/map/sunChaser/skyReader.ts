// Sun Chaser's weather reading, kept apart from the map layer so its timing
// can be tested. One reading lives at a time: each answer, from the cache or
// from the network, replaces the one before and its expiry timer with it, and
// closing the reader cancels both.

import { SKY_READING_MAX_AGE_MS, type SkyReading } from "@/lib/sunChaser";

type ConditionsBody = { summary?: { skyCondition?: unknown; skyObservedAt?: unknown } | null };

export type SkyReaderDeps = {
  /** Calls `onData` once per answer: possibly a cached one first, then the network's. */
  load: (url: string, signal: AbortSignal, onData: (body: ConditionsBody) => void) => void;
  update: (patch: { sky: SkyReading | null; skyFetchedAtMs?: number }) => void;
  now: () => number;
  setTimer: (run: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
};

function readSkyFromBody(body: ConditionsBody): SkyReading | null {
  const condition = body.summary?.skyCondition;
  const observed = body.summary?.skyObservedAt;
  const observedAtMs = typeof observed === "string" ? Date.parse(observed) : Number.NaN;
  return typeof condition === "string" && Number.isFinite(observedAtMs) ? { condition, observedAtMs } : null;
}

export function createSkyReader(deps: SkyReaderDeps) {
  let controller: AbortController | null = null;
  let expiry: number | null = null;
  const clearExpiry = () => {
    if (expiry !== null) deps.clearTimer(expiry);
    expiry = null;
  };
  return {
    read(lat: number, lng: number) {
      controller?.abort();
      clearExpiry();
      const current = new AbortController();
      controller = current;
      // Until an answer lands, no cloud claim at all.
      deps.update({ sky: null });
      const query = new URLSearchParams({ lat: lat.toFixed(3), lng: lng.toFixed(3) });
      deps.load(`/api/tonight-conditions?${query.toString()}`, current.signal, (body) => {
        if (current.signal.aborted) return;
        // A later answer replaces an earlier one, and so does its timer.
        clearExpiry();
        const fetchedAtMs = deps.now();
        const sky = readSkyFromBody(body);
        deps.update({ sky, skyFetchedAtMs: fetchedAtMs });
        if (!sky) return;
        const ageOut = sky.observedAtMs + SKY_READING_MAX_AGE_MS - fetchedAtMs;
        if (ageOut > 0) {
          expiry = deps.setTimer(() => {
            expiry = null;
            deps.update({ sky: null });
          }, ageOut);
        }
      });
    },
    close() {
      controller?.abort();
      controller = null;
      clearExpiry();
    },
  };
}
