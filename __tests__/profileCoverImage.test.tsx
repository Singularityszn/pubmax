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
import { publishAuthActionState } from "@/lib/authedFetch";
import { readProviderAccountRevision, readProviderAuthState, setProviderAuthState, setProviderIdentity, type ProviderAuthState } from "@/lib/authProviderRevision";
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
    supabaseAuthState: readProviderAuthState("supabase"),
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
  setProviderIdentity("clerk", null);
  setProviderAuthState("clerk", "signed-out");
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
    expect(input).toBe(COVER);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer owner-token");
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("error");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
    expect(container.querySelector("img")?.getAttribute("data-cover-src")).toBe(COVER);
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
    fetchCover.mockImplementationOnce(() => new Promise(() => {}));
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

  it("waits for an auth answer when the provider is unresolved", async () => {
    switchAccount(null);
    setProviderAuthState("supabase", "unresolved");
    await act(async () => root.render(createElement(AuthFixture,
      { userId: null, providerAuthState: "unresolved" },
      createElement(ProfileCoverImage, { src: COVER, alt: "Cover", width: 1200, height: 360 }))));
    expect(fetchCover).not.toHaveBeenCalled();
    switchAccount("owner");
    await render("owner", COVER, true);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it.each([true, false])("loads a public cover without auth when the provider is unavailable (direct: %s)", async (direct) => {
    switchAccount(null);
    setProviderAuthState("supabase", "unavailable");
    publishAuthActionState({ status: "unknown", identityResolved: false });
    auth.token = "stale-token";
    await act(async () => root.render(createElement(AuthFixture,
      { userId: null, providerAuthState: "unavailable" },
      direct
        ? createElement(ProfileCoverImage, { src: COVER, alt: "Cover", width: 1200, height: 360 })
        : createElement(ProfileCoverCarousel, { covers: [COVER] }))));
    expect(fetchCover).toHaveBeenCalledTimes(1);
    expect(fetchCover.mock.calls[0]![0]).toBe(COVER);
    expect(new Headers(fetchCover.mock.calls[0]![1]?.headers).get("Authorization")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it.each([true, false])("loads a public cover when Supabase fails with a persisted Clerk session (direct: %s)", async (direct) => {
    switchAccount(null);
    setProviderIdentity("clerk", "clerk-reader");
    setProviderAuthState("clerk", "authenticated");
    setProviderAuthState("supabase", "unresolved");
    publishAuthActionState({ status: "unknown", identityResolved: false });
    auth.token = "stale-token";
    const view = () => createElement(AuthFixture,
      { userId: null, providerAuthState: "authenticated" },
      direct
        ? createElement(ProfileCoverImage, { src: COVER, alt: "Cover", width: 1200, height: 360 })
        : createElement(ProfileCoverCarousel, { covers: [COVER] }));
    await act(async () => root.render(view()));
    expect(fetchCover).not.toHaveBeenCalled();

    await act(async () => {
      setProviderAuthState("supabase", "unavailable");
      root.render(view());
    });
    expect(fetchCover).toHaveBeenCalledTimes(1);
    expect(fetchCover.mock.calls[0]![0]).toBe(COVER);
    expect(new Headers(fetchCover.mock.calls[0]![1]?.headers).get("Authorization")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("drops a permanently refused cover from the carousel without making a blob URL", async () => {
    fetchCover.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    await render();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".profileCoverFrames")).toBeNull();
    expect(makeBlobUrl).not.toHaveBeenCalled();
  });

  it("fetches a public cover immediately when auth settles signed out", async () => {
    vi.useFakeTimers();
    switchAccount(null);
    await render(null, COVER, true);
    expect(fetchCover).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchCover.mock.calls[0]![1]?.headers).get("Authorization")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("cancels an anonymous read when a reader signs in", async () => {
    let resolveAnonymous!: (response: Response) => void;
    fetchCover.mockImplementationOnce(() => new Promise((resolve) => { resolveAnonymous = resolve; }));
    switchAccount(null);
    await render(null, COVER, true);
    expect(fetchCover).toHaveBeenCalledTimes(1);
    const anonymousSignal = fetchCover.mock.calls[0]![1]!.signal;
    switchAccount("mate");
    expect(anonymousSignal?.aborted).toBe(true);
    await render("mate", COVER, true);
    await act(async () => resolveAnonymous(new Response("anonymous bytes")));
    expect(makeBlobUrl).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchCover.mock.calls[1]![1]?.headers).get("Authorization")).toBe("Bearer mate-token");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it.each([401, 403, 404, 408, 429, 503, "network", "body"] as const)(
    "reports a %s failure once without retrying",
    async (failure) => {
      vi.useFakeTimers();
      const onError = vi.fn();
      if (failure === "network") fetchCover.mockRejectedValueOnce(new TypeError("Network unavailable"));
      else if (failure === "body") {
        const response = new Response("broken body");
        vi.spyOn(response, "blob").mockRejectedValueOnce(new TypeError("Body unavailable"));
        fetchCover.mockResolvedValueOnce(response);
      } else fetchCover.mockResolvedValueOnce(new Response("Refused", { status: failure }));
      await act(async () => root.render(createElement(AuthFixture, { userId: "owner" },
        createElement(ProfileCoverImage, { src: COVER, alt: "Cover", width: 1200, height: 360, onError }))));
      expect(onError).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(fetchCover).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(makeBlobUrl).not.toHaveBeenCalled();
      expect(container.querySelector("img")).toBeNull();
    },
  );

  it("restarts an unloaded read on a same-user session refresh", async () => {
    vi.useFakeTimers();
    auth.token = null;
    await render("owner", COVER, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
    expect(fetchCover).not.toHaveBeenCalled();
    const accountRevision = readProviderAccountRevision();
    auth.token = "owner-token";
    auth.session = {
      access_token: "owner-token", refresh_token: "fixture-refresh", expires_in: 3_600,
      token_type: "bearer", user: { id: "owner" } as User,
    };
    await render("owner", COVER, true);
    expect(readProviderAccountRevision()).toBe(accountRevision);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("fetches only the first cover and never rotates under reduced motion", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const covers = [COVER, COVER.replace("22222222", "33333333"), COVER.replace("22222222", "44444444")];
    await act(async () => root.render(createElement(AuthFixture, { userId: "owner" },
      createElement(ProfileCoverCarousel, { covers }))));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchCover).toHaveBeenCalledTimes(1);
    expect(fetchCover.mock.calls[0]![0]).toBe(COVER);
    expect(container.querySelector(".profileCoverFrames")?.getAttribute("data-cover-count")).toBe("1");
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector(".profileCoverImageActive")?.getAttribute("src")).toBe("blob:approved-cover");
  });

  it("lets a new reader retry a URL that the previous reader could not access", async () => {
    fetchCover.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    await render();
    expect(container.querySelector(".profileCoverFrames")).toBeNull();
    switchAccount("mate");
    await render("mate");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:approved-cover");
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

  it("drops only the hidden cover from a rotation after one 404, as the image tag did", async () => {
    vi.useFakeTimers();
    const hidden = COVER.replace("22222222", "33333333");
    fetchCover.mockImplementation(async (input) => String(input).startsWith(hidden)
      ? new Response("Not found", { status: 404 })
      : new Response("approved bytes", { headers: { "Content-Type": "image/jpeg" } }));
    await act(async () => {
      root.render(createElement(AuthFixture, { userId: "owner" },
        createElement(ProfileCoverCarousel, { covers: [COVER, hidden] })));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchCover.mock.calls.filter(([input]) => String(input).startsWith(hidden))).toHaveLength(1);
    expect(container.querySelector(".profileCoverFrames")?.getAttribute("data-cover-count")).toBe("1");
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("returns a refused cover to the rotation after a same-user session refresh", async () => {
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

  it("restarts a refused editor image on a same-user session refresh", async () => {
    vi.useFakeTimers();
    fetchCover.mockImplementation(async () => new Response("Temporary refusal", { status: 503 }));
    await render("owner", COVER, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchCover).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img")).toBeNull();
    fetchCover.mockImplementation(async () => new Response("approved bytes", { headers: { "Content-Type": "image/jpeg" } }));
    auth.session = {
      access_token: "owner-token-2", refresh_token: "fixture-refresh", expires_in: 3_600,
      token_type: "bearer", user: { id: "owner" } as User,
    };
    await render("owner", COVER, true);
    expect(fetchCover).toHaveBeenCalledTimes(2);
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
