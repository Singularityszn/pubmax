import { describe, expect, it } from "vitest";
import { quoteOuting } from "@/lib/outingQuote";

const now = "2026-10-29T12:00:00Z";
const evidence = { source: "Synthetic menu", url: "https://example.com/menu", observedAt: now, retrievedAt: now, state: "available" };
const item = (id: string, kind: string, pence: number) => ({ currency: "GBP", id, venueId: "test-venue", name: id, kind, serving: "one portion", unitPence: pence, taxIncluded: true, evidence });
const basket = () => ({ venueId: "test-venue", arrival: "2026-10-29T18:30:00Z", partySize: 1, membership: "existing", bookingConfirmed: true, availabilityConfirmed: true, items: [{ item: item("meal", "food", 1200), quantity: 1 }, { item: item("drink", "drink", 500), quantity: 1 }], charges: [], deposits: [], optionalTipPence: 0 });

describe("outing quote, synthetic examples from execution pack section 6.4", () => {
  it("quotes a selected meal and drink without inventing a saving", () => {
    expect(quoteOuting(basket(), [], now)).toMatchObject({ status: "complete", totalPence: 1700, payNowPence: 0, payAtVenuePence: 1700 });
  });
});

const offer = () => ({ currency: "GBP", id: "synthetic-offer", kind: "offer", venueIds: ["test-venue"], excludedVenueIds: [], startsAt: "2026-10-29T16:00:00Z", endsAt: "2026-10-30T02:00:00Z", serviceWindow: { startsAt: "2026-10-29T16:00:00Z", endsAt: "2026-10-29T23:00:00Z" }, minParty: 1, maxParty: 6, itemIds: ["meal", "drink"], membership: { required: false, newCommitmentPence: null, per: "person" }, bookingRequired: false, termsComplete: true, reduction: { kind: "bundle", pence: 1500 }, charges: [], cashbackPence: null, evidence });
const codes = (quote: ReturnType<typeof quoteOuting>) => quote.reasons.map((r) => r.code);

