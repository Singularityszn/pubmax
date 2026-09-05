export function buildIco(entries: Array<{ size: number; png: Buffer }>): Buffer;

export function readIcoMembers(buffer: Buffer): Array<{ size: number; png: Buffer }>;

export function buildBrandIconFiles(): Promise<Map<string, Buffer | string>>;

export function brandMirrorFiles(
  files: Map<string, Buffer | string>,
): Map<string, Buffer | string>;

export const ANDROID_LAUNCHER_DENSITIES: Record<
  "ldpi" | "mdpi" | "hdpi" | "xhdpi" | "xxhdpi" | "xxxhdpi",
  number
>;

export function buildAndroidLauncherFiles(): Promise<Map<string, Buffer>>;
