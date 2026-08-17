import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: authState.current.user,
    loading: authState.current.loading,
    configured: true,
    clerkIntegrationConfigured: false,
    socialProviders: { google: true, apple: true },
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
  authState.current = { user: null, loading: false, welcomeBack: null };
});

describe("login page", () => {
  it("ships a dedicated /login route and /signin alias", () => {
    const login = readFileSync(
      join(process.cwd(), "app/login/page.tsx"),
      "utf8",
    );
    const signin = readFileSync(
      join(process.cwd(), "app/signin/page.tsx"),
      "utf8",
    );
    expect(login).toContain("LoginPage");
    expect(signin).toMatch(/redirect\(["']\/login["']\)/);
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
    expect(html).toContain('aria-busy="true"');
  });

  it("keeps Welcome back for a returning resume cookie", () => {
    authState.current.welcomeBack = { maskedEmail: "k***@example.test" };
    const html = renderToStaticMarkup(createElement(LoginPage));
    expect(html).toContain("Welcome back");
    expect(html).toContain("Continue as k***@example.test");
    expect(html).not.toContain("Sign in or create your account");
  });

  it("keeps phone sign-in as a /login link and desktop as a disclosure", () => {
    const button = readFileSync(
      join(process.cwd(), "components/auth/SignInButton.tsx"),
      "utf8",
    );
    // The nav hands /login the page it was on, so a completed sign-in returns
    // there instead of parking the person on the account surface.
    expect(button).toContain("function loginHref");
    expect(button).toContain('return "/login"');
    expect(button).toContain("ARRIVAL_FROM_PARAM");
    expect(button).toContain("href={signInHref}");
    expect(button).toContain("PHONE_LOGIN_MEDIA");
    expect(button).toContain("Open full sign-in page");
  });

  it("names the two doors and lands each one differently", () => {
    const page = readFileSync(
      join(process.cwd(), "components/auth/LoginPage.tsx"),
      "utf8",
    );
    // Copy, email intent and landing all differ; only the machinery is shared.
    expect(page).toContain("Welcome back");
    expect(page).toContain("Email me a sign-in link");
    expect(page).toContain("Email me a sign-up link");
    expect(page).toContain("rememberChosenIntent");
    // Handle-and-password stays beside the link on the sign-in door.
    expect(page).toContain("HandlePasswordSignIn");
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

  it("styles the page as a full dvh composition with 44px+ taps", () => {
    const css = readFileSync(
      join(process.cwd(), "components/auth/loginPage.css"),
      "utf8",
    );
    expect(css).toMatch(/min-height:\s*100dvh/);
    expect(css).toMatch(/min-height:\s*46px/);
  });

  // THE FRONT DOOR HAS A PRIMARY, AND EXACTLY ONE. The page shipped with none:
  // its email CTA measured `rgb(32,32,36)`, the same fill as the active thumb
  // of the segmented control above it, and the second door had no control
  // language at all. Both halves were CSS, so both are pinned in CSS.
  it("gives the email link the primary treatment and the second door a secondary shape", () => {
    const authCss = readFileSync(join(process.cwd(), "app/auth/auth.css"), "utf8");
    const loginCss = readFileSync(
      join(process.cwd(), "components/auth/loginPage.css"),
      "utf8",
    );

    // `.authSignIn` sets `background: var(--panel-raised)` and the `border`
    // SHORTHAND further down the same file, so a bare `.authMagicLinkButton`
    // rule loses the accent fill at equal specificity and paints nothing. The
    // accent rule has to name both classes.
    const accent = authCss.match(
      /\.authSignIn\.authMagicLinkButton\s*{([^}]*)}/,
    )?.[1];
    expect(accent, "the accent rule must out-specify .authSignIn").toBeTruthy();
    expect(accent).toMatch(/background:\s*var\(--brass\)/);
    expect(accent).toMatch(/color:\s*var\(--color-on-accent\)/);

    // The handle-and-password door is the SECONDARY: a real control shape, and
    // never a second accent fill beside the primary.
    const toggle = loginCss.match(
      /\.loginPageHandlePasswordToggle\s*{([^}]*)}/,
    )?.[1];
    expect(toggle, ".loginPageHandlePasswordToggle rule present").toBeTruthy();
    expect(toggle).toMatch(/border:\s*1px solid var\(--line\)/);
    expect(toggle).toMatch(/border-radius:/);
    expect(toggle).toMatch(/background:\s*var\(--panel\)/);
    expect(toggle, "one filled accent on the page, and it is the primary").not.toMatch(
      /background:\s*var\(--brass\)/,
    );
  });
});
