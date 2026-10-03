import "server-only";

import type { AskCard, AskProposal } from "@/lib/ask/types";
import type { CityId } from "@/lib/cities";
import type { PubPalFenceTurn } from "@/lib/pubPalLlmFence";
import { isPubPalConversationId } from "@/lib/pubPalConversationId";
import {
  createDualBackendStore,
  createFailSoftGuard,
  isUniqueViolation,
  onMissingDurableWrite,
} from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

/** Two minutes after the user's last line. The purge cron deletes expired rows every minute. */
export const PUB_PAL_TOOL_TURN_TTL_MS = 120_000;

const PUB_PAL_TOOL_TURN_MIGRATION_HINT = "apply migration 0169";
const DURABLE_WRITE_ATTEMPTS = 3;
const WRITE_CONFLICT_MESSAGE = "Pub Pal conversation changed while saving. Try again.";

/** A compare-and-swap lost every attempt; nothing from this write was persisted. */
export class PubPalToolTurnWriteConflictError extends Error {
  constructor() {
    super(WRITE_CONFLICT_MESSAGE);
    this.name = "PubPalToolTurnWriteConflictError";
  }
}

export class PubPalToolTurnAccessError extends Error {
  constructor() {
    super("Pub Pal conversation is not available to this account.");
    this.name = "PubPalToolTurnAccessError";
  }
}

export type PubPalToolTurn = {
  query: string;
  cityId: CityId;
  turns: PubPalFenceTurn[];
  expiresAt: number;
  cards: AskCard[];
  proposals: AskProposal[];
  hints: string[];
  toolsUsed: string[];
};

type StoredTurn = PubPalToolTurn & { ownerId: string };
type MemoryStoredTurn = StoredTurn & { generation: symbol };
type RevisionedStoredTurn = StoredTurn & { revision: number | null; createdAt: string };

/** Server-local origin of a computed receipt. Never part of a public turn or payload. */
type PubPalToolTurnOrigin = Readonly<{
  conversationId: string;
  ownerId: string;
} & (
  | { backend: "memory"; generation: symbol }
  | { backend: "durable"; createdAt: string }
)>;

type PubPalToolInvocationTurn = {
  turn: PubPalToolTurn;
  origin: PubPalToolTurnOrigin;
};

type PubPalToolTurnPayload = {
  query: string;
  cityId: CityId;
  turns: PubPalFenceTurn[];
  cards: AskCard[];
  proposals: AskProposal[];
  hints: string[];
  toolsUsed?: string[];
  revision?: number;
};

type OwnedWrite = {
  query: string;
  cityId: CityId;
  turns?: PubPalFenceTurn[];
  cards?: AskCard[];
  proposals?: AskProposal[];
  hints?: string[];
  toolsUsed?: string[];
  ownerId: string;
};

const memoryTurns = new Map<string, MemoryStoredTurn>();

function publicTurn(stored: StoredTurn): PubPalToolTurn {
  return {
    query: stored.query,
    cityId: stored.cityId,
    turns: stored.turns,
    expiresAt: stored.expiresAt,
    cards: stored.cards,
    proposals: stored.proposals,
    hints: stored.hints,
    toolsUsed: stored.toolsUsed,
  };
}

function pruneMemory(now: number): void {
  for (const [key, turn] of memoryTurns) {
    if (turn.expiresAt <= now) memoryTurns.delete(key);
  }
}

function assertConversationId(conversationId: string): void {
  if (!isPubPalConversationId(conversationId)) throw new PubPalToolTurnAccessError();
}

function payloadFromTurn(turn: PubPalToolTurn, revision: number): PubPalToolTurnPayload {
  return {
    query: turn.query,
    cityId: turn.cityId,
    turns: turn.turns,
    cards: turn.cards,
    proposals: turn.proposals,
    hints: turn.hints,
    toolsUsed: turn.toolsUsed,
    revision,
  };
}

function turnFromPayload(
  payload: PubPalToolTurnPayload,
  expiresAtMs: number,
  ownerId: string,
): StoredTurn {
  return {
    query: payload.query,
    cityId: payload.cityId,
    turns: Array.isArray(payload.turns) ? payload.turns.slice(-6) : [],
    expiresAt: expiresAtMs,
    cards: Array.isArray(payload.cards) ? payload.cards : [],
    proposals: Array.isArray(payload.proposals) ? payload.proposals : [],
    hints: Array.isArray(payload.hints) ? payload.hints : [],
    toolsUsed: Array.isArray(payload.toolsUsed) ? payload.toolsUsed : [],
    ownerId,
  };
}

