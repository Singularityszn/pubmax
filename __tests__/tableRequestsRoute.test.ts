// "Ask the pub for a table" (launch plan 1 Nov 2026, section 7 item 3): the
// one route, POST and the operator's GET.
//
// The REAL contribution gate runs (resolveContributionIdentity), so the sign-in,
// handle and adult refusals below are the gate's own answers, not a double's.
// Its stores are doubled: the session, the profile, the date of birth and the
// one-tap assertion. The venue index, the operator's account address and the
// email seam are doubled too. The table-request store and the operator store
// are the real process-memory backends.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const ALICE = "a1111111-1111-4111-8111-111111111111";
const OPERATOR = "o1111111-1111-4111-8111-111111111111";
const STRANGER = "c1111111-1111-4111-8111-111111111111";
const OPERATOR_ADDRESS = "landlord@thecrown.example";

const state = vi.hoisted(() => ({
  caller: null as string | null,
  authUnavailable: false,
  profiles: new Map<string, { id: string; handle: string }>(),
  dateOfBirth: new Map<string, string>(),
  asserted: new Map<string, string>(),
  addresses: new Map<string, string>(),
  sendResult: "sent" as "sent" | "skipped" | "error",
  sent: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/authServer", () => ({
  verifyCallerAuth: async () =>
    state.authUnavailable
      ? { status: "unavailable" }
      : state.caller
        ? { status: "verified", identity: { id: state.caller } }
        : { status: "absent" },
  callerAuthIdentity: async () => (state.caller ? { id: state.caller } : null),
}));

vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({
    getByUserId: async (userId: string) => {
      const profile = state.profiles.get(userId);
      return profile ? { ...profile, userId } : null;
    },
  }),
}));

vi.mock("@/lib/privateIdentityStore", () => ({
  privateIdentityStore: () => ({
    read: async (userId: string) => {
      const dateOfBirth = state.dateOfBirth.get(userId);
      return dateOfBirth ? { dateOfBirth } : null;
    },
  }),
}));

vi.mock("@/lib/adultSelfAssertionStore", () => ({
  adultSelfAssertionStore: () => ({
    read: async (userId: string) => state.asserted.get(userId) ?? null,
  }),
}));

vi.mock("@/lib/identityHandleStore", () => ({
  identityHandleStore: () => ({ resolve: async () => null }),
}));

vi.mock("@/lib/venueAliases", () => ({
  storedVenueIds: async (id: string) => [id],
  resolveCanonicalVenueId: async (id: string) => id,
}));

vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: async (id: string) => {
    if (id === "venue-down") return { status: "unavailable", canonicalId: id };
    if (id === "venue-crown") {
      return { status: "found", canonicalId: id, venue: { id, name: "The Crown", borough: "Camden", lat: 51.5, lng: -0.1, kind: "pub" } };
    }
    if (id === "venue-bar") {
      return { status: "found", canonicalId: id, venue: { id, name: "Cocktail Bar", borough: "Soho", lat: 51.5, lng: -0.1, kind: "bar" } };
    }
    return { status: "unknown", canonicalId: id };
  },
}));

vi.mock("@/lib/operatorAccountAddress.server", () => ({
  operatorAccountAddress: async (accountId: string) => state.addresses.get(accountId) ?? null,
}));

vi.mock("@/lib/emailProvider", () => ({
  selectEmailProvider: () => ({
    send: async (messages: Array<Record<string, unknown>>) => {
      state.sent.push(...messages);
      return messages.map((message) => ({ to: message.to, status: state.sendResult }));
    },
  }),
}));

import { GET, POST } from "@/app/api/table-requests/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import { londonCalendarDate } from "@/lib/privateIdentity";
import { __resetTableRequests, memoryTableRequestsStore } from "@/lib/tableRequestsStore";
import { __resetVenueOperators, memoryVenueOperatorStore } from "@/lib/venueOperatorsStore";

const TOMORROW = londonCalendarDate(Date.now() + 24 * 60 * 60 * 1000);
const SAM_CONTACT = "sam.crew@example.com";

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}`;
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    venueId: "venue-crown",
    name: "Sam",
    partySize: 8,
    date: TOMORROW,
    time: "19:30",
    note: "A birthday, nothing loud.",
    contact: { kind: "email", value: SAM_CONTACT },
    ...overrides,
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/table-requests", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function read(venueId: string): Request {
  return new Request(`http://localhost/api/table-requests?venueId=${venueId}`, {
    headers: { "x-forwarded-for": nextIp() },
  });
}

async function verifyOperator(accountId: string, venueId: string): Promise<void> {
  const claim = await memoryVenueOperatorStore.claim({
    accountId,
    venueId,
    evidenceKind: "phone",
    evidenceNote: "Ring the bar.",
  });
  await memoryVenueOperatorStore.setState(claim.id, "verified");
}

