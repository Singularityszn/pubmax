// Server-only allowlist of image hosts the /api/image-proxy may fetch (U4).
//
// The proxy exists because scraped-pub photos live on ~160 pub-website hosts —
// but "open-ended for the CSP" must not mean "open-ended for the proxy": a
// public proxy that fetches arbitrary hostnames is an SSRF primitive (a
// hostname the attacker controls can resolve to internal addresses; blocking
// IP literals alone doesn't help). So the proxy only fetches hosts that
// actually appear in the app's OWN committed datasets — the attacker can't
// influence that set without a reviewed PR.
//
// Built lazily once per process from the same data files the UI reads.

import fs from "node:fs";
import path from "node:path";

const DATA_FILES = [
  "public/data/venue_menu_enrichment.json",
  "public/data/pubmaxxing_seed_snapshot.json",
];

let cached: Set<string> | null = null;

export function allowedVenueImageHosts(): Set<string> {
  if (cached) return cached;
  const hosts = new Set<string>();
  for (const rel of DATA_FILES) {
    try {
      const raw = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      // Hostname extraction over the raw JSON is deliberate: every https URL
      // in these files is app-served content, and this avoids hardcoding each
      // file's shape here.
      for (const match of raw.matchAll(/https:\/\/([a-z0-9][a-z0-9.-]*)/gi)) {
        hosts.add(match[1].toLowerCase());
      }
    } catch {
      // A missing data file just contributes no hosts — fail closed.
    }
  }
  cached = hosts;
  return hosts;
}

/** Test-only: reset the memoised host set. */
export function __resetVenueImageHosts(): void {
  cached = null;
}
