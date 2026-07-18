import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/email-subscribers/route";
import {
  buildConfirmationEmail,
  confirmUrl,
  dispatchConfirmationEmail,
  isConfirmationDeliveryConfigured,
  unsubscribeUrl,
} from "@/lib/emailConfirmation";
import {
  coerceSource,
  isValidEmail,
  MAX_EMAIL_LENGTH,
  mintUnsubscribeToken,
  normalizeEmail,
  parseEmail,
} from "@/lib/emailSubscribers";
import {
  __resetEmailSubscribers,
  emailSubscribersStore,
} from "@/lib/emailSubscribersStore";

// The default vitest env has no Supabase configured, so the store selects its
// process-memory backend. Vercel CI presets real SUPABASE_URL/KEY which would
// flip the store to the durable backend mid-suite — neutralise them like
// priceConfirm.test.ts does. The Supabase backend has its own suite
// (emailSubscribersSupabase.test.ts) with a mocked client.
const ORIGINAL_URL = process.env.SUPABASE_URL;
const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGINAL_RESEND = process.env.RESEND_API_KEY;
const ORIGINAL_FROM = process.env.EMAIL_FROM;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

afterEach(() => {
  __resetEmailSubscribers();
  if (ORIGINAL_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_URL;
  if (ORIGINAL_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
  if (ORIGINAL_RESEND === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_RESEND;
  if (ORIGINAL_FROM === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = ORIGINAL_FROM;
});

describe("email validation", () => {
  it("accepts a plausible address once normalised", () => {
    expect(isValidEmail("you@example.com")).toBe(true);
    expect(isValidEmail("  You@Example.COM ")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.example.co.uk")).toBe(true);
  });

  it("rejects empty, spaceful, @-less, or dot-less strings", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("   ")).toBe(false);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("no at sign.com")).toBe(false);
    expect(isValidEmail("missing@tld")).toBe(false);
    expect(isValidEmail("two@@at.com")).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(42)).toBe(false);
  });

  it("rejects an address longer than the max length", () => {
    const long = `${"a".repeat(MAX_EMAIL_LENGTH)}@example.com`;
    expect(long.length).toBeGreaterThan(MAX_EMAIL_LENGTH);
    expect(isValidEmail(long)).toBe(false);
  });

  it("normalises to trimmed lower-case", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(normalizeEmail(123)).toBe("");
  });

  it("parseEmail returns the canonical form or null", () => {
    expect(parseEmail("  You@Example.com ")).toBe("you@example.com");
    expect(parseEmail("bad")).toBeNull();
  });

  it("coerces an unknown source to the default, never trusting a spoofed value", () => {
    expect(coerceSource("identity-nudge")).toBe("identity-nudge");
    expect(coerceSource("evil-source")).toBe("identity-nudge");
    expect(coerceSource(undefined)).toBe("identity-nudge");
  });

  it("mints opaque, unique unsubscribe tokens", () => {
    const a = mintUnsubscribeToken();
    const b = mintUnsubscribeToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(24);
  });
});

describe("emailSubscribersStore (memory backend)", () => {
  it("stores a new address UNCONFIRMED and reports it created", async () => {
    const out = await emailSubscribersStore().subscribe({ email: "New@Example.com" });
    expect(out.status).toBe("created");
    expect(out.confirmed).toBe(false);
    expect(out.unsubscribeToken).toMatch(/\S/);
    expect(out.failed).toBeUndefined();
  });

  it("is idempotent by email: a re-submit returns existing without a new row or re-confirm", async () => {
    const first = await emailSubscribersStore().subscribe({ email: "dup@example.com" });
    const again = await emailSubscribersStore().subscribe({ email: " DUP@example.com " });
    expect(again.status).toBe("existing");
    expect(again.confirmed).toBe(false);
    // Same canonical row → same token, not a rotation.
    expect(again.unsubscribeToken).toBe(first.unsubscribeToken);
    const confirmed = await emailSubscribersStore().listConfirmedSubscribers();
    expect(confirmed).toHaveLength(0);
  });

  it("flags an invalid email as failed rather than storing junk", async () => {
    const out = await emailSubscribersStore().subscribe({ email: "not-an-email" });
    expect(out.failed).toBe(true);
    expect(out.unsubscribeToken).toBe("");
  });

  it("confirm(token) moves a pending row to confirmed exactly once", async () => {
    const sub = await emailSubscribersStore().subscribe({ email: "confirm@example.com" });
    expect(await emailSubscribersStore().confirm(sub.unsubscribeToken)).toBe(true);
    // Second confirm is a no-op (already confirmed).
    expect(await emailSubscribersStore().confirm(sub.unsubscribeToken)).toBe(false);
    expect(await emailSubscribersStore().confirm("unknown-token")).toBe(false);
  });

  it("unsubscribe(token) removes the row (right to erasure)", async () => {
    const sub = await emailSubscribersStore().subscribe({ email: "gone@example.com" });
    await emailSubscribersStore().confirm(sub.unsubscribeToken);
    expect(await emailSubscribersStore().unsubscribe(sub.unsubscribeToken)).toBe(true);
    expect(await emailSubscribersStore().unsubscribe(sub.unsubscribeToken)).toBe(false);
    expect(await emailSubscribersStore().listConfirmedSubscribers()).toHaveLength(0);
  });
});

