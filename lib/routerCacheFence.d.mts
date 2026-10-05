import type { Linter } from "eslint";

export type ArguedException = { readonly doors: readonly string[]; readonly reason: string };

export declare const PER_SESSION_SERVER_PAGES: Readonly<Record<string, ArguedException>>;
export declare function missingExceptionPages(
  pages?: Readonly<Record<string, ArguedException>>,
  root?: string,
): string[];
export declare const ROUTER_CACHE_FENCE_CONFIG: readonly Linter.Config[];
