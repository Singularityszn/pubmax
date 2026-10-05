// THE ROUTER CACHE FENCE, WRITTEN DOWN ONCE.
//
// experimental.staleTimes in next.config.mjs lets the client router reuse a
// server payload it already holds. That is only safe while two invariants hold,
// and these lint rules hold them over the tree:
//
//   1. NO page server-renders per-account content. A page reads the request's
//      credential either directly (cookies(), draftMode(), the Authorization or
//      Cookie header) or through a module that does, however many imports
//      away. A held payload from such a page names the previous account to the
//      next one on the device.
//   2. NOTHING expects a server surface to change after a mutation. A
//      refresh() on the next/navigation router means a server surface has
//      started carrying mutable state that a held payload would hide.
//
// Break either and the window must be re-derived in the same commit.
//
// Plain ESM with a `.d.mts` sidecar (the lib/agentToolingPaths.mjs idiom),
// because eslint.config.mjs cannot import TypeScript and
// __tests__/clientRouterCache.test.ts reads the same exception list.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "@typescript-eslint/parser";

/** The repository root: this module lives in its lib/ directory. */
const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The next/headers exports that read the request's credential. */
const CREDENTIAL_HEADER_EXPORTS = ["cookies", "draftMode"];

/** Request headers that carry the caller's credential. */
const CREDENTIAL_HEADER = /^(authorization|cookie)$/i;

/**
 * The argued exceptions. Each names the credential doors its page may read,
 * directly or through any module it imports, and the reason a held payload
 * cannot hurt it; any other door in the same file is still refused. This list
 * may only shrink: lint reports an entry whose page no longer reads one of its
 * doors as a stale exception, and lint refuses to load while an entry names a
 * page that is gone. A new entry means the staleTimes window has to be
 * re-derived in the same commit, or the entry has to argue why
 * it need not be.
 */
export const PER_SESSION_SERVER_PAGES = Object.freeze({
  "app/admin/page.tsx": {
    doors: ["the Cookie header"],
    reason:
      "Nothing in the app links to /admin, so the client router cache never holds it: the only ways in are a typed URL and AdminTokenForm's window.location.reload, both full document loads. The console shell it renders carries no data, and every /api/admin read re-gates on the same credential.",
  },
  "app/login/page.tsx": {
    doors: ["cookies()"],
    reason:
      "The page reads only whether the HttpOnly resume cookie exists, and sends one boolean that holds the email door behind the skeleton until the live session answers. It renders no account content. A held payload with a stale hint only shows the skeleton until the session answers, or shows the door a moment before the signed-in card replaces it.",
  },
  "app/p/[id]/page.tsx": {
    doors: ["the Authorization header"],
    reason:
      "The Authorization header resolves the friends-gated Pint Drop viewer, and a browser navigation or RSC fetch never sends that header, so a payload the router cache holds is always the anonymous render.",
  },
  "app/ledger/[id]/page.tsx": {
    doors: ["the Authorization header"],
    reason:
      "The Authorization header resolves the friends-gated Pint Drop viewer, and a browser navigation or RSC fetch never sends that header, so a payload the router cache holds is always the anonymous render.",
  },
});

/** The exception entries whose page is no longer in the tree. */
export function missingExceptionPages(pages = PER_SESSION_SERVER_PAGES, root = REPOSITORY_ROOT) {
  return Object.keys(pages).filter((file) => !existsSync(path.join(root, file)));
}

function repositoryPath(file) {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

/** The doors the file's argued exception names; empty outside the list. */
function arguedDoors(context) {
  const file = repositoryPath(context.filename);
  return Object.hasOwn(PER_SESSION_SERVER_PAGES, file) ? PER_SESSION_SERVER_PAGES[file].doors : [];
}

function headerDoor(name) {
  const lower = name.toLowerCase();
  return `the ${lower[0].toUpperCase()}${lower.slice(1)} header`;
}

/** Every AST node under `node`, parents first. */
function* walk(node) {
  yield node;
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || key === "tokens" || key === "comments") continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child.type === "string") yield* walk(child);
    }
  }
}

