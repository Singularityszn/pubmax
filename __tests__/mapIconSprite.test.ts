import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import manifest from "@/components/map/canvas/mapIconSprite.json";
import {
  decodeSpritePng,
  iconTokensMatch,
} from "@/components/map/canvas/iconSprite";
import {
  iconTokensFor,
  mapIconImageOptions,
  type Tokens,
} from "@/components/map/canvas/tokens";
import { MAP_ICON_SPECS, iconId, type IconTokens } from "@/lib/mapIcons";
import {
  MAP_ICON_TOKEN_CSS_PROPERTIES,
  mapIconSpriteFingerprint,
} from "@/scripts/lib/mapIconSpriteFingerprint.mjs";

// THE PRE-DRAWN MAP ICONS ARE DRAWN FROM THE CODE THAT IS IN THE TREE.
//
// The map registers its designed icons from a sprite drawn at build time
// (components/map/canvas/iconSprite.ts). A sprite drawn from yesterday's
// artwork or yesterday's colours would still load, still decode and still pass
// the runtime colour check whenever only the drawing changed, so this file is
// what notices: it recomputes the fingerprint of everything the sprite is drawn
// FROM and holds the committed one to it. The fix for a failure here is to run
// `npm run build:map-icon-sprites` and commit what it writes.

const ROOT = process.cwd();
const THEMES = ["light", "dark"] as const;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const png = (theme: string) =>
  new Uint8Array(readFileSync(join(ROOT, "public/map-icons", `${theme}.png`)));

describe("map icon sprite fence", () => {
  it("was drawn from the current artwork, colour recipe and theme tokens", () => {
    expect(
      manifest.fingerprint,
      "Map icon sprites are stale. Run npm run build:map-icon-sprites and commit the result.",
    ).toBe(mapIconSpriteFingerprint(ROOT));
  });

  it("lays out every designed icon at 2x, and nothing else", () => {
    expect(manifest.pixelRatio).toBe(2);
    const ids = MAP_ICON_SPECS.map((spec) => iconId(spec.ns, spec.key));
    expect(Object.keys(manifest.icons).sort()).toEqual([...ids].sort());
    for (const spec of MAP_ICON_SPECS) {
      const at = manifest.icons[iconId(spec.ns, spec.key) as keyof typeof manifest.icons];
      expect(at.width).toBe(spec.size * 2);
      expect(at.height).toBe((spec.height ?? spec.size) * 2);
      expect(at.x + at.width).toBeLessThanOrEqual(manifest.width);
      expect(at.y + at.height).toBeLessThanOrEqual(manifest.height);
    }
  });

  it("publishes each theme as a MapLibre sprite index of the same layout", () => {
    for (const theme of THEMES) {
      const index = JSON.parse(
        readFileSync(join(ROOT, "public/map-icons", `${theme}.json`), "utf8"),
      ) as Record<string, unknown>;
      for (const spec of MAP_ICON_SPECS) {
        const id = iconId(spec.ns, spec.key);
        expect(index[id], `${theme} ${id}`).toEqual({
          ...manifest.icons[id as keyof typeof manifest.icons],
          ...mapIconImageOptions(spec),
        });
      }
      expect(Object.keys(index)).toHaveLength(MAP_ICON_SPECS.length);
    }
  });

  it("decodes, in the runtime decoder, to exactly the pixels the build drew", async () => {
    for (const theme of THEMES) {
      const bytes = png(theme);
      expect(manifest.themes[theme].url).toBe(
        `/map-icons/${theme}.png?v=${sha256(bytes).slice(0, 12)}`,
      );
      const atlas = await decodeSpritePng(bytes);
      expect([atlas.width, atlas.height]).toEqual([manifest.width, manifest.height]);
      expect(sha256(atlas.data)).toBe(manifest.themes[theme].pixelsSha256);
    }
  });

  it("hashes every theme token the icon colours read", () => {
    const read = new Set<string>();
    const tokens = new Proxy({} as Tokens, {
      get(_target, field) {
        read.add(String(field));
        return "#123456";
      },
    });
    iconTokensFor(tokens, false);
    iconTokensFor(tokens, true);
    expect([...read].sort()).toEqual(Object.keys(MAP_ICON_TOKEN_CSS_PROPERTIES).sort());
    // And each field resolves from the property the fingerprint follows.
    const source = readFileSync(join(ROOT, "components/map/canvas/tokens.ts"), "utf8");
    for (const [field, property] of Object.entries(MAP_ICON_TOKEN_CSS_PROPERTIES)) {
      const mapped =
        source.includes(`${field}: "${property}"`) ||
        new RegExp(`const ${field} = resolvedColour\\("${property}"`).test(source);
      expect(mapped, `${field} must read ${property}`).toBe(true);
    }
  });
});

