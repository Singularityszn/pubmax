/**
 * Turn a public-schema catalog (the JSON from introspect-public-schema.sql)
 * into the Database generic createClient accepts.
 * Ordering lives here so two runs of one catalog cannot drift.
 */

const SCALARS = {
  bool: "boolean",
  int2: "number",
  int4: "number",
  int8: "number",
  float4: "number",
  float8: "number",
  numeric: "number",
  money: "number",
  oid: "number",
  json: "Json",
  jsonb: "Json",
  text: "string",
  varchar: "string",
  bpchar: "string",
  uuid: "string",
  name: "string",
  citext: "string",
  bytea: "string",
  date: "string",
  time: "string",
  timetz: "string",
  timestamp: "string",
  timestamptz: "string",
  interval: "string",
  inet: "string",
  cidr: "string",
  macaddr: "string",
  macaddr8: "string",
  xml: "string",
  tsvector: "string",
  tsquery: "string",
  xid: "string",
  int4range: "string",
  int8range: "string",
  numrange: "string",
  tsrange: "string",
  tstzrange: "string",
  daterange: "string",
};

const INPUT_MODES = new Set(["i", "b", "v"]);
const OUTPUT_MODES = new Set(["o", "b", "t"]);

function indent(level) {
  return " ".repeat(level);
}

