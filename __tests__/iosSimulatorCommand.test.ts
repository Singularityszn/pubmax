import { afterEach, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync: execute }));
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  existsSync: vi.fn(() => true),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  execute.mockReset();
});

it("syncs and builds for the selected simulator without disabling signing or launching", async () => {
  vi.stubEnv("PUBMAX_IOS_SIMULATOR", "iPhone 17 Pro");
  vi.spyOn(console, "log").mockImplementation(() => {});
  const simulatorId = "11111111-2222-3333-4444-555555555555";
  execute.mockImplementation((file: string, args: string[]) => {
    if (file === "xcode-select") return "/Applications/Xcode.app/Contents/Developer";
    if (file === "xcrun" && args.join(" ") === "simctl list devices available --json") {
      return JSON.stringify({ devices: { runtime: [{
        name: "iPhone 17 Pro", udid: simulatorId, isAvailable: true, state: "Shutdown",
      }] } });
    }
    if (file === "npx" || file === "xcodebuild") return "";
    throw new Error(`Unexpected command: ${file} ${args.join(" ")}`);
  });

  const originalArgv = process.argv;
  process.argv = ["node", "scripts/ios-simulator.mjs"];
  try {
    const scriptPath = "../scripts/ios-simulator.mjs";
    await import(scriptPath);
  } finally {
    process.argv = originalArgv;
  }

  const calls = execute.mock.calls as [string, string[], unknown][];
  expect(calls.map(([file]) => file)).toEqual(["xcode-select", "xcrun", "npx", "xcodebuild"]);
  expect(calls[2][1]).toEqual(["cap", "sync", "ios"]);
  const args = calls[3][1];
  expect(args).toEqual([
    "-project", expect.stringMatching(/ios\/App\/App\.xcodeproj$/),
    "-scheme", "App", "-sdk", "iphonesimulator", "-configuration", "Debug",
    "-destination", `platform=iOS Simulator,id=${simulatorId}`,
    "-derivedDataPath", expect.stringMatching(/ios\/build$/), "build",
  ]);
});
