// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: {
    accountRevision: 0,
    supabaseAuthState: "unresolved" as string,
    user: null as { id: string } | null,
  },
}));
const authedActionFetch = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    identityResolved: true,
    ...authState.current,
    contributionAuth: authState.current.user ? { userId: authState.current.user.id, accessToken: "token" } : null,
    invalidateContributionAuth: vi.fn(),
  }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch }));
vi.mock("@/lib/wanted", () => ({ isUkBaseVenueId: () => false }));

import { usePresence } from "@/components/map/inspector/usePresence";
import { PRESENCE_TTL_MS } from "@/lib/nightWindows";
import type { Venue } from "@/lib/venues";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const venue = (id: string): Venue =>
  ({ id, name: id, address: "", latitude: 0, longitude: 0 }) as Venue;

function Harness({ selectedVenue }: { selectedVenue: Venue }): React.JSX.Element {
  const { presenceState, markPresenceHere, leavePresenceHere, presenceGateDialog } = usePresence(selectedVenue);
  return (
    <div>
      {presenceGateDialog}
      <output data-testid="presence-state">{presenceState}</output>
      <button type="button" onClick={() => void markPresenceHere()}>
        Check in
      </button>
      <button type="button" data-testid="leave" onClick={() => void leavePresenceHere()}>
        Leave
      </button>
    </div>
  );
}

function response(): Response {
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  authState.current = {
    accountRevision: 0,
    supabaseAuthState: "unresolved",
    user: null,
  };
  authedActionFetch.mockReset();
  window.localStorage.clear();
  window.localStorage.setItem("pubmax_handle", "tester");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(selectedVenue = venue("venue-a")): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, { selectedVenue }));
  });
}

