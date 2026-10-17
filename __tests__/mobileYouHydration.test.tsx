// @vitest-environment jsdom
import { act, createElement, Suspense, useLayoutEffect } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as Session | null,
  subscriber: null as null | ((event: string, session: Session | null) => void),
  router: { push: vi.fn(), prefetch: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => h.router, usePathname: () => "/tonight" }));
vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/authClient", async (original) => ({
  ...await original<typeof import("@/lib/authClient")>(),
  isAuthConfigured: () => true,
  ensureSupabaseBrowser: async () => ({ auth: {
    getSession: async () => ({ data: { session: h.session }, error: null }),
    onAuthStateChange: (callback: typeof h.subscriber) => {
      h.subscriber = callback;
      return { data: { subscription: { unsubscribe: () => { h.subscriber = null; } } } };
    },
  } }),
}));

import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { useViewerSession } from "@/components/auth/useViewerSession";
import MobileTabBar from "@/components/nav/MobileTabBar";
import { forgetCurrentIdentityRead } from "@/lib/currentIdentityRead";
import { setProviderAuthState } from "@/lib/authProviderRevision";

type Observation = { loading: boolean; identityResolved: boolean; owner: string | null; currentOwner: string | null; canonicalHandle: string | null; handle: string | null; signedIn: boolean; anchor: HTMLAnchorElement | null; attribute: string | null; property: string | null };
const observations: Observation[] = [];
let blockNav: Promise<void> | null;
let host: HTMLDivElement;
let root: Root | undefined;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function Probe({ nav = false }: { nav?: boolean }) {
  const auth = useAuth();
  const handle = useViewerHandle();
  const { signedIn } = useViewerSession();
  useLayoutEffect(() => {
    const anchor = host.querySelector<HTMLAnchorElement>('a[aria-label="You"]');
    if (nav) observations.push({ loading: auth.loading, identityResolved: auth.identityResolved, owner: auth.user?.id ?? null, currentOwner: auth.getCurrentUserId(), canonicalHandle: auth.handle, handle, signedIn, anchor, attribute: anchor?.getAttribute("href") ?? null, property: anchor?.href ?? null });
  });
  if (nav) return null;
  return createElement("output", { "data-probe": "provider" }, JSON.stringify({ loading: auth.loading, resolved: auth.identityResolved, owner: auth.user?.id ?? null, handle }));
}
function NavBoundary() {
  if (blockNav) throw blockNav;
  return createElement("div", null, createElement(MobileTabBar), createElement(Probe, { nav: true }));
}
function App() {
  return createElement(AuthProvider, { clerkIntegrationConfigured: false },
    createElement(Probe),
    createElement(Suspense, { fallback: createElement("p", null, "Loading navigation") }, createElement(NavBoundary)),
  );
}
function account(id: string): Session {
  return { user: { id }, access_token: `token-${id}`, refresh_token: `refresh-${id}` } as Session;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem("pubmax_handle", "previous_owner");
  h.session = null; h.subscriber = null; blockNav = null; observations.length = 0;
  forgetCurrentIdentityRead();
  setProviderAuthState("supabase", "unresolved");
  host = document.createElement("div"); document.body.append(host);
  window.history.replaceState(null, "", "/tonight");
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined; host.remove();
  localStorage.clear(); sessionStorage.clear();
  forgetCurrentIdentityRead();
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});
it("hydrates the existing You anchor after canonical bootstrap and follows account changes", async () => {
  const hydrationError = vi.fn();
  const consoleError = vi.spyOn(console, "error");
  const identity = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/identity/handle/current")) return identity.promise;
    return Response.json({});
  }));
  host.innerHTML = renderToString(createElement(App));
  const anchor = host.querySelector<HTMLAnchorElement>('a[aria-label="You"]')!;
  expect(anchor.getAttribute("href")).toBe("/u/you");
  const nav = deferred<void>(); blockNav = nav.promise;
  h.session = account("alice-id");
  await act(async () => { root = hydrateRoot(host, createElement(App), { onRecoverableError: hydrationError }); });
  await act(async () => { identity.resolve(Response.json({ handle: "alice" })); });
  expect(JSON.parse(host.querySelector('[data-probe="provider"]')!.textContent!)).toEqual({ loading: false, resolved: true, owner: "alice-id", handle: "alice" });
  await act(async () => { blockNav = null; nav.resolve(); });
  expect(observations.at(-1)).toMatchObject({ loading: false, identityResolved: true, owner: "alice-id", currentOwner: "alice-id", canonicalHandle: "alice", handle: "alice", signedIn: true, attribute: "/u/alice", property: "http://localhost:3000/u/alice" });

  expect(observations.at(-1)?.anchor === anchor).toBe(true);
  expect(hydrationError).not.toHaveBeenCalled();
  expect(consoleError).not.toHaveBeenCalled();

  const secondIdentity = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/api/identity/handle/current") ? secondIdentity.promise : Response.json({})));
  await act(async () => { h.session = account("bob-id"); h.subscriber?.("SIGNED_IN", h.session); });
  expect(anchor.getAttribute("href")).toBe("/u/you");
  await act(async () => { secondIdentity.resolve(Response.json({ handle: "bob" })); });
  expect(observations.at(-1)).toMatchObject({ owner: "bob-id", currentOwner: "bob-id", canonicalHandle: "bob", handle: "bob", attribute: "/u/bob" });
  await act(async () => { h.session = null; h.subscriber?.("SIGNED_OUT", null); });
  expect(anchor.getAttribute("href")).toBe("/u/you");
  expect(observations.at(-1)).toMatchObject({ owner: null, currentOwner: null, canonicalHandle: null, signedIn: false, attribute: "/u/you" });
});