function mergeOwned(existing: StoredTurn | null, input: OwnedWrite, now: number): StoredTurn {
  return {
    query: input.query,
    cityId: input.cityId,
    turns: Array.isArray(input.turns) ? input.turns.slice(-6) : existing?.turns ?? [],
    expiresAt: now + PUB_PAL_TOOL_TURN_TTL_MS,
    cards: input.cards ?? existing?.cards ?? [],
    proposals: input.proposals ?? existing?.proposals ?? [],
    hints: input.hints ?? existing?.hints ?? [],
    toolsUsed: input.toolsUsed ?? existing?.toolsUsed ?? [],
    ownerId: input.ownerId,
  };
}

type PubPalToolTurnStore = {
  bind(conversationId: string, ownerId: string, cityId: CityId): Promise<void>;
  register(conversationId: string, input: OwnedWrite): Promise<void>;
  read(conversationId: string): Promise<PubPalToolTurn | null>;
  readForInvocation(conversationId: string): Promise<PubPalToolInvocationTurn | null>;
  readOwned(conversationId: string, ownerId: string): Promise<PubPalToolTurn | null>;
  touch(conversationId: string, ownerId: string): Promise<boolean>;
  appendOwnedUserTurn(
    conversationId: string,
    ownerId: string,
    turn: PubPalFenceTurn,
    cityId: CityId,
    allowFreshContext: boolean,
  ): Promise<boolean>;
  append(
    conversationId: string,
    patch: {
      cards?: AskCard[];
      proposals?: AskProposal[];
      hints?: string[];
      toolsUsed?: string[];
    },
    origin: PubPalToolTurnOrigin,
  ): Promise<void>;
  purgeExpired(): Promise<void>;
};

const memoryPubPalToolTurnStore: PubPalToolTurnStore = {
  async bind(conversationId, ownerId, cityId) {
    assertConversationId(conversationId);
    const now = Date.now();
    pruneMemory(now);
    const existing = memoryTurns.get(conversationId);
    if (existing && existing.ownerId !== ownerId) throw new PubPalToolTurnAccessError();
    if (existing) return;
    memoryTurns.set(conversationId, {
      query: "",
      cityId,
      turns: [],
      expiresAt: now + PUB_PAL_TOOL_TURN_TTL_MS,
      cards: [],
      proposals: [],
      hints: [],
      toolsUsed: [],
      ownerId,
      generation: Symbol(),
    });
  },

  async register(conversationId, input) {
    assertConversationId(conversationId);
    const now = Date.now();
    pruneMemory(now);
    const existing = memoryTurns.get(conversationId) ?? null;
    if (existing && existing.ownerId !== input.ownerId) throw new PubPalToolTurnAccessError();
    memoryTurns.set(conversationId, {
      ...mergeOwned(existing, input, now),
      generation: existing?.generation ?? Symbol(),
    });
  },

  async read(conversationId) {
    const now = Date.now();
    pruneMemory(now);
    const turn = memoryTurns.get(conversationId);
    if (!turn) return null;
    return publicTurn(turn);
  },

  async readForInvocation(conversationId) {
    pruneMemory(Date.now());
    const turn = memoryTurns.get(conversationId);
    if (!turn) return null;
    return {
      turn: publicTurn(turn),
      origin: {
        conversationId,
        ownerId: turn.ownerId,
        backend: "memory",
        generation: turn.generation,
      },
    };
  },

  async readOwned(conversationId, ownerId) {
    assertConversationId(conversationId);
    pruneMemory(Date.now());
    const turn = memoryTurns.get(conversationId);
    if (!turn || turn.ownerId !== ownerId) return null;
    return publicTurn(turn);
  },

  async touch(conversationId, ownerId) {
    assertConversationId(conversationId);
    const now = Date.now();
    pruneMemory(now);
    const existing = memoryTurns.get(conversationId);
    if (!existing || existing.ownerId !== ownerId) return false;
    return true;
  },

  async appendOwnedUserTurn(conversationId, ownerId, turn, cityId, allowFreshContext) {
    assertConversationId(conversationId);
    const now = Date.now();
    pruneMemory(now);
    const existing = memoryTurns.get(conversationId);
    if (!existing) {
      if (!allowFreshContext) return false;
      memoryTurns.set(conversationId, {
        ...mergeOwned(null, {
          query: turn.content.trim(), cityId, ownerId, turns: [turn],
        }, now),
        generation: Symbol(),
      });
      return true;
    }
    if (existing.ownerId !== ownerId) return false;
    existing.turns = [...existing.turns, turn].slice(-6);
    if (turn.role === "user" && turn.content.trim()) existing.query = turn.content.trim();
    existing.cityId = cityId;
    existing.expiresAt = now + PUB_PAL_TOOL_TURN_TTL_MS;
    return true;
  },

  async append(conversationId, patch, origin) {
    const turn = memoryTurns.get(conversationId);
    if (!turn || turn.expiresAt <= Date.now()) return;
    if (origin.backend !== "memory" || origin.conversationId !== conversationId) return;
    if (turn.ownerId !== origin.ownerId) throw new PubPalToolTurnAccessError();
    if (turn.generation !== origin.generation) return;
    if (patch.cards?.length) turn.cards.push(...patch.cards);
    if (patch.proposals?.length) turn.proposals.push(...patch.proposals);
    if (patch.hints?.length) turn.hints.push(...patch.hints);
    if (patch.toolsUsed?.length) {
      for (const name of patch.toolsUsed) {
        if (!turn.toolsUsed.includes(name)) turn.toolsUsed.push(name);
      }
    }
  },

  async purgeExpired() {
    pruneMemory(Date.now());
  },
};

