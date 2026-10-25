import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PalPortrait from "@/components/pal/PalPortrait";
import { PAL_MASCOT_SLUGS } from "@/lib/palMascotAssets.mjs";
import { DEFAULT_PAL_DRAFT, PAL_ONBOARDING_SPECIES } from "@/lib/pubPal";

function portraitMarkup(species: typeof DEFAULT_PAL_DRAFT.appearance.species, compact = false): string {
  return renderToStaticMarkup(
    createElement(PalPortrait, {
      appearance: { ...DEFAULT_PAL_DRAFT.appearance, species },
      name: "Pub Pal",
      state: "noticing",
      compact,
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
    expect(html).toContain('aria-hidden="true"');
  });

  it("draws the rendered species from its own master, never the robin's", () => {
    const greyhound = portraitMarkup("greyhound");
    expect(greyhound).toContain("circuit-greyhound");
    expect(greyhound).not.toContain("circuit-robin");

    const cat = portraitMarkup("cat");
    expect(cat).toContain("circuit-cat");
    expect(cat).not.toContain("circuit-robin");
  });

  it("draws every onboarding species from its own master", () => {
    for (const species of PAL_ONBOARDING_SPECIES) {
      const html = portraitMarkup(species);
      expect(html).toContain(`/pal/${PAL_MASCOT_SLUGS[species]}-`);
      expect(html).toContain('aria-hidden="true"');
    }
  });

  it("draws the legacy hound from the greyhound's master, because it is the same dog", () => {
    const hound = portraitMarkup("hound");
    expect(hound).toContain("circuit-greyhound");
    expect(hound).toContain('aria-hidden="true"');
  });

  it("draws a legacy species with no master as a named icon, never a rig", () => {
    const raven = portraitMarkup("raven");
    expect(raven).toContain('role="img"');
    expect(raven).toContain("signal raven");
    expect(raven).toContain("palLegacyIcon");
    expect(raven).not.toContain("/pal/circuit-");
  });

  // The rigs were deleted with the captain's 2026-09-04 decision: a species
  // with a master draws its own photograph and model host, never a rig.
  it("renders each supported species from its own master with a model host, never a rig or icon", () => {
    for (const species of PAL_ONBOARDING_SPECIES) {
      const html = portraitMarkup(species);
      expect(html).toContain(`/pal/${PAL_MASCOT_SLUGS[species]}-`);
      expect(html).toContain("data-pal-model-host");
      expect(html).not.toContain("palRig");
      expect(html).not.toContain("palLegacyIcon");
      const compact = portraitMarkup(species, true);
      expect(compact).toContain(`/pal/${PAL_MASCOT_SLUGS[species]}-`);
      expect(compact).not.toContain("data-pal-model-host");
    }
  });

  it("keeps the legacy hound on the greyhound master and a legacy icon off the model host", () => {
    const hound = portraitMarkup("hound");
    expect(hound).toContain("circuit-greyhound");
    expect(hound).not.toContain("palLegacyIcon");
    const raven = portraitMarkup("raven");
    expect(raven).toMatch(/<svg\b[^>]*palLegacyIcon/);
    expect(raven).not.toContain("data-pal-model-host");
    expect(raven).not.toContain("palRig");
  });
});
