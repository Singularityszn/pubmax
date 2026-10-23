import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A fixed directory under a shared temp folder can already belong to another
// user (mode 755), and this user cannot write it. Name the directory for the
// user who creates it.
export function runnerShotDir(name: string): string {
  const dir = join(tmpdir(), `${name}-${process.getuid?.() ?? process.pid}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
