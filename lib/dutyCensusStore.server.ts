import "server-only";

import { dropWithdrawnAuthors } from "@/lib/accountPublicAccess.server";
import type { Provenance } from "@/lib/curation";
import {
  countsTowardDutyCensus,
  DUTY_CENSUS_RISES_AT,
  DUTY_CENSUS_STARTS_AT,
  type DutyCensusDrop,
} from "@/lib/dutyCensus";
import { listAllStoredPintDrops, type PintDropStatus } from "@/lib/pintDrops";
import { cleanVisibility } from "@/lib/pintDropShared";
import { PINT_DROPS_TABLE } from "@/lib/pintDropTable";
import { admin, selectStore } from "@/lib/storeBackend";

// How many Pint Drops count toward the duty census (lib/dutyCensus.ts). Its
// own small store, so the home's prerender and the census route never load
// the Pint Drop store's photo pipeline for one figure.

type DutyCensusStore = {
  /** Counted drops, with withdrawn authors removed as every public read removes them. */
  count(): Promise<number>;
};

// PostgREST answers at most 1000 rows a request, so the Supabase read pages.
const PAGE_ROWS = 1000;

async function withoutWithdrawnAuthors(handles: string[]): Promise<number> {
  return (await dropWithdrawnAuthors(handles, (handle) => handle)).length;
}

const memoryDutyCensusStore: DutyCensusStore = {
  async count() {
    const counted = listAllStoredPintDrops().filter(countsTowardDutyCensus);
    return withoutWithdrawnAuthors(counted.map((drop) => drop.handle));
  },
};

export const supabaseDutyCensusStore: DutyCensusStore = {
  async count() {
    const handles: string[] = [];
    for (let offset = 0; ; offset += PAGE_ROWS) {
      // The query narrows the read; countsTowardDutyCensus stays the rule.
      const { data, error } = await admin()
        .from(PINT_DROPS_TABLE)
        .select("id, handle, status, visibility, price_gbp, provenance, created_at")
        .eq("status", "visible")
        .in("visibility", ["public", "anonymous"])
        .not("price_gbp", "is", null)
        .gte("created_at", DUTY_CENSUS_STARTS_AT)
        .lt("created_at", DUTY_CENSUS_RISES_AT)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_ROWS - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as Record<string, unknown>[];
      for (const row of page) {
        const drop: DutyCensusDrop = {
          status: row.status as PintDropStatus,
          visibility: cleanVisibility(row.visibility),
          priceGbp: row.price_gbp === null || row.price_gbp === undefined ? null : Number(row.price_gbp),
          provenance: row.provenance as Provenance,
          createdAt: String(row.created_at),
        };
        if (countsTowardDutyCensus(drop)) handles.push(String(row.handle));
      }
      if (page.length < PAGE_ROWS) break;
    }
    return withoutWithdrawnAuthors(handles);
  },
};

export function dutyCensusStore(): DutyCensusStore {
  return selectStore(memoryDutyCensusStore, supabaseDutyCensusStore);
}
