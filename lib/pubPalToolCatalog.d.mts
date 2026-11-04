export type PubPalToolArgumentProperty = {
  type: string;
  description: string;
  enum?: string[];
};

export const PUB_PAL_TOOL_DESCRIPTIONS: Readonly<Record<string, string>>;
export const PUB_PAL_TOOL_NAMES: readonly string[];
export function pubPalToolArgumentProperties(
  name: string,
): Readonly<Record<string, PubPalToolArgumentProperty>>;
