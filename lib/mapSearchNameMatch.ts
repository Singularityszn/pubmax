export function normaliseMapSearchText(value: string | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-GB")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function words(value: string): string[] {
  return value.split(" ").filter(Boolean);
}

function oneNameEdit(left: string, right: string): boolean {
  if (Math.min(left.length, right.length) < 4 || Math.abs(left.length - right.length) > 1) return false;
  let index = 0;
  while (index < left.length && left[index] === right[index]) index += 1;
  if (left.length !== right.length) {
    const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
    return shorter.slice(index) === longer.slice(index + 1);
  }
  return left.slice(index + 1) === right.slice(index + 1) || (
    left[index] === right[index + 1] && left[index + 1] === right[index] &&
    left.slice(index + 2) === right.slice(index + 2)
  );
}

function compactName(value: string): string {
  return value.replace(/^the /, "").replaceAll(" ", "");
}

export function mapSearchNameTier(labels: readonly string[], rawQuery: string): 0 | 1 | 2 | 3 | 4 | null {
  const query = normaliseMapSearchText(rawQuery);
  if (!query) return null;
  let tier: 1 | 2 | 3 | 4 | null = null;
  for (const label of labels) {
    const aliases = new Set([normaliseMapSearchText(label), normaliseMapSearchText(label.replace(/&/g, " "))]);
    for (const name of aliases) {
      if (!name) continue;
      if (name === query || compactName(name) === compactName(query)) return 0;
      let candidate: 1 | 2 | 3 | 4 | null = null;
      if (` ${name} `.includes(` ${query} `)) {
        candidate = 1;
      } else if (name.startsWith(query) || words(name).some((word) => word.startsWith(query))) {
        candidate = 2;
      } else if (query.length >= 2 && name.includes(query)) {
        candidate = 3;
      } else if (oneNameEdit(compactName(query), compactName(name)) ||
        words(name).some((word) => oneNameEdit(query, word))) {
        candidate = 4;
      }
      if (candidate !== null && (tier === null || candidate < tier)) tier = candidate;
    }
  }
  return tier;
}
