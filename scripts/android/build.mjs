// `npm run android:build` - sync the Capacitor project, assemble the debug
// APK and run the JVM unit tests, from a checkout that has already run `npm ci`.
//
// It deliberately does NOT run `npm ci` itself: this script runs FROM npm, so
// reinstalling would delete node_modules out from under the process executing
// it. The clean-checkout order is `npm ci` and then this, and section 9 of
// docs/STORE_READINESS.md writes it that way.
//
// Release builds are not here on purpose. They need the upload key, which is
// the owner's step (section 8) and the one artefact that never reaches this
// repository.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requireAndroidToolchain } from "./toolchain.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const androidDir = path.join(repoRoot, "android");
const apkPath = path.join(androidDir, "app/build/outputs/apk/debug/app-debug.apk");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: repoRoot, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`[pubmaxx] ${path.basename(command)} ${args.join(" ")} exited ${result.status}`);
  }
}

function main() {
  if (!existsSync(path.join(repoRoot, "node_modules/@capacitor/cli"))) {
    throw new Error("[pubmaxx] node_modules is missing or incomplete. Run `npm ci` first.");
  }

  const toolchain = requireAndroidToolchain();
  console.log(`[pubmaxx] JAVA_HOME    ${toolchain.javaHome}`);
  console.log(`[pubmaxx] ANDROID_HOME ${toolchain.androidHome}`);

  run("npx", ["cap", "sync", "android"], { env: toolchain.env });
  run(path.join(androidDir, "gradlew"), ["assembleDebug", "--no-daemon"], {
    cwd: androidDir,
    env: toolchain.env,
  });

  if (!existsSync(apkPath)) {
    // Gradle can report success over a task graph that produced nothing we can
    // install, and a run.mjs that then said "no such file" would blame the
    // wrong step.
    throw new Error(`[pubmaxx] Gradle succeeded but ${apkPath} is not there.`);
  }
  run(path.join(androidDir, "gradlew"), ["testDebugUnitTest", "--no-daemon"], {
    cwd: androidDir,
    env: toolchain.env,
  });
  console.log(`\n[pubmaxx] Debug APK: ${path.relative(repoRoot, apkPath)}`);
}

try {
  main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
