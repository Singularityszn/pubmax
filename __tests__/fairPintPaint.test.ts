import { expect, it, vi } from "vitest";
import type { Map } from "maplibre-gl";
import { wireFairPintPaint } from "@/components/map/fairpint/fairPintPaint";
import { setFairPintSession } from "@/lib/fairPint";
it("settles without scheduling another paint from a settled map", () => {
  const values = new globalThis.Map<string, unknown>();
  const listeners = new globalThis.Map<string, () => void>();
  const write = vi.fn((id: string, key: string, value: unknown) => { values.set(id + key, value); });
  const map = { getLayer: () => ({}), getPaintProperty: (id: string, key: string) => values.get(id + key) ?? 1, setPaintProperty: write, on: (event: string, fn: () => void) => listeners.set(event, fn), off: () => {} } as unknown as Map;
  setFairPintSession(true, 550);
  wireFairPintPaint(map);
  write.mockClear();
  listeners.get("idle")!();
  expect(write).not.toHaveBeenCalled();
  listeners.get("remove")!();
  setFairPintSession(false);
});
