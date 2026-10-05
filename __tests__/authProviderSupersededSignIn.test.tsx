// @vitest-environment jsdom
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What runs for real: AuthProvider, the installed Supabase client (2.117 runs
// auth calls without a lock by default, so a sign-out's late removal can land
// after another sign-in's install), bootstrapAuthSession, the auth callback
// client, the browser resume client and the /api/auth/session route handlers.
// Explicit doubles: an in-memory GoTrue that never revokes, the bearer
// verifier, rate limiting, the callback capture and a browser-like cookie jar.
// One document only: not cross-tab ordering, not real GoTrue revocation and
// not a compiled-browser run.

const harness = vi.hoisted(() => ({
  clientReady: null as null | Promise<unknown>,
  captured: null as unknown,
  composer: false,
}));

vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
      createElement("a", { href, ...props }, children),
  };
});

vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/posthog/posthogPerson", () => ({ syncPosthogPersonIdentity: vi.fn() }));
vi.mock("@/lib/authClient", () => ({
  isAuthConfigured: () => true,
  getAccessToken: async () => null,
  ensureSupabaseBrowser: () => harness.clientReady,
}));
vi.mock("@/lib/authProviderAvailability", () => ({
  loadSocialAuthProviders: async () => ({ google: false, apple: false, microsoft: false }),
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
}));
vi.mock("@/lib/authRedirect", () => ({
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT: "pubmax-auth-return-fragment-restored",
  scrubAuthCallback: async () => harness.captured,
  scrubLingeringAuthCallback: vi.fn(() => false),
}));
vi.mock("@/lib/identityClient", () => ({
  handleClaimRouteAfterSignIn: async () => null,
  IDENTITY_HANDLE_CHANGED_EVENT: "pubmax:identity-handle-changed",
  identityHandleForOwner: (identity: { ownerId?: string; handle?: string } | null, owner: string | null) =>
    identity?.ownerId === owner ? identity?.handle ?? null : null,
  resolveCanonicalIdentity: async (userId: string) => ({
    ok: true,
    identity: { ownerId: userId, handle: userId.replace(/-/g, "_") },
  }),
}));
vi.mock("@/lib/referralClaimClient", () => ({
  claimSignupReferralFromAuthCallback: async () => {},
  withReferralSignupProof: (attempt: unknown) => attempt,
}));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  isSupabaseConfigured: () => false,
  checkRateLimitDurableDetailed: async () => ({ verdict: null, reason: "no-client" }) as const,
}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {}, assertProductionSecrets: () => {} }));
vi.mock("@/lib/authServer", () => ({
  verifyCallerAuth: async (request: Request) => {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!bearer) return { status: "absent" };
    const sub = JSON.parse(Buffer.from(bearer.split(".")[1] ?? "", "base64url").toString()).sub as string;
    return { status: "verified", identity: { id: sub, email: `${sub}@example.com`, createdAt: null } };
  },
}));

import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import PintDropComposer from "@/components/map/PintDropComposer";
import { usePintDrops } from "@/components/map/usePintDrops";
import { DELETE, GET, POST } from "@/app/api/auth/session/route";
import { establishAuthCallbackSession } from "@/lib/authCallbackClient";
import {
  commitSignIn,
  persistSessionForResume,
  readResumeGeneration,
  sessionAccountAdmitted,
} from "@/lib/authSessionResumeClient";
import { deviceAccountOwner } from "@/lib/deviceAccountIdentity";
import { readDeviceAccounts, rememberDeviceAccount } from "@/lib/deviceAccountSessions";
import { pintDropAccountDraftOwner, readPintDropDraft } from "@/lib/pintDropDraft";
import { SPILL_EXTRAS_TOGGLE_LABEL } from "@/lib/spill";

const SUPABASE_URL = "https://auth-superseded.invalid";
const SDK_STORAGE_KEY = "pubmax-superseded-auth-token";
const A = "account-a";
const B = "account-b";

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sessionFor(id: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({ sub: id, exp, role: "authenticated" })}.${base64Url("signature")}`,
    refresh_token: `synthetic-refresh-${id}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: { id, email: `${id}@example.com`, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00.000Z" },
  };
}

function subject(token: string): string {
  return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()).sub as string;
}

