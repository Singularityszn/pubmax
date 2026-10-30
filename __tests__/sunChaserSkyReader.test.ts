import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSkyReader } from "@/components/map/sunChaser/skyReader";
import { SKY_READING_MAX_AGE_MS, type SkyReading } from "@/lib/sunChaser";

const NOW = Date.parse("2026-06-20T13:10:00Z");
const minutes = (n: number) => n * 60_000;

function body(condition: string, observedAtMs: number) {
  return { summary: { skyCondition: condition, skyObservedAt: new Date(observedAtMs).toISOString() } };
}

describe("Sun Chaser's weather reading", () => {
  let sky: SkyReading | null;
  const update = (patch: { sky: SkyReading | null }) => {
    sky = patch.sky;
  };
  const timers = {
    now: () => Date.now(),
    setTimer: (run: () => void, ms: number) => setTimeout(run, ms) as unknown as number,
    clearTimer: (id: number) => clearTimeout(id),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    sky = null;
  });
  afterEach(() => vi.useRealTimers());

  it("keeps the network's newer reading when the cached one's timer comes due", () => {
    // The cache answers with a reading that ages out in 10 minutes, then the
    // network answers with one read just now.
    const cachedAt = NOW - SKY_READING_MAX_AGE_MS + minutes(10);
    const reader = createSkyReader({
      ...timers,
      update,
      load: (_url, _signal, onData) => {
        onData(body("Cloudy", cachedAt));
        onData(body("Rain", NOW));
      },
    });
    reader.read(51.5, -0.1);
    expect(sky).toEqual({ condition: "Rain", observedAtMs: NOW });
    vi.advanceTimersByTime(minutes(11));
    expect(sky).toEqual({ condition: "Rain", observedAtMs: NOW });
    vi.advanceTimersByTime(SKY_READING_MAX_AGE_MS);
    expect(sky).toBeNull();
  });

  it("drops an answer that lands after a newer read began", () => {
    const pending: Array<(b: ReturnType<typeof body>) => void> = [];
    const reader = createSkyReader({ ...timers, update, load: (_url, _signal, onData) => pending.push(onData) });
    reader.read(51.5, -0.1);
    reader.read(51.52, -0.12);
    pending[0]?.(body("Rain", NOW));
    expect(sky).toBeNull();
    pending[1]?.(body("Cloudy", NOW));
    expect(sky).toEqual({ condition: "Cloudy", observedAtMs: NOW });
  });

  it("cancels its timer and any late answer when it closes", () => {
    let late: ((b: ReturnType<typeof body>) => void) | null = null;
    let updates = 0;
    const reader = createSkyReader({
      ...timers,
      update: (patch) => {
        updates += 1;
        update(patch);
      },
      load: (_url, _signal, onData) => {
        onData(body("Rain", NOW));
        late = onData;
      },
    });
    reader.read(51.5, -0.1);
    const before = updates;
    reader.close();
    vi.advanceTimersByTime(SKY_READING_MAX_AGE_MS * 2);
    late?.(body("Cloudy", NOW));
    expect(updates).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});
