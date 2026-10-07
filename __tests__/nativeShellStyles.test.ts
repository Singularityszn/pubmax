// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import postcss, { type Rule } from "postcss";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NATIVE_SHELL_ATTRIBUTE } from "@/components/native/NativeShellChrome";

const nativeCss = readFileSync("components/native/nativeShell.css", "utf8");
const globalCss = readFileSync("app/globals.css", "utf8");
const nativeRules: Rule[] = [];
postcss.parse(nativeCss).walkRules((rule) => { nativeRules.push(rule); });

const markup = `
  <nav class="siteNavBar mobileTabBar surfaceNav">
    <a class="siteNavBrand">PUBMAXX</a>
    <div class="siteNavActions">
      <button class="siteNavBell"><svg></svg></button>
      <button class="themeToggle"><svg></svg></button>
      <button class="authCompactTrigger"><svg></svg></button>
    </div>
    <a class="mobileTab"><span class="mobileTabIcon"><svg></svg></span></a>
    <button class="createFab"></button>
    <button class="arrivalWelcomeDismiss"></button>
  </nav>
  <div class="screenSecondary"><a>Back</a><button>Retry</button></div>
  <details><summary>Details</summary></details>
  <label><input></label><textarea></textarea><div contenteditable="true">Edit</div>
  <div role="button"></div><div role="tab"></div><div role="switch"></div>
  <button><p>Pub name</p><span data-copyable>£4.50</span></button>
  <ul><li>Today</li></ul><dl><dd>£4.50</dd></dl><address>London</address>
  <blockquote>Words</blockquote><code>Code</code><pre>Text</pre>
  <div class="scroller" style="overscroll-behavior: contain">Scroll</div>
`;

function addStyle(css: string): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  return style;
}

function matchedDeclarations(element: Element, property: string): string[] {
  return nativeRules.filter((rule) => element.matches(rule.selector)).flatMap((rule) =>
    rule.nodes.flatMap((node) => node.type === "decl" && node.prop === property ? [node.value] : []),
  );
}

beforeEach(() => {
  document.body.innerHTML = markup;
});

afterEach(() => {
  document.head.querySelectorAll("style").forEach((style) => style.remove());
  document.body.innerHTML = "";
  document.documentElement.removeAttribute(NATIVE_SHELL_ATTRIBUTE);
  document.documentElement.removeAttribute("data-text-scale");
});

describe("the native stylesheet's selector behavior", () => {
  it.each(["ios", "android"])("matches native %s elements and no web elements", (platform) => {
    for (const scale of [null, "large"]) {
      if (scale) document.documentElement.setAttribute("data-text-scale", scale);
      else document.documentElement.removeAttribute("data-text-scale");
      document.documentElement.removeAttribute(NATIVE_SHELL_ATTRIBUTE);
      for (const rule of nativeRules) {
        expect([...document.querySelectorAll(rule.selector)], rule.selector).toEqual([]);
      }
    }
    document.documentElement.setAttribute(NATIVE_SHELL_ATTRIBUTE, platform);
    document.documentElement.setAttribute("data-text-scale", "large");
    for (const rule of nativeRules) {
      expect(document.querySelector(rule.selector), rule.selector).not.toBeNull();
    }
  });

  it.each(["ios", "android"])("removes %s chrome callouts while retaining copyable prose and fields", (platform) => {
    document.documentElement.setAttribute(NATIVE_SHELL_ATTRIBUTE, platform);
    for (const element of document.querySelectorAll(
      "button, a, summary, label, [role=button], [role=tab], [role=switch], .mobileTabBar, .siteNavBar, .surfaceNav, .createFab",
    )) {
      expect(matchedDeclarations(element, "-webkit-touch-callout")).toEqual(["none"]);
    }
    for (const element of document.querySelectorAll(
      "input, textarea, [contenteditable=true], p, li, dd, address, blockquote, code, pre, [data-copyable]",
    )) {
      expect(matchedDeclarations(element, "-webkit-touch-callout")).toEqual(["default"]);
    }
  });

  it("suppresses Android tap highlighting on every native element", () => {
    document.documentElement.setAttribute(NATIVE_SHELL_ATTRIBUTE, "android");
    for (const element of document.querySelectorAll("body, body *")) {
      expect(matchedDeclarations(element, "-webkit-tap-highlight-color")).toEqual(["transparent"]);
    }
  });
});

describe("the native stylesheet's computed behavior", () => {
  it.each(["ios", "android"])("contains the %s document and leaves inner scrolling intact", (platform) => {
    addStyle(nativeCss);
    document.documentElement.setAttribute(NATIVE_SHELL_ATTRIBUTE, platform);
    expect(getComputedStyle(document.documentElement).overscrollBehavior).toBe("none");
    expect(getComputedStyle(document.body).overscrollBehavior).toBe("none");
    expect(getComputedStyle(document.body).overflowX).toBe("hidden");
    expect(getComputedStyle(document.querySelector(".scroller")!).overscrollBehavior).toBe("contain");
    document.documentElement.removeAttribute(NATIVE_SHELL_ATTRIBUTE);
    expect(getComputedStyle(document.documentElement).overscrollBehavior).not.toBe("none");
    expect(getComputedStyle(document.body).overscrollBehavior).not.toBe("none");
    expect(getComputedStyle(document.body).overflowX).toBe("visible");
  });

  it.each(["ios", "android"])("preserves shared %s selection, blur and inset geometry", (platform) => {
    addStyle(globalCss);
    const elements = [...document.querySelectorAll("html, body, body *")];
    const properties = [
      "user-select", "backdrop-filter", "-webkit-backdrop-filter",
      "padding-top", "padding-right", "padding-bottom", "padding-left",
      "margin-top", "margin-right", "margin-bottom", "margin-left",
      "top", "right", "bottom", "left",
    ];
    const baseline = elements.map((element) => {
      const style = getComputedStyle(element);
      return properties.map((property) => style.getPropertyValue(property));
    });
    expect(getComputedStyle(document.querySelector("button")!).userSelect).toBe("none");
    for (const element of document.querySelectorAll("p, input, textarea, [contenteditable=true], [data-copyable]")) {
      expect(getComputedStyle(element).userSelect).not.toBe("none");
    }
    addStyle(nativeCss);
    document.documentElement.setAttribute(NATIVE_SHELL_ATTRIBUTE, platform);
    for (const scale of [null, "large"]) {
      if (scale) document.documentElement.setAttribute("data-text-scale", scale);
      else document.documentElement.removeAttribute("data-text-scale");
      expect(elements.map((element) => {
        const style = getComputedStyle(element);
        return properties.map((property) => style.getPropertyValue(property));
      })).toEqual(baseline);
    }
  });
});