function adultWithHandle(userId: string, handle: string): void {
  state.profiles.set(userId, { id: `profile-${handle}`, handle });
  state.asserted.set(userId, "2026-10-01T12:00:00.000Z");
}

beforeEach(() => {
  __resetTableRequests();
  __resetVenueOperators();
  __resetPintDrops();
  state.caller = ALICE;
  state.authUnavailable = false;
  state.profiles.clear();
  state.dateOfBirth.clear();
  state.asserted.clear();
  state.addresses.clear();
  state.sent.length = 0;
  state.sendResult = "sent";
  adultWithHandle(ALICE, "alice");
  adultWithHandle(OPERATOR, "landlord");
  adultWithHandle(STRANGER, "stranger");
  state.addresses.set(OPERATOR, OPERATOR_ADDRESS);
});

describe("POST /api/table-requests: who may ask", () => {
  it("answers 401 in the envelope to a signed-out request and sends nothing", async () => {
    state.caller = null;
    const response = await POST(post(request()));
    expect(response.status).toBe(401);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: "UNAUTHENTICATED", retryable: false, status: "sign_in_required" });
    expect(typeof body.error).toBe("string");
    expect(state.sent).toHaveLength(0);
  });

  it("answers 503 when sign-in cannot be checked", async () => {
    state.authUnavailable = true;
    const response = await POST(post(request()));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "AUTH_VERIFICATION_UNAVAILABLE", retryable: true });
  });

  it("asks for a handle before anything else", async () => {
    state.profiles.delete(ALICE);
    const response = await POST(post(request()));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "HANDLE_REQUIRED", status: "onboarding_required" });
  });

  it("holds the adult gate: no answer asks for the tap, an under-18 date of birth refuses", async () => {
    state.asserted.delete(ALICE);
    const unasked = await POST(post(request()));
    expect(unasked.status).toBe(409);
    expect(await unasked.json()).toMatchObject({ code: "ADULT_REQUIRED", status: "adult_check_required" });

    // A stored date of birth decides in both directions, and a tap cannot overturn it.
    state.asserted.set(ALICE, "2026-10-01T12:00:00.000Z");
    state.dateOfBirth.set(ALICE, "2012-05-01");
    const under = await POST(post(request()));
    expect(under.status).toBe(409);
    expect(await under.json()).toMatchObject({ code: "ADULT_REQUIRED", status: "adult_check_failed" });
    expect(state.sent).toHaveLength(0);
  });
});

describe("POST /api/table-requests: what a request must say", () => {
  it("refuses a malformed body", async () => {
    const response = await POST(post("not json"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "MALFORMED_REQUEST" });
  });

  it.each([
    ["partySize", { partySize: 5 }],
    ["partySize", { partySize: 21 }],
    ["partySize", { partySize: 7.5 }],
    ["name", { name: "   " }],
    ["date", { date: "2026-02-30" }],
    ["date", { date: "2020-01-01" }],
    ["time", { time: "25:00" }],
    ["time", { time: "7pm" }],
    ["contact", { contact: { kind: "email", value: "not-an-address" } }],
    ["contact", { contact: { kind: "phone", value: "call me" } }],
    ["contact", { contact: { kind: "fax", value: "0207 946 0000" } }],
  ])("refuses a bad %s with the field named", async (field, overrides) => {
    const response = await POST(post(request(overrides)));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_TABLE_REQUEST", details: { field } });
  });

  it("asks for a pub: an unknown id and a bar are refused, an index that cannot answer is a 503", async () => {
    expect((await POST(post(request({ venueId: "venue-nowhere" })))).status).toBe(400);
    expect((await POST(post(request({ venueId: "venue-bar" })))).status).toBe(400);
    const down = await POST(post(request({ venueId: "venue-down" })));
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ retryable: true });
  });
});

