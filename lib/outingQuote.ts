import { z } from "zod";
import { PRICE_AUTHORITY_MAX_AGE_MS } from "@/lib/priceAuthorityWindow";

const pence = z.number().int().nonnegative().max(100_000_000);
const instant = z.iso.datetime({ offset: true });
const evidenceSchema = z.object({
  source: z.string().trim().min(1), licence: z.string().trim().min(1),
  url: z.url().refine((url) => /^https?:\/\//.test(url)).nullable(),
  observedAt: instant.nullable(),
  retrievedAt: instant.nullable(),
  state: z.enum(["available", "stale", "conflict", "unavailable", "provider-error"]),
}).strict();

/** A projection of an admitted menu row. This schema grants no source or publication permission. */
export const outingItemSchema = z.object({
  id: z.string().trim().min(1), venueId: z.string().trim().min(1),
  currency: z.literal("GBP"), name: z.string().trim().min(1), kind: z.enum(["food", "drink"]),
  serving: z.string().trim().min(1).nullable(), unitPence: pence.nullable(),
  taxIncluded: z.boolean().nullable(), evidence: evidenceSchema,
}).strict();

const chargeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed"), label: z.string().trim().min(1), pence, payable: z.enum(["now", "venue"]).nullable(), per: z.enum(["booking", "person"]) }).strict(),
  z.object({ kind: z.literal("service"), label: z.string().trim().min(1), basisPoints: z.number().int().min(0).max(10000), basis: z.enum(["menu", "discounted"]).nullable(), payable: z.enum(["now", "venue"]).nullable() }).strict(),
]);

/** Exact dated instances only. Recurring, holiday and ambiguous local terms require an upstream reviewed instance. */
const outingOfferSchema = z.object({
  currency: z.literal("GBP"), id: z.string().trim().min(1), kind: z.enum(["offer", "voucher", "membership", "cashback"]),
  venueIds: z.array(z.string().trim().min(1)).min(1), excludedVenueIds: z.array(z.string()),
  startsAt: instant, endsAt: instant,
  serviceWindow: z.object({ startsAt: instant, endsAt: instant }).strict().nullable(),
  minParty: z.number().int().positive(), maxParty: z.union([z.number().int().positive(), z.literal("unlimited")]).nullable(),
  itemIds: z.array(z.string().trim().min(1)).min(1),
  membership: z.object({ required: z.boolean(), newUpfrontCommitmentPence: pence.nullable(), per: z.enum(["booking", "person"]) }).strict(),
  bookingRequired: z.boolean().nullable(),
  termsComplete: z.boolean(),
  reduction: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("bundle"), pence }).strict(),
    z.object({ kind: z.literal("percentage"), basisPoints: z.number().int().min(0).max(10000) }).strict(),
    z.object({ kind: z.literal("none") }).strict(),
  ]),
  charges: z.array(chargeSchema).nullable(),
  cashbackPence: pence.nullable(), evidence: evidenceSchema,
}).strict().refine((o) => Date.parse(o.endsAt) > Date.parse(o.startsAt) && (typeof o.maxParty !== "number" || o.maxParty >= o.minParty) &&
  (!o.serviceWindow || Date.parse(o.serviceWindow.endsAt) > Date.parse(o.serviceWindow.startsAt)), "Invalid offer window or party range");

const basketSchema = z.object({
  venueId: z.string().trim().min(1), arrival: instant,
  partySize: z.number().int().positive().max(100), membership: z.enum(["existing", "new", "unknown"]),
  bookingConfirmed: z.boolean().nullable(), availabilityConfirmed: z.boolean().nullable(),
  items: z.array(z.object({ item: outingItemSchema, quantity: z.number().int().positive().max(100) }).strict()).min(1).max(100),
  charges: z.array(chargeSchema).nullable(),
  deposits: z.array(z.object({ kind: z.enum(["bill-credit", "refundable"]), pence }).strict()).nullable(),
  optionalTipPence: pence,
}).strict();

