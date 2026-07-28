import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { enabledVenuePackIncludes } from "./cityVenuePacks.mjs";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const RUNTIME_SOURCE_ROOTS = ["app", "components", "lib"];
const APP_ENTRY_NAMES = new Set(["page", "route", "opengraph-image"]);

/**
 * Every module that opens a data file whose path it assembles at REQUEST time,
 * with the files that module can open. Next traces only paths it can see
 * statically, so a reader of one of these ships the data only when the route is
 * declared in outputFileTracingIncludes; otherwise it is an accident of which
 * routes Vercel grouped into that lambda.
 *
 * A pack is declared ONCE here and its reader routes are derived from the import
 * graph, so a new pack needs one entry and a new reader needs nothing at all.
 * The file lists are themselves derived where a registry owns them.
 *
 * @type {ReadonlyArray<{ id: string, module: string, files: string[] }>}
 */
export const RUNTIME_DATA_PACKS = [
  {
    id: "venue-index",
    module: "lib/venueIndex.ts",
    files: enabledVenuePackIncludes(),
  },
  {
    id: "venue-detail-index",
    module: "lib/venueDetailIndex.ts",
    files: [
      "./data/generated/venue_detail_index.json",
      "./data/generated/venue_details.jsonl",
      "./public/data/pint_prices_app_dataset.json",
    ],
  },
];

function collectSourceFiles(directory, files) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(file, files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      files.push(path.resolve(file));
    }
  }
}

function runtimeImportSpecifiers(source) {
  const specifiers = [];
  const staticImport =
    /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  const commonJsRequire = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const pattern of [staticImport, dynamicImport, commonJsRequire]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function resolveLocalImport(importer, specifier, projectRoot, sourceFiles) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.resolve(projectRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(importer), specifier);
  } else {
    return null;
  }

  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => sourceFiles.has(candidate)) ?? null;
}

function appEntryRouteGlob(file, appRoot) {
  const extension = path.extname(file);
  const entryName = path.basename(file, extension);
  if (!APP_ENTRY_NAMES.has(entryName)) return null;

  const directory = path.relative(appRoot, path.dirname(file));
  const routeSegments = directory
    .split(path.sep)
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
    .filter((segment) => !segment.startsWith("@"));

  if (entryName === "opengraph-image") routeSegments.push(entryName);
  const route = routeSegments.length > 0 ? `/${routeSegments.join("/")}` : "/";

  // outputFileTracingIncludes keys are picomatch globs. Dynamic segment
  // brackets must be escaped or `[id]` becomes a one-character glob class.
  return route.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function buildImportGraph(absoluteRoot) {
  const files = [];
  for (const sourceRoot of RUNTIME_SOURCE_ROOTS) {
    collectSourceFiles(path.join(absoluteRoot, sourceRoot), files);
  }

  const sourceFiles = new Set(files);
  const dependencies = new Map();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const resolved = runtimeImportSpecifiers(source)
      .map((specifier) => resolveLocalImport(file, specifier, absoluteRoot, sourceFiles))
      .filter(Boolean);
    dependencies.set(file, resolved);
  }
  return { files, sourceFiles, dependencies };
}

function readerRouteGlobs(graph, absoluteRoot, moduleRelativePath) {
  const appRoot = path.join(absoluteRoot, "app");
  const target = path.resolve(absoluteRoot, moduleRelativePath);
  if (!graph.sourceFiles.has(target)) return [];

  // Grow the reverse dependency closure to a fixed point. This handles cycles
  // without caching a false result before another edge closes the path.
  const readers = new Set([target]);
  let addedReader = true;
  while (addedReader) {
    addedReader = false;
    for (const file of graph.files) {
      if (readers.has(file)) continue;
      const reaches = (graph.dependencies.get(file) ?? []).some((dependency) =>
        readers.has(dependency),
      );
      if (!reaches) continue;
      readers.add(file);
      addedReader = true;
    }
  }

  const routes = new Set();
  for (const file of graph.files) {
    if (!file.startsWith(`${appRoot}${path.sep}`) || !readers.has(file)) continue;
    const route = appEntryRouteGlob(file, appRoot);
    if (route) routes.add(route);
  }
  return [...routes].sort();
}

/**
 * Find App Router runtime entries whose local static-import graph reaches one
 * module. The result is suitable as outputFileTracingIncludes keys.
 *
 * @param {string} projectRoot
 * @param {string} moduleRelativePath project-relative path of the reading module
 * @returns {string[]}
 */
export function discoverRuntimeReaderRouteGlobs(projectRoot, moduleRelativePath) {
  const absoluteRoot = path.resolve(projectRoot);
  return readerRouteGlobs(buildImportGraph(absoluteRoot), absoluteRoot, moduleRelativePath);
}

/**
 * Every runtime data pack keyed by the routes that can open it, merged so a
 * route reading two packs declares both. One import graph serves every pack.
 *
 * @param {string} projectRoot
 * @returns {Record<string, string[]>} outputFileTracingIncludes entries.
 */
export function runtimeDataPackRouteIncludes(projectRoot) {
  const absoluteRoot = path.resolve(projectRoot);
  const graph = buildImportGraph(absoluteRoot);

  /** @type {Record<string, string[]>} */
  const includes = {};
  for (const pack of RUNTIME_DATA_PACKS) {
    for (const route of readerRouteGlobs(graph, absoluteRoot, pack.module)) {
      includes[route] = [...new Set([...(includes[route] ?? []), ...pack.files])];
    }
  }
  return includes;
}
