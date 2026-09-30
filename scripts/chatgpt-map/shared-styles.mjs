import postcss from "postcss";

/** Project existing token owners and band classes into the standalone resource. */
export function sharedWidgetStyles(lightCss, darkCss) {
  const light = postcss.parse(lightCss);
  const dark = postcss.parse(darkCss);
  const declarations = (tree, selector) => {
    const rule = tree.nodes.find((node) => node.type === "rule" && node.selector === selector);
    if (!rule) throw new TypeError(`Missing shared theme owner: ${selector}`);
    return rule.nodes.filter((node) => node.type === "decl" && node.prop.startsWith("--"))
      .map((node) => `${node.prop}:${node.value};`).join("");
  };
  const bandRules = light.nodes.filter((node) => node.type === "rule" &&
    node.selector.split(",").every((selector) => /^\.priceBand-(cheap|average|expensive)$/.test(selector.trim())));
  if (bandRules.length !== 4) throw new TypeError("Shared price-band styles are unavailable.");
  const darkTokens = `${declarations(dark, 'html[data-theme="dark"]')}${declarations(dark, 'html[data-theme="dark"] body')}`;
  return `:root{${declarations(light, ":root")}${declarations(light, "body")}}` +
    `@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){${darkTokens}}}` +
    `:root[data-theme="dark"]{${darkTokens}}` +
    bandRules.map((rule) => rule.toString()).join("\n");
}