let httpOnlyCookies: Map<string, string>;
let sdkItems: Map<string, string>;
let holdLogout: boolean;
let releaseLogout: (() => void) | null;
let resumeTransportDown: boolean;
let refuseUser: Set<string>;
let holdUser: Promise<void> | null;
let auth: ReturnType<typeof useAuth> | null;
let root: Root | null;
let container: HTMLDivElement | null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function cookieHeader(): string {
  return [document.cookie, ...[...httpOnlyCookies].map(([name, value]) => `${name}=${value}`)].filter(Boolean).join("; ");
}

function applySetCookies(response: Response): void {
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(";")[0] ?? "";
    const name = pair.slice(0, pair.indexOf("="));
    const value = pair.slice(pair.indexOf("=") + 1);
    if (/;\s*httponly/i.test(raw)) {
      if (/max-age=0/i.test(raw) || value === "") httpOnlyCookies.delete(name);
      else httpOnlyCookies.set(name, value);
    } else {
      document.cookie = raw.replace(/;\s*secure/i, "");
    }
  }
}

async function sessionRoute(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookieHeader());
  headers.set("sec-fetch-site", "same-origin");
  const request = new Request(`http://localhost${url}`, { ...init, headers });
  const response = request.method === "GET" ? await GET(request) : request.method === "DELETE" ? await DELETE(request) : await POST(request);
  applySetCookies(response);
  return response;
}

async function transport(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("/api/auth/session")) {
    if (resumeTransportDown && (init.method ?? "GET") !== "DELETE") throw new TypeError("Failed to fetch");
    return sessionRoute(url, init);
  }
  if (url.startsWith("/api/pint-drops")) return json({ drops: [] });
  if (url === "/api/cheap-pint-ping") return json({ canPrompt: false });
  if (url.includes("/auth/v1/token")) {
    const refresh = (JSON.parse(String(init.body)) as { refresh_token: string }).refresh_token;
    return json(sessionFor(refresh.replace("synthetic-refresh-", "")));
  }
  if (url.includes("/auth/v1/user")) {
    const bearer = new Headers(init.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (refuseUser.has(subject(bearer))) {
      if (holdUser) await holdUser;
      return json({ code: 401, error_code: "bad_jwt", msg: "synthetic refused token" }, 401);
    }
    return json(sessionFor(subject(bearer)).user);
  }
  if (url.includes("/auth/v1/logout")) {
    if (holdLogout) await new Promise<void>((resolve) => { releaseLogout = resolve; });
    return new Response(null, { status: 204 });
  }
  return json({});
}

function makeClient(): SupabaseClient {
  return createClient(SUPABASE_URL, "synthetic-public-key", {
    auth: {
      storageKey: SDK_STORAGE_KEY,
      storage: {
        getItem: (key) => sdkItems.get(key) ?? null,
        setItem: (key, value) => { sdkItems.set(key, value); },
        removeItem: (key) => { sdkItems.delete(key); },
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: transport },
  });
}

function Probe() {
  const current = useAuth();
  useEffect(() => { auth = current; });
  return createElement("output", { "data-testid": "viewer" }, current.user?.id ?? "signed-out");
}

const VENUE_ID = "venue-test1";
const NOTE_B = "B's half-written story about the snug";

function ComposerHost() {
  const state = usePintDrops("london");
  return createElement(PintDropComposer, { venueId: VENUE_ID, venueName: "The Fixture Arms", state });
}

function viewer(): string | null | undefined {
  return container?.querySelector('[data-testid="viewer"]')?.textContent;
}

function storedSdkAccount(): string | null {
  const raw = sdkItems.get(SDK_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { user: { id: string } }).user.id : null;
}

async function redeemedAccount(): Promise<string | null> {
  const body = await (await POST(new Request("http://localhost/api/auth/session", {
    method: "POST",
    headers: { cookie: cookieHeader(), "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ action: "redeem" }),
  }))).json() as { session?: { refresh_token?: string } };
  return body.session?.refresh_token?.replace("synthetic-refresh-", "") ?? null;
}

/** A deliberate sign-in another document already finished: generation, shared SDK storage and cookie. */
async function signedInElsewhere(id: string) {
  expect(commitSignIn(readResumeGeneration(), sessionFor(id).access_token)).not.toBeNull();
  sdkItems.set(SDK_STORAGE_KEY, JSON.stringify(sessionFor(id)));
  expect(await persistSessionForResume(sessionFor(id))).toBe("stored");
}

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(AuthProvider, { clerkIntegrationConfigured: false },
      createElement(Probe), harness.composer ? createElement(ComposerHost) : null));
  });
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
  localStorage.clear();
  sessionStorage.clear();
  httpOnlyCookies = new Map();
  sdkItems = new Map();
  holdLogout = false;
  releaseLogout = null;
  resumeTransportDown = false;
  refuseUser = new Set();
  holdUser = null;
  harness.composer = false;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:fixture-photo");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  auth = null;
  root = null;
  container = null;
  harness.captured = null;
  harness.clientReady = null;
  vi.stubGlobal("fetch", vi.fn(transport));
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  const { __resetPintDrops } = await import("@/lib/pintDrops");
  __resetPintDrops();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});

