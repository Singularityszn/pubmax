// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, StrictMode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import { expect, it, vi } from "vitest";

// next/font runs during the Next build. These complete families represent its
// public loader result, including the metric-matched fallback for each face.
vi.mock("next/font/google", () => ({
  Space_Grotesk: () => ({
    variable: "display-variable",
    className: "display-face",
    style: { fontFamily: "'Space Grotesk', 'Space Grotesk Fallback'" },
  }),
  Inter: () => ({
    variable: "body-variable",
    className: "body-face",
    style: { fontFamily: "'Inter', 'Inter Fallback'" },
  }),
}));
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "data-variable", className: "data-face" }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

import RootLayout from "@/app/layout";
import ThemeAttribute from "@/components/ThemeAttribute";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ThemeAttributeProps = NonNullable<Parameters<typeof ThemeAttribute>[0]>;

function globalFontRules(): string {
  const source = postcss.parse(readFileSync(join(__dirname, "../app/globals.css"), "utf8"));
  const declarations: string[] = [];
  source.walkRules(":root", (rule) => {
    rule.walkDecls(/^--font-(body|display)$/, (declaration) => {
      declarations.push(declaration.toString());
    });
  });
  return `:root{${declarations.join(";")}}`;
}

it("paints the matched fallbacks first and keeps both generated chains over global tokens after hydration", async () => {
  const layout = await RootLayout({ children: createElement("main", null, "Choose a pub") });
  // Keep the real document attributes. Providers do not own the font cascade,
  // so render only its real theme initializer and representative page content.
  const shell = createElement(layout.type, layout.props,
    createElement("head", null, createElement("style", null,
      ".display-variable{--font-display:'Space Grotesk', 'Space Grotesk Fallback'}" +
      ".body-variable{--font-body:'Inter', 'Inter Fallback'}" + globalFontRules(),
    )),
    createElement("body", null,
      // The same props the layout hands it: the server paints the matched
      // fallbacks alone, and hydration writes the complete chains back.
      createElement(StrictMode, null, createElement<ThemeAttributeProps>(ThemeAttribute, {
        initialFontFallbacks: { "--font-display": "'Space Grotesk Fallback'", "--font-body": "'Inter Fallback'" },
        fontFamilies: {
          "--font-display": "'Space Grotesk', 'Space Grotesk Fallback'",
          "--font-body": "'Inter', 'Inter Fallback'",
        },
      })),
      createElement("main", null, "Choose a pub"),
    ),
  );
  const parsed = new DOMParser().parseFromString(renderToStaticMarkup(shell), "text/html");
  const html = document.documentElement;
  const previousAttributes = Array.from(html.attributes, ({ name, value }) => [name, value] as const);
  const previousChildren = Array.from(html.childNodes);
  const oldMatchMedia = window.matchMedia;
  let root: Root | undefined;
  const restoreAttributes = (attributes: ReadonlyArray<readonly [string, string]>) => {
    for (const attribute of Array.from(html.attributes)) html.removeAttribute(attribute.name);
    for (const [name, value] of attributes) html.setAttribute(name, value);
  };
  window.matchMedia = vi.fn(() => ({ matches: false }) as MediaQueryList);
  try {
    restoreAttributes(Array.from(parsed.documentElement.attributes, ({ name, value }) => [name, value] as const));
    html.replaceChildren(...Array.from(parsed.documentElement.childNodes, (node) => document.importNode(node, true)));

    const expectCompleteFamilies = () => {
      const computed = getComputedStyle(html);
      expect.soft(computed.getPropertyValue("--font-display").trim())
        .toBe("'Space Grotesk', 'Space Grotesk Fallback'");
      expect.soft(computed.getPropertyValue("--font-body").trim())
        .toBe("'Inter', 'Inter Fallback'");
    };
    // The server-created document, before any client initializer runs, paints
    // only the matched fallbacks so no webfont request precedes hydration.
    const computed = getComputedStyle(html);
    expect.soft(computed.getPropertyValue("--font-display").trim()).toBe("'Space Grotesk Fallback'");
    expect.soft(computed.getPropertyValue("--font-body").trim()).toBe("'Inter Fallback'");
    await act(async () => { root = hydrateRoot(document, shell); });
    expect(document.querySelector("main")?.textContent).toBe("Choose a pub");
    expect(html.dataset.theme).toBe("light");
    expectCompleteFamilies();
  } finally {
    act(() => root?.unmount());
    html.replaceChildren(...previousChildren);
    restoreAttributes(previousAttributes);
    window.matchMedia = oldMatchMedia;
  }
});
