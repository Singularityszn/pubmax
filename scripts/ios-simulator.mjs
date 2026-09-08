#!/usr/bin/env node
// Build, and optionally boot, the iOS shell with Xcode's normal simulator signing.
// Simulator signing needs no Apple account. Store signing, provisioning, and
// entitlement verification remain owner steps (docs/STORE_READINESS.md section 8).
//
// Usage:
//   npm run ios:build                            build the App scheme for the simulator SDK
//   npm run ios:run                              build, boot a simulator, install, launch
//   PUBMAX_IOS_SIMULATOR="iPhone 17" npm run ios:run
//
// Four facts this script exists to hold, each one a way the obvious command
// fails on this project.
//
//  1. THERE IS NO WORKSPACE. Capacitor 8 generates a Swift Package Manager
//     project (ios/App/CapApp-SPM), not a CocoaPods one, so there is no Podfile
//     and no App.xcworkspace. `xcodebuild -workspace ios/App/App.xcworkspace`
//     therefore fails on a healthy checkout; the incantation is
//     `-project ios/App/App.xcodeproj`.
//  2. SYNC BEFORE BUILD. CapApp-SPM/Package.swift names each plugin by a
//     RELATIVE PATH into node_modules, so a checkout whose plugin set has moved
//     builds the previous plugin list until `npx cap sync ios` rewrites it.
//  3. THE BUNDLE ID IS READ, NEVER TYPED. It comes back out of the built .app's
//     own Info.plist, so `simctl launch` can only ever address the binary this
//     run produced.
//  4. THE SHELL IS REMOTE-URL, AND THE ORIGIN IS REPORTED, NEVER ASSUMED.
//     capacitor.config.ts points at production unless PUBMAX_NATIVE_SERVER_URL
//     names a local build (docs/CAPACITOR_WRAP.md). This script used to print
//     the production origin either way, so an operator reviewing a checkout was
//     told he was looking at what had shipped. It now reads the origin back out
//     of the config `npx cap sync` generated. With no network the shell serves
//     the bundled offline.html instead of the site, which is the wrap working
//     and not a build fault.
//
// A GREEN SIMULATOR BUILD PROVES THE CODE COMPILES, NEVER THE ENTITLEMENTS:
// with no team set Xcode writes an EMPTY entitlements file, so push and
// associated domains are absent from the built app however correct
// App.entitlements is. STORE_READINESS section 8 owns that proof.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IOS_DIR = join(ROOT, "ios");
const PROJECT = join(IOS_DIR, "App", "App.xcodeproj");
/** The config `npx cap sync ios` writes into the Xcode project. */
const IOS_SYNCED_CONFIG = join(IOS_DIR, "App", "App", "capacitor.config.json");
const SCHEME = "App";
// Derived data is build output, kept inside ios/ so it is obvious what wrote
// it and gitignored so it can never reach a commit.
const DERIVED_DATA = join(IOS_DIR, "build");
const APP_PATH = join(DERIVED_DATA, "Build", "Products", "Debug-iphonesimulator", "App.app");

// A preference order rather than one hardcoded device: a machine carrying any
// of these runs the check without being told which runtime it installed.
const PREFERRED_SIMULATORS = ["iPhone 17 Pro", "iPhone 17", "iPhone 16 Pro", "iPhone 16"];

const run = (file, args) => execFileSync(file, args, { cwd: ROOT, stdio: "inherit" });

const read = (file, args) => execFileSync(file, args, { cwd: ROOT, encoding: "utf8" }).trim();

