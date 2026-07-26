import { access, copyFile, rename, rm } from "node:fs/promises";
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
  preserveFiles = [],
  requiredFiles = [],
}) {
  for (const file of preserveFiles) {
    const current = path.join(targetDir, file);
    if (await exists(current)) await copyFile(current, path.join(stagedDir, file));
  }
  for (const file of requiredFiles) {
    await access(path.join(stagedDir, file));
  }

  const backupDir = path.join(
    path.dirname(targetDir),
    `.${path.basename(targetDir)}-backup-${process.pid}-${Date.now()}`,
  );
  const hadTarget = await exists(targetDir);
  let movedTarget = false;
  let published = false;
  try {
    if (hadTarget) {
      await rename(targetDir, backupDir);
      movedTarget = true;
    }
    await rename(stagedDir, targetDir);
    published = true;
  } catch (error) {
    if (movedTarget && !(await exists(targetDir))) {
      await rename(backupDir, targetDir);
      movedTarget = false;
    }
    throw error;
  } finally {
    if (published && movedTarget) {
      await rm(backupDir, { recursive: true, force: true });
    }
  }
}