/** The imported module of a node that loads one at runtime, or undefined. */
function runtimeImportSource(node) {
  switch (node.type) {
    case "ImportDeclaration":
      return node.importKind === "type" ? undefined : node.source.value;
    case "ExportNamedDeclaration":
    case "ExportAllDeclaration":
      return node.source && node.exportKind !== "type" ? node.source.value : undefined;
    case "ImportExpression":
      return node.source.type === "Literal" ? node.source.value : undefined;
    default:
      return undefined;
  }
}

/** The credential doors a node opens itself, without following imports. */
function directDoors(node) {
  if (node.type === "ImportDeclaration" && node.source.value === "next/headers") {
    return node.specifiers.flatMap((specifier) => {
      if (specifier.type === "ImportNamespaceSpecifier") return ["the whole of next/headers"];
      if (specifier.type !== "ImportSpecifier") return [];
      const name = specifier.imported.name;
      return CREDENTIAL_HEADER_EXPORTS.includes(name) ? [`${name}()`] : [];
    });
  }
  if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
    const { callee } = node;
    const [name] = node.arguments;
    if (
      !callee.computed &&
      ["get", "has"].includes(callee.property.name) &&
      name?.type === "Literal" &&
      typeof name.value === "string" &&
      CREDENTIAL_HEADER.test(name.value)
    ) {
      return [headerDoor(name.value)];
    }
    if (
      !callee.computed &&
      ["get", "getAll", "has"].includes(callee.property.name) &&
      callee.object.type === "MemberExpression" &&
      !callee.object.computed &&
      callee.object.property.name === "cookies"
    ) {
      return ["the request cookies"];
    }
  }
  return [];
}

const SOURCE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".mjs",
  ".js",
  ".jsx",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.mjs",
  "/index.js",
  "/index.jsx",
];

/** Files that run code; a JSON, CSS or image import cannot read a credential. */
const CODE_FILE = /\.(ts|tsx|mts|cts|mjs|js|jsx|cjs)$/;

/** TypeScript-only extensions, where `<T>(x) => x` is a generic, not JSX. */
const NON_JSX_EXTENSIONS = /\.(ts|mts|cts)$/;

/** The repository file an import names, or undefined for a package. */
function resolveImport(specifier, fromFile) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(REPOSITORY_ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return undefined;
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = base + extension;
    if (!CODE_FILE.test(candidate)) continue;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/** file -> { mtimeMs, doors, imports } for every module this lint process has followed. */
const moduleCache = new Map();

function moduleFacts(file) {
  const { mtimeMs } = statSync(file);
  const cached = moduleCache.get(file);
  if (cached?.mtimeMs === mtimeMs) return cached;
  let ast;
  try {
    ast = parse(readFileSync(file, "utf8"), {
      jsx: !NON_JSX_EXTENSIONS.test(file),
      range: false,
      loc: false,
    });
  } catch (error) {
    // A module the fence cannot read could hide a credential read, so it
    // fails the lint run rather than counting as clean.
    throw new Error(`router-cache fence could not parse ${repositoryPath(file)}: ${error.message}`);
  }
  const facts = { mtimeMs, doors: new Set(), imports: [] };
  for (const node of walk(ast)) {
    for (const door of directDoors(node)) facts.doors.add(door);
    const source = runtimeImportSource(node);
    const resolved = source === undefined ? undefined : resolveImport(source, file);
    if (resolved !== undefined) facts.imports.push(resolved);
  }
  moduleCache.set(file, facts);
  return facts;
}

/** The credential doors loading `file` reaches, through any depth of imports. */
function reachedDoors(file, reached = new Set(), visiting = new Set()) {
  if (visiting.has(file)) return reached;
  visiting.add(file);
  const facts = moduleFacts(file);
  for (const door of facts.doors) reached.add(door);
  for (const next of facts.imports) reachedDoors(next, reached, visiting);
  return reached;
}

/**
 * Calls `onRead` with every credential door a page's source opens: its own
 * reads, and each door an imported module reaches, with that import's
 * specifier as `via`.
 */
function forEachCredentialRead(context, onRead) {
  for (const node of walk(context.sourceCode.ast)) {
    for (const door of directDoors(node)) onRead(node, door);
    const source = runtimeImportSource(node);
    if (source === undefined || source === "next/headers") continue;
    const resolved = resolveImport(source, context.filename);
    if (resolved === undefined) continue;
    for (const door of reachedDoors(resolved)) onRead(node, door, source);
  }
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
    const argued = arguedDoors(context);
    return {
      Program() {
        forEachCredentialRead(context, (node, door, via) => {
          if (argued.includes(door)) return;
          const read = via === undefined ? door : `${door} through ${via}`;
          context.report({ node, messageId: "read", data: { read } });
        });
      },
    };
  },
};

