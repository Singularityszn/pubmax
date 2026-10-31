import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SharePage from "@/app/share/page";
import ShareToWanted from "@/app/share/ShareToWanted";
import { nativeDeepLinkPath, NATIVE_SCHEME_ONLY_EXACT_PATHS } from "@/lib/nativeDeepLinks";
import {
  clearSharedPaste,
  readSharedPaste,
  SHARE_TARGET_PARAMS,
  SHARE_TARGET_PATH,
  SHARED_PASTE_MAX,
  SHARED_PASTE_MAX_AGE_MS,
  sharedPasteFrom,
  stashSharedPaste,
} from "@/lib/nativeShareTarget";
import { MAX_WANTED_RAW_PASTE, splitWantedPaste } from "@/lib/wanted";

// The share target (PlanAstra 8.4, "Wanted from a share"): a link or a name
// another app shares into PUBMAXX opens the Wanted paste flow pre-filled. The
// shared URL is text. It is never fetched, by the page or by anything else.

afterEach(() => vi.unstubAllGlobals());

function findElement(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findElement(child, type);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<Record<string, unknown>>;
  if (element.type === type) return element;
  return findElement(element.props.children as ReactNode, type);
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

describe("building the paste from a share", () => {
  it("leads with the text, adds the link once, and uses the title only without text", () => {
    expect(sharedPasteFrom({ text: "The Seven Stars", url: "https://www.instagram.com/p/abc" })).toBe(
      "The Seven Stars https://www.instagram.com/p/abc",
    );
    expect(sharedPasteFrom({ text: "Go here https://vm.tiktok.com/xyz", url: "https://vm.tiktok.com/xyz" })).toBe(
      "Go here https://vm.tiktok.com/xyz",
    );
    expect(sharedPasteFrom({ title: "Instagram", text: "Cittie of Yorke" })).toBe("Cittie of Yorke");
    expect(sharedPasteFrom({ title: "The Harp", url: "https://example.com/harp" })).toBe(
      "The Harp https://example.com/harp",
    );
    expect(sharedPasteFrom({})).toBe("");
  });

  it("strips markup and caps at the Wanted raw-paste limit", () => {
    expect(SHARED_PASTE_MAX).toBe(MAX_WANTED_RAW_PASTE);
    expect(sharedPasteFrom({ text: "<b>The Lamb</b>" })).toBe("bThe Lamb/b");
    expect(sharedPasteFrom({ text: "x".repeat(900) }).length).toBeLessThanOrEqual(MAX_WANTED_RAW_PASTE);
  });

  it("hands the existing resolver a name and a provenance link it never fetches", () => {
    const split = splitWantedPaste(
      sharedPasteFrom({ text: "The Seven Stars", url: "https://www.tiktok.com/@pubs/video/1" }),
    );
    expect(split.query).toBe("The Seven Stars");
    expect(split.sourcePlatform).toBe("tiktok");
  });
});

describe("the share page", () => {
  it("pre-fills the Wanted paste flow and never calls fetch on the shared URL", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);

    const page = await SharePage({
      searchParams: Promise.resolve({
        title: "Instagram",
        text: "The Seven Stars",
        url: "https://www.instagram.com/p/abc",
      }),
    });

    const target = findElement(page, ShareToWanted);
    expect(target?.props.sharedPaste).toBe("The Seven Stars https://www.instagram.com/p/abc");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is a noindex page with no fetch, oEmbed or unfurl in its source", () => {
    const sources = ["app/share/page.tsx", "app/share/ShareToWanted.tsx", "lib/nativeShareTarget.ts"].map(
      (file) => readFileSync(join(process.cwd(), file), "utf8"),
    );
    for (const source of sources) {
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/oembed/i);
    }
  });
});

describe("keeping the share on the device", () => {
  it("keeps the paste for a week, then lets it go", () => {
    const storage = memoryStorage();
    stashSharedPaste(storage, "The Lamb", 1_000);
    expect(readSharedPaste(storage, 2_000)).toBe("The Lamb");
    expect(readSharedPaste(storage, 1_000 + SHARED_PASTE_MAX_AGE_MS + 1)).toBe("");
    stashSharedPaste(storage, "The Lamb", 1_000);
    clearSharedPaste(storage);
    expect(readSharedPaste(storage, 2_000)).toBe("");
  });

  it("survives absent or throwing storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(() => stashSharedPaste(broken, "x")).not.toThrow();
    expect(readSharedPaste(broken)).toBe("");
    expect(readSharedPaste(null)).toBe("");
    expect(() => clearSharedPaste(broken)).not.toThrow();
  });
});

describe("the manifest and the native door", () => {
  it("declares a GET share target at the share page with title, text and url", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "public/manifest.webmanifest"), "utf8"),
    ) as { share_target?: { action: string; method: string; params: Record<string, string> } };
    expect(manifest.share_target).toEqual({
      action: SHARE_TARGET_PATH,
      method: "GET",
      params: Object.fromEntries(SHARE_TARGET_PARAMS.map((name) => [name, name])),
    });
  });

  it("routes pubmaxx://share to the share page, and only over the custom scheme", () => {
    expect(NATIVE_SCHEME_ONLY_EXACT_PATHS).toEqual([SHARE_TARGET_PATH]);
    expect(nativeDeepLinkPath("pubmaxx://share?text=The%20Lamb&url=https%3A%2F%2Fvm.tiktok.com%2Fx")).toBe(
      "/share?text=The%20Lamb&url=https%3A%2F%2Fvm.tiktok.com%2Fx",
    );
    expect(nativeDeepLinkPath("https://pubmaxxing.com/share?text=x")).toBeNull();
    expect(nativeDeepLinkPath("pubmaxx://share/extra")).toBeNull();
  });
});
