import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import {
  ALERT_COOLDOWN_MS,
  ALERT_HOURLY_CAP,
  ALERT_MAX_TEXT,
  ALERT_WEBHOOK_ENV,
  alertWebhookUrl,
  resetAlertSink,
  sendAlert,
} from "@/lib/alertSink";
import { notifyFreshnessFindings } from "@/lib/freshnessNotify";
import { log } from "@/lib/log";
import { PRODUCTION_SECRET_ENV_NAMES } from "@/lib/productionSecretEnvNames";

const URL_OK = "https://discord.com/api/webhooks/123/secret-token";
const env = { [ALERT_WEBHOOK_ENV]: URL_OK };

function okFetch() {
  return vi.fn(async () => new Response(null, { status: 204 }));
}

beforeEach(() => {
  resetAlertSink();
  vi.stubEnv("NEXT_DEPLOYMENT_ID", "dpl_alert");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("alertWebhookUrl", () => {
  it("is null when unset, blank, malformed or not https", () => {
    expect(alertWebhookUrl({})).toBeNull();
    expect(alertWebhookUrl({ [ALERT_WEBHOOK_ENV]: "   " })).toBeNull();
    expect(alertWebhookUrl({ [ALERT_WEBHOOK_ENV]: "not a url" })).toBeNull();
    expect(alertWebhookUrl({ [ALERT_WEBHOOK_ENV]: "http://example.com/hook" })).toBeNull();
    expect(alertWebhookUrl(env)).toBe(URL_OK);
  });

  it("is on the list of secrets log() scrubs", () => {
    expect(PRODUCTION_SECRET_ENV_NAMES).toContain(ALERT_WEBHOOK_ENV);
  });
});

describe("sendAlert", () => {
  it("is silent when no webhook is set: no request, no throw", () => {
    const fetchImpl = okFetch();
    expect(sendAlert({ source: "x", text: "y" }, { env: {}, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts one JSON body that carries both the Discord and the Slack field and names the deployment", async () => {
    const fetchImpl = okFetch();
    await sendAlert({ source: "freshness-audit", text: "area_news stale" }, { env, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_OK);
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.content).toBe("[pubmax][freshness-audit][deployment dpl_alert] area_news stale");
    expect(body.text).toBe(body.content);
  });

  it("truncates a long body", async () => {
    const fetchImpl = okFetch();
    await sendAlert({ source: "x", text: "z".repeat(10_000) }, { env, fetchImpl });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body)).content.length).toBe(ALERT_MAX_TEXT);
  });

  it("sends a source once per cooldown and counts what it held back", async () => {
    const fetchImpl = okFetch();
    let now = 1_000_000;
    const deps = { env, fetchImpl, now: () => now };
    await sendAlert({ source: "a", text: "one" }, deps);
    expect(sendAlert({ source: "a", text: "two" }, deps)).toBeNull();
    expect(sendAlert({ source: "a", text: "three" }, deps)).toBeNull();
    await sendAlert({ source: "b", text: "other source" }, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    now += ALERT_COOLDOWN_MS;
    await sendAlert({ source: "a", text: "four" }, deps);
    const init = (fetchImpl.mock.calls[2] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body)).content).toContain("(+2 suppressed)");
  });

  it("stops at the hourly cap, then resumes in the next hour", async () => {
    const fetchImpl = okFetch();
    let now = 5_000_000;
    const deps = { env, fetchImpl, now: () => now };
    for (let index = 0; index < ALERT_HOURLY_CAP + 5; index += 1) {
      sendAlert({ source: `source-${index}`, text: "x" }, deps);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(ALERT_HOURLY_CAP);
    now += 60 * 60 * 1000;
    sendAlert({ source: "later", text: "x" }, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(ALERT_HOURLY_CAP + 1);
  });

  it("never throws when the request fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(sendAlert({ source: "x", text: "y" }, { env, fetchImpl })).resolves.toBeUndefined();
    expect(() => sendAlert({ source: "z", text: "y" }, { env, fetchImpl: undefined })).not.toThrow();
  });
});

describe("the seams", () => {
  it("log() posts an error event and the named warn event, and nothing else", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv(ALERT_WEBHOOK_ENV, URL_OK);
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    log("info", "pint_drops.created", { status: 201 });
    log("warn", "some.other_warning", { status: 1 });
    expect(fetchMock).not.toHaveBeenCalled();

    log("error", "pint_drops.storage_error", { route: "POST /api/pint-drops" });
    log("warn", "paid_spend.budget_spent", { lane: "ask", budget: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((call) =>
      String(((call as unknown as [string, RequestInit])[1]).body),
    );
    expect(bodies[0]).toContain("pint_drops.storage_error");
    expect(bodies[1]).toContain("paid_spend.budget_spent");
  });

  it("log() sends the event name, level, time and deployment id, and none of the line's fields", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv(ALERT_WEBHOOK_ENV, URL_OK);
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const fields = {
      ownerId: "11111111-1111-4111-8111-111111111111",
      handle: "ripley_the_fox",
      objectKey: "pint-drops/11111111/photo.jpg",
      error: "row for ripley_the_fox could not be written",
    };

    log("error", "profile_cover.write_failed", fields, Date.UTC(2026, 9, 6, 7, 30));

    expect(String(consoleError.mock.calls[0]?.[0])).toContain(fields.handle);
    const body = JSON.parse(String(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]).body));
    expect(body.content).toBe(
      "[pubmax][profile_cover.write_failed][deployment dpl_alert] error at 2026-10-06T07:30:00.000Z",
    );
    for (const value of Object.values(fields)) expect(JSON.stringify(body)).not.toContain(value);
  });

  it("the freshness audit posts its findings and stays quiet when all is fresh", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv(ALERT_WEBHOOK_ENV, URL_OK);
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    notifyFreshnessFindings([], []);
    expect(fetchMock).not.toHaveBeenCalled();

    const stale = {
      id: "area_news",
      label: "Area news",
      class: "cron",
      cadence: "weekly",
      refreshWorkflow: "x",
      gate: "x",
      artifact: null,
      stalenessBudgetHours: 504,
      observedAt: null,
      ageHours: 815.4,
      status: "stale",
      detail: "Aged 815.4h, over the 504h budget",
    } as const;
    notifyFreshnessFindings([stale], []);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]).body)).toContain(
      "stale area_news: Aged 815.4h",
    );
  });
});

