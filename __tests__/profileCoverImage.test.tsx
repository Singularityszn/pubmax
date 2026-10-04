// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session, User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ token: "owner-token" as string | null, session: null as Session | null }));
vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => auth.token }));

import { AuthContext, useAuth, type AuthContextValue } from "@/components/auth/authContext";
import ProfileCoverCarousel from "@/components/profile/ProfileCoverCarousel";
import ProfileCoverImage from "@/components/profile/ProfileCoverImage";
import ProfileCoverPhotosEditor from "@/components/profile/ProfileCoverPhotosEditor";
import { publishAuthActionState } from "@/lib/authedFetch";
import { readProviderAccountRevision, setProviderAuthState, setProviderIdentity, type ProviderAuthState } from "@/lib/authProviderRevision";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

const COVER = "/api/cover/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
let root: Root;
let container: HTMLDivElement;
const fetchCover = vi.fn<typeof fetch>();
const makeBlobUrl = vi.fn(() => "blob:approved-cover");
const releaseBlobUrl = vi.fn();

function AuthFixture({ userId, providerAuthState, children }: {
  userId: string | null;
  providerAuthState?: ProviderAuthState;
  children?: ReactNode;
}) {
  const defaults = useAuth();
  const value: AuthContextValue = {
    ...defaults,
    session: auth.session,
    user: userId ? ({ id: userId } as User) : null,
    identityResolved: true,
    accountRevision: readProviderAccountRevision(),
    providerAuthState: providerAuthState ?? (userId ? "authenticated" : "signed-out"),
  };
  return createElement(AuthContext.Provider, { value }, children);
}

async function render(userId: string | null = "owner", src = COVER, direct = false): Promise<void> {
  await act(async () => {
    root.render(createElement(AuthFixture, { userId },
      direct
        ? createElement(ProfileCoverImage, { src, alt: "Cover", width: 1200, height: 360 })
        : createElement(ProfileCoverCarousel, { covers: [src] })));
  });
}

function switchAccount(userId: string | null): void {
  auth.token = userId ? `${userId}-token` : null;
  setProviderIdentity("supabase", userId);
  setProviderAuthState("supabase", userId ? "authenticated" : "signed-out");
  publishAuthActionState({ status: userId ? "signed-in" : "signed-out", identityResolved: true });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  auth.token = "owner-token";
  auth.session = null;
  clearSurfaceCache();
  setProviderIdentity("supabase", "owner");
  setProviderAuthState("supabase", "authenticated");
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  fetchCover.mockReset().mockImplementation(async () => new Response("approved bytes", { headers: { "Content-Type": "image/jpeg" } }));
  makeBlobUrl.mockClear();
  releaseBlobUrl.mockClear();
  vi.stubGlobal("fetch", fetchCover);
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = makeBlobUrl;
    static revokeObjectURL = releaseBlobUrl;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setProviderIdentity("supabase", null);
  setProviderAuthState("supabase", "signed-out");
  publishAuthActionState({ status: "signed-out", identityResolved: true });
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearSurfaceCache();
});

