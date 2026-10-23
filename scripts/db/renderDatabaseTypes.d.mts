/** The public-schema catalog introspect-public-schema.sql returns. */
export type DatabaseTypeCatalog = {
  tables: unknown[];
  views: unknown[];
  enums: unknown[];
  composites: unknown[];
  functions: unknown[];
};

/** Turn that catalog into the Database generic createClient accepts. */
export function renderDatabaseTypes(catalog: DatabaseTypeCatalog): string;
