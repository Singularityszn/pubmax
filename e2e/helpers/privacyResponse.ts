import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);

export async function assertPrivateResponses(
  directory: string,
  bodies: readonly string[],
  forbidden: readonly string[],
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const files = await Promise.all(bodies.map(async (body, index) => {
    const file = join(directory, `privacy-response-${index}.txt`);
    await writeFile(file, body, "utf8");
    return file;
  }));
  const { stdout } = await execute("npm", [
    "run", "gate:privacy", "--", ...files,
    ...forbidden.flatMap((literal) => ["--forbid", literal]),
  ], { cwd: fileURLToPath(new URL("../../", import.meta.url)) });
  return stdout;
}
