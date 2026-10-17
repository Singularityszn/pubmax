// A route may not download a font weight nothing can draw.
//
// U5 of docs/plans/SITE_SPEED_2026-09-01.md. Three families load through
// next/font: Space Grotesk and Inter as VARIABLE faces, which carry their whole
// axis in one file and so have no unused weight to drop, and JetBrains Mono as
// a list of declared faces on its vendored file.
//
// That list carried 500, and CSS cannot reach it. The font-matching algorithm
// searches UPWARD first for any target above 500, so every stamped rule in the
// tree - the `font: 550` shorthands on the landing, the legal pages and the
// drop strip, and Pub Pal chat's 600, 640 and 650 - already resolves to 700.
// Only an exact 500, or a target in (400, 500], could have used the file.
//
// This fence is the reason that stays true: add such a rule and the weight has
// to come back, deliberately, in the same commit.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import postcss from "postcss";
import { Children, createElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

const localFontCalls = vi.hoisted(
  () => [] as Array<{
    variable?: string;
    src: Array<{ weight?: string }>;
    declarations?: Array<{ prop: string; value: string }>;
  }>,
);

type GoogleFontOptions = {
  variable: string;
  weight?: string | string[];
  adjustFontFallback?: boolean;
};

const googleFontCalls = vi.hoisted(() => [] as GoogleFontOptions[]);

const fontFamilies = vi.hoisted(() => ({
  display: "'Space Grotesk', 'Space Grotesk Fallback'",
  body: "'Inter', 'Inter Fallback', system-ui",
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => "font-test-nonce" }) }));
vi.mock("next/font/google", () => {
  const face = (fontFamily: string) => ({
    className: "font-mock",
    variable: "--font-mock",
    style: { fontFamily },
  });
  return {
    Space_Grotesk: (options: GoogleFontOptions) => {
      googleFontCalls.push(options);
      return face(fontFamilies.display);
    },
    Inter: (options: GoogleFontOptions) => {
      googleFontCalls.push(options);
      return face(fontFamilies.body);
    },
  };
});
vi.mock("next/font/local", () => ({
  default: vi.fn((options: (typeof localFontCalls)[number]) => {
    localFontCalls.push(options);
    return { className: "font-mock", variable: "--font-mock" };
  }),
}));

import RootLayout from "@/app/layout";

const REPO_ROOT = join(__dirname, "..");

function stylesheets(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith(".css")) found.push(full);
    }
  };
  walk(join(REPO_ROOT, dir));
  return found;
}

