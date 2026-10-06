// @vitest-environment jsdom

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

describe("npm run backup:install-launchd", () => {
  const scripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts;
  const [command, script] = String(scripts["backup:install-launchd"]).split(" ");
  let home = "";
  let bin = "";
  const envFile = () => path.join(home, ".config", "pubmax", "backup.env");
  const agentFile = () => path.join(home, "Library", "LaunchAgents", "com.pubmax.backup.plist");
  const calls = () =>
    existsSync(path.join(bin, "calls")) ? readFileSync(path.join(bin, "calls"), "utf8").trim().split("\n") : [];

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "backup-home-"));
    bin = mkdtempSync(path.join(os.tmpdir(), "backup-bin-"));
    // A launchctl that boots out only what it has loaded, as the real one does.
    writeFileSync(
      path.join(bin, "launchctl"),
      [
        "#!/bin/sh",
        'echo "$1" >> "$STUB_DIR/calls"',
        'if [ "$1" = bootout ]; then [ -f "$STUB_DIR/loaded" ] || exit 3; rm "$STUB_DIR/loaded"; fi',
        'if [ "$1" = bootstrap ]; then touch "$STUB_DIR/loaded"; fi',
        "",
      ].join("\n"),
    );
    chmodSync(path.join(bin, "launchctl"), 0o755);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  });

  const install = () =>
    spawnSync(String(command), [String(script)], {
      cwd: ROOT,
      encoding: "utf8",
      env: { NODE_ENV: "test", HOME: home, STUB_DIR: bin, PATH: `${bin}:${process.env.PATH ?? ""}` },
    });

  const writeEnvFile = (mode: number) => {
    mkdirSync(path.dirname(envFile()), { recursive: true });
    writeFileSync(envFile(), "PUBMAX_BACKUP_DB_URL=postgresql://u:p@h/db\n");
    chmodSync(envFile(), mode);
  };

  type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };
  const plistValue = (node: Element): PlistValue => {
    const children = [...node.children];
    switch (node.tagName) {
      case "integer":
        return Number(node.textContent);
      case "true":
        return true;
      case "false":
        return false;
      case "array":
        return children.map(plistValue);
      case "dict": {
        const out: { [key: string]: PlistValue } = {};
        for (let index = 0; index < children.length; index += 2) {
          out[String(children[index]?.textContent)] = plistValue(children[index + 1] as Element);
        }
        return out;
      }
      default:
        return String(node.textContent);
    }
  };
  const agent = () => {
    const document = new DOMParser().parseFromString(readFileSync(agentFile(), "utf8"), "application/xml");
    return plistValue(document.documentElement.children[0] as Element) as Record<string, PlistValue>;
  };

  it("refuses, and installs nothing, while the secrets file is missing or open to other users", () => {
    for (const setup of [() => undefined, () => writeEnvFile(0o644)]) {
      setup();
      const result = install();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("backup.env");
      expect(existsSync(agentFile())).toBe(false);
      expect(calls()).toEqual([]);
    }
  });

  it("installs a weekly agent that reads its secrets from the env file and runs this checkout's backup", () => {
    writeEnvFile(0o600);
    const result = install();
    expect(result.status).toBe(0);
    expect(agent()).toMatchObject({
      Label: "com.pubmax.backup",
      ProgramArguments: [
        expect.stringContaining("node"),
        `--env-file=${envFile()}`,
        path.join(ROOT, "scripts", "backup-offplatform.mjs"),
      ],
      WorkingDirectory: ROOT,
      StartCalendarInterval: { Weekday: 0, Hour: 3, Minute: 30 },
      StandardOutPath: path.join(home, "Library", "Logs", "pubmax-backup.log"),
    });
    expect(JSON.stringify(agent())).not.toContain("postgresql://");
  });

  it("is safe to run again: the same agent, reloaded", () => {
    writeEnvFile(0o600);
    expect(install().status).toBe(0);
    const first = readFileSync(agentFile(), "utf8");
    expect(install().status).toBe(0);
    expect(readFileSync(agentFile(), "utf8")).toBe(first);
    expect(calls()).toEqual(["bootout", "bootstrap", "bootout", "bootstrap"]);
    expect(existsSync(path.join(bin, "loaded"))).toBe(true);
  });
});
