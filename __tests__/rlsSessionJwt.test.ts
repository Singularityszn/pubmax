import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRlsSessionJwt } from "../scripts/rls/session-jwt.mjs";

type Claims = { role: string; sub: string; exp: number };
const SECRET = "rls-session-test-only-dummy-secret";
const SUBJECT = "00000000-0000-4000-8000-000000000000";

function claims(token: string): Claims {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as Claims;
}

afterEach(() => vi.useRealTimers());

describe("RLS session JWT", () => {
  it("keeps the fixed service-role token valid through the 600-second slow-start and slow-test window", () => {
    vi.useFakeTimers();
    const issuedAtMs = Date.UTC(2026, 8, 29, 12, 0, 0);
    vi.setSystemTime(issuedAtMs);
    const token = createRlsSessionJwt(SECRET, SUBJECT, "service_role");
    const payload = claims(token);
    vi.setSystemTime(issuedAtMs + 600_000);
    expect(payload.exp - Math.floor(issuedAtMs / 1000)).toBeGreaterThanOrEqual(600 + 300);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("retains the requested subject, service-role claim and valid HS256 signature", () => {
    const token = createRlsSessionJwt(SECRET, SUBJECT, "service_role");
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual({ alg: "HS256", typ: "JWT" });
    expect(claims(token)).toMatchObject({ role: "service_role", sub: SUBJECT });
    expect(signature).toBe(createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url"));
    expect(signature).not.toBe(createHmac("sha256", "wrong-test-secret").update(`${header}.${payload}`).digest("base64url"));
  });

  it("defaults ordinary viewer requests to authenticated rather than service_role", () => {
    expect(claims(createRlsSessionJwt(SECRET, SUBJECT))).toMatchObject({ role: "authenticated", sub: SUBJECT });
  });

  it("mints later requests against the current clock without making the original token immortal", () => {
    vi.useFakeTimers();
    const issuedAtMs = Date.UTC(2026, 8, 29, 12, 0, 0);
    vi.setSystemTime(issuedAtMs);
    const first = claims(createRlsSessionJwt(SECRET, SUBJECT));
    vi.setSystemTime(first.exp * 1000 + 1_000);
    const later = claims(createRlsSessionJwt(SECRET, SUBJECT));
    expect(first.exp).toBeLessThan(Math.floor(Date.now() / 1000));
    expect(later.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(later.exp).toBeGreaterThan(first.exp);
  });
});
