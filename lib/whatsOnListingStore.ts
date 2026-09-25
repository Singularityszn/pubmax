import "server-only";

// Durable-or-memory backing for official-API What's-On rows. The scheduled
// route (app/api/cron/refresh-whats-on) writes refreshed What's-On rows HERE,
// and the read side (lib/whatsOnListings.server.ts) reads them
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

import {
  createFailSoftGuard,
  errorMessage,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";
import {
  isSupabaseConfigured,
  requireSupabaseAdmin,
  requiresSupabaseStore,
} from "@/lib/supabase";
import {
  isWhatsOnKind,
  parseWhatsOnRows,
  type WhatsOnKind,
  type WhatsOnRow,
} from "@/lib/whatsOn";

type WhatsOnListingWriteOutcome = {
  written: number;
  failed?: true;
};

type WhatsOnListingGeneration = {
  generatedAt: string | null;
  failed?: true;
  failure?: string;
};

type WhatsOnListingSnapshot = WhatsOnListingGeneration & {
  rows: WhatsOnRow[];
};

/**
 * Narrows a read to what the caller can serve. Sport rows fan one fixture out
 * across every screening pub, so they dominate the table; a bounded read
 * returns only the sport rows starting inside [sportStartsFrom,
 * sportStartsBefore) and leaves the rest in the store.
 */
type WhatsOnListingQuery = {
  kind?: WhatsOnKind;
  sportStartsFrom?: number;
  sportStartsBefore?: number;
};

export type WhatsOnListingStore = {
  replaceKind(
    kind: WhatsOnKind,
    rows: WhatsOnRow[],
    generatedAt: string,
  ): Promise<WhatsOnListingWriteOutcome>;
  readAll(query?: WhatsOnListingQuery): Promise<WhatsOnListingSnapshot>;
  readGeneratedAt(): Promise<WhatsOnListingGeneration>;
};

type KindSnap = { rows: WhatsOnRow[]; generatedAt: string };

const memoryKinds = new Map<WhatsOnKind, KindSnap>();

function oldestStamp(stamps: string[]): string | null {
  if (stamps.length === 0) return null;
  return stamps.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
}

function matchesQuery(row: WhatsOnRow, query: WhatsOnListingQuery): boolean {
  if (query.kind && row.kind !== query.kind) return false;
  if (row.kind !== "sport" || !row.startsAt) return true;
  const startsAt = Date.parse(row.startsAt);
  if (query.sportStartsFrom !== undefined && startsAt < query.sportStartsFrom) return false;
  if (query.sportStartsBefore !== undefined && startsAt >= query.sportStartsBefore) return false;
  return true;
}

export const memoryWhatsOnListingStore: WhatsOnListingStore = {
  async replaceKind(kind, rows, generatedAt) {
    const existing = memoryKinds.get(kind);
    if (existing && Date.parse(existing.generatedAt) > Date.parse(generatedAt)) {
      return { written: 0, failed: true };
    }
    memoryKinds.set(kind, { rows: [...rows], generatedAt });
    return { written: rows.length };
  },
  async readAll(query = {}) {
    const snaps = [...memoryKinds.values()];
    return {
      rows: snaps.flatMap((snap) => snap.rows).filter((row) => matchesQuery(row, query)),
      generatedAt: oldestStamp(snaps.map((snap) => snap.generatedAt)),
    };
  },
  async readGeneratedAt() {
    return { generatedAt: oldestStamp([...memoryKinds.values()].map((snap) => snap.generatedAt)) };
  },
};

const TABLE = "whats_on_listings";
const GENERATIONS_TABLE = "whats_on_listing_generations";
// PostgREST silently caps one response at the project's max-rows setting
// (hosted default 1000), so the listing read pages in chunks no larger than
// that and stops on the first short page.
const READ_PAGE_ROWS = 1_000;
// Sport startsAt is stored as London wall clock with its offset
// ("...T20:00:00+01:00"), so the text the table compares runs up to an hour
// ahead of the instant. The table-side bound is widened past that skew and
// matchesQuery applies the exact bound after parsing.
const SPORT_TEXT_BOUND_SLACK_MS = 2 * 60 * 60 * 1000;

const { guard, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "whats-on-listings",
  tables: TABLE,
  migrationHint: "apply migration 0119",
});

type ListingRow = {
  id: string;
  kind: string;
  city: string;
  payload: unknown;
  observed_at: string;
  generated_at: string;
};

type GenerationRow = {
  kind: string;
  generated_at: string;
};

