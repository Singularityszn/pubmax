import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import ErrorBoundary from "@/app/error";
import { defined } from "@/__tests__/helpers/defined";

// ─────────────────────────────────────────────────────────────────────────────
// THE DOCUMENTS NOBODY READS UNTIL SOMETHING BREAKS
//
// `app/error.tsx` and `app/not-found.tsx` are the two documents a reader meets
// on the worst visit they will have, and both were outside every fence in the
// repo. `__tests__/templatePatterns.test.ts` scopes itself to `components/`,
// so no template-pattern or hedge-copy rule saw them, and the caps policy had
// no fence anywhere. The global boundary broke three laws at once from inside
// its inline styles (UI review, 17 September 2026, finding 8):
//
//   - the eyebrow was `text-transform: uppercase` at 0.14em, wider than the
//     retired --tracking-wider it should not have been using at all, on plain
//     text with no border and no fill;
//   - it printed that eyebrow in --brass, 2.49:1 to 2.91:1 as text on the
//     light ladder, which is the exact defect --brass-ink exists for;
//   - and nothing could tell, because inline styles reach no stylesheet sweep.
//
// This is a CLASS and not a file list: it walks the tree for every error and
// not-found document, so a route that grows one of its own is held too.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();

function errorDocuments(directory = "app", found: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, directory))) {
    const relative = `${directory}/${entry}`;
    if (statSync(join(ROOT, relative)).isDirectory()) {
      errorDocuments(relative, found);
    } else if (/^(?:global-)?error\.tsx$|^not-found\.tsx$/.test(entry)) {
      found.push(relative);
    }
  }
  return found;
}

const DOCUMENTS = errorDocuments();

describe("error and not-found documents", () => {
  it("finds every one of them", () => {
    expect(DOCUMENTS, "app/error.tsx and app/not-found.tsx at least").toContain(
      "app/error.tsx",
    );
    expect(DOCUMENTS).toContain("app/not-found.tsx");
    expect(DOCUMENTS.length).toBeGreaterThanOrEqual(4);
  });

  it.each(DOCUMENTS)("%s keeps plain text in sentence case", (file) => {
    // UPPERCASE IS RESERVED FOR STAMPS (docs/DESIGN_SYSTEM.md, caps policy): a
    // small bordered or filled pill that reads as a pressed mark. These
    // documents paint no such chip, so no uppercase transform belongs in them,
    // and the wide tracking that existed only to make all-caps legible goes
    // with it.
    const source = readFileSync(join(ROOT, file), "utf8");
    expect(source, "no uppercase transform").not.toMatch(/textTransform:\s*["']uppercase/);
    expect(source, "no text-transform: uppercase").not.toMatch(
      /text-transform:\s*uppercase/,
    );
    const tracking = [...source.matchAll(/letterSpacing:\s*["']([\d.]+)em/g)].map((match) =>
      Number.parseFloat(defined(match[1])),
    );
    for (const value of tracking) {
      // ~0.01em is the sentence-case band the caps policy names. 0.08em is the
      // retired --tracking-wider, and this file shipped 0.14em.
      expect(value, `${file} tracks a plain label at ${value}em`).toBeLessThanOrEqual(0.02);
    }
  });

  it.each(DOCUMENTS)("%s prints no raw coral as a word", (file) => {
    // CORAL IS A FILL AND CORAL IS A WORD, AND THOSE ARE TWO TOKENS. A `color`
    // of var(--brass) on a light surface is below AA at every step of the
    // ladder; --color-accent-ink is the word and dark points it back at the one
    // coral.
    const source = readFileSync(join(ROOT, file), "utf8");
    // No document commits to a dark surface any more: the 404 used to, and
    // left the consent bar and tab bar light on top of it (QA journeys F15).
    expect(source, "a coral word takes var(--color-accent-ink)").not.toMatch(
      /color:\s*["']var\(--brass/,
    );
    // Whatever the surface, a fallback may not name a colour the app retired.
    for (const [, fallback] of source.matchAll(/var\(--brass,\s*(#[0-9a-f]{3,8})/gi)) {
      expect(defined(fallback).toLowerCase(), `${file} falls back to a retired brass`).toBe(
        "#ff5a5f",
      );
    }
  });

  it("hands the reader an action rather than a closed door", () => {
    // docs/VOICE.md: the bare imperative `Try again` stays, while `please try
    // again`, `try again later` and `check back later` are refused. The
    // boundary owes a retry AND a way home, because a segment that keeps
    // failing leaves the retry useless.
    const markup = renderToStaticMarkup(
      createElement(ErrorBoundary, {
        error: Object.assign(new Error("boom"), { digest: "abc123" }),
        retry: () => undefined,
      }),
    );
    expect(markup).toContain("Try again");
    expect(markup).toContain('href="/"');
    expect(markup, "no em dash").not.toContain("—");
    expect(markup, "no exclamation mark").not.toContain("!");
    expect(markup.toLowerCase(), "no hedge line").not.toMatch(
      /please try again|try again later|check back later/,
    );
    // The digest is the one thing support can act on, so it is printed.
    expect(markup).toContain("abc123");
  });
});
