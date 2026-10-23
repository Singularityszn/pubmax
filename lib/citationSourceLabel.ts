// The label a citation chip prints for its source. "seed" is the internal name
// for demo content, which the rest of the app calls Demo (lib/provenanceLabels.ts),
// so a raw "seed" never reaches a reader.
export function citationSourceLabel(source: string): string {
  return source.trim().toLowerCase() === "seed" ? "Demo" : source;
}