function prop(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function blankChar(value) {
  return String(value ?? "").replaceAll("\u0000", "").trim();
}

function byName(left, right) {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function typeOf(spec, ctx) {
  if (!spec || spec.udt == null) return "string";
  if (spec.udt === "void") return "undefined";
  if (spec.category === "A") {
    const inner = typeOf(spec.elem, ctx);
    return `${inner}[]`;
  }
  if (spec.category === "E") {
    if (spec.schema === "public" && ctx.publicEnums.has(spec.udt)) {
      return `Database["public"]["Enums"][${JSON.stringify(spec.udt)}]`;
    }
    const labels = ctx.labels.get(`${spec.schema}.${spec.udt}`);
    if (labels && labels.length > 0) return union(labels);
    return "string";
  }
  if (Object.hasOwn(SCALARS, spec.udt)) return SCALARS[spec.udt];
  if (spec.category === "C" && spec.schema === "public") {
    if (ctx.composites.has(spec.udt)) {
      return `Database["public"]["CompositeTypes"][${JSON.stringify(spec.udt)}]`;
    }
    if (ctx.tables.has(spec.udt)) {
      return `Database["public"]["Tables"][${JSON.stringify(spec.udt)}]["Row"]`;
    }
    if (ctx.views.has(spec.udt)) {
      return `Database["public"]["Views"][${JSON.stringify(spec.udt)}]["Row"]`;
    }
  }
  return "string";
}

function union(labels) {
  const parts = labels.map((label) => JSON.stringify(label));
  if (parts.length === 1) return parts[0];
  return parts.join(" | ");
}

function nullable(ts, isNullable) {
  return isNullable ? `${ts} | null` : ts;
}

function rowField(column, ctx) {
  const ts = nullable(typeOf(column.type, ctx), column.nullable);
  return `${prop(column.name)}: ${ts};`;
}

function generatedColumn(column) {
  return blankChar(column.generated) === "s";
}

function insertOptional(column) {
  const identity = blankChar(column.identity);
  return Boolean(column.nullable) || Boolean(column.hasDefault) || identity === "a" || identity === "d";
}

function insertField(column, ctx) {
  if (generatedColumn(column)) return null;
  const ts = nullable(typeOf(column.type, ctx), column.nullable);
  const optional = insertOptional(column) ? "?" : "";
  return `${prop(column.name)}${optional}: ${ts};`;
}

function updateField(column, ctx) {
  if (generatedColumn(column)) return null;
  const ts = nullable(typeOf(column.type, ctx), column.nullable);
  return `${prop(column.name)}?: ${ts};`;
}

function fieldBlock(fields, level) {
  const kept = fields.filter((field) => field != null);
  if (kept.length === 0) return "Record<PropertyKey, never>";
  const pad = indent(level + 2);
  return `{\n${kept.map((field) => `${pad}${field}`).join("\n")}\n${indent(level)}}`;
}

function renderRelationships(relationships, level) {
  const sorted = [...relationships].sort((left, right) => {
    if (left.foreignKeyName !== right.foreignKeyName) {
      return left.foreignKeyName < right.foreignKeyName ? -1 : 1;
    }
    const lc = left.columns.join(",");
    const rc = right.columns.join(",");
    return lc < rc ? -1 : lc > rc ? 1 : 0;
  });
  if (sorted.length === 0) return "[]";
  const pad = indent(level + 2);
  const inner = indent(level + 4);
  const items = sorted.map((rel) => {
    const columns = rel.columns.map((column) => JSON.stringify(column)).join(", ");
    const referenced = rel.referencedColumns.map((column) => JSON.stringify(column)).join(", ");
    return [
      `${pad}{`,
      `${inner}foreignKeyName: ${JSON.stringify(rel.foreignKeyName)};`,
      `${inner}columns: [${columns}];`,
      `${inner}isOneToOne: ${rel.isOneToOne ? "true" : "false"};`,
      `${inner}referencedRelation: ${JSON.stringify(rel.referencedRelation)};`,
      `${inner}referencedColumns: [${referenced}];`,
      `${pad}},`,
    ].join("\n");
  });
  return `[\n${items.join("\n")}\n${indent(level)}]`;
}

function renderRelation(relation, ctx, { withMutation }) {
  const columns = [...relation.columns].sort((left, right) => left.position - right.position);
  const lines = [
    `${indent(6)}${prop(relation.name)}: {`,
    `${indent(8)}Row: ${fieldBlock(columns.map((column) => rowField(column, ctx)), 8)};`,
  ];
  if (withMutation) {
    lines.push(
      `${indent(8)}Insert: ${fieldBlock(columns.map((column) => insertField(column, ctx)), 8)};`,
      `${indent(8)}Update: ${fieldBlock(columns.map((column) => updateField(column, ctx)), 8)};`,
    );
  }
  lines.push(
    `${indent(8)}Relationships: ${renderRelationships(relation.relationships ?? [], 8)};`,
    `${indent(6)}};`,
  );
  return lines.join("\n");
}

function decorateArgs(fn) {
  let inputOrdinal = 0;
  const requiredUntil = fn.nargs - fn.ndefaults;
  return fn.args.map((arg, index) => {
    const mode = blankChar(arg.mode) || "i";
    const input = INPUT_MODES.has(mode);
    let optional = false;
    if (input) {
      inputOrdinal += 1;
      optional = mode === "v" || inputOrdinal > requiredUntil;
    }
    const name = arg.name ? arg.name : `arg${index + 1}`;
    return { ...arg, mode, input, optional, name };
  });
}

function argumentType(spec, ctx) {
  const ts = typeOf(spec, ctx);
  // A Postgres argument accepts NULL unless the signature says otherwise.
  // Omitting an argument is a separate question, and that is `optional`.
  if (ts === "undefined" || ts === "Json" || ts.endsWith("| null")) return ts;
  return `${ts} | null`;
}

function renderArgs(args, ctx) {
  const inputs = args.filter((arg) => arg.input);
  if (inputs.length === 0) return "Record<PropertyKey, never>";
  const fields = inputs.map((arg) => {
    const ts = argumentType(arg.type, ctx);
    return `${prop(arg.name)}${arg.optional ? "?" : ""}: ${ts};`;
  });
  return fieldBlock(fields, 8);
}

function renderReturnColumns(args, ctx) {
  const columns = args.filter((arg) => OUTPUT_MODES.has(arg.mode));
  if (columns.length === 0) return null;
  const fields = columns.map((arg) => `${prop(arg.name)}: ${typeOf(arg.type, ctx)};`);
  return fieldBlock(fields, 8);
}

function renderReturns(fn, args, ctx) {
  const relationKind = blankChar(fn.returnRelationKind);
  if (fn.returnRelation && (relationKind === "r" || relationKind === "p" || relationKind === "v" || relationKind === "m")) {
    const bucket = relationKind === "v" || relationKind === "m" ? "Views" : "Tables";
    const row = `Database["public"]["${bucket}"][${JSON.stringify(fn.returnRelation)}]["Row"]`;
    return fn.setof ? `${row}[]` : row;
  }
  if (fn.returnType?.udt === "record") {
    const record = renderReturnColumns(args, ctx);
    if (record) return fn.setof ? `${record}[]` : record;
    return fn.setof ? "Json[]" : "Json";
  }
  const scalar = typeOf(fn.returnType, ctx);
  return fn.setof ? `${scalar}[]` : scalar;
}

function renderSetofOptions(fn) {
  const relationKind = blankChar(fn.returnRelationKind);
  if (!fn.setof || !fn.returnRelation) return null;
  if (relationKind !== "r" && relationKind !== "p" && relationKind !== "v" && relationKind !== "m") {
    return null;
  }
  return [
    "{",
    `${indent(10)}from: "*";`,
    `${indent(10)}to: ${JSON.stringify(fn.returnRelation)};`,
    `${indent(10)}isOneToOne: false;`,
    `${indent(10)}isSetofReturn: true;`,
    `${indent(8)}}`,
  ].join("\n");
}

function renderFunctionShape(fn, ctx) {
  const args = decorateArgs(fn);
  const lines = [
    "{",
    `${indent(8)}Args: ${renderArgs(args, ctx)};`,
    `${indent(8)}Returns: ${renderReturns(fn, args, ctx)};`,
  ];
  const setof = renderSetofOptions(fn);
  if (setof) lines.push(`${indent(8)}SetofOptions: ${setof};`);
  lines.push(`${indent(6)}}`);
  return lines.join("\n");
}

function renderFunctions(functions, ctx) {
  const groups = new Map();
  for (const fn of functions) {
    const list = groups.get(fn.name) ?? [];
    list.push(fn);
    groups.set(fn.name, list);
  }
  return [...groups.keys()].sort().map((name) => {
    const overloads = groups.get(name).slice().sort((left, right) => {
      if (left.identity !== right.identity) return left.identity < right.identity ? -1 : 1;
      return JSON.stringify(left.args).localeCompare(JSON.stringify(right.args));
    });
    const bodies = [];
    const seen = new Set();
    for (const fn of overloads) {
      const body = renderFunctionShape(fn, ctx);
      if (seen.has(body)) continue;
      seen.add(body);
      bodies.push(body);
    }
    if (bodies.length === 1) {
      return `${indent(6)}${prop(name)}: ${bodies[0]};`;
    }
    return `${indent(6)}${prop(name)}:\n        | ${bodies.join("\n        | ")};`;
  });
}

function renderEnumMembers(enums) {
  return enums
    .filter((entry) => entry.schema === "public")
    .sort(byName)
    .map((entry) => `${indent(6)}${prop(entry.name)}: ${union(entry.labels)};`);
}

function renderComposites(composites, ctx) {
  return composites
    .filter((entry) => entry.schema === "public")
    .sort(byName)
    .map((entry) => {
      const attributes = [...entry.attributes].sort((left, right) => left.position - right.position);
      const fields = attributes.map((attribute) => rowField(
        { name: attribute.name, nullable: attribute.nullable, type: attribute.type },
        ctx,
      ));
      return `${indent(6)}${prop(entry.name)}: ${fieldBlock(fields, 6)};`;
    });
}

function section(name, members) {
  if (members.length === 0) {
    return `${indent(4)}${name}: {\n${indent(6)}[_ in never]: never;\n${indent(4)}};`;
  }
  return `${indent(4)}${name}: {\n${members.join("\n")}\n${indent(4)}};`;
}

function prepareColumns(columns) {
  return columns.map((column) => ({
    ...column,
    hasDefault: Boolean(column.hasAttrDefault) && blankChar(column.generated) !== "s",
    identity: blankChar(column.identity),
    generated: blankChar(column.generated),
  }));
}

/**
 * @param {{
 *   tables: Array<Record<string, unknown>>,
 *   views: Array<Record<string, unknown>>,
 *   enums: Array<{ name: string, schema: string, labels: string[] }>,
 *   composites: Array<Record<string, unknown>>,
 *   functions: Array<Record<string, unknown>>,
 * }} catalog
 */
export function renderDatabaseTypes(catalog) {
  const tables = [...catalog.tables].sort(byName).map((table) => ({
    ...table,
    columns: prepareColumns(table.columns),
  }));
  const views = [...catalog.views].sort(byName).map((view) => ({
    ...view,
    columns: prepareColumns(view.columns),
  }));
  const enums = [...catalog.enums];
  const composites = [...catalog.composites];
  const functions = [...catalog.functions];

  const ctx = {
    publicEnums: new Set(enums.filter((entry) => entry.schema === "public").map((entry) => entry.name)),
    labels: new Map(enums.map((entry) => [`${entry.schema}.${entry.name}`, entry.labels])),
    tables: new Set(tables.map((table) => table.name)),
    views: new Set(views.map((view) => view.name)),
    composites: new Set(
      composites.filter((entry) => entry.schema === "public").map((entry) => entry.name),
    ),
  };

  const tableMembers = tables.map((table) => renderRelation(table, ctx, { withMutation: true }));
  const viewMembers = views.map((view) =>
    renderRelation(view, ctx, { withMutation: Boolean(view.insertable) }),
  );
  const functionMembers = renderFunctions(functions, ctx);
  const enumMembers = renderEnumMembers(enums);
  const compositeMembers = renderComposites(composites, ctx);

  return `/**
 * Generated from the harness PostgreSQL 16 cluster after every migration
 * in supabase/migrations. Regenerate with \`npm run db:types\`.
 * \`npm run db:types:check\` fails when this file has drifted.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
${section("Tables", tableMembers)}
${section("Views", viewMembers)}
${section("Functions", functionMembers)}
${section("Enums", enumMembers)}
${section("CompositeTypes", compositeMembers)}
  };
};
`;
}
