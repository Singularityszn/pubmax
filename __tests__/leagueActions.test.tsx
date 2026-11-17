// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  current: { accountRevision: 0, user: { id: "alice" } as { id: string } | null, providerAuthState: "authenticated" },
}));
const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth.current }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => auth.current }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => "test-token" }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));

import JoinLeagueClient from "@/app/social/leagues/join/[code]/JoinLeagueClient";
import { leagueRequest } from "@/app/social/leagues/leagueRequest";
import { publishAuthActionState } from "@/lib/authedFetch";
import { readProviderAccountRevision, setProviderIdentity } from "@/lib/authProviderRevision";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let host: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => root.render(createElement(JoinLeagueClient, { code: "ABCDEFGH" })));
}

function joinButton(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>("button[data-primary-action]");
  if (!button) throw new Error("Join button is absent");
  return button;
}

beforeEach(() => {
  setProviderIdentity("supabase", "alice");
  auth.current = { accountRevision: readProviderAccountRevision(), user: { id: "alice" }, providerAuthState: "authenticated" };
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  navigation.replace.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setProviderIdentity("supabase", null);
  publishAuthActionState({ status: "unknown", identityResolved: false });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("league action cancellation", () => {
  it.each([
    { status: 200, body: { id: "joined-league" }, reply: { kind: "ok", status: 200, body: { id: "joined-league" } } },
    { status: 401, body: { error: "Sign in" }, reply: { kind: "signed-out" } },
    { status: 403, body: { error: "Choose a handle" }, reply: { kind: "closed", message: "Choose a handle" } },
    { status: 503, body: { code: "LEAGUES_NOT_OPEN" }, reply: { kind: "not-open" } },
    { status: 409, body: { code: "LEAGUE_FULL", error: "This league is full" }, reply: { kind: "refused", status: 409, code: "LEAGUE_FULL", message: "This league is full" } },
    { status: 500, body: {}, reply: { kind: "error" } },
  ])("preserves the league API outcome for HTTP $status", async ({ status, body, reply }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body, { status })));
    await expect(leagueRequest("/api/leagues/join", { method: "POST" })).resolves.toEqual(reply);
  });

  it.each([
    ["/api/leagues", "POST"],
    ["/api/leagues/join", "POST"],
    ["/api/leagues/league-id/code", "POST"],
    ["/api/leagues/league-id/leave", "POST"],
    ["/api/leagues/league-id", "DELETE"],
    ["/api/leagues/league-id/invite", "GET"],
    ["/api/leagues/league-id/invite", "POST"],
  ])("settles cancellation for %s %s so its caller can reset busy", async (path, method) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError")));
    await expect(leagueRequest(path, { method })).resolves.toEqual({ kind: "error" });
  });

  it("rejects a successful response whose account changes while its body loads", async () => {
    const body = deferred<unknown>();
    const reading = deferred<void>();
    const response = Response.json({ id: "old-account-league" });
    vi.spyOn(response, "json").mockImplementation(() => {
      reading.resolve();
      return body.promise;
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const reply = leagueRequest("/api/leagues/join", { method: "POST" });
    await reading.promise;
    setProviderIdentity("supabase", "bob");
    body.resolve({ id: "old-account-league" });
    await expect(reply).resolves.toEqual({ kind: "error" });
  });

  it("releases Join after an abort and allows a successful retry", async () => {
    const response = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn()
      .mockReturnValueOnce(response.promise)
      .mockResolvedValueOnce(Response.json({ id: "joined-league" })));
    await render();
    await act(async () => joinButton().click());
    expect(joinButton().disabled).toBe(true);
    await act(async () => response.reject(new DOMException("Cancelled", "AbortError")));
    expect(joinButton().disabled).toBe(false);
    await act(async () => joinButton().click());
    expect(navigation.replace).toHaveBeenCalledWith("/social/leagues/joined-league");
    expect(joinButton().disabled).toBe(false);
  });

  it("resets Join immediately on account change and ignores the previous account's response", async () => {
    const response = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(response.promise));
    await render();
    await act(async () => joinButton().click());
    expect(joinButton().disabled).toBe(true);
    setProviderIdentity("supabase", "bob");
    auth.current = { ...auth.current, accountRevision: readProviderAccountRevision(), user: { id: "bob" } };
    await render();
    expect(joinButton().disabled).toBe(false);
    await act(async () => response.resolve(Response.json({ id: "alice-league" })));
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(joinButton().disabled).toBe(false);
  });

  it("waits for session restoration before enabling Join", async () => {
    auth.current = { ...auth.current, user: null, providerAuthState: "unresolved" };
    await render();
    expect(joinButton().disabled).toBe(true);
    auth.current = { ...auth.current, user: { id: "alice" }, providerAuthState: "authenticated" };
    await render();
    expect(joinButton().disabled).toBe(false);
  });
});
