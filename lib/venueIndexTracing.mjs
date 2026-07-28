import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const RUNTIME_SOURCE_ROOTS = ["app", "components", "lib"];
const APP_ENTRY_NAMES = new Set(["page", "route", "opengraph-image"]);

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

/**
 * Find App Router runtime entries whose local static-import graph reaches
 * lib/venueIndex.ts. The result is suitable as outputFileTracingIncludes keys.
 *
 * @param {string} projectRoot
 * @returns {string[]}
 */
export function discoverVenueIndexRouteGlobs(projectRoot) {
  const absoluteRoot = path.resolve(projectRoot);
  const appRoot = path.join(absoluteRoot, "app");
  const files = [];
  for (const sourceRoot of RUNTIME_SOURCE_ROOTS) {
    collectSourceFiles(path.join(absoluteRoot, sourceRoot), files);
  }

  const sourceFiles = new Set(files);
  const venueIndexFile = path.join(absoluteRoot, "lib", "venueIndex.ts");
  if (!sourceFiles.has(venueIndexFile)) return [];

  const dependencies = new Map();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const resolved = runtimeImportSpecifiers(source)
      .map((specifier) => resolveLocalImport(file, specifier, absoluteRoot, sourceFiles))
      .filter(Boolean);
    dependencies.set(file, resolved);
  }

  // Grow the reverse dependency closure to a fixed point. This handles cycles
  // without caching a false result before another edge closes the path.
  const venueIndexReaders = new Set([venueIndexFile]);
  let addedReader = true;
  while (addedReader) {
    addedReader = false;
    for (const file of files) {
      if (venueIndexReaders.has(file)) continue;
      const reaches = (dependencies.get(file) ?? []).some((dependency) =>
        venueIndexReaders.has(dependency),
      );
      if (!reaches) continue;
      venueIndexReaders.add(file);
      addedReader = true;
    }
  }

  const routes = new Set();
  for (const file of files) {
    if (!file.startsWith(`${appRoot}${path.sep}`) || !venueIndexReaders.has(file)) continue;
    const route = appEntryRouteGlob(file, appRoot);
    if (route) routes.add(route);
  }
  return [...routes].sort();
}
