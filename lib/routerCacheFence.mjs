// THE ROUTER CACHE FENCE, WRITTEN DOWN ONCE.
//
// experimental.staleTimes in next.config.mjs lets the client router reuse a
// server payload it already holds. That is only safe while two invariants hold,
// and these lint rules hold them over the tree:
//
//   1. NO page server-renders per-account content. A page reads the request's
//      credential either directly (cookies(), draftMode(), the Authorization or
//      Cookie header) or by handing its header list to a credential gate
//      module. A held payload from such a page names the previous account to
//      the next one on the device.
//   2. NOTHING expects a server surface to change after a mutation. A
//      router.refresh() call means a server surface has started carrying
//      mutable state that a held payload would hide.
//
// Break either and the window must be re-derived in the same commit.
//
// Plain ESM with a `.d.mts` sidecar (the lib/agentToolingPaths.mjs idiom),
// because eslint.config.mjs cannot import TypeScript and
// __tests__/clientRouterCache.test.ts reads the same exception list.

import path from "node:path";

/**
 * Modules that answer a question about the CALLER's credential. A server page
 * importing one renders per-session content even when it never names
 * cookies() itself. app/admin/page.tsx hands headers() to lib/adminAuth.
 */
const REQUEST_CREDENTIAL_MODULES = ["@/lib/adminAuth"];

/** The next/headers exports that read the request's credential. */
const CREDENTIAL_HEADER_EXPORTS = ["cookies", "draftMode"];

/** Request headers that carry the caller's credential. */
const CREDENTIAL_HEADER = /^(authorization|cookie)$/i;

/**
 * The argued exceptions, each with the reason a held payload cannot hurt it.
 * This list may only shrink: lint reports an entry whose page no longer reads
 * the credential as a stale exception. A new entry means the staleTimes window
 * has to be re-derived in the same commit, or the entry has to argue why it
 * need not be.
 */
export const PER_SESSION_SERVER_PAGES = Object.freeze({
  "app/admin/page.tsx":
    "Nothing in the app links to /admin, so the client router cache never holds it: the only ways in are a typed URL and AdminTokenForm's window.location.reload, both full document loads. The console shell it renders carries no data, and every /api/admin read re-gates on the same credential.",
  "app/login/page.tsx":
    "The page reads only whether the HttpOnly resume cookie exists, and sends one boolean that holds the email door behind the skeleton until the live session answers. It renders no account content. A held payload with a stale hint only shows the skeleton until the session answers, or shows the door a moment before the signed-in card replaces it.",
  "app/p/[id]/page.tsx":
    "The Authorization header resolves the friends-gated Pint Drop viewer, and a browser navigation or RSC fetch never sends that header, so a payload the router cache holds is always the anonymous render.",
  "app/ledger/[id]/page.tsx":
    "The Authorization header resolves the friends-gated Pint Drop viewer, and a browser navigation or RSC fetch never sends that header, so a payload the router cache holds is always the anonymous render.",
});

function isArguedException(context) {
  const file = path.relative(context.cwd, context.filename).split(path.sep).join("/");
  return Object.hasOwn(PER_SESSION_SERVER_PAGES, file);
}

/** A visitor that calls `onRead` at every place a file reads the request's credential. */
function credentialReads(onRead) {
  return {
    ImportDeclaration(node) {
      const source = node.source.value;
      if (REQUEST_CREDENTIAL_MODULES.includes(source)) {
        onRead(node, `the credential gate ${source}`);
        return;
      }
      if (source !== "next/headers") return;
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportNamespaceSpecifier") {
          onRead(specifier, "the whole of next/headers");
        } else if (CREDENTIAL_HEADER_EXPORTS.includes(specifier.imported.name)) {
          onRead(specifier, `${specifier.imported.name}()`);
        }
      }
    },
    CallExpression(node) {
      const { callee } = node;
      const [name] = node.arguments;
      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.property.name === "get" &&
        name?.type === "Literal" &&
        typeof name.value === "string" &&
        CREDENTIAL_HEADER.test(name.value)
      ) {
        onRead(node, `the ${name.value} header`);
      }
    },
  };
}

const credentialRead = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      read: "A server page that reads {{read}} renders one account's page, and the router cache hands it to the next account. Move the read to an /api route, or argue an exception in lib/routerCacheFence.mjs and re-derive staleTimes.",
    },
  },
  create(context) {
    if (isArguedException(context)) return {};
    return credentialReads((node, read) =>
      context.report({ node, messageId: "read", data: { read } }),
    );
  },
};

const staleException = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      stale:
        "This page is an argued exception in lib/routerCacheFence.mjs but no longer reads the request's credential. Delete its entry: the list may only shrink.",
    },
  },
  create(context) {
    if (!isArguedException(context)) return {};
    let reads = 0;
    return {
      ...credentialReads(() => {
        reads += 1;
      }),
      "Program:exit"(node) {
        if (reads === 0) context.report({ node, messageId: "stale" });
      },
    };
  },
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
    ignores: ["app/api/**"],
    plugins: {
      "router-cache": {
        rules: { "credential-read": credentialRead, "stale-exception": staleException },
      },
    },
    rules: {
      "router-cache/credential-read": "error",
      "router-cache/stale-exception": "error",
    },
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: ["app/api/**"],
    rules: { "no-restricted-syntax": ["error", ROUTER_REFRESH] },
  },
]);
