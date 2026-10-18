// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AuthError, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "@/components/auth/authContext";

const h = vi.hoisted(() => ({
  realAuth: null as SupabaseClient | null,
  navigate: vi.fn(), persist: vi.fn(), stopAutoRefresh: vi.fn(),
  nativeOAuth: vi.fn(), exchange: vi.fn(), verify: vi.fn(), authenticate: vi.fn(), cancel: vi.fn(),
  listeners: new Set<(event: { url: string }) => void>(),
  otpBody: null as Record<string, unknown> | null,
  clientHold: null as Promise<void> | null, clientHeld: false, clientFailure: null as null | "missing" | "rejected",
  otpHold: null as Promise<Response> | null, otpHeld: false,
  bootstrap: { status: "none" } as { status: "none" } | { status: "expired"; maskedEmail: string },
  userReads: 0, userHoldAt: 0, userHold: null as Promise<void> | null, userHeld: false,
}));
vi.mock("@capacitor/app", () => ({ App: {
  addListener: async (_name: string, listener: (event: { url: string }) => void) => {
    h.listeners.add(listener); return { remove: async () => { h.listeners.delete(listener); } };
  },
  getLaunchUrl: async () => null,
} }));
vi.mock("next/navigation", () => { const router = { push: h.navigate }; return { useRouter: () => router, usePathname: () => "/login" }; });
vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/nativePlatform", () => ({ nativePlatform: () => "ios", isNativeApp: () => true }));
vi.mock("@/lib/nativeAuthSession", async (original) => ({
  ...await original<typeof import("@/lib/nativeAuthSession")>(),
  nativeAuthSessionAvailable: async () => true,
  authenticateNativeSession: h.authenticate,
  cancelNativeAuthSession: h.cancel,
}));
vi.mock("@/lib/authClient", async (original) => ({
  ...await original<typeof import("@/lib/authClient")>(),
  createNativeAuthClient: async () => ({ auth: {
    signInWithOAuth: h.nativeOAuth, exchangeCodeForSession: h.exchange, getUser: h.verify, stopAutoRefresh: h.stopAutoRefresh,
  } }),
  isAuthConfigured: () => true,
  ensureSupabaseBrowser: async () => {
    const hold = h.clientHold;
    if (hold) { h.clientHold = null; h.clientHeld = true; await hold; }
    const failure = h.clientFailure;
    h.clientFailure = null;
    if (failure === "rejected") throw new Error("client unavailable");
    return failure === "missing" ? null : h.realAuth;
  },
  getAccessToken: async () => (await h.realAuth!.auth.getSession()).data.session?.access_token ?? null,
}));
vi.mock("@/lib/authSessionBootstrap", () => ({
  AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS: 20_000,
  bootstrapAuthSession: async () => h.bootstrap,
}));
vi.mock("@/lib/identityClient", async (original) => ({
  ...await original<typeof import("@/lib/identityClient")>(),
  identityHandleForOwner: () => null,
  resolveCanonicalIdentity: async () => ({ ok: true, identity: null }),
}));
vi.mock("@/lib/authSessionResumeClient", async (original) => ({
  ...await original<typeof import("@/lib/authSessionResumeClient")>(),
  persistSessionForResume: h.persist, resumeAlreadyPersisted: () => true,
}));
import LoginPage from "@/components/auth/LoginPage";
import SignInButton from "@/components/auth/SignInButton";
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";

