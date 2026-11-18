// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const planSession = vi.hoisted(() => ({
  role: "host" as "host" | "guest" | null,
  restorePlanCapability: vi.fn(),
}));

const state = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  session: {
    access_token: "account-token",
    user: { id: "11111111-1111-4111-8111-111111111111" },
  } as { access_token: string; user: { id: string } } | null,
  identityResolved: true,
  accountBoundFetch: vi.fn(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: state.user,
    session: state.session,
    identityResolved: state.identityResolved,
    loading: false,
    getCurrentUserId: () => state.user?.id ?? null,
  }),
}));
vi.mock("@/lib/accountBoundFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accountBoundFetch")>()),
  accountBoundFetch: state.accountBoundFetch,
}));
vi.mock("@/lib/activePlan", () => ({
  markActivePlan: vi.fn(),
  setActivePlanRole: vi.fn(),
}));
vi.mock("@/lib/authRedirect", () => ({
  subscribeToAuthFragmentRestored: vi.fn(() => () => {}),
}));
vi.mock("@/lib/crewRealtime", () => ({
  subscribeToPlanCrew: vi.fn(() => () => {}),
}));
vi.mock("@/lib/planSessionCapability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/planSessionCapability")>()),
  parsePlanCapabilitySnapshot: () => ({
    token: "",
    collaborationAuthorized: true,
    role: planSession.role,
  }),
  planCapabilityEvent: (id: string) => `pubmax:plan-capability:${id}`,
  readPlanCapabilitySnapshot: () => planSession.role ? `|1|${planSession.role}` : "|0|",
  restorePlanCapability: planSession.restorePlanCapability,
  writePlanCapability: vi.fn(),
}));

import ActivePlanMarker from "@/components/plan/ActivePlanMarker";
import PlanCrew from "@/components/plan/PlanCrew";
import { setProviderIdentity } from "@/lib/authProviderRevision";
import { planAccountClaimEvent } from "@/lib/planSessionCapability";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let rootUnmounted = false;