const { guard, resetWarnings } = createFailSoftGuard({
  tag: "pub-pal-tool-turn",
  tables: "pub_pal_tool_turns",
  migrationHint: PUB_PAL_TOOL_TURN_MIGRATION_HINT,
});

type ToolTurnRow = {
  conversation_id: string;
  owner_id: string | null;
  payload: unknown;
  expires_at: string;
  created_at: string;
};

async function purgeExpiredRows(): Promise<void> {
  const { error } = await requireSupabaseAdmin()
    .from("pub_pal_tool_turns")
    .delete()
    .lte("expires_at", "now");
  if (error) throw new Error(error.message);
}

type StoredLookup =
  | { status: "missing" }
  | { status: "unowned" }
  | { status: "owned"; turn: RevisionedStoredTurn };

async function lookupStoredRow(conversationId: string): Promise<StoredLookup> {
  const { data, error } = await requireSupabaseAdmin()
    .from("pub_pal_tool_turns")
    .select("conversation_id, owner_id, payload, expires_at, created_at")
    .eq("conversation_id", conversationId)
    .gt("expires_at", "now")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { status: "missing" };
  const row = data as ToolTurnRow;
  // A null owner is not a free claim. Bind and register refuse it.
  if (!row.owner_id) return { status: "unowned" };
  if (typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) {
    throw new Error("Invalid Pub Pal conversation creation time.");
  }
  const payload = row.payload as PubPalToolTurnPayload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid Pub Pal conversation payload.");
  }
  const revision = payload.revision;
  if (Object.hasOwn(payload, "revision") && (
    typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0
  )) {
    throw new Error("Invalid Pub Pal conversation revision.");
  }
  return {
    status: "owned",
    turn: {
      ...turnFromPayload(payload, new Date(row.expires_at).getTime(), row.owner_id),
      revision: revision ?? null,
      // Preserve raw PostgreSQL microseconds for generation comparison and CAS.
      createdAt: row.created_at,
    },
  };
}

function claimedTurn(lookup: StoredLookup): RevisionedStoredTurn | null {
  if (lookup.status === "unowned") throw new PubPalToolTurnAccessError();
  return lookup.status === "owned" ? lookup.turn : null;
}

async function insertStoredRow(conversationId: string, stored: StoredTurn): Promise<boolean> {
  const { error } = await requireSupabaseAdmin()
    .from("pub_pal_tool_turns")
    .insert({
      conversation_id: conversationId,
      owner_id: stored.ownerId,
      payload: payloadFromTurn(stored, 1),
      expires_at: new Date(stored.expiresAt).toISOString(),
    });
  if (isUniqueViolation(error)) return false;
  if (error) throw new Error(error.message);
  return true;
}

