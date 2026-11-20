import "server-only";
import { escapeHtml } from "@/lib/escapeHtml";

export const validPaydayToken = (value: string | null): value is string => value !== null && /^[A-Za-z0-9_-]{43}$/.test(value);
export function paydayActionPage(title: string, message: string, action?: string, label?: string): Response {
  const form = action && label ? `<form method="post" action="${escapeHtml(action)}"><button type="submit">${escapeHtml(label)}</button></form>` : "";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:Arial,sans-serif;max-width:560px;margin:48px auto;padding:0 24px"><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${form}<p><a href="/">Back to PUBMAXX</a></p></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } });
}
