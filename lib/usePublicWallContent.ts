"use client";

import { useEffect, useState } from "react";
type WallRead = { status?: string; photos?: unknown[]; nextCursor?: string | null };

export function usePublicWallContent(enabled = true, generation = 0): boolean {
  const [result, setResult] = useState({ generation: -1, hasPhotos: false });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    async function read(): Promise<void> {
      const params = new URLSearchParams({ limit: "1" });
      try {
        while (!controller.signal.aborted) {
          const response = await fetch(`/api/drink-wall?${params}`, { signal: controller.signal });
          const body = response.ok ? await response.json() as WallRead : null;
          if (controller.signal.aborted) return;
          if (body?.status !== "ready" || !Array.isArray(body.photos)
            || (body.nextCursor !== null && (typeof body.nextCursor !== "string" || body.nextCursor.length === 0))) {
            setResult({ generation, hasPhotos: true });
            return;
          }
          if (body.photos.length > 0 || body.nextCursor === null) {
            setResult({ generation, hasPhotos: body.photos.length > 0 });
            return;
          }
          params.set("cursor", body.nextCursor);
        }
      } catch {
        if (!controller.signal.aborted) setResult({ generation, hasPhotos: true });
      }
    }
    void read();
    return () => controller.abort();
  }, [enabled, generation]);

  return enabled && result.generation === generation && result.hasPhotos;
}
