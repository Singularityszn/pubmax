// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NIGHT_PROFILE_INPUT } from "@/lib/nightProfile";
import { useMapNearbyProfile } from "@/lib/useMapNearbyProfile";

const { fetchProfile } = vi.hoisted(() => ({ fetchProfile: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: fetchProfile }));
const saved = { ...DEFAULT_NIGHT_PROFILE_INPUT, createdAt: "2026-10-28T12:00:00Z", updatedAt: "2026-10-28T12:00:00Z" };
const response = (profile: unknown) => new Response(JSON.stringify({ profile }));

let host: HTMLDivElement;
let root: Root | null;
let seen: Array<ReturnType<typeof useMapNearbyProfile>>;

function Probe({ owner }: { owner: string | null }): null {
  seen.push(useMapNearbyProfile(owner));
  return null;
}

function latest(): ReturnType<typeof useMapNearbyProfile> {
  const state = seen.at(-1);
  if (!state) throw new Error("The profile probe did not render");
  return state;
}

function renderOwner(owner: string | null): void {
  act(() => root?.render(createElement(Probe, { owner })));
}

async function settleRead(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function unmount(): void {
  act(() => root?.unmount());
  root = null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchProfile.mockReset();
  seen = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  unmount();
  host.remove();
  vi.unstubAllGlobals();
});

describe("nearby account preferences", () => {
  it("does not request a profile when signed out", () => {
    renderOwner(null);
    expect(latest()).toEqual({ profile: null, status: "signed-out" });
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  it("reads only authenticated no-store account preferences", async () => {
    fetchProfile.mockResolvedValue(response(saved));
    renderOwner("account-a:1");
    await settleRead();
    expect(latest().status).toBe("ready");
    expect(latest().profile).toEqual(saved);
    expect(fetchProfile).toHaveBeenCalledWith("/api/me/night-profile", expect.objectContaining({ method: "GET", cache: "no-store", signal: expect.any(AbortSignal) }), { requiresIdentity: true });
  });

  it("clears previous preferences immediately and rejects a late response after an account change", async () => {
    let finishA!: (value: Response) => void;
    let finishB!: (value: Response) => void;
    fetchProfile.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishA = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishB = resolve; }));
    renderOwner("account-a:1");
    const firstSignal = fetchProfile.mock.calls[0]![1].signal as AbortSignal;
    renderOwner("account-b:1");
    expect(firstSignal.aborted).toBe(true);
    expect(latest()).toEqual({ profile: null, status: "loading" });
    await act(async () => { finishA(response(saved)); });
    expect(latest().profile).toBeNull();
    await act(async () => { finishB(response(null)); });
    expect(latest()).toEqual({ profile: null, status: "ready" });
  });

  it("does not reuse old preferences when the same account returns after sign-out", async () => {
    fetchProfile.mockResolvedValueOnce(response(saved)).mockImplementationOnce(() => new Promise(() => {}));
    renderOwner("account-a:1");
    await settleRead();
    expect(latest().profile).toEqual(saved);
    renderOwner(null);
    expect(latest().profile).toBeNull();
    renderOwner("account-a:1");
    expect(latest()).toEqual({ profile: null, status: "loading" });
  });

  it("fails closed for malformed profiles and failed account reads", async () => {
    fetchProfile.mockResolvedValue(response({ bad: true }));
    renderOwner("account-a:1");
    await settleRead();
    expect(latest().status).toBe("unavailable");
    expect(latest().profile).toBeNull();
  });

  it("aborts an unmounted request and ignores its late response", async () => {
    let finish!: (value: Response) => void;
    fetchProfile.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    renderOwner("account-a:1");
    const signal = fetchProfile.mock.calls[0]![1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    const renderCount = seen.length;
    await act(async () => { finish(response(saved)); });
    expect(seen).toHaveLength(renderCount);
    expect(latest().profile).toBeNull();
  });
});
