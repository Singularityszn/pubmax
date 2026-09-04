// Where the Android toolchain is, resolved once for both android scripts.
//
// Nothing here installs anything. The two values a Gradle or emulator run
// cannot proceed without are JAVA_HOME and ANDROID_HOME, and each is refused
// BY NAME when it is absent, because the alternative is a Gradle stack trace
// about a missing `sdk.dir` that says nothing about which of the two the
// machine is short of. docs/STORE_READINESS.md section 9 owns the install.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Homebrew's cask lays the SDK down here, and section 9 installs it there. */
const DEFAULT_ANDROID_HOME = "/opt/homebrew/share/android-commandlinetools";

/**
 * Homebrew's openjdk@21 keg. The nested `libexec/openjdk.jdk` layout is what
 * `brew install openjdk@21` produces; a JDK laid out differently still answers
 * for its own java.home, which is why the probe below exists.
 */
const HOMEBREW_JDK_KEG = "/opt/homebrew/opt/openjdk@21";

function readJavaHome(text) {
  const line = String(text)
    .split("\n")
    .find((candidate) => candidate.trim().startsWith("java.home"));
  if (!line) return null;
  const value = line.split("=")[1]?.trim();
  return value && existsSync(value) ? value : null;
}

function probeJavaHome(javaBinary) {
  // `java -XshowSettings:properties` prints java.home and needs no build
  // tooling, so it answers for any JDK layout rather than only the one
  // Homebrew happens to ship this month. It reports on stderr and exits
  // non-zero on some builds, so both streams are read either way.
  try {
    return readJavaHome(
      execFileSync(javaBinary, ["-XshowSettings:properties", "-version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch (error) {
    return readJavaHome(`${error?.stdout ?? ""}${error?.stderr ?? ""}`);
  }
}

/** Resolve JAVA_HOME, preferring an explicit environment over any guess. */
export function resolveJavaHome() {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }

  const kegHome = path.join(HOMEBREW_JDK_KEG, "libexec/openjdk.jdk/Contents/Home");
  if (existsSync(kegHome)) return kegHome;

  const kegJava = path.join(HOMEBREW_JDK_KEG, "bin/java");
  return existsSync(kegJava) ? probeJavaHome(kegJava) : null;
}

/** Resolve ANDROID_HOME, preferring an explicit environment over any guess. */
export function resolveAndroidHome() {
  for (const candidate of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return existsSync(DEFAULT_ANDROID_HOME) ? DEFAULT_ANDROID_HOME : null;
}

/**
 * Both values plus the environment a child process needs, or a refusal naming
 * the one that is missing and the step that installs it.
 */
export function requireAndroidToolchain() {
  const javaHome = resolveJavaHome();
  const androidHome = resolveAndroidHome();

  const missing = [];
  if (!javaHome) {
    missing.push(
      "JAVA_HOME (JDK 21). Install it, or export JAVA_HOME yourself. " +
        "See docs/STORE_READINESS.md section 9.",
    );
  }
  if (!androidHome) {
    missing.push(
      `ANDROID_HOME (Android SDK). Expected ${DEFAULT_ANDROID_HOME}, or export ` +
        "ANDROID_HOME yourself. See docs/STORE_READINESS.md section 9.",
    );
  }
  if (missing.length > 0) {
    throw new Error(`[pubmaxx] Android toolchain is not ready:\n  - ${missing.join("\n  - ")}`);
  }

  return {
    javaHome,
    androidHome,
    adb: path.join(androidHome, "platform-tools/adb"),
    emulator: path.join(androidHome, "emulator/emulator"),
    avdmanager: path.join(androidHome, "cmdline-tools/latest/bin/avdmanager"),
    env: {
      ...process.env,
      JAVA_HOME: javaHome,
      ANDROID_HOME: androidHome,
      ANDROID_SDK_ROOT: androidHome,
    },
  };
}

/** Refuse a tool the SDK should carry rather than exec a path that is not there. */
export function requireSdkTool(toolPath, sdkmanagerPackage) {
  if (existsSync(toolPath)) return toolPath;
  throw new Error(
    `[pubmaxx] ${toolPath} is missing. Install it with:\n` +
      `  sdkmanager --install "${sdkmanagerPackage}"`,
  );
}
