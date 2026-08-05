export function priorPublishedSourceFor(
  row: { website?: string },
  priorEntries: Array<{ website?: string; sourceUrl?: string; result?: string }>,
): string | undefined;
