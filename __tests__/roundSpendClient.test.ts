import { describe, expect, it, vi } from "vitest";

import { submitRoundSpendRequest } from "@/lib/roundSpendClient";

describe("Round spend client", () => {
  it("binds signed-in writes to the captured bearer token", async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer token-a",
      );
      return new Response("{}", { status: 200 });
    });

    await submitRoundSpendRequest(
      "ABC234",
      { userId: "user-a", accessToken: "token-a" },
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

    await submitRoundSpendRequest(
      "ABC234",
      null,
      { action: "recordSpend" },
      request,
    );
    expect(request).toHaveBeenCalledOnce();
  });
});
