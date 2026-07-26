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

export async function publishStagedDirectory({
  stagedDir,
  targetDir,
  requiredFiles = [],
  manifestBudgetBytes = Number.POSITIVE_INFINITY,
  totalBudgetBytes = Number.POSITIVE_INFINITY,
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
  if (new Set(shardFiles).size !== shardFiles.length) {
    throw new Error("Staged manifest contains duplicate shard URLs");
  }
  const expectedFiles = new Set(["manifest.json", ...shardFiles]);
  const stagedEntries = await readdir(stagedDir, { withFileTypes: true });
  const unexpectedEntry = stagedEntries.find(
    (entry) => !entry.isFile() || !expectedFiles.has(entry.name),
  );
  if (unexpectedEntry) {
    throw new Error(`Unexpected staged entry: ${unexpectedEntry.name}`);
  }

  const hash = createHash("sha256");
  hash.update(manifestText);
  let shardBytes = 0;
  for (const file of [...shardFiles].sort()) {
    const body = await readFile(path.join(stagedDir, file));
    hash.update(file);
    hash.update(body);
    shardBytes += body.byteLength;
  }
  const generation = hash.digest("hex").slice(0, 16);
  const packRoot = path.join(targetDir, "packs");
  const generationDir = path.join(packRoot, generation);
  const publicPrefix = `/data/uk_base/packs/${generation}/`;
  const nextManifest = {
    ...manifest,
    shards: manifest.shards.map((shard, index) => ({
      ...shard,
      url: `${publicPrefix}${shardFiles[index]}`,
    })),
  };
  const nextManifestText = JSON.stringify(nextManifest);
  const manifestBytes = Buffer.byteLength(nextManifestText);
  const totalBytes = manifestBytes + shardBytes;
  if (manifestBytes >= manifestBudgetBytes) {
    throw new Error(
      `Published manifest is ${manifestBytes} bytes, over the ${manifestBudgetBytes} byte budget`,
    );
  }
  if (totalBytes >= totalBudgetBytes) {
    throw new Error(
      `Published tree is ${totalBytes} bytes, over the ${totalBudgetBytes} byte budget`,
    );
  }

  await mkdir(targetDir, { recursive: true });
  await mkdir(packRoot, { recursive: true });
  const stagedManifestPath = path.join(
    targetDir,
    `.manifest-${process.pid}-${Date.now()}.json`,
  );
  try {
    await writeFile(stagedManifestPath, nextManifestText);
    await rm(manifestPath);
    if (await exists(generationDir)) {
      await rm(stagedDir, { recursive: true, force: true });
    } else {
      await rename(stagedDir, generationDir);
    }
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
          entry.name !== "manifest.json",
      )
      .map((entry) => rm(path.join(targetDir, entry.name), { force: true })),
  );
  const generations = await readdir(packRoot, { withFileTypes: true });
  await Promise.all(
    generations
      .filter(
        (entry) =>
          entry.name !== generation,
      )
      .map((entry) =>
        rm(path.join(packRoot, entry.name), { recursive: true, force: true }),
      ),
  );

  return { generation, manifestBytes, shardBytes, totalBytes };
}
