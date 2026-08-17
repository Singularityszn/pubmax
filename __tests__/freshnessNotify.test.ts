import { afterEach, describe, expect, it, vi } from "vitest";

import { notifySitemapHistoricDegrade } from "@/lib/freshnessNotify";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notifySitemapHistoricDegrade", () => {
  it("logs at error level with the freshness-audit ALERT marker", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    notifySitemapHistoricDegrade();

    expect(errorSpy).toHaveBeenCalledOnce();
    const line = String(errorSpy.mock.calls[0]?.[0]);
    expect(line).toContain("[freshness-audit][ALERT]");
    expect(line).toContain("sitemap historic degrade");
    expect(line).toContain("historic pub dataset is empty or unreadable");
  });
});
