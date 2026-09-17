// The fit lands an 8 MB phone photo under the wire limit, and says when it
// cannot. Decoding is faked, because jsdom has no canvas: what is under test is
// the walk down the ladder and what leaves it.

import { describe, expect, it, vi } from "vitest";

import { fitMomentPhoto, type DecodedMomentPhoto } from "@/lib/momentPhotoFit";
import { MOMENT_FIT_LONG_EDGES, MOMENT_FIT_QUALITIES, planMomentFitAttempts } from "@/lib/momentPhotoIntake";
import { UPLOAD_PHOTO_MAX_BYTES } from "@/lib/uploadBodyLimit";

/** The battle test's fixture: a 4032x3024 JPEG of 8,060,438 bytes. */
const EIGHT_MB = 8_060_438;

function fixture(size = EIGHT_MB, name = "mid.jpg"): File {
  return new File([new Uint8Array(size)], name, { type: "image/jpeg", lastModified: 1_700_000_000_000 });
}

/**
 * A fake encoder whose output weighs what a heavy JPEG of that box and quality
 * would: bytes per pixel scaled by quality. At 1.2 bytes a pixel the 2560 rung
 * still weighs over the limit and the 2048 rung sits under it.
 */
const HEAVY_BYTES_PER_PIXEL = 1.2;

function fakeDecoder(natural = { width: 4032, height: 3024 }, bytesPerPixel = HEAVY_BYTES_PER_PIXEL) {
  const draws: Array<{ width: number; height: number; quality: number }> = [];
  const close = vi.fn();
  const decode = async (): Promise<DecodedMomentPhoto> => ({
    ...natural,
    draw: async (box, quality) => {
      draws.push({ ...box, quality });
      const size = Math.round(box.width * box.height * bytesPerPixel * quality);
      return new Blob([new Uint8Array(size)], { type: "image/jpeg" });
    },
    close,
  });
  return { decode, draws, close };
}

describe("fitMomentPhoto", () => {
  it("lands the 8 MB fixture under the wire limit as a JPEG named after it", async () => {
    const deps = fakeDecoder();
    const result = await fitMomentPhoto(fixture(), UPLOAD_PHOTO_MAX_BYTES, deps);
    expect(result.outcome).toBe("fitted");
    if (result.outcome !== "fitted") return;
    expect(result.file.size).toBeLessThanOrEqual(UPLOAD_PHOTO_MAX_BYTES);
    expect(result.file.type).toBe("image/jpeg");
    expect(result.file.name).toBe("mid.jpg");
    expect(result.file.lastModified).toBe(1_700_000_000_000);
    expect(deps.close).toHaveBeenCalledTimes(1);
  });

  it("takes the first rung that fits, so no more is thrown away than has to be", async () => {
    const deps = fakeDecoder();
    const result = await fitMomentPhoto(fixture(), UPLOAD_PHOTO_MAX_BYTES, deps);
    if (result.outcome !== "fitted") throw new Error(result.outcome);
    const plan = planMomentFitAttempts({ width: 4032, height: 3024 });
    expect(deps.draws).toHaveLength(result.attempts);
    expect(result.attempt).toEqual(plan[result.attempts - 1]);
    // Every earlier rung really was too heavy.
    for (const draw of deps.draws.slice(0, -1)) {
      expect(Math.round(draw.width * draw.height * HEAVY_BYTES_PER_PIXEL * draw.quality)).toBeGreaterThan(UPLOAD_PHOTO_MAX_BYTES);
    }
    // The rung it stopped on keeps the top edge and gives up quality first,
    // which is the ladder's order: pixels are what a screen shows.
    expect(result.attempt.longEdge).toBe(MOMENT_FIT_LONG_EDGES[0]);
    expect(result.attempt.quality).toBe(MOMENT_FIT_QUALITIES[2]);
  });

  it("says unreadable when the browser cannot decode the file, and draws nothing", async () => {
    const decode = vi.fn(async () => null);
    expect(await fitMomentPhoto(fixture(), UPLOAD_PHOTO_MAX_BYTES, { decode })).toEqual({ outcome: "unreadable" });
    const throwing = vi.fn(async () => { throw new Error("no decoder"); });
    expect(await fitMomentPhoto(fixture(), UPLOAD_PHOTO_MAX_BYTES, { decode: throwing })).toEqual({ outcome: "unreadable" });
  });

  it("says too-large when even the floor of the ladder weighs too much", async () => {
    // Twenty bytes a pixel is no JPEG; it proves the honest exit exists.
    const deps = fakeDecoder({ width: 4032, height: 3024 }, 20);
    const result = await fitMomentPhoto(fixture(), UPLOAD_PHOTO_MAX_BYTES, deps);
    expect(result).toEqual({ outcome: "too-large" });
    expect(deps.draws).toHaveLength(planMomentFitAttempts({ width: 4032, height: 3024 }).length);
    expect(deps.close).toHaveBeenCalledTimes(1);
  });

  it("skips a rung the encoder refused rather than giving up", async () => {
    const deps = fakeDecoder();
    let calls = 0;
    const flaky = {
      decode: async () => {
        const decoded = await deps.decode();
        return {
          ...decoded,
          draw: async (box: { width: number; height: number }, quality: number) => {
            calls += 1;
            if (calls === 1) throw new Error("encoder hiccup");
            return decoded.draw(box, quality);
          },
        };
      },
    };
    const result = await fitMomentPhoto(fixture(), UPLOAD_PHOTO_MAX_BYTES, flaky);
    expect(result.outcome).toBe("fitted");
  });
});
