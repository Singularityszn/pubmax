import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({ log: vi.fn() }));
const background = vi.hoisted(() => [] as Array<() => Promise<void>>);
const limited = vi.hoisted(() => vi.fn<(key: string, durable: string, limit: number, window: number, opts: { failClosed: boolean }) => Promise<boolean>>(async () => false));
const send = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("next/server", () => ({ after: (work: () => Promise<void>) => background.push(work) }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: limited }));
vi.mock("@/lib/passwordRecovery.server", () => ({ sendPasswordRecoveryEmail: send }));
vi.mock("@/lib/supabase", () => ({ clientIp: () => "127.0.0.1", hashIp: (s: string) => `hash-${s.length}` }));

import { POST } from "@/app/api/auth/password-recovery/route";

function request(email: string, site = "same-origin") {
  return new Request("http://localhost/api/auth/password-recovery", {
    method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": site },
    body: JSON.stringify({ email }),
  });
}

beforeEach(() => { background.length = 0; limited.mockReset().mockResolvedValue(false); send.mockReset().mockResolvedValue(); });

it("answers before any account-dependent work starts, even when delivery never settles", async () => {
  send.mockImplementation(() => new Promise(() => {}));
  const response = await POST(request("Known@example.com"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ message: "If an account matches, we sent a link" });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(send).not.toHaveBeenCalled();
  expect(background).toHaveLength(1);
});

it("keeps known, unknown, limited and failed delivery responses identical", async () => {
  const outcomes: unknown[] = [];
  for (const email of ["known@example.com", "unknown@example.com", "failed@example.com"]) {
    if (email === "failed@example.com") send.mockRejectedValueOnce(new Error("Delivery unavailable"));
    const response = await POST(request(email));
    outcomes.push([response.status, await response.json()]);
    await background.pop()!();
  }
  limited.mockResolvedValue(true);
  const response = await POST(request("known@example.com"));
  outcomes.push([response.status, await response.json()]);
  expect(outcomes[0]).toEqual(outcomes[1]);
  expect(outcomes[1]).toEqual(outcomes[2]);
  expect(background).toHaveLength(0);
  expect(outcomes[2]).toEqual(outcomes[3]);
  expect(send).toHaveBeenCalledTimes(3);
});

it("silently refuses an exhausted account bucket and fails closed", async () => {
  limited.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const response = await POST(request("known@example.com"));
  await background.pop()!();
  expect(send).not.toHaveBeenCalled();
  expect(response.status).toBe(200);
  expect(limited.mock.calls.every(call => call[4]?.failClosed === true)).toBe(true);
});

it("refuses cross-site requests and malformed addresses", async () => {
  expect((await POST(request("known@example.com", "cross-site"))).status).toBe(403);
  expect((await POST(request("not an email"))).status).toBe(400);
  expect(send).not.toHaveBeenCalled();
});

it("bounds accepted request bodies and does not parse an IP-limited body", async () => {
  const large = new Request("http://localhost/api/auth/password-recovery", {
    method: "POST", body: JSON.stringify({ email: "known@example.com", extra: "x".repeat(2048) }),
  });
  expect((await POST(large)).status).toBe(413);
  limited.mockResolvedValue(true);
  expect((await POST(new Request("http://localhost/api/auth/password-recovery", { method: "POST", body: "{" }))).status).toBe(200);
});
