import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authActions = vi.hoisted(() => ({
  google: vi.fn(async () => ({ error: null })),
  apple: vi.fn(async () => ({ error: null })),
  email: vi.fn(async () => ({ status: "sent" as const, message: "link sent" })),
  resume: vi.fn(async () => ({ status: "sent" as const, message: "link sent" })),
}));

const loginEntries = vi.hoisted(() => ({
  google: null as null | (() => void | Promise<void>),
  apple: null as null | (() => void | Promise<void>),
  email: null as null | ((email: string) => Promise<unknown>),
  passwordDestination: undefined as string | null | undefined,
}));

const authState = vi.hoisted(() => ({
  current: {
    user: null as { email?: string; user_metadata?: Record<string, unknown> } | null,
    loading: false,
    configured: true,
    supabaseAuthState: "signed-out" as "signed-out" | "unavailable",
    welcomeBack: null as { maskedEmail: string | null } | null,
  },
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => createElement("a", { href, ...rest }, children),
}));

const navigation = vi.hoisted(() => ({ redirect: vi.fn() }));

const requestCookies = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = requestCookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  redirect: navigation.redirect,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: authState.current.user,
    loading: authState.current.loading,
    configured: authState.current.configured,
    supabaseAuthState: authState.current.supabaseAuthState,
    clerkIntegrationConfigured: false,
    socialProviders: { google: true, apple: true , microsoft: false },
    socialProvidersResolved: true,
    signInWithGoogle: authActions.google,
    signInWithApple: authActions.apple,
    signInWithEmail: authActions.email,
    cancelAuthAttempt: vi.fn(),
    signOut: vi.fn(async () => undefined),
    switchAccount: vi.fn(async () => ({ status: "switched" })),
    welcomeBack: authState.current.welcomeBack,
    resumeSignIn: authActions.resume,
    handle: null,
  }),
}));

vi.mock("@/components/auth/MagicLinkForm", () => ({
  default: ({ signInWithEmail }: { signInWithEmail: (email: string) => Promise<unknown> }) => {
    loginEntries.email = signInWithEmail;
    return createElement("form", { className: "authMagicLink" }, "email form");
  },
}));

vi.mock("@/components/auth/SocialSignInButtons", () => ({
  default: ({
    onGoogle,
    onApple,
  }: {
    onGoogle: () => void | Promise<void>;
    onApple: () => void | Promise<void>;
  }) => {
    loginEntries.google = onGoogle;
    loginEntries.apple = onApple;
    return createElement("div", { className: "authProviders" }, "social");
  },
}));

vi.mock("@/components/auth/HandlePasswordSignIn", () => ({
  default: ({ redirectTo }: { redirectTo?: string | null }) => {
    loginEntries.passwordDestination = redirectTo;
    return createElement("div", { className: "authHandlePassword" }, "password");
  },
}));

import LoginPage from "@/components/auth/LoginPage";

// The page declares every prop optional with a `= {}` default, so React's own
// inference reads it as taking none. This names the props it really accepts.
const LoginPageWithProps = LoginPage as FunctionComponent<
  NonNullable<Parameters<typeof LoginPage>[0]>
>;

beforeEach(() => {
  authActions.google.mockClear();
  authActions.apple.mockClear();
  authActions.email.mockClear();
  authActions.resume.mockClear();
  loginEntries.google = null;
  loginEntries.apple = null;
  loginEntries.email = null;
  loginEntries.passwordDestination = undefined;
  authState.current = {
    user: null,
    loading: false,
    configured: true,
    supabaseAuthState: "signed-out",
    welcomeBack: null,
  };
  navigation.redirect.mockClear();
  requestCookies.clear();
});

