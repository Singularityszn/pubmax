import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const UI_UX_AUDIT_ROOT = path.join(
  os.tmpdir(),
  `pubmax-ui-ux-battle-test-${typeof process.getuid === "function" ? process.getuid() : process.pid}`,
);

export function resolveAuditOutputRoot(outputName = "before") {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(outputName)) {
    throw new Error("UI_UX_OUTPUT must be one safe directory name");
  }
  return path.join(UI_UX_AUDIT_ROOT, outputName);
}

export async function prepareAuditOutputRoot(outputName) {
  await fs.mkdir(UI_UX_AUDIT_ROOT, { recursive: true });
  const root = await fs.lstat(UI_UX_AUDIT_ROOT);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error("UI UX audit root must be a real directory");
  }

  const outputRoot = resolveAuditOutputRoot(outputName);
  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(outputRoot, { recursive: true });
  return outputRoot;
}
