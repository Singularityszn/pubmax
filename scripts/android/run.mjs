// `npm run android:run` - boot a headless emulator, install the debug APK,
// launch it and capture the first screen.
//
// The APK has to exist already: `npm run android:build` makes it. This script
// only installs and drives, so a failure here is never a build failure.
//
// TWO things this script learned from a real run and encodes rather than
// leaving to whoever runs it next.
//
// (1) THE APP IS NOT NECESSARILY WHAT IS ON SCREEN. Under `swiftshader_indirect`
// SystemUI is slow enough to hit its own ANR, and that dialog takes focus over
// a perfectly healthy app. So the screenshot is not taken on a timer: it waits
// until the window manager reports OUR activity as the focused window, because
// a shot taken any other way can show somebody else's dialog and then be filed
// as evidence about us.
//
// (2) FOCUS IS NOT SETTLED. Holding the window only means the activity is up.
// The WebView is still fetching production and SystemUI has not finished
// applying the status-bar icon appearance, so the shot waits `SETTLE_MS`
// beyond focus. See that constant for what a shot taken sooner showed.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requireAndroidToolchain, requireSdkTool } from "./toolchain.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apkPath = path.join(repoRoot, "android/app/build/outputs/apk/debug/app-debug.apk");
const APPLICATION_ID = "com.pubmaxx.app";
/** The config `npx cap sync android` writes into the app's assets. */
const SYNCED_CONFIG = path.join(
  repoRoot,
  "android/app/src/main/assets/capacitor.config.json",
);
const LAUNCH_COMPONENT = `${APPLICATION_ID}/.MainActivity`;
const FOCUSED_WINDOW_MARKER = `${APPLICATION_ID}/${APPLICATION_ID}.MainActivity`;

const AVD_NAME = process.env.PUBMAX_ANDROID_AVD ?? "pubmaxx";
const BOOT_TIMEOUT_MS = 8 * 60 * 1000;
const FOCUS_TIMEOUT_MS = 3 * 60 * 1000;
const MAX_RELAUNCHES = 6;

// How long to let the screen settle once our activity holds the window. Two
// things are still moving at that moment and both are slow under software
// rendering: the WebView is fetching the remote origin over the network,
// and SystemUI has not finished applying the status-bar icon appearance the
// SystemBars plugin asked for. A shot taken at ten seconds caught white icons
// over the light page and looked like a contrast bug in the app; the same
// device painted them correctly a minute later with nothing touched.
const SETTLE_MS = 30 * 1000;

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

const screenshotPath = path.resolve(
  repoRoot,
  arg("out") ?? "android/build/emulator/first-screen.png",
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The origin the installed app will actually load, read back out of the config
 * `npx cap sync` generated for this platform. That file is the artefact the
 * APK carries, so it cannot disagree with what the shell does. Both run scripts
 * used to name the production origin whatever `PUBMAX_NATIVE_SERVER_URL` was
 * set to, which told an operator reviewing a checkout that he was looking at
 * what had shipped (docs/CAPACITOR_WRAP.md).
 */
function syncedServerUrl(configPath) {
  try {
    return JSON.parse(readFileSync(configPath, "utf8")).server?.url ?? "an unset origin";
  } catch {
    return "an origin this script could not read";
  }
}


function adbOut(toolchain, args) {
  const result = spawnSync(toolchain.adb, args, { encoding: "utf8", env: toolchain.env });
  return result.status === 0 ? (result.stdout ?? "") : "";
}

function adbRun(toolchain, args, { allowFailure = false } = {}) {
  const result = spawnSync(toolchain.adb, args, { stdio: "inherit", env: toolchain.env });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`[pubmaxx] adb ${args.join(" ")} exited ${result.status}`);
  }
  return result.status;
}

/** The API level the Android project declares, so a new AVD cannot drift off it. */
function compileSdkVersion() {
  const variables = readFileSync(path.join(repoRoot, "android/variables.gradle"), "utf8");
  const match = variables.match(/compileSdkVersion\s*=\s*(\d+)/);
  if (!match) throw new Error("[pubmaxx] android/variables.gradle states no compileSdkVersion.");
  return match[1];
}

function ensureAvd(toolchain) {
  const avdmanager = requireSdkTool(toolchain.avdmanager, "cmdline-tools;latest");
  const listed = spawnSync(avdmanager, ["list", "avd"], { encoding: "utf8", env: toolchain.env });
  if ((listed.stdout ?? "").includes(`Name: ${AVD_NAME}`)) return;

  const abi = process.arch === "arm64" ? "arm64-v8a" : "x86_64";
  const image = `system-images;android-${compileSdkVersion()};google_apis;${abi}`;
  if (!existsSync(path.join(toolchain.androidHome, image.replaceAll(";", "/")))) {
    throw new Error(
      `[pubmaxx] No AVD named ${AVD_NAME} and no system image to make one from.\n` +
        `  sdkmanager --install "${image}" "emulator" "platform-tools"`,
    );
  }

  console.log(`[pubmaxx] Creating AVD ${AVD_NAME} from ${image}`);
  const created = spawnSync(avdmanager, ["create", "avd", "-n", AVD_NAME, "-k", image], {
    input: "no\n",
    encoding: "utf8",
    env: toolchain.env,
  });
  if (created.status !== 0) {
    throw new Error(`[pubmaxx] avdmanager create avd failed:\n${created.stderr ?? ""}`);
  }
}

