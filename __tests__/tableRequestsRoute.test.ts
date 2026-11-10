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
import type { EmailMessage, EmailProvider } from "@/lib/emailProvider";

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
  addressUnavailable: false,
  sendResult: "sent" as "sent" | "skipped" | "error",
  noProvider: false,
  send: null as EmailProvider["send"] | null,
  sent: [] as EmailMessage[],
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
  operatorAccountAddress: async (accountId: string) => {
    if (state.addressUnavailable) throw new Error("Auth unavailable");
    return state.addresses.get(accountId) ?? null;
  },
}));

vi.mock("@/lib/emailProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/emailProvider")>();
  return {
    ...actual,
    selectEmailProvider: () => state.noProvider ? actual.noopEmailProvider : ({
      send: async (messages: readonly EmailMessage[]) => {
        state.sent.push(...messages);
        if (state.send) return state.send(messages);
        return messages.map((message) => ({ to: message.to, status: state.sendResult }));
      },
    }),
  };
});

import { GET, POST } from "@/app/api/table-requests/route";
import * as operatorAccounts from "@/lib/operatorAccountAddress.server";
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
  state.addressUnavailable = false;
  state.send = null;
  state.sent.length = 0;
  state.sendResult = "sent";
  state.noProvider = false;
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

  it("asks the pub once when a request is retried under its key, and again for a new key", async () => {
    await verifyOperator(OPERATOR, "venue-crown");
    const key = "retry-key-0123456789abcdef";
    expect((await POST(post(request({ requestKey: key })))).status).toBe(201);
    // The answer was lost; the form sends the same request under the same key.
    const retry = await POST(post(request({ requestKey: key })));
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual({ outcome: "sent" });
    expect(state.sent).toHaveLength(1);
    expect((await memoryTableRequestsStore.listEmailedForVenue("venue-crown")).requests).toHaveLength(1);

    expect((await POST(post(request({ requestKey: "another-key-0123456789ab", partySize: 9 })))).status).toBe(201);
    expect(state.sent).toHaveLength(2);
  });

  it.each(["before", "after"])("preserves a shared request when a retry fails %s its successful stamp", async (order) => {
    await verifyOperator(OPERATOR, "venue-crown");
    type Results = Awaited<ReturnType<EmailProvider["send"]>>;
    const originalSend = Promise.withResolvers<Results>();
    const retrySend = Promise.withResolvers<Results>();
    const originalStarted = Promise.withResolvers<void>();
    const retryStarted = Promise.withResolvers<void>();
    let calls = 0;
    state.send = () => {
      calls += 1;
      if (calls === 1) {
        originalStarted.resolve();
        return originalSend.promise;
      }
      retryStarted.resolve();
      return retrySend.promise;
    };
    const payload = request({ requestKey: "overlapping-key-0123456789" });
    const original = POST(post(payload));
    await originalStarted.promise;
    const retry = POST(post(payload));
    await retryStarted.promise;

    if (order === "before") {
      retrySend.resolve([{ to: OPERATOR_ADDRESS, status: "error" }]);
      expect((await retry).status).toBe(503);
      originalSend.resolve([{ to: OPERATOR_ADDRESS, status: "sent" }]);
      expect((await original).status).toBe(201);
    } else {
      originalSend.resolve([{ to: OPERATOR_ADDRESS, status: "sent" }]);
      expect((await original).status).toBe(201);
      retrySend.resolve([{ to: OPERATOR_ADDRESS, status: "error" }]);
      expect((await retry).status).toBe(503);
    }

    expect(await (await retry).json()).toMatchObject({ retryable: true });
    expect(state.sent.map((message) => message.idempotencyKey)).toEqual([
      state.sent[0]!.idempotencyKey,
      state.sent[0]!.idempotencyKey,
    ]);
    const stored = await memoryTableRequestsStore.listEmailedForVenue("venue-crown");
    expect(stored.requests).toHaveLength(1);
    expect(stored.requests[0]).toMatchObject({ delivery: "emailed" });
    expect((await POST(post(payload))).status).toBe(201);
    expect(calls).toBe(2);
  });

  it.each(["operators", "address"])("replays success when the current %s lookup fails", async (lookup) => {
    await verifyOperator(OPERATOR, "venue-crown");
    const payload = request({ requestKey: "completed-key-0123456789" });
    expect((await POST(post(payload))).status).toBe(201);
    const operators = lookup === "operators"
      ? vi.spyOn(memoryVenueOperatorStore, "verifiedOperatorAccountIds").mockRejectedValue(new Error("store unavailable"))
      : null;
    state.addressUnavailable = lookup === "address";
    try {
      const response = await POST(post(payload));
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ outcome: "sent" });
      expect(state.sent).toHaveLength(1);
    } finally {
      operators?.mockRestore();
    }
  });

  it.each(["error", "throw"] as const)("retries a %s send with its original row and email key", async (failure) => {
    await verifyOperator(OPERATOR, "venue-crown");
    const payload = request({ requestKey: "uncertain-key-0123456789" });
    state.sendResult = failure === "throw" ? "error" : failure;
    if (failure === "throw") state.send = async () => { throw new Error("connection lost"); };
    const failed = await POST(post(payload));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ retryable: true });
    expect((await memoryTableRequestsStore.listEmailedForVenue("venue-crown")).requests).toEqual([]);
    state.sendResult = "sent";
    state.send = null;
    expect((await POST(post(payload))).status).toBe(201);
    expect(state.sent[1]!.idempotencyKey).toBe(state.sent[0]!.idempotencyKey);
    expect((await memoryTableRequestsStore.listForRequester(ALICE)).requests).toHaveLength(1);
  });

  it.each(["address", "order", "case"])("keeps recipient email keys after an operator %s change", async (change) => {
    await verifyOperator(OPERATOR, "venue-crown");
    await verifyOperator(STRANGER, "venue-crown");
    if (change === "address") state.addresses.delete(OPERATOR);
    state.addresses.set(STRANGER, "second@thecrown.example");
    const payload = request({ requestKey: "recipient-key-0123456789" });
    state.sendResult = "error";
    expect((await POST(post(payload))).status).toBe(503);
    const firstKey = state.sent.find((message) => message.to === "second@thecrown.example")!.idempotencyKey;
    state.addresses.set(OPERATOR, OPERATOR_ADDRESS);
    if (change === "case") state.addresses.set(STRANGER, " Second@TheCrown.Example ");
    const operators = change === "order"
      ? vi.spyOn(memoryVenueOperatorStore, "verifiedOperatorAccountIds").mockResolvedValue([STRANGER, OPERATOR])
      : null;
    state.sendResult = "sent";
    try {
      expect((await POST(post(payload))).status).toBe(201);
      const secondRecipientMessages = state.sent.filter((message) => message.to === "second@thecrown.example");
      expect(secondRecipientMessages.map((message) => message.idempotencyKey)).toEqual([firstKey, firstKey]);
      expect(state.sent.find((message) => message.to === OPERATOR_ADDRESS)!.idempotencyKey).not.toBe(firstKey);
    } finally {
      operators?.mockRestore();
    }
  });

  it.each([
    ["operators", "pending"], ["operators", "emailed"],
    ["address", "pending"], ["address", "emailed"],
  ])("reconciles a concurrent %s lookup failure with a %s attempt", async (lookup, delivery) => {
    await verifyOperator(OPERATOR, "venue-crown");
    const lookupStarted = Promise.withResolvers<void>();
    const failedLookup = Promise.withResolvers<never>();
    const delayedLookup = lookup === "operators"
      ? vi.spyOn(memoryVenueOperatorStore, "verifiedOperatorAccountIds").mockImplementationOnce(() => {
        lookupStarted.resolve();
        return failedLookup.promise;
      })
      : vi.spyOn(operatorAccounts, "operatorAccountAddress").mockImplementationOnce(() => {
        lookupStarted.resolve();
        return failedLookup.promise;
      });
    const sendStarted = Promise.withResolvers<void>();
    const sendResult = Promise.withResolvers<Awaited<ReturnType<EmailProvider["send"]>>>();
    state.send = () => {
      sendStarted.resolve();
      return sendResult.promise;
    };
    const payload = request({ requestKey: "delayed-lookup-0123456789" });
    try {
      const retry = POST(post(payload));
      await lookupStarted.promise;
      const original = POST(post(payload));
      await sendStarted.promise;
      if (delivery === "emailed") {
        sendResult.resolve([{ to: OPERATOR_ADDRESS, status: "sent" }]);
        expect((await original).status).toBe(201);
      }
      failedLookup.reject(new Error("lookup unavailable"));
      const response = await retry;
      expect(response.status).toBe(delivery === "emailed" ? 201 : 503);
      expect(await response.json()).toMatchObject(delivery === "emailed" ? { outcome: "sent" } : { retryable: true });
      sendResult.resolve([{ to: OPERATOR_ADDRESS, status: "sent" }]);
      expect((await original).status).toBe(201);
      expect(state.sent).toHaveLength(1);
    } finally {
      delayedLookup.mockRestore();
    }
  });

  it.each(["operators", "address"])("keeps a failed %s lookup retryable before the original attempt exists", async (lookup) => {
    await verifyOperator(OPERATOR, "venue-crown");
    const lookupStarted = Promise.withResolvers<void>();
    const originalLookup = Promise.withResolvers<void>();
    const target = lookup === "operators"
      ? vi.spyOn(memoryVenueOperatorStore, "verifiedOperatorAccountIds")
        .mockImplementationOnce(async () => {
          lookupStarted.resolve();
          await originalLookup.promise;
          return [OPERATOR];
        })
        .mockRejectedValueOnce(new Error("store unavailable"))
      : vi.spyOn(operatorAccounts, "operatorAccountAddress")
        .mockImplementationOnce(async () => {
          lookupStarted.resolve();
          await originalLookup.promise;
          return OPERATOR_ADDRESS;
        })
        .mockRejectedValueOnce(new Error("Auth unavailable"));
    const payload = request({ requestKey: "before-row-key-0123456789" });
    const original = POST(post(payload));
    try {
      await lookupStarted.promise;
      const retry = await POST(post(payload));
      expect(retry.status).toBe(503);
      expect(await retry.json()).toMatchObject({ retryable: true });
      expect((await memoryTableRequestsStore.listForRequester(ALICE)).requests).toEqual([]);
      expect(state.sent).toHaveLength(0);
      originalLookup.resolve();
      expect((await original).status).toBe(201);
      expect((await POST(post(payload))).status).toBe(201);
      expect(state.sent).toHaveLength(1);
      expect((await memoryTableRequestsStore.listForRequester(ALICE)).requests).toHaveLength(1);
    } finally {
      originalLookup.resolve();
      await original;
      target.mockRestore();
    }
  });

  it("does not send to a partial audience when another address lookup is unavailable", async () => {
    await verifyOperator(OPERATOR, "venue-crown");
    await verifyOperator(STRANGER, "venue-crown");
    const address = vi.spyOn(operatorAccounts, "operatorAccountAddress")
      .mockImplementation(async (id) => {
        if (id === STRANGER) throw new Error("Auth unavailable");
        return OPERATOR_ADDRESS;
      });
    try {
      const response = await POST(post(request({ requestKey: "partial-key-0123456789ab" })));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ retryable: true });
      expect(state.sent).toHaveLength(0);
      expect((await memoryTableRequestsStore.listForRequester(ALICE)).requests).toEqual([]);
    } finally {
      address.mockRestore();
    }
  });

  it("offers manual contact without creating an attempt when the email provider is absent", async () => {
    await verifyOperator(OPERATOR, "venue-crown");
    state.noProvider = true;
    const payload = request({ requestKey: "no-provider-0123456789ab" });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await POST(post(payload));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ outcome: "not_sent" });
    }
    expect(state.sent).toHaveLength(0);
    expect((await memoryTableRequestsStore.listForRequester(ALICE)).requests).toEqual([]);
  });

  it("does not offer manual contact when an uncertain attempt loses its email provider", async () => {
    await verifyOperator(OPERATOR, "venue-crown");
    const payload = request({ requestKey: "lost-provider-0123456789" });
    state.sendResult = "error";
    expect((await POST(post(payload))).status).toBe(503);
    state.noProvider = true;
    expect((await POST(post(payload))).status).toBe(503);
    expect(state.sent).toHaveLength(1);
    expect((await memoryTableRequestsStore.listForRequester(ALICE)).requests).toHaveLength(1);
  });

  it.each(["error", "stamp"])("does not resend an old pending attempt after a %s failure", async (failure) => {
    await verifyOperator(OPERATOR, "venue-crown");
    const payload = request({ requestKey: "expired-key-0123456789ab" });
    const stamp = failure === "stamp"
      ? vi.spyOn(memoryTableRequestsStore, "markEmailed").mockRejectedValue(new Error("stamp unavailable"))
      : null;
    const clock = vi.spyOn(Date, "now");
    const start = Date.now();
    try {
      state.sendResult = failure === "error" ? "error" : "sent";
      expect((await POST(post(payload))).status).toBe(failure === "error" ? 503 : 201);
      stamp?.mockRestore();
      clock.mockReturnValue(start + 24 * 60 * 60 * 1000);
      state.sendResult = "sent";
      const response = await POST(post(payload));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ retryable: true });
      expect(state.sent).toHaveLength(1);
      expect((await memoryTableRequestsStore.listForRequester(ALICE)).requests).toHaveLength(1);
    } finally {
      stamp?.mockRestore();
      clock.mockRestore();
    }
  });

  it("keeps a failed replay read retryable instead of offering manual contact", async () => {
    await verifyOperator(OPERATOR, "venue-crown");
    const payload = request({ requestKey: "unreadable-key-0123456789" });
    expect((await POST(post(payload))).status).toBe(201);
    const attempt = vi.spyOn(memoryTableRequestsStore, "findForRequester")
      .mockRejectedValue(new Error("store unavailable"));
    try {
      const response = await POST(post(payload));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ retryable: true });
      expect(state.sent).toHaveLength(1);
    } finally {
      attempt.mockRestore();
    }
  });

  it.each(["operators", "address"])("keeps an uncertain attempt retryable when its %s disappears", async (lookup) => {
    await verifyOperator(OPERATOR, "venue-crown");
    const payload = request({ requestKey: "pending-key-0123456789" });
    state.sendResult = "error";
    expect((await POST(post(payload))).status).toBe(503);
    if (lookup === "operators") __resetVenueOperators();
    else state.addresses.clear();
    const response = await POST(post(payload));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ retryable: true });
    expect((await memoryTableRequestsStore.listForRequester(ALICE)).requests).toHaveLength(1);
  });

  it("does not replay another account's success for the same key", async () => {
    await verifyOperator(OPERATOR, "venue-crown");
    const payload = request({ requestKey: "account-key-0123456789" });
    expect((await POST(post(payload))).status).toBe(201);
    state.caller = STRANGER;
    expect((await POST(post(payload))).status).toBe(201);
    expect(state.sent).toHaveLength(2);
    expect(state.sent[1]!.idempotencyKey).not.toBe(state.sent[0]!.idempotencyKey);
    expect((await memoryTableRequestsStore.listForRequester(ALICE)).requests).toHaveLength(1);
    expect((await memoryTableRequestsStore.listForRequester(STRANGER)).requests).toHaveLength(1);
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
