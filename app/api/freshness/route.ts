// GET /api/freshness
//
// Read-only view of the freshness spine: the machine-readable registry
// (data/freshness_registry.json) resolved against every artifact's real
// observed/generated stamp. This is the one honest, uniform answer to "how live
// is every data class?" — the site can render staleness anywhere from it (the
// lib/dataFreshness idioms already turn observed instants into human labels;
// this feeds them the same way for every dataset at once).
//
// Never 500s: a missing/broken artifact surfaces as that dataset's own
// "unknown" status, not a route failure. Cacheable at the edge — the registry +
// stamps only move when a refresh PR merges.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  evaluateRegistry,
  resolveObservedAt,
  type FreshnessDataset,
  type FreshnessRegistry,
} from "@/lib/freshness";
import { resolveStoreObservedAt } from "@/lib/freshnessStoreOverlay";

export const runtime = "nodejs";

const CACHE_MAX_AGE_S = 300;
const CACHE_STALE_WHILE_REVALIDATE_S = 1800;

function jsonResponse(body: unknown, opts: { status?: number; cache?: boolean } = {}): Response {
  const { status = 200, cache = false } = opts;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache
        ? `public, s-maxage=${CACHE_MAX_AGE_S}, stale-while-revalidate=${CACHE_STALE_WHILE_REVALIDATE_S}`
        : "no-store",
    },
  });
}

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

export async function GET(): Promise<Response> {
  const rootDir = process.cwd();
  let registry: FreshnessRegistry;
  try {
    registry = JSON.parse(
      readFileSync(join(rootDir, "data", "freshness_registry.json"), "utf8"),
    ) as FreshnessRegistry;
  } catch (e) {
    return jsonResponse(
      { error: "registry unavailable", detail: (e as Error).message, datasets: [] },
      { status: 200 },
    );
  }

  const now = new Date();
  // Cron-plane feeds report their durable store observedAt (the committed file is
  // read-only on serverless and would report a frozen stamp); every other feed
  // keeps its disk-derived stamp. Fail-soft: no store configured → empty overlay.
  const overlay = await resolveStoreObservedAt();
  const stampFor = (dataset: FreshnessDataset): string | null =>
    overlay[dataset.id] ?? resolveObservedAt(dataset.stamp, readArtifact(rootDir, dataset.artifact));
  const results = evaluateRegistry(registry, stampFor, now);

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return jsonResponse(
    {
      version: registry.version,
      generatedAt: now.toISOString(),
      summary,
      datasets: results,
    },
    { cache: true },
  );
}
