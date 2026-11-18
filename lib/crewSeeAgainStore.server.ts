import "server-only";
import { parseSeeAgain, parseSeeAgainOwnRecords, parseSeeAgainVisibleConnections, type SeeAgainVisibleConnection, type SeeAgainDTO, type SeeAgainOwnRecord } from "@/lib/crewSeeAgain";
import { SocialCrewStoreError } from "@/lib/socialCrewStoreError";
import type { SocialPostActor } from "@/lib/socialPostStore";
import { createDualBackendStore } from "@/lib/storeBackend";
import { requireDynamicSupabaseAdmin } from "@/lib/supabase";

type Rpc = "read_social_crew_see_again" | "write_social_crew_see_again" | "export_social_crew_see_again" | "export_visible_crew_see_again" | "purge_expired_social_crew_see_again";
type Dependencies = { rpc(name: Rpc, input: Record<string, unknown>): Promise<unknown> };
export type SeeAgainConnectionExportRead = { status: "ready" | "degraded"; records: SeeAgainVisibleConnection[] };
export type SeeAgainExportRead = { status: "ready" | "degraded"; records: SeeAgainOwnRecord[] };
const unavailable = (): never => { throw new SocialCrewStoreError("UNAVAILABLE", 503, "Reconnection is unavailable right now."); };
const durable: Dependencies = {
  async rpc(name, input) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc(name, input as never);
    if (error) throw new Error("Private reconnection storage failed.");
    return data;
  },
};
// Keyless mode has no trusted attendance source. It cannot invent eligible people.
const memory: Dependencies = { async rpc(name) {
  if (name === "read_social_crew_see_again") return null;
  if (name === "export_social_crew_see_again" || name === "export_visible_crew_see_again") return [];
  if (name === "purge_expired_social_crew_see_again") return { ok: true, deleted: 0 };
  return { ok: true };
} };
const dependencies = createDualBackendStore(memory, durable);
export function createCrewSeeAgainStore(deps?: Dependencies) {
  async function call(name: Rpc, input: Record<string, unknown>): Promise<unknown> {
    try { return await (deps ?? dependencies()).rpc(name, input); } catch { return unavailable(); }
  }
  return {
    async read(crewId: string, actor: SocialPostActor): Promise<SeeAgainDTO> {
      const result = await call("read_social_crew_see_again", { p_actor: actor.accountId, p_profile: actor.profileId, p_crew: crewId });
      if (result === null) throw new SocialCrewStoreError("NOT_FOUND", 404, "Social Crew not found.");
      return parseSeeAgain(result) ?? unavailable();
    },
    async write(crewId: string, actor: SocialPostActor, input: { memberId: string; context: "friendship" | "dating"; action: "choose" | "withdraw"; consent: boolean }) {
      const result = await call("write_social_crew_see_again", { p_actor: actor.accountId, p_profile: actor.profileId, p_crew: crewId,
        p_member: input.memberId, p_context: input.context, p_action: input.action, p_consent: input.consent });
      if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) return unavailable();
      return { ok: true };
    },
    async listForUser(userId: string, limit: number): Promise<SeeAgainExportRead> {
      try {
        const records = parseSeeAgainOwnRecords(await call("export_social_crew_see_again", { p_user: userId, p_limit: limit }));
        return records ? { status: "ready", records } : { status: "degraded", records: [] };
      } catch { return { status: "degraded", records: [] }; }
    },
    async visibleForUser(userId: string, limit: number): Promise<SeeAgainConnectionExportRead> {
      try {
        const records = parseSeeAgainVisibleConnections(await call("export_visible_crew_see_again", { p_user: userId, p_limit: limit }));
        return records ? { status: "ready", records } : { status: "degraded", records: [] };
      } catch { return { status: "degraded", records: [] }; }
    },
    async expire() {
      const result = await call("purge_expired_social_crew_see_again", { p_limit: 1000 });
      if (!result || typeof result !== "object") return unavailable();
      const value = result as Record<string, unknown>;
      if (value.ok !== true || !Number.isInteger(value.deleted) || (value.deleted as number) < 0 || (value.deleted as number) > 1000) return unavailable();
      return { ok: true, deleted: value.deleted as number };
    },
  };
}