describe("a sign-in the person asked for owns the device over older auth work", () => {
  it.each(["account", "device"] as const)("keeps a sign-in that commits while an explicit %s sign-out still waits on the provider", async (scope) => {
    await signedInElsewhere(A);
    const client = makeClient();
    harness.clientReady = Promise.resolve(client);
    await mount();
    await vi.waitFor(() => expect(viewer()).toBe(A));

    holdLogout = true;
    let signingOut: Promise<void> = Promise.resolve();
    await act(async () => { signingOut = auth!.signOut(scope); });
    await vi.waitFor(() => expect(releaseLogout).not.toBeNull());
    // B signs in from this document. The installed client has no auth lock, so
    // its install can finish before the sign-out's removal does.
    const signingIn = establishAuthCallbackSession(client.auth, {
      accessToken: sessionFor(B).access_token,
      refreshToken: sessionFor(B).refresh_token,
    });
    const bGeneration = readResumeGeneration();
    await act(async () => {
      releaseLogout!();
      await signingOut;
      await signingIn;
    });
    await settle();

    expect(bGeneration).toMatch(new RegExp(`~${B}$`));
    expect(readResumeGeneration()).toBe(bGeneration);
    expect(storedSdkAccount()).toBe(B);
    await vi.waitFor(() => expect(viewer()).toBe(B));
    expect(auth?.session?.user.id).toBe(B);
    expect(sessionAccountAdmitted(B)).toBe(true);
    expect(deviceAccountOwner(localStorage)).toBe(B);
    await vi.waitFor(async () => expect(await redeemedAccount()).toBe(B));
  });

  it("restores the remembered account when the SDK still holds an older account's session", async () => {
    await signedInElsewhere(A);
    const staleA = sdkItems.get(SDK_STORAGE_KEY)!;
    await signedInElsewhere(B);
    // This browser's SDK storage still carries A (a write the other document's sign-in never replaced).
    sdkItems.set(SDK_STORAGE_KEY, staleA);
    harness.clientReady = Promise.resolve(makeClient());
    await mount();

    await vi.waitFor(() => expect(viewer()).toBe(B));
    expect(auth?.session?.user.id).toBe(B);
    expect(storedSdkAccount()).toBe(B);
    expect(readResumeGeneration()).toMatch(new RegExp(`~${B}$`));
    expect(await redeemedAccount()).toBe(B);
  });

  it("does not install an owned callback over a sign-in that committed while the SDK was downloading", async () => {
    document.cookie = "pubmax_resume_gen=g0; Path=/";
    harness.captured = {
      attempt: {
        attemptId: null,
        tokens: { accessToken: sessionFor(A).access_token, refreshToken: sessionFor(A).refresh_token },
        providerError: false,
      },
      cleanUrl: "/map",
      localAttemptOwned: true,
      releaseCoordination: () => {},
    };
    let finishDownload = () => {};
    harness.clientReady = new Promise((resolve) => { finishDownload = () => resolve(makeClient()); });
    await mount();

    await signedInElsewhere(B);
    await act(async () => { finishDownload(); });
    await settle();

    await vi.waitFor(() => expect(viewer()).toBe(B));
    expect(readResumeGeneration()).toMatch(new RegExp(`~${B}$`));
    expect(storedSdkAccount()).toBe(B);
    expect(auth?.session?.user.id).toBe(B);
    expect(await redeemedAccount()).toBe(B);
  });

  it("still installs an owned callback when nothing else signed in meanwhile", async () => {
    harness.captured = {
      attempt: {
        attemptId: null,
        tokens: { accessToken: sessionFor(A).access_token, refreshToken: sessionFor(A).refresh_token },
        providerError: false,
      },
      cleanUrl: "/map",
      localAttemptOwned: true,
      releaseCoordination: () => {},
    };
    let finishDownload = () => {};
    harness.clientReady = new Promise((resolve) => { finishDownload = () => resolve(makeClient()); });
    await mount();
    await act(async () => { finishDownload(); });

    await vi.waitFor(() => expect(viewer()).toBe(A));
    expect(readResumeGeneration()).toMatch(new RegExp(`~${A}$`));
    expect(storedSdkAccount()).toBe(A);
    await vi.waitFor(async () => expect(await redeemedAccount()).toBe(A));
  });
});