describe("digest recipient seam (#327 double opt-in)", () => {
  it("listConfirmedSubscribers yields ONLY confirmed rows — unconfirmed never opt in", async () => {
    const store = emailSubscribersStore();
    const pending = await store.subscribe({ email: "pending@example.com" });
    const willConfirm = await store.subscribe({ email: "ready@example.com" });
    await store.confirm(willConfirm.unsubscribeToken);

    const confirmed = await store.listConfirmedSubscribers();
    expect(confirmed.map((c) => c.email)).toEqual(["ready@example.com"]);
    // The pending address is absent, so mapping to a DigestAudienceMember keeps
    // optIn effectively false — double opt-in holds end-to-end.
    expect(confirmed.some((c) => c.email === "pending@example.com")).toBe(false);
    expect(pending.confirmed).toBe(false);

    // The documented mapping the digest audience loader will apply.
    const members = confirmed.map((c) => ({ email: c.email, optIn: true, optOut: false }));
    expect(members).toEqual([{ email: "ready@example.com", optIn: true, optOut: false }]);
  });
});

describe("confirmation email seam (provider-gated, inert today)", () => {
  it("is not configured without both provider keys", () => {
    expect(isConfirmationDeliveryConfigured()).toBe(false);
    process.env.RESEND_API_KEY = "key";
    expect(isConfirmationDeliveryConfigured()).toBe(false);
    process.env.EMAIL_FROM = "hello@pubmaxxing.com";
    expect(isConfirmationDeliveryConfigured()).toBe(true);
  });

  it("builds a single-purpose email carrying confirm + unsubscribe links", () => {
    const msg = buildConfirmationEmail({
      email: "you@example.com",
      origin: "https://pubmaxxing.com/",
      token: "tok123",
    });
    expect(msg.to).toBe("you@example.com");
    expect(msg.subject).toMatch(/confirm/i);
    expect(msg.html).toContain(confirmUrl("https://pubmaxxing.com", "tok123"));
    expect(msg.text).toContain(unsubscribeUrl("https://pubmaxxing.com", "tok123"));
    // States the single purpose (the digest) — honest purpose limitation.
    expect(msg.text.toLowerCase()).toContain("weekly pint digest");
  });

  it("dispatch is a truthful noop until keys exist (never fakes a send)", async () => {
    const res = await dispatchConfirmationEmail({
      email: "you@example.com",
      origin: "https://pubmaxxing.com",
      token: "tok123",
    });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe("email_provider_not_configured");
  });
});

function postRequest(body: unknown, ip: string): Request {
  return new Request("https://pubmaxxing.com/api/email-subscribers", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("POST /api/email-subscribers", () => {
  it("400s an invalid email — honest validation, no fake success", async () => {
    const res = await POST(postRequest({ email: "nope" }, "10.0.0.1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/valid email/i);
  });

  it("400s a malformed JSON body", async () => {
    const req = new Request("https://pubmaxxing.com/api/email-subscribers", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.2" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("200s a fresh capture, stores it unconfirmed, and reports confirmationSent:false today", async () => {
    const res = await POST(postRequest({ email: "fresh@example.com" }, "10.0.0.3"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: "created", confirmed: false, confirmationSent: false });
    // The token is NEVER returned to the browser.
    expect(body).not.toHaveProperty("unsubscribeToken");
    expect(body).not.toHaveProperty("token");

    const confirmed = await emailSubscribersStore().listConfirmedSubscribers();
    expect(confirmed).toHaveLength(0);
  });

  it("reports existing on a re-submit of the same address", async () => {
    await POST(postRequest({ email: "again@example.com" }, "10.0.0.4"));
    const res = await POST(postRequest({ email: "again@example.com" }, "10.0.0.4"));
    const body = await res.json();
    expect(body.status).toBe("existing");
  });

  it("429s once the per-IP limit is exceeded (durable-off in-memory limiter)", async () => {
    const ip = "10.0.0.5";
    // PER_IP_LIMIT is 5: the first five pass, the sixth trips.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await POST(postRequest({ email: `rl${i}@example.com` }, ip));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