describe("private cover rendering", () => {
  it("renders an owner's cover with the bearer transport, not an unsigned image request", async () => {
    await render();
    expect(fetchCover).toHaveBeenCalledTimes(1);
    const [input, init] = fetchCover.mock.calls[0]!;
    expect(input).toBe(`${COVER}?privacy=2`);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer owner-token");
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("error");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
    expect(container.innerHTML).not.toContain(COVER);
  });

  it("renders a mutual mate's approved bytes with their own token", async () => {
    switchAccount("mate");
    await render("mate");
    expect(new Headers(fetchCover.mock.calls[0]![1]?.headers).get("Authorization")).toBe("Bearer mate-token");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("clears and releases the previous cover when the account changes", async () => {
    makeBlobUrl.mockReturnValueOnce("blob:owner").mockReturnValueOnce("blob:mate");
    await render("owner", COVER, true);
    switchAccount("mate");
    await render("mate", COVER, true);
    expect(releaseBlobUrl).toHaveBeenCalledWith("blob:owner");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:mate");
    expect(new Headers(fetchCover.mock.calls[1]![1]?.headers).get("Authorization")).toBe("Bearer mate-token");
  });

  it("clears private bytes on sign-out while an anonymous request is still pending", async () => {
    await render("owner", COVER, true);
    switchAccount(null);
    await render(null, COVER, true);
    expect(container.querySelector("img")).toBeNull();
    expect(releaseBlobUrl).toHaveBeenCalledWith("blob:approved-cover");
    expect(makeBlobUrl).toHaveBeenCalledTimes(1);
  });

  it("does not expose an old account's body that finishes after an account change", async () => {
    let resolveBody!: (body: Blob) => void;
    const delayed = new Response("old account bytes");
    vi.spyOn(delayed, "blob").mockImplementation(() => new Promise((resolve) => { resolveBody = resolve; }));
    fetchCover.mockResolvedValueOnce(delayed);
    await render("owner", COVER, true);
    expect(container.querySelector("img")).toBeNull();
    const oldSignal = fetchCover.mock.calls[0]![1]!.signal;
    switchAccount("mate");
    await render("mate", COVER, true);
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => resolveBody(new Blob(["old account bytes"])));
    expect(makeBlobUrl).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("releases a replaced generation and aborts its request on unmount", async () => {
    await render("owner", COVER, true);
    const oldSignal = fetchCover.mock.calls[0]![1]!.signal;
    await render("owner", COVER.replace("22222222", "33333333"), true);
    expect(oldSignal?.aborted).toBe(true);
    expect(releaseBlobUrl).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null));
    expect(fetchCover.mock.calls[1]![1]!.signal?.aborted).toBe(true);
    expect(releaseBlobUrl).toHaveBeenCalledTimes(2);
  });

  it.each(["unresolved", "unavailable"] as const)("waits for an auth answer when the provider is %s", async (state) => {
    switchAccount(null);
    setProviderAuthState("supabase", state);
    await act(async () => root.render(createElement(AuthFixture,
      { userId: null, providerAuthState: state },
      createElement(ProfileCoverImage, { src: COVER, alt: "Cover", width: 1200, height: 360 }))));
    expect(fetchCover).not.toHaveBeenCalled();
    switchAccount("owner");
    await render("owner", COVER, true);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("drops a permanently refused cover from the carousel without making a blob URL", async () => {
    fetchCover.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    await render();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".profileCoverFrames")).toBeNull();
    expect(makeBlobUrl).not.toHaveBeenCalled();
  });

  it("keeps a cover available when a waking session has not supplied its token yet", async () => {
    vi.useFakeTimers();
    auth.token = null;
    await act(async () => root.render(createElement(AuthFixture,
      { userId: "owner", providerAuthState: "unavailable" },
      createElement(ProfileCoverCarousel, { covers: [COVER] }))));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
    expect(fetchCover).not.toHaveBeenCalled();
    expect(container.querySelector(".profileCoverFrames")).not.toBeNull();
    auth.token = "owner-token";
    await render();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("still renders an anonymous reader's public cover after auth settles signed out", async () => {
    vi.useFakeTimers();
    switchAccount(null);
    await render(null, COVER, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
    expect(new Headers(fetchCover.mock.calls[0]![1]?.headers).get("Authorization")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it.each([404, 429, 503, "network"] as const)("recovers a temporary %s failure without excluding the cover", async (failure) => {
    vi.useFakeTimers();
    if (failure === "network") fetchCover.mockRejectedValueOnce(new TypeError("Network unavailable"));
    else fetchCover.mockResolvedValueOnce(new Response("Temporary refusal", { status: failure }));
    await render();
    expect(container.querySelector(".profileCoverFrames")).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("restores a token after the two-second gate without changing the account or provider state", async () => {
    vi.useFakeTimers();
    auth.token = null;
    await render();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
    expect(fetchCover).not.toHaveBeenCalled();
    auth.token = "owner-token";
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("restarts an exhausted read on a same-user token refresh without changing reader identity", async () => {
    vi.useFakeTimers();
    auth.token = null;
    await render();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetchCover).not.toHaveBeenCalled();
    const accountRevision = readProviderAccountRevision();
    auth.token = "owner-token";
    auth.session = {
      access_token: "owner-token", refresh_token: "fixture-refresh", expires_in: 3_600,
      token_type: "bearer", user: { id: "owner" } as User,
    };
    await render();
    expect(readProviderAccountRevision()).toBe(accountRevision);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("recovers the editor's covers read on a same-user session refresh", async () => {
    vi.useFakeTimers();
    auth.token = null;
    fetchCover.mockImplementation(async (input) => String(input).includes("/profiles/")
      ? Response.json({ status: "ready", covers: [] })
      : new Response("approved bytes", { headers: { "Content-Type": "image/jpeg" } }));
    const renderEditor = async () => act(async () => root.render(createElement(AuthFixture,
      { userId: "owner" }, createElement(ProfileCoverPhotosEditor, {
        handle: "alice", heldCoverUrls: [COVER], onProfileChanged: () => {},
      }))));
    await renderEditor();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(container.textContent).toContain("We could not read your cover photos");
    auth.token = "owner-token";
    auth.session = {
      access_token: "owner-token", refresh_token: "fixture-refresh", expires_in: 3_600,
      token_type: "bearer", user: { id: "owner" } as User,
    };
    await renderEditor();
    expect(container.textContent).not.toContain("We could not read your cover photos");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("lets a new reader retry a URL that the previous reader could not access", async () => {
    fetchCover.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    await render();
    expect(container.querySelector(".profileCoverFrames")).toBeNull();
    switchAccount("mate");
    await render("mate");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("bounds temporary retries and takes an exhausted cover out of the rotation", async () => {
    vi.useFakeTimers();
    fetchCover.mockImplementation(async () => new Response("Temporary refusal", { status: 503 }));
    await render();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchCover).toHaveBeenCalledTimes(4);
    expect(container.querySelector(".profileCoverFrames")).toBeNull();
    expect(makeBlobUrl).not.toHaveBeenCalled();
  });

  it("does not retry before a server cooldown longer than the read budget", async () => {
    vi.useFakeTimers();
    fetchCover.mockResolvedValueOnce(new Response("Slow down", { status: 429, headers: { "Retry-After": "60" } }));
    await render();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchCover).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".profileCoverFrames")).toBeNull();
  });

  it("keeps a loaded cover on screen through a same-user session refresh", async () => {
    await render();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
    auth.session = {
      access_token: "owner-token-2", refresh_token: "fixture-refresh", expires_in: 3_600,
      token_type: "bearer", user: { id: "owner" } as User,
    };
    await render();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
    expect(fetchCover).toHaveBeenCalledTimes(1);
    expect(releaseBlobUrl).not.toHaveBeenCalled();
  });

  it("drops only the hidden cover from a rotation once its reads are exhausted", async () => {
    vi.useFakeTimers();
    const hidden = COVER.replace("22222222", "33333333");
    fetchCover.mockImplementation(async (input) => String(input).startsWith(hidden)
      ? new Response("Not found", { status: 404 })
      : new Response("approved bytes", { headers: { "Content-Type": "image/jpeg" } }));
    await act(async () => {
      root.render(createElement(AuthFixture, { userId: "owner" },
        createElement(ProfileCoverCarousel, { covers: [COVER, hidden] })));
    });
    expect(container.querySelector(".profileCoverFrames")?.getAttribute("data-cover-count")).toBe("2");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchCover.mock.calls.filter(([input]) => String(input).startsWith(hidden))).toHaveLength(4);
    expect(container.querySelector(".profileCoverFrames")?.getAttribute("data-cover-count")).toBe("1");
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("returns an exhausted cover to the rotation after a same-user session refresh", async () => {
    vi.useFakeTimers();
    fetchCover.mockImplementation(async () => new Response("Temporary refusal", { status: 503 }));
    await render();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(container.querySelector(".profileCoverFrames")).toBeNull();
    fetchCover.mockImplementation(async () => new Response("approved bytes", { headers: { "Content-Type": "image/jpeg" } }));
    auth.session = {
      access_token: "owner-token-2", refresh_token: "fixture-refresh", expires_in: 3_600,
      token_type: "bearer", user: { id: "owner" } as User,
    };
    await render();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("restarts an exhausted editor image on a same-user session refresh", async () => {
    vi.useFakeTimers();
    fetchCover.mockImplementation(async () => new Response("Temporary refusal", { status: 503 }));
    await render("owner", COVER, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchCover).toHaveBeenCalledTimes(4);
    expect(container.querySelector("img")).toBeNull();
    fetchCover.mockImplementation(async () => new Response("approved bytes", { headers: { "Content-Type": "image/jpeg" } }));
    auth.session = {
      access_token: "owner-token-2", refresh_token: "fixture-refresh", expires_in: 3_600,
      token_type: "bearer", user: { id: "owner" } as User,
    };
    await render("owner", COVER, true);
    expect(fetchCover).toHaveBeenCalledTimes(5);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("does not let a refusal for a read started before a session refresh exclude the cover", async () => {
    let resolveOld!: (response: Response) => void;
    fetchCover.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    await render();
    expect(fetchCover).toHaveBeenCalledTimes(1);
    auth.token = "owner-token-2";
    auth.session = {
      access_token: "owner-token-2", refresh_token: "fixture-refresh", expires_in: 3_600,
      token_type: "bearer", user: { id: "owner" } as User,
    };
    await render();
    await act(async () => resolveOld(new Response("Unauthorized", { status: 401 })));
    expect(container.querySelector(".profileCoverFrames")).not.toBeNull();
    expect(new Headers(fetchCover.mock.calls.at(-1)![1]?.headers).get("Authorization")).toBe("Bearer owner-token-2");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("gives a refreshed session its own bounded read before an outage excludes the cover", async () => {
    vi.useFakeTimers();
    fetchCover.mockImplementation(async () => new Response("Temporary refusal", { status: 503 }));
    await render();
    expect(fetchCover).toHaveBeenCalledTimes(1);
    auth.token = "owner-token-2";
    auth.session = {
      access_token: "owner-token-2", refresh_token: "fixture-refresh", expires_in: 3_600,
      token_type: "bearer", user: { id: "owner" } as User,
    };
    await render();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    const refreshedReads = fetchCover.mock.calls.filter(([, init]) =>
      new Headers(init?.headers).get("Authorization") === "Bearer owner-token-2");
    expect(refreshedReads).toHaveLength(4);
    expect(container.querySelector(".profileCoverFrames")).toBeNull();
  });

  it("removes a cover whose visibility was withdrawn and does not show it to the next reader's refusal", async () => {
    vi.useFakeTimers();
    await render();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
    fetchCover.mockImplementation(async () => new Response("Not found", { status: 404 }));
    switchAccount("stranger");
    await render("stranger");
    expect(container.querySelector("img")).toBeNull();
    expect(releaseBlobUrl).toHaveBeenCalledWith("blob:approved-cover");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(container.querySelector(".profileCoverFrames")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("cancels the previous reader's retry before it can fetch again", async () => {
    vi.useFakeTimers();
    fetchCover.mockResolvedValueOnce(new Response("Temporary refusal", { status: 503 }));
    await render();
    switchAccount("mate");
    await render("mate");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchCover).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchCover.mock.calls[1]![1]?.headers).get("Authorization")).toBe("Bearer mate-token");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it.each([
    "https://other.test/api/cover/p/g",
    "//other.test/api/cover/p/g",
    "/api/avatar/p/g",
    "/api/cover/../secret",
    "/api/cover/%2e%2e/secret",
    `${COVER}?redirect=other`,
    `${COVER}#fragment`,
  ])("never sends a token outside a canonical cover path: %s", async (src) => {
    await render("owner", src, true);
    expect(fetchCover).not.toHaveBeenCalled();
    expect(makeBlobUrl).not.toHaveBeenCalled();
    expect(container.querySelector("img")).toBeNull();
  });
});