async function fill(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** An account's own unfinished Pint Drop in the mounted composer: note, price and a pint photo. */
async function draftAs(id: string, note: string) {
  await vi.waitFor(() => expect(container?.querySelector("button")).not.toBeNull());
  const toggle = [...container!.querySelectorAll("button")].find((button) => button.textContent?.trim() === SPILL_EXTRAS_TOGGLE_LABEL);
  expect(toggle).toBeDefined();
  await act(async () => toggle!.click());
  await fill(container!.querySelector("textarea")!, note);
  await fill(container!.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!, "5.75");
  const photo = container!.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    Object.defineProperty(photo, "files", { configurable: true, value: [new File(["synthetic-jpeg"], `${id}-pint.jpg`, { type: "image/jpeg" })] });
    photo.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await vi.waitFor(() => expect(storedDraftOf(id)).toMatchObject({ note, price: "5.75" }));
  await vi.waitFor(() => expect(composerShows()).toEqual({ note, price: "5.75", photos: 1 }));
}

async function draftAsB() {
  await draftAs(B, NOTE_B);
}

function storedDraftOf(id: string) {
  return readPintDropDraft(sessionStorage, VENUE_ID, pintDropAccountDraftOwner(id))?.form ?? null;
}

function composerShows() {
  return {
    note: container?.querySelector("textarea")?.value ?? null,
    price: container?.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.value ?? null,
    photos: container?.querySelectorAll('img[src="blob:fixture-photo"]').length ?? 0,
  };
}

/** A is signed in here; its sign-out waits on the provider while B signs in fully and starts a draft. */
async function settledBDuringSignOut(scope: "account" | "device") {
  await signedInElsewhere(A);
  const client = makeClient();
  harness.clientReady = Promise.resolve(client);
  harness.composer = true;
  await mount();
  await vi.waitFor(() => expect(viewer()).toBe(A));
  holdLogout = true;
  let signingOut: Promise<void> = Promise.resolve();
  await act(async () => { signingOut = auth!.signOut(scope); });
  await vi.waitFor(() => expect(releaseLogout).not.toBeNull());
  await act(async () => {
    await establishAuthCallbackSession(client.auth, {
      accessToken: sessionFor(B).access_token,
      refreshToken: sessionFor(B).refresh_token,
    });
  });
  await vi.waitFor(() => expect(viewer()).toBe(B));
  await vi.waitFor(async () => expect(await redeemedAccount()).toBe(B));
  await draftAsB();
  return { client, release: async () => { await act(async () => { releaseLogout!(); await signingOut; }); await settle(); } };
}

describe("an older sign-out that lands after a newer sign-in settled", () => {
  it.each(["account", "device"] as const)("keeps B's open Pint Drop draft through an %s sign-out of A", async (scope) => {
    const { release } = await settledBDuringSignOut(scope);
    const bGeneration = readResumeGeneration();
    await release();

    await vi.waitFor(() => expect(viewer()).toBe(B));
    expect(readResumeGeneration()).toBe(bGeneration);
    expect(storedDraftOf(B)).toMatchObject({ note: NOTE_B, price: "5.75" });
    await vi.waitFor(() => expect(composerShows()).toEqual({ note: NOTE_B, price: "5.75", photos: 1 }));
    expect(deviceAccountOwner(localStorage)).toBe(B);
    expect(readDeviceAccounts(localStorage).map((account) => account.userId)).toEqual([B]);
  });

  it("reports an unreachable remembered sign-in as unavailable, not signed out, and keeps B's draft", async () => {
    const { release } = await settledBDuringSignOut("account");
    resumeTransportDown = true;
    await release();

    expect(auth?.user ?? null).toBeNull();
    expect(auth?.supabaseAuthState).toBe("unavailable");
    expect(storedDraftOf(B)).toMatchObject({ note: NOTE_B, price: "5.75" });

    resumeTransportDown = false;
    expect(await redeemedAccount()).toBe(B);
  });
});

describe("an explicit sign-out overlapped by another document's auth work", () => {
  it("still forgets every remembered account when another tab signs out meanwhile", async () => {
    await signedInElsewhere(A);
    rememberDeviceAccount(localStorage, { userId: "account-c", refreshToken: "synthetic-refresh-account-c", email: null }, Date.now());
    harness.clientReady = Promise.resolve(makeClient());
    await mount();
    await vi.waitFor(() => expect(viewer()).toBe(A));
    expect(readDeviceAccounts(localStorage).length).toBeGreaterThan(0);

    holdLogout = true;
    let signingOut: Promise<void> = Promise.resolve();
    await act(async () => { signingOut = auth!.signOut("device"); });
    await vi.waitFor(() => expect(releaseLogout).not.toBeNull());
    // Another tab's account sign-out moves the device to its own signed-out generation.
    document.cookie = "pubmax_resume_gen=out.othertab; Path=/";
    await act(async () => { releaseLogout!(); await signingOut; });
    await settle();

    expect(readDeviceAccounts(localStorage)).toEqual([]);
    expect(deviceAccountOwner(localStorage)).toBeNull();
    expect(viewer()).toBe("signed-out");
    expect(await redeemedAccount()).toBeNull();
  });

  it.each(["account", "device"] as const)("finishes A's %s sign-out when the newer sign-in that overtook it fails", async (scope) => {
    const NOTE_A = "A's private note about the back room";
    await signedInElsewhere(A);
    rememberDeviceAccount(localStorage, { userId: "account-c", refreshToken: "synthetic-refresh-account-c", email: null }, Date.now());
    const client = makeClient();
    harness.clientReady = Promise.resolve(client);
    harness.composer = true;
    await mount();
    await vi.waitFor(() => expect(viewer()).toBe(A));
    // A's cached handle, as the identity cache keeps it for the device owner.
    localStorage.setItem("pubmax_handle", "account_a");
    await draftAs(A, NOTE_A);
    expect(deviceAccountOwner(localStorage)).toBe(A);

    holdLogout = true;
    let signingOut: Promise<void> = Promise.resolve();
    await act(async () => { signingOut = auth!.signOut(scope); });
    await vi.waitFor(() => expect(releaseLogout).not.toBeNull());
    // B's sign-in commits, but its token check is still out when A's sign-out continues.
    refuseUser.add(B);
    let refuseB = () => {};
    holdUser = new Promise<void>((resolve) => { refuseB = resolve; });
    const signingIn = establishAuthCallbackSession(client.auth, {
      accessToken: sessionFor(B).access_token,
      refreshToken: sessionFor(B).refresh_token,
    });
    await act(async () => { releaseLogout!(); await signingOut; });
    await act(async () => { refuseB(); await signingIn; });
    await settle();

    expect((await signingIn).failed).toBe(true);
    expect(readResumeGeneration()).toMatch(/^out\./);
    expect(sessionAccountAdmitted(A)).toBe(false);
    expect(await redeemedAccount()).toBeNull();
    expect(viewer()).toBe("signed-out");
    expect(deviceAccountOwner(localStorage)).toBeNull();
    expect(localStorage.getItem("pubmax_handle")).toBeNull();
    expect(readDeviceAccounts(localStorage).map((account) => account.userId)).toEqual(scope === "device" ? [] : ["account-c"]);
    expect(storedDraftOf(A)).toBeNull();
    await vi.waitFor(() => expect(composerShows()).toEqual({ note: null, price: "", photos: 0 }));
  });
});
