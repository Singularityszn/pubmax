#!/usr/bin/env node
// npm run backup:install-launchd - schedule the off-platform backup weekly, on
// Sunday at 03:30, as a launchd agent of the user who runs it. Run it from the
// checkout the job should use. Running it again rewrites the same agent and
// reloads it, so it is safe to repeat after a pull or a move.
//
// The secrets stay out of the agent: the job reads them from
// ~/.config/pubmax/backup.env through `node --env-file`, and this script refuses
// to install while that file is missing or readable by anyone but its owner.
// docs/DR_RUNBOOK.md names the variables.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LABEL = "com.pubmax.backup";

const home = os.homedir();
const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(home, ".config", "pubmax", "backup.env");
const agentFile = path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
const logFile = path.join(home, "Library", "Logs", "pubmax-backup.log");

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function agentPlist() {
  const programArguments = [
    process.execPath,
    `--env-file=${envFile}`,
    path.join(checkout, "scripts", "backup-offplatform.mjs"),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments.map((argument) => `    <string>${xml(argument)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(checkout)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(process.env.PATH ?? "/usr/bin:/bin")}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>0</integer>
    <key>Hour</key>
    <integer>3</integer>
    <key>Minute</key>
    <integer>30</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logFile)}</string>
</dict>
</plist>
`;
}

function install() {
  if (!existsSync(envFile)) {
    throw new Error(`Create ${envFile} with the backup variables, mode 0600, then run this again.`);
  }
  if ((statSync(envFile).mode & 0o077) !== 0) {
    throw new Error(`${envFile} is open to other users. Run chmod 600 on it, then run this again.`);
  }

  mkdirSync(path.dirname(agentFile), { recursive: true });
  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(agentFile, agentPlist(), { mode: 0o644 });

  const domain = `gui/${process.getuid()}`;
  // A first install has nothing to boot out, and that failure is expected.
  spawnSync("launchctl", ["bootout", `${domain}/${LABEL}`], { stdio: "ignore" });
  const loaded = spawnSync("launchctl", ["bootstrap", domain, agentFile], { stdio: ["ignore", "inherit", "inherit"] });
  if (loaded.error) throw new Error(`Could not run launchctl: ${loaded.error.message}`);
  if (loaded.status !== 0) throw new Error(`launchctl bootstrap exited ${loaded.status}.`);
  console.log(`[backup] ${LABEL} runs weekly, Sunday 03:30, from ${checkout}. Log: ${logFile}`);
}

try {
  install();
} catch (error) {
  console.error(`[backup] install FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