function die(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function assertXcode() {
  let developerDir;
  try {
    developerDir = read("xcode-select", ["-p"]);
  } catch {
    die("xcode-select is not answering. Install Xcode, not just the Command Line Tools.");
  }
  if (developerDir.includes("CommandLineTools")) {
    die(
      "xcode-select points at the Command Line Tools, which cannot build an iOS app.\n" +
        "  Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer",
    );
  }
}

// An available iPhone simulator, newest known device first. Any other device on
// the machine is still reachable by name through PUBMAX_IOS_SIMULATOR.
function resolveSimulator() {
  const requested = process.env.PUBMAX_IOS_SIMULATOR?.trim();
  const listed = JSON.parse(read("xcrun", ["simctl", "list", "devices", "available", "--json"]));
  const devices = Object.values(listed.devices ?? {})
    .flat()
    .filter((device) => device.isAvailable !== false);

  if (requested) {
    const match = devices.find((device) => device.name === requested);
    if (match) return match;
    die(
      `No available simulator named "${requested}".\n` +
        `  Available: ${devices.map((device) => device.name).join(", ") || "(none)"}`,
    );
  }

  for (const name of PREFERRED_SIMULATORS) {
    const match = devices.find((device) => device.name === name);
    if (match) return match;
  }
  const anyIphone = devices.find((device) => device.name.startsWith("iPhone"));
  if (anyIphone) return anyIphone;

  die(
    "No available iPhone simulator. A fresh Xcode carries no iOS runtime:\n" +
      "  xcodebuild -downloadPlatform iOS\n" +
      "  then create a device in Xcode (Window > Devices and Simulators).",
  );
}

/**
 * The origin the built app will actually load, read back out of the config
 * `npx cap sync` generated for this platform. That file is the artefact the
 * binary carries, so it cannot disagree with what the shell does; retyping
 * capacitor.config.ts's fallback constant here would be a second place for the
 * shipped origin to drift from what the operator is told.
 */
function syncedServerUrl(configPath) {
  try {
    return JSON.parse(readFileSync(configPath, "utf8")).server?.url ?? "an unset origin";
  } catch {
    return "an origin this script could not read";
  }
}

function buildForSimulator(simulator) {
  console.log("\n> npx cap sync ios");
  run("npx", ["cap", "sync", "ios"]);

  console.log(`\n> xcodebuild (${SCHEME}, Debug, ${simulator.name}, simulator signing)`);
  run("xcodebuild", [
    "-project",
    PROJECT,
    "-scheme",
    SCHEME,
    "-sdk",
    "iphonesimulator",
    "-configuration",
    "Debug",
    // The udid rather than the name: two runtimes can carry the same device
    // name, and xcodebuild then picks one of them for you.
    "-destination",
    `platform=iOS Simulator,id=${simulator.udid}`,
    "-derivedDataPath",
    DERIVED_DATA,
    "build",
  ]);

  if (!existsSync(APP_PATH)) {
    die(`xcodebuild reported success but ${APP_PATH} is missing.`);
  }
  return APP_PATH;
}

function bootAndLaunch(simulator, appPath) {
  const bundleId = read("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    join(appPath, "Info.plist"),
  ]);

  console.log(`\n> booting ${simulator.name}`);
  if (simulator.state !== "Booted") {
    try {
      run("xcrun", ["simctl", "boot", simulator.udid]);
    } catch {
      // A device booted by another window answers a non-zero "current state:
      // Booted", which is the state this wants rather than a failure.
      console.log("  (already booted)");
    }
  }
  run("xcrun", ["simctl", "bootstatus", simulator.udid, "-b"]);
  run("open", ["-a", "Simulator"]);

  console.log(`\n> installing and launching ${bundleId}`);
  run("xcrun", ["simctl", "install", simulator.udid, appPath]);
  run("xcrun", ["simctl", "launch", simulator.udid, bundleId]);

  console.log(
    `\n${bundleId} is running on ${simulator.name}.\n` +
      `  It loads ${syncedServerUrl(IOS_SYNCED_CONFIG)}.\n` +
      "  With no network it serves the bundled offline.html instead, which is\n" +
      "  the wrap working.\n" +
      `  Screenshot it with: xcrun simctl io ${simulator.udid} screenshot shot.png`,
  );
}

assertXcode();
const simulator = resolveSimulator();
const appPath = buildForSimulator(simulator);
console.log(`\nBuilt ${appPath}`);
if (process.argv.includes("--run")) bootAndLaunch(simulator, appPath);
