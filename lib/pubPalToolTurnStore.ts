import "server-only";

import type { AskCard, AskProposal } from "@/lib/ask/types";
import type { CityId } from "@/lib/cities";
import type { PubPalFenceTurn } from "@/lib/pubPalLlmFence";
import { isPubPalConversationId } from "@/lib/pubPalConversationId";
import {
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
} from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

/** Two minutes after the last write. The purge cron deletes expired rows every minute. */
export const PUB_PAL_TOOL_TURN_TTL_MS = 120_000;

const PUB_PAL_TOOL_TURN_MIGRATION_HINT = "apply migration 0169";

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

type PubPalToolTurnPayload = {
  query: string;
  cityId: CityId;
  turns: PubPalFenceTurn[];
  cards: AskCard[];
  proposals: AskProposal[];
  hints: string[];
  toolsUsed?: string[];
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

const memoryTurns = new Map<string, StoredTurn>();

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

function payloadFromTurn(turn: PubPalToolTurn): PubPalToolTurnPayload {
  return {
    query: turn.query,
    cityId: turn.cityId,
    turns: turn.turns,
    cards: turn.cards,
    proposals: turn.proposals,
    hints: turn.hints,
    toolsUsed: turn.toolsUsed,
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
  readOwned(conversationId: string, ownerId: string): Promise<PubPalToolTurn | null>;
  touch(conversationId: string, ownerId: string): Promise<boolean>;
  appendOwnedUserTurn(
    conversationId: string,
    ownerId: string,
    turn: PubPalFenceTurn,
    cityId: CityId,
  ): Promise<boolean>;
  append(
    conversationId: string,
    patch: {
      cards?: AskCard[];
      proposals?: AskProposal[];
      hints?: string[];
      toolsUsed?: string[];
    },
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
    if (existing) {
      existing.expiresAt = now + PUB_PAL_TOOL_TURN_TTL_MS;
      return;
    }
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
    });
  },

  async register(conversationId, input) {
    assertConversationId(conversationId);
    const now = Date.now();
    pruneMemory(now);
    const existing = memoryTurns.get(conversationId) ?? null;
    if (existing && existing.ownerId !== input.ownerId) throw new PubPalToolTurnAccessError();
    memoryTurns.set(conversationId, mergeOwned(existing, input, now));
  },

  async read(conversationId) {
    const now = Date.now();
    pruneMemory(now);
    const turn = memoryTurns.get(conversationId);
    if (!turn) return null;
    return publicTurn(turn);
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
    existing.expiresAt = now + PUB_PAL_TOOL_TURN_TTL_MS;
    return true;
  },

  async appendOwnedUserTurn(conversationId, ownerId, turn, cityId) {
    assertConversationId(conversationId);
    const now = Date.now();
    pruneMemory(now);
    const existing = memoryTurns.get(conversationId);
    if (!existing || existing.ownerId !== ownerId) return false;
    existing.turns = [...existing.turns, turn].slice(-6);
    if (turn.role === "user" && turn.content.trim()) existing.query = turn.content.trim();
    existing.cityId = cityId;
    existing.expiresAt = now + PUB_PAL_TOOL_TURN_TTL_MS;
    return true;
  },

  async append(conversationId, patch) {
    const turn = memoryTurns.get(conversationId);
    if (!turn || turn.expiresAt <= Date.now()) return;
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
};

async function purgeExpiredRows(): Promise<void> {
  const { error } = await requireSupabaseAdmin()
    .from("pub_pal_tool_turns")
    .delete()
    .lt("expires_at", new Date().toISOString());
  if (error) throw new Error(error.message);
}

type StoredLookup =
  | { status: "missing" }
  | { status: "unowned" }
  | { status: "owned"; turn: StoredTurn };

async function lookupStoredRow(conversationId: string): Promise<StoredLookup> {
  const { data, error } = await requireSupabaseAdmin()
    .from("pub_pal_tool_turns")
    .select("conversation_id, owner_id, payload, expires_at")
    .eq("conversation_id", conversationId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { status: "missing" };
  const row = data as ToolTurnRow;
  // A null owner is not a free claim. Bind and register refuse it.
  if (!row.owner_id) return { status: "unowned" };
  const payload = row.payload as PubPalToolTurnPayload;
  return {
    status: "owned",
    turn: turnFromPayload(payload, new Date(row.expires_at).getTime(), row.owner_id),
  };
}

function claimedTurn(lookup: StoredLookup): StoredTurn | null {
  if (lookup.status === "unowned") throw new PubPalToolTurnAccessError();
  return lookup.status === "owned" ? lookup.turn : null;
}

async function writeStoredRow(conversationId: string, stored: StoredTurn): Promise<void> {
  const { error } = await requireSupabaseAdmin()
    .from("pub_pal_tool_turns")
    .upsert(
      {
        conversation_id: conversationId,
        owner_id: stored.ownerId,
        payload: payloadFromTurn(stored),
        expires_at: new Date(stored.expiresAt).toISOString(),
      },
      { onConflict: "conversation_id" },
    );
  if (error) throw new Error(error.message);
}

const supabasePubPalToolTurnStore: PubPalToolTurnStore = {
  async bind(conversationId, ownerId, cityId) {
    assertConversationId(conversationId);
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
        const existing = claimedTurn(await lookupStoredRow(conversationId));
        if (existing && existing.ownerId !== ownerId) throw new PubPalToolTurnAccessError();
        if (existing) {
          existing.expiresAt = Date.now() + PUB_PAL_TOOL_TURN_TTL_MS;
          await writeStoredRow(conversationId, existing);
          return;
        }
        await writeStoredRow(conversationId, {
          query: "",
          cityId,
          turns: [],
          expiresAt: Date.now() + PUB_PAL_TOOL_TURN_TTL_MS,
          cards: [],
          proposals: [],
          hints: [],
          toolsUsed: [],
          ownerId,
        });
      },
    });
  },

  async register(conversationId, input) {
    assertConversationId(conversationId);
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
        const existing = claimedTurn(await lookupStoredRow(conversationId));
        if (existing && existing.ownerId !== input.ownerId) throw new PubPalToolTurnAccessError();
        await writeStoredRow(conversationId, mergeOwned(existing, input, Date.now()));
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
        if (lookup.status !== "owned" || lookup.turn.ownerId !== ownerId) return false;
        const existing = lookup.turn;
        existing.expiresAt = Date.now() + PUB_PAL_TOOL_TURN_TTL_MS;
        await writeStoredRow(conversationId, existing);
        return true;
      },
    });
  },

  async appendOwnedUserTurn(conversationId, ownerId, turn, cityId) {
    assertConversationId(conversationId);
    return guard<boolean>({
      context: "append-owned",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "pub-pal-tool-turn",
          migrationHint: PUB_PAL_TOOL_TURN_MIGRATION_HINT,
          fallback: () =>
            memoryPubPalToolTurnStore.appendOwnedUserTurn(conversationId, ownerId, turn, cityId),
          onProduction: async () => false,
        }),
      run: async () => {
        await purgeExpiredRows();
        const lookup = await lookupStoredRow(conversationId);
        if (lookup.status !== "owned" || lookup.turn.ownerId !== ownerId) return false;
        const existing = lookup.turn;
        existing.turns = [...existing.turns, turn].slice(-6);
        if (turn.role === "user" && turn.content.trim()) existing.query = turn.content.trim();
        existing.cityId = cityId;
        existing.expiresAt = Date.now() + PUB_PAL_TOOL_TURN_TTL_MS;
        await writeStoredRow(conversationId, existing);
        return true;
      },
    });
  },

  async append(conversationId, patch) {
    await guard<void>({
      context: "append",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "pub-pal-tool-turn",
          migrationHint: PUB_PAL_TOOL_TURN_MIGRATION_HINT,
          fallback: () => memoryPubPalToolTurnStore.append(conversationId, patch),
        }),
      run: async () => {
        const lookup = await lookupStoredRow(conversationId);
        if (lookup.status !== "owned") return;
        const existing = lookup.turn;
        if (patch.cards?.length) existing.cards.push(...patch.cards);
        if (patch.proposals?.length) existing.proposals.push(...patch.proposals);
        if (patch.hints?.length) existing.hints.push(...patch.hints);
        if (patch.toolsUsed?.length) {
          for (const name of patch.toolsUsed) {
            if (!existing.toolsUsed.includes(name)) existing.toolsUsed.push(name);
          }
        }
        existing.expiresAt = Date.now() + PUB_PAL_TOOL_TURN_TTL_MS;
        await writeStoredRow(conversationId, existing);
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

export async function appendOwnedPubPalUserTurn(
  conversationId: string,
  ownerId: string,
  turn: PubPalFenceTurn,
  cityId: CityId,
): Promise<boolean> {
  return pubPalToolTurnStore().appendOwnedUserTurn(conversationId, ownerId, turn, cityId);
}

export async function appendPubPalToolTurn(
  conversationId: string,
  patch: {
    cards?: AskCard[];
    proposals?: AskProposal[];
    hints?: string[];
    toolsUsed?: string[];
  },
): Promise<void> {
  await pubPalToolTurnStore().append(conversationId, patch);
}

export async function purgeExpiredPubPalToolTurns(): Promise<void> {
  await pubPalToolTurnStore().purgeExpired();
}

export function __resetPubPalToolTurnStore(): void {
  memoryTurns.clear();
  resetWarnings();
}
