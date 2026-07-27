export type PermissiblePriceSource = {
  id: string;
  label: string;
  kind: "first-party-official" | "open-data";
  url: string;
};

export function fetchFromSource(
  source: PermissiblePriceSource,
): Promise<unknown>;
