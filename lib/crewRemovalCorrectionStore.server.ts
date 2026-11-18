import "server-only";

import { createDualBackendStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

export type CrewRemovalCorrectionRead = {
  status: "ready" | "degraded";
  corrections: Array<{ id: string; crewId: string; subjectUserId: string; correctedAt: string }>;
};

type Store = { listForUser(userId: string, limit: number): Promise<CrewRemovalCorrectionRead> };

const memory: Store = {
  async listForUser() { return { status: "ready", corrections: [] }; },
};

const durable: Store = {
  async listForUser(userId, limit) {
    const { data, error } = await requireSupabaseAdmin()
      .from("social_crew_removal_corrections")
      .select("id,crew_id,subject_user_id,created_at")
      .eq("subject_user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) return { status: "degraded", corrections: [] };
    return {
      status: "ready",
      corrections: (data ?? []).map((row) => ({
        id: row.id,
        crewId: row.crew_id,
        subjectUserId: row.subject_user_id,
        correctedAt: row.created_at,
      })),
    };
  },
};

export const crewRemovalCorrectionStore = createDualBackendStore(memory, durable);