type OutingItem = z.infer<typeof outingItemSchema>;
type OutingOffer = z.infer<typeof outingOfferSchema>;
type Basket = z.infer<typeof basketSchema>;
type Eligibility = "eligible" | "ineligible" | "unknown";
const REASONS = {
  invalid_input: "Some price or offer details are invalid.", branch: "This offer does not apply at this venue.",
  expired: "This offer ends before your arrival.", not_started: "This offer starts after your arrival.",
  service_closed: "The selected food or drink service is closed at your arrival.", service_unknown: "The service times need checking.",
  party: "This offer does not cover your group size.", party_unknown: "The maximum group size needs checking.", items: "This offer does not cover the selected items and quantities.",
  membership_unknown: "Your membership status needs checking.", membership_cost: "The full new membership commitment needs checking.",
  booking_unknown: "The booking conditions need checking.", booking_required: "This offer needs a confirmed booking.",
  availability_unknown: "Availability needs checking.", unavailable: "The selected items or slot are unavailable.",
  terms_unknown: "Some offer conditions need checking.", stacking_unknown: "These offers cannot be combined without confirmed terms.",
  evidence_unknown: "The price date or publisher needs checking.", stale: "The listed price or offer needs a new check.",
  conflict: "The recorded prices or conditions disagree.", provider_error: "The provider could not confirm the details.",
  price_unknown: "Some item prices need checking.", serving_unknown: "Some serving sizes need checking.",
  tax_unknown: "Tax needs checking.", charges_unknown: "Required fees need checking.",
  service_basis_unknown: "The service charge calculation needs checking.", deposit_unknown: "The deposit terms need checking.",
  payment_timing_unknown: "The payment times need checking.",
  deposit_exceeds_bill: "The bill-credit deposit exceeds the calculated bill.",
} as const;
type Reason = keyof typeof REASONS;
type OutingQuote = {
  status: "complete" | "incomplete" | "ineligible";
  eligibility: Eligibility;
  reasons: { code: Reason; message: string }[];
  menuSubtotalPence: number | null;
  totalPence: number | null;
  payNowPence: number | null;
  payAtVenuePence: number | null;
  refundablePence: number | null;
  optionalTipPence: number;
  cashbackPence: number | null;
};

function evidenceReasons(e: OutingItem["evidence"], now: number, arrival: number): Reason[] {
  if (e.state === "conflict") return ["conflict"];
  if (e.state === "provider-error") return ["provider_error"];
  if (e.state === "unavailable") return ["unavailable"];
  if (e.state === "stale") return ["stale"];
  if (!e.observedAt || !e.url || Date.parse(e.observedAt) > now) return ["evidence_unknown"];
  // Retrieval never renews an observation. The quote must still be current at arrival.
  if (Math.max(now, arrival) - Date.parse(e.observedAt) > PRICE_AUTHORITY_MAX_AGE_MS) return ["stale"];
  return [];
}

function eligibilityReasons(b: Basket, o: OutingOffer, now: number): { denied: Reason[]; unknown: Reason[] } {
  const denied: Reason[] = [];
  const unknown: Reason[] = evidenceReasons(o.evidence, now, Date.parse(b.arrival));
  const arrival = Date.parse(b.arrival);
  if (!o.venueIds.includes(b.venueId) || o.excludedVenueIds.includes(b.venueId)) denied.push("branch");
  if (now >= Date.parse(o.endsAt) || arrival >= Date.parse(o.endsAt)) denied.push("expired");
  if (arrival < Date.parse(o.startsAt)) denied.push("not_started");
  if (!o.serviceWindow) unknown.push("service_unknown");
  else if (arrival < Date.parse(o.serviceWindow.startsAt) || arrival >= Date.parse(o.serviceWindow.endsAt)) denied.push("service_closed");
  if (b.partySize < o.minParty || (typeof o.maxParty === "number" && b.partySize > o.maxParty)) denied.push("party");
  if (o.maxParty === null) unknown.push("party_unknown");
  // A bundle is one exact selection, not a per-item or per-person assumption.
  if (!o.itemIds.every((id) => b.items.some((line) => line.item.id === id)) ||
      (o.reduction.kind === "bundle" && (b.items.some((line) => !o.itemIds.includes(line.item.id) || line.quantity !== 1)))) denied.push("items");
  if (o.membership.required && b.membership === "unknown") unknown.push("membership_unknown");
  if (o.membership.required && b.membership === "new" && o.membership.newUpfrontCommitmentPence === null) unknown.push("membership_cost");
  if (o.bookingRequired === null || (o.bookingRequired && b.bookingConfirmed === null)) unknown.push("booking_unknown");
  else if (o.bookingRequired && !b.bookingConfirmed) denied.push("booking_required");
  if (!o.termsComplete) unknown.push("terms_unknown");
  return { denied, unknown };
}

/** Integer pennies, round half up once per percentage line or service charge. */
function percentage(amount: number, basisPoints: number): number {
  return Number((BigInt(amount) * BigInt(basisPoints) + BigInt(5000)) / BigInt(10000));
}

function basketReasons(b: Basket, clock: number): { denied: Reason[]; unknown: Reason[] } {
  const denied: Reason[] = [];
  const unknown: Reason[] = [];
  if (b.availabilityConfirmed === null) unknown.push("availability_unknown");
  else if (!b.availabilityConfirmed) denied.push("unavailable");
  if (b.items.some(({ item }) => item.venueId !== b.venueId)) denied.push("branch");
  if (new Set(b.items.map(({ item }) => item.id)).size !== b.items.length) unknown.push("invalid_input");
  for (const { item } of b.items) {
    unknown.push(...evidenceReasons(item.evidence, clock, Date.parse(b.arrival)));
    if (item.unitPence === null) unknown.push("price_unknown");
    if (!item.serving) unknown.push("serving_unknown");
    if (item.taxIncluded !== true) unknown.push("tax_unknown");
  }
  return { denied, unknown };
}

