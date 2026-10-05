import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  LONDON_COLLAGE_PHOTOS,
  LONDON_COLLAGE_WIDTHS,
  londonCollageSrc,
} from "@/lib/landingLondonCollage";
import { defined } from "@/__tests__/helpers/defined";

const root = process.cwd();

describe("founder collage assets are stripped and within budget", () => {
  it("ships every width and both formats for every photograph", () => {
    for (const photo of LONDON_COLLAGE_PHOTOS) {
      for (const width of LONDON_COLLAGE_WIDTHS) {
        for (const format of ["avif", "webp"] as const) {
          const src = londonCollageSrc(photo, width, format);
          const file = join(root, "public", src.replace(/^\//, ""));
          expect(existsSync(file), src).toBe(true);
          expect(statSync(file).size).toBeGreaterThan(500);
        }
      }
    }
  });

  it("keeps the phone file under the landing weight budget with no EXIF", async () => {
    for (const photo of LONDON_COLLAGE_PHOTOS) {
      const file = join(
        root,
        "public",
        londonCollageSrc(photo, LONDON_COLLAGE_WIDTHS[0], "avif").replace(/^\//, ""),
      );
      expect(statSync(file).size, `${photo.id} narrow AVIF`).toBeLessThan(150_000);
      const meta = await sharp(file).metadata();
      expect(meta.exif == null || meta.exif.length === 0, `${photo.id} EXIF`).toBe(true);
    }
  });

  it("records the widest encoded file's real dimensions in the manifest", async () => {
    const widest = LONDON_COLLAGE_WIDTHS[LONDON_COLLAGE_WIDTHS.length - 1];
    for (const photo of LONDON_COLLAGE_PHOTOS) {
      for (const format of ["avif", "webp"] as const) {
        const file = join(root, "public", londonCollageSrc(photo, defined(widest), format).replace(/^\//, ""));
        const meta = await sharp(file).metadata();
        expect({ width: meta.width, height: meta.height }, `${photo.id} ${format}`).toEqual({
          width: photo.width,
          height: photo.height,
        });
      }
    }
  });
});
