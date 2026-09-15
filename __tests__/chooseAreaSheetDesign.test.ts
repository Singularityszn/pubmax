import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const component = read("components/map/ChooseAreaSheet.tsx");
const styles = read("components/map/chooseAreaSheet.css");

describe("choose area sheet headings", () => {
  it("gives the desktop dialog its own heading role", () => {
    expect(component).toContain(
      'className="chooseAreaSectionTitle chooseAreaDesktopTitle"',
    );
  });

  it("keeps headings sentence case and uses the display scale for the dialog title", () => {
    const section = styles.match(/\.chooseAreaSectionTitle\s*{([^}]*)}/)?.[1] ?? "";
    const title = styles.match(/\.chooseAreaDesktopTitle\s*{([^}]*)}/)?.[1] ?? "";
    expect(section).not.toContain("text-transform: uppercase");
    expect(section).toContain("font-size: var(--text-sm)");
    expect(title).toContain("font-family: var(--font-display)");
    expect(title).toContain("font-size: var(--text-lg)");
  });
});
