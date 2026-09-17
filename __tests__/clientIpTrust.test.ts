// The trust boundary for "which header names the caller".
//
// The rule this pins is the fix for the hole the thermonuclear review found at
// P1-3: `clientIp` read the LEFT-MOST `x-forwarded-for` entry, which is the one
// value in the chain a caller always writes, so four anonymous paid routes were
// rate-limited on a budget the caller selected. These cases are the rule, and
// the source fence at the bottom is what stops the old reading coming back.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FORWARDED_FOR_HEADER,
  PLATFORM_CLIENT_IP_HEADERS,
  UNKNOWN_CLIENT_IP,
  looksLikeClientIp,
  resolveClientIp,
  trailingForwardedForEntry,
} from "@/lib/clientIpTrust";
import { clientIp } from "@/lib/supabase";

const ROOT = process.cwd();

function readerFor(headers: Record<string, string>): (name: string) => string | null {
  return (name) => headers[name] ?? null;
}

describe("looksLikeClientIp", () => {
  it("accepts the address shapes a proxy really appends", () => {
    for (const value of [
      "203.0.113.9",
      "2001:db8::1",
      "::1",
      "[2001:db8::1]",
      "fe80::1%eth0",
    ]) {
      expect(looksLikeClientIp(value), value).toBe(true);
    }
  });

  it("refuses free text, so a word can never become a limiter bucket", () => {
    // `unknown` is a legal x-forwarded-for value per RFC 7239's predecessor,
    // and `_hidden` is an obfuscated identifier. Neither names a caller.
    for (const value of ["", "   ", "unknown", "_hidden", "obfuscated", "203.0.113.9 OR 1=1"]) {
      expect(looksLikeClientIp(value), value).toBe(false);
    }
  });

  it("refuses a value longer than any address, so a header cannot be a payload", () => {
    expect(looksLikeClientIp("1".repeat(46))).toBe(false);
  });
});

describe("trailingForwardedForEntry", () => {
  it("takes the right-most entry, never the left-most one the caller wrote", () => {
    expect(trailingForwardedForEntry("203.0.113.9, 198.51.100.7")).toBe("198.51.100.7");
  });

  it("skips a non-address entry from the right rather than returning it", () => {
    expect(trailingForwardedForEntry("203.0.113.9, 198.51.100.7, unknown")).toBe("198.51.100.7");
  });

  it("answers the single entry when there is only one hop", () => {
    expect(trailingForwardedForEntry("203.0.113.9")).toBe("203.0.113.9");
  });

  it("answers null when nothing in the header is an address", () => {
    expect(trailingForwardedForEntry("unknown, unknown")).toBeNull();
    expect(trailingForwardedForEntry("")).toBeNull();
    expect(trailingForwardedForEntry(null)).toBeNull();
  });
});

describe("resolveClientIp", () => {
  it("prefers the platform header over anything the caller forwarded", () => {
    const resolved = resolveClientIp(
      readerFor({
        "x-vercel-forwarded-for": "198.51.100.7",
        "x-real-ip": "198.51.100.8",
        "x-forwarded-for": "203.0.113.9",
      }),
    );
    expect(resolved).toBe("198.51.100.7");
  });

  it("reads the platform headers in the documented order", () => {
    expect(PLATFORM_CLIENT_IP_HEADERS).toEqual(["x-vercel-forwarded-for", "x-real-ip"]);
    expect(
      resolveClientIp(readerFor({ "x-real-ip": "198.51.100.8", "x-forwarded-for": "203.0.113.9" })),
    ).toBe("198.51.100.8");
  });

  it("falls back to the right-most forwarded entry when no platform header is set", () => {
    expect(
      resolveClientIp(readerFor({ [FORWARDED_FOR_HEADER]: "203.0.113.9, 198.51.100.7" })),
    ).toBe("198.51.100.7");
  });

  it("never answers with the left-most forwarded entry when a later hop exists", () => {
    const spoofed = "203.0.113.9";
    expect(
      resolveClientIp(readerFor({ [FORWARDED_FOR_HEADER]: `${spoofed}, 198.51.100.7` })),
    ).not.toBe(spoofed);
  });

  it("ignores a platform header that is not address shaped", () => {
    expect(
      resolveClientIp(
        readerFor({ "x-real-ip": "not-an-address", [FORWARDED_FOR_HEADER]: "198.51.100.7" }),
      ),
    ).toBe("198.51.100.7");
  });

  it("names an unresolvable caller once, never with an empty string", () => {
    expect(resolveClientIp(readerFor({}))).toBe(UNKNOWN_CLIENT_IP);
    expect(resolveClientIp(readerFor({ [FORWARDED_FOR_HEADER]: "unknown" }))).toBe(
      UNKNOWN_CLIENT_IP,
    );
  });
});

describe("clientIp over a real Request", () => {
  function ipFor(headers: Record<string, string>): string {
    return clientIp(new Request("http://localhost/api/ask", { headers }));
  }

  it("takes the platform address a Vercel request always carries", () => {
    expect(
      ipFor({ "x-vercel-forwarded-for": "198.51.100.7", "x-forwarded-for": "203.0.113.9" }),
    ).toBe("198.51.100.7");
  });

  it("cannot be steered by prepending an entry to x-forwarded-for", () => {
    const trusted = ipFor({ "x-forwarded-for": "198.51.100.7" });
    const spoofAttempt = ipFor({ "x-forwarded-for": "203.0.113.9, 198.51.100.7" });
    expect(spoofAttempt).toBe(trusted);
  });
});

describe("source fence", () => {
  it("keeps the left-most forwarded reading out of the tree", () => {
    const supabase = readFileSync(join(ROOT, "lib/supabase.ts"), "utf8");
    // The exact shape the review found: split the caller-written header and
    // take element zero.
    expect(supabase).not.toMatch(/x-forwarded-for[^\n]*split\(","\)\[0\]/);
    expect(supabase).toContain("resolveClientIp");
  });

  it("leaves lib/clientIpTrust.ts a pure leaf with no imports behind it", () => {
    const source = readFileSync(join(ROOT, "lib/clientIpTrust.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
