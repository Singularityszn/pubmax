#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  restoreCommittedBundledData,
  untrackedBundledData,
} from "./lib/committedBundledDataPaths.mjs";

const [, , command, ...args] = process.argv;

if (!command) {
  console.error("Usage: node scripts/run-with-restored-bundled-data.mjs <command> [args...]");
  process.exit(2);
}

const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;

// Only the mapped verifier has this keyless contract. Other payloads retain
// their existing environment, including full verification and data builders.
const mappedVerifier = /^(?:node|node\.exe)$/.test(basename(command))
  && args[0] !== undefined
  && resolve(args[0]) === resolve("scripts/verify-changed.mjs");

// Next and Vite can reload these after process environment filtering. Refuse
// that context rather than touching private files or bypassing their loaders.
const projectEnvFiles = [
  ".env", ".env.local",
  ".env.development", ".env.development.local",
  ".env.test", ".env.test.local",
  ".env.production", ".env.production.local",
];
if (mappedVerifier) {
  const unsafeFile = projectEnvFiles.find(name => existsSync(resolve(name)));
  if (unsafeFile) {
    console.error(`Mapped verification refuses project environment file ${unsafeFile}. Use a checkout without standard project env files.`);
    process.exit(2);
  }
}

function mappedVerificationEnvironment() {
  // Runtime locations and the documented verifier/harness controls only.
  // An allowlist also excludes new provider credentials without naming them.
  const names = [
    "PATH", "Path", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
    "TMPDIR", "TMP", "TEMP", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
    "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "NO_COLOR", "FORCE_COLOR", "CI", "GITHUB_ACTIONS",
    "DEPLOYMENT_VERSION", "PUBMAX_VERIFY_COMMITTED_DATA", "PUBMAX_VERIFY_FULL", "PUBMAX_VERIFY_BASE",
    "PUBMAX_PG_MAX_CLUSTERS", "PUBMAX_RLS_NO_PG", "PUBMAX_RLS_ALLOW_SKIP",
    "PUBMAX_KNIP_BASE_REF", "PUBMAX_KNIP_AHEAD", "PUBMAX_KNIP_HEAD_REPORT", "PUBMAX_KNIP_BASE_REPORT",
  ];
  const env = Object.fromEntries(names.flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]]]));
  // Bound mapped verification at its actual spawn, independently of the
  // coding parent's login profile. Preserve smaller heaps, cap larger ones,
  // and never forward arbitrary preloads or env-file options. One Vitest
  // worker applies even when its command line requests a larger pool.
  const options = ((process.env.NODE_OPTIONS ?? "").match(/(?:[^ "]+|"(?:\\[\s\S]|[^"\\])*")+/g) ?? [])
    .map(option => option.replace(/"((?:\\[\s\S]|[^"\\])*)"/g,
      (_, quoted) => quoted.replace(/\\([\s\S])/g, "$1")));
  let inheritedHeap = 2048;
  for (const option of options) {
    const match = /^--max[-_]old[-_]space[-_]size=(\+?\d+)$/.exec(option);
    if (match) inheritedHeap = Number(match[1]) || 2048;
  }
  const heap = Math.min(inheritedHeap, 2048);
  env.NODE_OPTIONS = `--max-old-space-size=${heap}`;
  env.VITEST_MAX_WORKERS = "1";
  return env;
}

const untrackedBefore = untrackedBundledData();

let result;
try {
  result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: mappedVerifier ? mappedVerificationEnvironment() : { ...process.env, OPENROUTER_API_KEY: "" },
    stdio: "inherit",
  });
} finally {
  if (!restoreCommittedBundledData(process.cwd(), { untrackedBefore })) {
    console.error("Failed to restore committed bundled data from HEAD.");
    process.exit(1);
  }
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.signal) {
  console.error(`Wrapped command ended with ${result.signal}.`);
  process.exit(1);
}
process.exit(result.status ?? 1);
