import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const camera = vi.hoisted(() => ({ getPhoto: vi.fn(), checkPermissions: vi.fn() }));
const shell = vi.hoisted(() => ({ native: true, platform: "android" }));
vi.mock("@/lib/nativePlatform", () => ({
  isNativeApp: () => shell.native,
  nativePlatform: () => shell.platform,
}));
vi.mock("@capacitor/camera", () => ({
  Camera: camera,
  CameraResultType: { Uri: "uri", Base64: "base64" },
  CameraSource: { Prompt: "prompt" },
}));
import { pickNativePhoto } from "@/lib/nativeCamera";

describe("native photo permission and picker contract", () => {
  beforeEach(() => {
    shell.native = true;
    shell.platform = "android";
    camera.getPhoto.mockReset();
    camera.checkPermissions.mockReset();
    camera.checkPermissions.mockResolvedValue({ camera: "denied", photos: "granted" });
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(["denied", "prompt-with-rationale"])("offers recovery after Android refuses with %s", async (permission) => {
    camera.getPhoto.mockRejectedValue(new Error("User denied access to camera"));
    camera.checkPermissions.mockResolvedValue({ camera: permission, photos: "granted" });
    expect(await pickNativePhoto()).toEqual({
      outcome: "blocked",
      message: "The camera is switched off for this app. Turn it on in Settings, or pick a photo you already have.",
    });
  });

  it.each(["denied", "prompt-with-rationale", "prompt", "granted"])("keeps Android picker cancellation silent with camera %s", async (permission) => {
    camera.getPhoto.mockRejectedValue(new Error("User cancelled photos app"));
    camera.checkPermissions.mockResolvedValue({ camera: permission, photos: "granted" });
    expect(await pickNativePhoto()).toEqual({ outcome: "cancelled" });
  });

  it("keeps a failed permission read silent", async () => {
    camera.getPhoto.mockRejectedValue(new Error("User denied access to camera"));
    camera.checkPermissions.mockRejectedValue(new Error("bridge unavailable"));
    expect(await pickNativePhoto()).toEqual({ outcome: "cancelled" });
  });

  it("offers recovery when iOS denies both picker sources", async () => {
    shell.platform = "ios";
    camera.getPhoto.mockRejectedValue(new Error("access denied"));
    camera.checkPermissions.mockResolvedValue({ camera: "denied", photos: "denied" });
    expect((await pickNativePhoto()).outcome).toBe("blocked");
  });

  it("keeps an iOS library cancellation silent when only the camera is denied", async () => {
    shell.platform = "ios";
    camera.getPhoto.mockRejectedValue(new Error("User cancelled photos app"));
    expect(await pickNativePhoto()).toEqual({ outcome: "cancelled" });
  });

  it("does not open a native picker on the web", async () => {
    shell.native = false;
    expect(await pickNativePhoto()).toEqual({ outcome: "cancelled" });
    expect(camera.getPhoto).not.toHaveBeenCalled();
  });

  it.each(["moment", "pint", "venue", "board"] as const)("returns the chosen %s photo through the bounded camera-or-library picker", async (surface) => {
    // Capacitor's native Base64 contract returns bytes through the bridge.
    // A URI read can fail under the WebView CSP after selection succeeds.
    shell.platform = "ios";
    camera.getPhoto.mockImplementation(async ({ resultType }) => resultType === "base64"
      ? { base64String: "/9j/", format: "jpg" }
      : { webPath: "capacitor://localhost/_capacitor_file_/photo.jpg", format: "jpg" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const result = await pickNativePhoto(surface);
    expect(result.outcome).toBe("chosen");
    expect(camera.getPhoto).toHaveBeenCalledWith({
      resultType: "base64", source: "prompt", quality: 85,
      width: 2048, height: 2048, correctOrientation: true,
    });
    if (result.outcome !== "chosen") throw new Error("photo not returned");
    expect(result.file.name).toMatch(new RegExp(`^${surface}-[0-9]+\\.jpg$`));
    expect(result.file.type).toBe("image/jpeg");
    expect(new Uint8Array(await result.file.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255]));
  });

  it.each([undefined, "", "not base64!"])("reports an unreadable selection, not cancellation, for %s", async (base64String) => {
    camera.getPhoto.mockResolvedValue({ base64String, format: "jpeg" });
    const result = await pickNativePhoto();
    expect(result).toEqual({ outcome: "failed", message: expect.stringMatching(/\S/) });
    expect(camera.checkPermissions).not.toHaveBeenCalled();
  });
});
