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
  useAuth: () => authState.current,
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch }));
vi.mock("@/lib/wanted", () => ({ isUkBaseVenueId: () => false }));

import { usePresence } from "@/components/map/inspector/usePresence";
import type { Venue } from "@/lib/venues";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const venue = (id: string): Venue =>
  ({ id, name: id, address: "", latitude: 0, longitude: 0 }) as Venue;

function Harness({ selectedVenue }: { selectedVenue: Venue }): React.JSX.Element {
  const { presenceState, markPresenceHere } = usePresence(selectedVenue);
  return (
    <div>
      <output data-testid="presence-state">{presenceState}</output>
      <button type="button" onClick={() => void markPresenceHere()}>
        Check in
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
  it("does not start while Supabase auth is unresolved or identity is missing", async () => {
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
  });

  it("keeps anonymous presence available after auth settles signed-out", async () => {
    authState.current = {
      accountRevision: 1,
      supabaseAuthState: "signed-out",
      user: null,
    };
    authedActionFetch.mockResolvedValue(response());
    await render();
    await clickCheckIn();
    expect(authedActionFetch).toHaveBeenCalledWith("/api/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: "tester", venueId: "venue-a" }),
    });
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
