import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

/** One XML plist element as the value it declares. */
function plistValue(element: Element): PlistValue {
  const children = [...element.children];
  switch (element.tagName) {
    case "dict":
      return Object.fromEntries(
        children.flatMap((child, index) =>
          child.tagName === "key" && children[index + 1]
            ? [[child.textContent ?? "", plistValue(children[index + 1] as Element)]]
            : [],
        ),
      );
    case "array":
      return children.map(plistValue);
    case "integer":
    case "real":
      return Number(element.textContent);
    case "true":
      return true;
    case "false":
      return false;
    default:
      return element.textContent ?? "";
  }
}

/**
 * The root dict of a checked-in XML plist, as the values Apple reads. Parses
 * with the jsdom `DOMParser`, so the calling suite runs in jsdom.
 */
export function plistRoot(path: string): Record<string, PlistValue> {
  const document = new DOMParser().parseFromString(
    readFileSync(join(process.cwd(), path), "utf8"),
    "application/xml",
  );
  const dict = document.querySelector("plist > dict");
  if (!dict) throw new Error(`${path} has no root dict`);
  return plistValue(dict) as Record<string, PlistValue>;
}