beforeEach(() => {
  planSession.role = "host";
  planSession.restorePlanCapability.mockReset().mockResolvedValue({ role: "host" });
  state.user = { id: "11111111-1111-4111-8111-111111111111" };
  state.session = {
    access_token: "account-token",
    user: { id: "11111111-1111-4111-8111-111111111111" },
  };
  state.identityResolved = true;
  state.accountBoundFetch.mockReset().mockResolvedValue(
    new Response(JSON.stringify({ claimed: true, role: "host" })),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  rootUnmounted = false;
});

afterEach(async () => {
  if (!rootUnmounted) await act(async () => root.unmount());
  setProviderIdentity("clerk", null);
  setProviderIdentity("supabase", null);
  container.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("active Plan account claim", () => {
  it("claims the restored guest Plan after account identity resolves", async () => {
    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(state.accountBoundFetch).toHaveBeenCalledWith(
      {
        userId: "11111111-1111-4111-8111-111111111111",
        accessToken: "account-token",
      },
      "/api/plans/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/session",
      { method: "PUT", signal: expect.any(AbortSignal) },
    );
  });

  it("aborts an in-flight claim when the provider identity changes", async () => {
    setProviderIdentity("supabase", "account-a");
    let actionSignal: AbortSignal | undefined;
    state.accountBoundFetch.mockImplementationOnce((_auth, _input, init) => {
      actionSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    });

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "12121212-1212-4121-8121-121212121212",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(actionSignal).toBeInstanceOf(AbortSignal);
    setProviderIdentity("supabase", "account-b");
    await act(async () => {
      await Promise.resolve();
    });

    expect(actionSignal?.aborted).toBe(true);
  });

  it("does not claim while signed out", async () => {
    state.user = null;
    state.session = null;

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(state.accountBoundFetch).not.toHaveBeenCalled();
  });

  it("does not wait for canonical profile resolution", async () => {
    state.identityResolved = false;

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(state.accountBoundFetch).toHaveBeenCalledOnce();
  });

  it("restores capability on the auth-ready transition", async () => {
    state.identityResolved = false;
    planSession.role = null;

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "56565656-5656-4565-8565-565656565656",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(planSession.restorePlanCapability).not.toHaveBeenCalled();

    state.identityResolved = true;
    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "56565656-5656-4565-8565-565656565656",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(planSession.restorePlanCapability).toHaveBeenCalledOnce();
  });

  it("restores PlanCrew capability on the auth-ready transition", async () => {
    state.identityResolved = false;
    planSession.role = null;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await act(async () => {
      root.render(createElement(PlanCrew, {
        planId: "67676767-6767-4676-8676-676767676767",
        hostName: "Priya",
      }));
      await Promise.resolve();
    });

    expect(planSession.restorePlanCapability).not.toHaveBeenCalled();

    state.identityResolved = true;
    await act(async () => {
      root.render(createElement(PlanCrew, {
        planId: "67676767-6767-4676-8676-676767676767",
        hostName: "Priya",
      }));
      await Promise.resolve();
    });

    expect(planSession.restorePlanCapability).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });

  it("retries one transient claim failure", async () => {
    vi.useFakeTimers();
    state.accountBoundFetch
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });
    expect(state.accountBoundFetch).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });

    expect(state.accountBoundFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("discards a transient failure body before retrying", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    state.accountBoundFetch
      .mockResolvedValueOnce(new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"error":"busy"}'));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 503 },
      ))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(cancelled).toBe(true);
    vi.useRealTimers();
  });

  it("discards a successful claim body", async () => {
    let cancelled = false;
    state.accountBoundFetch.mockResolvedValueOnce(new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"claimed":true}'));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200 },
    ));

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "abababab-abab-4aba-8aba-abababababab",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(cancelled).toBe(true);
  });

  it("does not schedule a retry after unmount while the first claim is pending", async () => {
    vi.useFakeTimers();
    let resolveClaim: ((response: Response) => void) | undefined;
    state.accountBoundFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      resolveClaim = resolve;
    }));

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });
    expect(state.accountBoundFetch).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    rootUnmounted = true;
    await act(async () => {
      resolveClaim?.(new Response(null, { status: 503 }));
      await Promise.resolve();
    });

    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe("the claim lifecycle across retries, interruptions and resume", () => {
  const USER_A = "11111111-1111-4111-8111-111111111111";
  const USER_B = "22222222-2222-4222-8222-222222222222";
  const PLAN_ID = "13131313-1313-4131-8131-131313131313";
  type Init = { signal?: AbortSignal | null } | undefined;
  const busy = () => Promise.resolve(new Response(null, { status: 503 }));
  const held = (_auth: unknown, _input: unknown, init: Init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener(
      "abort",
      () => reject(new DOMException("The operation was aborted.", "AbortError")),
      { once: true },
    );
  });
  let announced: number;
  let clerkSequence: number;
  const announce = () => { announced += 1; };
  const sent = () => state.accountBoundFetch.mock.calls.length;
  const sentSignal = (index: number) => (state.accountBoundFetch.mock.calls[index]?.[2] as Init)?.signal;
  const sentToken = (index: number) =>
    (state.accountBoundFetch.mock.calls[index]?.[0] as { accessToken: string } | undefined)?.accessToken;
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const mount = async () => {
    await act(async () => {
      root.render(createElement(ActivePlanMarker, { id: PLAN_ID, startTime: "2026-11-14T19:00:00.000Z" }));
    });
    await advance(0);
  };
  const interrupt = async () => {
    clerkSequence += 1;
    await act(async () => { setProviderIdentity("clerk", `clerk-${clerkSequence}`); });
    await advance(0);
  };
  const resume = async () => {
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await advance(150);
  };
  const exhaust = async () => {
    await mount();
    await advance(250);
    await advance(1_000);
    expect(sent()).toBe(3);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    announced = 0;
    clerkSequence = 0;
    setProviderIdentity("supabase", USER_A);
    window.addEventListener(planAccountClaimEvent(PLAN_ID), announce);
  });

  afterEach(() => {
    window.removeEventListener(planAccountClaimEvent(PLAN_ID), announce);
  });

  it.each(["host", "guest"] as const)("sends attempts at 0, 250 and 1,000 ms, then waits for the app to return (%s)", async (role) => {
    planSession.role = role;
    state.accountBoundFetch.mockImplementation(busy);
    await mount();
    expect(sent()).toBe(1);
    await advance(249);
    expect(sent()).toBe(1);
    await advance(1);
    expect(sent()).toBe(2);
    await advance(999);
    expect(sent()).toBe(2);
    await advance(1);
    expect(sent()).toBe(3);
    await advance(60_000);
    expect(sent()).toBe(3);
    await resume();
    expect(sent()).toBe(4);
    expect(announced).toBe(0);
  });

  it.each(["host", "guest"] as const)("ends a stalled claim after eight seconds and retries for the same %s", async (role) => {
    planSession.role = role;
    state.accountBoundFetch.mockImplementationOnce(held).mockResolvedValue(new Response(null, { status: 200 }));
    await mount();
    await advance(7_999);
    expect(sent()).toBe(1);
    expect(sentSignal(0)?.aborted).toBe(false);
    await advance(1);
    expect(sentSignal(0)?.aborted).toBe(true);
    await advance(249);
    expect(sent()).toBe(1);
    await advance(1);
    expect(sent()).toBe(2);
    expect(announced).toBe(1);
    await advance(60_000);
    await resume();
    expect(sent()).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("exhausts three stalled claims and waits for resume before sending another", async () => {
    state.accountBoundFetch.mockImplementation(held);
    await mount();
    await advance(8_000);
    await advance(250);
    await advance(8_000);
    await advance(1_000);
    await advance(8_000);
    expect(sent()).toBe(3);
    for (const attempt of [0, 1, 2]) expect(sentSignal(attempt)?.aborted).toBe(true);
    await advance(60_000);
    expect(sent()).toBe(3);
    state.accountBoundFetch.mockResolvedValue(new Response(null, { status: 200 }));
    await resume();
    expect(sent()).toBe(4);
    expect(announced).toBe(1);
  });

  it("aborts a stalled claim and removes its deadline on unmount", async () => {
    state.accountBoundFetch.mockImplementation(held);
    await mount();
    await act(async () => root.unmount());
    rootUnmounted = true;
    expect(sentSignal(0)?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    await resume();
    expect(sent()).toBe(1);
    expect(announced).toBe(0);
  });

  it("sends nothing for a viewer without a Plan role", async () => {
    planSession.role = null;
    await mount();
    expect(sent()).toBe(0);
  });

  it.each([
    ["429", () => Promise.resolve(new Response(null, { status: 429 }))],
    ["503", busy],
    ["network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("retries a %s and announces the claim that follows once", async (_name, transient) => {
    state.accountBoundFetch
      .mockImplementationOnce(transient)
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await mount();
    expect(sent()).toBe(1);
    await advance(250);
    expect(sent()).toBe(2);
    expect(announced).toBe(1);
    await advance(60_000);
    await resume();
    expect(sent()).toBe(2);
    expect(announced).toBe(1);
  });

  it.each([
    [200, 1],
    [401, 0],
    [403, 0],
    [404, 0],
    [500, 0],
  ])("stops after a definite %i answer and announces %i claims", async (status, claims) => {
    state.accountBoundFetch.mockImplementation(() => Promise.resolve(new Response(null, { status })));
    await mount();
    await advance(60_000);
    await resume();
    expect(sent()).toBe(1);
    expect(announced).toBe(claims);
  });

  it("starts a fresh bounded attempt when the same account is interrupted while waiting", async () => {
    state.accountBoundFetch.mockImplementation(busy);
    await mount();
    expect(sent()).toBe(1);
    await interrupt();
    expect(sent()).toBe(2);
    expect(sentSignal(1)?.aborted).toBe(false);
    await advance(249);
    expect(sent()).toBe(2);
    await advance(1);
    expect(sent()).toBe(3);
    await advance(1_000);
    expect(sent()).toBe(4);
    await advance(60_000);
    expect(sent()).toBe(4);
  });

  it("aborts the attempt in flight and starts a fresh bounded attempt for the same account", async () => {
    state.accountBoundFetch.mockImplementationOnce(held).mockImplementation(busy);
    await mount();
    await interrupt();
    expect(sent()).toBe(2);
    expect(sentSignal(0)?.aborted).toBe(true);
    expect(sentSignal(1)?.aborted).toBe(false);
    await advance(250);
    await advance(1_000);
    await advance(60_000);
    expect(sent()).toBe(4);
    expect(announced).toBe(0);
  });

  it("keeps waiting for the app to return after an interruption that follows exhaustion", async () => {
    state.accountBoundFetch.mockImplementation(busy);
    await exhaust();
    await interrupt();
    await advance(60_000);
    expect(sent()).toBe(3);
    state.accountBoundFetch.mockResolvedValue(new Response(null, { status: 200 }));
    await resume();
    expect(sent()).toBe(4);
    expect(sentSignal(3)?.aborted).toBe(false);
    expect(announced).toBe(1);
  });

  it.each([
    ["another account", USER_B, "waiting"],
    ["another account", USER_B, "exhausted"],
    ["sign-out", null, "waiting"],
    ["sign-out", null, "exhausted"],
  ] as const)("never claims again for the departed account after %s while %s", async (_name, next, phase) => {
    state.accountBoundFetch.mockImplementation(busy);
    if (phase === "exhausted") await exhaust();
    else await mount();
    const before = sent();
    await act(async () => { setProviderIdentity("supabase", next); });
    await advance(60_000);
    await resume();
    expect(sent()).toBe(before);
    expect(announced).toBe(0);
  });

  it("claims only for the new account after an account switch", async () => {
    state.accountBoundFetch.mockImplementationOnce(busy).mockResolvedValue(new Response(null, { status: 200 }));
    await mount();
    await act(async () => { setProviderIdentity("supabase", USER_B); });
    state.user = { id: USER_B };
    state.session = { access_token: "account-b-token", user: { id: USER_B } };
    await mount();
    await advance(60_000);
    await resume();
    expect(sent()).toBe(2);
    expect(sentToken(0)).toBe("account-token");
    expect(sentToken(1)).toBe("account-b-token");
    expect(announced).toBe(1);
  });

  it.each([200, 403])("sends no second claim when the same account is interrupted after a %i answer", async (status) => {
    state.accountBoundFetch.mockImplementation(() => Promise.resolve(new Response(null, { status })));
    await mount();
    const claims = announced;
    await interrupt();
    await advance(60_000);
    await resume();
    expect(sent()).toBe(1);
    expect(announced).toBe(claims);
  });

  it("claims again with a refreshed token and ignores the late answer of the old attempt", async () => {
    let late!: (response: Response) => void;
    state.accountBoundFetch
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { late = resolve; }))
      .mockResolvedValue(new Response(null, { status: 200 }));
    await mount();
    state.session = { access_token: "refreshed-token", user: { id: USER_A } };
    await mount();
    expect(sent()).toBe(2);
    expect(sentToken(1)).toBe("refreshed-token");
    expect(announced).toBe(1);
    await act(async () => { late(new Response(null, { status: 200 })); });
    await advance(60_000);
    expect(sent()).toBe(2);
    expect(announced).toBe(1);
  });

  it("sends and announces nothing after unmount while waiting", async () => {
    state.accountBoundFetch.mockImplementation(busy);
    await mount();
    await act(async () => root.unmount());
    rootUnmounted = true;
    await advance(60_000);
    await resume();
    expect(sent()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("announces nothing when a successful answer lands after unmount", async () => {
    let late!: (response: Response) => void;
    state.accountBoundFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { late = resolve; }));
    await mount();
    await act(async () => root.unmount());
    rootUnmounted = true;
    await act(async () => { late(new Response(null, { status: 200 })); });
    await advance(60_000);
    expect(sent()).toBe(1);
    expect(announced).toBe(0);
  });
});
