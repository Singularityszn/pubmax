import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sharedWidgetStyles } from "../../scripts/chatgpt-map/shared-styles.mjs";

let pending: Promise<string> | undefined;
export function nightArchitectWidget(): Promise<string> {
  if (!pending) pending = loadWidget().catch((error) => { pending = undefined; throw error; });
  return pending;
}
async function loadWidget() {
  const sdkPath = path.join(/* turbopackIgnore: true */ process.cwd(), "node_modules/@modelcontextprotocol/ext-apps/dist/src/app-with-deps.js");
  const [template, sdk, light, dark] = await Promise.all([
    readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "scripts/chatgpt-map/widget.html"), "utf8"),
    readFile(sdkPath, "utf8"),
    readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "app/globals.css"), "utf8"),
    readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "app/theme.css"), "utf8"),
  ]);
  return template.replace("/* PUBMAXX_SHARED_STYLES */", sharedWidgetStyles(light, dark))
    .replace("PUBMAXX_MCP_APPS_SDK", () => JSON.stringify(sdk).replaceAll("<", "\\u003c"));
}