const token = ["e30", Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), "unsigned"].join(".");
const replacement = { user: { id: "replacement", email: "native@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" }, access_token: token, refresh_token: "replacement-refresh" } as Session;
const uiOperations: { promise: Promise<{ error: string | null }>; result?: { error: string | null } }[] = [];
function Surface({ surface }: { surface: "page" | "nav" }) {
  const auth = useAuth();
  const track = (start: AuthContextValue["signInWithGoogle"]) => (next?: string) => {
    const promise = next ? start(next) : start();
    const operation = { promise } as (typeof uiOperations)[number];
    uiOperations.push(operation);
    void promise.then((result) => { operation.result = result; }, () => {});
    return promise;
  };
  return createElement(AuthContext.Provider, { value: {
    ...auth,
    signInWithGoogle: track(auth.signInWithGoogle),
    signInWithApple: track(auth.signInWithApple),
    signInWithMicrosoft: track(auth.signInWithMicrosoft),
  } }, surface === "page" ? createElement(LoginPage) : createElement(SignInButton));
}
function Probe() {
  const auth = useAuth();
  return createElement("output", null, auth.user?.id ?? "signed-out");
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); uiOperations.length = 0;
  h.realAuth = null; h.otpBody = null; h.listeners.clear(); h.clientHold = null; h.clientHeld = false; h.clientFailure = null;
  h.otpHold = null; h.otpHeld = false; h.bootstrap = { status: "none" };
  h.userReads = 0; h.userHoldAt = 0; h.userHold = null; h.userHeld = false;
  h.persist.mockResolvedValue("stored"); h.stopAutoRefresh.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, callback: () => Promise<unknown>) => callback() } });
  window.history.replaceState(null, "", "/login");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://native-email-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_offline_fixture");
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.href);
    if (url.pathname === "/api/auth/providers") return Response.json({ google: true, apple: true, microsoft: true });
    if (url.pathname === "/auth/v1/otp") {
      h.otpBody = JSON.parse(String(init?.body));
      const hold = h.otpHold;
      if (hold) { h.otpHold = null; h.otpHeld = true; return hold; }
      return Response.json({});
    }
    if (url.pathname === "/auth/v1/user") {
      h.userReads += 1;
      const hold = h.userHold;
      if (hold && h.userReads === h.userHoldAt) { h.userHeld = true; await hold; }
      return Response.json(replacement.user);
    }
    return Response.json({});
  });
  h.nativeOAuth.mockResolvedValue({ data: { url: "https://native-auth-test.supabase.co/auth/v1/authorize" }, error: null });
  h.exchange.mockResolvedValue({ data: { session: replacement }, error: null });
  h.verify.mockResolvedValue({ data: { user: replacement.user }, error: null });
  h.authenticate.mockImplementation(async ({ attemptId }: { attemptId: string }) => ({ url: `pubmaxx://native-auth/callback?code=one-use-code&_authAttempt=${attemptId}#` }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await h.realAuth?.auth.stopAutoRefresh();
  container.remove();
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});

