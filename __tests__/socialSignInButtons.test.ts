import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import MagicLinkForm from "@/components/auth/MagicLinkForm";
import SignInButton from "@/components/auth/SignInButton";
import SocialSignInButtons from "@/components/auth/SocialSignInButtons";

const authState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));

const noop = async () => {};

function renderProviders(
  availability: { google: boolean; microsoft: boolean },
): string {
  return renderToStaticMarkup(
    createElement(SocialSignInButtons, {
      availability,
      disabled: false,
      onGoogle: noop,
      onMicrosoft: noop,
    }),
  );
}

describe("social sign-in provider rendering", () => {
  it("renders no clickable provider when every live provider is disabled", () => {
    const html = renderProviders({ google: false, microsoft: false });

    expect(html).toBe("");
  });

  it("renders Google only when live settings enable Google", () => {
    const html = renderProviders({ google: true, microsoft: false });

    expect(html).toContain('aria-label="Continue with Google"');
    expect(html).not.toContain("Continue with Microsoft");
  });

  it("renders Microsoft only when live settings enable Azure", () => {
    const html = renderProviders({ google: false, microsoft: true });

    expect(html).toContain('aria-label="Continue with Microsoft"');
    expect(html).not.toContain("Continue with Google");
  });
});

describe("email sign-in heading", () => {
  function renderEmail(hasSocialProviders: boolean): string {
    return renderToStaticMarkup(
      createElement(MagicLinkForm, {
        disabled: false,
        hasSocialProviders,
        signInWithEmail: vi.fn(),
        cancelAuthAttempt: vi.fn(),
      }),
    );
  }

  it("reads as the complete primary path when no social provider is available", () => {
    expect(renderEmail(false)).toContain("Continue with email");
    expect(renderEmail(false)).not.toContain("Or continue with email");
  });

  it("reads as the alternative path when a social provider is available", () => {
    expect(renderEmail(true)).toContain("Or continue with email");
  });
});

describe("signed-out sign-in surface", () => {
  function renderSignIn(
    socialProviders: { google: boolean; microsoft: boolean },
  ): string {
    authState.current = {
      user: null,
      loading: false,
      configured: true,
      socialProviders,
      signInWithGoogle: vi.fn(),
      signInWithMicrosoft: vi.fn(),
      signInWithEmail: vi.fn(),
      cancelAuthAttempt: vi.fn(),
      signOut: vi.fn(),
    };
    return renderToStaticMarkup(createElement(SignInButton));
  }

  it("renders complete email sign-in and no social dead ends when all are disabled", () => {
    const html = renderSignIn({ google: false, microsoft: false });

    expect(html).toContain("Continue with email");
    expect(html).toContain("Email me a link");
    expect(html).not.toContain("Continue with Google");
    expect(html).not.toContain("Continue with Microsoft");
  });

  it("adds an enabled provider without replacing email sign-in", () => {
    const html = renderSignIn({ google: true, microsoft: false });

    expect(html).toContain('aria-label="Continue with Google"');
    expect(html).toContain("Or continue with email");
    expect(html).toContain("Email me a link");
    expect(html).not.toContain("Continue with Microsoft");
  });
});
