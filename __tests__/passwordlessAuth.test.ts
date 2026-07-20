import { describe, expect, it, vi } from "vitest";

import { buildAuthCallbackUrl } from "@/lib/authRedirect";
import {
  MAGIC_LINK_ERROR_MESSAGE,
  MAGIC_LINK_RATE_LIMIT_MESSAGE,
  MAGIC_LINK_SENT_MESSAGE,
  requestMagicLink,
  type PasswordlessAuthClient,
} from "@/lib/passwordlessAuth";

describe("passwordless magic-link auth", () => {
  it("requests a PKCE-compatible link and returns the same neutral success copy", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    const redirect = "https://pubmaxxing.com/auth/callback?next=%2Fmap%3Farea%3Dsoho";

    await expect(
      requestMagicLink({ signInWithOtp }, "  Night.Out@Example.COM ", redirect),
    ).resolves.toEqual({ status: "sent", message: MAGIC_LINK_SENT_MESSAGE });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "night.out@example.com",
      options: { emailRedirectTo: redirect, shouldCreateUser: true },
    });
  });

  it("makes account-specific failures indistinguishable from a successful send", async () => {
    const errors = [
      { status: 400, message: "User not found" },
      { status: 422, message: "Signups not allowed for this instance" },
      { status: 422, message: "Account already registered" },
    ];

    for (const error of errors) {
      const auth: PasswordlessAuthClient = {
        signInWithOtp: vi.fn().mockResolvedValue({ error }),
      };
      await expect(requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"))
        .resolves.toEqual({ status: "sent", message: MAGIC_LINK_SENT_MESSAGE });
    }
  });

  it("normalizes provider failures that are not account-specific", async () => {
    const auth: PasswordlessAuthClient = {
      signInWithOtp: vi.fn().mockResolvedValue({
        error: { status: 500, message: "SMTP temporarily unavailable" },
      }),
    };

    await expect(requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"))
      .resolves.toEqual({ status: "error", message: MAGIC_LINK_ERROR_MESSAGE });
  });

  it("gives a retry-safe rate-limit message without exposing provider wording", async () => {
    const auth: PasswordlessAuthClient = {
      signInWithOtp: vi.fn().mockResolvedValue({
        error: { status: 429, message: "email rate limit exceeded for user 123" },
      }),
    };

    await expect(requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"))
      .resolves.toEqual({ status: "rate_limited", message: MAGIC_LINK_RATE_LIMIT_MESSAGE });
  });

  it("turns network failures into a normalized retryable error", async () => {
    const auth: PasswordlessAuthClient = {
      signInWithOtp: vi.fn().mockRejectedValue(new Error("offline")),
    };

    await expect(requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"))
      .resolves.toEqual({ status: "error", message: MAGIC_LINK_ERROR_MESSAGE });
  });
});

describe("auth callback URL safety", () => {
  it("preserves a same-origin deep link", () => {
    expect(buildAuthCallbackUrl("https://pubmaxxing.com/map?area=soho#venue"))
      .toBe("https://pubmaxxing.com/auth/callback?next=%2Fmap%3Farea%3Dsoho%23venue");
  });

  it("rejects external, protocol-relative, and backslash next targets", () => {
    const current = "https://pubmaxxing.com/map";
    expect(buildAuthCallbackUrl(current, "https://evil.example/phish"))
      .toBe("https://pubmaxxing.com/auth/callback");
    expect(buildAuthCallbackUrl(current, "//evil.example/phish"))
      .toBe("https://pubmaxxing.com/auth/callback");
    expect(buildAuthCallbackUrl(current, "/\\evil.example/phish"))
      .toBe("https://pubmaxxing.com/auth/callback");
  });

  it("fails closed for non-web and malformed current URLs", () => {
    expect(buildAuthCallbackUrl("pubmaxx://map", "/map")).toBeNull();
    expect(buildAuthCallbackUrl("not a URL", "/map")).toBeNull();
  });
});
