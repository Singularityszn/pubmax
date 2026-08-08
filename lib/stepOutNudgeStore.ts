// Step Out nudge preference store — dual backend (memory + Supabase).
// Opt-in default OFF. One row per owner actor; subscription_token binds the
// preference to an existing web-push registration (migration 0052 / push_tokens).
// last_sent_at is the per-subscription frequency stamp (one push / week max).

import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
} from "@/lib/storeBackend";

const TABLE = "step_out_nudge_prefs";
const MIGRATION_HINT = "apply migration 0094";
const STORE_TAG = "step-out-nudge";

export type StepOutNudgePref = {
  ownerActor: string;
  enabled: boolean;
  subscriptionToken: string | null;
  lastSentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StepOutNudgePrefPut = {
  enabled: boolean;
  subscriptionToken?: string | null;
};

export type StepOutNudgeStore = {
  get(ownerActor: string): Promise<StepOutNudgePref | null>;
  /** Upsert the owner's preference. Default enabled is false until set true. */
  put(ownerActor: string, input: StepOutNudgePrefPut): Promise<StepOutNudgePref>;
  /** Clear subscription + disable (withdraw). Idempotent. */
  withdraw(ownerActor: string): Promise<StepOutNudgePref>;
  /** Stamp last_sent_at after a successful delivery. */
  markSent(ownerActor: string, sentAt: string): Promise<void>;
  /** Enabled prefs that still carry a web subscription token. */
  listEnabled(): Promise<StepOutNudgePref[]>;
};

function toDTO(row: {
  owner_actor: string;
  enabled: boolean;
  subscription_token: string | null;
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
}): StepOutNudgePref {
  return {
    ownerActor: row.owner_actor,
    enabled: Boolean(row.enabled),
    subscriptionToken: row.subscription_token,
    lastSentAt: row.last_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Memory ───────────────────────────────────────────────────────────────────
const memoryPrefs = new Map<string, StepOutNudgePref>();

export function __resetStepOutNudgeStore(): void {
  memoryPrefs.clear();
}

export function __listMemoryStepOutNudgePrefs(): StepOutNudgePref[] {
  return [...memoryPrefs.values()];
}

function memoryPut(ownerActor: string, input: StepOutNudgePrefPut): StepOutNudgePref {
  const now = new Date().toISOString();
  const existing = memoryPrefs.get(ownerActor);
  const next: StepOutNudgePref = {
    ownerActor,
    enabled: input.enabled,
    subscriptionToken:
      input.subscriptionToken === undefined
        ? (existing?.subscriptionToken ?? null)
        : input.subscriptionToken,
    lastSentAt: existing?.lastSentAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  // Turning on with a fresh token resets the frequency stamp for that
  // subscription so a replace is not blocked by a prior endpoint's send.
  if (
    input.enabled
    && input.subscriptionToken
    && input.subscriptionToken !== existing?.subscriptionToken
  ) {
    next.lastSentAt = null;
  }
  if (!input.enabled) {
    next.subscriptionToken = null;
  }
  memoryPrefs.set(ownerActor, next);
  return next;
}

export const memoryStepOutNudgeStore: StepOutNudgeStore = {
  async get(ownerActor) {
    return memoryPrefs.get(ownerActor) ?? null;
  },
  async put(ownerActor, input) {
    return memoryPut(ownerActor, input);
  },
  async withdraw(ownerActor) {
    return memoryPut(ownerActor, { enabled: false, subscriptionToken: null });
  },
  async markSent(ownerActor, sentAt) {
    const existing = memoryPrefs.get(ownerActor);
    if (!existing) return;
    memoryPrefs.set(ownerActor, {
      ...existing,
      lastSentAt: sentAt,
      updatedAt: sentAt,
    });
  },
  async listEnabled() {
    return [...memoryPrefs.values()].filter(
      (row) => row.enabled && Boolean(row.subscriptionToken),
    );
  },
};

// ── Supabase ─────────────────────────────────────────────────────────────────
const { guard } = createFailSoftGuard({
  tag: STORE_TAG,
  tables: TABLE,
  migrationHint: MIGRATION_HINT,
});

export const supabaseStepOutNudgeStore: StepOutNudgeStore = {
  async get(ownerActor) {
    return guard({
      context: "get",
      onSchemaMiss: async () => memoryStepOutNudgeStore.get(ownerActor),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select(
            "owner_actor, enabled, subscription_token, last_sent_at, created_at, updated_at",
          )
          .eq("owner_actor", ownerActor)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? toDTO(data as Parameters<typeof toDTO>[0]) : null;
      },
    });
  },

  async put(ownerActor, input) {
    return guard({
      context: "put",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryStepOutNudgeStore.put(ownerActor, input),
        }),
      run: async () => {
        const now = new Date().toISOString();
        const { data: priorRow, error: readError } = await admin()
          .from(TABLE)
          .select(
            "owner_actor, enabled, subscription_token, last_sent_at, created_at, updated_at",
          )
          .eq("owner_actor", ownerActor)
          .maybeSingle();
        if (readError) throw new Error(readError.message);
        const existingDto = priorRow
          ? toDTO(priorRow as Parameters<typeof toDTO>[0])
          : null;

        let subscriptionToken =
          input.subscriptionToken === undefined
            ? (existingDto?.subscriptionToken ?? null)
            : input.subscriptionToken;
        if (!input.enabled) subscriptionToken = null;
        let lastSentAt = existingDto?.lastSentAt ?? null;
        if (
          input.enabled
          && subscriptionToken
          && subscriptionToken !== existingDto?.subscriptionToken
        ) {
          lastSentAt = null;
        }
        const row = {
          owner_actor: ownerActor,
          enabled: input.enabled,
          subscription_token: subscriptionToken,
          last_sent_at: lastSentAt,
          updated_at: now,
          created_at: existingDto?.createdAt ?? now,
        };
        const { data, error } = await admin()
          .from(TABLE)
          .upsert(row, { onConflict: "owner_actor" })
          .select(
            "owner_actor, enabled, subscription_token, last_sent_at, created_at, updated_at",
          )
          .single();
        if (error) throw new Error(error.message);
        return toDTO(data as Parameters<typeof toDTO>[0]);
      },
    });
  },

  async withdraw(ownerActor) {
    return this.put(ownerActor, { enabled: false, subscriptionToken: null });
  },

  async markSent(ownerActor, sentAt) {
    return guard({
      context: "markSent",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryStepOutNudgeStore.markSent(ownerActor, sentAt),
        }),
      run: async () => {
        const { error } = await admin()
          .from(TABLE)
          .update({ last_sent_at: sentAt, updated_at: sentAt })
          .eq("owner_actor", ownerActor)
          .eq("enabled", true);
        if (error) throw new Error(error.message);
      },
    });
  },

  async listEnabled() {
    return guard({
      context: "listEnabled",
      onSchemaMiss: async () => memoryStepOutNudgeStore.listEnabled(),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select(
            "owner_actor, enabled, subscription_token, last_sent_at, created_at, updated_at",
          )
          .eq("enabled", true)
          .not("subscription_token", "is", null);
        if (error) throw new Error(error.message);
        return (data ?? [])
          .map((row) => toDTO(row as Parameters<typeof toDTO>[0]))
          .filter((row) => Boolean(row.subscriptionToken));
      },
    });
  },
};

export const stepOutNudgeStore = createDualBackendStore(
  memoryStepOutNudgeStore,
  supabaseStepOutNudgeStore,
);
