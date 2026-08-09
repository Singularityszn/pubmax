import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

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
    user: null,
    loading: false,
    configured: true,
    clerkIntegrationConfigured: false,
    socialProviders: { google: true, apple: false },
    signInWithGoogle: vi.fn(async () => ({ error: null })),
    signInWithApple: vi.fn(async () => ({ error: null })),
    signInWithEmail: vi.fn(async () => ({
      status: "sent",
      message: "link sent",
    })),
    cancelAuthAttempt: vi.fn(),
    signOut: vi.fn(async () => undefined),
  }),
}));

vi.mock("@/components/auth/MagicLinkForm", () => ({
  default: () =>
    createElement("form", { className: "authMagicLink" }, "email form"),
}));

vi.mock("@/components/auth/SocialSignInButtons", () => ({
  default: () =>
    createElement("div", { className: "authProviders" }, "social"),
}));

import LoginPage from "@/components/auth/LoginPage";

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
    expect(html).toContain("Sign in");
    expect(html).toContain("email form");
    expect(html).toContain("social");
    expect(html).toContain("Browse without signing in");
    expect(html).toContain('href="/map"');
    expect(html).toContain('href="/privacy"');
    expect(html).not.toMatch(/—|–/);
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
    expect(page).toContain("arrivalDestination");
    expect(page).toContain("rememberChosenIntent");
    // Handle-and-password stays beside the link on the sign-in door.
    expect(page).toContain("HandlePasswordSignIn");
  });

  it("styles the page as a full dvh composition with 44px+ taps", () => {
    const css = readFileSync(
      join(process.cwd(), "components/auth/loginPage.css"),
      "utf8",
    );
    expect(css).toMatch(/min-height:\s*100dvh/);
    expect(css).toMatch(/min-height:\s*46px/);
  });
});
