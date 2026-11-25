import { beforeEach, describe, expect, it, vi } from "vitest";

const camera = vi.hoisted(() => ({ getPhoto: vi.fn(), checkPermissions: vi.fn() }));
vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: () => true, nativePlatform: () => "android" }));
vi.mock("@capacitor/camera", () => ({
  Camera: camera,
  CameraResultType: { Uri: "uri" },
  CameraSource: { Prompt: "prompt" },
}));
import { pickNativePhoto } from "@/lib/nativeCamera";

describe("native photo permission", () => {
  beforeEach(() => {
    camera.getPhoto.mockReset();
    camera.checkPermissions.mockResolvedValue({ camera: "denied", photos: "granted" });
  });

  it("offers recovery after Android refuses the camera", async () => {
    camera.getPhoto.mockRejectedValue(new Error("User denied access to camera"));
    expect((await pickNativePhoto()).outcome).toBe("blocked");
  });

  it("does not report a blocked camera when the picker is cancelled", async () => {
    camera.getPhoto.mockRejectedValue(new Error("User cancelled photos app"));
    expect((await pickNativePhoto()).outcome).toBe("cancelled");
  });
});
