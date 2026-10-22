// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PalPortrait from "@/components/pal/PalPortrait";
import { pubPalMascotModelSrc } from "@/lib/pubPalMascot";
import provenance from "@/public/brand/pals/provenance.json";
import { DEFAULT_PAL_DRAFT, PAL_ONBOARDING_SPECIES } from "@/lib/pubPal";

function portrait(compact = false) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(createElement(PalPortrait, {
    appearance: DEFAULT_PAL_DRAFT.appearance,
    name: "Nova",
    compact,
  }));
  return container;
}

describe("the original Pal model portrait", () => {
  it("reserves the owned full portrait's named 3D surface while retaining its original picture", () => {
    const container = portrait();
    const model = container.querySelector('[role="img"][aria-label*="Nova in 3D"]');
    expect(model).not.toBeNull();
    expect(model?.getAttribute("aria-hidden")).toBe("true");
    expect(model?.hasAttribute("tabindex")).toBe(false);
    expect(container.querySelector("img")?.getAttribute("src")).toContain("/pal/circuit-robin-");
  });

  it("keeps compact avatars as pictures", () => {
    const container = portrait(true);
    expect(container.querySelector('[aria-label*="in 3D"]')).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
  });
});


describe("the shipped original character models", () => {
  it.each(PAL_ONBOARDING_SPECIES)("loads %s as its own textured mesh with unchanged source artwork", species => {
    const url = pubPalMascotModelSrc(species);
    expect(url).toMatch(new RegExp(`/brand/pals/circuit-${species}-[a-f0-9]+\\.glb$`));
    const bytes = readFileSync(`public${url}`);
    expect(bytes.toString("utf8", 0, 4)).toBe("glTF");
    expect(bytes.readUInt32LE(4)).toBe(2);
    const model = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
    expect(model.meshes[0].primitives[0].attributes.POSITION).toEqual(expect.any(Number));
    expect(model.images[0].bufferView).toEqual(expect.any(Number));
    expect(model.images.every((image: { uri?: string }) => !image.uri)).toBe(true);
    expect(model.buffers.every((buffer: { uri?: string }) => !buffer.uri)).toBe(true);
    const record = provenance.models.find(row => row.species === species)!;
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(record.sha256);
    expect(createHash("sha256").update(readFileSync(record.source)).digest("hex")).toBe(record.sourceSha256);
  });

  it("uses the greyhound model for its legacy hound identity and no model for a legacy raven", () => {
    expect(pubPalMascotModelSrc("hound")).toBe(pubPalMascotModelSrc("greyhound"));
    expect(pubPalMascotModelSrc("raven")).toBeNull();
  });
});
