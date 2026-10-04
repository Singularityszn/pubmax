#!/usr/bin/env node
// Dependency install scripts run only from the allowlist.
//
// `.npmrc` sets `ignore-scripts=true`, so `npm ci` runs no preinstall, install
// or postinstall script from any package. A hostile transitive dependency gets
// no code execution at install time, on a runner or on a laptop. The other
// half is the `allowScripts` field of each package.json this repo installs:
// every lockfile package that declares an install script has a row there,
// `true` when its script runs and `false` when it does not. npm 11.10+ reads
// that field itself; INSTALL_SCRIPT_REASONS below records why each row says
// what it says.
//
//   node scripts/ci/install-script-allowlist.mjs --check
//     Fails when a lockfile package with an install script has no
//     `allowScripts` row, when a row names a package no lockfile installs with
//     one, or when a row has no reason here. `npm run verify` runs this.
//   node scripts/ci/install-script-allowlist.mjs
//     The check, then `npm rebuild` for the `true` rows, in each package
//     directory that has node_modules. CI runs this straight after `npm ci`.
//
// A new dependency with an install script therefore fails verify until a
// reviewer reads that script and adds a row and a reason. `false` is the
// default answer: allow a script only when the package does not work, or
// works measurably worse, without it.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Each directory holding a committed package.json and package-lock.json. */
export const PACKAGE_DIRS = [".", "scripts/chatgpt-map"];

/** @type {Record<string, string>} */
export const INSTALL_SCRIPT_REASONS = {
  esbuild:
    "runs: postinstall checks the @esbuild platform binary matches and links bin/esbuild to it, instead of a node shim that spawns the binary on every call",
  "core-js": "skipped: postinstall only prints a funding banner",
  fsevents:
    "skipped: the package ships a prebuilt fsevents.node, so the implicit node-gyp rebuild only recompiles it",
  "unrs-resolver":
    "skipped: postinstall only downloads a native binding when the optional @unrs/resolver-binding-* package is missing, and the lockfile installs that package",
};

/**
 * The package names in a lockfile that declare an install script.
 * @param {{ packages?: Record<string, { name?: string; hasInstallScript?: boolean }> }} lock
 * @returns {string[]}
 */
export function packagesWithInstallScripts(lock) {
  const names = new Set();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path || !entry.hasInstallScript) continue;
    names.add(entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length));
  }
  return [...names].sort();
}

/**
 * @param {string[]} found names with an install script in this lockfile
 * @param {Record<string, boolean>} allowScripts the package.json field
 * @param {Record<string, string>} reasons
 */
export function checkAllowlist(found, allowScripts, reasons) {
  const unlisted = found.filter((name) => !Object.hasOwn(allowScripts, name));
  const stale = Object.keys(allowScripts)
    .filter((name) => !found.includes(name))
    .sort();
  const unexplained = Object.keys(allowScripts)
    .filter((name) => !reasons[name])
    .sort();
  const notBoolean = Object.entries(allowScripts)
    .filter(([, value]) => typeof value !== "boolean")
    .map(([name]) => name)
    .sort();
  const toRun = found.filter((name) => allowScripts[name] === true);
  return { unlisted, stale, unexplained, notBoolean, toRun };
}

/** @param {string} dir */
function readPackage(dir) {
  const manifest = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(ROOT, dir, "package-lock.json"), "utf8"));
  return { allowScripts: manifest.allowScripts ?? {}, found: packagesWithInstallScripts(lock) };
}

function main() {
  const checkOnly = process.argv.includes("--check");
  let failed = false;
  /** @type {Array<{ dir: string; toRun: string[] }>} */
  const plan = [];

  for (const dir of PACKAGE_DIRS) {
    const { allowScripts, found } = readPackage(dir);
    const { unlisted, stale, unexplained, notBoolean, toRun } = checkAllowlist(
      found,
      allowScripts,
      INSTALL_SCRIPT_REASONS,
    );
    const manifest = join(dir, "package.json");
    for (const name of unlisted) {
      console.error(`${name} declares an install script and has no allowScripts row in ${manifest}. Read the script, then add a row and a reason in scripts/ci/install-script-allowlist.mjs.`);
    }
    for (const name of stale) {
      console.error(`${manifest} allowScripts names ${name}, which its lockfile does not install with an install script. Remove the row.`);
    }
    for (const name of unexplained) {
      console.error(`${manifest} allowScripts names ${name} with no reason in INSTALL_SCRIPT_REASONS (scripts/ci/install-script-allowlist.mjs).`);
    }
    for (const name of notBoolean) {
      console.error(`${manifest} allowScripts row ${name} must be true or false.`);
    }
    if (unlisted.length + stale.length + unexplained.length + notBoolean.length > 0) failed = true;
    plan.push({ dir, toRun });
  }
  if (failed) process.exit(1);

  if (checkOnly) {
    console.log("allowScripts covers every lockfile package with an install script.");
    return;
  }

  for (const { dir, toRun } of plan) {
    if (toRun.length === 0) continue;
    const cwd = join(ROOT, dir);
    if (!existsSync(join(cwd, "node_modules"))) {
      console.log(`Skipping ${dir}: its dependencies are not installed.`);
      continue;
    }
    console.log(`Running allowlisted install scripts in ${dir}: ${toRun.join(", ")}`);
    const result = spawnSync("npm", ["rebuild", "--ignore-scripts=false", ...toRun], { cwd, stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
