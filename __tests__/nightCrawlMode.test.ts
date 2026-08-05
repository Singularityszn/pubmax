import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";

const harness = vi.hoisted(() => ({
  stateCursor: 0,
  stateValues: [] as unknown[],
  stateOverrides: { 4: true, 5: true, 6: true } as Record<number, unknown>,
  activeCursor: 0,
  setActiveCursor: vi.fn(),
  mutationKey: vi.fn(),
  clearMutationKey: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
    useEffect: () => undefined,
    useMemo: <T,>(factory: () => T) => factory(),
    useState: <T,>(initial: T | (() => T)) => {
      const index = harness.stateCursor;
      harness.stateCursor += 1;
      if (!(index in harness.stateValues)) {
        harness.stateValues[index] = index in harness.stateOverrides
          ? harness.stateOverrides[index]
          : typeof initial === "function"
            ? (initial as () => T)()
            : initial;
      }
      const setState = (next: T | ((previous: T) => T)) => {
        const previous = harness.stateValues[index] as T;
        harness.stateValues[index] = typeof next === "function"
          ? (next as (value: T) => T)(previous)
          : next;
      };
      return [harness.stateValues[index] as T, setState];
    },
    useSyncExternalStore: (
      _subscribe: (listener: () => void) => () => void,
      getSnapshot: () => unknown,
    ) => getSnapshot(),
  };
});

vi.mock("@/lib/activePlan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/activePlan")>();
  return {
    ...actual,
    readActivePlan: () => ({
      id: PLAN_ID,
      startTime: "2026-08-05T20:00:00.000Z",
      stopIndex: harness.activeCursor,
    }),
    setActivePlanStopIndex: harness.setActiveCursor,
    subscribeActivePlan: () => () => undefined,
  };
});

vi.mock("@/lib/planMutationKey", () => ({
  persistentPlanMutationKey: harness.mutationKey,
  clearPersistentPlanMutationKey: harness.clearMutationKey,
}));

vi.mock("@/lib/planSessionCapability", () => ({
  parsePlanCapabilitySnapshot: () => ({
    token: "member-token",
    collaborationAuthorized: true,
    role: "host",
  }),
  planCapabilityEvent: () => "plan-capability",
  readPlanCapabilitySnapshot: () => "member-token|1|host",
  restorePlanCapability: vi.fn(),
}));

import NightCrawlMode from "@/components/plan/NightCrawlMode";
import type { PlanState } from "@/lib/plan";

const PLAN: PlanState = {
  plan: {
    id: PLAN_ID,
    title: "Test crawl",
    startTime: "2026-08-05T20:00:00.000Z",
    createdAt: "2026-08-05T18:00:00.000Z",
  },
  stops: [
    { venueId: "venue-0", venueName: "First Arms", position: 0 },
    { venueId: "venue-1", venueName: "Second Arms", position: 1 },
  ],
  crew: [],
  actions: [],
};

function renderMode(): ReactElement | null {
  harness.stateCursor = 0;
  return NightCrawlMode({ planId: PLAN_ID, initialState: PLAN });
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (!isValidElement(node)) return "";
  return textOf((node.props as { children?: ReactNode }).children);
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement) => boolean,
): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (predicate(node)) return node;
  return findElement((node.props as { children?: ReactNode }).children, predicate);
}

beforeEach(() => {
  harness.stateCursor = 0;
  harness.stateValues.length = 0;
  harness.activeCursor = 0;
  harness.setActiveCursor.mockReset();
  harness.setActiveCursor.mockImplementation((index: number) => {
    harness.activeCursor = index;
  });
  harness.mutationKey.mockReset();
  harness.mutationKey.mockResolvedValue("retry-key");
  harness.clearMutationKey.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NightCrawlMode failed action reconciliation", () => {
  it.each([
    ["network failure", () => Promise.reject(new Error("offline"))],
    ["non-2xx response", () => Promise.resolve(new Response("{}", { status: 409 }))],
  ])("restores cursor and live failure state after a %s", async (_name, response) => {
    const fetchMock = vi.fn(response);
    vi.stubGlobal("fetch", fetchMock);
    const firstRender = renderMode();
    const arrive = findElement(
      firstRender,
      (element) => element.type === "button" && textOf(element).includes("We are here"),
    );

    expect(arrive).not.toBeNull();
    (arrive?.props as { onClick: () => void }).onClick();

    await vi.waitFor(() => {
      expect(harness.setActiveCursor.mock.calls).toEqual([[1], [0]]);
    });
    expect(harness.mutationKey).toHaveBeenCalledWith(
      `night-crawl-action:${PLAN_ID}:arrived:0`,
      { type: "arrived", stopPosition: 0 },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/plans/${PLAN_ID}/actions`,
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
          "idempotency-key": "retry-key",
        },
      }),
    );
    expect(harness.clearMutationKey).not.toHaveBeenCalled();

    const settledRender = renderMode();
    expect(textOf(settledRender)).toContain("Stop 1 of 2");
    expect(textOf(settledRender)).toContain("First Arms");
    const status = findElement(
      settledRender,
      (element) => (element.props as { role?: string }).role === "status",
    );
    expect(status).not.toBeNull();
    expect(status?.props).toMatchObject({ "aria-live": "polite" });
    expect(textOf(status)).toBe("That did not save. Try again when you have signal.");
  });
});
