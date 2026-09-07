import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SOCIAL_PHOTO_PICKER_ACCEPT,
  SOCIAL_PHOTO_OUTPUT_DIMENSION,
  prepareSocialGalleryPhoto,
  prepareSocialGalleryPhotos,
  type SocialPhotoPreparationDeps,
} from "@/lib/socialPhotoPreparation";
import { UPLOAD_PHOTO_MAX_BYTES } from "@/lib/uploadBodyLimit";

const signatures = {
  jpeg: [0xff, 0xd8, 0xff, 0xe1],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  webp: Array.from(Buffer.from("RIFF0000WEBP")),
  heic: Array.from(Buffer.from("0000ftypheic")),
  heif: Array.from(Buffer.from("0000ftypmif1")),
};

function photo(kind: keyof typeof signatures = "jpeg", name = `night.${kind}`): File {
  return new File([new Uint8Array(signatures[kind]), "original EXIF GPS metadata"], name, {
    type: `image/${kind}`, lastModified: 1234,
  });
}

function decoder(width = 4032, height = 3024, bytes = 1_000) {
  const close = vi.fn();
  const draw = vi.fn(async () => new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
  const decode = vi.fn(async () => ({ width, height, draw, close }));
  return { decode, draw, close };
}

afterEach(() => vi.unstubAllGlobals());

describe("Social gallery photo preparation", () => {
  it("offers phone library formats and matches the server's output dimension", () => {
    expect(SOCIAL_PHOTO_PICKER_ACCEPT.split(",")).toEqual([
      "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
    ]);
    const server = readFileSync(new URL("../lib/socialPostMedia.server.ts", import.meta.url), "utf8");
    const dimension = server.match(/SOCIAL_PHOTO_OUTPUT_DIMENSION\s*=\s*([\d_]+)/)?.[1];
    expect(Number(dimension?.replaceAll("_", ""))).toBe(SOCIAL_PHOTO_OUTPUT_DIMENSION);
  });

  it.each(Object.keys(signatures) as Array<keyof typeof signatures>)("prepares %s pixels as JPEG, retaining the original", async (kind) => {
    const original = photo(kind);
    const deps = decoder();
    const result = await prepareSocialGalleryPhoto(original, {}, deps);
    expect(result.outcome).toBe("prepared");
    if (result.outcome !== "prepared") throw new Error(result.outcome);
    expect(result.originalFile).toBe(original);
    expect(result.file).not.toBe(original);
    expect(result.file.type).toBe("image/jpeg");
    expect(result.file.name).toBe("night.jpg");
    expect(result.file.lastModified).toBe(1234);
    expect(await result.file.text()).not.toContain("EXIF GPS");
    expect(await original.text()).toContain("EXIF GPS");
    expect(deps.draw).toHaveBeenCalledExactlyOnceWith({ width: 1200, height: 900 }, 0.9);
    expect(deps.close).toHaveBeenCalledOnce();
  });

  it.each([
    [3024, 4032, 900, 1200], [6000, 1000, 1200, 200], [320, 480, 320, 480],
  ])("keeps all framing for %ix%i without upscaling", async (width, height, outputWidth, outputHeight) => {
    const deps = decoder(width, height);
    const result = await prepareSocialGalleryPhoto(photo(), {}, deps);
    expect(result).toMatchObject({ outcome: "prepared", width: outputWidth, height: outputHeight });
    expect(deps.draw).toHaveBeenCalledWith({ width: outputWidth, height: outputHeight }, 0.9);
  });

  it("sniffs bytes rather than trusting the filename or MIME type", async () => {
    const deps = decoder();
    const original = new File(["plain text"], "night.jpg", { type: "image/jpeg" });
    expect(await prepareSocialGalleryPhoto(original, {}, deps)).toMatchObject({ outcome: "failed", originalFile: original });
    expect(deps.decode).not.toHaveBeenCalled();
    const mislabeled = new File([photo("png")], "night.txt", { type: "text/plain" });
    expect(await prepareSocialGalleryPhoto(mislabeled, {}, deps)).toMatchObject({ outcome: "prepared" });
  });

  it("accepts an 8 MiB phone original and rejects empty or over-30 MiB files before decoding", async () => {
    const deps = decoder();
    const large = new File([photo(), new Uint8Array(8 * 1024 * 1024)], "phone.jpg");
    expect(await prepareSocialGalleryPhoto(large, {}, deps)).toMatchObject({ outcome: "prepared", originalFile: large });
    deps.decode.mockClear();
    for (const file of [new File([], "empty.jpg"), new File([new Uint8Array(30 * 1024 * 1024 + 1)], "huge.jpg")]) {
      expect(await prepareSocialGalleryPhoto(file, {}, deps)).toMatchObject({ outcome: "failed", originalFile: file });
    }
    expect(deps.decode).not.toHaveBeenCalled();
  });

  it("gives each of ten photos its own 4 MiB budget and decodes sequentially", async () => {
    let active = 0;
    const sizes: number[] = [];
    const deps: SocialPhotoPreparationDeps = {
      async decode() {
        expect(active).toBe(0);
        active++;
        return {
          width: 2000, height: 1500,
          async draw(_box, quality) {
            expect(quality).toBe(0.9);
            sizes.push(UPLOAD_PHOTO_MAX_BYTES);
            return new Blob([new Uint8Array(UPLOAD_PHOTO_MAX_BYTES)], { type: "image/jpeg" });
          },
          close() { active--; },
        };
      },
    };
    const files = Array.from({ length: 10 }, (_, index) => photo("jpeg", `${index}.jpg`));
    const results = await prepareSocialGalleryPhotos(files, {}, deps);
    expect(results.map((result) => result.originalFile)).toEqual(files);
    expect(results.every((result) => result.outcome === "prepared")).toBe(true);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(10 * UPLOAD_PHOTO_MAX_BYTES);
    expect(active).toBe(0);
  });

  it("bounds count before starting work", async () => {
    const deps = decoder();
    await expect(prepareSocialGalleryPhotos(Array.from({ length: 11 }, () => photo()), {}, deps)).rejects.toThrow("up to 10");
    expect(deps.decode).not.toHaveBeenCalled();
  });

  it("reduces only quality when needed and stops at the first per-photo fit", async () => {
    const deps = decoder();
    deps.draw.mockResolvedValueOnce(new Blob([new Uint8Array(UPLOAD_PHOTO_MAX_BYTES + 1)], { type: "image/jpeg" }));
    expect(await prepareSocialGalleryPhoto(photo(), {}, deps)).toMatchObject({ outcome: "prepared" });
    expect(deps.draw.mock.calls).toEqual([
      [{ width: 1200, height: 900 }, 0.9], [{ width: 1200, height: 900 }, 0.86],
    ]);
  });

  it("keeps the original on oversized, non-JPEG, empty, and failed encodes", async () => {
    const original = photo();
    for (const blob of [
      new Blob([new Uint8Array(UPLOAD_PHOTO_MAX_BYTES + 1)], { type: "image/jpeg" }),
      new Blob(["png"], { type: "image/png" }), new Blob([], { type: "image/jpeg" }),
    ]) {
      const deps = decoder();
      deps.draw.mockResolvedValue(blob);
      expect(await prepareSocialGalleryPhoto(original, {}, deps)).toMatchObject({ outcome: "failed", originalFile: original });
      expect(deps.close).toHaveBeenCalledOnce();
    }
    const deps = decoder();
    deps.draw.mockRejectedValue(new Error("canvas unavailable"));
    expect(await prepareSocialGalleryPhoto(original, {}, deps)).toMatchObject({ outcome: "failed", originalFile: original });
    expect(deps.close).toHaveBeenCalledOnce();
  });

  it("explains an undecodable HEIF and closes invalid decoded images", async () => {
    const original = photo("heif");
    const decode = vi.fn(async () => null);
    expect(await prepareSocialGalleryPhoto(original, {}, { decode })).toMatchObject({
      outcome: "failed", originalFile: original, message: expect.stringContaining("share it as a JPEG"),
    });
    const deps = decoder(0, 200);
    expect(await prepareSocialGalleryPhoto(photo(), {}, deps)).toMatchObject({ outcome: "failed" });
    expect(deps.draw).not.toHaveBeenCalled();
    expect(deps.close).toHaveBeenCalledOnce();
  });

  it("does not decode cancelled selections", async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = decoder();
    const original = photo();
    expect(await prepareSocialGalleryPhoto(original, { signal: controller.signal }, deps)).toEqual({ outcome: "aborted", originalFile: original });
    expect(deps.decode).not.toHaveBeenCalled();
  });

  it("closes after cancellation during decode and does not decode the next photo", async () => {
    const controller = new AbortController();
    const deps = decoder();
    deps.decode.mockImplementationOnce(async () => {
      controller.abort();
      return { width: 4032, height: 3024, draw: deps.draw, close: deps.close };
    });
    const results = await prepareSocialGalleryPhotos([photo(), photo()], { signal: controller.signal }, deps);
    expect(results.map((result) => result.outcome)).toEqual(["aborted", "aborted"]);
    expect(deps.decode).toHaveBeenCalledOnce();
    expect(deps.draw).not.toHaveBeenCalled();
    expect(deps.close).toHaveBeenCalledOnce();
  });

  it("discards prepared bytes after cancellation during encode", async () => {
    const controller = new AbortController();
    const deps = decoder();
    deps.draw.mockImplementationOnce(async () => {
      controller.abort();
      return new Blob(["encoded"], { type: "image/jpeg" });
    });
    expect(await prepareSocialGalleryPhoto(photo(), { signal: controller.signal }, deps)).toMatchObject({ outcome: "aborted" });
    expect(deps.close).toHaveBeenCalledOnce();
  });
});

