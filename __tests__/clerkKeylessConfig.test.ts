import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Clerk keyless mode", () => {
  it("stays off until PUBMAXX carries explicit Clerk keys", () => {
    const script = [
      'import("./next.config.mjs").then(async ({ default: config }) => {',
      "  const configured = config.env?.NEXT_PUBLIC_CLERK_KEYLESS_DISABLED;",
      "  if (configured) process.env.NEXT_PUBLIC_CLERK_KEYLESS_DISABLED = configured;",
      '  const { getKeylessStatus } = require("./node_modules/@clerk/nextjs/dist/cjs/app-router/server/keyless-provider.js");',
      "  const status = await getKeylessStatus({});",
      "  process.stdout.write(JSON.stringify({ configured, status }));",
      "});",
    ].join("\n");
    const env = { ...process.env };
    env.NODE_ENV = "development";
    delete env.CI;
    delete env.CONTINUOUS_INTEGRATION;
    delete env.NEXT_PUBLIC_CLERK_KEYLESS_DISABLED;

    const output = execFileSync(process.execPath, ["-e", script], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
    });

    expect(JSON.parse(output)).toEqual({
      configured: "1",
      status: {
        shouldRunAsKeyless: false,
        runningWithClaimedKeys: false,
      },
    });
  });
});
