import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import JsonLd, { serializeJsonLd } from "@/components/seo/JsonLd";
import {
  escapeInlineScriptJson,
  serializeInlineScriptJson,
} from "@/lib/inlineScriptJson";
import { inlineOfflineOrMessageJs } from "@/lib/apiErrorMessage";

// Pentest finding P-4. Every <script> body we inline must be built by the ONE
// hardened serializer in lib/inlineScriptJson.ts. A bare JSON.stringify is a
// script breakout waiting for its first dynamic field: the HTML tokenizer sees
// "</script>" inside the body and closes the element, and everything after it
// is markup. This file renders each inlined block with a hostile payload and
// asserts the escaped output, then fences the tree so a new raw injection
// cannot land.

const ROOT = process.cwd();
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const HOSTILE = `</script><img src=x onerror=alert(1)> & more${LS}and${PS}on`;

/** Nothing an HTML tokenizer or a JavaScript parser can act on survives. */
function expectInert(body: string): void {
  expect(body).not.toContain("<");
  expect(body).not.toContain(">");
  expect(body).not.toContain("&");
  expect(body).not.toContain(LS);
  expect(body).not.toContain(PS);
  expect(body.toLowerCase()).not.toContain("</script");
}

describe("serializeInlineScriptJson", () => {
  it("escapes every HTML-significant character to its \\uXXXX form", () => {
    const body = serializeInlineScriptJson({ name: HOSTILE });
    expectInert(body);
    expect(body).toContain("\\u003c");
    expect(body).toContain("\\u003e");
    expect(body).toContain("\\u0026");
    expect(body).toContain("\\u2028");
    expect(body).toContain("\\u2029");
  });

  it("stays valid JSON that round-trips to the original value", () => {
    const data = { name: HOSTILE, nested: [{ note: HOSTILE }] };
    expect(JSON.parse(serializeInlineScriptJson(data))).toEqual(data);
  });

  it("answers null for a value JSON cannot represent, never the text undefined", () => {
    expect(serializeInlineScriptJson(undefined)).toBe("null");
    expect(serializeInlineScriptJson(() => 1)).toBe("null");
  });

  it("escapeInlineScriptJson hardens an already-serialized body", () => {
    expectInert(escapeInlineScriptJson(JSON.stringify({ name: HOSTILE })));
  });
});

describe("the application/ld+json block", () => {
  it("escapes a hostile field in the rendered script body", () => {
    const element = JsonLd({
      data: {
        "@context": "https://schema.org",
        "@type": "BarOrPub",
        name: HOSTILE,
      },
    }) as { props: { dangerouslySetInnerHTML: { __html: string } } };
    const body = element.props.dangerouslySetInnerHTML.__html;
    expectInert(body);
    expect(JSON.parse(body)).toMatchObject({ name: HOSTILE });
  });

  it("serializeJsonLd is the same hardened path", () => {
    expect(serializeJsonLd({ name: HOSTILE })).toBe(
      serializeInlineScriptJson({ name: HOSTILE }),
    );
  });
});

describe("the speculationrules block", () => {
  // app/layout.tsx renders a fixed rule set today. The escaping is what makes a
  // future dynamic URL or href_matches pattern safe, so it is proved here with
  // a rules-shaped hostile payload.
  it("escapes a hostile URL and href pattern", () => {
    const rules = {
      prerender: [
        { source: "list", urls: [`/social?tab=${HOSTILE}`], eagerness: "moderate" },
        { where: { href_matches: `/borough/${HOSTILE}` }, eagerness: "moderate" },
      ],
    };
    const body = serializeInlineScriptJson(rules);
    expectInert(body);
    expect(JSON.parse(body)).toEqual(rules);
  });
});

describe("the inline JavaScript block", () => {
  it("escapes a hostile message inside both string literals", () => {
    const body = inlineOfflineOrMessageJs(HOSTILE);
    // The expression's own operators are the only markup-shaped characters.
    expect(body.startsWith("navigator.onLine===false?")).toBe(true);
    const literals = body.slice("navigator.onLine===false?".length);
    expectInert(literals);
    expect(literals).toContain(serializeInlineScriptJson(HOSTILE));
  });

  it("keeps the copy the reader sees unchanged", () => {
    const body = inlineOfflineOrMessageJs(HOSTILE);
    const onlineLiteral = body.slice(body.lastIndexOf(":") + 1);
    // \uXXXX escapes are valid in a JavaScript string literal and decode back
    // to the same characters at runtime, so no copy is lost to the hardening.
    expect(JSON.parse(onlineLiteral)).toBe(HOSTILE);
  });
});

// ── The fence ────────────────────────────────────────────────────────────────
// A new emitter must not reintroduce the raw path. Every dangerouslySetInnerHTML
// under app/ and components/ is read, and its __html expression may not call
// JSON.stringify: the serializer is the only way a body is built.

function walkDir(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      walkDir(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
}

/** The balanced `{{ ... }}` expression each dangerouslySetInnerHTML is given. */
function injectionRegions(source: string): string[] {
  const regions: string[] = [];
  const marker = "dangerouslySetInnerHTML";
  let from = 0;
  for (;;) {
    const at = source.indexOf(marker, from);
    if (at === -1) return regions;
    const open = source.indexOf("{", at);
    if (open === -1) return regions;
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1;
      else if (source[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    regions.push(source.slice(open, end + 1));
    from = end + 1;
  }
}

describe("no raw JSON.stringify inside an inline script body", () => {
  it("holds across app/ and components/", () => {
    const files: string[] = [];
    walkDir(join(ROOT, "app"), files);
    walkDir(join(ROOT, "components"), files);

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("dangerouslySetInnerHTML")) continue;
      for (const region of injectionRegions(source)) {
        if (region.includes("JSON.stringify")) {
          offenders.push(file.replace(`${ROOT}/`, ""));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("reads the real regions rather than passing on an empty sweep", () => {
    const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");
    const regions = injectionRegions(layout);
    expect(regions.length).toBeGreaterThan(0);
    expect(regions.some((region) => region.includes("serializeInlineScriptJson"))).toBe(
      true,
    );
  });
});
