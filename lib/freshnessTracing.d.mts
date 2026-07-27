export function freshnessArtifactIncludes(registry: {
  datasets?: readonly {
    readonly artifact?: string | null;
    readonly stamp?: { readonly kind?: string } | null;
  }[];
}): string[];
