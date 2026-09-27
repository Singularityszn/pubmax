import "server-only";

import type { AskCard, AskProposal } from "@/lib/ask/types";
import type { CityId } from "@/lib/cities";
import type { PubPalFenceTurn } from "@/lib/pubPalLlmFence";
import {
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
} from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

export const PUB_PAL_TOOL_TURN_TTL_MS = 120_000;

const PUB_PAL_TOOL_TURN_MIGRATION_HINT = "apply migration 0158";

export type PubPalToolTurn = {
  query: string;
  cityId: CityId;
  turns: PubPalFenceTurn[];
  expiresAt: number;
  cards: AskCard[];
  proposals: AskProposal[];
  hints: string[];
};

type PubPalToolTurnPayload = {
  query: string;
  cityId: CityId;
  turns: PubPalFenceTurn[];
  cards: AskCard[];
  proposals: AskProposal[];
  hints: string[];
};

const memoryTurns = new Map<string, PubPalToolTurn>();

function pruneMemory(now: number): void {
  for (const [key, turn] of memoryTurns) {
    if (turn.expiresAt <= now) memoryTurns.delete(key);
  }
}

function payloadFromTurn(turn: PubPalToolTurn): PubPalToolTurnPayload {
  return {
    query: turn.query,
    cityId: turn.cityId,
    turns: turn.turns,
    cards: turn.cards,
    proposals: turn.proposals,
    hints: turn.hints,
  };
}

function turnFromPayload(payload: PubPalToolTurnPayload, expiresAtMs: number): PubPalToolTurn {
  return {
    query: payload.query,
    cityId: payload.cityId,
    turns: Array.isArray(payload.turns) ? payload.turns.slice(-6) : [],
    expiresAt: expiresAtMs,
    cards: Array.isArray(payload.cards) ? payload.cards : [],
    proposals: Array.isArray(payload.proposals) ? payload.proposals : [],
    hints: Array.isArray(payload.hints) ? payload.hints : [],
  };
}

type PubPalToolTurnStore = {
  register(
    conversationId: string,
    input: { query: string; cityId: CityId; turns?: PubPalFenceTurn[] },
  ): Promise<void>;
  read(conversationId: string): Promise<PubPalToolTurn | null>;
  append(
    conversationId: string,
    patch: {
      cards?: AskCard[];
      proposals?: AskProposal[];
      hints?: string[];
    },
  ): Promise<void>;
  consume(conversationId: string): Promise<PubPalToolTurn | null>;
};

const memoryPubPalToolTurnStore: PubPalToolTurnStore = {
  async register(conversationId, input) {
    const now = Date.now();
    pruneMemory(now);
    memoryTurns.set(conversationId, {
      query: input.query,
      cityId: input.cityId,
      turns: Array.isArray(input.turns) ? input.turns.slice(-6) : [],
      expiresAt: now + PUB_PAL_TOOL_TURN_TTL_MS,
      cards: [],
      proposals: [],
      hints: [],
    });
  },

  async read(conversationId) {
    const turn = memoryTurns.get(conversationId);
    if (!turn) return null;
    if (turn.expiresAt <= Date.now()) {
      memoryTurns.delete(conversationId);
      return null;
    }
    return turn;
  },

  async append(conversationId, patch) {
    const turn = await memoryPubPalToolTurnStore.read(conversationId);
    if (!turn) return;
    if (patch.cards?.length) turn.cards.push(...patch.cards);
    if (patch.proposals?.length) turn.proposals.push(...patch.proposals);
    if (patch.hints?.length) turn.hints.push(...patch.hints);
  },

  async consume(conversationId) {
    const turn = await memoryPubPalToolTurnStore.read(conversationId);
    if (!turn) return null;
    memoryTurns.delete(conversationId);
    return turn;
  },
};

const { guard, resetWarnings } = createFailSoftGuard({
  tag: "pub-pal-tool-turn",
  tables: "pub_pal_tool_turns",
  migrationHint: PUB_PAL_TOOL_TURN_MIGRATION_HINT,
});

type ToolTurnRow = {
  conversation_id: string;
  payload: unknown;
  expires_at: string;
};

