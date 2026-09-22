import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  enablePersonalizedWebPush,
  type PersonalizedPushOptInDeps,
} from "@/lib/personalizedPushOptIn";
import { withAccountPushLifecycleLock } from "@/lib/accountPushLifecycle";

const ACCOUNT = {
  userId: "account-a",
  accessToken: "account-a-access",
};
const TOKEN = "webpush:account-a-browser";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function deps(
  overrides: Partial<PersonalizedPushOptInDeps> = {},
): PersonalizedPushOptInDeps {
  return {
    register: vi.fn(async () => TOKEN),
    readCurrentUserId: vi.fn(async () => ACCOUNT.userId),
    fetchImpl: vi.fn(async () => Response.json({ enabled: true })),
    ...overrides,
  };
}

describe("personalized web-push opt-in lifecycle", () => {
  it("routes both personalized opt-ins through the serialized helper", () => {
    for (const file of [
      "components/profile/StepOutNudgePref.tsx",
      "components/pwa/CheapPintPingPrompt.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).toContain("enablePersonalizedWebPush({");
      expect(source).not.toMatch(/\bregisterWebPush\(/);
    }
  });

  it("pins the bind request to the initiating account bearer", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => Response.json({ enabled: true }),
    );
    const result = await enablePersonalizedWebPush(
      {
        account: ACCOUNT,
        endpoint: "/api/step-out-nudge",
        body: (token) => ({ enabled: true, token }),
      },
      deps({ fetchImpl }),
    );

    expect(result.status).toBe("saved");
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer account-a-access",
    );
    expect(JSON.parse(String(init?.body))).toEqual({ enabled: true, token: TOKEN });
    expect(init?.signal).toBeUndefined();
  });

  it("does not bind after registration when another account became current", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => Response.json({ enabled: true }),
    );
    const readCurrentUserId = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(ACCOUNT.userId)
      .mockResolvedValueOnce("account-b");

    const result = await enablePersonalizedWebPush(
      {
        account: ACCOUNT,
        endpoint: "/api/cheap-pint-ping",
        body: (token) => ({ action: "opt-in", token }),
      },
      deps({ fetchImpl, readCurrentUserId }),
    );

    expect(result).toEqual({ status: "account_changed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("holds retirement behind a subscription that is still being created", async () => {
    const heldSubscription = deferred<string | null>();
    const order: string[] = [];
    const optIn = enablePersonalizedWebPush(
      {
        account: ACCOUNT,
        endpoint: "/api/step-out-nudge",
        body: (token) => ({ enabled: true, token }),
      },
      deps({
        register: async () => {
          order.push("subscribe-start");
          const token = await heldSubscription.promise;
          order.push("subscribe-finish");
          return token;
        },
        fetchImpl: async () => {
          order.push("bind-finish");
          return Response.json({ enabled: true });
        },
      }),
    );
    await vi.waitFor(() => expect(order).toContain("subscribe-start"));

    const retirement = withAccountPushLifecycleLock(async () => {
      order.push("retire");
    });
    await Promise.resolve();
    expect(order).not.toContain("retire");

    heldSubscription.resolve(TOKEN);
    await expect(optIn).resolves.toMatchObject({ status: "saved" });
    await retirement;
    expect(order).toEqual([
      "subscribe-start",
      "subscribe-finish",
      "bind-finish",
      "retire",
    ]);
  });

  it("waits for a held bind response after UI abort before retirement", async () => {
    const heldResponse = deferred<Response>();
    const controller = new AbortController();
    const order: string[] = [];
    const optIn = enablePersonalizedWebPush(
      {
        account: ACCOUNT,
        endpoint: "/api/cheap-pint-ping",
        body: (token) => ({ action: "opt-in", token }),
        signal: controller.signal,
      },
      deps({
        fetchImpl: async (_input, init) => {
          order.push("bind-start");
          expect(init?.signal).toBeUndefined();
          const response = await heldResponse.promise;
          order.push("bind-finish");
          return response;
        },
      }),
    );
    await vi.waitFor(() => expect(order).toContain("bind-start"));
    controller.abort();

    const retirement = withAccountPushLifecycleLock(async () => {
      order.push("retire");
    });
    await Promise.resolve();
    expect(order).not.toContain("retire");

    heldResponse.resolve(Response.json({ enabled: true }));
    await expect(optIn).resolves.toMatchObject({ status: "saved" });
    await retirement;
    expect(order).toEqual(["bind-start", "bind-finish", "retire"]);
  });
});
