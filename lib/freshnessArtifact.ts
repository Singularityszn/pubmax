// The one disk read behind the freshness spine, shared by /api/freshness and the
// freshness-audit cron so both routes answer identically.
//
// It reports WHAT it found, not just the JSON: a path that is not there and a
// path that is there but unparseable are different defects, and the audit is
// only actionable if it can say which. That distinction is the whole reason this
// module exists — the old inline reader collapsed both to `undefined`, so every
// feed produced the same unactionable "none could be resolved" line.
//
// A note on why a file can be missing at runtime at all: these paths come from
// data/freshness_registry.json and are joined to process.cwd() at request time,
// so Next's file tracing cannot see them. They are declared explicitly in
// next.config.mjs `outputFileTracingIncludes` for both routes; without that, the
// artifacts only reach a function by accident of Vercel's lambda grouping.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  resolveStamp,
  stampNeedsArtifact,
  type ArtifactRead,
  type FreshnessDataset,
  type StampResolution,
} from "@/lib/freshness";

export function readFreshnessArtifact(rootDir: string, relPath: string | null): ArtifactRead {
  if (!relPath) return { kind: "absent" };
  const abs = join(/* turbopackIgnore: true */ rootDir, relPath);
  if (!existsSync(/* turbopackIgnore: true */ abs)) {
    return { kind: "missing", path: relPath };
  }
  try {
    return {
      kind: "ok",
      path: relPath,
      json: JSON.parse(
        readFileSync(/* turbopackIgnore: true */ abs, "utf8"),
      ),
    };
  } catch (err) {
    return {
      kind: "unreadable",
      path: relPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The one way a route turns a dataset into its stamp. Only a field stamp lives
 * inside the artifact, so only a field stamp opens one: a literal stamp is
 * answered from the registry and an unstamped dataset is never dated, and
 * parsing multi-megabyte JSON to discard it would cost every request for
 * nothing. Both freshness readers go through here so neither can drift.
 */
function emptyArrayArtifactReason(read: ArtifactRead): string | null {
  if (read.kind === "ok" && Array.isArray(read.json) && read.json.length === 0) {
    return `Artifact ${read.path} is empty (0 rows).`;
  }
  return null;
}

export function resolveDatasetStamp(
  rootDir: string,
  dataset: Pick<FreshnessDataset, "stamp" | "artifact">,
  read: (rootDir: string, relPath: string | null) => ArtifactRead = readFreshnessArtifact,
): StampResolution {
  if (!stampNeedsArtifact(dataset.stamp)) {
    const artifactRead = read(rootDir, dataset.artifact);
    const emptyReason = emptyArrayArtifactReason(artifactRead);
    if (emptyReason) return { observedAt: null, reason: emptyReason };
    return resolveStamp(dataset.stamp, { kind: "absent" });
  }
  const artifactRead = read(rootDir, dataset.artifact);
  const emptyReason = emptyArrayArtifactReason(artifactRead);
  if (emptyReason) return { observedAt: null, reason: emptyReason };
  return resolveStamp(dataset.stamp, artifactRead);
}
