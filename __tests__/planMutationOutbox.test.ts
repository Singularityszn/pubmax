import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLAN_HTTP_ONLY_SESSION } from "@/lib/planSessionCapability";
import {
  __resetPlanMutationOutboxForTests,
  enqueueNightCrawlAction,
  flushPlanMutationOutbox,
  hasPendingPlanMutation,
  listPlanMutationOutbox,
  PLAN_MUTATION_OUTBOX_KEY,
} from "@/lib/planMutationOutbox";

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
    });
    const second = await enqueueNightCrawlAction({
      planId: "plan-1",
      type: "arrived",
      stop,
      idempotencyKey: "key-1",
      fingerprint: "fp-1",
    });
    expect(second.id).toBe(first.id);
    expect(listPlanMutationOutbox("plan-1")).toHaveLength(1);
    expect(first.body.memberToken).toBe(PLAN_HTTP_ONLY_SESSION);
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
    });
    const results = await flushPlanMutationOutbox({ planId: "plan-1" });
    expect(results[0]?.outcome).toBe("confirmed");
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
    });
    const results = await flushPlanMutationOutbox({ planId: "plan-1" });
    expect(results[0]?.outcome).toBe("conflict");
    expect(listPlanMutationOutbox("plan-1")[0]?.status).toBe("conflict");
  });
});
