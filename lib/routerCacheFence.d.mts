import type { Linter } from "eslint";

export declare const PER_SESSION_SERVER_PAGES: Readonly<
  Record<string, { readonly door: string; readonly reason: string }>
>;
export declare const ROUTER_CACHE_FENCE_CONFIG: readonly Linter.Config[];
