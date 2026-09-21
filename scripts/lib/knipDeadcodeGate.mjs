// KNIP ON A BRANCH FAILS ONLY ON WHAT THE BRANCH INTRODUCED.
//
// Full-tree knip is `npm run deadcode:all` / `npx knip`. verify runs the
// wrapper that subtracts findings origin/main already has, so a rebase that
// inherits an unused export from a PR that landed while this branch was open
// is not this branch's to delete. On main, or when origin/main cannot be
// read, every finding fails: that is the same gate as `npx knip`.

/** Issue types knip.config.ts sets to "error". Duplicates warn; unresolved is off. */
export const ERROR_ISSUE_TYPES = Object.freeze(
  new Set([
    "files",
    "exports",
    "types",
    "nsExports",
    "nsTypes",
    "enumMembers",
    "dependencies",
    "devDependencies",
    "unlisted",
    "binaries",
  ]),
);

const SKIP_ROW_KEYS = new Set(["file", "owners"]);

/**
 * @param {{ type: string, file: string, name: string }} issue
 * @returns {string}
 */
export function issueKey(issue) {
  return `${issue.type}\0${issue.file}\0${issue.name}`;
}

/**
 * Flatten knip's JSON reporter (`{ issues: [{ file, exports, files, ... }] }`)
 * into one record per finding.
 *
 * @param {unknown} report
 * @returns {Array<{ type: string, file: string, name: string, line?: number, col?: number }>}
 */
export function flattenKnipReport(report) {
  if (!report || typeof report !== "object") return [];
  const rows = /** @type {{ issues?: unknown }} */ (report).issues;
  if (!Array.isArray(rows)) return [];

  /** @type {Array<{ type: string, file: string, name: string, line?: number, col?: number }>} */
  const issues = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const file = typeof row.file === "string" ? row.file : "";
    for (const [type, items] of Object.entries(row)) {
      if (SKIP_ROW_KEYS.has(type) || !Array.isArray(items)) continue;
      for (const item of items) {
        issues.push(findingFromReporterItem(type, file, item));
      }
    }
  }
  return issues;
}

/**
 * @param {string} type
 * @param {string} file
 * @param {unknown} item
 */
function findingFromReporterItem(type, file, item) {
  if (type === "files") {
    return { type, file, name: file };
  }
  if (type === "duplicates" || type === "cycles") {
    const names = Array.isArray(item)
      ? item
          .map((entry) =>
            entry && typeof entry === "object" && "name" in entry
              ? String(entry.name)
              : String(entry),
          )
          .join(",")
      : String(item);
    return { type, file, name: names };
  }
  if (item && typeof item === "object" && "name" in item) {
    const line = "line" in item && typeof item.line === "number" ? item.line : undefined;
    const col = "col" in item && typeof item.col === "number" ? item.col : undefined;
    return { type, file, name: String(item.name), line, col };
  }
  return { type, file, name: String(item) };
}

/**
 * @param {Array<{ type: string, file: string, name: string }>} issues
 */
export function errorIssues(issues) {
  return issues.filter((issue) => ERROR_ISSUE_TYPES.has(issue.type));
}

/**
 * @param {number} aheadCount
 */
export function isMainlineGate(aheadCount) {
  return !Number.isInteger(aheadCount) || aheadCount <= 0;
}

/**
 * @param {object} input
 * @param {number} input.aheadCount
 * @param {Array<{ type: string, file: string, name: string }>} input.headIssues
 * @param {Array<{ type: string, file: string, name: string }>} [input.baseIssues]
 * @param {boolean} input.baseReadable
 */
export function decideKnipGate({ aheadCount, headIssues, baseIssues = [], baseReadable }) {
  if (isMainlineGate(aheadCount) || !baseReadable) {
    const owned = errorIssues(headIssues);
    return {
      mode: isMainlineGate(aheadCount) ? "main" : "base-unreadable",
      owned,
      inherited: [],
      exitCode: owned.length > 0 ? 1 : 0,
    };
  }

  const baseKeys = new Set(baseIssues.map(issueKey));
  /** @type {typeof headIssues} */
  const owned = [];
  /** @type {typeof headIssues} */
  const inherited = [];
  for (const issue of errorIssues(headIssues)) {
    if (baseKeys.has(issueKey(issue))) inherited.push(issue);
    else owned.push(issue);
  }
  return {
    mode: "branch",
    owned,
    inherited,
    exitCode: owned.length > 0 ? 1 : 0,
  };
}