function toReplaceInput(row: WhatsOnRow): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    payload: row,
    observed_at: row.observedAt,
    city: "london",
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
      onSchemaMiss: () => onMissingDurableWrite({
        storeTag: "whats-on-listings",
        migrationHint: "apply migration 0119",
        fallback: () => memoryWhatsOnListingStore.replaceKind(kind, rows, generatedAt),
        onProduction: async () => ({ written: 0, failed: true }),
      }),
      message: "replaceKind failed - flagging degraded write",
      onError: () => ({ written: 0, failed: true }),
      run: async () => {
        const { data, error } = await requireSupabaseAdmin().rpc("replace_whats_on_listings", {
          p_kind: kind,
          p_rows: rows.map(toReplaceInput),
          p_generated_at: generatedAt,
        });
        if (error) throw new Error(error.message);
        const written = typeof data === "number" ? data : Number(data);
        if (!Number.isInteger(written) || written < 0) {
          throw new Error("replace_whats_on_listings returned an invalid row count");
        }
        return { written };
      },
    });
  },

  async readAll(query = {}) {
    return guard<WhatsOnListingSnapshot>({
      context: "readAll",
      onSchemaMiss: async () => ({
        ...(await memoryWhatsOnListingStore.readAll(query)),
        failed: true as const,
        failure: "durable table missing (apply migration 0119)",
      }),
      message: "readAll failed - returning empty",
      onError: (error) => ({
        rows: [],
        generatedAt: null,
        failed: true as const,
        failure: errorMessage(error),
      }),
      run: async () => {
        const [listings, generatedAt] = await Promise.all([
          readListingRows(query),
          readDurableGeneratedAt(),
        ]);
        const parsed: WhatsOnRow[] = [];
        for (const row of listings) {
          if (!isWhatsOnKind(row.kind)) continue;
          const next = fromRow(row);
          if (next && matchesQuery(next, query)) parsed.push(next);
        }
        return { rows: parsed, generatedAt };
      },
    });
  },

  async readGeneratedAt() {
    return guard<WhatsOnListingGeneration>({
      context: "readGeneratedAt",
      onSchemaMiss: async () => ({
        ...(await memoryWhatsOnListingStore.readGeneratedAt()),
        failed: true as const,
        failure: "durable table missing (apply migration 0119)",
      }),
      message: "readGeneratedAt failed - returning empty",
      onError: (error) => ({
        generatedAt: null,
        failed: true as const,
        failure: errorMessage(error),
      }),
      run: async () => ({ generatedAt: await readDurableGeneratedAt() }),
    });
  },
};

async function readDurableGeneratedAt(): Promise<string | null> {
  const { data, error } = await requireSupabaseAdmin()
    .from(GENERATIONS_TABLE)
    .select("kind, generated_at");
  if (error) throw new Error(error.message);
  return oldestStamp(
    ((data ?? []) as GenerationRow[])
      .filter((row) => isWhatsOnKind(row.kind) && typeof row.generated_at === "string")
      .map((row) => row.generated_at),
  );
}

async function readListingRows(query: WhatsOnListingQuery): Promise<ListingRow[]> {
  const reads: Promise<ListingRow[]>[] = [];
  if (query.kind !== "sport") {
    reads.push(readListingPages((select) =>
      query.kind ? select.eq("kind", query.kind) : select.neq("kind", "sport"),
    ));
  }
  if (!query.kind || query.kind === "sport") {
    reads.push(readListingPages((select) => {
      let sport = select.eq("kind", "sport");
      if (query.sportStartsFrom !== undefined) {
        sport = sport.gte(
          "payload->>startsAt",
          new Date(query.sportStartsFrom - SPORT_TEXT_BOUND_SLACK_MS).toISOString(),
        );
      }
      if (query.sportStartsBefore !== undefined) {
        sport = sport.lt(
          "payload->>startsAt",
          new Date(query.sportStartsBefore + SPORT_TEXT_BOUND_SLACK_MS).toISOString(),
        );
      }
      return sport;
    }));
  }
  return (await Promise.all(reads)).flat();
}

type ListingSelect = ReturnType<ReturnType<ReturnType<typeof requireSupabaseAdmin>["from"]>["select"]>;

async function readListingPages(
  narrow: (select: ListingSelect) => ListingSelect,
): Promise<ListingRow[]> {
  const listings: ListingRow[] = [];
  for (let offset = 0; ; offset += READ_PAGE_ROWS) {
    // The refresh pipeline writes only London rows today, but the filter is
    // the contract: a durable answer is a London answer, so a future second
    // city cannot leak into every city's read.
    const { data, error } = await narrow(
      requireSupabaseAdmin().from(TABLE).select("*").eq("city", "london"),
    )
      .order("id", { ascending: true })
      .range(offset, offset + READ_PAGE_ROWS - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as ListingRow[];
    listings.push(...page);
    if (page.length < READ_PAGE_ROWS) return listings;
  }
}

const unavailableProductionWhatsOnListingStore: WhatsOnListingStore = {
  async replaceKind() {
    return { written: 0, failed: true };
  },
  async readAll() {
    return { rows: [], generatedAt: null, failed: true };
  },
  async readGeneratedAt() {
    return { generatedAt: null, failed: true };
  },
};

// The unavailable store answers where selectStore would throw, and ONLY there:
// requiresSupabaseStore() is the one policy, so Playwright's keyless production
// server (PUBMAX_E2E_KEYLESS=1) reads memory plus the bundled files like every
// other store. Asking isDeployedProduction() directly skipped that escape, and
// every keyless /tonight read answered "Could not check listings."
export function whatsOnListingStore(): WhatsOnListingStore {
  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return unavailableProductionWhatsOnListingStore;
  }
  return selectStore(memoryWhatsOnListingStore, supabaseWhatsOnListingStore);
}

export function __resetWhatsOnListingStore(): void {
  memoryKinds.clear();
  resetSchemaMissWarnings();
}