async function updateStoredRow(
  conversationId: string,
  expected: RevisionedStoredTurn,
  stored: StoredTurn,
): Promise<boolean> {
  if (expected.expiresAt <= Date.now()) return false;
  if (expected.revision === Number.MAX_SAFE_INTEGER) {
    throw new Error("Invalid Pub Pal conversation revision.");
  }
  let update = requireSupabaseAdmin()
    .from("pub_pal_tool_turns")
    .update({
      payload: payloadFromTurn(stored, (expected.revision ?? 0) + 1),
      expires_at: new Date(stored.expiresAt).toISOString(),
    })
    .eq("conversation_id", conversationId)
    .eq("owner_id", expected.ownerId)
    .eq("created_at", expected.createdAt)
    .eq("expires_at", new Date(expected.expiresAt).toISOString())
    .gt("expires_at", "now");
  update = expected.revision === null
    ? update.is("payload->revision", null)
    : update.eq("payload->>revision", String(expected.revision));
  const { data, error } = await update.select("conversation_id").maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
}

const supabasePubPalToolTurnStore: PubPalToolTurnStore = {
  async bind(conversationId, ownerId, cityId) {
    assertConversationId(conversationId);
    const expiresAt = Date.now() + PUB_PAL_TOOL_TURN_TTL_MS;
    await guard<void>({
      context: "bind",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "pub-pal-tool-turn",
          migrationHint: PUB_PAL_TOOL_TURN_MIGRATION_HINT,
          fallback: () => memoryPubPalToolTurnStore.bind(conversationId, ownerId, cityId),
        }),
      run: async () => {
        await purgeExpiredRows();
        for (let attempt = 0; attempt < DURABLE_WRITE_ATTEMPTS; attempt++) {
          const existing = claimedTurn(await lookupStoredRow(conversationId));
          if (existing && existing.ownerId !== ownerId) throw new PubPalToolTurnAccessError();
          if (existing) return;
          if (expiresAt <= Date.now()) throw new PubPalToolTurnAccessError();
          if (await insertStoredRow(conversationId, {
            query: "",
            cityId,
            turns: [],
            expiresAt,
            cards: [],
            proposals: [],
            hints: [],
            toolsUsed: [],
            ownerId,
          })) return;
        }
        throw new PubPalToolTurnWriteConflictError();
      },
    });
  },

  async register(conversationId, input) {
    assertConversationId(conversationId);
    const userLineAt = Date.now();
    await guard<void>({
      context: "register",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "pub-pal-tool-turn",
          migrationHint: PUB_PAL_TOOL_TURN_MIGRATION_HINT,
          fallback: () => memoryPubPalToolTurnStore.register(conversationId, input),
        }),
      run: async () => {
        await purgeExpiredRows();
        let createdAt: string | undefined;
        for (let attempt = 0; attempt < DURABLE_WRITE_ATTEMPTS; attempt++) {
          const existing = claimedTurn(await lookupStoredRow(conversationId));
          if (existing && existing.ownerId !== input.ownerId) throw new PubPalToolTurnAccessError();
          if (createdAt !== undefined && (!existing || existing.createdAt !== createdAt)) {
            throw new PubPalToolTurnAccessError();
          }
          if (existing) createdAt ??= existing.createdAt;
          const next = mergeOwned(existing, input, userLineAt);
          if (existing) {
            next.expiresAt = Math.max(existing.expiresAt, next.expiresAt);
            if (await updateStoredRow(conversationId, existing, next)) return;
          } else {
            if (next.expiresAt <= Date.now()) throw new PubPalToolTurnAccessError();
            if (await insertStoredRow(conversationId, next)) return;
          }
        }
        throw new PubPalToolTurnWriteConflictError();
      },
    });
  },

  async read(conversationId) {
    return guard<PubPalToolTurn | null>({
      context: "read",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "pub-pal-tool-turn",
          migrationHint: PUB_PAL_TOOL_TURN_MIGRATION_HINT,
          fallback: () => memoryPubPalToolTurnStore.read(conversationId),
          onProduction: async () => null,
        }),
      run: async () => {
        const lookup = await lookupStoredRow(conversationId);
        return lookup.status === "owned" ? publicTurn(lookup.turn) : null;
      },
    });
  },

  async readForInvocation(conversationId) {
    return guard<PubPalToolInvocationTurn | null>({
      context: "read-for-invocation",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "pub-pal-tool-turn",
          migrationHint: PUB_PAL_TOOL_TURN_MIGRATION_HINT,
          fallback: () => memoryPubPalToolTurnStore.readForInvocation(conversationId),
          onProduction: async () => null,
        }),
      run: async () => {
        const lookup = await lookupStoredRow(conversationId);
        if (lookup.status !== "owned") return null;
        return {
          turn: publicTurn(lookup.turn),
          origin: {
            conversationId,
            ownerId: lookup.turn.ownerId,
            backend: "durable",
            createdAt: lookup.turn.createdAt,
          },
        };
      },
    });
  },

  async readOwned(conversationId, ownerId) {
    assertConversationId(conversationId);
    return guard<PubPalToolTurn | null>({
      context: "read-owned",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "pub-pal-tool-turn",
          migrationHint: PUB_PAL_TOOL_TURN_MIGRATION_HINT,
          fallback: () => memoryPubPalToolTurnStore.readOwned(conversationId, ownerId),
          onProduction: async () => null,
        }),
      run: async () => {
        const lookup = await lookupStoredRow(conversationId);
        if (lookup.status !== "owned" || lookup.turn.ownerId !== ownerId) return null;
        return publicTurn(lookup.turn);
      },
    });
  },

  async touch(conversationId, ownerId) {
    assertConversationId(conversationId);
    return guard<boolean>({
      context: "touch",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "pub-pal-tool-turn",
          migrationHint: PUB_PAL_TOOL_TURN_MIGRATION_HINT,
          fallback: () => memoryPubPalToolTurnStore.touch(conversationId, ownerId),
          onProduction: async () => false,
        }),
      run: async () => {
        await purgeExpiredRows();
        const lookup = await lookupStoredRow(conversationId);
        return lookup.status === "owned" && lookup.turn.ownerId === ownerId;
      },
    });
  },

  async appendOwnedUserTurn(conversationId, ownerId, turn, cityId, allowFreshContext) {
    assertConversationId(conversationId);
    const userLineAt = Date.now();
    const expiresAt = userLineAt + PUB_PAL_TOOL_TURN_TTL_MS;
    return guard<boolean>({
      context: "append-owned",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "pub-pal-tool-turn",
          migrationHint: PUB_PAL_TOOL_TURN_MIGRATION_HINT,
          fallback: () =>
            memoryPubPalToolTurnStore.appendOwnedUserTurn(conversationId, ownerId, turn, cityId, allowFreshContext),
          onProduction: async () => false,
        }),
      run: async () => {
        await purgeExpiredRows();
        let createdAt: string | undefined;
        for (let attempt = 0; attempt < DURABLE_WRITE_ATTEMPTS; attempt++) {
          const lookup = await lookupStoredRow(conversationId);
          if (lookup.status === "missing") {
            // Only a newly verified user's line may start empty context. Once
            // this call saw a generation, its disappearance is a refusal.
            if (!allowFreshContext || createdAt !== undefined || expiresAt <= Date.now()) return false;
            const fresh = mergeOwned(null, {
              query: turn.content.trim(), cityId, ownerId, turns: [turn],
            }, userLineAt);
            if (await insertStoredRow(conversationId, fresh)) return true;
            continue;
          }
          if (lookup.status !== "owned" || lookup.turn.ownerId !== ownerId) return false;
          const existing = lookup.turn;
          if (createdAt !== undefined && existing.createdAt !== createdAt) return false;
          createdAt ??= existing.createdAt;
          const next = {
            ...existing,
            turns: [...existing.turns, turn].slice(-6),
            expiresAt: Math.max(existing.expiresAt, expiresAt),
          };
          if (expiresAt >= existing.expiresAt) {
            next.query = turn.content.trim();
            next.cityId = cityId;
          }
          if (await updateStoredRow(conversationId, existing, next)) return true;
        }
        throw new PubPalToolTurnWriteConflictError();
      },
    });
  },

  async append(conversationId, patch, origin) {
    await guard<void>({
      context: "append",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "pub-pal-tool-turn",
          migrationHint: PUB_PAL_TOOL_TURN_MIGRATION_HINT,
          fallback: () => memoryPubPalToolTurnStore.append(conversationId, patch, origin),
        }),
      run: async () => {
        for (let attempt = 0; attempt < DURABLE_WRITE_ATTEMPTS; attempt++) {
          const lookup = await lookupStoredRow(conversationId);
          if (lookup.status !== "owned") return;
          const existing = lookup.turn;
          if (origin.backend !== "durable" || origin.conversationId !== conversationId) return;
          if (existing.ownerId !== origin.ownerId) throw new PubPalToolTurnAccessError();
          if (existing.createdAt !== origin.createdAt) return;
          const next = {
            ...existing,
            cards: [...existing.cards, ...(patch.cards ?? [])],
            proposals: [...existing.proposals, ...(patch.proposals ?? [])],
            hints: [...existing.hints, ...(patch.hints ?? [])],
            toolsUsed: [...existing.toolsUsed],
          };
          for (const name of patch.toolsUsed ?? []) {
            if (!next.toolsUsed.includes(name)) next.toolsUsed.push(name);
          }
          if (await updateStoredRow(conversationId, existing, next)) return;
        }
        throw new PubPalToolTurnWriteConflictError();
      },
    });
  },

  async purgeExpired() {
    await guard<void>({
      context: "purge",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "pub-pal-tool-turn",
          migrationHint: PUB_PAL_TOOL_TURN_MIGRATION_HINT,
          fallback: () => memoryPubPalToolTurnStore.purgeExpired(),
        }),
      run: purgeExpiredRows,
    });
  },
};

