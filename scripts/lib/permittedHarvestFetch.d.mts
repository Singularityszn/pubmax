// Hand-maintained declarations for permittedHarvestFetch.mjs, so the server
// refresher in lib/whatsOnRefresh.server.ts type-checks under the repo's
// allowJs:false tsconfig. Keep in sync with the runtime module.

import type { HarvestSource } from "../../lib/harvest/sourcePolicy.ts";

export declare class HarvestRefusal extends Error {
  constructor(message: string);
}

export declare function permittedHarvestSource(sourceId: string):
  | { allowed: true; source: HarvestSource; message: string }
  | { allowed: false; source: HarvestSource | null; message: string };

export declare function isOnPermittedSourceHost(source: HarvestSource, url: string): boolean;

type PermittedFetch = ((url: string, init?: RequestInit) => Promise<Response>) & {
  assertPermitted(url: string): Promise<void>;
};

export declare function createPermittedFetch(options: {
  source: HarvestSource;
  fetchImpl?: typeof fetch;
  robots?: (url: string) => Promise<{ allowed: boolean; evidence: string }>;
}): PermittedFetch;
