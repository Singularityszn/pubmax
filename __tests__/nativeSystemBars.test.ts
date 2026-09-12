import { beforeEach, describe, expect, it, vi } from "vitest";

import { isNativeApp, nativePlatform } from "@/lib/nativePlatform";
import { syncNativeSystemBars } from "@/lib/nativeSystemBars";

const setStyle = vi.fn();
const show = vi.fn();
const setTheme = vi.fn();

vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: vi.fn(), nativePlatform: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  SystemBars: { setStyle, show },
  SystemBarsStyle: { Dark: "DARK", Light: "LIGHT", Default: "DEFAULT" },
  registerPlugin: () => ({ setTheme }),
}));

const native = vi.mocked(isNativeApp);

beforeEach(() => {
  vi.clearAllMocks();
  native.mockReturnValue(true);
  vi.mocked(nativePlatform).mockReturnValue("ios");
  setStyle.mockResolvedValue(undefined);
  show.mockResolvedValue(undefined);
  setTheme.mockResolvedValue(undefined);
});

describe("syncNativeSystemBars", () => {
  it("never loads or calls the native plugin on the web", async () => {
    native.mockReturnValue(false);

    await expect(syncNativeSystemBars("dark")).resolves.toBe(false);
    expect(setStyle).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
    expect(setTheme).not.toHaveBeenCalled();
  });

  it.each([
    ["dark", "DARK"],
    ["light", "LIGHT"],
  ] as const)("maps the %s app theme to legible native system bars", async (theme, style) => {
    await expect(syncNativeSystemBars(theme)).resolves.toBe(true);
    expect(setStyle).toHaveBeenCalledWith({ style });
    expect(show).toHaveBeenCalledOnce();
    expect(setTheme).not.toHaveBeenCalled();
  });

  it.each(["dark", "light"] as const)("matches the Android window to the %s app theme", async (theme) => {
    vi.mocked(nativePlatform).mockReturnValue("android");
    await expect(syncNativeSystemBars(theme)).resolves.toBe(true);
    expect(setTheme).toHaveBeenCalledWith({ theme });
    expect(setStyle).toHaveBeenCalledOnce();
  });

  it("keeps the existing system-bar path usable in an older Android shell", async () => {
    vi.mocked(nativePlatform).mockReturnValue("android");
    setTheme.mockRejectedValue(new Error("plugin unavailable"));
    await expect(syncNativeSystemBars("dark")).resolves.toBe(false);
    expect(setStyle).toHaveBeenCalledWith({ style: "DARK" });
    expect(show).toHaveBeenCalledOnce();
  });

  it("fails soft if the native plugin rejects", async () => {
    setStyle.mockRejectedValue(new Error("plugin unavailable"));

    await expect(syncNativeSystemBars("dark")).resolves.toBe(false);
    expect(show).not.toHaveBeenCalled();
  });
});