const pubPalToolTurnStore = createDualBackendStore(
  memoryPubPalToolTurnStore,
  supabasePubPalToolTurnStore,
);

export async function bindPubPalToolTurn(
  conversationId: string,
  ownerId: string,
  cityId: CityId,
): Promise<void> {
  await pubPalToolTurnStore().bind(conversationId, ownerId, cityId);
}

export async function registerPubPalToolTurn(
  conversationId: string,
  input: OwnedWrite,
): Promise<void> {
  await pubPalToolTurnStore().register(conversationId, input);
}

export async function readPubPalToolTurn(conversationId: string): Promise<PubPalToolTurn | null> {
  return pubPalToolTurnStore().read(conversationId);
}

/** Capture public context and private origin together, before asynchronous tool computation. */
export async function readPubPalToolInvocationTurn(
  conversationId: string,
): Promise<PubPalToolInvocationTurn | null> {
  return pubPalToolTurnStore().readForInvocation(conversationId);
}

export async function readOwnedPubPalToolTurn(
  conversationId: string,
  ownerId: string,
): Promise<PubPalToolTurn | null> {
  return pubPalToolTurnStore().readOwned(conversationId, ownerId);
}

export async function touchPubPalToolTurn(
  conversationId: string,
  ownerId: string,
): Promise<boolean> {
  return pubPalToolTurnStore().touch(conversationId, ownerId);
}

