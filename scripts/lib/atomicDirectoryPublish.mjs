import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

async function exists(pathname) {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}

function generationFromManifest(manifest) {
  const url = manifest?.shards?.[0]?.url;
  if (typeof url !== "string") return null;
  const match = url.match(/^\/data\/uk_base\/packs\/([a-f0-9]{16})\//);
  if (match) return match[1];
  return /^\/data\/uk_base\/[^/]+\.json$/.test(url) ? "legacy" : null;
}

function previousGenerationsFromManifest(manifest) {
  if (!Array.isArray(manifest?.previousGenerations)) return [];
  return manifest.previousGenerations
    .filter(
      (generation) =>
        generation === "legacy" ||
        (typeof generation === "string" && /^[a-f0-9]{16}$/.test(generation)),
    )
    .slice(0, 1);
}

export async function publishStagedDirectory({
  stagedDir,
  targetDir,
  requiredFiles = [],
}) {
  for (const file of requiredFiles) {
    await access(path.join(stagedDir, file));
  }

  const manifestPath = path.join(stagedDir, "manifest.json");
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.shards)) {
    throw new Error("Staged manifest is malformed");
  }

  const shardFiles = manifest.shards.map((shard) => {
    const url = typeof shard?.url === "string" ? shard.url : "";
    const file = url.replace(/^\/data\/uk_base\//, "");
    if (
      !file ||
      file === url ||
      path.isAbsolute(file) ||
      file.includes("..") ||
      path.dirname(file) !== "."
    ) {
      throw new Error(`Invalid staged shard URL: ${url}`);
    }
    return file;
  });
  for (const file of shardFiles) {
    await access(path.join(stagedDir, file));
  }

  const hash = createHash("sha256");
  hash.update(manifestText);
  for (const file of [...shardFiles].sort()) {
    hash.update(file);
    hash.update(await readFile(path.join(stagedDir, file)));
  }
  const generation = hash.digest("hex").slice(0, 16);
  const packRoot = path.join(targetDir, "packs");
  const generationDir = path.join(packRoot, generation);
  const publicPrefix = `/data/uk_base/packs/${generation}/`;
  let currentManifest = null;
  try {
    currentManifest = JSON.parse(
      await readFile(path.join(targetDir, "manifest.json"), "utf8"),
    );
  } catch {
    currentManifest = null;
  }
  const currentGeneration = generationFromManifest(currentManifest);
  const priorGenerations =
    currentGeneration === generation
      ? previousGenerationsFromManifest(currentManifest)
      : currentGeneration
        ? [currentGeneration]
        : [];
  const nextManifest = {
    ...manifest,
    previousGenerations: priorGenerations,
    shards: manifest.shards.map((shard, index) => ({
      ...shard,
      url: `${publicPrefix}${shardFiles[index]}`,
    })),
  };

  await mkdir(packRoot, { recursive: true });
  await rm(manifestPath);
  if (await exists(generationDir)) {
    await rm(stagedDir, { recursive: true, force: true });
  } else {
    await rename(stagedDir, generationDir);
  }

  const stagedManifestPath = path.join(
    targetDir,
    `.manifest-${process.pid}-${Date.now()}.json`,
  );
  try {
    await writeFile(stagedManifestPath, JSON.stringify(nextManifest));
    await rename(stagedManifestPath, path.join(targetDir, "manifest.json"));
  } finally {
    await rm(stagedManifestPath, { force: true });
  }

  const rootEntries = await readdir(targetDir, { withFileTypes: true });
  await Promise.all(
    rootEntries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".json") &&
          entry.name !== "manifest.json" &&
          !priorGenerations.includes("legacy"),
      )
      .map((entry) => rm(path.join(targetDir, entry.name), { force: true })),
  );
  const generations = await readdir(packRoot, { withFileTypes: true });
  await Promise.all(
    generations
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name !== generation &&
          !priorGenerations.includes(entry.name),
      )
      .map((entry) =>
        rm(path.join(packRoot, entry.name), { recursive: true, force: true }),
      ),
  );
}
