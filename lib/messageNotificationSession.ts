export function messageNotificationSessionFromToken(bearer: string | null, userId: string): string | null {
  try {
    const encoded = bearer?.split(".")[1];
    if (!encoded) return null;
    const payload: unknown = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")));
    if (!payload || typeof payload !== "object" || !("sub" in payload) || !("session_id" in payload)) return null;
    return payload.sub === userId && typeof payload.session_id === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(payload.session_id) ? payload.session_id : null;
  } catch { return null; }
}
