// Relative-import safe: lib/harvest/chainDeals.ts reaches this from plain-node CLIs.

/** Lowercase, collapse whitespace runs to one space, and trim. */
export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Lowercase kebab slug: every non-alphanumeric run becomes one hyphen, none at the ends. */
export function kebabSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