function providerButton(name: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="Continue with ${name}"]`);
  expect(button).not.toBeNull();
  return button!;
}
function emailField(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('input[type="email"]')!;
}
async function enterEmail() {
  await act(async () => {
    const input = emailField();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "native@example.test");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(button: HTMLButtonElement) {
  await act(async () => button.click());
}
async function mountSurface(surface: "page" | "nav") {
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(createElement(AuthProvider, { clerkIntegrationConfigured: false },
    createElement(Probe), createElement(Surface, { surface }))));
}
function cancelButton(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>(".authMagicLinkCancel")!;
}

describe("provider UI settlement through native callbacks and canonical SDK", () => {
  it("re-enables email and each provider after cancelled verification on both surfaces", async () => {
    const actual = await vi.importActual<typeof import("@/lib/authClient")>("@/lib/authClient");
    const transport = fetch;
    let release!: () => void;
    let verification: Promise<void> | null = null;
    let verifying = false;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), window.location.href).pathname === "/auth/v1/user" && verification) {
        verifying = true;
        await verification;
      }
      return transport(input, init);
    });
    await act(async () => root.unmount());
    h.realAuth = await actual.ensureSupabaseBrowser();
    root = createRoot(container);
    const { rememberDeviceAccount, readDeviceAccounts } = await import("@/lib/deviceAccountSessions");
    rememberDeviceAccount(localStorage, { userId: "original", refreshToken: "original-refresh", handle: "original_owner" }, 1_700_000_000_000);
    localStorage.setItem("pubmax_handle", "original_owner");
    localStorage.setItem("pubmax_account_owner", "original");
    const remembered = readDeviceAccounts(localStorage);
    for (const surface of ["page", "nav"] as const) {
      for (const name of ["Google", "Apple", "Microsoft"]) {
        await mountSurface(surface);
        h.otpBody = null;
        await enterEmail();
        await click(container.querySelector<HTMLButtonElement>('.authMagicLink button[type="submit"]')!);
        await act(async () => { await vi.waitFor(() => expect(h.otpBody).not.toBeNull()); });
        expect(cancelButton()).not.toBeNull();
        verifying = false;
        verification = new Promise<void>((resolve) => { release = resolve; });
        const cleanupCalls = h.stopAutoRefresh.mock.calls.length;
        await click(providerButton(name));
        await vi.waitFor(() => expect(verifying).toBe(true));
        expect(providerButton(name).disabled).toBe(true);
        await click(cancelButton());
        await act(async () => { release(); await uiOperations.at(-1)!.promise; });
        expect(uiOperations.at(-1)!.result).toEqual({ error: null });
        await vi.waitFor(() => expect(h.stopAutoRefresh.mock.calls.length).toBe(cleanupCalls + 1));
        expect((await h.realAuth!.auth.getSession()).data.session).toBeNull();
        expect(container.querySelector("output")?.textContent).toBe("signed-out");
        expect(readDeviceAccounts(localStorage)).toEqual(remembered);
        expect(localStorage.getItem("pubmax_handle")).toBe("original_owner");
        expect(h.persist).not.toHaveBeenCalled();
        expect(h.navigate).not.toHaveBeenCalled();
        expect.soft(emailField().disabled, `${surface} ${name} email retry`).toBe(false);
        expect.soft(providerButton(name).disabled, `${surface} ${name} provider retry`).toBe(false);
        verification = null;
        if (!emailField().disabled && !providerButton(name).disabled) {
          h.otpBody = null;
          await enterEmail();
          await click(container.querySelector<HTMLButtonElement>('.authMagicLink button[type="submit"]')!);
          await act(async () => { await vi.waitFor(() => expect(h.otpBody).not.toBeNull()); });
          expect(cancelButton()).not.toBeNull();
          verifying = false;
          verification = new Promise<void>((resolve) => { release = resolve; });
          const oldOperations = uiOperations.length;
          await click(providerButton(name));
          await vi.waitFor(() => expect(verifying).toBe(true));
          await click(cancelButton());
          await act(async () => { release(); await uiOperations.at(-1)!.promise; });
          expect(uiOperations.length).toBe(oldOperations + 1);
          expect(uiOperations.at(-1)!.result).toEqual({ error: null });
          expect(emailField().disabled).toBe(false);
          expect(providerButton(name).disabled).toBe(false);
          expect((await h.realAuth!.auth.getSession()).data.session).toBeNull();
          expect(readDeviceAccounts(localStorage)).toEqual(remembered);
          verification = null;
        }
      }
    }
  });
});

describe("a still-mounted email form after its native start loses ownership", () => {
  const ALERTS = '.authMagicLink [role="alert"]';
  async function mountPage() {
    const actual = await vi.importActual<typeof import("@/lib/authClient")>("@/lib/authClient");
    await act(async () => root.unmount());
    h.realAuth = await actual.ensureSupabaseBrowser();
    await mountSurface("page");
    await enterEmail();
  }
  function submit() {
    return click(container.querySelector<HTMLButtonElement>('.authMagicLink button[type="submit"]')!);
  }
  async function expectQuietForm() {
    await vi.waitFor(() => expect(container.querySelector<HTMLButtonElement>('.authMagicLink button[type="submit"]')!.textContent).not.toBe("Sending…"), { timeout: 1000 });
    expect(container.querySelector(ALERTS)).toBeNull();
    expect(container.querySelector(".authMagicLinkSuccess")).toBeNull();
    expect(container.querySelector(".authMagicLinkCancel")).toBeNull();
    expect(emailField().getAttribute("aria-invalid")).toBe("false");
  }

  it("shows no link-expiry alert when a restored page cancels a start held at client lookup", async () => {
    await mountPage();
    let release!: () => void;
    h.clientHold = new Promise<void>((resolve) => { release = resolve; });
    try {
      await submit();
      await vi.waitFor(() => expect(h.clientHeld).toBe(true), { timeout: 1000 });
      expect(localStorage.getItem("pubmax_native_email_attempt_v1")).toBeNull();
      await act(async () => { window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true })); });
    } finally { await act(async () => { release(); }); }
    await expectQuietForm();
    expect(emailField().disabled).toBe(false);
    expect(container.textContent).not.toContain("The link may be invalid or expired");
    expect(h.otpBody).toBeNull();
    expect(localStorage.getItem("pubmax_native_email_attempt_v1")).toBeNull();
    expect((await h.realAuth!.auth.getSession()).data.session).toBeNull();
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
  });

  it("shows no storage alert when a provider start supersedes the email during receipt crypto", async () => {
    await mountPage();
    let release!: (digest: ArrayBuffer) => void;
    const held = new Promise<ArrayBuffer>((resolve) => { release = resolve; });
    let holding = false;
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async () => { holding = true; return held; })
      .mockImplementation((...args: Parameters<typeof digest>) => digest(...args));
    let cancelProvider!: (error: Error) => void;
    h.authenticate.mockImplementationOnce(() => new Promise((_resolve, reject) => { cancelProvider = reject; }));
    try {
      await submit();
      await vi.waitFor(() => expect(holding).toBe(true), { timeout: 1000 });
      await click(providerButton("Google"));
      await vi.waitFor(() => expect(h.authenticate).toHaveBeenCalledOnce(), { timeout: 1000 });
      await act(async () => { release(new ArrayBuffer(32)); });
      await expectQuietForm();
      expect(emailField().disabled).toBe(true);
      expect(container.textContent).not.toContain("Sign-in needs browser storage");
      expect(h.otpBody).toBeNull();
      expect(localStorage.getItem("pubmax_native_email_attempt_v1")).toBeNull();
    } finally {
      release(new ArrayBuffer(32));
      await act(async () => { cancelProvider?.(new Error("cancelled")); await uiOperations.at(-1)?.promise.catch(() => {}); });
    }
    await vi.waitFor(() => expect(emailField().disabled).toBe(false), { timeout: 1000 });
    expect(container.querySelector(ALERTS)).toBeNull();
    expect((await h.realAuth!.auth.getSession()).data.session).toBeNull();
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
  });

  async function expectNoEmailStarted() {
    expect(container.textContent).not.toContain("The link may be invalid or expired");
    expect(h.otpBody).toBeNull();
    expect(localStorage.getItem("pubmax_native_email_attempt_v1")).toBeNull();
    expect(localStorage.getItem("pubmax_auth_active_attempt")).toBeNull();
    expect((await h.realAuth!.auth.getSession()).data.session).toBeNull();
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
  }

  it.each(["missing", "rejected"] as const)("names an unavailable auth client when it is %s before a link exists", async (failure) => {
    await mountPage();
    h.clientFailure = failure;
    await submit();
    await vi.waitFor(() => expect(container.querySelector(ALERTS)?.textContent).toBe("Sign-in is not configured."), { timeout: 1000 });
    await expectNoEmailStarted();
  });

  it.each(["rejected", "errored"] as const)("says the sign-in state is unconfirmed when the session lookup is %s", async (failure) => {
    await mountPage();
    const lookup = vi.spyOn(h.realAuth!.auth, "getSession").mockImplementationOnce(async () => {
      if (failure === "rejected") throw new Error("lookup failed");
      return { data: { session: null }, error: new AuthError("lookup failed") };
    });
    await submit();
    await vi.waitFor(() => expect(container.querySelector(ALERTS)?.textContent).toBe("Your sign-in state could not be confirmed. Try again."), { timeout: 1000 });
    expect(lookup).toHaveBeenCalled();
    await expectNoEmailStarted();
  });

  it.each([
    ["restored page", "sent"], ["restored page", "failed"], ["provider start", "sent"], ["provider start", "failed"],
  ] as const)("keeps the form quiet when a %s takes over before a held %s email response settles", async (change, outcome) => {
    await mountPage();
    const response = () => outcome === "sent" ? Response.json({}) : Response.json({ msg: "upstream failure" }, { status: 500 });
    let release!: (response: Response) => void;
    h.otpHold = new Promise<Response>((resolve) => { release = resolve; });
    let cancelProvider: ((error: Error) => void) | undefined;
    if (change === "provider start") {
      h.authenticate.mockImplementationOnce(() => new Promise((_resolve, reject) => { cancelProvider = reject; }));
    }
    try {
      await submit();
      await vi.waitFor(() => expect(h.otpHeld).toBe(true), { timeout: 1000 });
      expect(localStorage.getItem("pubmax_native_email_attempt_v1")).not.toBeNull();
      if (change === "restored page") {
        await act(async () => { window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true })); });
      } else {
        await click(providerButton("Google"));
        await vi.waitFor(() => expect(h.authenticate).toHaveBeenCalledOnce(), { timeout: 1000 });
      }
      await act(async () => { release(response()); });
      await expectQuietForm();
      expect(container.querySelector<HTMLButtonElement>('.authMagicLink button[type="submit"]')!.textContent).not.toBe("Link sent");
      expect(localStorage.getItem("pubmax_native_email_attempt_v1")).toBeNull();
    } finally {
      release(response());
      if (cancelProvider) await act(async () => { cancelProvider!(new Error("cancelled")); await uiOperations.at(-1)?.promise.catch(() => {}); });
    }
    await vi.waitFor(() => expect(emailField().disabled).toBe(false), { timeout: 1000 });
    expect(container.querySelector(ALERTS)).toBeNull();
    expect((await h.realAuth!.auth.getSession()).data.session).toBeNull();
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
    expect(h.persist).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  });
});

describe("a native start queued behind an older canonical installation after a restored page", () => {
  const RECEIPT = "pubmax_native_email_attempt_v1";
  const MASKED = "n•••@example.test";
  let release: () => void = () => {};
  let providerReads = 0;
  let resumeBodies: Record<string, unknown>[] = [];

  async function mountHeldPage(canonicalRead: number) {
    const actual = await vi.importActual<typeof import("@/lib/authClient")>("@/lib/authClient");
    const transport = fetch;
    providerReads = 0; resumeBodies = [];
    h.userReads = 0; h.userHoldAt = canonicalRead; h.userHeld = false;
    h.userHold = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.href);
      if (url.pathname === "/auth/v1/token") {
        return Response.json({ ...replacement, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 });
      }
      if (url.pathname === "/api/auth/session" && init?.method === "POST") {
        resumeBodies.push(JSON.parse(String(init.body)));
        return Response.json({ status: "sent", message: "Check your email." });
      }
      const response = await transport(input, init);
      if (url.pathname === "/api/auth/providers") {
        const read = response.json.bind(response);
        response.json = async () => { const body: unknown = await read(); providerReads += 1; return body; };
      }
      return response;
    });
    await act(async () => root.unmount());
    h.realAuth = await actual.ensureSupabaseBrowser();
    await mountSurface("page");
  }
  async function restorePage() {
    await act(async () => { window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true })); });
  }
  async function holdGoogleInstallation() {
    await click(providerButton("Google"));
    await vi.waitFor(() => expect(h.userHeld).toBe(true), { timeout: 1000 });
    expect(h.authenticate).toHaveBeenCalledOnce();
    expect(providerButton("Apple").disabled).toBe(true);
    await restorePage();
    expect(providerButton("Apple").disabled).toBe(false);
  }
  async function queueProvider(name: string) {
    const reads = providerReads;
    const operations = uiOperations.length;
    await click(providerButton(name));
    await vi.waitFor(() => expect(providerReads).toBe(reads + 1), { timeout: 1000 });
    expect(uiOperations.length).toBe(operations + 1);
    expect(h.authenticate).toHaveBeenCalledOnce();
    return uiOperations.at(-1)!;
  }
  function submitButton() {
    return container.querySelector<HTMLButtonElement>('.authMagicLink button[type="submit"]')!;
  }
  function resumeButton() {
    return [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => /^(Continue as |Sending…|Link sent)/.test(button.textContent ?? ""));
  }
  async function expectNothingStartedAfterCancel() {
    expect(h.authenticate).toHaveBeenCalledOnce();
    expect(h.nativeOAuth).toHaveBeenCalledOnce();
    expect(h.otpBody).toBeNull();
    expect(localStorage.getItem(RECEIPT)).toBeNull();
    expect(localStorage.getItem("pubmax_auth_active_attempt")).toBeNull();
    await vi.waitFor(async () => expect((await h.realAuth!.auth.getSession()).data.session).toBeNull(), { timeout: 1000 });
    expect(h.persist).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  }

  it.each(["Apple", "Microsoft", "Google"])("does not open %s after Cancel sign-in cancels its queued start", async (name) => {
    await mountHeldPage(1);
    await enterEmail();
    await click(submitButton());
    await vi.waitFor(() => expect(h.otpBody).not.toBeNull(), { timeout: 1000 });
    h.otpBody = null;
    let queued: (typeof uiOperations)[number] | undefined;
    try {
      await holdGoogleInstallation();
      expect(cancelButton()).not.toBeNull();
      queued = await queueProvider(name);
      expect(providerButton(name).disabled).toBe(true);
      await click(cancelButton());
    } finally { await act(async () => { release(); await queued?.promise; }); }
    expect(queued!.result).toEqual({ error: null });
    await expectNothingStartedAfterCancel();
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
    expect(providerButton(name).disabled).toBe(false);
    expect(emailField().disabled).toBe(false);
  });

  it("does not send an email start that a second restored page cancels while queued", async () => {
    await mountHeldPage(1);
    try {
      await holdGoogleInstallation();
      await enterEmail();
      await click(submitButton());
      expect(submitButton().textContent).toBe("Sending…");
      await restorePage();
    } finally { await act(async () => { release(); }); }
    await vi.waitFor(() => expect(submitButton().textContent).not.toBe("Sending…"), { timeout: 1000 });
    expect(container.querySelector(".authMagicLinkSuccess")).toBeNull();
    expect(container.querySelector('.authMagicLink [role="alert"]')).toBeNull();
    await expectNothingStartedAfterCancel();
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
  });

  it("does not request a welcome-back resume that a restored page cancels during an older email installation", async () => {
    h.bootstrap = { status: "expired", maskedEmail: MASKED };
    await mountHeldPage(2);
    await vi.waitFor(() => expect(resumeButton()?.textContent).toBe(`Continue as ${MASKED}`), { timeout: 1000 });
    await click(resumeButton()!);
    await vi.waitFor(() => expect(resumeButton()?.textContent).toBe("Link sent"), { timeout: 1000 });
    expect(resumeBodies).toHaveLength(1);
    const earlier = JSON.parse(localStorage.getItem(RECEIPT)!) as { id: string };
    sessionStorage.clear();
    await mountSurface("page");
    await vi.waitFor(() => expect(resumeButton()?.textContent).toBe(`Continue as ${MASKED}`), { timeout: 1000 });
    await vi.waitFor(() => expect(h.listeners.size).toBeGreaterThan(0), { timeout: 1000 });
    try {
      await act(async () => {
        for (const listener of h.listeners) listener({ url: `pubmaxx://native-email/callback?code=one-use-email-code&_authAttempt=${earlier.id}` });
      });
      await vi.waitFor(() => expect(h.userHeld).toBe(true), { timeout: 1000 });
      await click(resumeButton()!);
      expect(resumeButton()?.textContent).toBe("Sending…");
      await restorePage();
    } finally { await act(async () => { release(); }); }
    await vi.waitFor(() => expect(resumeButton()?.textContent).toBe(`Continue as ${MASKED}`), { timeout: 1000 });
    expect(resumeBodies).toHaveLength(1);
    expect(h.authenticate).not.toHaveBeenCalled();
    expect(localStorage.getItem(RECEIPT)).toBeNull();
    expect(localStorage.getItem("pubmax_auth_active_attempt")).toBeNull();
    await vi.waitFor(async () => expect((await h.realAuth!.auth.getSession()).data.session).toBeNull(), { timeout: 1000 });
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
    expect(h.persist).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("does not open a queued provider after the auth provider unmounts", async () => {
    await mountHeldPage(1);
    let queued: (typeof uiOperations)[number] | undefined;
    try {
      await holdGoogleInstallation();
      queued = await queueProvider("Apple");
      await act(async () => root.unmount());
    } finally { await act(async () => { release(); await queued?.promise; }); }
    root = createRoot(container);
    expect(queued!.result).toEqual({ error: null });
    await expectNothingStartedAfterCancel();
  });

  it("lets an uncancelled queued provider continue once the older installation settles", async () => {
    await mountHeldPage(1);
    let queued: (typeof uiOperations)[number] | undefined;
    try {
      await holdGoogleInstallation();
      queued = await queueProvider("Apple");
      h.userHold = null;
    } finally { await act(async () => { release(); await queued?.promise; }); }
    expect(queued!.result).toEqual({ error: null });
    await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("replacement"), { timeout: 1000 });
    expect(h.nativeOAuth.mock.calls.map(([options]) => options.provider)).toEqual(["google", "apple"]);
    const [[first], [second]] = h.authenticate.mock.calls as [[{ attemptId: string }], [{ attemptId: string }]];
    expect(second.attemptId).not.toBe(first.attemptId);
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledOnce(), { timeout: 1000 });
  });

  it("lets an uncancelled queued email continue once the older installation settles", async () => {
    await mountHeldPage(1);
    try {
      await holdGoogleInstallation();
      await enterEmail();
      await click(submitButton());
      expect(submitButton().textContent).toBe("Sending…");
      h.userHold = null;
    } finally { await act(async () => { release(); }); }
    await vi.waitFor(() => expect(container.querySelector(".authMagicLinkCancel")).not.toBeNull(), { timeout: 1000 });
    expect(h.otpBody?.email).toBe("native@example.test");
    const receipt = JSON.parse(localStorage.getItem(RECEIPT)!) as { id: string; expectedEmail: string };
    expect(receipt.expectedEmail).toBe("native@example.test");
    expect(h.authenticate).toHaveBeenCalledOnce();
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
  });

  it("gives the newer queued provider ownership after a restored page cancels the earlier one", async () => {
    await mountHeldPage(1);
    let earlier: (typeof uiOperations)[number] | undefined;
    let newer: (typeof uiOperations)[number] | undefined;
    try {
      await holdGoogleInstallation();
      earlier = await queueProvider("Apple");
      await restorePage();
      newer = await queueProvider("Microsoft");
      h.userHold = null;
    } finally { await act(async () => { release(); await earlier?.promise; await newer?.promise; }); }
    expect(earlier!.result).toEqual({ error: null });
    expect(newer!.result).toEqual({ error: null });
    await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("replacement"), { timeout: 1000 });
    expect(h.nativeOAuth.mock.calls.map(([options]) => options.provider)).toEqual(["google", "azure"]);
    expect(h.authenticate).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledOnce(), { timeout: 1000 });
  });
});

