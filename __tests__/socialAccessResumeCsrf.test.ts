import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authServer", () => ({
  verifyCallerAuth: vi.fn(async () => ({ status: "absent" as const })),
}));

import {
  encodeAuthResumeCookie,
  AUTH_RESUME_COOKIE,
} from "@/lib/authSessionResume";
import { verifySupabaseSessionFromRequest } from "@/lib/socialAccessServer";

const config = {
  url: "https://project.supabase.co",
  key: "publishable-key-for-test",
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", config.url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", config.key);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Social access resume-cookie redemption", () => {
  it("does not redeem a resume cookie on an attacker-origin GET", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const cookie = encodeAuthResumeCookie({
      refreshToken: "refresh-token-123",
      email: "person@example.com",
      userId: "user-1",
    });
    const request = new Request("https://pubmaxx.example/api/social/access", {
      headers: {
        Origin: "https://attacker.example",
        Cookie: `${AUTH_RESUME_COOKIE}=${cookie}`,
      },
    });

    await expect(
      verifySupabaseSessionFromRequest(request, { allowResumeCookie: false }),
    ).resolves.toEqual({ status: "absent" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps explicit cookie redemption available only to its named caller", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ user: { id: "user-1" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const cookie = encodeAuthResumeCookie({
      refreshToken: "refresh-token-123",
      email: "person@example.com",
      userId: "user-1",
    });
    const request = new Request("https://pubmaxx.example/api/auth/session", {
      headers: { Cookie: `${AUTH_RESUME_COOKIE}=${cookie}` },
    });

    await expect(verifySupabaseSessionFromRequest(request)).resolves.toEqual({
      status: "verified",
      userId: "user-1",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
