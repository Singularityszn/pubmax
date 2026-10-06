// Step Out nudge preference store — dual backend (memory + Supabase).
// Opt-in default OFF. One row per owner actor; subscription_token binds the
// preference to an existing web-push registration (migration 0052 / push_tokens).
// last_sent_at is the per-subscription Step Out frequency stamp.
// cheap_pint_* columns (migration 0111) share the same token row.

import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
} from "@/lib/storeBackend";

const TABLE = "step_out_nudge_prefs";
const MIGRATION_HINT = "apply migration 0094 and 0111";
const STORE_TAG = "step-out-nudge";

const SELECT_COLUMNS =
  "owner_actor, enabled, subscription_token, last_sent_at, created_at, updated_at, cheap_pint_qualified, cheap_pint_enabled, cheap_pint_declined, cheap_pint_sent_at";

export type StepOutNudgePref = {
  ownerActor: string;
  enabled: boolean;
  subscriptionToken: string | null;
  lastSentAt: string | null;
  createdAt: string;
  updatedAt: string;
  cheapPintQualified: boolean;
  cheapPintEnabled: boolean;
  cheapPintDeclined: boolean;
  cheapPintSentAt: string | null;
};

type StepOutNudgePrefPut = {
  enabled: boolean;
  subscriptionToken?: string | null;
};

export type StepOutNudgeStore = {
  get(ownerActor: string): Promise<StepOutNudgePref | null>;
  put(ownerActor: string, input: StepOutNudgePrefPut): Promise<StepOutNudgePref>;
  withdraw(ownerActor: string): Promise<StepOutNudgePref>;
  markSent(ownerActor: string, sentAt: string): Promise<void>;
  listEnabled(): Promise<StepOutNudgePref[]>;
  qualifyCheapPint(ownerActor: string): Promise<StepOutNudgePref>;
  optInCheapPint(ownerActor: string, subscriptionToken: string): Promise<StepOutNudgePref>;
  declineCheapPint(ownerActor: string): Promise<StepOutNudgePref>;
  markCheapPintSent(ownerActor: string, sentAt: string): Promise<void>;
  listCheapPintSendReady(): Promise<StepOutNudgePref[]>;
};

type DbRow = {
  owner_actor: string;
  enabled: boolean;
  subscription_token: string | null;
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
  cheap_pint_qualified?: boolean;
  cheap_pint_enabled?: boolean;
  cheap_pint_declined?: boolean;
  cheap_pint_sent_at?: string | null;
};

function toDTO(row: DbRow): StepOutNudgePref {
  return {
    ownerActor: row.owner_actor,
    enabled: Boolean(row.enabled),
    subscriptionToken: row.subscription_token,
    lastSentAt: row.last_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cheapPintQualified: Boolean(row.cheap_pint_qualified),
    cheapPintEnabled: Boolean(row.cheap_pint_enabled),
    cheapPintDeclined: Boolean(row.cheap_pint_declined),
    cheapPintSentAt: row.cheap_pint_sent_at ?? null,
  };
}

function blankRow(ownerActor: string, now: string): StepOutNudgePref {
  return {
    ownerActor,
    enabled: false,
    subscriptionToken: null,
    lastSentAt: null,
    createdAt: now,
    updatedAt: now,
    cheapPintQualified: false,
    cheapPintEnabled: false,
    cheapPintDeclined: false,
    cheapPintSentAt: null,
  };
}

function keepsPushToken(row: StepOutNudgePref): boolean {
  return row.enabled || row.cheapPintEnabled;
}

const memoryPrefs = new Map<string, StepOutNudgePref>();

export function __resetStepOutNudgeStore(): void {
  memoryPrefs.clear();
}

function memoryPut(ownerActor: string, input: StepOutNudgePrefPut): StepOutNudgePref {
  const now = new Date().toISOString();
  const existing = memoryPrefs.get(ownerActor) ?? blankRow(ownerActor, now);
  let subscriptionToken =
    input.subscriptionToken === undefined
      ? (existing.subscriptionToken ?? null)
      : input.subscriptionToken;
  if (!input.enabled && !existing.cheapPintEnabled) {
    subscriptionToken = null;
  }
  let lastSentAt = existing.lastSentAt;
  if (
    input.enabled &&
    subscriptionToken &&
    subscriptionToken !== existing.subscriptionToken
  ) {
    lastSentAt = null;
  }
  const next: StepOutNudgePref = {
    ...existing,
    ownerActor,
    enabled: input.enabled,
    subscriptionToken,
    lastSentAt,
    updatedAt: now,
  };
  memoryPrefs.set(ownerActor, next);
  return next;
}

