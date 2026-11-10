export type PalMapClientToolParameter = { type: "integer" | "string"; description: string };

export type PalMapClientTool = {
  name: string;
  description: string;
  parameters: Readonly<Record<string, PalMapClientToolParameter>>;
};

export const PAL_MAP_CLIENT_TOOLS: readonly PalMapClientTool[];
export const PAL_MAP_CLIENT_TOOL_NAMES: readonly string[];
