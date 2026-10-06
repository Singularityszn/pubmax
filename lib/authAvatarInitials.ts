// Avatar-fallback initials for a display name, shared by every auth surface
// that shows a face-less avatar (LoginPage, SignInButton). First letter of
// the first word plus first letter of the last word (when there is more
// than one), uppercased; "?" when there is nothing to initial.

export function authAvatarInitials(name: string): string {
  // A handle is printed with its @, which is not a letter of anybody's name.
  const parts = name.trim().replace(/^@+/, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts.at(-1)?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}