/** Fresh context requires a server-verified ownership proof at the route. */
export async function appendOwnedPubPalUserTurn(
  conversationId: string,
  ownerId: string,
  turn: PubPalFenceTurn,
  cityId: CityId,
  allowFreshContext = false,
): Promise<boolean> {
  if (turn.role !== "user" || !turn.content.trim()) return false;
  return pubPalToolTurnStore().appendOwnedUserTurn(conversationId, ownerId, turn, cityId, allowFreshContext);
}

export async function appendPubPalToolTurn(
  conversationId: string,
  patch: {
    cards?: AskCard[];
    proposals?: AskProposal[];
    hints?: string[];
    toolsUsed?: string[];
  },
  origin: PubPalToolTurnOrigin,
): Promise<void> {
  await pubPalToolTurnStore().append(conversationId, patch, origin);
}

export async function purgeExpiredPubPalToolTurns(): Promise<void> {
  await pubPalToolTurnStore().purgeExpired();
}

/** Test-only observer. Unlike every read, it never prunes, so it shows what the purge left behind. */
export function hasStoredPubPalToolTurnForTest(conversationId: string): boolean {
  return memoryTurns.has(conversationId);
}

export function __resetPubPalToolTurnStore(): void {
  memoryTurns.clear();
  resetWarnings();
}
