export type SupabaseConfig = Readonly<{
  url: string;
  key: string;
}>;

export function resolveSupabaseConfig(
  url: string | undefined,
  key: string | undefined,
): SupabaseConfig | null {
  const cleanUrl = url?.trim();
  const cleanKey = key?.trim();
  if (!cleanUrl || !cleanKey) return null;
  if (!/^https?:\/\//i.test(cleanUrl)) return null;

  try {
    const parsed = new URL(cleanUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }

  return { url: cleanUrl, key: cleanKey };
}
