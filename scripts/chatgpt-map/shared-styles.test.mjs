import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { sharedWidgetStyles } from "./shared-styles.mjs";

test("standalone map carries actual theme tokens and price classes without global UI rules", async () => {
  const [light, dark] = await Promise.all([
    readFile(new URL("../../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../../app/theme.css", import.meta.url), "utf8"),
  ]);
  const css = sharedWidgetStyles(light, dark);
  assert.match(css, /\.priceBand-cheap\s*\{/);
  assert.match(css, /--price-band-ink:\s*var\(--price-band-cheap-ink\)/);
  assert.match(css, /@media\(prefers-color-scheme:dark\)/);
  assert.ok(!css.includes("@import"));
  assert.ok(!css.includes(".siteNav"));
  assert.throws(() => sharedWidgetStyles(":root{}body{}", 'html[data-theme="dark"]{}'));
});
