import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import postcss from "postcss";
import { sharedWidgetStyles } from "./shared-styles.mjs";

test("standalone map carries actual theme tokens and price classes without global UI rules", async () => {
  const [light, dark] = await Promise.all([
    readFile(new URL("../../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../../app/theme.css", import.meta.url), "utf8"),
  ]);
  const css = sharedWidgetStyles(light, dark);
  assert.match(css, /\.priceBand-cheap\s*\{/);
  assert.match(css, /--price-band-ink:\s*var\(--price-band-cheap-ink\)/);
  const tree = postcss.parse(css);
  const osDark = tree.nodes.find((node) => node.type === "atrule" && node.params === "(prefers-color-scheme:dark)");
  const hostDark = tree.nodes.find((node) => node.type === "rule" && node.selector === ':root[data-theme="dark"]');
  assert.equal(osDark.nodes[0].selector, ':root:not([data-theme="light"])');
  assert.ok(hostDark.nodes.some((node) => node.prop === "--paper"));
  assert.deepEqual(hostDark.nodes.map(String), osDark.nodes[0].nodes.map(String));
  assert.ok(!css.includes("@import"));
  assert.ok(!css.includes(".siteNav"));
  assert.throws(() => sharedWidgetStyles(":root{}body{}", 'html[data-theme="dark"]{}'));
});
