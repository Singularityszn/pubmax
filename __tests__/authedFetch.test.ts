import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authClient", () => ({
  getAccessToken: vi.fn(async () => "test-jwt-token"),
}));

import { getAccessToken } from "@/lib/authClient";
import { authedFetch } from "@/lib/authedFetch";

describe("authedFetch (Wave I2)", () => {
  it("attaches Authorization Bearer when a token is available", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await authedFetch("/api/messages?handle=ken");
    expect(getAccessToken).toHaveBeenCalled();
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer test-jwt-token");
    fetchSpy.mockRestore();
  });

  it("proceeds anonymously when getAccessToken returns null", async () => {
    vi.mocked(getAccessToken).mockResolvedValueOnce(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await authedFetch("/api/messages?handle=ken", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("content-type")).toBe("application/json");
    fetchSpy.mockRestore();
  });
});
