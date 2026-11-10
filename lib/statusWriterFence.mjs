// ONE WRITER MODULE PER PERSISTED LIFECYCLE.
//
// A lifecycle column (status, state, moderation_state, verification_state)
// changes in the one store module that owns its table, so that store's
// transition table is the only path a row can take. See
// docs/rules/state-machines.md, rules 10 and 11. These lint rules refuse an
// `.update({ <lifecycle column>: ... })` on a `.from(<table>)` chain anywhere
// else.
//
// Plain ESM because eslint.config.mjs cannot import TypeScript. The module
// reads no files, so eslint.config.mjs checks that the paths below still exist.

import path from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root: this module lives in its lib/ directory. */
const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

const LIFECYCLE_COLUMNS = new Set(["status", "state", "moderation_state", "verification_state"]);

/** Table -> the store module that is the one writer of its lifecycle columns. */
const LIFECYCLE_OWNERS = Object.freeze({
  night_story_contributors: "lib/nightMemoryStore.ts",
  operator_proposals: "lib/operatorProposalsStore.ts",
  pint_drop_comments: "lib/commentsStore.ts",
  pint_drop_with_tags: "lib/pintDropWithTagsStore.ts",
  pint_drops: "lib/pintDropsStore.ts",
  plan_crew_members: "lib/planStore.ts",
  profile_cover_photos: "lib/profileCoverPhotoStore.ts",
  structured_visit_reports: "lib/visitReportsStore.ts",
  venue_corrections: "lib/venueCorrectionsStore.ts",
  venue_operators: "lib/venueOperatorsStore.ts",
  venue_photos: "lib/venuePhotoStore.ts",
  venue_submissions: "lib/venueSubmissionStore.ts",
  wanteds: "lib/wantedStore.ts",
  weather_recommendations: "lib/weatherRecommendationStore.ts",
});

// This list may only shrink.
const FOREIGN_LIFECYCLE_WRITERS = Object.freeze([
  { file: "lib/openCrawlArrivalStore.ts", table: "plan_crew_members" },
]);

/** Table names that a store imports as a shared constant: module -> export -> table. */
const IMPORTED_TABLE_NAMES = Object.freeze({
  "@/lib/pintDropTable": { PINT_DROPS_TABLE: "pint_drops" },
});

/** Every repository path this module names, for eslint.config.mjs to check. */
export function namedFiles() {
  return [...new Set([...Object.values(LIFECYCLE_OWNERS), ...FOREIGN_LIFECYCLE_WRITERS.map(({ file }) => file)])];
}

function repositoryPath(file) {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function unwrap(node) {
  let current = node;
  while (["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "ChainExpression"].includes(current?.type)) {
    current = current.expression;
  }
  return current;
}

function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable;
  }
  return undefined;
}

/** The single definition of a `const` or import binding, or undefined. */
function constDefinition(context, identifier) {
  const variable = findVariable(context.sourceCode.getScope(identifier), identifier.name);
  if (variable?.defs.length !== 1) return undefined;
  const [definition] = variable.defs;
  if (definition.type === "ImportBinding") return definition;
  if (definition.type === "Variable" && definition.parent.kind === "const") return definition;
  return undefined;
}

/** The table a `.from()` argument names statically, or undefined. */
function tableName(context, argument, seen = new Set()) {
  const node = unwrap(argument);
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node?.type !== "Identifier" || seen.has(node.name)) return undefined;
  seen.add(node.name);
  const definition = constDefinition(context, node);
  if (definition?.type === "Variable") return tableName(context, definition.node.init, seen);
  if (definition?.node.type === "ImportSpecifier") {
    return IMPORTED_TABLE_NAMES[definition.parent.source.value]?.[definition.node.imported.name];
  }
  return undefined;
}

/** The `.from()` call a query-builder chain starts from, or undefined. */
function fromCall(context, start) {
  const seen = new Set();
  let node = unwrap(start);
  while (node && !seen.has(node)) {
    seen.add(node);
    if (node.type === "CallExpression") {
      const { callee } = node;
      if (callee.type === "MemberExpression" && !callee.computed && callee.property.name === "from") return node;
      node = unwrap(callee);
    } else if (node.type === "MemberExpression") {
      node = unwrap(node.object);
    } else if (node.type === "Identifier") {
      const definition = constDefinition(context, node);
      node = definition?.type === "Variable" ? unwrap(definition.node.init) : undefined;
    } else {
      return undefined;
    }
  }
  return undefined;
}

function propertyName(property) {
  if (property.type !== "Property") return undefined;
  if (!property.computed && property.key.type === "Identifier") return property.key.name;
  return property.key.type === "Literal" ? String(property.key.value) : undefined;
}

/** Calls `onWrite` for each lifecycle column a `.update({...})` on a `.from()` chain sets. */
function lifecycleWrites(context, onWrite) {
  return {
    CallExpression(node) {
      const { callee } = node;
      if (callee.type !== "MemberExpression" || callee.computed || callee.property.name !== "update") return;
      const [values] = node.arguments;
      if (values?.type !== "ObjectExpression") return;
      const columns = values.properties.filter((property) => LIFECYCLE_COLUMNS.has(propertyName(property)));
      if (columns.length === 0) return;
      const from = fromCall(context, callee.object);
      if (from === undefined) return;
      const table = tableName(context, from.arguments[0]);
      for (const column of columns) onWrite(column, propertyName(column), table);
    },
  };
}

function exceptedTables(file) {
  return FOREIGN_LIFECYCLE_WRITERS.filter((entry) => entry.file === file).map((entry) => entry.table);
}

const oneWriter = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      foreign:
        "Only {{owner}} writes the {{column}} lifecycle of {{table}}. Call that store instead, so its transition table stays the one path.",
      unowned:
        "{{table}}.{{column}} is a lifecycle column with no owner in lib/statusWriterFence.mjs. Name the one store module that writes it.",
      unnamed:
        "This {{column}} write names its table through a value the fence cannot read. Pass .from() a string literal or a module const.",
    },
  },
  create(context) {
    const file = repositoryPath(context.filename);
    const excepted = exceptedTables(file);
    return lifecycleWrites(context, (node, column, table) => {
      if (table === undefined) {
        context.report({ node, messageId: "unnamed", data: { column } });
        return;
      }
      const owner = LIFECYCLE_OWNERS[table];
      if (owner === undefined) context.report({ node, messageId: "unowned", data: { table, column } });
      else if (owner !== file && !excepted.includes(table)) {
        context.report({ node, messageId: "foreign", data: { owner, table, column } });
      }
    });
  },
};

const staleException = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      stale:
        "lib/statusWriterFence.mjs excepts this file for {{table}}, but it no longer writes that lifecycle. Delete the entry: the list may only shrink.",
    },
  },
  create(context) {
    const excepted = exceptedTables(repositoryPath(context.filename));
    if (excepted.length === 0) return {};
    const written = new Set();
    return {
      ...lifecycleWrites(context, (_node, _column, table) => written.add(table)),
      "Program:exit"(program) {
        for (const table of excepted) {
          if (!written.has(table)) context.report({ node: program, messageId: "stale", data: { table } });
        }
      },
    };
  },
};

/** Flat-config block for eslint.config.mjs. */
export const STATUS_WRITER_FENCE_CONFIG = Object.freeze([
  {
    files: ["{app,components,lib,scripts}/**/*.{ts,tsx,mts,mjs,js,jsx,cjs}"],
    plugins: { "status-writer": { rules: { "one-writer": oneWriter, "stale-exception": staleException } } },
    rules: {
      "status-writer/one-writer": "error",
      "status-writer/stale-exception": "error",
    },
  },
]);
