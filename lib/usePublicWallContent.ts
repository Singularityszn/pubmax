"use client";

import { useEffect, useState } from "react";
type WallRead = { status?: string; photos?: unknown[] };

export function usePublicWallContent(enabled = true, generation = 0): boolean {
  const [result, setResult] = useState({ generation: -1, hasPhotos: false });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetch("/api/drink-wall?limit=1", { signal: controller.signal })
      .then(async (response) => response.ok ? await response.json() as WallRead : null)
      .then((body) => {
        if (!controller.signal.aborted) {
          setResult({ generation, hasPhotos: body?.status === "ready" && Array.isArray(body.photos) && body.photos.length > 0 });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ generation, hasPhotos: false });
      });
    return () => controller.abort();
  }, [enabled, generation]);

  return enabled && result.generation === generation && result.hasPhotos;
}
