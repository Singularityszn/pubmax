import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error - plain .mjs JWT module with no declaration sidecar.
import { createRlsSessionJwt } from "../scripts/rls/session-jwt.mjs";

afterEach(() => {
  vi.useRealTimers();
});

describe("RLS session JWT", () => {
  it("stays valid through the 600-second slow-start and slow-test window", () => {
    vi.useFakeTimers();
    const issuedAtMs = Date.UTC(2026, 8, 29, 12, 0, 0);
    vi.setSystemTime(issuedAtMs);

    const token = createRlsSessionJwt(
      "rls-session-test-only-dummy-secret",
      "00000000-0000-4000-8000-000000000000",
      "service_role",
    );
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    ) as { exp: number };
    const issuedAtSeconds = Math.floor(issuedAtMs / 1000);

    vi.setSystemTime(issuedAtMs + 600_000);

    expect(payload.exp - issuedAtSeconds).toBeGreaterThanOrEqual(600 + 300);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
