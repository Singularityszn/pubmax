import "server-only";

import type { Json } from "@/types/database";

import { hostedOutingEnrollment, proposeHostedOutingGroup, type HostedOuting, type HostedOutingChoice, type HostedOutingEnrollmentState } from "@/lib/hostedOutings";
import type { SocialPostActor } from "@/lib/socialPostStore";
import { requireSupabaseAdmin } from "@/lib/supabase";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { cityIdFromVenueId, isNationalBaseVenueId } from "@/lib/cityVenueIds";

export type HostedOutingDetail = HostedOuting & {
  announcement: string;
  groupExplanation: string | null;
  groupBudgetPence: number | null;
  operator: boolean;
  moderator: boolean;
  attendance: { state: HostedOutingEnrollmentState; pace: "easy" | "steady"; budgetPence: number } | null;
  candidates: Array<HostedOutingChoice & { handle: string; state: HostedOutingEnrollmentState }>;
  blockedPairs: Array<[string, string]>;
  reports: Array<{ profileId: string; body: string; status: "open" | "reviewed"; createdAt: string }>;
  ownReport: { body: string; status: "open" | "reviewed" } | null;
  feedback: number | null;
  feedbackSummary: { count: number; average: number | null } | null;
  group: Array<{ handle: string }>;
};
export type HostedOutingRead = { outings: HostedOutingDetail[]; staff: boolean; moderationOwners: Array<{ id: string; name: string }> };
export class HostedOutingError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const enrollmentEnabled = () => process.env.PUBMAX_HOSTED_OUTINGS_ENROLLMENT_ENABLED === "true";

function fail(error: { message: string }): never {
  const code = error.message.match(/HOSTED_[A-Z_]+/)?.[0];
  if (code === "HOSTED_NOT_FOUND") throw new HostedOutingError(code, 404, "Outing not found.");
  if (code === "HOSTED_FORBIDDEN") throw new HostedOutingError(code, 403, "You cannot make this outing change.");
  if (code) throw new HostedOutingError(code, 409, "The outing changed or cannot accept this change. Refresh its details.");
  throw new HostedOutingError("HOSTED_UNAVAILABLE", 503, "Hosted outings are unavailable. Try again.");
}

export async function readHostedOutings(actor: SocialPostActor, id?: string): Promise<HostedOutingRead> {
  if (id && !uuid.test(id)) throw new HostedOutingError("HOSTED_NOT_FOUND", 404, "Outing not found.");
  const { data, error } = await requireSupabaseAdmin().rpc("read_hosted_outings", { p_actor: actor.accountId, p_outing: id ?? null });
  if (error) fail(error);
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.outings)) throw new HostedOutingError("HOSTED_UNAVAILABLE", 503, "Hosted outings are unavailable. Try again.");
  const read = data as unknown as HostedOutingRead;
  return { ...read, outings: read.outings.map((outing) => ({ ...outing, signupAllowed: outing.signupAllowed === true && enrollmentEnabled(), confirmationAllowed: outing.confirmationAllowed === true && enrollmentEnabled() })) };
}

export async function createHostedOuting(actor: SocialPostActor, input: Record<string, unknown>): Promise<{ id: string }> {
  const allowed = ["title", "venueId", "startsAt", "capacity", "moderatorStaffId"];
  if (Object.keys(input).some((key) => !allowed.includes(key)) || typeof input.title !== "string" || !input.title.trim()
    || input.title.length > 80 || typeof input.venueId !== "string" || typeof input.startsAt !== "string"
    || !Number.isFinite(Date.parse(input.startsAt)) || Date.parse(input.startsAt) <= Date.now()
    || !Number.isInteger(input.capacity) || Number(input.capacity) < 2 || Number(input.capacity) > 12
    || typeof input.moderatorStaffId !== "string" || !uuid.test(input.moderatorStaffId)) {
    throw new HostedOutingError("HOSTED_INVALID", 422, "Check the outing details.");
  }
  const venue = await lookupCanonicalVenue(input.venueId);
  if (venue.status === "unavailable") throw new HostedOutingError("HOSTED_UNAVAILABLE", 503, "We could not check the venue. Try again.");
  if (venue.status !== "found" || isNationalBaseVenueId(venue.canonicalId) || (cityIdFromVenueId(venue.canonicalId) ?? "london") !== "london") {
    throw new HostedOutingError("HOSTED_INVALID", 422, "Choose a listed London venue.");
  }
  const { data, error } = await requireSupabaseAdmin().rpc("create_hosted_outing", {
    p_actor: actor.accountId, p_title: input.title.trim(), p_venue_id: venue.canonicalId,
    p_venue_name: venue.venue.name, p_starts_at: input.startsAt, p_capacity: Number(input.capacity), p_moderator: input.moderatorStaffId,
  });
  if (error) fail(error);
  if (typeof data !== "string" || !uuid.test(data)) throw new HostedOutingError("HOSTED_UNAVAILABLE", 503, "We could not save the outing. Try again.");
  return { id: data };
}

