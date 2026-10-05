// THE ROUTER CACHE FENCE, WRITTEN DOWN ONCE.
//
// experimental.staleTimes in next.config.mjs lets the client router reuse a
// server payload it already holds. That is only safe while two invariants hold,
// and these lint rules hold them over the tree:
//
//   1. NO page server-renders per-account content. A page reads the request's
//      credential either directly (cookies(), draftMode()) or by handing its
//      header list to a credential gate module. A held payload from such a page
//      names the previous account to the next one on the device.
//   2. NOTHING expects a server surface to change after a mutation. A
//      router.refresh() call means a server surface has started carrying
//      mutable state that a held payload would hide.
//
// Break either and the window must be re-derived in the same commit.
//
// Plain ESM with a `.d.mts` sidecar (the lib/agentToolingPaths.mjs idiom),
// because eslint.config.mjs cannot import TypeScript and
// __tests__/clientRouterCache.test.ts reads the same exception list.

/**
 * Modules that answer a question about the CALLER's credential. A server page
 * importing one renders per-session content even when it never names
 * cookies() itself. app/admin/page.tsx hands headers() to lib/adminAuth.
 */
const REQUEST_CREDENTIAL_MODULES = ["@/lib/adminAuth"];

/**
 * The argued exceptions, each with the reason a held payload cannot hurt it.
 * This list may only shrink. A new entry means the staleTimes window has to be
 * re-derived in the same commit, or the entry has to argue why it need not be.
 */
export const PER_SESSION_SERVER_PAGES = Object.freeze({
  "app/admin/page.tsx":
    "Nothing in the app links to /admin, so the client router cache never holds it: the only ways in are a typed URL and AdminTokenForm's window.location.reload, both full document loads. The console shell it renders carries no data, and every /api/admin read re-gates on the same credential.",
  "app/login/page.tsx":
    "The page reads only whether the HttpOnly resume cookie exists, and sends one boolean that holds the email door behind the skeleton until the live session answers. It renders no account content. A held payload with a stale hint only shows the skeleton until the session answers, or shows the door a moment before the signed-in card replaces it.",
});

const PAGE_CREDENTIAL_IMPORTS = {
  paths: [
    {
      name: "next/headers",
      importNames: ["cookies", "draftMode"],
      message:
        "A server page that reads the request's credential renders one account's page, and the router cache hands it to the next account. Move the read to an /api route, or argue an exception in lib/routerCacheFence.mjs and re-derive staleTimes.",
    },
    ...REQUEST_CREDENTIAL_MODULES.map((name) => ({
      name,
      message:
        "This module answers a question about the caller's credential. A server page that imports it renders per-session content the router cache would hand to the next account. See lib/routerCacheFence.mjs.",
    })),
  ],
};

const ROUTER_REFRESH = {
  selector: "CallExpression[callee.object.name='router'][callee.property.name='refresh']",
  message:
    "router.refresh() means a server surface carries mutable state, and the staleTimes window in next.config.mjs would hide the write. Give the surface its own /api read, or re-derive the window in the same commit.",
};

/** Flat-config blocks for eslint.config.mjs. */
export const ROUTER_CACHE_FENCE_CONFIG = Object.freeze([
  {
    files: ["app/**/*.{ts,tsx}"],
    ignores: ["app/api/**", ...Object.keys(PER_SESSION_SERVER_PAGES)],
    rules: { "no-restricted-imports": ["error", PAGE_CREDENTIAL_IMPORTS] },
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: ["app/api/**"],
    rules: { "no-restricted-syntax": ["error", ROUTER_REFRESH] },
  },
]);
