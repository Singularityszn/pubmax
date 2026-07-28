import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  id: null as string | null,
  createdAt: null as string | null,
}));
const limiterState = vi.hoisted(() => ({ limited: false }));

vi.mock("@/lib/pintDrops", () => ({
  isLimited: async () => limiterState.limited,
}));

vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.id,
    callerAuthIdentity: async () =>
      authState.id
        ? { id: authState.id, email: "person@example.com", createdAt: authState.createdAt }
        : null,
  };
});

import {
  DELETE as revokeAttribution,
  POST as claimAttribution,
} from "@/app/api/referrals/claim-attribution/route";
import { POST as inviteLink } from "@/app/api/referrals/invite-link/route";
import { GET as referralStatus } from "@/app/api/referrals/status/route";
import {
  GET as followInvite,
  POST as startInviteJourney,
} from "@/app/r/[code]/route";
import {
  __resetMemoryReferrals,
  memoryReferralStore,
} from "@/lib/referralStore";

const ORIGIN = "https://pubmaxxing.com";
const START = Date.parse("2026-07-28T10:00:00.000Z");

function request(
  path: string,
  init: RequestInit = {},
): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  authState.id = null;
  authState.createdAt = null;
  limiterState.limited = false;
  __resetMemoryReferrals();
  vi.useRealTimers();
});

describe("referral routes", () => {
  it("rejects account APIs without verified auth", async () => {
    expect((await inviteLink(request("/api/referrals/invite-link", { method: "POST" }))).status).toBe(401);
    expect((await referralStatus(request("/api/referrals/status"))).status).toBe(401);
    expect((await claimAttribution(request("/api/referrals/claim-attribution", { method: "POST" }))).status).toBe(401);
  });

  it("creates an opaque account-owned invite link without returning an account id", async () => {
    authState.id = "inviter-private";
    authState.createdAt = new Date(START - 10_000).toISOString();

    const response = await inviteLink(
      request("/api/referrals/invite-link", { method: "POST" }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.url).toMatch(/^https:\/\/pubmaxxing\.com\/r\/[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(body)).not.toContain("inviter-private");
  });

  it("redirects to a consent handoff without setting an attribution cookie", async () => {
    vi.setSystemTime(START);
    const { code } = await memoryReferralStore.getOrCreateInviteCode("inviter");
    const response = await followInvite(
      request(`/r/${code}`),
      { params: Promise.resolve({ code }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/#referral=${code}`,
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sets the 30-day journey cookie only through the consented handoff", async () => {
    vi.setSystemTime(START);
    const { code } = await memoryReferralStore.getOrCreateInviteCode("inviter");
    const response = await startInviteJourney(
      request(`/r/${code}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      }),
      { params: Promise.resolve({ code }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ captured: true });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^pubmaxx_referral_journey=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=2592000");
    expect(cookie).toContain("Secure");
  });

  it("refuses a journey handoff without consent", async () => {
    const { code } = await memoryReferralStore.getOrCreateInviteCode("inviter");
    const response = await startInviteJourney(
      request(`/r/${code}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: false }),
      }),
      { params: Promise.resolve({ code }) },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("bounds public journey creation before writing another row", async () => {
    const { code } = await memoryReferralStore.getOrCreateInviteCode("inviter");
    limiterState.limited = true;

    const response = await startInviteJourney(
      request(`/r/${code}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      }),
      { params: Promise.resolve({ code }) },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("clears the journey cookie when consent is withdrawn", async () => {
    const response = await revokeAttribution(
      request("/api/referrals/claim-attribution", {
        method: "DELETE",
        headers: { cookie: "pubmaxx_referral_journey=opaque" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("does not replace a valid first-touch journey after another invite link", async () => {
    vi.setSystemTime(START);
    const first = await memoryReferralStore.getOrCreateInviteCode("first");
    const second = await memoryReferralStore.getOrCreateInviteCode("second");
    const firstResponse = await startInviteJourney(
      request(`/r/${first.code}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      }),
      { params: Promise.resolve({ code: first.code }) },
    );
    const firstCookie = (firstResponse.headers.get("set-cookie") ?? "")
      .match(/pubmaxx_referral_journey=([^;]+)/)?.[1];

    const secondResponse = await startInviteJourney(
      request(`/r/${second.code}`, {
        method: "POST",
        headers: {
          cookie: `pubmaxx_referral_journey=${firstCookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ consent: true }),
      }),
      { params: Promise.resolve({ code: second.code }) },
    );
    const secondCookie = (secondResponse.headers.get("set-cookie") ?? "")
      .match(/pubmaxx_referral_journey=([^;]+)/)?.[1];
    expect(secondCookie).toBe(firstCookie);
  });

  it("records delayed signup attribution once and clears the journey cookie", async () => {
    vi.setSystemTime(START);
    const { code } = await memoryReferralStore.getOrCreateInviteCode("inviter");
    const visit = await startInviteJourney(
      request(`/r/${code}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      }),
      { params: Promise.resolve({ code }) },
    );
    const token = (visit.headers.get("set-cookie") ?? "")
      .match(/pubmaxx_referral_journey=([^;]+)/)?.[1];

    authState.id = "new-account";
    authState.createdAt = new Date(START + 24 * 60 * 60 * 1_000).toISOString();
    vi.setSystemTime(START + 24 * 60 * 60 * 1_000);
    const claimed = await claimAttribution(
      request("/api/referrals/claim-attribution", {
        method: "POST",
        headers: { cookie: `pubmaxx_referral_journey=${token}` },
      }),
    );

    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({ attributed: true });
    expect(claimed.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await memoryReferralStore.privateStatus("inviter")).toMatchObject({
      attributedCount: 1,
      qualifiedCount: 0,
    });
  });

  it("does not credit an account created before the invite journey", async () => {
    vi.setSystemTime(START);
    const { code } = await memoryReferralStore.getOrCreateInviteCode("inviter");
    const visit = await startInviteJourney(
      request(`/r/${code}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      }),
      { params: Promise.resolve({ code }) },
    );
    const token = (visit.headers.get("set-cookie") ?? "")
      .match(/pubmaxx_referral_journey=([^;]+)/)?.[1];
    authState.id = "old-account";
    authState.createdAt = new Date(START - 1).toISOString();

    const response = await claimAttribution(
      request("/api/referrals/claim-attribution", {
        method: "POST",
        headers: { cookie: `pubmaxx_referral_journey=${token}` },
      }),
    );
    expect(await response.json()).toEqual({
      attributed: false,
      reason: "account_predates_journey",
    });
    expect(await memoryReferralStore.privateStatus("inviter")).toMatchObject({
      attributedCount: 0,
    });
  });

  it("returns only aggregate viewer-owned status", async () => {
    authState.id = "inviter-secret";
    authState.createdAt = new Date(START).toISOString();
    await memoryReferralStore.recordEdge("inviter-secret", "invitee-secret", START);

    const response = await referralStatus(request("/api/referrals/status"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      attributedCount: 1,
      qualifiedCount: 0,
      grantsEnabled: false,
    });
    expect(JSON.stringify(body)).not.toContain("inviter-secret");
    expect(JSON.stringify(body)).not.toContain("invitee-secret");
  });
});