describe("browser photo resources", () => {
  it("draws the whole oriented bitmap, strips metadata through canvas, and releases both resources", async () => {
    const bitmap = { width: 4032, height: 3024, close: vi.fn() };
    const createBitmap = vi.fn(async () => bitmap);
    const context = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: "", imageSmoothingEnabled: false, imageSmoothingQuality: "" };
    const canvas = {
      width: 0, height: 0, getContext: () => context,
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(["only encoded pixels"], { type: "image/jpeg" }))),
    };
    vi.stubGlobal("createImageBitmap", createBitmap);
    vi.stubGlobal("document", { createElement: () => canvas });
    const original = photo();
    expect(await prepareSocialGalleryPhoto(original)).toMatchObject({ outcome: "prepared" });
    expect(createBitmap).toHaveBeenCalledWith(original, { imageOrientation: "from-image" });
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1200, 900);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1200, 900);
    expect(context.fillStyle).toBe("#ffffff");
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.9);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it("closes a bitmap that completes after abort without creating a canvas", async () => {
    const controller = new AbortController();
    const bitmap = { width: 4032, height: 3024, close: vi.fn() };
    const canvas = vi.fn();
    vi.stubGlobal("createImageBitmap", async () => { controller.abort(); return bitmap; });
    vi.stubGlobal("document", { createElement: canvas });
    expect(await prepareSocialGalleryPhoto(photo(), { signal: controller.signal })).toMatchObject({ outcome: "aborted" });
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(canvas).not.toHaveBeenCalled();
  });

  it.each(["loaded", "error", "abort"])("revokes the fallback object URL when image decode is %s", async (outcome) => {
    const controller = new AbortController();
    const revoke = vi.fn();
    const image = { naturalWidth: 10, naturalHeight: 10, src: "", onload: null as null | (() => void), onerror: null as null | (() => void) };
    vi.stubGlobal("createImageBitmap", undefined);
    vi.stubGlobal("Image", class { constructor() { return image; } });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:photo", revokeObjectURL: revoke });
    // A decode success followed by an unavailable canvas also must release the image.
    vi.stubGlobal("document", { createElement: () => { throw new Error("no canvas"); } });
    const pending = prepareSocialGalleryPhoto(photo(), { signal: controller.signal });
    await vi.waitFor(() => expect(image.src).toBe("blob:photo"));
    if (outcome === "loaded") image.onload!();
    else if (outcome === "error") image.onerror!();
    else controller.abort();
    expect(await pending).toMatchObject({ outcome: outcome === "abort" ? "aborted" : "failed" });
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:photo");
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
    if (outcome !== "error") expect(image.src).toBe("");
  });
});
