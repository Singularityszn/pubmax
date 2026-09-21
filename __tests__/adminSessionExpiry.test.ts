import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  ADMIN_SESSION_MAX_AGE_SEC,
  mintAdminSession,
  isModerator,
} from "@/lib/adminAuth";

const request = (value: string) =>
  new Request("https://example.test/api/admin/session", {
    headers: { cookie: `pubmax_admin_session=${value}` },
  });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("enforces expiry on a copied cookie independently of browser eviction", () => {
  vi.stubEnv("ADMIN_TOKEN", "expiry-test-secret");
  vi.useFakeTimers();
  const now = new Date("2026-09-22T00:00:00Z");
  vi.setSystemTime(now);
  const cookie = mintAdminSession("expiry-test-secret");
  vi.setSystemTime(now.getTime() + ADMIN_SESSION_MAX_AGE_SEC * 1000 - 1);
  expect(isModerator(request(cookie))).toBe(true);
  vi.setSystemTime(now.getTime() + ADMIN_SESSION_MAX_AGE_SEC * 1000);
  expect(isModerator(request(cookie))).toBe(false);
  vi.setSystemTime(now.getTime() + ADMIN_SESSION_MAX_AGE_SEC * 1000 + 1_000);
  expect(isModerator(request(cookie))).toBe(false);
});
it("rejects the legacy timeless cookie", () => {
  vi.stubEnv("ADMIN_TOKEN", "expiry-test-secret");
  expect(
    isModerator(
      request(createHash("sha256").update("expiry-test-secret").digest("hex")),
    ),
  ).toBe(false);
});
it("rejects altered issuance, malformed signatures and rotated credentials", () => {
  vi.stubEnv("ADMIN_TOKEN", "expiry-test-secret");
  const cookie = mintAdminSession("expiry-test-secret");
  const [version, issued, signature] = cookie.split(".");
  expect(
    isModerator(request(`${version}.${Number(issued) - 1}.${signature}`)),
  ).toBe(false);
  expect(isModerator(request(`${version}.${issued}.invalid`))).toBe(false);
  vi.stubEnv("ADMIN_TOKEN", "rotated-secret");
  expect(isModerator(request(cookie))).toBe(false);
});
