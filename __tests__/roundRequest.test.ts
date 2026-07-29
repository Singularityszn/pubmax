import { describe, expect, it, vi } from "vitest";

import {
  captureRoundRequestIdentity,
  roundJsonRequest,
  runRoundMutationForCurrentOwner,
  type RoundRequestIdentity,
} from "@/lib/roundRequest";

describe("Round request client", () => {
  it("binds every signed-in Round write to the captured bearer token", async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer token-a",
      );
      return new Response("{}", { status: 200 });
    });

    await roundJsonRequest(
      "/api/rounds/ABC234",
      {
        kind: "account",
        auth: { userId: "user-a", accessToken: "token-a" },
      },
      { action: "recordSpend" },
      request,
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("keeps anonymous diary writes unauthenticated", async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return new Response("{}", { status: 200 });
    });

    await roundJsonRequest(
      "/api/rounds/ABC234",
      { kind: "anonymous" },
      { action: "recordSpend" },
      request,
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("refuses to downgrade a stale authenticated session to anonymous", () => {
    expect(
      captureRoundRequestIdentity(null, {
        access_token: "token-a",
        user: { id: "user-a" },
      } as never),
    ).toBeNull();
    expect(
      captureRoundRequestIdentity("user-b", {
        access_token: "token-a",
        user: { id: "user-a" },
      } as never),
    ).toBeNull();
  });

  it("drops mutation completion after the authenticated owner changes", async () => {
    let currentIdentity: RoundRequestIdentity = {
      kind: "account" as const,
      auth: { userId: "user-a", accessToken: "token-a" },
    };
    let finish!: (value: string) => void;
    const response = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const completion = runRoundMutationForCurrentOwner(
      currentIdentity,
      () => currentIdentity,
      () => response,
    );

    currentIdentity = {
      kind: "account",
      auth: { userId: "user-b", accessToken: "token-b" },
    };
    finish("account-a response");

    expect(await completion).toEqual({ current: false });
  });

  it("keeps completion when one account refreshes its token", async () => {
    let currentIdentity: RoundRequestIdentity = {
      kind: "account",
      auth: { userId: "user-a", accessToken: "token-old" },
    };
    const completion = runRoundMutationForCurrentOwner(
      currentIdentity,
      () => currentIdentity,
      async () => "saved",
    );
    currentIdentity = {
      kind: "account",
      auth: { userId: "user-a", accessToken: "token-new" },
    };

    expect(await completion).toEqual({ current: true, value: "saved" });
  });
});
