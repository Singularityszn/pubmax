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
// AN ATTEMPT ENDS THREE WAYS, NOT TWO. `getPhoto` throws identically for a
// cancel and for a permission the operating system is holding shut, so the two
// are told apart by reading the permission back rather than by guessing. A
// cancel costs nothing and says nothing; a refusal is a fact the person can act
// on, and only they can, because nothing inside the app can grant it. The
// permissions themselves are declared where each platform reads them:
// `NSCameraUsageDescription` in ios/App/App/Info.plist, and CAMERA plus
// READ_MEDIA_IMAGES in android/app/src/main/AndroidManifest.xml.

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
 * What the app says when the operating system has the camera switched off for
 * it. A refusal names the way out rather than repeating that it failed, because
 * nothing the person does inside the app can grant this.
 */
export const NATIVE_CAMERA_BLOCKED_LINE =
  "The camera is switched off for this app. Turn it on in Settings, or pick a photo you already have.";

/** A capture attempt is THREE-WAY. See the header: a cancel and a refusal reach
 * this module the same way and must not reach a person the same way. */
export type NativePhotoPick =
  | { outcome: "chosen"; file: File }
  | { outcome: "cancelled" }
  | { outcome: "blocked"; message: string };

const CANCELLED: NativePhotoPick = { outcome: "cancelled" };
const BLOCKED: NativePhotoPick = {
  outcome: "blocked",
  message: NATIVE_CAMERA_BLOCKED_LINE,
};

async function cameraPermissionDenied(): Promise<boolean> {
  try {
    const { Camera } = await import("@capacitor/camera");
    const permissions = await Camera.checkPermissions();
    // BOTH, because the sheet offers both doors: a person who refused the
    // camera can still pick a photo they already have, and telling them the
    // camera is off would be true and useless.
    return permissions.camera === "denied" && permissions.photos === "denied";
  } catch {
    return false;
  }
}

/**
 * Take or choose a photo inside the shell, reporting which of the three
 * outcomes happened. Web and SSR callers get `cancelled`, so this is safe to
 * call behind an isNativeApp() gate.
 */
export async function pickNativePhoto(
  surface: NativePhotoSurface = "moment",
): Promise<NativePhotoPick> {
  if (!isNativeApp()) return CANCELLED;
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
    if (!photo.webPath) return CANCELLED;
    const blob = await (await fetch(photo.webPath)).blob();
    const type = blob.type || nativePhotoMediaType(photo.format);
    return {
      outcome: "chosen",
      file: new File([blob], nativePhotoFileName(surface, photo.format), { type }),
    };
  } catch {
    // A read we could not run is reported as a cancel, which costs nobody
    // anything; only bytes we DID read back as denied earn the refusal.
    return (await cameraPermissionDenied()) ? BLOCKED : CANCELLED;
  }
}

/**
 * The two-way form, for a caller with nowhere to put a refusal. Resolves to a
 * File, or null when the person cancels or the capture could not happen — such
 * a caller treats null as "nothing chosen", never as an error. A caller that
 * CAN show a line should take `pickNativePhoto` instead.
 */
export async function captureNativePhoto(
  surface: NativePhotoSurface = "moment",
): Promise<File | null> {
  const pick = await pickNativePhoto(surface);
  return pick.outcome === "chosen" ? pick.file : null;
}