describe("offer eligibility and full payment", () => {
  it("includes the full new membership commitment and distinguishes existing members", () => {
    const o = { ...offer(), kind: "membership", membership: { required: true, newCommitmentPence: 500, per: "person" } };
    expect(quoteOuting(basket(), [o], now).totalPence).toBe(1500);
    expect(quoteOuting({ ...basket(), membership: "new" }, [o], now)).toMatchObject({ totalPence: 2000, payNowPence: 500, payAtVenuePence: 1500 });
    expect(quoteOuting({ ...basket(), membership: "unknown" }, [o], now)).toMatchObject({ totalPence: null, eligibility: "unknown" });
    expect(codes(quoteOuting({ ...basket(), membership: "new" }, [{ ...o, membership: { ...o.membership, newCommitmentPence: null } }], now))).toContain("membership_cost");
  });
  it("discounts food only and adds a booking fee once", () => {
    const o = { ...offer(), itemIds: ["meal"], reduction: { kind: "percentage", basisPoints: 5000 }, charges: [{ kind: "fixed", label: "Booking", payable: "now", pence: 200, per: "booking" }] };
    expect(quoteOuting(basket(), [o], now)).toMatchObject({ totalPence: 1300, payNowPence: 200, payAtVenuePence: 1100 });
    expect(quoteOuting({ ...basket(), partySize: 4 }, [o], now).totalPence).toBe(1300);
    expect(quoteOuting({ ...basket(), partySize: 4 }, [{ ...o, charges: [{ ...o.charges[0], per: "person" }] }], now).totalPence).toBe(1900);
  });
  it("does not subtract uncertain cashback or optional tips", () => {
    expect(quoteOuting({ ...basket(), optionalTipPence: 300 }, [{ ...offer(), kind: "cashback", reduction: { kind: "none" }, cashbackPence: 500 }], now)).toMatchObject({ totalPence: 1700, cashbackPence: 500, optionalTipPence: 300 });
  });
  it("splits bill-credit and refundable deposits without charging the bill twice", () => {
    expect(quoteOuting({ ...basket(), deposits: [{ kind: "bill-credit", pence: 500 }, { kind: "refundable", pence: 200 }] }, [], now)).toMatchObject({ totalPence: 1700, payNowPence: 700, payAtVenuePence: 1200, refundablePence: 200 });
    expect(codes(quoteOuting({ ...basket(), deposits: [{ kind: "bill-credit", pence: 2000 }] }, [], now))).toContain("deposit_exceeds_bill");
  });
  it("includes mandatory service on the stated base and rounds half a penny up", () => {
    const o = { ...offer(), itemIds: ["meal"], reduction: { kind: "percentage", basisPoints: 5000 } };
    const b = { ...basket(), charges: [{ kind: "service", label: "Service", payable: "venue", basisPoints: 1250, basis: "menu" }] };
    expect(quoteOuting(b, [o], now).totalPence).toBe(1313);
    expect(quoteOuting({ ...b, charges: [{ ...b.charges[0], basis: "discounted" }] }, [o], now).totalPence).toBe(1238);
    expect(quoteOuting({ ...b, charges: [{ ...b.charges[0], basis: null }] }, [o], now).totalPence).toBeNull();
  });
  it.each([
    ["branch", { excludedVenueIds: ["test-venue"] }],
    ["expired", { endsAt: "2026-10-29T18:30:00Z" }],
    ["not_started", { startsAt: "2026-10-29T19:00:00Z" }],
    ["party", { minParty: 2 }],
    ["items", { itemIds: ["different-portion"] }],
    ["service_closed", { serviceWindow: { startsAt: "2026-10-29T16:00:00Z", endsAt: "2026-10-29T18:00:00Z" } }],
  ])("refuses a confirmed total for %s", (reason, change) => {
    const q = quoteOuting(basket(), [{ ...offer(), ...change }], now);
    expect(q).toMatchObject({ status: "ineligible", totalPence: null });
    expect(codes(q)).toContain(reason);
  });
  it("keeps unknown material conditions and stacking unresolved", () => {
    for (const change of [{ serviceWindow: null }, { bookingRequired: null }, { termsComplete: false }, { charges: null }]) {
      expect(quoteOuting(basket(), [{ ...offer(), ...change }], now).totalPence).toBeNull();
    }
    expect(codes(quoteOuting(basket(), [offer(), offer()], now))).toContain("stacking_unknown");
    expect(codes(quoteOuting({ ...basket(), bookingConfirmed: false }, [{ ...offer(), bookingRequired: true }], now))).toContain("booking_required");
    expect(quoteOuting({ ...basket(), availabilityConfirmed: false }, [offer()], now).status).toBe("ineligible");
  });
  it("uses explicit instants across midnight and both DST occurrences", () => {
    const o = { ...offer(), startsAt: "2026-10-24T23:00:00+01:00", endsAt: "2026-10-25T03:00:00Z", serviceWindow: { startsAt: "2026-10-24T23:00:00+01:00", endsAt: "2026-10-25T03:00:00Z" } };
    const early = "2026-10-24T12:00:00Z";
    const b = basket();
    b.items.forEach((line) => { line.item.evidence = { ...evidence, observedAt: early, retrievedAt: early }; });
    for (const arrival of ["2026-10-25T00:30:00+01:00", "2026-10-25T01:30:00+01:00", "2026-10-25T01:30:00Z"]) {
      expect(quoteOuting({ ...b, arrival }, [{ ...o, evidence: { ...evidence, observedAt: early } }], early).totalPence).toBe(1500);
    }
    expect(codes(quoteOuting({ ...b, arrival: "2026-10-25T01:30:00" }, [o], early))).toContain("invalid_input");
    expect(codes(quoteOuting({ ...b, arrival: "2026-03-29T01:30:00" }, [o], early))).toContain("invalid_input");
  });
  it("does not renew old observations after a successful fetch", () => {
    const b = basket();
    b.items[0]!.item.evidence = { ...evidence, observedAt: "2026-08-01T12:00:00Z" };
    expect(codes(quoteOuting(b, [], now))).toContain("stale");
    expect(quoteOuting(b, [], now)).toMatchObject({ menuSubtotalPence: 1700, totalPence: null });
  });
  it.each(["conflict", "provider-error", "unavailable"])("keeps %s distinct from a zero price", (state) => {
    const b = basket();
    b.items[0]!.item.evidence = { ...evidence, state };
    expect(quoteOuting(b, [], now).totalPence).toBeNull();
  });
  it.each([-1, 12.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])("rejects impossible minor-unit amount %s", (amount) => {
    const b = basket(); b.items[0]!.item.unitPence = amount;
    expect(codes(quoteOuting(b, [], now))).toContain("invalid_input");
  });
  it("preserves unknown item amounts, fees and deposits", () => {
    expect(quoteOuting({ ...basket(), charges: null }, [], now)).toMatchObject({ menuSubtotalPence: 1700, totalPence: null });
    expect(quoteOuting({ ...basket(), deposits: null }, [], now).totalPence).toBeNull();
    const b = basket();
    expect(quoteOuting({ ...b, items: [{ ...b.items[0], item: { ...b.items[0]!.item, unitPence: null } }] }, [], now).menuSubtotalPence).toBeNull();
  });
});

describe("quote boundary validation", () => {
  it("round-trips valid input and rejects a foreign currency or malformed source", () => {
    const b = JSON.parse(JSON.stringify(basket()));
    const o = JSON.parse(JSON.stringify(offer()));
    expect(quoteOuting(b, [o], now).totalPence).toBe(1500);
    b.items[0].item.currency = "EUR";
    expect(quoteOuting(b, [o], now).totalPence).toBeNull();
    expect(quoteOuting(basket(), [{ ...o, evidence: { ...evidence, url: "javascript:alert(1)" } }], now).reasons[0]?.code).toBe("invalid_input");
  });
  it("requires a resolved instance for holiday terms and does not apply voucher values as immediate reductions", () => {
    expect(codes(quoteOuting(basket(), [{ ...offer(), termsComplete: false }], now))).toContain("terms_unknown");
    expect(quoteOuting(basket(), [{ ...offer(), kind: "voucher" }], now).totalPence).toBeNull();
  });
  it("keeps payment allocation nonnegative across party sizes and deposits", () => {
    for (const partySize of [1, 2, 4, 6]) {
      for (const deposit of [0, 100, 1000, 1700]) {
        const q = quoteOuting({ ...basket(), partySize, charges: [{ kind: "fixed", label: "Cover", payable: "venue", pence: 100, per: "person" }], deposits: [{ kind: "bill-credit", pence: deposit }] }, [], now);
        expect(q.totalPence).toBe(1700 + 100 * partySize);
        expect(q.payNowPence! + q.payAtVenuePence!).toBe(q.totalPence);
        expect(q.payAtVenuePence).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

it("revalidates an expired saved offer even when its original arrival was inside the window", () => {
  expect(quoteOuting(basket(), [offer()], "2026-10-30T12:00:00Z")).toMatchObject({ totalPence: null, eligibility: "ineligible" });
});
