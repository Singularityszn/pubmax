// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: {
    accountRevision: 0,
    identityResolved: true,
    loading: false,
    user: null as { id: string } | null,
    session: null as { user: { id: string }; access_token: string } | null,
  },
}));
const requests = vi.hoisted(() => ({ presence: vi.fn(), round: vi.fn() }));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => authState.current }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/wild/RoundRotaGate", () => ({ default: () => null }));
vi.mock("@/components/profile/HandleAvatar", () => ({ default: () => null }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: requests.presence }));
vi.mock("@/lib/venuesSlim", () => ({ loadSlimVenues: async () => [] }));
vi.mock("@/lib/roundRequest", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/roundRequest")>(),
  roundRequest: requests.round,
}));

import RoundPageClient from "@/app/rounds/[code]/RoundPageClient";
import PresenceStrip from "@/components/feed/PresenceStrip";
import { readProviderAccountRevision, setProviderIdentity } from "@/lib/authProviderRevision";
import type { RoundViewState } from "@/lib/rounds";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const VENUE = "venue-test";
let container: HTMLDivElement;
let root: Root;
let params: Promise<{ code: string }>;

function switchAccount(id: string | null): void {
  setProviderIdentity("supabase", id);
  authState.current = {
    accountRevision: readProviderAccountRevision(),
    identityResolved: true,
    loading: false,
    user: id ? { id } : null,
    session: id ? { user: { id }, access_token: `token-${id}` } : null,
  };
}

function presenceResponse(): Response {
  return Response.json({ presence: [{
    handle: "mate_ann",
    venueId: VENUE,
    venueName: "The Test Pub",
    venueMapUrl: `/map?sel=${VENUE}`,
    at: new Date(Date.now() - 1000).toISOString(),
  }] });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  switchAccount("account-a");
  requests.presence.mockReset();
  requests.round.mockReset();
  const at = new Date().toISOString();
  const round: RoundViewState = {
    round: { id: "round-1", code: "BCDFGH", title: "Test Round", createdByHandle: "mate_ann", createdAt: at, closedAt: null },
    members: [{ handle: "mate_ann", joinedAt: at }],
    stops: [{ id: "stop-1", venueId: VENUE, venueName: "The Test Pub", addedByHandle: "mate_ann", createdAt: at }],
    spends: [],
  };
  requests.round.mockImplementation(async () => Response.json(round));
  params = Promise.resolve({ code: "BCDFGH" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setProviderIdentity("supabase", null);
  window.localStorage.clear();
});

describe.each(["feed strip", "Round overlay"] as const)("%s account ownership", (surface) => {
  async function render() {
    await act(async () => {
      root.render(surface === "feed strip"
        ? createElement(PresenceStrip)
        : createElement(RoundPageClient, { params }));
    });
  }

  function visibleCount(): number {
    return container.querySelectorAll(surface === "feed strip"
      ? ".presenceItem" : "[aria-label='here now']").length;
  }

  it("hides loaded rows immediately when another account starts a pending read", async () => {
    requests.presence.mockResolvedValueOnce(presenceResponse());
    await render();
    expect(visibleCount()).toBe(1);

    const accountB = deferred<Response>();
    requests.presence.mockReturnValue(accountB.promise);
    switchAccount("account-b");
    await render();
    expect(visibleCount()).toBe(0);

    await act(async () => { accountB.resolve(Response.json({ presence: [] })); });
    expect(visibleCount()).toBe(0);
  });

  it("rejects an old response after a new account receives an empty result", async () => {
    const accountA = deferred<Response>();
    requests.presence.mockReturnValueOnce(accountA.promise);
    await render();
    expect(requests.presence).toHaveBeenCalledTimes(1);

    requests.presence.mockImplementation(async () => Response.json({ presence: [] }));
    switchAccount("account-b");
    await render();
    await act(async () => { accountA.resolve(presenceResponse()); });
    expect(visibleCount()).toBe(0);
  });

  it("rejects a body that finishes after sign-out and return to the same account", async () => {
    const body = deferred<unknown>();
    const response = presenceResponse();
    const json = vi.spyOn(response, "json").mockReturnValue(body.promise);
    requests.presence.mockResolvedValueOnce(response);
    await render();
    expect(json).toHaveBeenCalledTimes(1);

    requests.presence.mockImplementation(async () => Response.json({ presence: [] }));
    switchAccount(null);
    await render();
    switchAccount("account-a");
    await render();
    await act(async () => { body.resolve(await presenceResponse().json()); });
    expect(visibleCount()).toBe(0);
  });

  it("shows fresh rows for the new account", async () => {
    requests.presence.mockImplementation(async () => Response.json({ presence: [] }));
    await render();
    expect(visibleCount()).toBe(0);

    requests.presence.mockResolvedValue(presenceResponse());
    switchAccount("account-b");
    await render();
    expect(visibleCount()).toBe(1);
  });
});
