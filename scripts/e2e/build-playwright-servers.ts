// Builds each Playwright production server once and packs it, so the nightly
// shards serve that one build with PW_PREBUILT=1 instead of each building
// their own (docs/CI_RUNBOOK.md, "The nightly full suite").
//
// A pack holds one server's NEXT_DIST_DIR without its build cache. The first
// pack also holds every other ignored file the builds wrote, for example the
// MapLibre worker and generated server data. Committed files are not packed:
// the build wrapper restores public/data from HEAD, so a checkout of the same
// commit serves the same data packs. Each pack is stamped with that commit,
// and .github/actions/pubmax-e2e-prebuilt refuses a pack from another one.
//
// Usage: npx tsx scripts/e2e/build-playwright-servers.ts <output-directory>

import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { PREBUILT_SERVER_BUILDS } from "../../playwright.config";

const STAMP = "pubmax-e2e-commit";

function git(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

// Ignored files too: a build writes only ignored files outside public/data.
function untrackedFiles(): Set<string> {
  const listed = git(["ls-files", "-z", "--others", "-x", "/node_modules/", "-x", "/.ci-job-cache/"]);
  return new Set(listed.split("\0").filter(Boolean));
}

const [outputArg] = process.argv.slice(2);
if (!outputArg) {
  console.error("Usage: npx tsx scripts/e2e/build-playwright-servers.ts <output-directory>");
  process.exit(2);
}
const output = resolve(outputArg);
mkdirSync(output, { recursive: true });

const commit = git(["rev-parse", "HEAD"]).trim();
const before = untrackedFiles();
const distDirs = PREBUILT_SERVER_BUILDS.map((server) => server.env.NEXT_DIST_DIR);

for (const server of PREBUILT_SERVER_BUILDS) {
  console.log(`Building the ${server.name} server into ${server.env.NEXT_DIST_DIR}`);
  const started = Date.now();
  const result = spawnSync(server.command, {
    shell: true,
    stdio: "inherit",
    env: { ...process.env, ...server.env },
  });
  if (result.status !== 0) {
    console.error(`The ${server.name} server build failed.`);
    process.exit(result.status ?? 1);
  }
  writeFileSync(join(server.env.NEXT_DIST_DIR, STAMP), `${commit}\n`);
  console.log(`Built the ${server.name} server in ${Math.round((Date.now() - started) / 1000)} s`);
}

const written = [...untrackedFiles()].filter((file) =>
  !before.has(file) && !distDirs.some((dir) => file.startsWith(`${dir}/cache/`)));

PREBUILT_SERVER_BUILDS.forEach((server, index) => {
  const own = (file: string) => file.startsWith(`${server.env.NEXT_DIST_DIR}/`);
  const files = written.filter((file) =>
    own(file) || (index === 0 && !distDirs.some((dir) => file.startsWith(`${dir}/`))));
  if (!files.includes(`${server.env.NEXT_DIST_DIR}/BUILD_ID`)) {
    console.error(`The ${server.name} server wrote no ${server.env.NEXT_DIST_DIR}/BUILD_ID.`);
    process.exit(1);
  }
  const list = join(output, `${server.name}.files`);
  const pack = join(output, `${server.name}.tar`);
  writeFileSync(list, `${files.join("\0")}\0`);
  const tar = spawnSync("tar", ["-cf", pack, "--null", "-T", list], { stdio: "inherit" });
  if (tar.status !== 0) {
    console.error(`Packing the ${server.name} server failed.`);
    process.exit(tar.status ?? 1);
  }
  const megabytes = Math.round(statSync(pack).size / 1024 / 1024);
  console.log(`Packed ${files.length} files of the ${server.name} server at ${commit} (${megabytes} MB)`);
});
