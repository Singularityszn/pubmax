import { describe, expect, it, vi } from "vitest";

import {
  AUTH_ATTEMPT_IN_PROGRESS_MESSAGE,
  beginAuthAttempt,
  beginCoordinatedAuthAttempt,
  buildAuthCallbackUrl,
  captureAuthCallback,
  readAuthCallbackAttempt,
  releaseAuthAttempt,
  scrubAuthCallback,
  type AuthAttemptStart,
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

  it("keeps transport, authorization, and configuration failures actionable", async () => {
    for (const error of [
      { status: 408, code: "request_timeout" },
      { status: 425, code: "too_early" },
      { status: 401, code: "not_authorized" },
      { status: 403, code: "forbidden" },
      { status: 400, code: "email_provider_disabled" },
      { status: 400, code: "email_address_not_authorized" },
    ]) {
      const auth: PasswordlessAuthClient = {
        signInWithOtp: vi.fn().mockResolvedValue({ error }),
      };
      await expect(
        requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"),
      ).resolves.toEqual({ status: "error", message: MAGIC_LINK_ERROR_MESSAGE });
    }
  });

  it("keeps stable account-state codes neutral even when they use 401 or 403", async () => {
    for (const error of [
      { status: 401, code: "user_not_found" },
      { status: 403, code: "user_banned" },
    ]) {
      const auth: PasswordlessAuthClient = {
        signInWithOtp: vi.fn().mockResolvedValue({ error }),
      };
      await expect(
        requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"),
      ).resolves.toEqual({ status: "sent", message: MAGIC_LINK_SENT_MESSAGE });
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
  const ATTEMPT_A = "a".repeat(32);
  const ATTEMPT_B = "b".repeat(32);

  function memoryStorage() {
    const values = new Map<string, string>();
    return {
      values,
      storage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    };
  }

  function fixedCrypto(hexPair: number) {
    return {
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint8Array) array.fill(hexPair);
        return array;
      },
    };
  }

  it("preserves a same-origin deep link", () => {
    expect(buildAuthCallbackUrl("https://pubmaxxing.com/map?area=soho#venue", undefined, ATTEMPT_A))
      .toBe(
        `https://pubmaxxing.com/auth/callback?next=%2Fmap%3Farea%3Dsoho&_authAttempt=${ATTEMPT_A}`,
      );
  });

  it("locks the browser-wide verifier without losing tab A's invite", () => {
    const { storage } = memoryStorage();
    const first = beginAuthAttempt(
      "https://pubmaxxing.com/plan/abc#invite=SECRET-A",
      undefined,
      storage,
      fixedCrypto(0xaa),
      1_000,
    );
    const second = beginAuthAttempt(
      "https://pubmaxxing.com/map#venue-b",
      undefined,
      storage,
      fixedCrypto(0xbb),
      2_000,
    );

    expect(first).toMatchObject({ ok: true, id: ATTEMPT_A });
    expect(second).toEqual({ ok: false, message: AUTH_ATTEMPT_IN_PROGRESS_MESSAGE });
    const captured = captureAuthCallback(
      `https://pubmaxxing.com/plan/abc?code=pkce&_authCallback=1&_authAttempt=${ATTEMPT_A}`,
      storage,
      3_000,
    );
    expect(captured?.cleanUrl).toBe("/plan/abc#invite=SECRET-A");
  });

  it("serializes simultaneous tab A/B claims before either can overwrite the verifier", async () => {
    const { storage } = memoryStorage();
    let tail = Promise.resolve();
    const locks = {
      request: (_name: string, callback: () => AuthAttemptStart) => {
        const result = tail.then(callback);
        tail = result.then(() => undefined);
        return result;
      },
    } as unknown as NonNullable<Parameters<typeof beginCoordinatedAuthAttempt>[4]>;

    const [first, second] = await Promise.all([
      beginCoordinatedAuthAttempt(
        "https://pubmaxxing.com/plan/abc#invite=SECRET-A",
        undefined,
        storage,
        fixedCrypto(0xaa),
        locks,
        1_000,
      ),
      beginCoordinatedAuthAttempt(
        "https://pubmaxxing.com/map#venue-b",
        undefined,
        storage,
        fixedCrypto(0xbb),
        locks,
        1_000,
      ),
    ]);

    expect(first).toMatchObject({ ok: true, id: ATTEMPT_A });
    expect(second).toEqual({ ok: false, message: AUTH_ATTEMPT_IN_PROGRESS_MESSAGE });
  });

  it("does not consume tab A's fragment for an unrelated attempt B", () => {
    const { storage } = memoryStorage();
    beginAuthAttempt(
      "https://pubmaxxing.com/plan/abc#invite=SECRET-A",
      undefined,
      storage,
      fixedCrypto(0xaa),
      1_000,
    );

    const unrelated = captureAuthCallback(
      `https://pubmaxxing.com/plan/abc?code=other&_authCallback=1&_authAttempt=${ATTEMPT_B}`,
      storage,
      2_000,
    );
    expect(unrelated?.cleanUrl).toBe("/plan/abc");

    const original = captureAuthCallback(
      `https://pubmaxxing.com/plan/abc?code=pkce&_authCallback=1&_authAttempt=${ATTEMPT_A}`,
      storage,
      3_000,
    );
    expect(original?.cleanUrl).toBe("/plan/abc#invite=SECRET-A");
  });

  it("supports an attempt with no fragment and releases only its lock", () => {
    const { storage, values } = memoryStorage();
    const started = beginAuthAttempt(
      "https://pubmaxxing.com/map?area=soho",
      undefined,
      storage,
      fixedCrypto(0xbb),
      1_000,
    );
    expect(started).toMatchObject({ ok: true, id: ATTEMPT_B });
    const captured = captureAuthCallback(
      `https://pubmaxxing.com/map?area=soho&code=pkce&_authCallback=1&_authAttempt=${ATTEMPT_B}`,
      storage,
      2_000,
    );
    expect(captured?.cleanUrl).toBe("/map?area=soho");
    releaseAuthAttempt(ATTEMPT_B, storage);
    expect(values.size).toBe(0);
  });

  it("scrubs callback credentials synchronously before a hung exchange", () => {
    const { storage } = memoryStorage();
    beginAuthAttempt(
      "https://pubmaxxing.com/map#venue",
      undefined,
      storage,
      fixedCrypto(0xaa),
      1_000,
    );
    const replaceUrl = vi.fn();
    const neverSettles = new Promise(() => {});
    const captured = scrubAuthCallback(
      `https://pubmaxxing.com/map?code=pkce&_authCallback=1&_authAttempt=${ATTEMPT_A}`,
      replaceUrl,
      storage,
      2_000,
    );

    void neverSettles;
    expect(captured?.attempt.code).toBe("pkce");
    expect(replaceUrl).toHaveBeenCalledWith("/map#venue");
  });

  it("recognizes only marked callback codes with a valid attempt id", () => {
    expect(readAuthCallbackAttempt("https://pubmaxxing.com/map?code=ordinary"))
      .toBeNull();
    expect(
      readAuthCallbackAttempt(
        `https://pubmaxxing.com/map?code=pkce&_authCallback=1&_authAttempt=${ATTEMPT_A}`,
      ),
    ).toEqual({ attemptId: ATTEMPT_A, code: "pkce", providerError: false });
    expect(readAuthCallbackAttempt("https://pubmaxxing.com/?authError=1"))
      .toEqual({ attemptId: null, code: null, providerError: true });
  });

  it("rejects external, protocol-relative, and backslash next targets", () => {
    const current = "https://pubmaxxing.com/map";
    const fallback = `https://pubmaxxing.com/auth/callback?_authAttempt=${ATTEMPT_A}`;
    expect(buildAuthCallbackUrl(current, "https://evil.example/phish", ATTEMPT_A)).toBe(fallback);
    expect(buildAuthCallbackUrl(current, "//evil.example/phish", ATTEMPT_A)).toBe(fallback);
    expect(buildAuthCallbackUrl(current, "/\\evil.example/phish", ATTEMPT_A)).toBe(fallback);
  });

  it("fails closed for non-web and malformed current URLs", () => {
    expect(buildAuthCallbackUrl("pubmaxx://map", "/map")).toBeNull();
    expect(buildAuthCallbackUrl("not a URL", "/map")).toBeNull();
  });
});
