import type { ReactElement } from "react";

import { serializeInlineScriptJson } from "@/lib/inlineScriptJson";

// Server-only JSON-LD injector (Wave S1.3). Renders a single
// <script type="application/ld+json"> with the structured-data graph for a
// route. Two hard rules live here:
//
//  1. XSS-safe serialization. JSON-LD is emitted inside an HTML <script>, so any
//     "<", ">" or "&" in the data (a pub name, a cited fact) could otherwise
//     break out of the script element or smuggle markup. The escaping itself
//     lives in the ONE leaf module every inline <script> body shares,
//     lib/inlineScriptJson.ts - never a second JSON.stringify at an emitter.
//  2. CSP nonce, and it is DEFENSIVE rather than required. app/layout.tsx
//     serves a per-request nonce CSP (see proxy.ts) with NO 'unsafe-inline' in
//     script-src, and this file used to claim the browser enforces script-src
//     on EVERY <script> element, application/ld+json included, so a block
//     without the nonce is dropped. MEASURED on a production build in Chromium
//     against the enforcing header, with a control: a nonce-less classic inline
//     script did not execute and reported a CSP violation, while a nonce-less
//     application/ld+json block was present in the DOM, JSON.parse-able, and
//     raised no violation. script-src does not block a data block, so no
//     crawler ever lost one. Every call site passes the nonce anyway, because
//     one of eleven differing for no reason is how a rule rots, and because a
//     nonce costs nothing and survives a future policy that does gate the type.
//     Callers pass the request nonce (headers().get("x-nonce")) exactly like
//     the app's other inline scripts. Do not read this as a reason to add an
//     EXECUTABLE inline script without one: that really is dropped.
//
// Data must be provenance-honest: callers only ever pass fields the underlying
// dataset actually carries - nothing invented (PRD non-negotiable).

export type JsonLdGraph = Record<string, unknown> | Record<string, unknown>[];

/** JSON.stringify hardened for inlining inside an HTML <script> element. */
export function serializeJsonLd(data: JsonLdGraph): string {
  return serializeInlineScriptJson(data);
}

export default function JsonLd({
  data,
  nonce,
}: {
  data: JsonLdGraph;
  /** Per-request CSP nonce (headers().get("x-nonce")); required under the nonce CSP. */
  nonce?: string;
}): ReactElement {
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
