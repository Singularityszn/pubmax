import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  bootstrapAuthSession,
  type BrowserAuthSession,
} from "@/lib/authSessionBootstrap";
import type { RedeemResult, ResumeHintReadOutcome } from "@/lib/authSessionResumeClient";

const RESTORED_SESSION = {
  access_token: "access-restored",
  refresh_token: "refresh-restored",
};

function auth(overrides: Partial<BrowserAuthSession> = {}): BrowserAuthSession {
  return {
    getSession: vi.fn(async () => ({ data: { session: null } })),
    setSession: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe("browser auth session bootstrap", () => {
  it("is awaited by AuthProvider before it clears session loading", () => {
    const providerSource = readFileSync(
      join(process.cwd(), "components/auth/AuthProvider.tsx"),
      "utf8",
    );

    expect(providerSource).toContain("bootstrapAuthSession");
    expect(providerSource).toMatch(/bootstrapAuthSession\([\s\S]*?\)\.catch\(/);
    expect(providerSource).toMatch(
      /bootstrapAuthSession\([\s\S]*?setSessionLoading\(false\)/,
    );
    expect(providerSource).not.toMatch(
      /updateSession\(localSession\);\s*setSessionLoading\(false\);\s*if \(localSession\) return/,
    );
  });

  it("waits for cookie redemption before settling a cold browser", async () => {
    let resolveHint: ((value: ResumeHintReadOutcome) => void) | undefined;
    const readHint = vi.fn(
      () =>
        new Promise<ResumeHintReadOutcome>((resolve) => {
          resolveHint = resolve;
        }),
    );
    const redeem = vi.fn(async () => ({
      status: "restored" as const,
      session: RESTORED_SESSION,
    }));
    const onBeforeSetSession = vi.fn();
    const browser = auth({
      setSession: vi.fn(async () => {
        expect(onBeforeSetSession).toHaveBeenCalledWith(RESTORED_SESSION);
        return { error: null };
      }),
    });

    const bootstrap = bootstrapAuthSession(browser, { readHint, redeem, onBeforeSetSession });
    await Promise.resolve();

    expect(browser.setSession).not.toHaveBeenCalled();
    expect(redeem).not.toHaveBeenCalled();

    resolveHint?.({ status: "present", hint: { maskedEmail: null } });

    await expect(bootstrap).resolves.toEqual({
      status: "restored",
      session: RESTORED_SESSION,
    });
    expect(browser.setSession).toHaveBeenCalledWith(RESTORED_SESSION);
    expect(onBeforeSetSession).toHaveBeenCalledTimes(1);
  });

  it("waits for a pending local read before publishing signed out", async () => {
    let resolveLocal: ((value: { data: { session: null } }) => void) | undefined;
    const browser = auth({
      getSession: vi.fn(
        () =>
          new Promise<{ data: { session: null } }>((resolve) => {
            resolveLocal = resolve;
          }),
      ),
    });
    let settled = false;
    const bootstrap = bootstrapAuthSession(browser, {
      readHint: async () => ({ status: "absent" }),
    });
    void bootstrap.finally(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveLocal?.({ data: { session: null } });
    await expect(bootstrap).resolves.toEqual({ status: "none" });
  });

  it("keeps a pending local session when the resume hint is absent", async () => {
    const localSession = {
      access_token: "access-local",
      refresh_token: "refresh-local",
      user: { id: "account-1" },
    } as unknown as Session;
    let resolveLocal:
      | ((value: { data: { session: Session | null } }) => void)
      | undefined;
    const browser = auth({
      getSession: vi.fn(
        () =>
          new Promise<{ data: { session: Session | null } }>((resolve) => {
            resolveLocal = resolve;
          }),
      ),
    });
    const bootstrap = bootstrapAuthSession(browser, {
      readHint: async () => ({ status: "absent" }),
    });

    await Promise.resolve();
    await Promise.resolve();
    resolveLocal?.({ data: { session: localSession } });

    await expect(bootstrap).resolves.toEqual({
      status: "local",
      session: localSession,
    });
  });

  it("keeps a pending local read failure unavailable when the hint is absent", async () => {
    let rejectLocal: ((reason: Error) => void) | undefined;
    const browser = auth({
      getSession: vi.fn(
        () =>
          new Promise<{ data: { session: Session | null } }>((_resolve, reject) => {
            rejectLocal = reject;
          }),
      ),
    });
    const bootstrap = bootstrapAuthSession(browser, {
      readHint: async () => ({ status: "absent" }),
    });

    await Promise.resolve();
    await Promise.resolve();
    rejectLocal?.(new Error("storage blocked"));

    await expect(bootstrap).resolves.toEqual({ status: "unavailable" });
  });

  it("preserves a failed local session read as unavailable", async () => {
    const browser = auth({
      getSession: vi.fn(async () => {
        throw new Error("storage blocked");
      }),
    });

    await expect(
      bootstrapAuthSession(browser, {
        readHint: async () => ({ status: "absent" }),
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("returns local session without touching the resume cookie", async () => {
    const localSession = {
      access_token: "access-local",
      refresh_token: "refresh-local",
      user: { id: "account-1" },
    } as unknown as Session;
    const browser = auth({
      getSession: vi.fn(async () => ({ data: { session: localSession } })),
    });
    const readHint = vi.fn();
    const redeem = vi.fn();

    await expect(bootstrapAuthSession(browser, { readHint, redeem })).resolves.toEqual({
      status: "local",
      session: localSession,
    });
    expect(readHint).not.toHaveBeenCalled();
    expect(redeem).not.toHaveBeenCalled();
  });

  it("does not claim restore when installing the redeemed session fails", async () => {
    const browser = auth({
      setSession: vi.fn(async () => ({ error: new Error("storage blocked") })),
    });

    await expect(
      bootstrapAuthSession(browser, {
        readHint: async () => ({ status: "present", hint: { maskedEmail: null } }),
        redeem: async () => ({
          status: "restored" as const,
          session: RESTORED_SESSION,
        }),
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("does not install a redeemed account after sign-out cancels bootstrap", async () => {
    const controller = new AbortController();
    let finishRedemption: ((result: RedeemResult) => void) | undefined;
    const browser = auth();
    const bootstrap = bootstrapAuthSession(browser, {
      signal: controller.signal,
      readHint: async () => ({ status: "present", hint: { maskedEmail: null } }),
      redeem: () => new Promise<RedeemResult>((resolve) => { finishRedemption = resolve; }),
    });
    await vi.waitFor(() => expect(finishRedemption).toBeTypeOf("function"));

    controller.abort();
    finishRedemption?.({ status: "restored", session: RESTORED_SESSION });
    await expect(bootstrap).resolves.toEqual({ status: "unavailable" });
    expect(browser.setSession).not.toHaveBeenCalled();
  });

  it("converts a rejected redemption into unavailable", async () => {
    await expect(
      bootstrapAuthSession(auth(), {
        readHint: async () => ({ status: "present", hint: { maskedEmail: null } }),
        redeem: async () => {
          throw new Error("offline");
        },
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("preserves an unavailable resume read", async () => {
    await expect(
      bootstrapAuthSession(auth(), {
        readHint: async () => ({ status: "unavailable" }),
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
