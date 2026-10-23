import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Read the canonical executable bytes without allowing HTML raw-text escapes. */
export function readThemeInitSource(): string {
  const source = readFileSync(
    join(/* turbopackIgnore: true */ process.cwd(), "public", "theme-init.js"),
    "utf8",
  );
  if (/<\/script|<!--|-->/i.test(source)) {
    throw new Error("The theme initializer contains an unsafe HTML script delimiter.");
  }
  return source;
}
