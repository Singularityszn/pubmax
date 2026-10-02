import { describe, expect, it } from "vitest";

import { firstHttp, firstHttps, isHttpUrl } from "@/lib/httpUrl";

describe("httpUrl", () => {
  it("preserves valid comma query values for general http links", () => {
    const url = "https://booking.example/reserve?days=mon,tue";

    expect(isHttpUrl(url)).toBe(true);
    expect(firstHttp(url)).toBe(url);
    expect(firstHttps(url)).toBe(url);
  });

  it("covers the strict link guard and the parser copies that allow encoded whitespace", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("http://user:pass@example.com/x")).toBe(true);
    expect(isHttpUrl("http://example.com/a b")).toBe(false);
    expect(isHttpUrl(" http://example.com")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl(" ")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("ftp://example.com")).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
    expect(isHttpUrl(1)).toBe(false);

    const loose = { allowWhitespace: true } as const;
    expect(isHttpUrl("https://example.com", loose)).toBe(true);
    expect(isHttpUrl("http://user:pass@example.com/x", loose)).toBe(true);
    expect(isHttpUrl("http://example.com/a b", loose)).toBe(true);
    expect(isHttpUrl(" http://example.com", loose)).toBe(true);
    expect(isHttpUrl("", loose)).toBe(false);
    expect(isHttpUrl(" ", loose)).toBe(false);
    expect(isHttpUrl("javascript:alert(1)", loose)).toBe(false);
    expect(isHttpUrl("ftp://example.com", loose)).toBe(false);
    expect(isHttpUrl(null, loose)).toBe(false);
  });
});
