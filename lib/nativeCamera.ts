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

import { isNativeApp } from "@/lib/nativePlatform";

/**
 * The surfaces that take a photo inside the shell. A surface is named rather
 * than free text because the name becomes the file name a person's phone hands
 * over, and "moment-1757…jpg" on a price board is a small lie about what was
 * photographed. Each one has a web input beside it that does the same job off
 * the shell.
 */
export const NATIVE_PHOTO_SURFACES = ["moment", "pint", "venue"] as const;

export type NativePhotoSurface = (typeof NATIVE_PHOTO_SURFACES)[number];

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
 * Take or choose a photo inside the shell. Resolves to a File shaped exactly
 * like a file-input selection, or null when the user cancels, denies the
 * permission, or capture fails — every caller treats null as "nothing chosen",
 * never as an error, because a cancelled sheet is not a failure to report.
 */
export async function captureNativePhoto(
  surface: NativePhotoSurface = "moment",
): Promise<File | null> {
  if (!isNativeApp()) return null;
  try {
    const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.Uri,
      source: CameraSource.Prompt,
      quality: PHOTO_QUALITY,
      width: MAX_PHOTO_EDGE,
      height: MAX_PHOTO_EDGE,
      correctOrientation: true,
    });
    if (!photo.webPath) return null;
    const blob = await (await fetch(photo.webPath)).blob();
    const type = blob.type || nativePhotoMediaType(photo.format);
    return new File([blob], nativePhotoFileName(surface, photo.format), { type });
  } catch {
    // User cancelled or permission denied — the composer just stays as-is.
    return null;
  }
}
