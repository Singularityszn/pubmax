export function freshnessArtifactIncludes(registry: {
  datasets?: readonly {
    readonly artifact?: string | null;
    readonly pack?: boolean;
    readonly rowExpiry?: string;
    readonly stamp?: { readonly kind?: string } | null;
  }[];
}): string[];

export function freshnessArtifactIncludeById(
  registry: {
    datasets?: readonly {
      readonly id?: string;
      readonly artifact?: string | null;
    }[];
  },
  id: string,
): string[];
