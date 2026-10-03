import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A fixed directory under the shared temp folder can already belong to the
// console user (mode 755). The dedicated runner cannot write it. Name the
// directory for the user who creates it.
export function runnerShotDir(name: string): string {
  const dir = join(tmpdir(), `${name}-${process.getuid?.() ?? process.pid}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
