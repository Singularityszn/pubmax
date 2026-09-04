// Native camera seam. When the app runs inside the Capacitor shell the file
// input's `capture` attribute is unreliable (WKWebView shows a bare chooser,
// and the Android WebView chooser drops its camera entry whenever the binary
// has not declared the permission), so capture goes through @capacitor/camera
// instead and hands a plain File back into the existing web pipeline — callers
// never see Capacitor types. Web/SSR callers must gate on isNativeApp() first;
// this module dynamically imports the plugin only on the native path so the web
// bundle stays lean.
//
// BEAT ONE IS STILL A PICKER. `CameraSource.Prompt` is the whole reason this
// seam is allowed on a surface `__tests__/profilePhotoPicker.test.ts` sweeps:
// it opens a sheet offering the camera AND the photo library, which is the
// opposite of what `capture` does to that sheet. `CameraSource.Camera` would
// take the library away again and break the law from the other side, so the
// source is fenced rather than trusted.
//
// The permissions the OS reads are declared where each platform reads them:
// `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` in
// ios/App/App/Info.plist, and CAMERA / READ_MEDIA_IMAGES in
// android/app/src/main/AndroidManifest.xml. `__tests__/nativeWrap.test.ts`
// holds both halves to each other.

import { isNativeApp } from "@/lib/nativePlatform";

/**
 * The surfaces allowed to open the native camera, and nothing else. Each one is
 * a person photographing the night in front of them, so a sheet that offers the
 * camera first is what they came for. Profile avatars and covers are
 * deliberately ABSENT: a face or a backdrop is almost always a photo somebody
 * already has, and that journey is the plain library picker plus the crop step.
 */
export const NATIVE_CAMERA_SURFACES: readonly string[] = [
  "components/moment/MomentCapture.tsx",
  "components/map/VenuePriceSubmit.tsx",
  "components/venue/VenuePhotoComposer.tsx",
];

/**
 * What the app says when the operating system has the camera switched off for
 * it. A refusal names the way out rather than repeating that it failed, because
 * nothing the person does inside the app can grant this.
 */
export const NATIVE_CAMERA_BLOCKED_LINE =
  "The camera is switched off for this app. Turn it on in Settings, or pick a photo you already have.";

/** A capture attempt is THREE-WAY. A cancel costs nothing and says nothing; a
 * permission the OS is holding shut is a fact the person can act on. */
export type NativePhotoPick =
  | { outcome: "chosen"; file: File }
  | { outcome: "cancelled" }
  | { outcome: "blocked"; message: string };

const CANCELLED: NativePhotoPick = { outcome: "cancelled" };
const BLOCKED: NativePhotoPick = {
  outcome: "blocked",
  message: NATIVE_CAMERA_BLOCKED_LINE,
};

/**
 * Open the native camera-or-library sheet and hand back a File shaped exactly
 * like a file-input selection. Web and SSR callers get `cancelled`, so this is
 * safe to call unconditionally behind an isNativeApp() gate.
 */
export async function pickNativePhoto(): Promise<NativePhotoPick> {
  if (!isNativeApp()) return CANCELLED;
  try {
    const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.Uri,
      // Prompt, never Camera: the sheet must keep its photo library entry.
      source: CameraSource.Prompt,
      quality: 85,
    });
    if (!photo.webPath) return CANCELLED;
    const blob = await (await fetch(photo.webPath)).blob();
    const format = photo.format || "jpeg";
    const type = blob.type || `image/${format === "jpg" ? "jpeg" : format}`;
    return {
      outcome: "chosen",
      file: new File([blob], `moment-${Date.now()}.${format}`, { type }),
    };
  } catch {
    // getPhoto throws for a cancel and for a denial alike, so the state is read
    // back rather than guessed at. A read we could not run is reported as a
    // cancel, which costs the person nothing.
    return (await cameraPermissionDenied()) ? BLOCKED : CANCELLED;
  }
}

async function cameraPermissionDenied(): Promise<boolean> {
  try {
    const { Camera } = await import("@capacitor/camera");
    const permissions = await Camera.checkPermissions();
    return permissions.camera === "denied" && permissions.photos === "denied";
  } catch {
    return false;
  }
}

/**
 * Take a photo with the native camera. Resolves to a File, or null when the
 * user cancels / capture fails — callers treat null as "nothing chosen", never
 * an error. Callers that can show a refusal should take `pickNativePhoto`.
 */
export async function captureNativePhoto(): Promise<File | null> {
  const pick = await pickNativePhoto();
  return pick.outcome === "chosen" ? pick.file : null;
}
