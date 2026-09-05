// How this repository runs the Vercel CLI. No Vercel CLI is a dependency here
// and none is assumed to be on the PATH, so npx fetches one unless an operator
// names the binary they already have. Both deploy commands ask this, so a
// machine with its own CLI is configured once.

export function vercelCommand(args, env = process.env) {
  const binary = env.PUBMAX_VERCEL_BIN;
  if (binary) return { command: binary, args: [...args] };
  return { command: "npx", args: ["-y", "vercel@latest", ...args] };
}
