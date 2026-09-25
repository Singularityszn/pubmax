import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("refresh-whats-on cron schedule", () => {
  it("runs in the morning and again in the afternoon UTC", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    const whatsOnCrons =
      config.crons?.filter((cron) => cron.path === "/api/cron/refresh-whats-on") ?? [];
    expect(whatsOnCrons).toContainEqual({
      path: "/api/cron/refresh-whats-on",
      schedule: "30 5 * * *",
    });
    expect(whatsOnCrons).toContainEqual({
      path: "/api/cron/refresh-whats-on",
      schedule: "0 15 * * *",
    });
  });
});