function runningEmulatorSerial(toolchain) {
  return adbOut(toolchain, ["devices"])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("emulator-") && line.endsWith("device"))
    .map((line) => line.split(/\s+/)[0])[0];
}

async function bootEmulator(toolchain) {
  const already = runningEmulatorSerial(toolchain);
  if (already) {
    console.log(`[pubmaxx] Reusing running emulator ${already}`);
    return already;
  }

  requireSdkTool(toolchain.emulator, "emulator");
  console.log(`[pubmaxx] Booting ${AVD_NAME} headless`);
  const child = spawn(
    toolchain.emulator,
    [
      "-avd",
      AVD_NAME,
      "-no-window",
      "-no-audio",
      "-no-boot-anim",
      "-no-snapshot",
      "-gpu",
      "swiftshader_indirect",
    ],
    { detached: true, stdio: "ignore", env: toolchain.env },
  );
  child.unref();

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const serial = runningEmulatorSerial(toolchain);
    if (serial) {
      const booted = adbOut(toolchain, ["-s", serial, "shell", "getprop", "sys.boot_completed"]);
      if (booted.trim() === "1") {
        console.log(`[pubmaxx] ${serial} booted`);
        return serial;
      }
    }
    await sleep(5000);
  }
  throw new Error(`[pubmaxx] ${AVD_NAME} did not finish booting within ${BOOT_TIMEOUT_MS}ms.`);
}

function focusedWindow(toolchain, serial) {
  const dump = adbOut(toolchain, ["-s", serial, "shell", "dumpsys", "window", "displays"]);
  const line = dump.split("\n").find((candidate) => candidate.includes("mCurrentFocus"));
  return line?.trim() ?? "";
}

async function launchAndWaitForFocus(toolchain, serial) {
  const deadline = Date.now() + FOCUS_TIMEOUT_MS;
  let relaunches = 0;

  adbRun(toolchain, ["-s", serial, "shell", "am", "start", "-n", LAUNCH_COMPONENT]);

  while (Date.now() < deadline) {
    await sleep(5000);
    const focus = focusedWindow(toolchain, serial);
    if (focus.includes(FOCUSED_WINDOW_MARKER)) return;

    if (relaunches < MAX_RELAUNCHES) {
      relaunches += 1;
      console.log(`[pubmaxx] ${focus || "no focused window"}; relaunching (${relaunches})`);
      adbRun(toolchain, ["-s", serial, "shell", "input", "keyevent", "KEYCODE_HOME"], {
        allowFailure: true,
      });
      await sleep(3000);
      adbRun(toolchain, ["-s", serial, "shell", "am", "start", "-n", LAUNCH_COMPONENT], {
        allowFailure: true,
      });
    }
  }
  throw new Error(
    `[pubmaxx] ${APPLICATION_ID} never took the focused window. ` +
      `Last focus: ${focusedWindow(toolchain, serial) || "none"}`,
  );
}

function capture(toolchain, serial) {
  const result = spawnSync(toolchain.adb, ["-s", serial, "exec-out", "screencap", "-p"], {
    maxBuffer: 64 * 1024 * 1024,
    env: toolchain.env,
  });
  if (result.status !== 0 || !result.stdout?.length) {
    throw new Error("[pubmaxx] screencap produced no image.");
  }
  mkdirSync(path.dirname(screenshotPath), { recursive: true });
  writeFileSync(screenshotPath, result.stdout);
  console.log(`[pubmaxx] Screenshot: ${path.relative(repoRoot, screenshotPath)}`);
}

async function main() {
  if (!existsSync(apkPath)) {
    throw new Error(
      `[pubmaxx] ${path.relative(repoRoot, apkPath)} is missing. Run \`npm run android:build\`.`,
    );
  }

  const toolchain = requireAndroidToolchain();
  console.log(`[pubmaxx] ANDROID_HOME ${toolchain.androidHome}`);
  requireSdkTool(toolchain.adb, "platform-tools");

  ensureAvd(toolchain);
  const serial = await bootEmulator(toolchain);

  adbRun(toolchain, ["-s", serial, "install", "-r", apkPath]);
  await launchAndWaitForFocus(toolchain, serial);
  await sleep(SETTLE_MS);
  capture(toolchain, serial);

  console.log(
    `\n[pubmaxx] ${APPLICATION_ID} is running on ${serial}.\n` +
      `[pubmaxx] It loads ${syncedServerUrl(SYNCED_CONFIG)}.\n` +
      `[pubmaxx] Stop the emulator with \`adb -s ${serial} emu kill\`.`,
  );
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