const supabasePubPalToolTurnStore: PubPalToolTurnStore = {
  async register(conversationId, input) {
    await guard<void>({
      context: "register",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "pub-pal-tool-turn",
          migrationHint: PUB_PAL_TOOL_TURN_MIGRATION_HINT,
          fallback: () => memoryPubPalToolTurnStore.register(conversationId, input),
        }),
      run: async () => {
        const expiresAt = new Date(Date.now() + PUB_PAL_TOOL_TURN_TTL_MS).toISOString();
        const payload: PubPalToolTurnPayload = {
          query: input.query,
          cityId: input.cityId,
          turns: Array.isArray(input.turns) ? input.turns.slice(-6) : [],
          cards: [],
          proposals: [],
          hints: [],
        };
        const { error } = await requireSupabaseAdmin()
          .from("pub_pal_tool_turns")
          .upsert(
            { conversation_id: conversationId, payload, expires_at: expiresAt },
            { onConflict: "conversation_id" },
          );
        if (error) throw new Error(error.message);
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
      message: "read failed — treating as miss",
      onError: () => null,
      run: async () => {
        const { data, error } = await requireSupabaseAdmin()
          .from("pub_pal_tool_turns")
          .select("conversation_id, payload, expires_at")
          .eq("conversation_id", conversationId)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return null;
        const row = data as ToolTurnRow;
        const payload = row.payload as PubPalToolTurnPayload;
        return turnFromPayload(payload, new Date(row.expires_at).getTime());
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
        const existing = await supabasePubPalToolTurnStore.read(conversationId);
        if (!existing) return;
        if (patch.cards?.length) existing.cards.push(...patch.cards);
        if (patch.proposals?.length) existing.proposals.push(...patch.proposals);
        if (patch.hints?.length) existing.hints.push(...patch.hints);
        const expiresAt = new Date(Date.now() + PUB_PAL_TOOL_TURN_TTL_MS).toISOString();
        const { error } = await requireSupabaseAdmin()
          .from("pub_pal_tool_turns")
          .upsert(
            {
              conversation_id: conversationId,
              payload: payloadFromTurn(existing),
              expires_at: expiresAt,
            },
            { onConflict: "conversation_id" },
          );
        if (error) throw new Error(error.message);
      },
    });
  },

  async consume(conversationId) {
    const turn = await supabasePubPalToolTurnStore.read(conversationId);
    if (!turn) return null;
    await guard<void>({
      context: "consume",
      onSchemaMiss: () =>
        onMissingDurableWrite<void>({
          storeTag: "pub-pal-tool-turn",
          migrationHint: PUB_PAL_TOOL_TURN_MIGRATION_HINT,
          fallback: async () => {
            await memoryPubPalToolTurnStore.consume(conversationId);
          },
        }),
      run: async () => {
        const { error } = await requireSupabaseAdmin()
          .from("pub_pal_tool_turns")
          .delete()
          .eq("conversation_id", conversationId);
        if (error) throw new Error(error.message);
      },
    });
    return turn;
  },
};

const pubPalToolTurnStore = createDualBackendStore(
  memoryPubPalToolTurnStore,
  supabasePubPalToolTurnStore,
);

export async function registerPubPalToolTurn(
  conversationId: string,
  input: { query: string; cityId: CityId; turns?: PubPalFenceTurn[] },
): Promise<void> {
  await pubPalToolTurnStore().register(conversationId, input);
}

export async function readPubPalToolTurn(conversationId: string): Promise<PubPalToolTurn | null> {
  return pubPalToolTurnStore().read(conversationId);
}

export async function appendPubPalToolTurn(
  conversationId: string,
  patch: {
    cards?: AskCard[];
    proposals?: AskProposal[];
    hints?: string[];
  },
): Promise<void> {
  await pubPalToolTurnStore().append(conversationId, patch);
}

export async function consumePubPalToolTurn(conversationId: string): Promise<PubPalToolTurn | null> {
  return pubPalToolTurnStore().consume(conversationId);
}

export async function appendPubPalToolTurnThread(
  conversationId: string,
  turn: PubPalFenceTurn,
  input?: { cityId?: CityId; query?: string },
): Promise<void> {
  const existing = await readPubPalToolTurn(conversationId);
  const cityId = input?.cityId ?? existing?.cityId ?? "london";
  const turns = [...(existing?.turns ?? []), turn].slice(-6);
  const query =
    input?.query?.trim() ||
    existing?.query ||
    (turn.role === "user" ? turn.content : "");
  await registerPubPalToolTurn(conversationId, {
    query,
    cityId,
    turns,
  });
  if (!existing) return;
  await appendPubPalToolTurn(conversationId, {
    cards: existing.cards,
    proposals: existing.proposals,
    hints: existing.hints,
  });
}

export function __resetPubPalToolTurnStore(): void {
  memoryTurns.clear();
  resetWarnings();
}
