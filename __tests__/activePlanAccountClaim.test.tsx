// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/planSessionCapability", () => ({
  parsePlanCapabilitySnapshot: () => ({
    token: "",
    collaborationAuthorized: true,
    role: "host",
  }),
  planCapabilityEvent: (id: string) => `pubmax:plan-capability:${id}`,
  readPlanCapabilitySnapshot: () => "|1|host",
  restorePlanCapability: vi.fn().mockResolvedValue({ role: "host" }),
}));

import ActivePlanMarker from "@/components/plan/ActivePlanMarker";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  state.user = { id: "11111111-1111-4111-8111-111111111111" };
  state.session = {
    access_token: "account-token",
    user: { id: "11111111-1111-4111-8111-111111111111" },
  };
  state.identityResolved = true;
  state.accountBoundFetch.mockResolvedValue(
    new Response(JSON.stringify({ claimed: true, role: "host" })),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
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
      { method: "PUT" },
    );
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
});