async function clickCheckIn(): Promise<void> {
  await act(async () => {
    (container.querySelector("button") as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function state(): string {
  return container.querySelector("[data-testid='presence-state']")?.textContent ?? "";
}

describe("presence account boundary", () => {
  it.each(["adult_check_required", "adult_check_failed"])("shows the returned presence age gate: %s", async (status) => {
    authState.current = { accountRevision: 1, supabaseAuthState: "authenticated", user: { id: "account-a" } };
    authedActionFetch.mockResolvedValueOnce(Response.json({ code: "ADULT_REQUIRED", status }, { status: 403 }));
    await render();
    await clickCheckIn();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const confirm = Array.from(dialog!.querySelectorAll("button")).find((button) => button.textContent?.includes("18"));
    if (status === "adult_check_failed") {
      expect(confirm).toBeUndefined();
      expect(state()).toBe("idle");
      return;
    }
    expect(confirm).toBeDefined();
    authedActionFetch.mockResolvedValueOnce(response()).mockResolvedValueOnce(response());
    await act(async () => { confirm!.click(); });
    expect(state()).toBe("here");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(authedActionFetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/presence", "/api/identity/adult-assertion", "/api/presence",
    ]);
  });

  it.each([200, 503])("returns to idle only when leaving succeeds (%i)", async (status) => {
    authState.current = { accountRevision: 1, supabaseAuthState: "authenticated", user: { id: "account-a" } };
    authedActionFetch.mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response("{}", { status }));
    await render();
    await clickCheckIn();
    expect(state()).toBe("here");
    await act(async () => {
      (container.querySelector("[data-testid='leave']") as HTMLButtonElement).click();
    });
    expect(authedActionFetch).toHaveBeenLastCalledWith("/api/presence", expect.objectContaining({
      method: "DELETE", body: JSON.stringify({ handle: "tester" }), signal: expect.any(AbortSignal),
    }), { requiresIdentity: true });
    expect(state()).toBe(status === 200 ? "idle" : "here");
  });

  it("restores a live mark after a remount or a pub switch until it is left or expires", async () => {
    authState.current = { accountRevision: 1, supabaseAuthState: "authenticated", user: { id: "account-a" } };
    authedActionFetch.mockResolvedValueOnce(response()).mockResolvedValueOnce(response());
    await render();
    await clickCheckIn();
    expect(state()).toBe("here");
    await render(venue("venue-b"));
    expect(state()).toBe("idle");
    await render(venue("venue-a"));
    expect(state()).toBe("here");
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(state()).toBe("here");

    authState.current = { accountRevision: 2, supabaseAuthState: "authenticated", user: { id: "account-b" } };
    await render();
    expect(state()).toBe("idle");
    authState.current = { accountRevision: 3, supabaseAuthState: "authenticated", user: { id: "account-a" } };
    await render();
    expect(state()).toBe("here");

    await act(async () => {
      (container.querySelector("[data-testid='leave']") as HTMLButtonElement).click();
    });
    expect(state()).toBe("idle");
    await render(venue("venue-b"));
    await render(venue("venue-a"));
    expect(state()).toBe("idle");
  });

  it("does not restore a mark past its two-hour expiry", async () => {
    authState.current = { accountRevision: 1, supabaseAuthState: "authenticated", user: { id: "account-a" } };
    authedActionFetch.mockResolvedValueOnce(response());
    await render();
    await clickCheckIn();
    expect(state()).toBe("here");
    const markedAt = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(markedAt + PRESENCE_TTL_MS + 1);
    try {
      await render(venue("venue-b"));
      await render(venue("venue-a"));
      expect(state()).toBe("idle");
    } finally {
      now.mockRestore();
    }
  });

  it("drops a leave response after the selected venue changes", async () => {
    authState.current = { accountRevision: 1, supabaseAuthState: "authenticated", user: { id: "account-a" } };
    const leaving = deferred<Response>();
    authedActionFetch.mockResolvedValueOnce(response()).mockReturnValueOnce(leaving.promise);
    await render();
    await clickCheckIn();
    await act(async () => {
      (container.querySelector("[data-testid='leave']") as HTMLButtonElement).click();
    });
    expect(state()).toBe("leaving");
    await render(venue("venue-b"));
    await act(async () => {
      leaving.resolve(new Response("{}", { status: 503 }));
      await leaving.promise;
    });
    expect(state()).toBe("idle");
  });

  it.each(["unresolved", "unavailable"] as const)(
    "does not start while Supabase auth is %s",
    async (supabaseAuthState) => {
      authState.current = {
        accountRevision: 0,
        supabaseAuthState,
        user: null,
      };
      await render();
      await clickCheckIn();
      expect(authedActionFetch).not.toHaveBeenCalled();
      expect(state()).toBe("idle");

      authState.current = {
        accountRevision: 1,
        supabaseAuthState: "authenticated",
        user: null,
      };
      await render();
      await clickCheckIn();
      expect(authedActionFetch).not.toHaveBeenCalled();
      expect(state()).toBe("idle");
    },
  );

  it("keeps anonymous presence available after auth settles signed-out", async () => {
    authState.current = {
      accountRevision: 1,
      supabaseAuthState: "signed-out",
      user: null,
    };
    authedActionFetch.mockResolvedValue(response());
    await render();
    await clickCheckIn();
    expect(authedActionFetch).toHaveBeenCalledWith(
      "/api/presence",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "tester", venueId: "venue-a" }),
        signal: expect.any(AbortSignal),
      }),
      { requiresIdentity: true },
    );
    expect(state()).toBe("here");
  });

  it("keeps no-handle guidance available to an anonymous visitor", async () => {
    authState.current = {
      accountRevision: 1,
      supabaseAuthState: "signed-out",
      user: null,
    };
    window.localStorage.removeItem("pubmax_handle");
    await render();
    await clickCheckIn();
    expect(authedActionFetch).not.toHaveBeenCalled();
    expect(state()).toBe("no-handle");
  });

  it("resets confirmed presence when the account changes", async () => {
    authState.current = {
      accountRevision: 1,
      supabaseAuthState: "authenticated",
      user: { id: "account-a" },
    };
    authedActionFetch.mockResolvedValue(response());
    await render();
    await clickCheckIn();
    expect(state()).toBe("here");

    authState.current = {
      accountRevision: 2,
      supabaseAuthState: "authenticated",
      user: { id: "account-b" },
    };
    await render();
    expect(state()).toBe("idle");
  });

  it("drops an in-flight response from the previous account", async () => {
    const accountA = deferred<Response>();
    authedActionFetch.mockReturnValue(accountA.promise);
    authState.current = {
      accountRevision: 1,
      supabaseAuthState: "authenticated",
      user: { id: "account-a" },
    };
    await render();
    await clickCheckIn();
    expect(state()).toBe("sending");

    authState.current = {
      accountRevision: 2,
      supabaseAuthState: "authenticated",
      user: { id: "account-b" },
    };
    await render();
    expect(state()).toBe("idle");

    await act(async () => {
      accountA.resolve(response());
      await accountA.promise;
    });
    expect(state()).toBe("idle");
  });
});
