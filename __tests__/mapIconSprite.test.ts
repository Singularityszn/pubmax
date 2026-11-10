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
import { MAP_ICON_SPECS, iconId, type IconTokens, type IconSpec } from "@/lib/mapIcons";
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
const SHEETS = ["main", "landmarks"] as const;
const PRE_SPLIT_ICON_PIXEL_HASHES = {
  light: "026500e39b30f6c2b7454d79a7cf54849c313a9845e1807d95d34ea35ad8680e",
  dark: "097b727ee1bb807744b26dfdb00287cbb67be348b4eebe0b89e6e2fff86d1446",
};
const specsFor = (sheet: typeof SHEETS[number]) =>
  MAP_ICON_SPECS.filter((spec) => (spec.ns === "lm") === (sheet === "landmarks"));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const png = (theme: string, sheet: typeof SHEETS[number] = "main") =>
  new Uint8Array(readFileSync(join(ROOT, "public/map-icons", `${theme}${sheet === "main" ? "" : "-landmarks"}.png`)));

type SpriteImage = { width: number; height: number; data: Uint8Array };

function iconPixelHash(images: ReadonlyMap<string, SpriteImage>) {
  const hash = createHash("sha256");
  for (const id of [...images.keys()].sort()) {
    hash.update(id);
    hash.update(images.get(id)!.data);
  }
  return hash.digest("hex");
}

