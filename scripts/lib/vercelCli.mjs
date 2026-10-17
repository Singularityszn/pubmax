// How this repository runs the Vercel CLI. No Vercel CLI is a dependency here
// and none is assumed to be on the PATH, so npx fetches one unless an operator
// names the binary they already have. Both deploy commands ask this, so a
// machine with its own CLI is configured once.
//
// The npx fallback names an EXACT version, never `latest`: `npm run
// release:prod` runs this with production credentials, and `latest` would run
// whatever was published to npm that minute. Raise the pin on purpose, in its
// own commit. 62.1.0 is a published release (npm, 1 Oct 2026) at least two
// weeks old when pinned, and above the 53.0.0 floor the vendored
// vercel-optimize skill requires (.agents/skills/vercel-optimize/lib/vercel.mjs
// MIN_CLI_VERSION).
export const VERCEL_CLI_VERSION = "62.1.0";

export function vercelCommand(args, env = process.env) {
  const binary = env.PUBMAX_VERCEL_BIN;
  if (binary) return { command: binary, args: [...args] };
  return { command: "npx", args: ["-y", `vercel@${VERCEL_CLI_VERSION}`, ...args] };
}