function priceBasket(b: Basket, offers: OutingOffer[], menu: number | null, clock: number) {
  const denied: Reason[] = [];
  const unknown: Reason[] = [];
  let discounted = menu;
  let membership = 0;
  const o = offers.length === 1 ? offers[0] : undefined;
  if (o) {
    const result = eligibilityReasons(b, o, clock);
    denied.push(...result.denied);
    unknown.push(...result.unknown);
    if (o.kind === "cashback" && o.reduction.kind !== "none") unknown.push("terms_unknown");
    if (o.kind === "voucher") unknown.push("terms_unknown"); // Voucher purchase/redemption allocation is not supported in this slice.
    if (result.denied.length === 0 && result.unknown.length === 0 && menu !== null) {
      if (o.reduction.kind === "bundle") discounted = o.reduction.pence;
      if (o.reduction.kind === "percentage") discounted = b.items.reduce((sum, { item, quantity }) => {
        const amount = item.unitPence! * quantity;
        return sum + (o.itemIds.includes(item.id) ? amount - percentage(amount, o.reduction.kind === "percentage" ? o.reduction.basisPoints : 0) : amount);
      }, 0);
      if (o.membership.required && b.membership === "new") membership = (o.membership.newUpfrontCommitmentPence ?? 0) * (o.membership.per === "person" ? b.partySize : 1);
    }
  }
  if (b.charges === null || (o && o.charges === null)) unknown.push("charges_unknown");
  let fees = 0;
  let feesDueNow = 0;
  for (const fee of [...(b.charges ?? []), ...(o?.charges ?? [])]) {
    let amount = 0;
    if (fee.kind === "fixed") amount = fee.pence * (fee.per === "person" ? b.partySize : 1);
    else if (fee.basis === null) unknown.push("service_basis_unknown");
    else if (menu !== null && discounted !== null) amount = percentage(fee.basis === "menu" ? menu : discounted, fee.basisPoints);
    fees += amount;
    if (fee.payable === null) unknown.push("payment_timing_unknown");
    if (fee.payable === "now") feesDueNow += amount;
  }
  return { denied, unknown, discounted, membership, fees, feesDueNow, o };
}

/** Pure and side-effect free. Invalid or unresolved input cannot produce a rankable total. */
export function quoteOuting(input: unknown, offers: readonly unknown[], observedNow: string): OutingQuote {
  const parsed = basketSchema.safeParse(input);
  const parsedOffers = z.array(outingOfferSchema).safeParse(offers);
  const now = instant.safeParse(observedNow);
  const empty: OutingQuote = { status: "incomplete", eligibility: "unknown", reasons: [], menuSubtotalPence: null, totalPence: null, payNowPence: null, payAtVenuePence: null, refundablePence: null, optionalTipPence: 0, cashbackPence: null };
  if (!parsed.success || !parsedOffers.success || !now.success) return { ...empty, reasons: [{ code: "invalid_input", message: REASONS.invalid_input }] };
  const b = parsed.data;
  const denied: Reason[] = [];
  const unknown: Reason[] = [];
  const clock = Date.parse(now.data);
  if (parsedOffers.data.length > 1) unknown.push("stacking_unknown");
  const basketCheck = basketReasons(b, clock);
  denied.push(...basketCheck.denied);
  unknown.push(...basketCheck.unknown);
  const menu = b.items.some(({ item }) => item.unitPence === null) ? null : b.items.reduce((sum, { item, quantity }) => sum + item.unitPence! * quantity, 0);
  const priced = priceBasket(b, parsedOffers.data, menu, clock);
  denied.push(...priced.denied);
  unknown.push(...priced.unknown);
  const { discounted, membership, fees, feesDueNow, o } = priced;
  if (b.deposits === null) unknown.push("deposit_unknown");
  const credit = (b.deposits ?? []).filter((d) => d.kind === "bill-credit").reduce((sum, d) => sum + d.pence, 0);
  const refundable = (b.deposits ?? []).filter((d) => d.kind === "refundable").reduce((sum, d) => sum + d.pence, 0);
  const bill = discounted === null ? null : discounted + fees;
  if (bill !== null && credit > bill - feesDueNow) unknown.push("deposit_exceeds_bill");
  const total = bill === null ? null : bill + membership;
  if ([menu, bill, total, credit + refundable + membership].some((n) => n !== null && !Number.isSafeInteger(n))) unknown.push("invalid_input");
  const codes = [...new Set([...denied, ...unknown])];
  const complete = codes.length === 0 && total !== null && bill !== null;
  return {
    status: denied.length ? "ineligible" : complete ? "complete" : "incomplete",
    eligibility: denied.length ? "ineligible" : unknown.length ? "unknown" : "eligible",
    reasons: codes.map((code) => ({ code, message: REASONS[code] })), menuSubtotalPence: menu,
    totalPence: complete ? total : null,
    payNowPence: complete ? credit + refundable + membership + feesDueNow : null,
    payAtVenuePence: complete ? bill - credit - feesDueNow : null,
    refundablePence: complete ? refundable : null,
    optionalTipPence: b.optionalTipPence, cashbackPence: o?.cashbackPence ?? null,
  };
}
