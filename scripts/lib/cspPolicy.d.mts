// Type surface for scripts/lib/cspPolicy.mjs (allowJs is off in tsconfig).
// Keep in lockstep with the .mjs exports.

export declare const BASE_DIRECTIVES: readonly string[];
export declare function buildCsp(scriptSrc: string): string;
export declare function buildMetaCsp(scriptSrc: string): string;
export declare const FRAME_ANCESTORS_HEADER_CSP: string;
export declare const DYNAMIC_CSP_PREFIXES: readonly string[];
