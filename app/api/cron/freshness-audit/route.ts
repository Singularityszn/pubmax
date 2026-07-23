// GET /api/cron/freshness-audit — daily freshness audit ping.
//
// Reads the freshness spine (data/freshness_registry.json resolved against each
// artifact's on-disk stamp, PLUS the store-backed honest observedAt overlay for
// cron-plane feeds), then logs every stale/unknown feed. Console-only alerting
// today via lib/freshnessNotify — a deliberate seam so a later push/alert
// integration (Sol's push lane) hangs off ONE place. This route sends NO pushes.
//
// AUTH: CRON_SECRET Bearer. Never 500s on a bad artifact — a broken file surfaces
// as that dataset's own "unknown" status, exactly like /api/freshness.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import {
  evaluateDataset,
  hasBreach,
  resolveObservedAt,
  type FreshnessDataset,
  type FreshnessRegistry,
  type FreshnessResult,
} from "@/lib/freshness";
import { resolveStoreObservedAt } from "@/lib/freshnessStoreOverlay";
import { notifyStaleFeeds } from "@/lib/freshnessNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function readArtifact(rootDir: string, relPath: string | null): unknown {
  if (!relPath) return undefined;
  const abs = join(rootDir, relPath);
  if (!existsSync(abs)) return undefined;
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch {
    return undefined;
  }
}

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  const rootDir = process.cwd();
  let registry: FreshnessRegistry;
  try {
    registry = JSON.parse(
      readFileSync(join(rootDir, "data", "freshness_registry.json"), "utf8"),
    ) as FreshnessRegistry;
  } catch (err) {
    console.error("[cron:freshness-audit] registry unavailable:", err instanceof Error ? err.message : String(err));
    return jsonNoStore({ ok: false, error: "registry unavailable", stale: [] }, { status: 200 });
  }

  // Store-backed feeds report their durable observedAt; everything else keeps its
  // disk-derived stamp.
  const overlay = await resolveStoreObservedAt();
  const now = new Date();
  const results: FreshnessResult[] = registry.datasets.map((dataset: FreshnessDataset) => {
    const observedAt = overlay[dataset.id] ?? resolveObservedAt(dataset.stamp, readArtifact(rootDir, dataset.artifact));
    return evaluateDataset(dataset, observedAt, now);
  });

  const stale = results.filter((r) => r.status === "stale" || r.status === "unknown");
  const notices = notifyStaleFeeds(stale);

  return jsonNoStore({
    ok: true,
    generatedAt: now.toISOString(),
    breach: hasBreach(results),
    counts: results.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {}),
    stale: notices,
  });
}