describe("a native provider start held at its fresh provider settings read", () => {
  const RECEIPT = "pubmax_native_email_attempt_v1";
  const ENABLED = { google: true, apple: true, microsoft: true };
  let settings: ((response: Response) => void) | null = null;
  let settingsHeld = false;

  async function mountWithSentLink() {
    const actual = await vi.importActual<typeof import("@/lib/authClient")>("@/lib/authClient");
    const transport = fetch;
    settings = null; settingsHeld = false;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.href);
      if (url.pathname === "/auth/v1/token") {
        return Response.json({ ...replacement, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 });
      }
      if (url.pathname === "/api/auth/providers" && url.searchParams.get("fresh") === "1" && !settingsHeld) {
        settingsHeld = true;
        return new Promise<Response>((resolve) => { settings = resolve; });
      }
      return transport(input, init);
    });
    await act(async () => root.unmount());
    h.realAuth = await actual.ensureSupabaseBrowser();
    await mountSurface("page");
    await enterEmail();
    await click(container.querySelector<HTMLButtonElement>('.authMagicLink button[type="submit"]')!);
    await vi.waitFor(() => expect(cancelButton()).not.toBeNull(), { timeout: 1000 });
    expect(h.otpBody?.email).toBe("native@example.test");
    expect(localStorage.getItem(RECEIPT)).not.toBeNull();
  }
  async function holdSettings(name: string) {
    const operations = uiOperations.length;
    await click(providerButton(name));
    await vi.waitFor(() => expect(settingsHeld).toBe(true), { timeout: 1000 });
    expect(uiOperations.length).toBe(operations + 1);
    return uiOperations.at(-1)!;
  }
  function releaseSettings(response: Response = Response.json(ENABLED)) {
    const resolve = settings;
    settings = null;
    resolve?.(response);
  }
  async function expectNothingOpened() {
    expect(h.authenticate).not.toHaveBeenCalled();
    expect(h.nativeOAuth).not.toHaveBeenCalled();
    expect(localStorage.getItem(RECEIPT)).toBeNull();
    expect(localStorage.getItem("pubmax_auth_active_attempt")).toBeNull();
    await vi.waitFor(async () => expect((await h.realAuth!.auth.getSession()).data.session).toBeNull(), { timeout: 1000 });
    expect(h.persist).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  }

  it.each(["Google", "Apple", "Microsoft"])("does not open %s after Cancel sign-in during its settings read", async (name) => {
    await mountWithSentLink();
    let operation: (typeof uiOperations)[number] | undefined;
    try {
      operation = await holdSettings(name);
      expect(providerButton(name).disabled).toBe(true);
      await click(cancelButton());
    } finally { await act(async () => { releaseSettings(); await operation?.promise; }); }
    expect(operation!.result).toEqual({ error: null });
    await expectNothingOpened();
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
    expect(providerButton(name).disabled).toBe(false);
    expect(container.querySelector(".loginPageError")).toBeNull();
  });

  it("does not open a provider whose settings read outlives the auth provider", async () => {
    await mountWithSentLink();
    let operation: (typeof uiOperations)[number] | undefined;
    try {
      operation = await holdSettings("Apple");
      await act(async () => root.unmount());
    } finally { await act(async () => { releaseSettings(); await operation?.promise; }); }
    root = createRoot(container);
    expect(operation!.result).toEqual({ error: null });
    expect(h.authenticate).not.toHaveBeenCalled();
    expect(h.nativeOAuth).not.toHaveBeenCalled();
    expect((await h.realAuth!.auth.getSession()).data.session).toBeNull();
    expect(h.persist).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it.each([["Google", "google"], ["Apple", "apple"], ["Microsoft", "azure"]])("opens %s once its uncancelled settings read enables it", async (name, provider) => {
    await mountWithSentLink();
    let operation: (typeof uiOperations)[number] | undefined;
    try {
      operation = await holdSettings(name);
    } finally { await act(async () => { releaseSettings(); await operation?.promise; }); }
    expect(operation!.result).toEqual({ error: null });
    await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("replacement"), { timeout: 1000 });
    expect(h.nativeOAuth.mock.calls.map(([options]) => options.provider)).toEqual([provider]);
    expect(h.authenticate).toHaveBeenCalledOnce();
    expect(localStorage.getItem(RECEIPT)).toBeNull();
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledOnce(), { timeout: 1000 });
  });

  it.each([
    ["disables it", () => Response.json({ ...ENABLED, google: false })],
    ["fails", () => Response.json({ error: "unavailable" }, { status: 503 })],
  ] as const)("names Google unavailable when its uncancelled settings read %s", async (_outcome, response) => {
    await mountWithSentLink();
    let operation: (typeof uiOperations)[number] | undefined;
    try {
      operation = await holdSettings("Google");
    } finally { await act(async () => { releaseSettings(response()); await operation?.promise; }); }
    expect(operation!.result).toEqual({ error: "Google sign-in isn't available right now. Use email instead." });
    await vi.waitFor(() => expect(container.querySelector(".loginPageError")?.textContent)
      .toBe("Google sign-in isn't available right now. Use email instead."), { timeout: 1000 });
    expect(h.authenticate).not.toHaveBeenCalled();
    expect(h.nativeOAuth).not.toHaveBeenCalled();
    expect((await h.realAuth!.auth.getSession()).data.session).toBeNull();
    expect(container.querySelector("output")?.textContent).toBe("signed-out");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("keeps a newer provider open when an earlier provider's settings read settles after a restored page", async () => {
    await mountWithSentLink();
    let finish: (() => void) | undefined;
    h.authenticate.mockImplementationOnce(({ attemptId }: { attemptId: string }) => new Promise((resolve) => {
      finish = () => resolve({ url: `pubmaxx://native-auth/callback?code=one-use-code&_authAttempt=${attemptId}#` });
    }));
    let earlier: (typeof uiOperations)[number] | undefined;
    let newer: (typeof uiOperations)[number] | undefined;
    try {
      earlier = await holdSettings("Google");
      await act(async () => { window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true })); });
      await click(providerButton("Apple"));
      newer = uiOperations.at(-1);
      await vi.waitFor(() => expect(h.authenticate).toHaveBeenCalledOnce(), { timeout: 1000 });
      await act(async () => { releaseSettings(); await earlier?.promise; });
      expect(earlier!.result).toEqual({ error: null });
      expect(h.authenticate).toHaveBeenCalledOnce();
      expect(h.cancel).not.toHaveBeenCalled();
    } finally { await act(async () => { releaseSettings(); finish?.(); await earlier?.promise; await newer?.promise; }); }
    expect(newer!.result).toEqual({ error: null });
    await vi.waitFor(() => expect(container.querySelector("output")?.textContent).toBe("replacement"), { timeout: 1000 });
    expect(h.nativeOAuth.mock.calls.map(([options]) => options.provider)).toEqual(["apple"]);
    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledOnce(), { timeout: 1000 });
  });
});