type Workflow = {
  name?: string;
  on?: {
    schedule?: unknown;
    workflow_run?: { workflows?: string[]; types?: string[] };
  };
  permissions?: unknown;
  jobs?: Record<
    string,
    {
      if?: string;
      env?: Record<string, string>;
      steps?: { uses?: string; run?: string }[];
    }
  >;
};

describe("every scheduled workflow tells somebody when it fails", () => {
  const dir = path.join(path.resolve(__dirname, ".."), ".github/workflows");
  const workflows = new Map(
    readdirSync(dir)
      .filter((file) => file.endsWith(".yml"))
      .map((file) => [file, parse(readFileSync(path.join(dir, file), "utf8")) as Workflow]),
  );
  const alert = workflows.get("alert-on-failure.yml") as Workflow;
  const job = alert.jobs?.alert;
  const scheduled = [...workflows]
    .filter(([file, workflow]) => file !== "alert-on-failure.yml" && workflow.on?.schedule !== undefined)
    .map(([file, workflow]) => workflow.name ?? file);

  it("finds the scheduled workflows", () => {
    expect(scheduled.length).toBeGreaterThanOrEqual(6);
  });

  it("watches every scheduled workflow by name when it completes", () => {
    expect([...(alert.on?.workflow_run?.workflows ?? [])].sort()).toEqual([...scheduled].sort());
    expect(alert.on?.workflow_run?.types).toEqual(["completed"]);
  });

  it("posts only for a scheduled failure, holds no permission and runs no repository code", () => {
    expect(job?.if?.replace(/\s+/g, " ").trim()).toBe(
      "github.event.workflow_run.conclusion == 'failure' && github.event.workflow_run.event == 'schedule'",
    );
    expect(alert.permissions).toEqual({});
    expect(job?.env?.ALERT_WEBHOOK_URL).toBe("${{ secrets.PUBMAX_ALERT_WEBHOOK_URL }}");
    expect(job?.steps?.length).toBeGreaterThan(0);
    for (const step of job?.steps ?? []) expect(step.uses).toBeUndefined();
  });

  describe("the post step, run by bash with curl and jq stubbed", () => {
    const run = job?.steps?.[0]?.run ?? "";
    let bin = "";

    beforeEach(() => {
      bin = mkdtempSync(path.join(os.tmpdir(), "alert-step-"));
      writeFileSync(path.join(bin, "jq"), '#!/bin/sh\nprintf \'{"content":"%s"}\' "$4"\n');
      writeFileSync(
        path.join(bin, "curl"),
        '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$STUB_DIR/curl-args"\ncat > "$STUB_DIR/curl-body"\n',
      );
      chmodSync(path.join(bin, "jq"), 0o755);
      chmodSync(path.join(bin, "curl"), 0o755);
    });

    afterEach(() => {
      rmSync(bin, { recursive: true, force: true });
    });

    const step = (webhook: string) =>
      spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", run], {
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          STUB_DIR: bin,
          ALERT_WEBHOOK_URL: webhook,
          ALERT_TEXT: "[pubmax][ci] Performance failed: https://github.com/run/1",
        },
      });

    it("passes quietly and posts nothing when no webhook is set", () => {
      const result = step("");
      expect(result.status).toBe(0);
      expect(readdirSync(bin)).not.toContain("curl-args");
    });

    it("posts the alert text to the webhook and never prints the URL", () => {
      const result = step(URL_OK);
      expect(result.status).toBe(0);
      const args = readFileSync(path.join(bin, "curl-args"), "utf8").trim().split("\n");
      expect(args.at(-1)).toBe(URL_OK);
      expect(readFileSync(path.join(bin, "curl-body"), "utf8")).toContain("Performance failed");
      expect(`${result.stdout}${result.stderr}`).not.toContain("secret-token");
    });
  });
});
