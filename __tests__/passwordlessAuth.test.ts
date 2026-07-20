import { describe, expect, it, vi } from "vitest";

import {
  buildAuthCallbackUrl,
  cleanAuthCallbackUrl,
  readAuthCallbackAttempt,
  rememberAuthReturnFragment,
} from "@/lib/authRedirect";
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

  it("neutralizes stable account-state codes even when provider prose changes", async () => {
    for (const code of [
      "email_exists",
      "identity_already_exists",
      "signup_disabled",
      "user_banned",
      "user_not_found",
    ]) {
      const auth: PasswordlessAuthClient = {
        signInWithOtp: vi.fn().mockResolvedValue({
          error: { code, message: "Provider wording changed" },
        }),
      };
      await expect(
        requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"),
      ).resolves.toEqual({ status: "sent", message: MAGIC_LINK_SENT_MESSAGE });
    }
  });

  it("neutralizes unknown client policy errors rather than exposing an oracle", async () => {
    const auth: PasswordlessAuthClient = {
      signInWithOtp: vi.fn().mockResolvedValue({
        error: { status: 422, code: "future_account_policy", message: "Policy denied" },
      }),
    };

    await expect(
      requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"),
    ).resolves.toEqual({ status: "sent", message: MAGIC_LINK_SENT_MESSAGE });
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
      .toBe("https://pubmaxxing.com/auth/callback?next=%2Fmap%3Farea%3Dsoho");
  });

  it("keeps a capability fragment local and restores it only to the matching path", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const current = "https://pubmaxxing.com/plan/abc#invite=SECRET-CAPABILITY";

    rememberAuthReturnFragment(current, undefined, storage, 1_000);
    const callback = buildAuthCallbackUrl(current);

    expect(callback).toBe("https://pubmaxxing.com/auth/callback?next=%2Fplan%2Fabc");
    expect(callback).not.toContain("SECRET-CAPABILITY");
    expect(
      cleanAuthCallbackUrl(
        "https://pubmaxxing.com/plan/abc?code=pkce&_authCallback=1",
        storage,
        2_000,
      ),
    ).toBe("/plan/abc#invite=SECRET-CAPABILITY");
    expect(values.size).toBe(0);
  });

  it("drops stored fragments on path mismatch or expiry", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    rememberAuthReturnFragment(
      "https://pubmaxxing.com/plan/abc#invite=SECRET",
      undefined,
      storage,
      1_000,
    );
    expect(
      cleanAuthCallbackUrl(
        "https://pubmaxxing.com/plan/other?code=pkce&_authCallback=1",
        storage,
        2_000,
      ),
    ).toBe("/plan/other");

    rememberAuthReturnFragment(
      "https://pubmaxxing.com/plan/abc#invite=SECRET",
      undefined,
      storage,
      1_000,
    );
    expect(
      cleanAuthCallbackUrl(
        "https://pubmaxxing.com/plan/abc?code=pkce&_authCallback=1",
        storage,
        3_602_000,
      ),
    ).toBe("/plan/abc");
  });

  it("recognizes only marked callback codes while accepting the legacy error flag", () => {
    expect(readAuthCallbackAttempt("https://pubmaxxing.com/map?code=ordinary"))
      .toBeNull();
    expect(readAuthCallbackAttempt("https://pubmaxxing.com/map?code=pkce&_authCallback=1"))
      .toEqual({ code: "pkce", providerError: false });
    expect(readAuthCallbackAttempt("https://pubmaxxing.com/?authError=1"))
      .toEqual({ code: null, providerError: true });
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
