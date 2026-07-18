import { describe, expect, it } from "vitest";

import { BASE_DIRECTIVES, buildCsp, DYNAMIC_CSP_PREFIXES } from "../scripts/lib/cspPolicy.mjs";
import { config as proxyConfig, proxy } from "../proxy";
import {
  SITE_JSON_LD,
  SITE_JSON_LD_TEXT,
  SPECULATION_RULES_JSON,
} from "@/lib/inlineDocumentScripts";
import { serializeJsonLd } from "@/components/seo/JsonLd";

// The two-tier CSP's load-bearing invariants. If one of these fails, either a
// route can ship with a weakened/missing policy or the layout's inline scripts
// get silently blocked — treat every assertion here as security-critical.

describe("shared CSP policy (scripts/lib/cspPolicy.mjs)", () => {
  it("never allows unsafe-inline in script-src, in any tier", () => {
    // Static tier shape:
    const staticCsp = buildCsp("script-src 'self' 'sha256-abc'");
    expect(/script-src[^;]*unsafe-inline/.test(staticCsp)).toBe(false);
    // unsafe-inline exists ONLY for style-src (MapLibre runtime styles).
    for (const directive of BASE_DIRECTIVES) {
      if (directive.startsWith("style-src")) continue;
      expect(directive).not.toContain("unsafe-inline");
    }
  });

  it("emits script-src second, after default-src, with every base directive present", () => {
    const csp = buildCsp("script-src 'self'");
    const parts = csp.split("; ");
    expect(parts[0]).toBe("default-src 'self'");
    expect(parts[1]).toBe("script-src 'self'");
    expect(parts).toHaveLength(BASE_DIRECTIVES.length + 1);
  });
});

describe("dynamic-tier proxy", () => {
  it("matcher is the literal-object form of DYNAMIC_CSP_PREFIXES (lockstep)", () => {
    const sources = (proxyConfig.matcher as Array<{ source: string }>).map((m) => m.source).sort();
    const expected = DYNAMIC_CSP_PREFIXES.flatMap((p) =>
      p === "/map" ? ["/map", "/map/:path+"] : [`${p}:path+`],
    ).sort();
    expect(sources).toEqual(expected);
  });

  it("every matcher entry skips router prefetches", () => {
    for (const entry of proxyConfig.matcher as Array<{ missing?: unknown[] }>) {
      expect(entry.missing).toEqual([
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ]);
    }
  });

  it("serves a nonce CSP with the two document-script hashes and no unsafe-inline", () => {
    const response = proxy(new Request("https://pubmaxxing.com/p/abc") as never);
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'sha256-[^']+' 'sha256-[^']+'/);
    expect(/script-src[^;]*unsafe-inline/.test(csp)).toBe(false);
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe("layout inline scripts stay hash-covered", () => {
  it("SITE_JSON_LD_TEXT is exactly the JsonLd serializer's output for SITE_JSON_LD", () => {
    expect(SITE_JSON_LD_TEXT).toBe(serializeJsonLd(SITE_JSON_LD));
  });

  it("speculation rules JSON parses and targets the expected surfaces", () => {
    const parsed = JSON.parse(SPECULATION_RULES_JSON) as {
      prerender: Array<{ urls?: string[]; where?: { href_matches?: string } }>;
    };
    expect(parsed.prerender[0]?.urls).toEqual(["/crawls", "/discover", "/feed"]);
    expect(parsed.prerender[1]?.where?.href_matches).toBe("/borough/*");
  });
});
