import { describe, expect, it, vi } from "vitest";

// The invite-reaction toggle trusts a body submitterId, so a caller rotating it
// gets a fresh submitter budget each time. These cases drive the real
// in-memory limiter to prove the per-IP and per-invite budgets bound that.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/opsFreeze", () => ({ socialFreezeResponse: () => null }));
vi.mock("@/lib/planInviteResolve", () => ({
  resolveClassicInvitePlan: async () => ({ planId: "plan-reactions" }),
}));
vi.mock("@/lib/planInviteRsvpStore", () => ({
  UnknownPlanError: class UnknownPlanError extends Error {},
  reactionStore: () => ({
    toggle: async () => ({ counts: {}, mine: [] }),
    summarize: async () => ({ counts: {}, mine: [] }),
  }),
}));

import { GET, POST } from "@/app/api/invite/[token]/reactions/route";

const tokenCtx = (token: string) => ({ params: Promise.resolve({ token }) });

function toggle(token: string, ip: string, submitterId: string): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/invite/${token}/reactions`, {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: JSON.stringify({ reaction: "cheers", submitterId }),
    }),
    tokenCtx(token),
  );
}

describe("invite reaction budgets", () => {
  it("429s one IP rotating its submitterId past the per-IP budget", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 65; i++) {
      statuses.push((await toggle("token-ip", "203.0.113.10", `device-${i}`)).status);
    }
    expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(60).every((status) => status === 429)).toBe(true);
  });

  it("429s one invite flooded from many IPs past the per-invite budget", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 165; i++) {
      statuses.push((await toggle("token-flood", `198.51.100.${i % 200}`, `guest-${i}`)).status);
    }
    expect(statuses.slice(0, 160).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(160).every((status) => status === 429)).toBe(true);
    // Another invite keeps its own budget.
    expect((await toggle("token-quiet", "198.51.100.250", "guest-quiet")).status).toBe(200);
  });

  it("429s a hydrate loop from one IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 125; i++) {
      const res = await GET(
        new Request(`http://localhost/api/invite/token-read/reactions?submitterId=device-${i}`, {
          headers: { "x-forwarded-for": "203.0.113.20" },
        }),
        tokenCtx("token-read"),
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 120).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(120).every((status) => status === 429)).toBe(true);
  });
});
