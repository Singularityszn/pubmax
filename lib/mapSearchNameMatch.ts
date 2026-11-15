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

export function mapSearchNameTier(labels: readonly string[], rawQuery: string): 0 | 1 | 2 | 3 | null {
  const query = normaliseMapSearchText(rawQuery);
  if (!query) return null;
  let tier: 1 | 2 | 3 | null = null;
  for (const label of labels) {
    const name = normaliseMapSearchText(label);
    if (!name) continue;
    if (name === query || compactName(name) === compactName(query)) return 0;
    if (name.startsWith(query) || words(name).some((word) => word.startsWith(query))) {
      tier = 1;
    } else if (query.length >= 2 && name.includes(query)) {
      if (tier !== 1) tier = 2;
    } else if (oneNameEdit(compactName(query), compactName(name)) ||
      words(name).some((word) => oneNameEdit(query, word))) {
      tier ??= 3;
    }
  }
  return tier;
}
