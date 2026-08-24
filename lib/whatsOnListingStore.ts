import "server-only";

// Durable-or-memory backing for official-API What's-On rows. The scheduled
// route (app/api/cron/refresh-whats-on) writes Ticketmaster / Skiddle events
// HERE, and the read side (lib/whatsOnListings.server.ts) reads them
// store-first, falling back to the committed public/data/whats_on files so
// nothing breaks before migration 0119 lands or when the store is empty.
//
// WHY a store and not the committed file: on Vercel the serverless filesystem
// is read-only, so a cron cannot rewrite the checked-in feeds. Same dual-backend
// seam as lib/weatherSnapshotStore.ts: Supabase when env keys exist,
// process-memory otherwise, chosen at the single whatsOnListingStore() seam.
//
// One row per listing id. replaceKind swaps every row of that kind and leaves
// the others, so an events refresh cannot wipe a quiz harvest.

import { createFailSoftGuard, selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";
import {
  isWhatsOnKind,
  parseWhatsOnRows,
  type WhatsOnKind,
  type WhatsOnRow,
} from "@/lib/whatsOn";

export type WhatsOnListingWriteOutcome = {
  written: number;
  failed?: true;
};

export type WhatsOnListingSnapshot = {
  rows: WhatsOnRow[];
  generatedAt: string | null;
};

export type WhatsOnListingStore = {
  replaceKind(
    kind: WhatsOnKind,
    rows: WhatsOnRow[],
    generatedAt: string,
  ): Promise<WhatsOnListingWriteOutcome>;
  readAll(): Promise<WhatsOnListingSnapshot>;
};

type KindSnap = { rows: WhatsOnRow[]; generatedAt: string };

const memoryKinds = new Map<WhatsOnKind, KindSnap>();

function snapshotFromKinds(kinds: Iterable<KindSnap>): WhatsOnListingSnapshot {
  const snaps = [...kinds];
  const rows = snaps.flatMap((snap) => snap.rows);
  if (rows.length === 0) return { rows: [], generatedAt: null };
  const generatedAt = snaps
    .map((snap) => snap.generatedAt)
    .reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
  return { rows, generatedAt };
}

export const memoryWhatsOnListingStore: WhatsOnListingStore = {
  async replaceKind(kind, rows, generatedAt) {
    memoryKinds.set(kind, { rows: [...rows], generatedAt });
    return { written: rows.length };
  },
  async readAll() {
    return snapshotFromKinds(memoryKinds.values());
  },
};

const TABLE = "whats_on_listings";

const { guard, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "whats-on-listings",
  tables: TABLE,
  migrationHint: "apply migration 0119",
});

type ListingRow = {
  id: string;
  kind: string;
  payload: unknown;
  observed_at: string;
  generated_at: string;
};

function toRow(row: WhatsOnRow, generatedAt: string): ListingRow {
  return {
    id: row.id,
    kind: row.kind,
    payload: row,
    observed_at: row.observedAt,
    generated_at: generatedAt,
  };
}

function fromRow(row: ListingRow): WhatsOnRow | null {
  const parsed = parseWhatsOnRows([row.payload], Date.now());
  return parsed[0] ?? null;
}

export const supabaseWhatsOnListingStore: WhatsOnListingStore = {
  async replaceKind(kind, rows, generatedAt) {
    return guard<WhatsOnListingWriteOutcome>({
      context: "replaceKind",
      onSchemaMiss: () => memoryWhatsOnListingStore.replaceKind(kind, rows, generatedAt),
      message: "replaceKind failed - flagging degraded write",
      onError: () => ({ written: 0, failed: true }),
      run: async () => {
        const { error: deleteError } = await requireSupabaseAdmin()
          .from(TABLE)
          .delete()
          .eq("kind", kind);
        if (deleteError) throw new Error(deleteError.message);
        if (rows.length === 0) return { written: 0 };
        const { error } = await requireSupabaseAdmin()
          .from(TABLE)
          .upsert(rows.map((row) => toRow(row, generatedAt)), { onConflict: "id" });
        if (error) throw new Error(error.message);
        return { written: rows.length };
      },
    });
  },

  async readAll() {
    return guard<WhatsOnListingSnapshot>({
      context: "readAll",
      onSchemaMiss: () => memoryWhatsOnListingStore.readAll(),
      message: "readAll failed - returning empty",
      onError: () => ({ rows: [], generatedAt: null }),
      run: async () => {
        const { data, error } = await requireSupabaseAdmin().from(TABLE).select("*");
        if (error) throw new Error(error.message);
        const parsed: WhatsOnRow[] = [];
        const stamps: string[] = [];
        for (const row of (data ?? []) as ListingRow[]) {
          if (!isWhatsOnKind(row.kind)) continue;
          const next = fromRow(row);
          if (!next) continue;
          parsed.push(next);
          stamps.push(row.generated_at);
        }
        if (parsed.length === 0) return { rows: [], generatedAt: null };
        const generatedAt = stamps.reduce((a, b) =>
          Date.parse(a) >= Date.parse(b) ? a : b,
        );
        return { rows: parsed, generatedAt };
      },
    });
  },
};

export function whatsOnListingStore(): WhatsOnListingStore {
  return selectStore(memoryWhatsOnListingStore, supabaseWhatsOnListingStore);
}

export function __resetWhatsOnListingStore(): void {
  memoryKinds.clear();
  resetSchemaMissWarnings();
}
