import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  bootstrapAuthSession,
  type BrowserAuthSession,
} from "@/lib/authSessionBootstrap";

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
    expect(providerSource).toMatch(
      /bootstrapAuthSession\([\s\S]*?setSessionLoading\(false\)/,
    );
    expect(providerSource).not.toMatch(
      /updateSession\(localSession\);\s*setSessionLoading\(false\);\s*if \(localSession\) return/,
    );
  });

  it("waits for cookie redemption before settling a cold browser", async () => {
    let resolveHint: ((value: { maskedEmail: string | null }) => void) | undefined;
    const readHint = vi.fn(
      () =>
        new Promise<{ maskedEmail: string | null }>((resolve) => {
          resolveHint = resolve;
        }),
    );
    const redeem = vi.fn(async () => ({
      status: "restored" as const,
      session: RESTORED_SESSION,
    }));
    const browser = auth();

    const bootstrap = bootstrapAuthSession(browser, { readHint, redeem });
    await Promise.resolve();

    expect(browser.setSession).not.toHaveBeenCalled();
    expect(redeem).not.toHaveBeenCalled();

    resolveHint?.({ maskedEmail: null });

    await expect(bootstrap).resolves.toEqual({
      status: "restored",
      session: RESTORED_SESSION,
    });
    expect(browser.setSession).toHaveBeenCalledWith(RESTORED_SESSION);
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
        readHint: async () => ({ maskedEmail: null }),
        redeem: async () => ({
          status: "restored" as const,
          session: RESTORED_SESSION,
        }),
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
