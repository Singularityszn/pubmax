export const THEME_STORAGE_KEY: "pubmax-theme";

export type DesignProofViewport = Readonly<{
  key: "390" | "1440";
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
}>;

export type DesignProofTheme = "light" | "dark";

export const DESIGN_PROOF_VIEWPORTS: readonly DesignProofViewport[];
export const DESIGN_PROOF_THEMES: readonly DesignProofTheme[];

export type ProofPage = { name: string; path: string };

export type DesignProofOptions = {
  baseUrl: string | null;
  start: boolean;
  port: number | null;
  outDir: string | null;
  before: string | null;
  fullPage: boolean;
  settleMs: number;
  pages: ProofPage[];
};

export function parseProofPage(value: string): ProofPage;
export function parseDesignProofArgs(argv: readonly string[]): DesignProofOptions;
export function proofShotFile(pageName: string, viewportKey: string, theme: string): string;

export type DesignProofShot = {
  page: ProofPage;
  viewport: DesignProofViewport;
  theme: DesignProofTheme;
  file: string;
};

export function designProofShots(pages: readonly ProofPage[]): DesignProofShot[];

export type ContactSheetColumn = {
  viewportKey: "390" | "1440";
  theme: DesignProofTheme;
  label: string;
  width: number;
};

export function contactSheetColumns(): ContactSheetColumn[];

export type ContactSheetPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  cropped: boolean;
  rowLabel: string;
  column: number;
};

export function contactSheetLayout(
  rows: readonly { label: string; tiles: readonly ({ width: number; height: number } | null)[] }[],
  options?: { maxTileHeight?: number },
): {
  width: number;
  height: number;
  placements: ContactSheetPlacement[];
  labels: { text: string; x: number; y: number }[];
};
