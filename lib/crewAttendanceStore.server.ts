import "server-only";

import { createHash } from "node:crypto";
import {
  isCrewAttendanceRefusal,
  isCrewAttendanceState,
  parseCrewAttendance,
  type CrewAttendanceDTO,
  type CrewAttendanceState,
} from "@/lib/crewAttendance";
import { SocialCrewStoreError } from "@/lib/socialCrewStoreError";
import type { SocialPostActor } from "@/lib/socialPostStore";
import { createDualBackendStore } from "@/lib/storeBackend";
import { requireDynamicSupabaseAdmin, requireSupabaseAdmin } from "@/lib/supabase";

type CrewAttendanceRpc = "read_social_crew_attendance" | "attest_social_crew_attendance_atomic";
export type CrewAttendanceDependencies = { rpc(name: CrewAttendanceRpc, input: Record<string, unknown>): Promise<unknown> };

export type CrewAttendanceAttestInput = {
  crewId: string;
  memberId: string;
  state: CrewAttendanceState;
  expectedRevision: number;
  idempotencyKey: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFUSALS: Record<string, [SocialCrewStoreError["code"], SocialCrewStoreError["status"], string]> = {
  stale: ["CONFLICT", 409, "Attendance changed before this request."],
  closed: ["CONFLICT", 409, "Attendance is closed."],
  not_open: ["CONFLICT", 409, "Attendance is not open yet."],
  not_found: ["NOT_FOUND", 404, "Social Crew not found."],
  invalid: ["INVALID", 400, "Attendance is not valid."],
  idempotency_conflict: ["INVALID", 400, "Attendance is not valid."],
};

const unavailable = (): never => {
  throw new SocialCrewStoreError("UNAVAILABLE", 503, "Attendance is unavailable right now.");
};
const invalid = (): never => {
  throw new SocialCrewStoreError("INVALID", 400, "Attendance is not valid.");
};

const supabaseDependencies: CrewAttendanceDependencies = {
  async rpc(name, input) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc(name, input as never);
    if (error) throw new Error(error.message);
    return data;
  },
};

async function call(dependencies: CrewAttendanceDependencies, name: CrewAttendanceRpc, input: Record<string, unknown>) {
  try {
    return await dependencies.rpc(name, input);
  } catch {
    return unavailable();
  }
}

export function createCrewAttendanceStore(dependencies: CrewAttendanceDependencies = supabaseDependencies) {
  return {
    async read(crewId: string, actor: SocialPostActor): Promise<CrewAttendanceDTO> {
      const data = await call(dependencies, "read_social_crew_attendance", {
        p_viewer_account_id: actor.accountId, p_viewer_profile_id: actor.profileId, p_crew_id: crewId,
      });
      if (data === null) throw new SocialCrewStoreError("NOT_FOUND", 404, "Social Crew not found.");
      return parseCrewAttendance(data) ?? unavailable();
    },

    async attest(actor: SocialPostActor, input: CrewAttendanceAttestInput) {
      if (!UUID_RE.test(input.crewId) || !UUID_RE.test(input.memberId) || !isCrewAttendanceState(input.state)
        || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0
        || input.idempotencyKey.length < 16 || input.idempotencyKey.length > 128) return invalid();
      const payload = { crewId: input.crewId, memberId: input.memberId, state: input.state, expectedRevision: input.expectedRevision };
      const data = await call(dependencies, "attest_social_crew_attendance_atomic", {
        p_actor_account_id: actor.accountId,
        p_crew_id: input.crewId,
        p_member_id: input.memberId,
        p_state: input.state,
        p_expected_revision: input.expectedRevision,
        p_idempotency_key: input.idempotencyKey,
        p_payload_digest: createHash("sha256").update(JSON.stringify({ operation: "attendance", ...payload })).digest("hex"),
      });
      const answer = data && typeof data === "object" ? data as Record<string, unknown> : unavailable();
      const refusal = answer.ok === false && typeof answer.code === "string" ? REFUSALS[answer.code] : undefined;
      if (refusal) {
        throw new SocialCrewStoreError(...refusal, isCrewAttendanceRefusal(answer.code) ? answer.code : undefined);
      }
      if (answer.ok !== true || !["attested", "unchanged", "replayed"].includes(String(answer.code))
        || !isCrewAttendanceState(answer.state) || !Number.isInteger(answer.revision) || (answer.revision as number) < 1) {
        return unavailable();
      }
      return { memberId: input.memberId, state: answer.state, revision: answer.revision as number };
    },
  };
}

type CrewAttendanceExportRecord = {
  id: string;
  crewId: string;
  subjectUserId: string;
  revision: number;
  state: CrewAttendanceState;
  recordedAt: string;
  recordedBy: "host" | "moderator";
  expiresAt: string;
};
export type CrewAttendanceExportRead = { status: "ready" | "degraded"; records: CrewAttendanceExportRecord[] };

const exportMemory = { async listForUser(): Promise<CrewAttendanceExportRead> { return { status: "ready", records: [] }; } };
const exportDurable = {
  async listForUser(userId: string, limit: number): Promise<CrewAttendanceExportRead> {
    const { data, error } = await requireSupabaseAdmin().rpc("export_social_crew_attendance", { p_user_id: userId, p_limit: limit });
    if (error || !Array.isArray(data)) return { status: "degraded", records: [] };
    const records: CrewAttendanceExportRecord[] = [];
    for (const row of data) {
      const record = row as Record<string, unknown>;
      if (typeof record.id !== "string" || typeof record.crewId !== "string" || typeof record.subjectUserId !== "string"
        || !Number.isInteger(record.revision) || !isCrewAttendanceState(record.state) || typeof record.recordedAt !== "string"
        || (record.recordedBy !== "host" && record.recordedBy !== "moderator") || typeof record.expiresAt !== "string") {
        return { status: "degraded", records: [] };
      }
      records.push(record as CrewAttendanceExportRecord);
    }
    return { status: "ready", records };
  },
};

/** The account's own unexpired attendance records for its data export. */
export const crewAttendanceExportStore = createDualBackendStore(exportMemory, exportDurable);
