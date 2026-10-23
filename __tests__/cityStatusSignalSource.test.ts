import { describe, expect, it } from "vitest";

import { cityStatusSignalSource } from "@/lib/cityStatusSignalSource";

describe("cityStatusSignalSource", () => {
  it("names the publisher by host, without www", () => {
    expect(cityStatusSignalSource("https://www.timeout.com/london/news/x")).toEqual({
      href: "https://www.timeout.com/london/news/x",
      label: "Source: timeout.com ↗",
    });
    expect(cityStatusSignalSource(" https://news.bbc.co.uk/a ")?.label).toBe("Source: news.bbc.co.uk ↗");
  });

  it("offers no link for a missing, malformed or non-web source", () => {
    expect(cityStatusSignalSource(undefined)).toBeNull();
    expect(cityStatusSignalSource("")).toBeNull();
    expect(cityStatusSignalSource("not a url")).toBeNull();
    expect(cityStatusSignalSource("javascript:alert(1)")).toBeNull();
  });
});