describe("map icon sprite fence", () => {
  it("was drawn from the current artwork, colour recipe and theme tokens", () => {
    expect(
      manifest.fingerprint,
      "Map icon sprites are stale. Run npm run build:map-icon-sprites and commit the result.",
    ).toBe(mapIconSpriteFingerprint(ROOT));
  });

  it("splits all 84 icons into 71 opening icons and 13 landmarks at 2x", () => {
    expect(manifest.pixelRatio).toBe(2);
    for (const sheet of SHEETS) {
      const entry = manifest.sheets[sheet];
      const icons = entry.icons as Record<string, { x: number; y: number; width: number; height: number }>;
      const specs = specsFor(sheet);
      expect(Object.keys(icons)).toHaveLength(sheet === "main" ? 71 : 13);
      expect(Object.keys(icons).sort()).toEqual(specs.map((spec) => iconId(spec.ns, spec.key)).sort());
      for (const spec of specs) {
        const at = icons[iconId(spec.ns, spec.key)]!;
        expect(at.width).toBe(spec.size * 2);
        expect(at.height).toBe((spec.height ?? spec.size) * 2);
        expect(at.x + at.width).toBeLessThanOrEqual(entry.width);
        expect(at.y + at.height).toBeLessThanOrEqual(entry.height);
      }
    }
  });

  it("publishes both sheets as MapLibre indexes with unchanged image options", () => {
    for (const theme of THEMES) {
      for (const sheet of SHEETS) {
        const filename = sheet === "main" ? theme : `${theme}-landmarks`;
        const index = JSON.parse(
          readFileSync(join(ROOT, "public/map-icons", `${filename}.json`), "utf8"),
        ) as Record<string, unknown>;
        const icons = manifest.sheets[sheet].icons as Record<string, unknown>;
        for (const spec of specsFor(sheet)) {
          const id = iconId(spec.ns, spec.key);
          expect(index[id], `${theme} ${id}`).toEqual({
            ...(icons[id] as object),
            ...mapIconImageOptions(spec),
          });
        }
        expect(Object.keys(index)).toHaveLength(specsFor(sheet).length);
      }
    }
  });

  it("decodes both sheets without changing any pre-split icon pixel", async () => {
    for (const theme of THEMES) {
      const images = new Map<string, SpriteImage>();
      for (const sheet of SHEETS) {
        const entry = manifest.sheets[sheet];
        const bytes = png(theme, sheet);
        const filename = sheet === "main" ? theme : `${theme}-landmarks`;
        expect(entry.themes[theme].url).toBe(
          `/map-icons/${filename}.png?v=${sha256(bytes).slice(0, 12)}`,
        );
        const atlas = await decodeSpritePng(bytes);
        expect([atlas.width, atlas.height]).toEqual([entry.width, entry.height]);
        expect(sha256(atlas.data)).toBe(entry.themes[theme].pixelsSha256);
        for (const [id, at] of Object.entries(entry.icons)) {
          const data = new Uint8Array(at.width * at.height * 4);
          for (let row = 0; row < at.height; row++) {
            const from = ((at.y + row) * atlas.width + at.x) * 4;
            data.set(atlas.data.subarray(from, from + at.width * 4), row * at.width * 4);
          }
          images.set(id, { width: at.width, height: at.height, data });
        }
      }
      expect(iconPixelHash(images)).toBe(PRE_SPLIT_ICON_PIXEL_HASHES[theme]);
      expect(png(theme).length).toBeLessThan((theme === "light" ? 70900 : 79101) - 12000);
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
  const drawn = manifest.sheets.main.themes.light.tokens as Readonly<Record<string, string>>;
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
  beforeEach(() => {
    vi.resetModules();
    performance.clearMarks("pubmax:pins-visible");
    vi.stubGlobal("window", new EventTarget());
    vi.doMock("@/components/map/canvas/tokens", async (importOriginal) => {
      const original = await importOriginal<typeof import("@/components/map/canvas/tokens")>();
      return {
        ...original,
        readTokens: () => ({}),
        iconTokensFor: (_tokens: unknown, dark: boolean) => manifest.sheets.main.themes[dark ? "dark" : "light"].tokens,
        addDrawnMapIcon: (map: ReturnType<typeof fakeMap>, spec: IconSpec) => {
          const id = iconId(spec.ns, spec.key);
          if (map.hasImage(id)) map.removeImage(id);
          map.addImage(id, { drawn: true }, original.mapIconImageOptions(spec));
        },
      };
    });
  });

  afterEach(() => {
    performance.clearMarks("pubmax:pins-visible");
    vi.unstubAllGlobals();
    vi.doUnmock("@/components/map/canvas/tokens");
  });

  function fakeMap(pixelRatio = 1) {
    const images = new Map<string, { image: unknown; options: unknown }>();
    return {
      images,
      getPixelRatio: () => pixelRatio,
      hasImage: (id: string) => images.has(id),
      removeImage: (id: string) => images.delete(id),
      addImage: (id: string, image: unknown, options: unknown) => {
        images.set(id, { image, options });
      },
    };
  }

  function serveSprites(failedSheet?: typeof SHEETS[number], mainResponseReady?: Promise<void>) {
    const fetch = vi.fn(async (url: string) => {
      const path = new URL(url, "https://pubmaxxing.com").pathname;
      const sheet = path.endsWith("-landmarks.png") ? "landmarks" : "main";
      if (sheet === "main") await mainResponseReady;
      return sheet === failedSheet
        ? new Response("", { status: 404 })
        : new Response(new Uint8Array(readFileSync(join(ROOT, "public", path))));
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  async function loaded() {
    return import("@/components/map/canvas/iconSprite");
  }

  function revealPins() {
    performance.mark("pubmax:pins-visible");
    window.dispatchEvent(new Event("pubmax:pins-visible"));
  }

  it("loads only the main sheet before visible pins, then loads landmarks once", async () => {
    const fetch = serveSprites();
    const { registerSceneIconImages, preloadMapIconSprite, resolveMissingMapIcon } = await loaded();
    const map = fakeMap();
    const live = manifest.sheets.main.themes.light.tokens as IconTokens;
    expect(registerSceneIconImages(map as never, "light", live)).toBe("drawn");
    expect(map.images.size).toBe(71);
    expect([...map.images.values()].every((entry) => (entry.image as { drawn?: boolean }).drawn)).toBe(true);
    expect(map.hasImage("lm:clock-tower")).toBe(false);
    expect(resolveMissingMapIcon(map as never, "lm:clock-tower", "light")).toBe(true);
    expect(map.images.get("lm:clock-tower")?.image).toEqual({ drawn: true });
    expect(resolveMissingMapIcon(map as never, "unrelated:missing", "light")).toBe(false);

    await vi.waitFor(() => {
      expect(registerSceneIconImages(fakeMap() as never, "light", live)).toBe("sprite");
    });
    preloadMapIconSprite("light");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([manifest.sheets.main.themes.light.url]);
    revealPins();
    await vi.waitFor(() => {
      const ready = fakeMap();
      registerSceneIconImages(ready as never, "light", live);
      expect(ready.images.size).toBe(84);
    });
    revealPins();
    preloadMapIconSprite("light");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      manifest.sheets.main.themes.light.url,
      manifest.sheets.landmarks.themes.light.url,
    ]);
    const ready = fakeMap();
    expect(resolveMissingMapIcon(ready as never, "lm:clock-tower", "light")).toBe(true);
    expect(ready.images.get("lm:clock-tower")?.image).toMatchObject({ width: 60, height: 60 });
  });

  it.each([1, 2, 3])("keeps original pixels and image options at map pixel ratio %i across theme swaps", async (pixelRatio) => {
    const mainResponse = Promise.withResolvers<void>();
    const fetch = serveSprites(undefined, mainResponse.promise);
    performance.mark("pubmax:pins-visible");
    const { registerSceneIconImages, preloadMapIconSprite, resolveMissingMapIcon } = await loaded();
    const map = fakeMap(pixelRatio);
    preloadMapIconSprite("light");
    await vi.waitFor(() => {
      const ready = fakeMap(pixelRatio);
      resolveMissingMapIcon(ready as never, "lm:clock-tower", "light");
      expect(ready.images.get("lm:clock-tower")?.image).toHaveProperty("data");
    });
    mainResponse.resolve();
    for (const theme of ["light", "dark", "light"] as const) {
      const live = manifest.sheets.main.themes[theme].tokens as IconTokens;
      preloadMapIconSprite(theme);
      await vi.waitFor(() => {
        expect(registerSceneIconImages(map as never, theme, live)).toBe("sprite");
        expect(map.images.size).toBe(84);
        for (const spec of MAP_ICON_SPECS) {
          const entry = map.images.get(iconId(spec.ns, spec.key));
          expect(entry?.options).toEqual(mapIconImageOptions(spec));
          expect(entry?.image).toMatchObject({ width: spec.size * 2, height: (spec.height ?? spec.size) * 2 });
        }
        const images = new Map([...map.images].map(([id, entry]) => [id, entry.image as SpriteImage]));
        expect(iconPixelHash(images)).toBe(PRE_SPLIT_ICON_PIXEL_HASHES[theme]);
      });
    }
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each(SHEETS)("a failed %s sheet cannot disable the other sheet", async (failedSheet) => {
    const fetch = serveSprites(failedSheet);
    performance.mark("pubmax:pins-visible");
    const { registerSceneIconImages, preloadMapIconSprite, resolveMissingMapIcon } = await loaded();
    const live = manifest.sheets.main.themes.light.tokens as IconTokens;
    preloadMapIconSprite("light");
    await vi.waitFor(() => {
      const ready = fakeMap();
      registerSceneIconImages(ready as never, "light", live);
      const goodId = failedSheet === "main" ? "lm:clock-tower" : "tfl:underground";
      expect(ready.images.get(goodId)?.image).toHaveProperty("data");
    });
    const map = fakeMap();
    registerSceneIconImages(map as never, "light", live);
    if (failedSheet === "main") {
      for (const spec of specsFor("main")) {
        expect(map.images.get(iconId(spec.ns, spec.key))?.image).toEqual({ drawn: true });
      }
    } else {
      expect(map.hasImage("lm:clock-tower")).toBe(false);
      resolveMissingMapIcon(map as never, "lm:clock-tower", "light");
      expect(map.images.get("lm:clock-tower")?.image).toEqual({ drawn: true });
    }
    preloadMapIconSprite("light");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("draws main icons and resolves landmarks when live colours differ", async () => {
    serveSprites();
    performance.mark("pubmax:pins-visible");
    const { registerSceneIconImages, preloadMapIconSprite } = await loaded();
    const live = manifest.sheets.main.themes.dark.tokens as IconTokens;
    preloadMapIconSprite("dark");
    await vi.waitFor(() => {
      const ready = fakeMap();
      registerSceneIconImages(ready as never, "dark", live);
      expect(ready.images.size).toBe(84);
    });
    const map = fakeMap();
    expect(registerSceneIconImages(map as never, "dark", { ...live, ink: "#fdfaf2" })).toBe("drawn");
    expect(map.images.size).toBe(71);
    expect([...map.images.values()].every((entry) => (entry.image as { drawn?: boolean }).drawn)).toBe(true);
  });
});
