import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { renderDatabaseTypes } from "@/scripts/db/renderDatabaseTypes.mjs";
import { defined } from "@/__tests__/helpers/defined";

function scalar(udt: string) {
  return { udt, category: "S" };
}

function column(
  name: string,
  position: number,
  type: { udt: string; category: string; schema?: string },
  extra: Record<string, unknown> = {},
) {
  return {
    name,
    position,
    nullable: false,
    hasAttrDefault: false,
    generated: "",
    identity: "",
    type,
    ...extra,
  };
}

function routine(
  name: string,
  identity: string,
  args: Array<{ name: string; mode: string; type: { udt: string; category: string } }>,
  returns: { udt: string; category: string },
  extra: Record<string, unknown> = {},
) {
  return {
    name,
    identity,
    nargs: args.filter((arg) => arg.mode === "i" || arg.mode === "b" || arg.mode === "v").length,
    ndefaults: 0,
    args,
    setof: false,
    returnRelation: null,
    returnRelationKind: "",
    returnType: returns,
    ...extra,
  };
}

function catalog() {
  const stops = {
    name: "stops",
    columns: [
      column("id", 1, scalar("uuid"), { identity: "a" }),
      column("name", 2, scalar("text")),
      column("note", 3, scalar("text"), { nullable: true }),
      column("score", 4, scalar("int4"), { hasAttrDefault: true }),
      column("search", 5, scalar("tsvector"), { generated: "s" }),
      column("status", 6, { udt: "pub_status", category: "E", schema: "public" }),
    ],
    relationships: [
      {
        foreignKeyName: "stops_venue_id_fkey",
        columns: ["venue_id"],
        isOneToOne: false,
        referencedRelation: "venues",
        referencedColumns: ["id"],
      },
    ],
  };
  return {
    tables: [stops],
    views: [
      {
        name: "open_stops",
        insertable: false,
        columns: [column("name", 1, scalar("text"))],
        relationships: [],
      },
    ],
    enums: [{ schema: "public", name: "pub_status", labels: ["closed", "open"] }],
    composites: [],
    functions: [
      routine("ping", "ping()", [], { udt: "void", category: "S" }),
      routine(
        "check_rate_limit",
        "check_rate_limit(text,integer)",
        [
          { name: "p_key", mode: "i", type: scalar("text") },
          { name: "p_limit", mode: "i", type: scalar("int4") },
        ],
        { udt: "bool", category: "B" },
        { ndefaults: 1 },
      ),
      routine(
        "store_payload",
        "store_payload(jsonb)",
        [{ name: "p_payload", mode: "i", type: scalar("jsonb") }],
        { udt: "void", category: "S" },
      ),
      routine(
        "touch",
        "touch(uuid)",
        [{ name: "p_id", mode: "i", type: scalar("uuid") }],
        { udt: "void", category: "S" },
      ),
      routine(
        "touch",
        "touch(text)",
        [{ name: "p_name", mode: "i", type: scalar("text") }],
        { udt: "void", category: "S" },
      ),
      routine("list_stops", "list_stops()", [], { udt: "stops", category: "C" }, {
        setof: true,
        returnRelation: "stops",
        returnRelationKind: "r",
        returnType: { udt: "stops", category: "C", schema: "public" },
      }),
    ],
  };
}

describe("generated database types", () => {
  it("renders nullable arguments, defaults, generated columns, enums, overloads and setof", () => {
    const rendered = renderDatabaseTypes(catalog());

    expect(rendered).toContain("id?: string;");
    expect(rendered).toContain("name: string;");
    expect(rendered).toContain("note?: string | null;");
    expect(rendered).toContain("score?: number;");
    expect(rendered).toContain("search: string;");
    expect(rendered).not.toMatch(/Insert:[\s\S]*search:/);
    expect(rendered).toContain('status: Database["public"]["Enums"]["pub_status"];');
    expect(rendered).toContain('pub_status: "closed" | "open";');
    expect(rendered).toContain("ping: {\n        Args: Record<PropertyKey, never>;");
    expect(rendered).toContain("p_key: string | null;");
    expect(rendered).toContain("p_limit?: number | null;");
    expect(rendered).toContain("p_payload: Json;");
    expect(rendered).not.toContain("p_payload: Json | null");
    expect(rendered).toContain("touch:\n        | {");
    expect(rendered).toContain('Returns: Database["public"]["Tables"]["stops"]["Row"][];');
    expect(rendered).toContain("isSetofReturn: true;");
    expect(rendered).toContain("CompositeTypes: {\n      [_ in never]: never;\n    };");
    // The view is not insertable, so the only Insert block belongs to the table.
    expect(rendered.match(/Insert:/g)).toEqual(["Insert:"]);
  });

  it("renders the same text when catalog order changes", () => {
    const first = catalog();
    const second = catalog();
    defined(second.tables[0]).columns.reverse();
    second.functions.reverse();
    second.enums.reverse();
    expect(renderDatabaseTypes(second)).toBe(renderDatabaseTypes(first));
  });

  it("renders a single-column RETURNS TABLE as row objects, not scalars", () => {
    const rendered = renderDatabaseTypes({
      ...catalog(),
      functions: [
        routine(
          "read_media",
          "read_media(uuid)",
          [
            { name: "p_post_id", mode: "i", type: scalar("uuid") },
            { name: "object_key", mode: "t", type: scalar("text") },
          ],
          scalar("text"),
          { setof: true },
        ),
      ],
    });

    expect(rendered).toContain(
      "read_media: {\n        Args: {\n          p_post_id: string | null;\n        };\n        Returns: {\n          object_key: string;\n        }[];",
    );
  });
});

describe("db:types:check without PostgreSQL 16", () => {
  function check(env: Record<string, string>) {
    return spawnSync(process.execPath, ["scripts/db/generate-database-types.mjs", "--check"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, PUBMAX_RLS_ALLOW_SKIP: "", ...env },
    });
  }

  it("fails loudly when the skip is not admitted", () => {
    const result = check({ PUBMAX_RLS_NO_PG: "1" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("DATABASE TYPES CHECK SKIPPED - THIS IS NOT A PASS");
    expect(result.stdout).toContain("This run FAILS");
  });

  it("passes only when a host admits the skip on purpose", () => {
    const result = check({ PUBMAX_RLS_NO_PG: "1", PUBMAX_RLS_ALLOW_SKIP: "1" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("THIS IS NOT A PASS");
    expect(result.stdout).toContain("admitted this skip");
  });
});
