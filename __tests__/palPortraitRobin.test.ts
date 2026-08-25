import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PalPortrait from "@/components/pal/PalPortrait";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";

function portraitMarkup(species: typeof DEFAULT_PAL_DRAFT.appearance.species): string {
  return renderToStaticMarkup(
    createElement(PalPortrait, {
      appearance: { ...DEFAULT_PAL_DRAFT.appearance, species },
      name: "Pub Pal",
      state: "noticing",
    }),
  );
}

describe("PalPortrait circuit robin", () => {
  it("defaults /pal to the circuit robin with alt Pub Pal", () => {
    expect(DEFAULT_PAL_DRAFT.appearance.species).toBe("robin");
    const html = portraitMarkup(DEFAULT_PAL_DRAFT.appearance.species);
    expect(html).toContain("circuit-robin");
    expect(html).toMatch(/<img\b[^>]*alt="Pub Pal"/);
  });

  it("renders the circuit robin bitmap by default", () => {
    const html = portraitMarkup("robin");
    expect(html).toContain("circuit-robin");
    expect(html).toMatch(/<img\b[^>]*alt="Pub Pal"/);
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("palRigGreyhound");
  });

  it("keeps legacy rigs selectable for alternate forms", () => {
    const greyhound = portraitMarkup("greyhound");
    expect(greyhound).toContain("palRigGreyhound");
    expect(greyhound).not.toContain("circuit-robin");

    const cat = portraitMarkup("cat");
    expect(cat).toContain("palRigCat");
    expect(cat).not.toContain("circuit-robin");
  });
});
