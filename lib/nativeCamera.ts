// Native photo seam. When the app runs inside the Capacitor shell the file
// input's `capture` attribute is unreliable (WKWebView shows a bare chooser),
// so a photo is taken through @capacitor/camera instead and handed back as a
// plain File into the existing web pipeline — callers never see Capacitor
// types, and nothing downstream of the picker changes.
// Web/SSR callers must gate on isNativeApp() first; this module dynamically
// imports the plugin only on the native path so the web bundle stays lean.
//
// THE SHEET IS A PICKER, NOT A CAMERA. `CameraSource.Prompt` offers Camera and
// Photo Library side by side, which is the native answer to the same law
// `__tests__/profilePhotoPicker.test.ts` holds the web inputs to: a person
// choosing a pub photo may already have taken it. Never narrow a surface here
// to `CameraSource.Camera` without the law changing first.
//
// A permission read confirms a refusal. Android also needs the plugin's
// camera-denial error because library access can remain granted after refusal.
// Picker cancellation stays silent. See docs/CAPACITOR_WRAP.md for permissions.

import type { Photo } from "@capacitor/camera";
import { isNativeApp, nativePlatform } from "@/lib/nativePlatform";

/**
 * The surfaces that take a photo inside the shell. A surface is named rather
 * than free text because the name becomes the file name a person's phone hands
 * over, and "moment-1757…jpg" on a price board is a small lie about what was
 * photographed. Each one has a web input beside it that does the same job off
 * the shell.
 */
export type NativePhotoSurface = "moment" | "pint" | "venue" | "board";

/** Longest edge in pixels. The upload path re-encodes anyway (the cropper on
 * the wall, the server on every slot), so a full 12 MP frame is bytes a phone
 * spends on a pub's wifi for nothing. */
const MAX_PHOTO_EDGE = 2048;
const PHOTO_QUALITY = 85;

/** `image/jpg` is not a media type. Capacitor reports the container as `jpg`,
 * so the one place that word is turned into a type is here. */
export function nativePhotoMediaType(format: string | undefined): string {
  const normalised = (format || "jpeg").toLowerCase();
  return `image/${normalised === "jpg" ? "jpeg" : normalised}`;
}

/** `<surface>-<timestamp>.<format>`, so a file says which surface took it. */
export function nativePhotoFileName(
  surface: NativePhotoSurface,
  format: string | undefined,
  now: number = Date.now(),
): string {
  return `${surface}-${now}.${(format || "jpeg").toLowerCase()}`;
}

/**
 * What the app says when the operating system has the camera switched off for
 * it. A refusal names the way out rather than repeating that it failed, because
 * nothing the person does inside the app can grant this.
 */
const NATIVE_CAMERA_BLOCKED_LINE =
  "The camera is switched off for this app. Turn it on in Settings, or pick a photo you already have.";

export type NativePhotoPick =
  | { outcome: "chosen"; file: File }
  | { outcome: "cancelled" }
  | { outcome: "blocked"; message: string }
  | { outcome: "failed"; message: string };

const CANCELLED: NativePhotoPick = { outcome: "cancelled" };
const BLOCKED: NativePhotoPick = {
  outcome: "blocked",
  message: NATIVE_CAMERA_BLOCKED_LINE,
};
const FAILED: NativePhotoPick = {
  outcome: "failed",
  message: "Couldn't read that photo. Try choosing it again.",
};

async function cameraPermissionDenied(error: unknown): Promise<boolean> {
  try {
    const { Camera } = await import("@capacitor/camera");
    const permissions = await Camera.checkPermissions();
    return (permissions.camera === "denied" && permissions.photos === "denied") || (
      nativePlatform() === "android" &&
      (permissions.camera === "denied" || permissions.camera === "prompt-with-rationale") &&
      error instanceof Error && error.message === "User denied access to camera"
    );
  } catch {
    return false;
  }
}

/**
 * Take or choose a photo inside the shell. Web and SSR callers get `cancelled`, so this is safe to
 * call behind an isNativeApp() gate.
 */
export async function pickNativePhoto(
  surface: NativePhotoSurface = "moment",
): Promise<NativePhotoPick> {
  if (!isNativeApp()) return CANCELLED;
  let photo: Photo;
  try {
    const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
    // URI reads cross connect-src when the shell loads a remote page.
    photo = await Camera.getPhoto({
      resultType: CameraResultType.Base64,
      source: CameraSource.Prompt,
      quality: PHOTO_QUALITY,
      width: MAX_PHOTO_EDGE,
      height: MAX_PHOTO_EDGE,
      correctOrientation: true,
    });
  } catch (error) {
    return (await cameraPermissionDenied(error)) ? BLOCKED : CANCELLED;
  }
  try {
    if (!photo.base64String) return FAILED;
    const bytes = Uint8Array.from(atob(photo.base64String), (value) => value.charCodeAt(0));
    return {
      outcome: "chosen",
      file: new File([bytes], nativePhotoFileName(surface, photo.format), {
        type: nativePhotoMediaType(photo.format),
      }),
    };
  } catch {
    return FAILED;
  }
}
