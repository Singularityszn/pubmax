import type { palHeadTarget } from "@/components/pal/usePalHead3D";

export type PalMeshStatus = "loading" | "ready" | "graphics-unavailable" | "graphics-lost" | "model-unavailable";
export type PalMeshSurface = {
  renderPose(pose: ReturnType<typeof palHeadTarget>, now: number): boolean;
  setYaw(degrees: number): void;
  turnYaw(degrees: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
};
export function mountOriginalPalMesh(host: HTMLElement, options: {
  modelUrl: string;
  onStatus(status: PalMeshStatus): void;
}): PalMeshSurface;