const staleException = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      stale:
        "This page is an argued exception in lib/routerCacheFence.mjs for {{door}}, but it no longer reads it. Delete that door from its entry: the list may only shrink.",
    },
  },
  create(context) {
    const argued = arguedDoors(context);
    if (argued.length === 0) return {};
    return {
      Program(program) {
        const read = new Set();
        forEachCredentialRead(context, (_node, door) => read.add(door));
        for (const door of argued) {
          if (!read.has(door)) context.report({ node: program, messageId: "stale", data: { door } });
        }
      },
    };
  },
};

/** The property a member expression names, when it names one statically. */
function memberName(node) {
  if (!node.computed) return node.property.name;
  return node.property.type === "Literal" ? String(node.property.value) : undefined;
}

const noRouterRefresh = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      refresh:
        "refresh() on the next/navigation router means a server surface carries mutable state, and the staleTimes window in next.config.mjs would hide the write. Give the surface its own /api read, or re-derive the window in the same commit.",
    },
  },
  create(context) {
    const hooks = new Set();
    const namespaces = new Set();
    const seen = new Set();

    /** Reports every refresh reached from an expression that holds the router. */
    function followRouter(expression) {
      if (seen.has(expression)) return;
      seen.add(expression);
      const { parent } = expression;
      switch (parent.type) {
        case "ChainExpression":
        case "TSNonNullExpression":
        case "TSAsExpression":
        case "TSSatisfiesExpression":
          followRouter(parent);
          return;
        case "MemberExpression":
          if (parent.object === expression && memberName(parent) === "refresh") {
            context.report({ node: parent, messageId: "refresh" });
          }
          return;
        case "VariableDeclarator": {
          if (parent.init !== expression) return;
          if (parent.id.type === "ObjectPattern") {
            for (const property of parent.id.properties) {
              if (property.type === "Property" && !property.computed && property.key.name === "refresh") {
                context.report({ node: property, messageId: "refresh" });
              }
            }
            return;
          }
          for (const variable of context.sourceCode.getDeclaredVariables(parent)) {
            for (const reference of variable.references) {
              if (reference.isRead()) followRouter(reference.identifier);
            }
          }
          return;
        }
        default:
          return;
      }
    }

    return {
      ImportDeclaration(node) {
        if (node.source.value !== "next/navigation") return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name);
          if (specifier.type === "ImportSpecifier" && specifier.imported.name === "useRouter") {
            hooks.add(specifier.local.name);
          }
        }
      },
      CallExpression(node) {
        const { callee } = node;
        const callsHook =
          (callee.type === "Identifier" && hooks.has(callee.name)) ||
          (callee.type === "MemberExpression" &&
            callee.object.type === "Identifier" &&
            namespaces.has(callee.object.name) &&
            memberName(callee) === "useRouter");
        if (callsHook) followRouter(node);
      },
    };
  },
};

const missing = missingExceptionPages();
if (missing.length > 0) {
  throw new Error(
    `lib/routerCacheFence.mjs argues an exception for ${missing.join(", ")}, which no longer exists. Delete the entry: a later page at that path must argue its own.`,
  );
}

const ROUTER_CACHE_PLUGIN = {
  rules: {
    "credential-read": credentialRead,
    "stale-exception": staleException,
    "no-router-refresh": noRouterRefresh,
  },
};

/** Flat-config blocks for eslint.config.mjs. */
export const ROUTER_CACHE_FENCE_CONFIG = Object.freeze([
  {
    files: ["app/**/*.{ts,tsx}"],
    ignores: ["app/api/**"],
    plugins: { "router-cache": ROUTER_CACHE_PLUGIN },
    rules: {
      "router-cache/credential-read": "error",
      "router-cache/stale-exception": "error",
    },
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: ["app/api/**"],
    plugins: { "router-cache": ROUTER_CACHE_PLUGIN },
    rules: { "router-cache/no-router-refresh": "error" },
  },
]);
