import { beforeEach, expect, it, vi } from "vitest";

const background = vi.hoisted(() => [] as Array<() => Promise<void>>);
const limited = vi.hoisted(() => vi.fn(async () => false));
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
  for (const email of ["known@example.com", "unknown@example.com"]) {
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
  expect(send).toHaveBeenCalledTimes(2);
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