function memoryQualifyCheapPint(ownerActor: string): StepOutNudgePref {
  const now = new Date().toISOString();
  const existing = memoryPrefs.get(ownerActor) ?? blankRow(ownerActor, now);
  if (existing.cheapPintDeclined || existing.cheapPintSentAt) return existing;
  const next: StepOutNudgePref = {
    ...existing,
    cheapPintQualified: true,
    updatedAt: now,
  };
  memoryPrefs.set(ownerActor, next);
  return next;
}

function memoryOptInCheapPint(ownerActor: string, subscriptionToken: string): StepOutNudgePref {
  const now = new Date().toISOString();
  const existing = memoryPrefs.get(ownerActor) ?? blankRow(ownerActor, now);
  const next: StepOutNudgePref = {
    ...existing,
    cheapPintQualified: true,
    cheapPintEnabled: true,
    cheapPintDeclined: false,
    subscriptionToken,
    updatedAt: now,
  };
  memoryPrefs.set(ownerActor, next);
  return next;
}

function memoryDeclineCheapPint(ownerActor: string): StepOutNudgePref {
  const now = new Date().toISOString();
  const existing = memoryPrefs.get(ownerActor) ?? blankRow(ownerActor, now);
  const next: StepOutNudgePref = {
    ...existing,
    cheapPintDeclined: true,
    cheapPintEnabled: false,
    subscriptionToken: keepsPushToken({ ...existing, cheapPintEnabled: false })
      ? existing.subscriptionToken
      : null,
    updatedAt: now,
  };
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
    return memoryPut(ownerActor, { enabled: false });
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
  async qualifyCheapPint(ownerActor) {
    return memoryQualifyCheapPint(ownerActor);
  },
  async optInCheapPint(ownerActor, subscriptionToken) {
    return memoryOptInCheapPint(ownerActor, subscriptionToken);
  },
  async declineCheapPint(ownerActor) {
    return memoryDeclineCheapPint(ownerActor);
  },
  async markCheapPintSent(ownerActor, sentAt) {
    const existing = memoryPrefs.get(ownerActor);
    if (!existing) return;
    memoryPrefs.set(ownerActor, {
      ...existing,
      cheapPintSentAt: sentAt,
      updatedAt: sentAt,
    });
  },
  async listCheapPintSendReady() {
    return [...memoryPrefs.values()].filter(
      (row) =>
        row.cheapPintQualified &&
        row.cheapPintEnabled &&
        !row.cheapPintDeclined &&
        !row.cheapPintSentAt &&
        Boolean(row.subscriptionToken),
    );
  },
};

const { guard } = createFailSoftGuard({
  tag: STORE_TAG,
  tables: TABLE,
  migrationHint: MIGRATION_HINT,
});

async function readRow(ownerActor: string): Promise<StepOutNudgePref | null> {
  const { data, error } = await admin()
    .from(TABLE)
    .select(SELECT_COLUMNS)
    .eq("owner_actor", ownerActor)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toDTO(data as DbRow) : null;
}

async function writeRow(row: Record<string, unknown>): Promise<StepOutNudgePref> {
  const { data, error } = await admin()
    .from(TABLE)
    .upsert(row, { onConflict: "owner_actor" })
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return toDTO(data as DbRow);
}

/** Update one owner's row only while `where` still holds, in one statement. Returns
 * the row, or null when no row matched. The condition runs in the database, so a
 * decision read earlier cannot go stale before the write lands. */
async function updateRowWhere(
  ownerActor: string,
  patch: Record<string, unknown>,
  where: Record<string, unknown>,
): Promise<StepOutNudgePref | null> {
  let query = admin().from(TABLE).update(patch).eq("owner_actor", ownerActor);
  for (const [column, value] of Object.entries(where)) query = query.eq(column, value);
  const { data, error } = await query.select(SELECT_COLUMNS).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toDTO(data as DbRow) : null;
}

