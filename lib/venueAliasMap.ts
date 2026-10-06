// The venue-id alias maps, read in the browser.
//
// lib/venueAliases.ts resolves a stored id on the server. A reference the
// browser stored itself (a localStorage save) never reaches that seam, so the
// client reads the same public alias artifacts here and resolves its own
// ids through them. Read once per page; a failed read answers as the identity
// and is retried by the next caller.

import { discardBody } from "@/lib/responseBody";
import { VENUE_ALIAS_FILES } from "@/lib/venueAliasesFile.mjs";

/** The alias artifacts as the browser reads them. */
export type VenueAliasMaps = {
  /** `oldId -> currentId` across every alias artifact. */
  aliases: ReadonlyMap<string, string>;
  /** The name of each pub that left the map with no successor, by its last id. */
  retiredNames: ReadonlyMap<string, string>;
};

let pending: Promise<VenueAliasMaps> | null = null;

type AliasFileEntries = { aliases: Array<[string, string]>; retired: Array<[string, string]> };

async function readAliasFile(file: string): Promise<AliasFileEntries> {
  const response = await fetch(`/${file.replace(/^public\//, "")}`);
  if (!response.ok) {
    discardBody(response);
    throw new Error(`${file} answered ${response.status}`);
  }
  const doc = (await response.json()) as {
    aliases?: Record<string, unknown>;
    retired?: Record<string, unknown>;
  };
  return {
    aliases: Object.entries(doc.aliases ?? {}).flatMap(([from, to]) =>
      typeof to === "string" && to && from !== to ? [[from, to] as [string, string]] : [],
    ),
    retired: Object.entries(doc.retired ?? {}).flatMap(([id, record]) => {
      const name = (record as { name?: unknown } | null)?.name;
      return typeof name === "string" && name ? [[id, name] as [string, string]] : [];
    }),
  };
}

/** Every alias artifact, or empty maps when they could not be read. */
export function loadVenueAliasMaps(): Promise<VenueAliasMaps> {
  pending ??= Promise.all(VENUE_ALIAS_FILES.map(readAliasFile))
    .then((files) => ({
      aliases: new Map(files.flatMap((file) => file.aliases)),
      retiredNames: new Map(files.flatMap((file) => file.retired)),
    }))
    .catch(() => {
      pending = null;
      return { aliases: new Map<string, string>(), retiredNames: new Map<string, string>() };
    });
  return pending;
}

/** `oldId -> currentId` across every alias artifact, or an empty map when it could not be read. */
export async function loadVenueAliasMap(): Promise<ReadonlyMap<string, string>> {
  return (await loadVenueAliasMaps()).aliases;
}
