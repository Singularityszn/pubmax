// The venue-id alias maps, read in the browser.
//
// lib/venueAliases.ts resolves a stored id on the server. A reference the
// browser stored itself (a localStorage save) never reaches that seam, so the
// client reads the same public alias artifacts here and resolves its own
// ids through them. Read once per page; a failed read answers as the identity
// and is retried by the next caller.

import { discardBody } from "@/lib/responseBody";
import { VENUE_ALIAS_FILES } from "@/lib/venueAliasesFile.mjs";

let pending: Promise<ReadonlyMap<string, string>> | null = null;

async function readAliasFile(file: string): Promise<Array<[string, string]>> {
  const response = await fetch(`/${file.replace(/^public\//, "")}`);
  if (!response.ok) {
    discardBody(response);
    throw new Error(`${file} answered ${response.status}`);
  }
  const aliases = ((await response.json()) as { aliases?: Record<string, unknown> }).aliases ?? {};
  return Object.entries(aliases).flatMap(([from, to]) =>
    typeof to === "string" && to && from !== to ? [[from, to] as [string, string]] : [],
  );
}

/** `oldId -> currentId` across every alias artifact, or an empty map when it could not be read. */
export function loadVenueAliasMap(): Promise<ReadonlyMap<string, string>> {
  pending ??= Promise.all(VENUE_ALIAS_FILES.map(readAliasFile))
    .then((files) => new Map(files.flat()))
    .catch(() => {
      pending = null;
      return new Map<string, string>();
    });
  return pending;
}