const supabaseStepOutNudgeStore: StepOutNudgeStore = {
  async get(ownerActor) {
    return guard({
      context: "get",
      onSchemaMiss: async () => memoryStepOutNudgeStore.get(ownerActor),
      run: async () => readRow(ownerActor),
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
        const updatedAt = new Date().toISOString();
        if (!input.enabled) {
          // The enabled/token CHECK needs the token gone once neither preference holds
          // it. Decide that in the statement, not from a read: another tab can opt into
          // the cheap-pint ping, or decline it, at any moment.
          const cleared = await updateRowWhere(
            ownerActor,
            { enabled: false, subscription_token: null, updated_at: updatedAt },
            { cheap_pint_enabled: false },
          );
          if (cleared) return cleared;
          const kept = await updateRowWhere(
            ownerActor,
            { enabled: false, updated_at: updatedAt },
            { cheap_pint_enabled: true },
          );
          if (kept) return kept;
          // No row yet: the column defaults leave a valid default-off row.
          return writeRow({ owner_actor: ownerActor, enabled: false, updated_at: updatedAt });
        }
        const existingDto = await readRow(ownerActor);
        // Write only the Step Out columns this toggle changes. Replaying the read's
        // cheap-pint or send fields would undo a decline or a send stamp committed
        // between the read and the upsert. Column defaults fill a brand-new row.
        const row: Record<string, unknown> = {
          owner_actor: ownerActor,
          enabled: true,
          updated_at: updatedAt,
        };
        if (input.subscriptionToken !== undefined) {
          row.subscription_token = input.subscriptionToken;
          if (
            input.subscriptionToken &&
            input.subscriptionToken !== existingDto?.subscriptionToken
          ) {
            row.last_sent_at = null;
          }
        }
        return writeRow(row);
      },
    });
  },

  async withdraw(ownerActor) {
    return this.put(ownerActor, { enabled: false });
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
          .select(SELECT_COLUMNS)
          .eq("enabled", true)
          .not("subscription_token", "is", null);
        if (error) throw new Error(error.message);
        return (data ?? [])
          .map((row) => toDTO(row as DbRow))
          .filter((row) => Boolean(row.subscriptionToken));
      },
    });
  },

  async qualifyCheapPint(ownerActor) {
    return guard({
      context: "qualifyCheapPint",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryStepOutNudgeStore.qualifyCheapPint(ownerActor),
        }),
      run: async () => {
        const now = new Date().toISOString();
        const existing = (await readRow(ownerActor)) ?? blankRow(ownerActor, now);
        if (existing.cheapPintDeclined || existing.cheapPintSentAt) return existing;
        // Write only the qualified flag. The read above can be stale by the time the
        // upsert lands, so replaying its consent, subscription or send fields would
        // undo a decline or a send stamp committed in between. Column defaults fill
        // a brand-new row.
        return writeRow({
          owner_actor: ownerActor,
          updated_at: now,
          cheap_pint_qualified: true,
        });
      },
    });
  },

  async optInCheapPint(ownerActor, subscriptionToken) {
    return guard({
      context: "optInCheapPint",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () =>
            memoryStepOutNudgeStore.optInCheapPint(ownerActor, subscriptionToken),
        }),
      run: async () => {
        // The opt-in owns its consent flags and the token it binds, nothing else,
        // so it needs no read and cannot replay a stale Step Out or send field.
        return writeRow({
          owner_actor: ownerActor,
          subscription_token: subscriptionToken,
          updated_at: new Date().toISOString(),
          cheap_pint_qualified: true,
          cheap_pint_enabled: true,
          cheap_pint_declined: false,
        });
      },
    });
  },

  async declineCheapPint(ownerActor) {
    return guard({
      context: "declineCheapPint",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryStepOutNudgeStore.declineCheapPint(ownerActor),
        }),
      run: async () => {
        const updatedAt = new Date().toISOString();
        const decline = {
          cheap_pint_enabled: false,
          cheap_pint_declined: true,
          updated_at: updatedAt,
        };
        // Write only the decline flags, so a qualification or send stamp committed
        // meanwhile survives. The token goes only when Step Out no longer holds it,
        // and the database decides that in the statement, not from an earlier read.
        const cleared = await updateRowWhere(
          ownerActor,
          { ...decline, subscription_token: null },
          { enabled: false },
        );
        if (cleared) return cleared;
        const kept = await updateRowWhere(ownerActor, decline, { enabled: true });
        if (kept) return kept;
        return writeRow({ owner_actor: ownerActor, ...decline });
      },
    });
  },

  async markCheapPintSent(ownerActor, sentAt) {
    return guard({
      context: "markCheapPintSent",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryStepOutNudgeStore.markCheapPintSent(ownerActor, sentAt),
        }),
      run: async () => {
        const { error } = await admin()
          .from(TABLE)
          .update({ cheap_pint_sent_at: sentAt, updated_at: sentAt })
          .eq("owner_actor", ownerActor)
          .eq("cheap_pint_enabled", true);
        if (error) throw new Error(error.message);
      },
    });
  },

  async listCheapPintSendReady() {
    return guard({
      context: "listCheapPintSendReady",
      onSchemaMiss: async () => memoryStepOutNudgeStore.listCheapPintSendReady(),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select(SELECT_COLUMNS)
          .eq("cheap_pint_qualified", true)
          .eq("cheap_pint_enabled", true)
          .eq("cheap_pint_declined", false)
          .is("cheap_pint_sent_at", null)
          .not("subscription_token", "is", null);
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => toDTO(row as DbRow));
      },
    });
  },
};

export const stepOutNudgeStore = createDualBackendStore(
  memoryStepOutNudgeStore,
  supabaseStepOutNudgeStore,
);