export async function changeHostedOuting(actor: SocialPostActor, id: string, body: Record<string, unknown>): Promise<HostedOutingRead> {
  const { action, revision, ...input } = body;
  const keys: Record<string, string[]> = {
    join: ["pace", "budgetPence"], cancel: [], confirm: [], approve: ["profileIds"],
    publish: ["confirmation"], cancel_outing: [], complete: [], announce: ["body"],
    remove: ["profileId"], report: ["body"], review_report: ["profileId"], feedback: ["rating"],
  };
  if (typeof action !== "string" || !Object.hasOwn(keys, action) || !uuid.test(id)
    || Object.keys(input).some((key) => !keys[action]?.includes(key))
    || (revision !== undefined && (!Number.isSafeInteger(revision) || Number(revision) < 0))) {
    throw new HostedOutingError("HOSTED_INVALID", 422, "Check the outing change.");
  }
  if (action === "join" && (!['easy', 'steady'].includes(String(input.pace)) || !Number.isInteger(input.budgetPence) || Number(input.budgetPence) < 0 || Number(input.budgetPence) > 100_000)) {
    throw new HostedOutingError("HOSTED_INVALID", 422, "Choose a pace and a budget.");
  }
  if (["publish", "announce", "report"].includes(action)) {
    const key = action === "publish" ? "confirmation" : "body";
    const text = input[key];
    if (typeof text !== "string" || !text.trim() || text.length > (action === "publish" ? 500 : 2000)) throw new HostedOutingError("HOSTED_INVALID", 422, "Add a short message.");
    input[key] = text.trim();
  }
  if (["remove", "review_report"].includes(action) && (typeof input.profileId !== "string" || !uuid.test(input.profileId))) throw new HostedOutingError("HOSTED_INVALID", 422, "Choose an attendee.");
  if (action === "feedback" && (!Number.isInteger(input.rating) || Number(input.rating) < 1 || Number(input.rating) > 5)) throw new HostedOutingError("HOSTED_INVALID", 422, "Choose a rating from 1 to 5.");
  let expectedRevision = typeof revision === "number" ? revision : null;
  if (action === "join" || action === "approve") {
    const read = await readHostedOutings(actor, id);
    const outing = read.outings[0];
    if (!outing) throw new HostedOutingError("HOSTED_NOT_FOUND", 404, "Outing not found.");
    if (action === "join") {
      const gate = hostedOutingEnrollment({ ...outing, enrollmentEnabled: outing.enrollmentEnabled && enrollmentEnabled() });
      if (!gate.allowed) throw new HostedOutingError(gate.reason, 409, "Signups are not open for this outing.");
      if (outing.attendance && outing.attendance.state !== "cancelled") return read;
      if (!outing.signupAllowed) throw new HostedOutingError("HOSTED_SIGNUP_CLOSED", 409, "Signups are not open for this outing.");
    } else {
      if (!outing.operator) throw new HostedOutingError("HOSTED_FORBIDDEN", 403, "Only the outing operator can approve a group.");
      if (revision !== outing.revision) throw new HostedOutingError("HOSTED_STALE", 409, "The signups changed. Refresh the proposal.");
      const proposal = proposeHostedOutingGroup({ candidates: outing.candidates, reservedProfileIds: outing.candidates.filter((choice) => choice.state === "approved" || choice.state === "confirmed").map((choice) => choice.profileId), blockedPairs: outing.blockedPairs, capacity: outing.capacity });
      if (!proposal.profileIds.length) throw new HostedOutingError("HOSTED_NO_GROUP", 409, proposal.explanation);
      if (!Array.isArray(input.profileIds) || input.profileIds.length !== proposal.profileIds.length
        || input.profileIds.some((profileId, index) => profileId !== proposal.profileIds[index])) {
        throw new HostedOutingError("HOSTED_STALE", 409, "The proposed group changed. Refresh the proposal before approval.");
      }
      input.profileIds = proposal.profileIds;
      input.explanation = proposal.explanation;
      expectedRevision = outing.revision;
    }
  }
  const { data, error } = await requireSupabaseAdmin().rpc("change_hosted_outing", {
    p_actor: actor.accountId, p_outing: id, p_action: action, p_input: input as Json,
    p_revision: expectedRevision, p_enrollment_allowed: enrollmentEnabled(),
  });
  if (error) fail(error);
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.outings)) throw new HostedOutingError("HOSTED_UNAVAILABLE", 503, "We could not save the change. Try again.");
  const read = data as unknown as HostedOutingRead;
  return { ...read, outings: read.outings.map((outing) => ({ ...outing, signupAllowed: outing.signupAllowed === true && enrollmentEnabled(), confirmationAllowed: outing.confirmationAllowed === true && enrollmentEnabled() })) };
}

/** Only the caller's records enter their export. Other attendees never enter it. */
export async function exportHostedOutingRecords(userId: string, limit: number): Promise<HostedOutingExportRecord[]> {
  const result: HostedOutingExportRecord[] = [];
  const tables = [
    ["hosted_outing_attendees", "attendance", "outing_id,state,pace,budget_pence,joined_at,updated_at"],
    ["hosted_outing_reports", "report", "outing_id,body,status,created_at"],
    ["hosted_outing_feedback", "feedback", "outing_id,rating,created_at"],
  ] as const;
  for (const [table, kind, columns] of tables) {
    const { data, error } = await requireSupabaseAdmin().from(table).select(columns).eq("user_id", userId).order("outing_id").limit(limit);
    if (error) {
      if (["42P01", "PGRST205"].includes(error.code) && error.message.includes(table)) continue;
      throw new HostedOutingError("HOSTED_UNAVAILABLE", 503, "Your outing records are unavailable.");
    }
    for (const row of data ?? []) result.push({ kind, record: row as unknown as Record<string, unknown> });
  }
  return result;
}
export type HostedOutingExportRecord = { kind: "attendance" | "report" | "feedback"; record: Record<string, unknown> };
