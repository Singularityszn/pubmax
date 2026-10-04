import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markActivePlan, readActivePlan, setActivePlanStopIndex } from "@/lib/activePlan";
import { PLAN_HTTP_ONLY_SESSION } from "@/lib/planSessionCapability";
import {
  __resetPlanMutationOutboxForTests,
  applyActivePlanFlushRollbacks,
  enqueueNightCrawlAction,
  flushPlanMutationOutbox,
  hasPendingPlanMutation,
  listPlanMutationOutbox,
  PLAN_MUTATION_OUTBOX_KEY,
  subscribePlanMutationOutbox,
} from "@/lib/planMutationOutbox";
import { defined } from "@/__tests__/helpers/defined";

const stop = { venueId: "venue-1", venueName: "The Bull", position: 0 };

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("planMutationOutbox", () => {
  beforeEach(() => {
    const listeners = new Map<string, Set<EventListener>>();
    (globalThis as { window?: unknown }).window = {
      localStorage: memoryStorage(),
      dispatchEvent: (event: Event) => {
        listeners.get(event.type)?.forEach((listener) => listener(event));
        return true;
      },
      addEventListener: (name: string, listener: EventListener) => {
        const set = listeners.get(name) ?? new Set<EventListener>();
        set.add(listener);
        listeners.set(name, set);
      },
      removeEventListener: (name: string, listener: EventListener) => {
        listeners.get(name)?.delete(listener);
      },
    };
    __resetPlanMutationOutboxForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ stops: [stop], plan: {}, crew: [], actions: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
  });

  afterEach(() => {
    __resetPlanMutationOutboxForTests();
    vi.unstubAllGlobals();
    delete (globalThis as { window?: unknown }).window;
  });

  it("enqueues with PLAN_HTTP_ONLY_SESSION and dedupes by scope", async () => {
    const first = await enqueueNightCrawlAction({
      planId: "plan-1",
      type: "arrived",
      stop,
      idempotencyKey: "key-1",
      fingerprint: "fp-1",
      previousCursor: 0,
      optimisticCursor: 1,
    });
    const second = await enqueueNightCrawlAction({
      planId: "plan-1",
      type: "arrived",
      stop,
      idempotencyKey: "key-1",
      fingerprint: "fp-1",
      previousCursor: 0,
      optimisticCursor: 1,
    });
    expect(second.id).toBe(first.id);
    expect(listPlanMutationOutbox("plan-1")).toHaveLength(1);
    expect(first.body.memberToken).toBe(PLAN_HTTP_ONLY_SESSION);
    expect(first.previousCursor).toBe(0);
    expect(hasPendingPlanMutation("plan-1")).toBe(true);
    const raw = window.localStorage.getItem(PLAN_MUTATION_OUTBOX_KEY);
    expect(raw).toContain("plan-1");
  });

  it("flush confirms and removes the entry", async () => {
    await enqueueNightCrawlAction({
      planId: "plan-1",
      type: "arrived",
      stop,
      idempotencyKey: "key-1",
      fingerprint: "fp-1",
      previousCursor: 0,
      optimisticCursor: 1,
    });
    const results = await flushPlanMutationOutbox({ planId: "plan-1" });
    expect(results[0]?.outcome).toBe("confirmed");
    expect(results[0]?.previousCursor).toBe(0);
    expect(listPlanMutationOutbox("plan-1")).toHaveLength(0);
    expect(fetch).toHaveBeenCalledWith(
      "/api/plans/plan-1/actions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "idempotency-key": "key-1" }),
      }),
    );
  });

  it("keeps pending entries on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    await enqueueNightCrawlAction({
      planId: "plan-1",
      type: "skipped",
      stop,
      idempotencyKey: "key-2",
      fingerprint: "fp-2",
      previousCursor: 0,
      optimisticCursor: 1,
    });
    const results = await flushPlanMutationOutbox({ planId: "plan-1" });
    expect(results[0]?.outcome).toBe("offline");
    expect(hasPendingPlanMutation("plan-1")).toBe(true);
  });

  it("marks 409 as conflict without deleting the row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "conflict" }), { status: 409 })),
    );
    await enqueueNightCrawlAction({
      planId: "plan-1",
      type: "arrived",
      stop,
      idempotencyKey: "key-3",
      fingerprint: "fp-3",
      previousCursor: 0,
      optimisticCursor: 1,
    });
    const results = await flushPlanMutationOutbox({ planId: "plan-1" });
    expect(results[0]?.outcome).toBe("conflict");
    expect(listPlanMutationOutbox("plan-1")[0]?.status).toBe("conflict");
  });

  it("one tap sends one POST when notify re-enters flush during markEntry", async () => {
    const unsub = subscribePlanMutationOutbox(() => {
      void flushPlanMutationOutbox();
    });
    try {
      await enqueueNightCrawlAction({
        planId: "plan-1",
        type: "arrived",
        stop,
        idempotencyKey: "key-1",
        fingerprint: "fp-1",
        previousCursor: 0,
        optimisticCursor: 1,
      });
      await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
      await vi.waitFor(() => expect(listPlanMutationOutbox("plan-1")).toHaveLength(0));
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      unsub();
    }
  });

  it("does not microtask re-flush when offline leaves the same row pending", async () => {
    const unsub = subscribePlanMutationOutbox(() => {
      void flushPlanMutationOutbox();
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    try {
      await enqueueNightCrawlAction({
        planId: "plan-1",
        type: "arrived",
        stop,
        idempotencyKey: "key-offline",
        fingerprint: "fp-offline",
        previousCursor: 0,
        optimisticCursor: 1,
      });
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(hasPendingPlanMutation("plan-1")).toBe(true);
    } finally {
      vi.useRealTimers();
      unsub();
    }
  });

  it("drains a tap queued while an earlier flush is in flight", async () => {
    const unsub = subscribePlanMutationOutbox(() => {
      void flushPlanMutationOutbox();
    });
    const stopB = { venueId: "venue-2", venueName: "The Fox", position: 1 };
    const resolvers: Array<(response: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    );
    const ok = () =>
      new Response(JSON.stringify({ stops: [stop, stopB], plan: {}, crew: [], actions: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    try {
      await enqueueNightCrawlAction({
        planId: "plan-1",
        type: "arrived",
        stop,
        idempotencyKey: "key-0",
        fingerprint: "fp-0",
        previousCursor: 0,
        optimisticCursor: 1,
      });
      await vi.waitFor(() => expect(resolvers.length).toBe(1));
      await enqueueNightCrawlAction({
        planId: "plan-1",
        type: "arrived",
        stop: stopB,
        idempotencyKey: "key-1",
        fingerprint: "fp-1",
        previousCursor: 1,
        optimisticCursor: 2,
      });
      resolvers[0]?.(ok());
      await vi.waitFor(() => expect(resolvers.length).toBe(2));
      resolvers[1]?.(ok());
      await vi.waitFor(() => expect(listPlanMutationOutbox("plan-1")).toHaveLength(0));
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      unsub();
    }
  });

  it("drains every plan while concurrent flushes share one run", async () => {
    const stopB = { venueId: "venue-2", venueName: "The Fox", position: 0 };
    const resolvers: Array<(value: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    );
    await enqueueNightCrawlAction({
      planId: "plan-a",
      type: "arrived",
      stop,
      idempotencyKey: "key-a",
      fingerprint: "fp-a",
      previousCursor: 0,
      optimisticCursor: 1,
    });
    await enqueueNightCrawlAction({
      planId: "plan-b",
      type: "arrived",
      stop: stopB,
      idempotencyKey: "key-b",
      fingerprint: "fp-b",
      previousCursor: 0,
      optimisticCursor: 1,
    });

    const flushA = flushPlanMutationOutbox({ planId: "plan-a" });
    const flushB = flushPlanMutationOutbox({ planId: "plan-b" });
    await vi.waitFor(() => expect(resolvers.length).toBe(1));
    // Shared drain walks entries sequentially — unblock plan-a, then plan-b.
    resolvers[0]?.(
      new Response(JSON.stringify({ stops: [stop], plan: {}, crew: [], actions: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await vi.waitFor(() => expect(resolvers.length).toBe(2));
    resolvers[1]?.(
      new Response(JSON.stringify({ stops: [stopB], plan: {}, crew: [], actions: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const [aResults, bResults] = await Promise.all([flushA, flushB]);
    expect(aResults).toHaveLength(1);
    expect(aResults[0]?.planId).toBe("plan-a");
    expect(bResults).toHaveLength(1);
    expect(bResults[0]?.planId).toBe("plan-b");
    expect(listPlanMutationOutbox()).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  describe("active-plan cursor rollback after a replay", () => {
    const PLAN = "11111111-1111-4111-8111-111111111111";
    const stops = [
      { venueId: "venue-1", venueName: "The Bull", position: 0 },
      { venueId: "venue-2", venueName: "The Fox", position: 1 },
    ];

    // Two held taps, arrived at stop 0 then stop 1, each advancing the cursor
    // by one, exactly as NightCrawlMode writes them while offline.
    // With `clampFinal`, the last tap is on the final stop, where the advance
    // clamps and the cursor stays put.
    async function holdBothStops({ clampFinal = false } = {}): Promise<void> {
      markActivePlan(PLAN, new Date().toISOString());
      for (const heldStop of stops) {
        const optimisticCursor = clampFinal
          ? Math.min(heldStop.position + 1, stops.length - 1)
          : heldStop.position + 1;
        await enqueueNightCrawlAction({
          planId: PLAN,
          type: "arrived",
          stop: heldStop,
          idempotencyKey: `key-${heldStop.position}`,
          fingerprint: `fp-${heldStop.position}`,
          previousCursor: heldStop.position,
          optimisticCursor,
        });
        setActivePlanStopIndex(optimisticCursor);
      }
    }

    function answerByStop(statusFor: (position: number) => number): void {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_path: string, init?: RequestInit) => {
          const { stopPosition } = JSON.parse(String(init?.body)) as { stopPosition: number };
          const status = statusFor(stopPosition);
          return new Response(
            JSON.stringify(status < 300 ? { stops, plan: {}, crew: [], actions: [] } : { error: "no" }),
            { status, headers: { "content-type": "application/json" } },
          );
        }),
      );
    }

    it("keeps the cursor past a later stop that went through when an earlier one is refused", async () => {
      await holdBothStops();
      answerByStop((position) => (position === 0 ? 422 : 200));

      const results = await flushPlanMutationOutbox({ planId: PLAN });
      expect(results.map((row) => row.outcome)).toEqual(["rejected", "confirmed"]);

      applyActivePlanFlushRollbacks(results);
      expect(readActivePlan()?.stopIndex).toBe(2);
      // The site-wide host and the plan page both receive the same batch.
      applyActivePlanFlushRollbacks(results);
      expect(readActivePlan()?.stopIndex).toBe(2);
    });

    it("keeps the cursor on a confirmed final stop when an earlier one is refused", async () => {
      await holdBothStops({ clampFinal: true });
      answerByStop((position) => (position === 0 ? 422 : 200));

      const results = await flushPlanMutationOutbox({ planId: PLAN });
      expect(results.map((row) => row.outcome)).toEqual(["rejected", "confirmed"]);

      applyActivePlanFlushRollbacks(results);
      expect(readActivePlan()?.stopIndex).toBe(1);
    });

    it("keeps the cursor on a still-held final stop when an earlier one is refused", async () => {
      await holdBothStops({ clampFinal: true });
      answerByStop((position) => (position === 0 ? 403 : 503));

      const results = await flushPlanMutationOutbox({ planId: PLAN });
      expect(results.map((row) => row.outcome)).toEqual(["forbidden", "offline"]);

      applyActivePlanFlushRollbacks(results);
      expect(readActivePlan()?.stopIndex).toBe(1);
    });

    it("keeps the cursor on a final stop queued after the replay took its snapshot", async () => {
      markActivePlan(PLAN, new Date().toISOString());
      const [firstStop, finalStop] = stops;
      await enqueueNightCrawlAction({
        planId: PLAN,
        type: "arrived",
        stop: defined(firstStop),
        idempotencyKey: "key-0",
        fingerprint: "fp-0",
        previousCursor: 0,
        optimisticCursor: 1,
      });
      setActivePlanStopIndex(1);

      let answer: (response: Response) => void = () => undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise<Response>((resolve) => {
          answer = resolve;
        })),
      );
      const flushing = flushPlanMutationOutbox({ planId: PLAN });
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

      await enqueueNightCrawlAction({
        planId: PLAN,
        type: "arrived",
        stop: defined(finalStop),
        idempotencyKey: "key-1",
        fingerprint: "fp-1",
        previousCursor: 1,
        optimisticCursor: 1,
      });
      answer(new Response(JSON.stringify({ error: "no" }), { status: 422 }));

      const results = await flushing;
      expect(results.map((row) => row.outcome)).toEqual(["rejected"]);

      applyActivePlanFlushRollbacks(results);
      expect(readActivePlan()?.stopIndex).toBe(1);
    });

    it("unwinds two refusals in a row back to the first stop's starting point", async () => {
      await holdBothStops();
      answerByStop(() => 403);

      const results = await flushPlanMutationOutbox({ planId: PLAN });
      expect(results.map((row) => row.outcome)).toEqual(["forbidden", "forbidden"]);

      applyActivePlanFlushRollbacks(results);
      expect(readActivePlan()?.stopIndex).toBe(0);
      applyActivePlanFlushRollbacks(results);
      expect(readActivePlan()?.stopIndex).toBe(0);
    });

    it("rolls back the later stop alone when only it is refused", async () => {
      await holdBothStops();
      answerByStop((position) => (position === 1 ? 409 : 200));

      const results = await flushPlanMutationOutbox({ planId: PLAN });
      expect(results.map((row) => row.outcome)).toEqual(["confirmed", "conflict"]);

      applyActivePlanFlushRollbacks(results);
      expect(readActivePlan()?.stopIndex).toBe(1);
    });

    it("leaves a cursor the drinker has since moved by hand", async () => {
      await holdBothStops();
      answerByStop(() => 422);
      setActivePlanStopIndex(5);

      applyActivePlanFlushRollbacks(await flushPlanMutationOutbox({ planId: PLAN }));
      expect(readActivePlan()?.stopIndex).toBe(5);
    });

    it("never moves another plan's cursor", async () => {
      await holdBothStops();
      answerByStop(() => 422);
      const results = await flushPlanMutationOutbox({ planId: PLAN });
      markActivePlan("22222222-2222-4222-8222-222222222222", new Date().toISOString());
      setActivePlanStopIndex(2);

      applyActivePlanFlushRollbacks(results);
      expect(readActivePlan()?.stopIndex).toBe(2);
    });
  });
});
