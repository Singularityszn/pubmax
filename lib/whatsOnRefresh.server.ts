import "server-only";

// Official-API What's-On refresh for the Vercel cron. Ticketmaster and Skiddle
// already run inside a function (lib/events/liveProvider.ts, 8s timeout, 100-row
// cap). This module asks them for the Out window (today through the later of
// tomorrow and this weekend), drops expired rows, and writes the event kind to
// the durable store. Harvested quiz/deal/music/sport files stay bundled: those
// scrapes cannot run inside a serverless function.
//
// A provider that is not configured, or that throws, does not wipe the store.
// replaceKind("event") runs only after at least one configured provider answers.

import { createSkiddleProvider } from "@/lib/events/skiddle";
import { createTicketmasterProvider } from "@/lib/events/ticketmaster";
import { outDayWindow, type OutLiveProvider } from "@/lib/out/loadOut";
import { dedupeRows, filterNotPast, type WhatsOnRow } from "@/lib/whatsOn";
import {
  whatsOnListingStore,
  type WhatsOnListingStore,
} from "@/lib/whatsOnListingStore";

export type OfficialWhatsOnProviderReport = {
  name: string;
  configured: boolean;
  rows: number;
  error?: string;
};

export type OfficialWhatsOnRefreshResult = {
  ok: boolean;
  mode: "providers" | "no-providers";
  written: number;
  observedAt: string | null;
  providers: OfficialWhatsOnProviderReport[];
};

export type RefreshOfficialWhatsOnListingsOpts = {
  now?: number;
  store?: WhatsOnListingStore;
  providers?: OutLiveProvider[];
};

function officialRefreshWindow(now: number): { startMs: number; endMs: number } {
  const today = outDayWindow("today", now);
  const tomorrow = outDayWindow("tomorrow", now);
  const weekend = outDayWindow("weekend", now);
  return {
    startMs: today.startMs,
    endMs: Math.max(tomorrow.endMs, weekend.endMs),
  };
}

function defaultProviders(): OutLiveProvider[] {
  return [createTicketmasterProvider(), createSkiddleProvider()];
}

export async function refreshOfficialWhatsOnListings(
  opts: RefreshOfficialWhatsOnListingsOpts = {},
): Promise<OfficialWhatsOnRefreshResult> {
  const now = opts.now ?? Date.now();
  const store = opts.store ?? whatsOnListingStore();
  const providers = opts.providers ?? defaultProviders();
  const window = officialRefreshWindow(now);

  const settled = await Promise.all(
    providers.map(
      async (
        provider,
      ): Promise<{ report: OfficialWhatsOnProviderReport; rows: WhatsOnRow[] }> => {
        if (!provider.isConfigured()) {
          return {
            report: { name: provider.name, configured: false, rows: 0 },
            rows: [],
          };
        }
        try {
          const raw = await provider.fetchTonight({ now, city: "london", window });
          const kept = filterNotPast(raw, now).filter((row) => row.kind === "event");
          return {
            report: { name: provider.name, configured: true, rows: kept.length },
            rows: kept,
          };
        } catch (err) {
          return {
            report: {
              name: provider.name,
              configured: true,
              rows: 0,
              error: err instanceof Error ? err.message : String(err),
            },
            rows: [],
          };
        }
      },
    ),
  );

  const reports = settled.map((entry) => entry.report);
  const anyConfigured = reports.some((report) => report.configured);
  if (!anyConfigured) {
    return {
      ok: false,
      mode: "no-providers",
      written: 0,
      observedAt: null,
      providers: reports,
    };
  }

  const anySuccess = settled.some(
    (entry) => entry.report.configured && entry.report.error === undefined,
  );
  if (!anySuccess) {
    return {
      ok: false,
      mode: "providers",
      written: 0,
      observedAt: null,
      providers: reports,
    };
  }

  const rows = dedupeRows(settled.flatMap((entry) => entry.rows));
  const generatedAt = new Date(now).toISOString();
  const outcome = await store.replaceKind("event", rows, generatedAt);
  if (outcome.failed) {
    return {
      ok: false,
      mode: "providers",
      written: 0,
      observedAt: null,
      providers: reports,
    };
  }

  return {
    ok: true,
    mode: "providers",
    written: outcome.written,
    observedAt: generatedAt,
    providers: reports,
  };
}
