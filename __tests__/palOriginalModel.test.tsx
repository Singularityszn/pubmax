// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PalPortrait from "@/components/pal/PalPortrait";
import { pubPalMascotModelSrc } from "@/lib/pubPalMascot";
const originalModelHashes: Record<string, string> = {
  "badger": "fc29854514084db1e4a6595fe57b22d2857e98df71b5bd0fdbf0b056a743ed7b",
  "cat": "670f87fb3ef4d113c97042c6e2a59c2fceb9273abbe88f6bece3b4ab9518d51d",
  "corgi": "d1976c8a1f13ae50efa47c3fd55f490cf9a13d1537e207a42312adfa2efc3c69",
  "fox": "80d07a250094238a5bae7a0b5d7ccaa5cc31e06203dc9518a0e9d341d64771ba",
  "greyhound": "da3e419643d6b8fa359c2cf2b0ecc99a50e19b6455e3c58c2fae93000f9cd172",
  "pigeon": "8176ffb4669b0dc3db01fecb3625e6dd2c136672d7bf814a03ec7b7e3ff88558",
  "robin": "c69915c4a4df2bd44e52a91d9d4f301182d0d45e612215ad88a726e2ba87f327"
};
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
  it.each(PAL_ONBOARDING_SPECIES)("loads %s as its exact original textured mesh", species => {
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
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(originalModelHashes[species]);
  });

  it("uses the greyhound model for its legacy hound identity and no model for a legacy raven", () => {
    expect(pubPalMascotModelSrc("hound")).toBe(pubPalMascotModelSrc("greyhound"));
    expect(pubPalMascotModelSrc("raven")).toBeNull();
  });
});