describe("POST /api/table-requests: the two ways out", () => {
  it("with no verified operator, PUBMAXX sends nothing and stores nothing", async () => {
    const response = await POST(post(request()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "not_sent" });
    expect(state.sent).toHaveLength(0);
    expect((await memoryTableRequestsStore.listEmailedForVenue("venue-crown")).requests).toHaveLength(0);
  });

  it("emails a verified operator, replies to the person, and stores it for the panel", async () => {
    await verifyOperator(OPERATOR, "venue-crown");
    const response = await POST(post(request()));
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ outcome: "sent" });

    expect(state.sent).toHaveLength(1);
    const message = state.sent[0]!;
    expect(message.to).toBe(OPERATOR_ADDRESS);
    expect(message.replyTo).toBe(SAM_CONTACT);
    expect(String(message.subject)).toContain("Table for 8 at The Crown");
    expect(String(message.text)).toContain("Sam would like a table for 8");
    expect(String(message.text)).toContain(`Reply by email to ${SAM_CONTACT}.`);
    expect(String(message.text)).toContain("We take no booking and no payment.");
    expect(String(message.idempotencyKey)).toMatch(/^table-request:/);

    const listed = await memoryTableRequestsStore.listEmailedForVenue("venue-crown");
    expect(listed.requests).toHaveLength(1);
    expect(listed.requests[0]).toMatchObject({ partySize: 8, delivery: "emailed", contactValue: SAM_CONTACT });
  });

  it("puts a phone contact in the body and sets no Reply-To", async () => {
    await verifyOperator(OPERATOR, "venue-crown");
    const response = await POST(post(request({ contact: { kind: "phone", value: "+44 7700 900123" } })));
    expect(response.status).toBe(201);
    expect(state.sent[0]!.replyTo).toBeUndefined();
    expect(String(state.sent[0]!.text)).toContain("Reply by phone on +447700900123.");
  });

  it("treats a keyless send (skipped) as not sent, and keeps no row for the panel", async () => {
    await verifyOperator(OPERATOR, "venue-crown");
    state.sendResult = "skipped";
    const response = await POST(post(request()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "not_sent" });
    expect(state.sent).toHaveLength(1);
    expect((await memoryTableRequestsStore.listEmailedForVenue("venue-crown")).requests).toHaveLength(0);
  });

  it("treats an operator with no address on file as not sent", async () => {
    await verifyOperator(OPERATOR, "venue-crown");
    state.addresses.delete(OPERATOR);
    const response = await POST(post(request()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "not_sent" });
    expect(state.sent).toHaveLength(0);
  });

  it("never emails a pending, rejected or other pub's operator", async () => {
    const pending = await memoryVenueOperatorStore.claim({
      accountId: STRANGER,
      venueId: "venue-crown",
      evidenceKind: "phone",
      evidenceNote: "Trust me.",
    });
    expect(pending.verificationState).toBe("pending");
    state.addresses.set(STRANGER, "stranger@example.com");
    await verifyOperator(OPERATOR, "venue-elsewhere");
    const response = await POST(post(request()));
    expect(await response.json()).toEqual({ outcome: "not_sent" });
    expect(state.sent).toHaveLength(0);
  });

  it("never echoes a contact: neither the operator's address nor the person's own", async () => {
    await verifyOperator(OPERATOR, "venue-crown");
    for (const sendResult of ["sent", "skipped"] as const) {
      state.sendResult = sendResult;
      const response = await POST(post(request()));
      const text = await response.text();
      expect(text).not.toContain(OPERATOR_ADDRESS);
      expect(text).not.toContain(SAM_CONTACT);
      expect(text).not.toContain(OPERATOR);
      expect(text).not.toContain(ALICE);
    }
  });

  it("charges nothing: the answer names an outcome and no price, fee or payment", async () => {
    await verifyOperator(OPERATOR, "venue-crown");
    const text = await (await POST(post(request()))).text();
    expect(text).not.toMatch(/fee|price|payment|charge|deposit|£/i);
  });
});

describe("POST /api/table-requests: the rate limit", () => {
  it("refuses the fifth request in an hour from one account, in the envelope", async () => {
    for (let i = 0; i < 4; i += 1) {
      expect((await POST(post(request()))).status, `request ${i + 1}`).toBe(200);
    }
    const limited = await POST(post(request()));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });

  it("spends no budget on a refused gate", async () => {
    state.caller = null;
    for (let i = 0; i < 6; i += 1) expect((await POST(post(request()))).status).toBe(401);
    state.caller = ALICE;
    expect((await POST(post(request()))).status).toBe(200);
  });
});

describe("GET /api/table-requests: the operator panel's read", () => {
  it("lists the pub's emailed requests to its verified operator, without an account id", async () => {
    await verifyOperator(OPERATOR, "venue-crown");
    expect((await POST(post(request()))).status).toBe(201);
    state.caller = OPERATOR;
    const response = await GET(read("venue-crown"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; requests: Array<Record<string, unknown>> };
    expect(body.status).toBe("ready");
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]).toMatchObject({ name: "Sam", partySize: 8, contactKind: "email", contactValue: SAM_CONTACT });
    expect(JSON.stringify(body)).not.toContain(ALICE);
    expect(body.requests[0]).not.toHaveProperty("requesterUserId");
  });

  it("refuses a signed-out reader, a stranger and another pub's operator", async () => {
    await verifyOperator(OPERATOR, "venue-crown");
    await POST(post(request()));
    state.caller = null;
    expect((await GET(read("venue-crown"))).status).toBe(401);
    state.caller = STRANGER;
    const stranger = await GET(read("venue-crown"));
    expect(stranger.status).toBe(403);
    expect(await stranger.text()).not.toContain(SAM_CONTACT);
    await verifyOperator(STRANGER, "venue-elsewhere");
    expect((await GET(read("venue-crown"))).status).toBe(403);
  });
});