function monoTargetsFromCss(css: string): number[] {
  const targets: number[] = [];
  postcss.parse(css).walkRules((rule) => {
    const font = new Map<string, { value: string; important: boolean }>();
    const set = (prop: string, value: string, important: boolean) => {
      if (!font.get(prop)?.important || important) font.set(prop, { value, important });
    };
    rule.each((node) => {
      if (node.type !== "decl") return;
      if (node.prop === "font") {
        const parts = postcss.list.space(node.value);
        const sizeIndex = parts.findIndex((part) =>
          part.includes("/") || /^(?:var|calc|clamp|min|max)\(/.test(part)
          || /(?:px|rem|em|vh|vw|pt|%)$/.test(part),
        );
        const weight = parts.slice(0, sizeIndex).find((part) =>
          Number.isFinite(Number(part)) || part === "bold",
        ) ?? "normal";
        set("font-family", parts.slice(sizeIndex + 1).join(" "), node.important);
        set("font-weight", weight, node.important);
      } else if (node.prop === "font-family" || node.prop === "font-weight") {
        set(node.prop, node.value, node.important);
      }
    });
    const families = postcss.list.comma(font.get("font-family")?.value ?? "");
    if (!families.includes("var(--font-data)")) return;
    const value = font.get("font-weight")?.value;
    if (value === undefined) return;
    const weight = value === "normal" ? 400 : value === "bold" ? 700 : Number(value);
    expect(Number.isFinite(weight), `unresolved mono font weight: ${value}`).toBe(true);
    targets.push(weight);
  });
  return targets;
}

function monoWeightTargets(): number[] {
  return ["app", "components"].flatMap((dir) => stylesheets(dir).flatMap((file) =>
    monoTargetsFromCss(readFileSync(file, "utf8")),
  ));
}

function expectVariableGoogleFonts(options: GoogleFontOptions[]) {
  expect(options.find((font) => font.variable === "--font-display")?.weight).toBe("variable");
  const body = options.find((font) => font.variable === "--font-body");
  expect(body).toBeDefined();
  expect(body).not.toHaveProperty("weight");
}

function expectMatchedGoogleFallbacks(options: GoogleFontOptions[]) {
  for (const variable of ["--font-display", "--font-body"]) {
    const font = options.find((options) => options.variable === variable);
    expect(font).toBeDefined();
    expect(font?.adjustFontFallback ?? true).toBe(true);
  }
}

describe("the mono face carries only weights something asks for", () => {
  it("declares 400 and 700 and nothing between", () => {
    const mono = localFontCalls.find((options) => options.variable === "--font-data");
    expect(mono?.src.map((face) => face.weight)).toEqual(["400", "700"]);
  });

  it("names its faces the family the --font-data token asks for", () => {
    // next/font/local names a face after its const unless told otherwise, and
    // the :root token wins the cascade over next/font's variable class. A name
    // the token does not ask for leaves every numeral in the system monospace.
    const root = postcss.parse(readFileSync(join(REPO_ROOT, "app/globals.css"), "utf8"));
    let token = "";
    root.walkRules(":root", (rule) => {
      rule.walkDecls("--font-data", (decl) => {
        token = decl.value;
      });
    });
    const requested = (token.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
    const mono = localFontCalls.find((options) => options.variable === "--font-data");
    const family = mono?.declarations?.find((decl) => decl.prop === "font-family")?.value;
    expect(requested).not.toBe("");
    expect(family).toBe(requested);
  });

  it("has no shipped rule that could resolve to 500", () => {
    // A target in (400, 500] is the only band that prefers 500 over 700.
    const unreachable = monoWeightTargets().filter(
      (weight) => weight > 400 && weight <= 500,
    );
    expect(
      unreachable,
      "a rule in this band needs the 500 file back in app/layout.tsx",
    ).toEqual([]);
  });

  it("keeps the two variable families variable, so they drop no weight", () => {
    expectVariableGoogleFonts(googleFontCalls);
  });

  it("keeps the metric-matched fallback, so no swap reflows", () => {
    expectMatchedGoogleFallbacks(googleFontCalls);
  });

  it.each(["--font-display", "--font-body"])("rejects incorrect live options for %s", (variable) => {
    const options = googleFontCalls.map((font) => ({ ...font }));
    const font = options.find((font) => font.variable === variable)!;
    font.weight = "400";
    expect(() => expectVariableGoogleFonts(options)).toThrow();
    font.adjustFontFallback = false;
    expect(() => expectMatchedGoogleFallbacks(options)).toThrow();
  });

  it("ignores commented mono declarations and normalizes declaration order and overrides", () => {
    expect(monoTargetsFromCss(`
      /* .retired { font: 500 12px var(--font-data); } */
      .shorthand { font: normal 550 12px/1 var(--font-data); }
      .family-first { font-family: var(--font-data); font-weight: 640; }
      .weight-first { font-weight: 650; font-family: var(--font-data); }
      .overridden { font: 500 12px var(--font-data); font-weight: 700; }
      .important { font-weight: 700 !important; font: 500 12px var(--font-data); }
      .other-family { --note: var(--font-data); font-family: sans-serif; font-weight: 500; }
      .replaced-family { font: 500 12px var(--font-data); font-family: sans-serif; }
      .reset-weight { font-weight: 500; font: 700 12px sans-serif; font-family: var(--font-data); }
    `)).toEqual([550, 640, 650, 700, 700, 700]);
    expect(monoTargetsFromCss(".live { font-family: var(--font-data); font-weight: 500; }")).toEqual([500]);
  });
});


describe("root font loading", () => {
  // The fonts used to be pinned to their fallbacks until hydration, and the
  // release restyled the document late enough to set /today's LCP (17 Oct 2026).
  it("pins no face to its fallback and needs no no-script override", async () => {
    const doc = await RootLayout({ children: createElement("main") });
    expect(doc.props.style).toBeUndefined();
    const head = Children.toArray(doc.props.children).find(
      (child) => typeof child === "object" && child !== null && "type" in child && child.type === "head",
    ) as ReactElement<{ children: React.ReactNode }>;
    const noscript = Children.toArray(head.props.children).find(
      (child) => typeof child === "object" && child !== null && "type" in child && child.type === "noscript",
    );
    expect(noscript).toBeUndefined();
  });

  it("refuses a Google face that provides no matched fallback", async () => {
    vi.resetModules();
    const original = fontFamilies.display;
    fontFamilies.display = "'Space Grotesk'";
    try {
      await expect(import("@/app/layout")).rejects.toThrow(
        "The display and body fonts require their generated matched fallbacks.",
      );
    } finally {
      fontFamilies.display = original;
      vi.resetModules();
    }
  });
});