describe("login page", () => {
  it("offers recovery instead of sign-in actions when configured auth is unavailable", () => {
    authState.current.supabaseAuthState = "unavailable";
    const html = renderToStaticMarkup(createElement(LoginPage));
    expect(html).toContain("Sign-in is temporarily unavailable");
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Try again<\/button>/);
    expect(html).toContain("Browse without signing in");
    expect(html).not.toContain('aria-label="Sign-in options"');
    expect(html).not.toContain("email form");
    expect(html).not.toContain("By signing in you agree");
  });

  it("keeps the hinted loading surface while unavailable auth is resolving", () => {
    authState.current.supabaseAuthState = "unavailable";
    authState.current.loading = true;
    const html = renderToStaticMarkup(createElement(LoginPageWithProps, { sessionHint: true }));
    expect(html).toContain("loginPageSkeleton");
    expect(html).not.toContain("Sign-in is temporarily unavailable");
    expect(html).not.toContain("email form");
  });

  it("keeps an existing account's map door when Supabase is unavailable", () => {
    authState.current.supabaseAuthState = "unavailable";
    authState.current.user = { email: "member@example.test" };
    const html = renderToStaticMarkup(createElement(LoginPage));
    expect(html).toContain("Continue to the map");
    expect(html).not.toContain("Sign-in is temporarily unavailable");
  });

  it("renders the sign-in wall at /login", async () => {
    const { default: LoginRoute } = await import("@/app/login/page");
    const html = renderToStaticMarkup(
      await LoginRoute({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("email form");
    expect(html).toContain("Browse without signing in");
  });

  // The resume cookie is HttpOnly, so the route is the only reader that can
  // see it. A signed-in reader gets the card's shape, not the email door.
  it("holds the email door back for a reader with a resume cookie", async () => {
    authState.current.loading = true;
    requestCookies.set("pubmax_session_resume", "opaque-resume-value");
    const { default: LoginRoute } = await import("@/app/login/page");
    const html = renderToStaticMarkup(
      await LoginRoute({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("loginPageSkeleton");
    expect(html).not.toContain("email form");
    expect(html).not.toContain("opaque-resume-value");
  });

  // Back from Google, Apple or Microsoft: the session is in the fragment and
  // the cookie is not set yet, so the callback marker is the hint.
  it("holds the email door back on a provider callback landing", async () => {
    authState.current.loading = true;
    const { default: LoginRoute } = await import("@/app/login/page");
    const landing = renderToStaticMarkup(
      await LoginRoute({ searchParams: Promise.resolve({ _authCallback: "1" }) }),
    );
    expect(landing).toContain("loginPageSkeleton");
    expect(landing).not.toContain("email form");

    const failed = renderToStaticMarkup(
      await LoginRoute({
        searchParams: Promise.resolve({ _authCallback: "1", authError: "1" }),
      }),
    );
    expect(failed).not.toContain("loginPageSkeleton");
    expect(failed).toContain("email form");
  });

  // Adding a second account asked for the form, so a hint must not hide it.
  it("paints the form for an added account even with a resume cookie", async () => {
    authState.current.loading = true;
    requestCookies.set("pubmax_session_resume", "opaque-resume-value");
    const { default: LoginRoute } = await import("@/app/login/page");
    const html = renderToStaticMarkup(
      await LoginRoute({ searchParams: Promise.resolve({ add: "1" }) }),
    );
    expect(html).not.toContain("loginPageSkeleton");
    expect(html).toContain("email form");
    expect(html).toContain("Add another account");
  });

  it("sends /signin to /login", async () => {
    const { default: SignInAliasPage } = await import("@/app/signin/page");
    SignInAliasPage();
    expect(navigation.redirect).toHaveBeenCalledWith("/login");
  });

  it("renders identity, email flow, and browse-away on the signed-out wall", () => {
    const html = renderToStaticMarkup(createElement(LoginPage));
    expect(html).toContain("Sign in or create your account");
    expect(html).toContain("Sign in");
    expect(html).toContain("email form");
    expect(html).toContain("social");
    expect(html).toContain("Browse without signing in");
    expect(html).toContain('href="/map"');
    expect(html).toContain('href="/privacy"');
    expect(html).not.toContain("Welcome back");
    expect(html).not.toContain("Checking your session");
    expect(html).not.toMatch(/—|–/);
  });

  it("stays on first-time copy while the session is still unknown", () => {
    authState.current.loading = true;
    const html = renderToStaticMarkup(createElement(LoginPage));
    expect(html).toContain("Sign in or create your account");
    expect(html).toContain("Use your email, or pick a handle after the link lands.");
    expect(html).not.toContain("Welcome back");
    expect(html).not.toContain("Checking your session");
  });

  // No session hint: the email door is in the first HTML. The field must not
  // wait for the live session, which is the whole of the slow paint.
  it("paints the email door while the session is still unknown", () => {
    authState.current.loading = true;
    const html = renderToStaticMarkup(createElement(LoginPage));
    expect(html).toContain("email form");
    expect(html).toContain("social");
    expect(html).not.toContain("loginPageSkeleton");
    expect(html).not.toContain('<main class="loginPage" aria-busy');
  });

  // The head is painted with the form, so it must already be the door's own
  // copy: a swap when the session answers would shift the field being typed in.
  it("paints the sign-up door's head with the form while the session resolves", () => {
    const settled = renderToStaticMarkup(
      createElement(LoginPageWithProps, { initialIntent: "signup" }),
    );
    authState.current.loading = true;
    const resolving = renderToStaticMarkup(
      createElement(LoginPageWithProps, { initialIntent: "signup" }),
    );
    const heading = (html: string) => html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1];
    expect(resolving).toContain("email form");
    expect(heading(resolving)).toBe(heading(settled));
  });

  // A hint (resume cookie or stored session) keeps the card's shape up so a
  // signed-in reader does not see the form flash. `aria-busy` belongs to the
  // region that is loading, and the screen-reader line starts EMPTY, because a
  // live region announces a change and text already present when it mounted is
  // never spoken.
  it("stands the sign-in card's shape up while a hinted session resolves", () => {
    authState.current.loading = true;
    const html = renderToStaticMarkup(
      createElement(LoginPageWithProps, { sessionHint: true }),
    );
    expect(html).toContain('class="loginPageSkeleton" aria-busy="true"');
    // The spoken line stands BESIDE the busy shape, never inside it.
    expect(html).toMatch(
      /<p class="loginPageSrOnly" role="status">\s*<\/p><div class="loginPageSkeleton"/,
    );
    expect(html).toContain('class="loginPageSrOnly" role="status"');
    expect(html).not.toContain(">Loading<");
    expect(html).not.toContain("email form");
    expect(html).not.toContain("social");
    // The page as a whole is not busy: aria-busy there withholds updates from
    // everything it wraps, including the line meant to be announced.
    expect(html).not.toContain('<main class="loginPage" aria-busy');
  });

  // A keyless build has no form to arrive: the skeleton would promise a card
  // that never comes, so the not-configured notice is the whole answer.
  it("never promises a sign-in card a keyless build cannot show", () => {
    authState.current.configured = false;
    authState.current.loading = true;
    const busy = renderToStaticMarkup(createElement(LoginPage));
    expect(busy).not.toContain("loginPageSkeleton");

    authState.current.loading = false;
    const settled = renderToStaticMarkup(createElement(LoginPage));
    expect(settled).not.toContain("loginPageSkeleton");
    expect(settled).toContain("Sign-in is not configured on this build");
    expect(settled).not.toContain("email form");
  });

  it("drops the skeleton once the session has answered", () => {
    const html = renderToStaticMarkup(createElement(LoginPage));
    expect(html).not.toContain("loginPageSkeleton");
    expect(html).toContain("email form");
  });

  it("keeps Welcome back for a returning resume cookie", () => {
    authState.current.welcomeBack = { maskedEmail: "k***@example.test" };
    const html = renderToStaticMarkup(createElement(LoginPage));
    expect(html).toContain("Welcome back");
    expect(html).toContain("Continue as k***@example.test");
    expect(html).not.toContain("Sign in or create your account");
  });

  it("hands the add-link destination to every visible sign-in action", async () => {
    const destination = "/add/karan?auto=1";
    renderToStaticMarkup(
      createElement(LoginPageWithProps, {
        initialIntent: "signin",
        from: destination,
      }),
    );

    await loginEntries.google?.();
    await loginEntries.apple?.();
    await loginEntries.email?.("person@example.test");

    expect(authActions.google).toHaveBeenCalledWith(destination);
    expect(authActions.apple).toHaveBeenCalledWith(destination);
    expect(authActions.email).toHaveBeenCalledWith("person@example.test", destination);
    expect(loginEntries.passwordDestination).toBe(destination);
  });

  it("keeps bare login OAuth calls unchanged", async () => {
    renderToStaticMarkup(createElement(LoginPage));

    await loginEntries.google?.();
    await loginEntries.apple?.();

    expect(authActions.google).toHaveBeenCalledWith();
    expect(authActions.apple).toHaveBeenCalledWith();
    expect(loginEntries.passwordDestination).toBeNull();
  });

});
