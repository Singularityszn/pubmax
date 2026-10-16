// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  act,
  Children,
  createElement,
  isValidElement,
  StrictMode,
  type ReactElement,
  type ReactNode,
} from "react";
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

type LayoutElement = ReactElement<{ children?: ReactNode }>;

function findElement(node: ReactNode, matches: (element: LayoutElement) => boolean): LayoutElement | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (matches(child)) return child;
    const found = findElement(child.props.children, matches);
    if (found) return found;
  }
  return undefined;
}

it("uses matched fallbacks before hydration and restores both complete generated families", async () => {
  const layout = await RootLayout({ children: createElement("main", null, "Choose a pub") });
  // The layout's own head font rule and theme initializer, as it renders them.
  const head = findElement(layout, (element) => element.type === "head");
  const fontRule = Children.toArray(head?.props.children).find(
    (child): child is LayoutElement => isValidElement(child) && child.type === "style",
  );
  const themeAttribute = findElement(layout, (element) => element.type === ThemeAttribute);
  if (!fontRule || !themeAttribute) throw new Error("The layout must render its head font rule and ThemeAttribute.");
  // ThemeAttribute removes exactly the temporary values the document carries.
  expect(themeAttribute.props).toEqual({ initialFontFallbacks: layout.props.style });
  // Keep the real document attributes. Providers do not own the font cascade,
  // so render only its real theme initializer and representative page content.
  const shell = createElement(layout.type, layout.props,
    // Production order: the layout imports next/font before root-shell.css, so
    // the generated variable classes precede the equally specific :root rules.
    createElement("head", null,
      fontRule,
      createElement("style", null,
        ".display-variable{--font-display:'Space Grotesk', 'Space Grotesk Fallback'}" +
        ".body-variable{--font-body:'Inter', 'Inter Fallback'}" +
        globalFontRules(),
      ),
    ),
    createElement("body", null,
      createElement(StrictMode, null, themeAttribute),
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

    const families = (name: string) => postcss.list
      .comma(getComputedStyle(html).getPropertyValue(name))
      .map((family) => family.trim().replace(/^(["'])(.*)\1$/, "$2"));
    // This is the server-created document before any client initializer runs.
    expect(families("--font-display")).toEqual(["Space Grotesk Fallback"]);
    expect(families("--font-body")).toEqual(["Inter Fallback"]);
    await act(async () => { root = hydrateRoot(document, shell); });
    expect(document.querySelector("main")?.textContent).toBe("Choose a pub");
    expect(html.dataset.theme).toBe("light");
    expect(families("--font-display")).toEqual(["Space Grotesk", "Space Grotesk Fallback"]);
    expect(families("--font-body")).toEqual(["Inter", "Inter Fallback"]);
  } finally {
    act(() => root?.unmount());
    html.replaceChildren(...previousChildren);
    restoreAttributes(previousAttributes);
    window.matchMedia = oldMatchMedia;
  }
});