describe("iconTokensMatch", () => {
  const drawn = manifest.themes.light.tokens as Readonly<Record<string, string>>;
  const live = { ...drawn } as IconTokens;

  it("accepts the colours the sprite was drawn with", () => {
    expect(iconTokensMatch(drawn, live)).toBe(true);
  });

  it("accepts another browser's rounding of a computed colour", () => {
    expect(
      iconTokensMatch(drawn, { ...live, pillSurface: "rgb(255, 252, 249)", ink: "#18171A" }),
    ).toBe(true);
  });

  it("refuses another theme's colours, so the scene draws instead", () => {
    expect(iconTokensMatch(drawn, { ...live, ink: "#0b0f0c" })).toBe(false);
    expect(iconTokensMatch(drawn, { ...live, pinRim: "#eef3ef" })).toBe(false);
    expect(iconTokensMatch(drawn, { ...live, pillRim: "rgba(23, 23, 26, 0.5)" })).toBe(false);
    expect(iconTokensMatch(drawn, { ...live, ink: "oklch(0.2 0 0)" })).toBe(false);
  });
});

describe("scene icon registration", () => {
  const drawnSpy = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    drawnSpy.mockReset();
    vi.doMock("@/components/map/canvas/tokens", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/components/map/canvas/tokens")>()),
      // rasterize needs a real canvas, which this environment does not have.
      registerMapIcons: drawnSpy,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@/components/map/canvas/tokens");
  });

  function fakeMap() {
    const images = new Map<string, { image: unknown; options: unknown }>();
    return {
      images,
      hasImage: (id: string) => images.has(id),
      removeImage: (id: string) => images.delete(id),
      addImage: (id: string, image: unknown, options: unknown) => {
        images.set(id, { image, options });
      },
    };
  }

  function serveSprites(status = 200) {
    const fetch = vi.fn(async (url: string) => {
      const theme = /\/map-icons\/(light|dark)\.png/.exec(url)?.[1] ?? "missing";
      return status === 200 ? new Response(png(theme)) : new Response("", { status });
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  async function loaded() {
    const sprite = await import("@/components/map/canvas/iconSprite");
    return sprite;
  }

  it("draws while the atlas is still on its way, then registers it once decoded", async () => {
    const fetch = serveSprites();
    const { registerSceneIconImages, preloadMapIconSprite } = await loaded();
    const map = fakeMap();
    const live = manifest.themes.light.tokens as IconTokens;
    expect(registerSceneIconImages(map as never, "light", live)).toBe("drawn");
    expect(drawnSpy).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => {
      expect(registerSceneIconImages(fakeMap() as never, "light", live)).toBe("sprite");
    });
    preloadMapIconSprite("light");
    expect(fetch).toHaveBeenCalledTimes(1);

    expect(registerSceneIconImages(map as never, "light", live)).toBe("sprite");
    expect(map.images.size).toBe(MAP_ICON_SPECS.length);
    for (const spec of MAP_ICON_SPECS) {
      const entry = map.images.get(iconId(spec.ns, spec.key));
      expect(entry?.options).toEqual(mapIconImageOptions(spec));
      expect(entry?.image).toMatchObject({
        width: spec.size * 2,
        height: (spec.height ?? spec.size) * 2,
      });
    }
  });

  it("draws when the live colours are not the ones the atlas was drawn with", async () => {
    serveSprites();
    const { registerSceneIconImages, preloadMapIconSprite } = await loaded();
    preloadMapIconSprite("dark");
    const live = manifest.themes.dark.tokens as IconTokens;
    await vi.waitFor(() => {
      expect(registerSceneIconImages(fakeMap() as never, "dark", live)).toBe("sprite");
    });
    const map = fakeMap();
    expect(registerSceneIconImages(map as never, "dark", { ...live, ink: "#fdfaf2" })).toBe(
      "drawn",
    );
    expect(map.images.size).toBe(0);
  });

  it("draws for the life of the page when the atlas cannot be fetched", async () => {
    const fetch = serveSprites(404);
    const { registerSceneIconImages, preloadMapIconSprite } = await loaded();
    preloadMapIconSprite("light");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const live = manifest.themes.light.tokens as IconTokens;
    for (let i = 0; i < 3; i++) {
      await Promise.resolve();
      expect(registerSceneIconImages(fakeMap() as never, "light", live)).toBe("drawn");
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
